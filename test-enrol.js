/* Enrolment and the apprentice register, driven through the console. */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const RESOLVE = require('./test/harness').resolver('admin');
const vc = new VirtualConsole(); const logs = [];
vc.on('jsdomError', e => logs.push('JSDOM: ' + e.message));

const dom = new JSDOM(fs.readFileSync(RESOLVE('index.html'), 'utf8'),
  { runScripts: 'dangerously', url: 'https://localhost/', virtualConsole: vc, pretendToBeVisual: true });
const { window } = dom, d = window.document;
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
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
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const checks = []; const t = (n, ok, x) => checks.push({ n, ok: !!ok, x: x || '' });

(async () => {
  const uid = (e => { let h=0; for (const c of e) h=(h*31+c.charCodeAt(0))>>>0;
    return 'demo-'+h.toString(16).padStart(8,'0')+'-0000-4000-8000-000000000000'.slice(8); })
    ('p.naidoo@actom.co.za');
  window.localStorage.setItem('actom_demo_session',
    JSON.stringify({ user: { id: uid, email: 'p.naidoo@actom.co.za' } }));

  inject('vendor/supabase.js'); inject('config.js');
  inject('logo.js'); inject('changelog.js'); inject('formsetup.js'); inject('admin.js');
  await wait(900);

  // Register appears in the rail
  click($('navBtn')); await wait(120);
  t('register is in the navigation', !!$('drawer').querySelector('[data-tab="register"]'));
  click($('drawer').querySelector('[data-tab="register"]'));
  await wait(600);
  t('register screen opens', /Apprentices/.test($('content').textContent));
  t('register starts empty', /Nobody on the register/.test($('content').textContent));

  // Find a submitted application and shortlist it
  click($('navBtn')); await wait(120);
  click($('drawer').querySelector('[data-tab="queue"]'));
  await wait(700);
  click($('content').querySelector('tr[data-open]'));
  await wait(700);

  t('no enrol button before shortlisting', !$('enrolBtn'));

  $('notes').value = 'Strong marks.';
  click($('content').querySelector('[data-set="shortlisted"]'));
  await wait(800);
  t('enrol button appears once shortlisted', !!$('enrolBtn'));

  // Open the dialog
  click($('enrolBtn')); await wait(200);
  const modal = d.querySelector('.modal-backdrop');
  t('enrolment dialog opens', !!modal);
  t('dialog warns about the lasting change', /lasting change/i.test(modal.textContent));
  t('dialog explains the legal hold', /legal hold/i.test(modal.textContent));
  t('dialog asks for contract details',
    !!modal.querySelector('#eEmp') && !!modal.querySelector('#eSeta') &&
    !!modal.querySelector('#eSup'));

  // Refuse without a start date
  modal.querySelector('#eStart').value = '';
  click(modal.querySelector('#eConfirm')); await wait(300);
  t('start date is required',
    /start date is required/i.test(modal.querySelector('#eProblem').textContent));

  // Enrol properly
  modal.querySelector('#eStart').value = '2026-09-01';
  modal.querySelector('#eEmp').value = 'EMP-2201';
  modal.querySelector('#eSeta').value = 'SETA-9911';
  modal.querySelector('#eSite').value = 'Benoni Works';
  modal.querySelector('#eSup').value = 'J. Dlamini';
  click(modal.querySelector('#eConfirm')); await wait(800);

  t('dialog closes on success', !d.querySelector('.modal-backdrop'));
  t('lands on the register', /Apprentices/.test($('content').textContent));
  t('the apprentice is listed', /EMP-2201|Benoni Works/.test($('content').textContent));
  t('shows as active', /active/i.test($('content').textContent));

  // The rail count reflects it
  await wait(400);
  t('register carries a count badge',
    !!$('drawer').querySelector('[data-tab="register"] .nav-count'),
    $('drawer').querySelector('[data-tab="register"]').textContent.trim());

  // Open the register entry
  click($('content').querySelector('tr[data-appr]')); await wait(500);
  t('register entry opens', /Trade|Employee number/.test($('content').textContent));
  t('entry shows the supervisor', /Dlamini/.test($('content').textContent));

  // A SETA learner number arrives weeks after enrolment, once the
  // contract is registered — so it must be addable to an existing
  // register entry, not only at enrolment.
  t('SETA number field is on the register entry', !!$('uSeta'));
  t('employee number field is on the register entry', !!$('uEmp'));
  if ($('uSeta')) {
    $('uSeta').value = 'MER/2026/0044821';
    click($('uSave'));
    await wait(800);
    click($('content').querySelector('tr[data-appr]'));
    await wait(600);
    t('SETA number added after enrolment persists',
      $('uSeta') && $('uSeta').value === 'MER/2026/0044821',
      $('uSeta') ? $('uSeta').value : '(field gone)');
  }

  // Ending needs a date and a reason
  $('uStatus').value = 'terminated';
  click($('uSave')); await wait(500);
  t('ending needs a date and a reason',
    /needs both a date and a reason/i.test($('uProblem').textContent),
    $('uProblem').textContent.slice(0, 60));

  let f = 0; console.log('');
  for (const c of checks) { if (!c.ok) f++;
    console.log((c.ok?'PASS  ':'FAIL  ') + c.n + (c.x?'   ['+c.x+']':'')); }
  if (logs.length) { console.log('\n--- captured ---'); logs.slice(0,5).forEach(l => console.log('  '+l)); }
  console.log('\n' + (checks.length-f) + '/' + checks.length + ' passed');
  process.exit(f ? 1 : 0);
})();
