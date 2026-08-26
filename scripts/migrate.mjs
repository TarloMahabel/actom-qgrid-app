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
    execFileSync("supabase", ["db", "push", "--db-url", url, "--include-all"],
      { stdio: "inherit" });
    console.log(`${d.code}: migrations applied`);
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
