/**
 * Import the customer complaint workbook.
 *
 *   1. In Excel, open Module_5_Customer_Quality_Management.xlsx
 *   2. Select the DATA sheet, File > Save As > CSV UTF-8
 *   3. node scripts/import-complaints.mjs path/to/DATA.csv
 *
 * Writes db/import/complaints.sql and prints a report of every row it
 * changed or refused. Paste the SQL into the Supabase editor.
 *
 * WHY IT PRINTS A REPORT RATHER THAN JUST CLEANING
 *
 * The workbook has been maintained by hand for ten years and has drifted:
 * four spellings of one complaint type including a typo, two of Minisub,
 * two of Closed, and twenty-nine rows dated 1900 because a formula failed.
 * An import that silently tidies all that produces a register nobody can
 * reconcile against the file it came from, and the first question asked of
 * it will be "why is this number different from the spreadsheet".
 *
 * So every substitution is listed, every refusal is listed with its reason,
 * and the original text is kept in legacy_type, legacy_section and
 * legacy_defect beside the mapped values. A mapping that turns out to be
 * wrong can then be found and corrected rather than discovered by accident.
 *
 * WHAT IT WILL NOT DO
 *
 * Invent a closing date. 957 rows say Closed and 38 say when. Those 950
 * import with legacy_closed = true, which reads as "closed, date not
 * recorded" and is excluded from time-to-close. See 020 for the argument.
 *
 * Nor will it import a row with no usable call date. Dating a 2016
 * complaint as today would be worse than leaving it in the workbook.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) {
  console.error("Usage: node scripts/import-complaints.mjs path/to/DATA.csv");
  console.error("Export the DATA sheet from the workbook as CSV UTF-8 first.");
  process.exit(1);
}

/* ------------------------------------------------------------------
   RFC 4180 CSV. Written out rather than depending on a library: this
   runs once, on one file, and a dependency added for that is a
   dependency every division carries forever.
   ------------------------------------------------------------------ */
function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}

/* Excel serial dates. Day 1 is 1900-01-01 and Excel believes 1900 was a
   leap year, so the epoch is 1899-12-30. Anything below 40000 is before
   2009 and predates this register — those are formula failures, not
   history, and they are reported rather than imported. */
