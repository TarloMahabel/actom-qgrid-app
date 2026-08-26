/* Static checks that do not need a browser. These catch the mistakes
   that are cheap to make and expensive to discover in production. */
const { suite, REPO } = require('./test/harness');
const fs = require('fs');
const path = require('path');

const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const rel = path.posix.join(dir, e.name);
    e.isDirectory() ? walk(rel, out) : out.push(rel);
  }
  return out;
};

const s = suite('test-security — static checks');
const files = walk('.');
const code = files.filter(f => /\.(js|html|css|toml|json|sql|md|sh)$/.test(f)
                          && !f.includes('vendor/') && !f.includes('/db/'));

s.group('secrets');
let leaked = [];
for (const f of code) {
  const body = read(f);
  // A service_role key is a JWT whose payload names the role. Decode rather
  // than pattern-match on surrounding text: a pasted key has no giveaway.
  for (const tok of body.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g) || []) {
    const payload = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    let claims = '';
    try { claims = Buffer.from(payload, 'base64').toString('utf8'); } catch {}
    if (claims.includes('service_role')) leaked.push(f);
  }
}
s.check('no service_role key anywhere in the tree', leaked.length === 0, leaked.join(', '));
/* A local config.js is normal and expected — it is how anyone runs the app
   on their machine. The thing that must never happen is it being TRACKED,
   because it names one division's project and every division deploys the
   same commit. Asserting the file is absent failed for every developer who
   had set the app up locally, which is the wrong signal entirely. */
s.check('gitignore excludes config.js', /apps\/\*\/config\.js/.test(read('.gitignore')));
let tracked = '';
try {
  tracked = require('child_process')
    .execFileSync('git', ['ls-files', 'apps/*/config.js', 'apps/*/_headers'],
      { cwd: REPO, encoding: 'utf8' }).trim();
} catch { tracked = ''; }   // not a git checkout — nothing to assert
s.check('config.js and _headers are not tracked by git', tracked === '', tracked);

s.group('no code loaded from the internet');
const html = read('apps/inspect/index.html');
s.check('no remote script tags', !/<script[^>]+src=["']https?:/.test(html));
s.check('no remote stylesheets', !/<link[^>]+href=["']https?:/.test(html));
s.check('supabase client is vendored',
  fs.existsSync(path.join(REPO, 'apps/inspect/vendor/supabase.js')));
// Scope this to shipped app code. Scanning the whole tree would match
// this very assertion and report a leak that does not exist.
const shipped = code.filter(f => f.startsWith('apps/') || f.startsWith('shared/'));
const cdnRefs = shipped.filter(f => /esm\.sh|unpkg\.com|cdn\.jsdelivr|skypack/.test(read(f)));
s.check('no CDN import in shipped app code', cdnRefs.length === 0, cdnRefs.join(', '));

s.group('content security policy');
const toml = read('netlify.toml');
for (const rule of ["default-src 'none'", "script-src 'self'", "frame-ancestors 'none'",
                    "object-src 'none'", "base-uri 'none'"]) {
  s.check(`CSP sets ${rule}`, toml.includes(rule));
}
s.check('CSP has no unsafe-eval', !toml.includes('unsafe-eval'));
s.check('connect-src is generated per division, not wildcarded',
  read('scripts/gen-config.mjs').includes('connect-src'));

s.group('shared assets are in step');
const shared = { 'tokens.css': 'apps/inspect/tokens.css', 'inspect.css': 'apps/inspect/styles.css',
  'supabase.js': 'apps/inspect/supabase.js', 'logo.js': 'apps/inspect/logo.js',
  'changelog.js': 'apps/inspect/changelog.js', 'vendor-supabase.js': 'apps/inspect/vendor/supabase.js' };
for (const [src, dest] of Object.entries(shared)) {
  s.check(`${dest} matches shared/${src}`, read('shared/' + src) === read(dest),
    'run ./shared/sync.sh');
}

s.group('database controls are present in the migrations');
const sql = read('db/001-init-inspections.sql') + read('db/002-app-wiring.sql');
for (const [label, needle] of [
  ['signed inspections are immutable', 'INS_SIGNED'],
  ['overdue equipment is blocked', 'EQUIP_BLOCKED'],
  ['competency is checked at signature', 'COMPETENCY'],
  ['templates cannot be self-published', 'PUBLISH_SELF'],
  ['audit trail cannot be updated or deleted', 'revoke update, delete on audit_trail'],
  ['views respect RLS', 'security_invoker = on']
]) s.check(label, sql.includes(needle));
// Match the DDL itself, not the word anywhere in the file: the migrations
// explain the setting in a comment, and counting those inflated the total
// and made this pass for the wrong reason.
const views = sql.match(/create or replace view\s+(\w+)([^;]*?)\bas\b/gi) || [];
const unguarded = views.filter(v => !/security_invoker\s*=\s*on/i.test(v))
                       .map(v => (v.match(/view\s+(\w+)/i) || [])[1]);
s.check(`all ${views.length} views declare security_invoker`,
  views.length >= 3 && unguarded.length === 0, unguarded.join(', '));

s.done();
