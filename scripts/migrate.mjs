/**
 * Applies migrations to one division or to all of them.
 *
 *   node scripts/migrate.mjs --division MVS
 *   node scripts/migrate.mjs --all --status live,pilot
 *   node scripts/migrate.mjs --all --dry-run
 *
 * Connection strings come from the environment as DB_URL_<CODE>.
 * The ledger lives in supabase_migrations.schema_migrations, so a
 * migration applied twice is a no-op and drift is visible.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const args = process.argv.slice(2);
const has = f => args.includes(f);
const val = f => { const i = args.indexOf(f); return i > -1 ? args[i + 1] : null; };

const registry = JSON.parse(readFileSync("divisions/registry.json", "utf8"));
const wanted = (val("--status") || "pilot,live").split(",");

let targets = registry.divisions;
if (val("--division")) targets = targets.filter(d => d.code === val("--division"));
else if (has("--all")) targets = targets.filter(d => wanted.includes(d.status));
else { console.error("Specify --division <CODE> or --all"); process.exit(1); }

if (!targets.length) { console.error("No matching divisions."); process.exit(1); }

const failures = [];
for (const d of targets) {
  const url = process.env[`DB_URL_${d.code}`];
  if (!url) { failures.push(`${d.code}: DB_URL_${d.code} not set`); continue; }

  console.log(`\n=== ${d.code} — ${d.name} (${d.status}) ===`);
  if (has("--dry-run")) { console.log("dry run: would push migrations"); continue; }

  try {
    // Numbered files under db/, applied in order, with a ledger table so a
    // re-run is a no-op. The Supabase CLI wants its own directory layout;
    // keeping the SQL in db/ and applying it with psql means one obvious
    // place to look and one obvious order to read it in.
    /* Locked down as it is created. A signed-in user who could delete a row
       from this table would make the next run re-apply that migration against
       a database that already has it. Migration 005 does the same thing, but
       this runs first on a fresh division. */
    execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", `
      create table if not exists public.qgrid_migrations (
        filename text primary key, applied_at timestamptz not null default now());
      alter table public.qgrid_migrations enable row level security;
      revoke all on public.qgrid_migrations from anon, authenticated;`],
      { stdio: "inherit" });

    const files = readdirSync("db").filter(f => /^\d{3}-.*\.sql$/.test(f)).sort();
    for (const f of files) {
      const done = execFileSync("psql", [url, "-tAc",
        `select 1 from public.qgrid_migrations where filename = '${f}'`],
        { encoding: "utf8" }).trim();
      if (done === "1") { console.log(`  ${f} already applied`); continue; }
      console.log(`  applying ${f}`);
      execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-f", `db/${f}`], { stdio: "inherit" });
      execFileSync("psql", [url, "-q", "-c",
        `insert into public.qgrid_migrations (filename) values ('${f}')`], { stdio: "inherit" });
    }
    console.log(`${d.code}: up to date (${files.length} migration file(s))`);
  } catch (e) {
    failures.push(`${d.code}: ${e.message}`);
    // Keep going. One division failing must not leave the rest unmigrated
    // and unreported - the summary below is what gets acted on.
  }
}

if (failures.length) {
  console.error("\nFailed:\n" + failures.map(f => "  - " + f).join("\n"));
  process.exit(1);
}
console.log(`\nAll ${targets.length} division database(s) up to date.`);
