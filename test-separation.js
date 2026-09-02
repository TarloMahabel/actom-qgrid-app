/* =====================================================================
   Separation guard.

   The two apps are only separate if nothing leaks between them. This
   fails the build if the applicant bundle ever picks up reviewer code,
   or either app starts referencing the other's files.

   Run: node test-separation.js
   ===================================================================== */
const fs = require('fs'), path = require('path');
const ROOT = __dirname;
const checks = [];
const check = (n, ok, x) => checks.push({ n, ok: !!ok, x: x || '' });

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function list(dir) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = d + '/' + e.name;
      if (e.isDirectory()) walk(rel); else out.push(rel);
    }
  })(dir);
  return out;
}

const applicant = list('apps/applicant');
const admin = list('apps/admin');

// ---- each app is self-contained -------------------------------------
for (const f of applicant.concat(admin)) {
  if (!/\.(html|js|css|toml)$/.test(f)) continue;
  const body = read(f);
  const parentRefs = (body.match(/(?:src|href)="\.\.\//g) || []).length;
  check('no parent-dir reference in ' + f, parentRefs === 0, 'found=' + parentRefs);
}

// ---- the applicant app must never carry release notes ---------------
// It is a public, single-use form. Release notes raise questions an
// applicant cannot act on, and list internals to anyone who looks.
check('applicant ships no changelog module',
  !applicant.some(f => /changelog/i.test(f)),
  applicant.filter(f => /changelog/i.test(f)).join(','));
check('applicant html does not load changelog.js',
  !/changelog\.js/.test(read('apps/applicant/index.html')));
check('reviewer console does load changelog.js',
  /changelog\.js/.test(read('apps/admin/index.html')));

// ---- the applicant app must not ship reviewer code ------------------
const appBundle = applicant.filter(f => /\.js$/.test(f) && !/vendor/.test(f))
                           .map(read).join('\n');
check('applicant ships no reviewer RPCs',
  !/reveal_id_number|set_application_status|publish_intake|save_trade_subjects/.test(appBundle));
check('applicant ships no Entra sign-in', !/signInWithOAuth|azure/i.test(appBundle));
check('applicant ships no reviewer_profiles query', !/reviewer_profiles/.test(appBundle));
check('applicant ships no pii_access_log write', !/log_pii_access/.test(appBundle));
check('applicant has no formsetup module',
  !applicant.some(f => /formsetup/.test(f)), applicant.filter(f => /formsetup/.test(f)).join(','));

// ---- the reviewer console must not ship the public form -------------
const admBundle = admin.filter(f => /\.js$/.test(f) && !/vendor/.test(f))
                       .map(read).join('\n');
check('reviewer console ships no OTP sign-in', !/signInWithOtp|verifyOtp/.test(admBundle));
check('reviewer console ships no applicant submit', !/submit_application|set_identity/.test(admBundle));
check('reviewer console ships no upload path', !/storage\.from\([^)]*\)\.upload/.test(admBundle));

// ---- CSP is scoped per app ------------------------------------------
const appToml = read('apps/applicant/netlify.toml');
const admToml = read('apps/admin/netlify.toml');
check('applicant CSP present', /Content-Security-Policy/.test(appToml));
check('applicant CSP denies framing', /frame-ancestors 'none'/.test(appToml));
check('reviewer CSP denies framing', /frame-ancestors 'none'/.test(admToml));
check('reviewer console is noindex', /X-Robots-Tag/.test(admToml) && /noindex/.test(admToml));
check('reviewer console disables all caching', /no-store/.test(admToml));
check('reviewer robots.txt disallows everything', /Disallow: \/$/m.test(read('apps/admin/robots.txt')));

// ---- the mock client must never reach production ---------------------
// sync.sh copies shared/supabase.js into both apps. If the in-memory
// test stand-in at test/fixtures/mock-supabase.js is ever copied back
// over shared/, the apps deploy with a fake client: sign-in appears to
// work, data goes nowhere, and nothing errors. Catch it here rather
// than in production.
for (const f of ['shared/supabase.js',
                 'apps/applicant/vendor/supabase.js',
                 'apps/admin/vendor/supabase.js']) {
  const body = read(f);
  check('real Supabase client at ' + f,
    /^var supabase=\(function/.test(body) && !/DEMO ONLY|in-memory stand-in/.test(body),
    body.slice(0, 24));
  check('client is full size at ' + f, body.length > 150000, body.length + ' bytes');
}

// ---- no secrets anywhere --------------------------------------------
for (const f of applicant.concat(admin)) {
  if (!/\.(js|html|toml|json)$/.test(f)) continue;
  // Strip comments first: config.js legitimately contains a comment
  // warning that the service_role key must never be placed there.
  const body = read(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(\/\/|#).*$/gm, '');
  check('no service_role key in ' + f, !/service_role|sbp_|eyJ[A-Za-z0-9_-]{40,}/.test(body));
}

// ---- shared assets are actually in sync -----------------------------
const pairs = [
  ['shared/tokens.css', 'apps/applicant/tokens.css'],
  ['shared/tokens.css', 'apps/admin/tokens.css'],
  ['shared/applicant.css', 'apps/applicant/styles.css'],
  ['shared/admin.css', 'apps/admin/styles.css'],
  ['shared/supabase.js', 'apps/applicant/vendor/supabase.js'],
  ['shared/supabase.js', 'apps/admin/vendor/supabase.js'],
  ['shared/changelog.js', 'apps/admin/changelog.js'],
  ['shared/logo.js', 'apps/applicant/logo.js'],
  ['shared/logo.js', 'apps/admin/logo.js']
];
for (const [a, b] of pairs) {
  check('in sync: ' + b, read(a) === read(b), 'run shared/sync.sh');
}

// ---- every class used has a rule in that app's CSS ------------------
function classesUsed(files) {
  const used = new Set();
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/class="([a-z0-9 _-]+)"/gi)) {
      m[1].split(/\s+/).forEach(c => c && used.add(c));
    }
    for (const m of s.matchAll(/classList\.(?:add|remove|toggle)\('([a-z0-9_-]+)'/gi)) used.add(m[1]);
  }
  return used;
}
function classesDefined(files) {
  const d = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/\.([a-zA-Z][\w-]*)/g)) d.add(m[1]);
  }
  return d;
}
const IGNORE = new Set(['ti', 'hidden', 'sr-only']);

