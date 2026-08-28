/* Version and changelog discipline.

   A quality system's own change history is part of what an auditor asks
   for, and "we forgot to write it down" is not an answer. These checks
   make an unversioned change fail the build rather than rely on memory. */
const { suite, REPO } = require('./test/harness');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const s = suite('test-version — version and changelog');
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');

const ctx = { window: {} };
require('vm').runInNewContext(read('shared/changelog.js'), ctx);
const VERSION = ctx.window.APP_VERSION;
const LOG = ctx.window.CHANGELOG || [];

s.group('the version itself');
s.check('APP_VERSION is set', !!VERSION);
s.check('it is semantic versioning', /^\d+\.\d+\.\d+$/.test(VERSION || ''), VERSION);
s.check('the changelog is not empty', LOG.length > 0);
s.check('the newest entry matches APP_VERSION', LOG[0] && LOG[0].v === VERSION,
  `APP_VERSION ${VERSION}, newest entry ${LOG[0] && LOG[0].v}`);

s.group('every entry is usable');
const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
let ordered = true, dated = true, described = true, jargon = [];
const seen = new Set();
for (const [i, c] of LOG.entries()) {
  if (!/^\d+\.\d+\.\d+$/.test(c.v || '')) ordered = false;
  if (i && cmp(LOG[i - 1].v, c.v) <= 0) ordered = false;         // newest first, strictly
  if (seen.has(c.v)) ordered = false;
  seen.add(c.v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.d || '')) dated = false;
  if (!c.t || !Array.isArray(c.items) || !c.items.length) described = false;
  /* Notes are read by inspectors and auditors, not developers. A note that
     names an implementation detail has not been translated. */
  for (const item of c.items || []) {
    if (/\bRLS\b|row level security|jsonb|regex|refactor|\bAPI\b|null pointer|stack trace/i.test(item)) {
      jargon.push(`${c.v}: ${item.slice(0, 60)}…`);
    }
  }
}
s.check('versions are unique and newest first', ordered);
s.check('every entry has an ISO date', dated);
s.check('every entry has a title and at least one note', described);
s.check('notes avoid developer jargon', jargon.length === 0, jargon.join(' | '));

s.group('the version is visible in the app');
const app = read('apps/inspect/app.js');
s.check('shown in the sidebar footer', /APP_VERSION/.test(app) && /buildTag/.test(app));
s.check("What's new lists every release", app.includes('window.CHANGELOG'));
s.check("unread releases are flagged", app.includes('seenVersion'));

s.group('the working tree is versioned');
/* If the code has changed since the commit that last touched the changelog,
   the change is unversioned. Skipped outside a git checkout. */
let inGit = true;
try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: REPO, stdio: 'pipe' }); }
catch { inGit = false; }

if (!inGit) {
  console.log('  skip  not a git checkout — nothing to compare');
} else {
  const changed = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').map(l => l.slice(3).trim()).filter(Boolean);
  const watched = changed.filter(f =>
    (f.startsWith('apps/') || f.startsWith('shared/') || f.startsWith('db/')) &&
    !f.includes('/config.js') && !f.includes('/_headers') && !f.endsWith('schema-complete.sql'));
  const logTouched = changed.some(f => f.endsWith('shared/changelog.js') ||
                                       f.endsWith('apps/inspect/changelog.js'));
  if (!watched.length) {
    s.check('no unversioned changes in the working tree', true);
  } else {
    s.check('changes to apps/, shared/ or db/ come with a changelog entry',
      logTouched, 'changed without a changelog entry: ' + watched.slice(0, 6).join(', '));
  }
}

s.done();
