/**
 * Checks a QGrid Supabase project from the outside, using only the anon key.
 *
 *   node scripts/check-connection.mjs
 *   node scripts/check-connection.mjs --url https://xxx.supabase.co --key eyJ...
 *
 * Reads SUPABASE_URL and SUPABASE_ANON_KEY from the environment, or from
 * config.js if that exists. Run this before touching the browser: it separates
 * "the database is wrong" from "the front end is wrong", which otherwise get
 * debugged together and take three times as long.
 */
import { readFileSync, existsSync } from "node:fs";

const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };

let url = arg("--url") || process.env.SUPABASE_URL;
let key = arg("--key") || process.env.SUPABASE_ANON_KEY;

// Fall back to the generated config.js so a local dev setup needs no arguments.
if ((!url || !key) && existsSync("apps/inspect/config.js")) {
  const src = readFileSync("apps/inspect/config.js", "utf8");
  const m = src.match(/window\.QGRID_CONFIG\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (m) { try { const c = JSON.parse(m[1]); url ||= c.url; key ||= c.key; } catch {} }
}
if (!url || !key) {
  console.error("No project details. Pass --url and --key, or create config.js first.");
  process.exit(1);
}

const H = { apikey: key, Authorization: `Bearer ${key}` };
let pass = 0, fail = 0, warn = 0;
const ok   = (m, d = "") => { pass++; console.log(`  ok    ${m}${d ? " — " + d : ""}`); };
const bad  = (m, d = "") => { fail++; console.log(`  FAIL  ${m}${d ? " — " + d : ""}`); };
const note = (m, d = "") => { warn++; console.log(`  warn  ${m}${d ? " — " + d : ""}`); };

console.log(`\nChecking ${url}\n`);

/* 1. Is the project reachable and is the key valid? */
console.log("— reachability —");
let spec;
try {
  const r = await fetch(`${url}/rest/v1/`, { headers: H });
  if (r.status === 401) { bad("anon key rejected", "check you copied the anon key, not the service_role or a JWT secret"); process.exit(1); }
  if (!r.ok) { bad(`REST endpoint returned ${r.status}`); process.exit(1); }
  spec = await r.json();
  ok("project reachable and anon key accepted");
} catch (e) {
  bad("cannot reach the project", e.message);
  console.log("\n  Check the URL is the Project URL from Settings > API, with no trailing slash.");
  process.exit(1);
}

/* 2. Did the schema actually land? */
console.log("\n— schema —");
const tables = Object.keys(spec.definitions || spec.components?.schemas || {});
const expect = ["inspections","inspection_results","inspection_templates","template_revisions",
                "inspection_requirements","failed_checks","profiles","division_profile",
                "manufacturing_stages","product_families","defect_codes","equipment",
                "projects","works_orders","audit_trail"];
const missing = expect.filter(t => !tables.includes(t));
missing.length ? bad(`${missing.length} table(s) missing`, missing.join(", "))
               : ok(`all ${expect.length} expected tables exposed`);

const views = ["v_dashboard","v_stage_yield","v_open_work"].filter(v => tables.includes(v));
views.length === 3 ? ok("all 3 dashboard views exposed")
                   : note(`${views.length} of 3 views exposed`, "the app falls back but the dashboard will be thin");

const paths = Object.keys(spec.paths || {});
for (const fn of ["submit_inspection","publish_template_revision","generate_inspections"]) {
  paths.includes(`/rpc/${fn}`) ? ok(`rpc ${fn} available`) : bad(`rpc ${fn} missing`, "section 2 of the schema script did not run");
}

/* 3. RLS. An anonymous caller must get nothing back.
      This is the single most important check here: if it returns rows,
      the data is readable by anyone holding the anon key, which is public. */
console.log("\n— row level security —");
for (const t of ["inspections","profiles","audit_trail"]) {
  try {
    const r = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: H });
    const body = await r.json();
    if (r.status === 401 || r.status === 403) ok(`${t} refuses anonymous reads`);
    else if (Array.isArray(body) && body.length === 0) ok(`${t} returns nothing to an anonymous caller`);
    else if (Array.isArray(body)) bad(`${t} LEAKS ${body.length} row(s) to anonymous callers`, "stop and fix RLS before loading real data");
    else ok(`${t} refuses anonymous reads`, body.message || "");
  } catch (e) { note(`${t} check inconclusive`, e.message); }
}

/* 4. Reference data. Readable only when signed in, so an empty result here is
      expected and correct — we check row counts through the service role or the
      app itself, not from an anonymous context. */
console.log("\n— authentication —");
try {
  const r = await fetch(`${url}/auth/v1/settings`, { headers: H });
  const s = await r.json();
  const ext = s.external || {};
  const on = Object.entries(ext).filter(([, v]) => v === true).map(([k]) => k);
  if (ext.azure) ok("Azure (Microsoft Entra) provider enabled");
  else bad("Azure provider NOT enabled", "Authentication > Providers > Azure in the Supabase dashboard");
  if (on.length) ok("providers enabled", on.join(", "));
  if (s.disable_signup) note("sign-ups are disabled", "new ACTOM users will not get a profile row");
} catch (e) { note("could not read auth settings", e.message); }

console.log(`\n${pass} passed, ${fail} failed, ${warn} warning(s)`);
if (fail) {
  console.log("\nFix the failures above before wiring the front end. A front end pointed at a\n" +
              "half-configured project produces error messages that look like front-end bugs.");
}
process.exit(fail ? 1 : 0);
