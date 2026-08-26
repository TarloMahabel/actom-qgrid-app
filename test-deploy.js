/* Deploy configuration. Every check here corresponds to a way the first
   deploy actually failed or nearly failed. */
const { suite, REPO } = require('./test/harness');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const s = suite('test-deploy — Netlify configuration');
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const has = p => fs.existsSync(path.join(REPO, p));

s.group('netlify.toml is where Netlify looks for it');
// The first deploy 404'd because this file sat in apps/inspect/ and Netlify
// reads the repository root unless a base directory is set in the site UI.
s.check('netlify.toml is at the repository root', has('netlify.toml'));
s.check('no second netlify.toml to be read instead',
  !has('apps/inspect/netlify.toml'));

const toml = has('netlify.toml') ? read('netlify.toml') : '';
/* TOML comments start with #. Strip them: this file documents the broken
   multi-line CSP it used to carry, and the assertion below would match that
   quoted example rather than a live setting. */
const tomlCode = toml.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
const publish = (toml.match(/publish\s*=\s*"([^"]+)"/) || [])[1];
s.check('publish points at the app directory', publish === 'apps/inspect', `got "${publish}"`);
s.check(`${publish}/index.html exists`, has(path.posix.join(publish || '.', 'index.html')));
s.check('no base directory set — it changes where config.js lands',
  !/^\s*base\s*=/m.test(tomlCode));
s.check('build command is relative to the root', /command\s*=\s*"node scripts\//.test(tomlCode));
s.check('SPA fallback redirect present', /to\s*=\s*"\/index\.html"/.test(tomlCode));

s.group('the build produces what the site needs');
const env = {
  ...process.env,
  SUPABASE_URL: 'https://abcdefghij.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon',
  DIVISION_CODE: 'TST',
  DIVISION_NAME: 'Test Division',
  CONTEXT: 'production',
  COMMIT_REF: 'deadbeefcafe'
};
const cfgPath = path.join(REPO, 'apps/inspect/config.js');
const hdrPath = path.join(REPO, 'apps/inspect/_headers');
const existed = { cfg: fs.existsSync(cfgPath), hdr: fs.existsSync(hdrPath) };
const saved = { cfg: existed.cfg && fs.readFileSync(cfgPath), hdr: existed.hdr && fs.readFileSync(hdrPath) };

// Run it from inside the app directory too: that is what happens if anyone
// ever sets a base directory in the UI, and it used to write the config
// one level too deep and leave the site unconfigured.
for (const cwd of [REPO, path.join(REPO, 'apps/inspect')]) {
  const script = path.relative(cwd, path.join(REPO, 'scripts/gen-config.mjs'));
  let ok = true;
  try { execFileSync(process.execPath, [script], { cwd, env, stdio: 'pipe' }); }
  catch (e) { ok = false; }
  const where = cwd === REPO ? 'repo root' : 'app directory';
  s.check(`build succeeds from the ${where}`, ok);
  s.check(`config.js lands in apps/inspect (from the ${where})`, fs.existsSync(cfgPath));
  s.check(`nothing written one level too deep (from the ${where})`,
    !fs.existsSync(path.join(REPO, 'apps/inspect/apps')));
}

const cfg = fs.readFileSync(cfgPath, 'utf8');
s.check('config.js sets QGRID_CONFIG', cfg.includes('window.QGRID_CONFIG'));
s.check('config.js carries the division', cfg.includes('"TST"'));
s.check('context comes from Netlify, so the dev sign-in stays hidden',
  cfg.includes('"context": "production"'));

s.group('the Content-Security-Policy');
/* Every check here is a way the CSP actually broke the site. The policy was
   written as a multi-line TOML string in netlify.toml; an HTTP header cannot
   contain a newline, so it collapsed to roughly "default-src 'none'", blocked
   every script, and — because netlify.toml takes precedence over _headers —
   overrode the correct generated policy. The app showed a splash screen that
   never advanced, with only a manifest warning in the console. */
s.check('netlify.toml defines NO CSP — it would override the generated one',
  !/^\s*Content-Security-Policy/m.test(tomlCode));
s.check('netlify.toml has no multi-line header values at all',
  !/=\s*\"\"\"/.test(tomlCode));

const hdr = fs.readFileSync(hdrPath, 'utf8');
const cspLines = hdr.split('\n').filter(l => /^\s*Content-Security-Policy/.test(l));
s.check('_headers defines exactly one CSP', cspLines.length === 1, `${cspLines.length} found`);
const csp = cspLines[0] ? cspLines[0].split(':').slice(1).join(':').trim() : '';
s.check('the CSP value is on a single line', !/[\r\n]/.test(csp));
s.check('the CSP is not truncated to default-src only', csp.split(';').length >= 10,
  `${csp.split(';').length} directives`);

/* With default-src 'none', anything not named explicitly is blocked. Each of
   these was, or would have been, a silent failure. */
for (const d of ["script-src 'self'", "style-src 'self'", "img-src 'self'",
                 "manifest-src 'self'", "font-src 'self'", "worker-src 'self'"]) {
  s.check(`CSP names ${d}`, csp.includes(d));
}
s.check('CSP pins connect-src to the project',
  csp.includes("connect-src 'self' https://abcdefghij.supabase.co"));
s.check('CSP allows the realtime websocket', csp.includes('wss://abcdefghij.supabase.co'));
s.check('CSP does not wildcard supabase.co', !csp.includes('*.supabase.co'));
s.check('CSP has no unsafe-eval', !csp.includes('unsafe-eval'));

s.group('the build refuses to produce a half-configured site');
for (const missing of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'DIVISION_CODE', 'DIVISION_NAME']) {
  const partial = { ...env }; delete partial[missing];
  let failed = false;
  try { execFileSync(process.execPath, ['scripts/gen-config.mjs'], { cwd: REPO, env: partial, stdio: 'pipe' }); }
  catch { failed = true; }
  s.check(`build fails when ${missing} is unset`, failed);
}
let rejected = false;
try {
  execFileSync(process.execPath, ['scripts/gen-config.mjs'],
    { cwd: REPO, env: { ...env, SUPABASE_URL: 'https://abcdefghij.supabase.co/rest/v1' }, stdio: 'pipe' });
} catch { rejected = true; }
s.check('build rejects a URL with a path on it', rejected);

// Leave the tree as it was: config.js is gitignored but a stray one would
// confuse the next local run.
if (existed.cfg) fs.writeFileSync(cfgPath, saved.cfg); else fs.unlinkSync(cfgPath);
if (existed.hdr) fs.writeFileSync(hdrPath, saved.hdr); else fs.unlinkSync(hdrPath);

s.done();
