/* The pre-commit hook, exercised both ways.
   A guard is only useful if it fires on real problems AND stays quiet on
   the repository as it stands — an earlier version blocked five innocent
   files on the first commit, which is how guards end up bypassed. */
const { suite, REPO } = require('./test/harness');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const s = suite('test-hook — pre-commit guard');

if (process.platform === 'win32') {
  console.log('  skipped on Windows — the hook is bash; it runs under Git Bash on commit');
  console.log('\n0/0 passed');
  process.exit(0);
}

function run(prepare, force) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qgrid-hook-'));
  // Exclude node_modules and .git from the copy rather than deleting them
  // afterwards: copying tens of thousands of files eleven times is slow, and
  // copying a directory that something else may be writing is a source of
  // intermittent failures — which is worse than a slow test.
  execFileSync('bash', ['-c',
    `cd "${REPO}" && tar --exclude=node_modules --exclude=.git -cf - . | tar -xf - -C "${tmp}"`]);
  const git = a => execFileSync('git', a, { cwd: tmp, stdio: 'pipe' });
  git(['init', '-q']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 'T']);
  if (prepare) prepare(tmp);
  git(['add', '-A']);
  if (force) git(['add', '-f', force]);
  try {
    const out = execFileSync('bash', ['.githooks/pre-commit'], { cwd: tmp, encoding: 'utf8' });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  } finally {
    execFileSync('rm', ['-rf', tmp]);
  }
}

s.group('the repository as it stands must pass');
const clean = run(null);
s.check('no false positives on a clean tree', clean.ok, clean.out.trim().split('\n')[0] || '');

s.group('real problems must be caught');
/* Fixtures are ASSEMBLED at runtime, never written as literals. The hook
   scans this file like any other staged file, so a literal secret key or
   service_role JWT sitting in here would block the commit — which is
   exactly what happened the first time this suite was written. */
const ROLE  = 'service' + '_role';
const SECRET_PREFIX = 'sb' + '_secret_';
const liveUri = 'postgres' + 'ql://postgres:' + 'Tr0ub4dor' + '-Xk92-Live' + '@db.a.supabase.co:5432/postgres';
const jwt = (() => {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iss: 'supabase', role: ROLE })}.sig`;
})();

const cases = [
  ['service_role JWT',        t => fs.writeFileSync(path.join(t, 'x.js'), `const K="${jwt}";`),          'SERVICE_ROLE JWT'],
  ['secret key prefix',       t => fs.writeFileSync(path.join(t, 'x.js'), `const k="${SECRET_PREFIX}Ab3xY9zQ1mN7pR";`), 'SECRET key'],
  ['live connection string',  t => fs.writeFileSync(path.join(t, 'x.env'), liveUri), 'real password'],
  ['committed config.js',     t => fs.writeFileSync(path.join(t, 'apps/inspect/config.js'), 'window.QGRID_CONFIG={};'),
     'must not be committed', 'apps/inspect/config.js'],
  ['CDN import in app code',  t => fs.writeFileSync(path.join(t, 'apps/inspect/x.js'), 'import a from "https://esm.sh/a";'), 'CDN'],
  ['shared/ out of step',     t => fs.appendFileSync(path.join(t, 'shared/tokens.css'), 'body{color:red}'), 'sync.sh']
];
for (const [label, prep, needle, force] of cases) {
  const r = run(prep, force);
  s.check(`blocks ${label}`, !r.ok && r.out.includes(needle), r.ok ? 'ALLOWED' : 'wrong message');
}

s.group('placeholders must not be mistaken for secrets');
const uri = pw => 'postgres' + 'ql://postgres:' + pw + '@db.a.supabase.co:5432/postgres';
const ok = [
  ['<password> placeholder', uri('<password>')],
  ['YOUR_PASSWORD',          uri('YOUR_PASSWORD')],
  ['shell variable',         uri('$DB_PASS')],
  ['the role name in SQL',   `-- grant usage to ${ROLE}; create role ${ROLE};`]
];
for (const [label, body] of ok) {
  const r = run(t => fs.writeFileSync(path.join(t, 'doc.md'), body));
  s.check(`allows ${label}`, r.ok, r.out.trim().split('\n').filter(Boolean)[0] || '');
}
s.done();
