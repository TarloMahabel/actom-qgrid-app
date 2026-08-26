/**
 * Writes config.js at deploy time from Netlify site environment variables.
 * config.js is gitignored, so no division's connection details are ever committed
 * and the same commit deploys to every division unchanged.
 */
import { writeFileSync } from "node:fs";

const need = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DIVISION_CODE", "DIVISION_NAME"];
const missing = need.filter(k => !process.env[k]);
if (missing.length) {
  console.error("Build stopped. Missing site environment variables: " + missing.join(", "));
  console.error("Set them in Netlify under Site configuration > Environment variables.");
  process.exit(1);
}

const cfg = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY,
  division: { code: process.env.DIVISION_CODE, name: process.env.DIVISION_NAME },
  build: {
    commit: (process.env.COMMIT_REF || "local").slice(0, 7),
    deployedAt: new Date().toISOString(),
    context: process.env.CONTEXT || "local"
  }
};

writeFileSync("config.js", `window.QGRID_CONFIG=${JSON.stringify(cfg, null, 2)};\n`);
console.log(`config.js written for ${cfg.division.code} (${cfg.build.context}, ${cfg.build.commit})`);
