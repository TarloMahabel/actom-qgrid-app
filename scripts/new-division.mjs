/**
 * Stands up a new division end to end.
 *
 *   node scripts/new-division.mjs --code DTX --name "ACTOM Distribution Transformers"
 *
 * Creates the Supabase project, applies every migration, loads the
 * reference seed, creates the Netlify site, sets its environment
 * variables and triggers the first deploy.
 *
 * Requires: SUPABASE_ACCESS_TOKEN, SUPABASE_ORG_ID, NETLIFY_AUTH_TOKEN,
 *           DB_PASSWORD_NEW, GITHUB_REPO (owner/name).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const val = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const code = (val("--code") || "").toUpperCase();
const name = val("--name");
const region = val("--region") || "eu-west-1";
if (!code || !name) { console.error('Usage: --code DTX --name "Division name"'); process.exit(1); }

const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} -> ${r.status} ${await r.text()}`);
  return r.json();
};

// 1. Supabase project
console.log(`Creating Supabase project for ${code}...`);
const project = await api("https://api.supabase.com/v1/projects", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: `actom-qgrid-${code.toLowerCase()}`,
    organization_id: process.env.SUPABASE_ORG_ID,
    region,
    db_pass: process.env.DB_PASSWORD_NEW,
    plan: "pro"
  })
});
const ref = project.id;
const dbUrl = `postgresql://postgres:${process.env.DB_PASSWORD_NEW}@db.${ref}.supabase.co:5432/postgres`;
console.log(`  project ref ${ref}`);

// Provisioning is not instant. Wait for the database to accept connections.
process.stdout.write("  waiting for the database");
for (let i = 0; i < 40; i++) {
  try { execFileSync("psql", [dbUrl, "-c", "select 1"], { stdio: "ignore" }); break; }
  catch { process.stdout.write("."); await new Promise(r => setTimeout(r, 15000)); }
}
console.log("");

// 2. Schema and seed
console.log("Applying migrations...");
execFileSync("supabase", ["db", "push", "--db-url", dbUrl, "--include-all"], { stdio: "inherit" });
console.log("Loading reference seed...");
execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", "db/seed.sql"], { stdio: "inherit" });
execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1",
  "-c", `insert into division_profile (code,name) values ('${code}', $$${name}$$)
         on conflict (id) do update set code=excluded.code, name=excluded.name;`], { stdio: "inherit" });

// 3. Netlify site
console.log("Creating Netlify site...");
const site = await api("https://api.netlify.com/api/v1/sites", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: `actom-qgrid-${code.toLowerCase()}`,
    repo: { provider: "github", repo: process.env.GITHUB_REPO, branch: "production",
            cmd: "node scripts/gen-config.mjs", dir: "." }
  })
});
const keys = await api(`https://api.supabase.com/v1/projects/${ref}/api-keys`,
  { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } });
const anon = keys.find(k => k.name === "anon").api_key;

await api(`https://api.netlify.com/api/v1/accounts/${site.account_slug}/env`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.NETLIFY_AUTH_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify([
    { key: "SUPABASE_URL",      values: [{ value: `https://${ref}.supabase.co`, context: "all" }], scopes: ["builds"] },
    { key: "SUPABASE_ANON_KEY", values: [{ value: anon, context: "all" }], scopes: ["builds"] },
    { key: "DIVISION_CODE",     values: [{ value: code, context: "all" }], scopes: ["builds"] },
    { key: "DIVISION_NAME",     values: [{ value: name, context: "all" }], scopes: ["builds"] }
  ])
});

// 4. Registry
const reg = JSON.parse(readFileSync("divisions/registry.json", "utf8"));
const row = reg.divisions.find(d => d.code === code);
const entry = { code, name, supabase_project_ref: ref,
  netlify_site_name: site.name, domain: `qgrid-${code.toLowerCase()}.actom.co.za`,
  status: "staging", go_live: null, seed: "db/seed-division-template.sql" };
if (row) Object.assign(row, entry); else reg.divisions.push(entry);
writeFileSync("divisions/registry.json", JSON.stringify(reg, null, 2) + "\n");

console.log(`
Done.
  Supabase  ${ref}
  Netlify   https://${site.name}.netlify.app

Still to do by hand:
  1. Add https://${site.name}.netlify.app/auth/callback as a redirect URI on the
     ACTOM Entra app registration, and enable the OIDC provider on the new project.
  2. Add DB_URL_${code} to the GitHub Actions secrets so migrations reach it.
  3. Point ${entry.domain} at the Netlify site.
  4. Load the division's stages, families, defect codes and templates.
  5. Commit the updated registry.
`);
