const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const RESOLVE = require('./test/harness').resolver('admin');

const vc = new VirtualConsole();
const logs = [];
vc.on('jsdomError', e => logs.push('JSDOM ERROR: ' + e.message));
vc.on('error', (...a) => logs.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(RESOLVE('index.html'), 'utf8'), {
  runScripts: 'dangerously',
  url: 'http://localhost/admin/index.html',
  virtualConsole: vc, pretendToBeVisual: true
});
const { window } = dom, d = window.document;
window.URL.createObjectURL = () => 'blob:demo';
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};
window.open = () => logs.push('OPENED signed url');
window.alert = m => logs.push('ALERT: ' + m);
window.confirm = () => true;
window.prompt = () => 'Verifying ID against certified copy';
// signInWithOAuth reloads in the demo; the test pre-seeds a session instead,
// so reload is never reached.

function inject(rel) {
  const s = d.createElement('script');
  s.textContent = fs.readFileSync(RESOLVE(rel), 'utf8');
  d.body.appendChild(s);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => d.getElementById(id);
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));

const checks = [];
const check = (n, c, x) => checks.push({ n, ok: !!c, x: x || '' });

(async () => {
  // Pre-seed a reviewer session the way signInWithOAuth would.
  const uid = (email => { let h = 0; for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return 'demo-' + h.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000'.slice(8); })
    ('p.naidoo@actom.co.za');
  window.localStorage.setItem('actom_demo_session',
    JSON.stringify({ user: { id: uid, email: 'p.naidoo@actom.co.za' } }));

  inject('vendor/supabase.js');
  inject('config.js');
  inject('admin.js');
  await wait(900);

  check('portal visible (active reviewer)', !$('portal').classList.contains('hidden'));
  check('pending screen not shown', $('pending').classList.contains('hidden'));
  check('role badge set', $('whoRole').textContent === 'admin', $('whoRole').textContent);

  click($('navBtn'));                       // open the drawer
  const tabs = [...$('drawer').querySelectorAll('[data-tab]')]
                 .map(b => b.dataset.tab).filter(k => k !== 'help');
  check('admin sees all sections',
        tabs.join(',') === 'dash,queue,register,consent,audit,formsetup,people', tabs.join(','));

  const content = $('content');
  check('dashboard is the landing screen',
        /at a glance/i.test(content.textContent));
  check('dashboard shows aggregates, not applicants',
        !/Mokoena|Ndlovu|Adams/.test(content.textContent));

  // Step into the queue for the rest of the checks.
  click($('drawer').querySelector('[data-tab="queue"]'));
  await wait(700);
  check('queue rendered', /Applicant/.test(content.textContent) && /Rank/.test(content.textContent));
  const rowCount = content.querySelectorAll('tr[data-open]').length;
  check('seeded applications listed', rowCount >= 5, 'rows=' + rowCount);

  // Search filter
  $('fQ').value = 'Mokoena';
  $('fQ').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait(200);
  check('search narrows list', content.querySelectorAll('tr[data-open]').length === 1,
        'rows=' + content.querySelectorAll('tr[data-open]').length);

  // Open the record
  click(content.querySelector('tr[data-open]'));
  await wait(500);
  check('detail view opened', /Thandeka Mokoena/.test(content.textContent));
  check('ID masked by default', /•••••/.test(content.textContent));
  check('full ID not present in DOM', !/1007225013089|9803122081084/.test(content.textContent));
  check('minor flagged', /under 18/.test(content.textContent));
  check('guardian block shown', /GUARDIAN|Guardian/.test(content.textContent));

  // Reveal, with a reason
  click($('revealBtn'));
  await wait(400);
  check('ID revealed after reason', /\d{13}/.test($('idBox').textContent), $('idBox').textContent.trim());
  check('reveal marked as logged', /logged/.test($('idBox').textContent));

  // Open a document -> signed URL + log
  click(content.querySelector('[data-file]'));
  await wait(400);
  check('document opened via signed url', logs.some(l => /OPENED signed url/.test(l)));

  // Declining is now a dedicated dialog, not an inline status button.
  // Confirming with no reason chosen must be refused.
  click($('declineBtn'));
  await wait(200);
  const dModal = d.querySelector('.modal-backdrop');
  check('decline dialog opens', !!dModal);
  if (dModal) {
    click(dModal.querySelector('#dConfirm'));
    await wait(200);
    check('decline needs a reason',
      /Choose a reason/i.test(dModal.querySelector('#dProblem').textContent));
    click(dModal.querySelector('#dCancel'));
    await wait(150);
  }

  // Shortlist
  $('notes').value = 'Strong technical marks, invite to aptitude assessment.';
  click(content.querySelector('[data-set="shortlisted"]'));
  await wait(600);
  check('status changed to shortlisted', /shortlisted/.test(content.textContent));

  // Audit tab must now contain our actions
  click($('navBtn'));
  click($('drawer').querySelector('[data-tab="audit"]'));
  await wait(500);
  const audit = $('content').textContent;
  check('audit shows reveal_id', /reveal_id/.test(audit));
  check('audit records the typed reason', /Verifying ID against certified copy/.test(audit));
  check('audit shows document download', /download_document/.test(audit));
  check('audit attributes to reviewer', /p\.naidoo@actom\.co\.za/.test(audit));

  // People tab
  click($('navBtn'));
  click($('drawer').querySelector('[data-tab="people"]'));
  await wait(500);
  check('reviewer admin list renders', /s\.dlamini@actom\.co\.za/.test($('content').textContent));

  console.log('\n--- results ---');
  let fails = 0;
  for (const c of checks) { if (!c.ok) fails++;
    console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.n + (c.x ? '   [' + c.x + ']' : '')); }
  if (logs.length) { console.log('\n--- captured ---'); logs.forEach(l => console.log('  ' + l)); }
  console.log('\n' + (checks.length - fails) + '/' + checks.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
