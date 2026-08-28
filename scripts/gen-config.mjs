/**
 * Writes config.js and _headers at deploy time from the Netlify site
 * environment variables.
 *
 * Two files, not one, and the second is the point:
 *
 *   config.js   the Supabase URL and anon key for THIS division
 *   _headers    a Content-Security-Policy whose connect-src names THIS
 *               division's project and nothing else
 *
 * The LMS commits config.js because it has one backend. Grid has one per
 * division running the same commit, so the configuration cannot live in
 * the repository. That in turn means the CSP cannot be hardcoded in
 * netlify.toml either: pinning connect-src to one project ref there would
 * break every other division, and a wildcard https://*.supabase.co would
 * let a compromised page talk to any Supabase project in the world.
 * Generating both files together keeps the tight policy and the
 * per-division deployment.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* Resolve everything from the repository root, not from process.cwd().
   Netlify runs the build from the base directory when one is set in the
   site UI, and this script used to write to the relative path
   "apps/inspect/config.js" — which from inside apps/inspect produces
   apps/inspect/apps/inspect/config.js and a site that 404s. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "apps", "inspect");

const need = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DIVISION_CODE", "DIVISION_NAME"];
const missing = need.filter(k => !process.env[k]);
if (missing.length) {
  console.error("Build stopped. Missing site environment variables: " + missing.join(", "));
  console.error("Set them in Netlify under Site configuration > Environment variables.");
  console.error("A site that deploys without knowing which database it belongs to is");
  console.error("worse than a site that does not deploy.");
  process.exit(1);
}

const url = process.env.SUPABASE_URL.replace(/\/+$/, "");
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error(`Build stopped. SUPABASE_URL does not look like a project URL: ${url}`);
  console.error("Expected https://<project-ref>.supabase.co with no trailing path.");
  process.exit(1);
}
const wss = url.replace("https://", "wss://");

const cfg = {
  url,
  key: process.env.SUPABASE_ANON_KEY,
  division: { code: process.env.DIVISION_CODE, name: process.env.DIVISION_NAME },
  build: {
    commit: (process.env.COMMIT_REF || "local").slice(0, 8),
    deployedAt: new Date().toISOString(),
    context: process.env.CONTEXT || "local"
  }
};

writeFileSync(join(APP_DIR, "config.js"),
`/* Generated at deploy time by scripts/gen-config.mjs. Do not edit, and do
   not commit: the next build overwrites it, and each division needs its
   own. The anon key below is public by design - RLS is the control. */
window.GRID_CONFIG = ${JSON.stringify(cfg, null, 2)};
`);

// Realtime needs the wss origin as well as https, or the subscription
// silently fails and the app looks stale rather than broken.
/* One line, no newlines, no leading whitespace. An HTTP header cannot
   contain a newline: written as a multi-line string this collapsed to
   roughly "default-src 'none'" and blocked every script on the site.

   manifest-src, font-src and worker-src are named explicitly. With
   default-src 'none' anything unnamed falls back to none and is blocked —
   the manifest was, which was the only thing the console reported. */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  /* The Supabase origin is needed for inspection photos: they live in
     private storage and are shown through signed URLs on that host. Without
     it the upload succeeds and every thumbnail is blocked, which looks like
     the photo was lost. */
  `img-src 'self' data: blob: ${url}`,
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  `connect-src 'self' ${url} ${wss}`,
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "upgrade-insecure-requests"
].join("; ");

if (/[\r\n]/.test(CSP)) { console.error("CSP contains a newline — refusing to write it."); process.exit(1); }

writeFileSync(join(APP_DIR, "_headers"),
`# Generated at deploy time by scripts/gen-config.mjs.
# The Content-Security-Policy lives ONLY here: connect-src names this
# division's Supabase project, which is not known until build time.
/*
  Content-Security-Policy: ${CSP}
`);

console.log(`config.js + _headers written for ${cfg.division.code} ` +
            `(${cfg.build.context}, ${cfg.build.commit})`);
console.log(`  connect-src pinned to ${url}`);
console.log(`  written to ${APP_DIR}`);

// A stale vendored client is a silent problem: the app works, and then one
// day a Supabase change breaks it and nobody remembers the file is pinned.
const vendored = join(APP_DIR, "vendor", "supabase.js");
if (existsSync(vendored)) {
  const v = readFileSync(vendored, "utf8").match(/supabase-js\/(\d+\.\d+\.\d+)/);
  if (v) console.log(`  vendored supabase-js ${v[1]}`);
}
