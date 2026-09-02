/* Text-fit checks: render the reviewer detail view with deliberately
   hostile data and confirm nothing escapes its container. */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const RESOLVE = require('./test/harness').resolver('admin');
const vc = new VirtualConsole(); const logs = [];
vc.on('jsdomError', e => logs.push('JSDOM: ' + e.message));

const dom = new JSDOM(fs.readFileSync(RESOLVE('index.html'), 'utf8'),
  { runScripts: 'dangerously', url: 'https://localhost/', virtualConsole: vc, pretendToBeVisual: true });
const { window } = dom, d = window.document;
window.URL.createObjectURL = () => 'blob:x';
window.scrollTo = () => {}; window.open = () => {};
window.alert = m => logs.push('ALERT: ' + m);
window.confirm = () => true; window.prompt = () => 'Verifying identity';

function inject(rel) {
  const s = d.createElement('script');
  s.textContent = fs.readFileSync(RESOLVE(rel), 'utf8');
  d.body.appendChild(s);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => d.getElementById(id);
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const checks = []; const t = (n, ok, x) => checks.push({ n, ok: !!ok, x: x || '' });

(async () => {
  const uid = (e => { let h = 0; for (const c of e) h = (h*31 + c.charCodeAt(0))>>>0;
    return 'demo-' + h.toString(16).padStart(8,'0') + '-0000-4000-8000-000000000000'.slice(8); })
    ('p.naidoo@actom.co.za');
  window.localStorage.setItem('actom_demo_session',
    JSON.stringify({ user: { id: uid, email: 'p.naidoo@actom.co.za' } }));

  inject('vendor/supabase.js'); inject('config.js');
  inject('logo.js'); inject('changelog.js'); inject('formsetup.js'); inject('admin.js');
  await wait(900);

  // Poison the first application with the kind of values people really type.
  const db = JSON.parse(window.localStorage.getItem('actom_demo_db'));
  const a = db.applications[0];
  a.full_name = 'Sipho Mokoena-Van Der Westhuizen Ramaphosa';
  a.email = 'sipho.mokoena.vanderwesthuizen.ramaphosa@verylongdomainname.example.co.za';
  a.address_line1 = 'Unit 52 Wilson Manor, Tropicbird Lane, Little Falls Extension 3';
  a.city = 'Roodepoort'; a.province = 'Gauteng';
  a.contact_number = '0795810602';
  window.localStorage.setItem('actom_demo_db', JSON.stringify(db));
  window.location.reload && null;

  inject('vendor/supabase.js');   // reload the mock with the poisoned data
  await wait(300);
  click($('navBtn'));
  click($('drawer').querySelector('[data-tab="queue"]'));
  await wait(600);

  const openBtn = $('content').querySelector('tr[data-open]');
  t('queue rendered', !!openBtn);
  if (openBtn) { click(openBtn); await wait(700); }

  const c = $('content');
  t('detail view opened', /APPLICANT|Applicant/i.test(c.textContent));
  t('unlock button is on its own line', !!c.querySelector('.kv-action'));

  const css = fs.readFileSync(path.join(__dirname, 'shared', 'tokens.css'), 'utf8');
  t('kv uses minmax(0,1fr) so long values wrap', /minmax\(0, 1fr\)/.test(css));
  t('kv values break long tokens', /\.kv dd \{[\s\S]*?overflow-wrap: anywhere/.test(css));
  t('grid children may shrink below content', /\.grid > \*, \.split > \*/.test(css));
  t('page cannot scroll horizontally', /html, body \{ overflow-x: hidden/.test(css));
  t('file names wrap', /\.file-item \.name \{ min-width: 0/.test(css));
  t('masthead email truncates rather than wraps', /text-overflow: ellipsis/.test(css));
  t('reference column stays on one line', /nowrap/.test(fs.readFileSync(path.join(__dirname, 'apps', 'admin', 'admin.js'), 'utf8')));
  t('stray drift marker removed', !/\/\* drift \*\//.test(css));

  let fails = 0; console.log('');
  for (const ch of checks) { if (!ch.ok) fails++;
    console.log((ch.ok?'PASS  ':'FAIL  ') + ch.n + (ch.x?'   ['+ch.x+']':'')); }
  console.log('\n' + (checks.length-fails) + '/' + checks.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
