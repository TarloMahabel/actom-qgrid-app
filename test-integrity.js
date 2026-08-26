/* Structural integrity. Every check here is a class of fault that has
   actually shipped in this repository, found by an audit rather than by a
   test — which is the definition of a gap. They are cheap and static, so
   they run on every change from now on. */
const { suite, REPO } = require('./test/harness');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const s = suite('test-integrity — structural checks');
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const app = read('apps/inspect/app.js');
const html = read('apps/inspect/index.html');
/* Only the numbered migrations. schema-complete.sql is generated from them,
   so scanning both counted every table twice. */
const sql = fs.readdirSync(path.join(REPO, 'db')).filter(f => /^\d{3}-.*\.sql$/.test(f)).sort()
  .map(f => read('db/' + f)).join('\n');

s.group('the consolidated schema matches the migrations');
/* schema-complete.sql is what a new division is built from. It was
   hand-maintained, stopped at 002 while claiming to be complete, and its
   ledger stamp asserted only 001 and 002 were applied — so a division
   provisioned from it would be two migrations behind AND report itself up
   to date. It is generated now; this proves the checked-in copy is current. */
let stale = false, msg = '';
try { execFileSync(process.execPath, ['scripts/build-schema.mjs', '--check'],
        { cwd: REPO, encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { stale = true; msg = (e.stderr || e.stdout || '').trim(); }
s.check('db/schema-complete.sql is up to date', !stale, msg);

const complete = read('db/schema-complete.sql');
const migrations = fs.readdirSync(path.join(REPO, 'db')).filter(f => /^\d{3}-/.test(f)).sort();
s.check('every migration is stamped in the ledger section',
  migrations.every(f => complete.includes(`('${f}')`)),
  migrations.filter(f => !complete.includes(`('${f}')`)).join(', '));

s.group('handlers and markup agree');
/* Two directions, checked separately, because openModal builds its footer
   from [label, action, variant] triples and those actions never appear as a
   data-act attribute in the source. Trying to infer them by matching array
   literals produced false positives — ["section","info"] is indistinguishable
   from a button pair — so the reverse direction uses a plain text search
   instead of pretending to parse. */
const inMarkup = new Set([
  ...[...app.matchAll(/data-act="([\w-]+)"/g)].map(m => m[1]),
  ...[...html.matchAll(/data-act="([\w-]+)"/g)].map(m => m[1])
]);
const handled = new Set([...app.matchAll(/case "([\w-]+)":/g)].map(m => m[1]));

const unhandled = [...inMarkup].filter(a => !handled.has(a));
s.check('every action in the markup has a handler', unhandled.length === 0, unhandled.join(', '));

/* And nothing is handled that cannot be reached: a case for an action no
   button ever produces is dead code, and usually the residue of a removed
   feature — which is exactly what the removed generate dialog left behind. */
const unreachable = [...handled].filter(a =>
  !inMarkup.has(a) && !new RegExp('"' + a + '"').test(app));
s.check('no handler is unreachable', unreachable.length === 0, unreachable.join(', '));

const selector = (app.match(/closest\("([^"]+)"\)/) || [])[1] || '';
const inSelector = new Set([...selector.matchAll(/\[data-([\w-]+)\]/g)].map(m => m[1]));
const clickAttrs = ['act','go','tab','open-capture','sel','add','move','del','del-sec','tg',
  'cell','toggle-active','dispose','outcome','ref-save','ref-cancel','ref-add','ref-toggle',
  'ref-del','tpl','id'];
const usedAttrs = new Set([...app.matchAll(/data-([\w-]+)=/g)].map(m => m[1]));
const notDelegated = clickAttrs.filter(a => usedAttrs.has(a) && !inSelector.has(a));
s.check('every clickable attribute is in the delegated selector', notDelegated.length === 0,
  notDelegated.join(', '));
const deadSelector = [...inSelector].filter(a => !usedAttrs.has(a));
s.check('the selector lists nothing unused', deadSelector.length === 0, deadSelector.join(', '));

const shellIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const appIds = new Set([...app.matchAll(/id="(\w+)"/g)].map(m => m[1]));
const referenced = new Set([...app.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]));
const orphanIds = [...referenced].filter(i => !shellIds.has(i) && !appIds.has(i));
s.check('no element id is referenced but never created', orphanIds.length === 0, orphanIds.join(', '));

s.group('the app and the database agree');
const rpcsCalled = new Set([...app.matchAll(/\.rpc\("(\w+)"/g)].map(m => m[1]));
const fnsDefined = new Set([...sql.matchAll(/create or replace function (\w+)/g)].map(m => m[1]));
const missingRpc = [...rpcsCalled].filter(f => !fnsDefined.has(f));
s.check('every RPC the app calls exists', missingRpc.length === 0, missingRpc.join(', '));

const rx = (...parts) => new RegExp(parts.join(''), 'g');
for (const fn of [...rpcsCalled].sort()) {
  const callArgs = new Set(
    [...app.matchAll(rx('\\.rpc\\("', fn, '",\\s*\\{([^}]*)\\}'))]
      .flatMap(m => [...m[1].matchAll(/(p_\w+)\s*:/g)].map(x => x[1])));
  /* The LAST definition wins: later migrations replace earlier ones with
     create or replace, so comparing against the first would flag a
     signature that is no longer in force. */
  const defs = [...sql.matchAll(rx('create or replace function ', fn, '\\(([^)]*)\\)'))];
  const sigArgs = new Set(defs.length
    ? [...defs[defs.length - 1][1].matchAll(/(p_\w+)/g)].map(x => x[1]) : []);
  const same = callArgs.size === sigArgs.size && [...callArgs].every(a => sigArgs.has(a));
  s.check(`${fn} is called with the arguments it declares`, same,
    `app=${[...callArgs].sort()} sql=${[...sigArgs].sort()}`);
}

const tablesRead = new Set([...app.matchAll(/\.from\("(\w+)"\)/g)].map(m => m[1]));
const tablesDefined = new Set([
  ...[...sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/g)].map(m => m[1]),
  ...[...sql.matchAll(/create or replace view (\w+)/g)].map(m => m[1])
]);
const missingTables = [...tablesRead].filter(t => !tablesDefined.has(t));
s.check('every table the app reads exists', missingTables.length === 0, missingTables.join(', '));

s.group('row level security covers every table');
/* ref_sequences shipped with RLS never enabled and no policies. Supabase
   grants `authenticated` default privileges on public tables, so any signed-in
   user could UPDATE the counters that issue reference numbers — and rewinding
   one issues a number that already belongs to a signed, locked record. Found
   by an audit, which is why it is asserted here now. */
const tables = [...sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)/g)].map(m => m[1]);
const rlsOn = new Set([...sql.matchAll(/alter table (?:public\.)?(\w+)\s+enable row level security/g)].map(m => m[1]));
const noRls = tables.filter(t => !rlsOn.has(t));
s.check(`all ${tables.length} tables enable row level security`, noRls.length === 0, noRls.join(', '));

const loop = sql.match(/foreach t in array array\[(.*?)\]/s);
const looped = new Set(loop ? [...loop[1].matchAll(/'(\w+)'/g)].map(m => m[1]) : []);
const explicit = new Set([...sql.matchAll(/create policy \w+ on (\w+)/g)].map(m => m[1]));
const closed = new Set([...sql.matchAll(/revoke all on (?:public\.)?(\w+) from/g)].map(m => m[1]));
const unpoliced = tables.filter(t => !looped.has(t) && !explicit.has(t) && !closed.has(t));
s.check('every table has a policy or is closed to clients outright',
  unpoliced.length === 0, unpoliced.join(', '));

s.group('error handling');
/* loadYield and loadAudit are called from render() without await, so a
   throw became an unhandled rejection: nothing on screen and nothing
   useful in the console. Checking the returned `error` covered a Postgres
   error but not a network failure, which throws. */
const noCatch = [];
for (const m of app.matchAll(/async function (\w+)\s*\([^)]*\)\s*\{/g)) {
  const start = m.index + m[0].length;
  let depth = 1, i = start;
  while (i < app.length && depth) { depth += app[i] === '{' ? 1 : app[i] === '}' ? -1 : 0; i++; }
  const body = app.slice(start, i);
  if (body.includes('supabase.') && !body.includes('catch') && !body.includes('withTimeout')) {
    noCatch.push(m[1]);
  }
}
s.check('every async function touching Supabase handles failure', noCatch.length === 0,
  noCatch.join(', '));

const busyStarts = [...app.matchAll(/busy\(true\)/g)].length;
const finallys = [...app.matchAll(/finally\s*\{\s*busy\(false\)/g)].length;
s.check('every busy(true) is released in a finally', busyStarts <= finallys,
  `${busyStarts} starts, ${finallys} releases`);

s.group('no dead code left behind');
for (const token of ['generateSchedule', 'saveGenerate', 'refCard', 'WORK_LISTS', 'tplPick']) {
  s.check(`${token} is gone`, !app.includes(token));
}

s.done();
