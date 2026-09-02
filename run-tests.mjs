/**
 * Runs every suite. Works on Windows, macOS and Linux.
 *
 *   node run-tests.mjs              every suite
 *   node run-tests.mjs --only nav   just test-nav.js
 *   node run-tests.mjs --no-db      skip the PostgreSQL suite
 *
 * run-all-tests.sh does the same thing and is kept for CI, which runs on
 * Linux. `npm test` points HERE, because it was pointing at the shell
 * script and that fails on Windows with "'.' is not recognized" — a
 * confusing first experience for anyone cloning the repo on a work laptop.
 *
 * Each suite runs exactly ONCE. An earlier version of the shell script ran
 * each twice — once to capture the summary line, once to read the exit
 * code — which let a suite print "10/11 passed" while the overall result
 * said ALL SUITES PASSED, because only the second run was trusted.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const only = (() => { const i = args.indexOf("--only"); return i > -1 ? args[i + 1] : null; })();
const noDb = args.includes("--no-db");
const isWindows = process.platform === "win32";

const GROUPS = [
  ["Static checks", ["test-security", "test-hook", "test-deploy", "test-integrity", "test-version"]],
  ["Boot path (real vendored client, no mock)", ["test-boot"]],
  ["Front-end suites (jsdom, real app files, mock backend)",
   ["test-nav", "test-capture", "test-designer", "test-requirements", "test-admin", "test-dashboard"]]
];

let failed = [];
let ran = 0;

function runSuite(name) {
  process.stdout.write(name.padEnd(22));
  const r = spawnSync(process.execPath, [`${name}.js`], { encoding: "utf8" });
  const out = ((r.stdout || "") + (r.error ? r.error.message : "")).trimEnd();
  const lines = out.split("\n");
  console.log(lines[lines.length - 1] || "(no output)");
  ran++;
  if (r.status !== 0) {
    failed.push(name);
    for (const l of lines.filter(l => /^\s+FAIL/.test(l))) console.log("                      " + l.trim());
    if (r.stderr && r.stderr.trim()) console.log("                      " + r.stderr.trim().split("\n")[0]);
  }
}

for (const [label, suites] of GROUPS) {
  const wanted = suites.filter(s => !only || s.includes(only));
  if (!wanted.length) continue;
  console.log(`\n=== ${label} ===`);
  for (const s of wanted) {
    if (!existsSync(`${s}.js`)) { console.log(`${s.padEnd(22)}MISSING`); failed.push(s); continue; }
    runSuite(s);
  }
}

/* The database suite is the one that proves RLS, the triggers and the RPCs.
   The jsdom suites above cannot: a mock backend will happily allow a write
   the real database refuses. Saying so on every run, rather than quietly
   skipping, is the point — those are the controls an ISO auditor tests. */
if (!only && !noDb) {
  console.log("\n=== Database suite (PostgreSQL) ===");
  const hasPsql = spawnSync(isWindows ? "where" : "which", ["psql"], { encoding: "utf8" }).status === 0;
  const hasBash = spawnSync(isWindows ? "where" : "which", ["bash"], { encoding: "utf8" }).status === 0;

  if (hasPsql && hasBash) {
    const r = spawnSync("bash", ["db/test/run-tests.sh"], { stdio: "inherit" });
    if (r.status !== 0) failed.push("db/test");
  } else {
    const missing = [!hasPsql && "psql", !hasBash && "bash"].filter(Boolean).join(" and ");
    console.log(`SKIPPED — ${missing} not on PATH.`);
    console.log("          RLS, the triggers and the RPCs are NOT covered by the suites above.");
    console.log("          Verify them against a real project instead: DEPLOYMENT.md, smoke test.");
  }
}

console.log("");
if (failed.length) {
  console.log(`FAILURES PRESENT — ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`ALL ${ran} SUITE${ran === 1 ? "" : "S"} PASSED`);
