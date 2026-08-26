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
 * The LMS commits config.js because it has one backend. QGrid has one per
 * division running the same commit, so the configuration cannot live in
 * the repository. That in turn means the CSP cannot be hardcoded in
 * netlify.toml either: pinning connect-src to one project ref there would
 * break every other division, and a wildcard https://*.supabase.co would
 * let a compromised page talk to any Supabase project in the world.
 * Generating both files together keeps the tight policy and the
 * per-division deployment.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";

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

const APP = "apps/inspect";
writeFileSync(`${APP}/config.js`,
`/* Generated at deploy time by scripts/gen-config.mjs. Do not edit, and do
   not commit: the next build overwrites it, and each division needs its
   own. The anon key below is public by design - RLS is the control. */
window.QGRID_CONFIG = ${JSON.stringify(cfg, null, 2)};
`);

// Realtime needs the wss origin as well as https, or the subscription
// silently fails and the app looks stale rather than broken.
writeFileSync(`${APP}/_headers`,
`# Generated at deploy time. connect-src is pinned to this division's
# Supabase project only.
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${url} ${wss}; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; upgrade-insecure-requests
`);

console.log(`config.js + _headers written for ${cfg.division.code} ` +
            `(${cfg.build.context}, ${cfg.build.commit})`);
console.log(`  connect-src pinned to ${url}`);

// A stale vendored client is a silent problem: the app works, and then one
// day a Supabase change breaks it and nobody remembers the file is pinned.
const vendored = `${APP}/vendor/supabase.js`;
if (existsSync(vendored)) {
  const v = readFileSync(vendored, "utf8").match(/supabase-js\/(\d+\.\d+\.\d+)/);
  if (v) console.log(`  vendored supabase-js ${v[1]}`);
}
