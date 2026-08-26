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
const publish = (toml.match(/publish\s*=\s*"([^"]+)"/) || [])[1];
s.check('publish points at the app directory', publish === 'apps/inspect', `got "${publish}"`);
s.check(`${publish}/index.html exists`, has(path.posix.join(publish || '.', 'index.html')));
s.check('no base directory set — it changes where config.js lands',
  !/^\s*base\s*=/m.test(toml));
s.check('build command is relative to the root', /command\s*=\s*"node scripts\//.test(toml));
s.check('SPA fallback redirect present', /to\s*=\s*"\/index\.html"/.test(toml));

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

const hdr = fs.readFileSync(hdrPath, 'utf8');
s.check('_headers pins connect-src to the project',
  hdr.includes('connect-src \'self\' https://abcdefghij.supabase.co'));
s.check('_headers allows the realtime websocket',
  hdr.includes('wss://abcdefghij.supabase.co'));
s.check('_headers does not wildcard supabase.co', !hdr.includes('*.supabase.co'));

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