function excelDate(v) {
  const t = String(v == null ? "" : v).trim();
  if (!t || t.toUpperCase() === "TBC") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const n = Number(t);
  if (Number.isFinite(n) && n > 40000 && n < 60000) {
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  const d = new Date(t);
  if (!isNaN(d) && d.getFullYear() > 2009 && d.getFullYear() < 2040) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

const money = v => {
  const n = Number(String(v == null ? "" : v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const clean = v => {
  const t = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return (!t || t.toUpperCase() === "TBC" || t === "#N/A" || t === "#VALUE!") ? null : t;
};

/* The drift, written down. Left side is what is in the file, right side
   is what 019 and 020 seeded. Anything not here is reported unmapped
   rather than guessed at. */
const SECTION = {
  "minisub": "Minisubs", "minisubs": "Minisubs", "mini sub": "Minisubs",
  "indoor": "Indoor", "outdoor": "Outdoor",
  "aftersales": "Aftersales", "a/sales": "Aftersales", "after sales": "Aftersales",
  "renewable": "Renewable", "wpi": "WPI", "medupi": "Medupi",
  "western region": "Western Region", "western reg": "Western Region",
  "ekurhuleni": "Ekurhuleni", "erkuhuleni": "Ekurhuleni",
  "quoted work": "Quoted Work"
};
const TYPE = {
  "technical / quality": "Technical / Quality",
  "technical/quality": "Technical / Quality",
  "techical / quality": "Technical / Quality",          // the typo
  "technical / quality - electrical": "Technical / Quality — Electrical",
  "technical/quality - electrical": "Technical / Quality — Electrical",
  "technical / quality-electrical": "Technical / Quality — Electrical",
  "technical / quality - mechanical": "Technical / Quality — Mechanical",
  "technical/quality - mechanical": "Technical / Quality — Mechanical",
  "design": "Design", "payment": "Payment", "ehs": "EHS",
  "shortage": "Shortage", "delivery": "Delivery",
  "damage in transit": "Damage in Transit", "transport": "Damage in Transit",
  "lack of response": "Lack of Response",
  "install & commissioning": "Install & Commissioning",
  "installation & commissioning": "Install & Commissioning"
};

const rows = parseCsv(readFileSync(src, "utf8"));
const hdr = rows[0].map(h => String(h).trim());
const col = n => hdr.indexOf(n);
const need = ["CC No", "Customer", "Call Date", "Details", "Status"];
for (const n of need) if (col(n) < 0) {
  console.error(`The CSV has no "${n}" column. Is this the DATA sheet?`);
  process.exit(1);
}

const q = v => v == null ? "null" : "'" + String(v).replace(/'/g, "''") + "'";
const out = [];
const report = { imported: 0, skipped: [], mapped: [], undated: 0, noRef: 0 };
const seen = new Set();

for (const r of rows.slice(1)) {
  const get = n => { const i = col(n); return i < 0 ? null : clean(r[i]); };
  const ref = get("CC No");
  const customer = get("Customer");
  const details = get("Details");
  const called = excelDate(r[col("Call Date")]);

  if (!ref) { report.noRef++; continue; }
  if (seen.has(ref)) { report.skipped.push([ref, "duplicate reference in the file"]); continue; }
  seen.add(ref);
  if (!customer) { report.skipped.push([ref, "no customer"]); continue; }
  if (!details) { report.skipped.push([ref, "nothing recorded about what was reported"]); continue; }
  if (!called) {
    report.skipped.push([ref, `call date unusable (${String(r[col("Call Date")]).slice(0, 20) || "blank"})`]);
    continue;
  }

  const rawSec = get("Section"), rawType = get("Complaint Type");
  const section = rawSec ? (SECTION[rawSec.toLowerCase()] || null) : null;
  const type = rawType ? (TYPE[rawType.toLowerCase()] || null) : null;
  if (rawSec && section && section !== rawSec) report.mapped.push([ref, "section", rawSec, section]);
  if (rawSec && !section) report.mapped.push([ref, "section", rawSec, "UNMAPPED — kept as text"]);
  if (rawType && type && type !== rawType) report.mapped.push([ref, "type", rawType, type]);
  if (rawType && !type) report.mapped.push([ref, "type", rawType, "UNMAPPED — kept as text"]);

  const closed = excelDate(r[col("Closed Date")]);
  const status = (get("Status") || "").toLowerCase();
  const legacyClosed = status.startsWith("closed") && !closed;
  if (legacyClosed) report.undated++;

  out.push(`select import_complaint(${[
    q(ref), q(customer), q(details), q(called),
    q(section || rawSec), q(type || rawType), q(get("Defect Code 1")),
    q(get("CE")), q(get("Site Eng")), q(get("Contract Number")),
    q(excelDate(r[col("Response Date")])), q(closed),
    legacyClosed ? "true" : "false",
    q(get("Correction")),
    money(r[col("Material Cost")]) ?? "null",
    money(r[col("Labour Cost")]) ?? "null"
  ].join(", ")});`);
  report.imported++;
}

mkdirSync(`${ROOT}/db/import`, { recursive: true });
writeFileSync(`${ROOT}/db/import/complaints.sql`,
  `-- Generated by scripts/import-complaints.mjs from ${src}\n` +
  `-- ${report.imported} complaints. Run once; import_complaint() skips a legacy\n` +
  `-- reference that is already present, so a second run is safe.\n\n` +
  out.join("\n") + "\n");

const line = "─".repeat(66);
console.log(`\n${line}\nCUSTOMER COMPLAINT IMPORT\n${line}`);
console.log(`  read          ${rows.length - 1} rows`);
console.log(`  to import     ${report.imported}`);
console.log(`  refused       ${report.skipped.length}`);
console.log(`  no reference  ${report.noRef}`);
console.log(`\n  closed without a date: ${report.undated}`);
console.log(`  These import as "closed, date not recorded". They are NOT counted in`);
console.log(`  time-to-close, because there is no time to count. Inventing a date`);
console.log(`  would put a number into a quality record that nobody can stand behind.`);

if (report.mapped.length) {
  console.log(`\n${line}\nSPELLINGS CORRECTED (${report.mapped.length}) — original kept beside the mapping\n${line}`);
  const grouped = {};
  for (const [ref, field, from, to] of report.mapped) {
    const k = `${field}: ${from}  ->  ${to}`;
    (grouped[k] = grouped[k] || []).push(ref);
  }
  for (const [k, refs] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(refs.length).padStart(4)}  ${k}`);
  }
}

if (report.skipped.length) {
  console.log(`\n${line}\nNOT IMPORTED (${report.skipped.length}) — left in the workbook\n${line}`);
  const why = {};
  for (const [ref, reason] of report.skipped) {
    const k = reason.replace(/\(.*\)/, "(…)");
    (why[k] = why[k] || []).push(ref);
  }
  for (const [k, refs] of Object.entries(why).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(refs.length).padStart(4)}  ${k}`);
    console.log(`        ${refs.slice(0, 8).join(", ")}${refs.length > 8 ? ` … and ${refs.length - 8} more` : ""}`);
  }
}

console.log(`\n${line}`);
console.log(`Written: db/import/complaints.sql`);
console.log(`Read the report above before running it. Every refusal is a row that`);
console.log(`stays in the workbook, and somebody should decide whether it matters.`);
console.log(`${line}\n`);
