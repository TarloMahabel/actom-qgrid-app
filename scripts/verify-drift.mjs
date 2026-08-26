/**
 * Compares the migration ledger across every division and reports drift.
 * Run nightly. Divergent schemas are the single biggest risk in a
 * one-database-per-division model, so it is worth checking on a schedule
 * rather than discovering it during a release.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const registry = JSON.parse(readFileSync("divisions/registry.json", "utf8"));
const live = registry.divisions.filter(d => ["pilot", "live"].includes(d.status));
const seen = {};

for (const d of live) {
  const url = process.env[`DB_URL_${d.code}`];
  if (!url) { console.log(`${d.code}: skipped, no connection string`); continue; }
  const out = execFileSync("psql", [url, "-tAc",
    "select version from supabase_migrations.schema_migrations order by version"],
    { encoding: "utf8" });
  seen[d.code] = out.trim().split("\n").filter(Boolean);
}

const codes = Object.keys(seen);
if (codes.length < 2) { console.log("Fewer than two divisions live - nothing to compare."); process.exit(0); }

const baseline = seen[codes[0]];
let drift = false;
for (const c of codes.slice(1)) {
  const missing = baseline.filter(v => !seen[c].includes(v));
  const extra = seen[c].filter(v => !baseline.includes(v));
  if (missing.length || extra.length) {
    drift = true;
    console.log(`\nDRIFT ${c} vs ${codes[0]}`);
    if (missing.length) console.log("  behind by: " + missing.join(", "));
    if (extra.length) console.log("  ahead by:  " + extra.join(", "));
  }
}
if (!drift) console.log(`All ${codes.length} divisions on the same ${baseline.length} migrations.`);
process.exit(drift ? 1 : 0);