const appUsed = classesUsed(applicant.filter(f => /\.(html|js)$/.test(f) && !/vendor/.test(f)));
const appDef = classesDefined(['apps/applicant/tokens.css', 'apps/applicant/styles.css']);
const appMissing = [...appUsed].filter(c => !appDef.has(c) && !IGNORE.has(c));
check('applicant CSS covers every class used', appMissing.length === 0, appMissing.join(','));

const admUsed = classesUsed(admin.filter(f => /\.(html|js)$/.test(f) && !/vendor/.test(f)));
const admDef = classesDefined(['apps/admin/tokens.css', 'apps/admin/styles.css']);
const admMissing = [...admUsed].filter(c => !admDef.has(c) && !IGNORE.has(c));
check('reviewer CSS covers every class used', admMissing.length === 0, admMissing.join(','));

// ---- payload sizes ---------------------------------------------------
const size = fs2 => fs.statSync(path.join(ROOT, fs2)).size;
const appCss = size('apps/applicant/tokens.css') + size('apps/applicant/styles.css');
const admCss = size('apps/admin/tokens.css') + size('apps/admin/styles.css');
// A budget, not a hard limit: applicants arrive on mid-range phones on
// prepaid data. Netlify serves these gzipped, so ~26 KB on disk is
// roughly 5-6 KB over the wire. The threshold exists to make growth a
// deliberate decision rather than a drift — if a change pushes past it,
// look at what was added before raising the number again.
// Raised from 28 KB when the upload waiting state was added. What
// matters is the wire cost, not the file size: gzipped this is about
// 8 KB for both stylesheets together. The threshold exists to make
// growth deliberate — check the gzipped figure before raising it again.
check('applicant CSS stays lean', appCss < 31000, appCss + ' bytes');
// The console carries the drawer, the dense table and the dashboard, none
// of which the applicant form has. It is an internal tool on a desk
// connection, so its budget is looser than the public form's.
check('reviewer CSS stays lean', admCss < 34000, admCss + ' bytes');

let fails = 0;
console.log('');
for (const c of checks) {
  if (!c.ok) fails++;
  if (!c.ok || process.env.VERBOSE) {
    console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.n + (c.x ? '   [' + c.x + ']' : ''));
  }
}
console.log((checks.length - fails) + '/' + checks.length + ' passed' +
            (fails ? '' : '   (set VERBOSE=1 to list all)'));
process.exit(fails ? 1 : 0);
