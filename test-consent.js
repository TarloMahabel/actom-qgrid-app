/* Consent wording editor: immutability once used, and role gating. */
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
window.confirm = () => true; window.prompt = () => 'reason';
window.HTMLElement.prototype.scrollIntoView = function () {};

function inject(rel) {
  const s = d.createElement('script');
  s.textContent = fs.readFileSync(RESOLVE(rel), 'utf8');
  d.body.appendChild(s);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => d.getElementById(id);
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
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

  click($('navBtn')); await wait(120);
  const link = $('drawer').querySelector('[data-tab="consent"]');
  t('consent section appears for an admin', !!link);
  if (!link) { report(); return; }

  click(link);
  await wait(700);

  t('consent screen renders', /Consent wording/i.test($('content').textContent));
  t('explains that wording locks once used',
    /locks once it is used/i.test($('content').textContent));
  t('shows the applicant wording', !!$('content').querySelector('[data-body]'));

  // A version that has been agreed to must be read-only, with no Save.
  const readonly = [...$('content').querySelectorAll('textarea[data-body]')]
    .filter(x => x.hasAttribute('readonly'));
  t('an already-agreed version is read only', readonly.length > 0,
    'readonly textareas=' + readonly.length);
  t('locked versions are labelled', /locked/i.test($('content').textContent));

  // New version dialog
  click($('newVersionBtn')); await wait(200);
  const m = d.querySelector('.modal-backdrop');
  t('new version dialog opens', !!m);
  t('dialog requires both audiences',
    !!m.querySelector('#cvApplicant') && !!m.querySelector('#cvGuardian'));
  t('dialog pre-fills from the latest wording',
    m.querySelector('#cvApplicant').value.length > 50);

  // Reusing an existing version number is refused
  const existingVersion = ($('content').textContent.match(/Version\s+([0-9.]+)/) || [])[1];
  m.querySelector('#cvVersion').value = existingVersion || '2026.1';
  click(m.querySelector('#cvSave')); await wait(250);
  t('reusing an existing version number is refused',
    /already exists/i.test(m.querySelector('#cvProblem').textContent),
    m.querySelector('#cvProblem').textContent.slice(0, 50));

  // A genuinely new version succeeds
  m.querySelector('#cvVersion').value = '2099.1';
  click(m.querySelector('#cvSave')); await wait(800);
  t('a new version can be created', !d.querySelector('.modal-backdrop'));
  t('the new version is listed', /2099\.1/.test($('content').textContent));

  report();

  function report() {
    let f = 0; console.log('');
    for (const c of checks) { if (!c.ok) f++;
      console.log((c.ok?'PASS  ':'FAIL  ') + c.n + (c.x?'   ['+c.x+']':'')); }
    if (logs.length) { console.log('\n--- captured ---'); logs.slice(0,4).forEach(l => console.log('  '+l)); }
    console.log('\n' + (checks.length-f) + '/' + checks.length + ' passed');
    process.exit(f ? 1 : 0);
  }
})();
