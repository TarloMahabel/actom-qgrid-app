const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const RESOLVE = require('./test/harness').resolver('admin');

const vc = new VirtualConsole();
const logs = [];
vc.on('jsdomError', e => logs.push('JSDOM ERROR: ' + e.message));
vc.on('error', (...a) => logs.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(RESOLVE('index.html'), 'utf8'), {
  runScripts: 'dangerously', url: 'http://localhost/admin/index.html',
  virtualConsole: vc, pretendToBeVisual: true
});
const { window } = dom, d = window.document;
window.URL.createObjectURL = () => 'blob:demo';
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};
window.open = () => {};
let alerts = [], confirmAnswer = true, promptAnswer = 'Cloned intake';
window.alert = m => { alerts.push(String(m)); logs.push('ALERT: ' + m); };
window.confirm = () => confirmAnswer;
window.prompt = () => promptAnswer;

function inject(rel) {
  const s = d.createElement('script');
  s.textContent = fs.readFileSync(RESOLVE(rel), 'utf8');
  d.body.appendChild(s);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => d.getElementById(id);
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));

const checks = [];
const check = (n, c, x) => checks.push({ n, ok: !!c, x: x || '' });

(async () => {
  const uid = (email => { let h = 0; for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return 'demo-' + h.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000'.slice(8); })
    ('p.naidoo@actom.co.za');
  window.localStorage.setItem('actom_demo_session',
    JSON.stringify({ user: { id: uid, email: 'p.naidoo@actom.co.za' } }));

  inject('vendor/supabase.js');
  inject('config.js');
  inject('formsetup.js');
  inject('admin.js');
  await wait(900);

  const content = $('content');

  // The dashboard is the landing screen; step into the queue.
  click($('navBtn'));
  click($('drawer').querySelector('[data-tab="queue"]'));
  await wait(700);

  // ---------- scoring appears in the queue
  check('score column present', /Score/.test(content.textContent));
  check('seeded applications scored', /\d\d\.\d/.test(content.textContent));

  click($('sortBtn'));
  await wait(400);
  check('sort toggles to score', /highest score/.test($('sortBtn').textContent));

  // ---------- form setup tab
  click($('navBtn'));
  const fsTab = $('drawer').querySelector('[data-tab="formsetup"]');
  check('form setup tab visible to admin', !!fsTab);
  click(fsTab);
  await wait(600);
  check('intake list rendered', /Intakes/.test(content.textContent));
  check('open intake shows as locked', /open — locked/.test(content.textContent));
  check('draft intake shows as editable', /draft — editable/.test(content.textContent));

  // ---------- open the PUBLISHED intake: everything must be frozen
  const rows = [...content.querySelectorAll('[data-edit]')];
  const openRow = rows.find(b => b.textContent === 'View');
  check('published intake opens read-only', !!openRow);
  click(openRow);
  await wait(600);

  check('lock warning shown', /This form is locked/.test(content.textContent));
  check('no publish button on published intake', !$('publishBtn'));
  check('no save-basics on published intake', !$('saveBasics'));
  check('closing date still editable', $('f_closes') && !$('f_closes').disabled);
  check('name is disabled', $('f_name').disabled);
  check('subject weights disabled', !$('saveTrades'));

  // Direct write must be refused by the mock's lock, mirroring the trigger.
  const lockTest = await window.supabase.createClient().from('intake_trade_subjects')
    .update({ weight: 9 }).eq('intake_id', $('f_name').dataset.x || 'x');
  check('direct config write on published intake refused',
        !!(lockTest.error), lockTest.error ? lockTest.error.message.slice(0, 50) : 'NO ERROR');

  // ---------- clone it, then edit the clone
  click($('backList'));
  await wait(500);
  promptAnswer = 'Test clone 2028';
  click(content.querySelector('[data-clone]'));
  await wait(700);
  check('clone opens as a draft', /draft — editable/.test(content.textContent));
  check('clone is editable', !!$('saveBasics'));
  check('clone has publish button', !!$('publishBtn'));
  check('clone carried the trades over', /Millwright/.test(content.textContent));

  // ---------- subject grid
  const subjBtn = content.querySelector('[data-subjects]');
  click(subjBtn);
  await wait(600);
  check('subject grid renders', !!$('subjectsCard'));
  const subjRows = content.querySelectorAll('#subjectsGrid tbody tr');
  check('subject rows listed', subjRows.length > 10, 'rows=' + subjRows.length);
  check('score preview shown', /weighted average|No subjects/.test($('scorePreview').textContent));

  // Toggle a subject on and watch the preview update.
  const off = [...subjRows].find(tr => !tr.querySelector('[data-f="on"]').checked);
  if (off) {
    off.querySelector('[data-f="on"]').checked = true;
    off.querySelector('[data-f="weight"]').value = '5';
    change(off.querySelector('[data-f="on"]'));
    await wait(200);
  }
  check('preview reacts to a change', /asked for/.test($('scorePreview').textContent),
        $('scorePreview').textContent.slice(0, 60));

  click($('saveSubjects'));
  await wait(700);
  check('subjects saved', !alerts.some(a => /error|not authorised/i.test(a)));

  // ---------- journey steps ("what happens from here")
  // Editable per intake, and deliberately still editable after publish.
  check('journey editor present', !!$('journeyCard'));
  if ($('journeyCard')) {
    const rowsBefore = $('journeyRows').querySelectorAll('.journey-row').length;
    check('existing steps listed', rowsBefore > 0, 'rows=' + rowsBefore);

    click($('addStep'));
    check('can add a step',
      $('journeyRows').querySelectorAll('.journey-row').length === rowsBefore + 1);

    // A blank title must be refused rather than silently dropped.
    click($('saveJourney'));
    await wait(300);
    check('blank step title refused',
      /needs a title/i.test($('journeyProblem').textContent),
      $('journeyProblem').textContent.slice(0, 40));

    // Fill it in and save properly.
    const last = [...$('journeyRows').querySelectorAll('.journey-row')].pop();
    last.querySelector('[data-j="title"]').value = 'Induction';
    last.querySelector('[data-j="detail"]').value = 'A day on site before you start.';
    click($('saveJourney'));
    await wait(400);
    check('valid steps save', $('journeyProblem').textContent.trim() === '',
      $('journeyProblem').textContent.slice(0, 40));
  }


  // ---------- publish gate
  alerts = [];
  click($('publishBtn'));
  await wait(700);
  const problems = $('publishProblems');
  check('publish either succeeds or explains why not',
        /Not ready to publish/.test(problems.textContent) || /open — locked/.test(content.textContent),
        problems.textContent.slice(0, 90) || 'published');

  console.log('\n--- results ---');
  let fails = 0;
  for (const c of checks) { if (!c.ok) fails++;
    console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.n + (c.x ? '   [' + c.x + ']' : '')); }
  if (logs.length) { console.log('\n--- captured ---'); logs.slice(0, 12).forEach(l => console.log('  ' + l)); }
  console.log('\n' + (checks.length - fails) + '/' + checks.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
