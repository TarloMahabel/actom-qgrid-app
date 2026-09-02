const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const RESOLVE = require('./test/harness').resolver('applicant');

const vc = new VirtualConsole();
const logs = [];
vc.on('jsdomError', e => logs.push('JSDOM ERROR: ' + e.message));
vc.on('error', (...a) => logs.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(RESOLVE('index.html'), 'utf8'), {
  runScripts: 'dangerously',
  url: 'http://localhost/index.html',
  virtualConsole: vc,
  pretendToBeVisual: true,
  resources: undefined
});
const { window } = dom;
const d = window.document;

// jsdom won't fetch local <script src>; inject them in order ourselves.
function inject(rel) {
  const s = d.createElement('script');
  s.textContent = fs.readFileSync(RESOLVE(rel), 'utf8');
  d.body.appendChild(s);
}

// Minimal shims jsdom lacks.
window.URL.createObjectURL = () => 'blob:demo';
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};
window.alert = m => logs.push('ALERT: ' + m);
window.confirm = () => true;
window.prompt = () => 'Verifying identity for demo';

const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => d.getElementById(id);
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));

const checks = [];
function check(name, cond, extra) {
  checks.push({ name, ok: !!cond, extra: extra || '' });
}

(async () => {
  inject('vendor/supabase.js');
  inject('config.js');
  inject('app.js');
  await wait(200);

  check('sign-in screen visible', !$('signin').classList.contains('hidden'));
  check('test ID hint injected', /1007225013089/.test(d.body.textContent));

  $('emailInput').value = 'demo.applicant@example.com';
  click($('sendCodeBtn'));
  await wait(150);
  check('OTP step shown', !$('stepCode').classList.contains('hidden'));

  $('codeInput').value = '123456';
  click($('verifyBtn'));
  await wait(600);

  check('portal visible after verify', !$('portal').classList.contains('hidden'));
  const content = $('content');
  check('step 1 rendered', /Who you are/.test(content.textContent));
  check('progress pylons drawn', content.querySelectorAll('.pylon-node').length >= 8,
        'nodes=' + content.querySelectorAll('.pylon-node').length);

  // --- bad ID must be rejected
  $('fullName').value = 'Demo Applicant';
  $('idNumber').value = '1234567890123';
  click(content.querySelector('[data-nav="next"]'));
  await wait(300);
  check('invalid ID rejected', /checksum/i.test(content.querySelector('[data-err="idNumber"]').textContent),
        content.querySelector('[data-err="idNumber"]').textContent);

  // --- minor ID must add the guardian step
  $('idNumber').value = '1007225013089';
  click(content.querySelector('[data-nav="next"]'));
  await wait(500);
  check('minor triggers guardian alert', logs.some(l => /under 18/.test(l)));
  check('guardian step inserted', /Guardian/.test(content.querySelector('svg').textContent) && content.querySelectorAll('.pylon-node').length === 9,
        'steps=' + content.querySelectorAll('.pylon-node').length);
  check('now on contact step', /How we reach you/.test(content.textContent));

  // --- contact
  $('contact_number').value = '0821234567';
  $('address_line1').value = '14 Voortrekker Road';
  $('city').value = 'Benoni';
  $('province').value = 'Gauteng';
  click(content.querySelector('[data-nav="next"]'));
  await wait(400);
  check('on trade step', /The trade you want/.test(content.textContent));

  // --- trade: blank must block
  click(content.querySelector('[data-nav="next"]'));
  await wait(200);
  check('trade required', /Choose the trade/.test(content.querySelector('[data-err="trade_id"]').textContent));

  // Trade is now chosen from cards that describe the work, not a dropdown.
  const tradeCards = content.querySelectorAll('[data-trade]');
  check('trade cards rendered', tradeCards.length > 5, 'cards=' + tradeCards.length);
  check('cards describe the work', /Millwright|all-rounder|fault-finding/i.test(content.textContent));
  click(tradeCards[1]);
  check('card selection records the trade', $('trade_id').value.length > 0);
  click(content.querySelector('[data-nav="next"]'));
  await wait(400);
  check('on equity step', /Employment equity/.test(content.textContent));
  check('prefer-not-to-say offered', /Prefer not to say/.test(content.textContent));

  click(content.querySelector('[data-nav="next"]'));
  await wait(400);
  check('on school step', /Grade 12 results/.test(content.textContent));

  // grade 12 type required
  click(content.querySelector('[data-nav="next"]'));
  await wait(200);
  check('grade12 required', /which certificate/.test(content.querySelector('[data-err="grade12_type"]').textContent));

  // No subject block until a certificate type is chosen — a learner writes
  // either the academic NSC or the technical one, never both.
  check('no subject block before choosing a certificate',
        content.querySelectorAll('input[data-subject]').length === 0,
        'inputs=' + content.querySelectorAll('input[data-subject]').length);

  $('grade12_type').value = 'nsc_technical';
  $('grade12_type').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(200);

  check('technical block appears for a technical certificate',
        content.querySelectorAll('[data-stream="technical"] input[data-subject]').length > 0);
  check('academic block is not shown alongside it',
        content.querySelectorAll('[data-stream="academic"] input[data-subject]').length === 0);

  // Switching to the academic certificate must swap the block, not add one.
  $('grade12_type').value = 'nsc';
  $('grade12_type').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(200);
  check('academic block replaces technical on switch',
        content.querySelectorAll('[data-stream="academic"] input[data-subject]').length > 0 &&
        content.querySelectorAll('[data-stream="technical"] input[data-subject]').length === 0);

  $('grade12_type').value = 'nsc_technical';
  $('grade12_type').dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait(200);
  const marks = content.querySelectorAll('[data-stream="technical"] input[data-subject]');
  marks[0].value = '68'; marks[1].value = '71'; marks[2].value = '64';
  check('technical subjects trade-filtered', marks.length > 5 && marks.length < 16,
        'rows=' + marks.length + ' (was 16 unfiltered)');
  // Two, not four. Maths and Science are required in BOTH streams, but an
  // applicant only ever sees their own — requiring four was the bug.
  check('only the applicable stream is required',
        content.querySelectorAll('input[data-required]').length === 2,
        'required=' + content.querySelectorAll('input[data-required]').length);
  check('minimum mark hint shown', /at least 40%/.test(content.textContent));

  // A required subject left blank must block the step.
  content.querySelectorAll('input[data-required]').forEach(i => { i.value = ''; });
  click(content.querySelector('[data-nav="next"]'));
  await wait(300);
  check('blank required subject blocks',
        /requires a mark for/.test(content.querySelector('[data-err="marks"]').textContent),
        content.querySelector('[data-err="marks"]').textContent.slice(0, 60));
  content.querySelectorAll('input[data-required]').forEach(i => { i.value = '65'; });
  click(content.querySelector('[data-nav="next"]'));
  await wait(500);
  check('on further study step', /Further qualifications/.test(content.textContent));

  click(content.querySelector('[data-nav="next"]'));
  await wait(500);
  check('on documents step', /Your documents/.test(content.textContent));

  check('document types from config',
        content.querySelectorAll('.drop[data-doctype]').length === 4,
        'types=' + content.querySelectorAll('.drop[data-doctype]').length);

  // A required document blocks the step; optional ones do not.
  click(content.querySelector('[data-nav="next"]'));
  await wait(200);
  check('required doc blocks',
        /required before you can submit/.test(content.querySelector('[data-err="doc_id_document"]').textContent));
  check('optional doc does not block',
        content.querySelector('[data-err="doc_other"]').textContent === '');

  console.log('\n--- results ---');
  let fails = 0;
  for (const c of checks) {
    if (!c.ok) fails++;
    console.log((c.ok ? 'PASS  ' : 'FAIL  ') + c.name + (c.extra ? '   [' + c.extra + ']' : ''));
  }
  if (logs.length) { console.log('\n--- captured ---'); logs.forEach(l => console.log('  ' + l)); }
  console.log('\n' + (checks.length - fails) + '/' + checks.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
