/* The printed inspection report — the artefact that leaves the building. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-report — printable inspection report');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  let printed = false;
  w.print = () => { printed = true; };

  /* Seeded here rather than in the shared fixture: the mock's .eq() does not
     filter, so answers left in the fixture appear on whichever inspection a
     suite opens — which broke three capture tests when they lived there. */
  w.GRID_TEST_DATA.inspection_results = [
    { id: 'r1', inspection_id: 'n2', field_id: 'i1', label: 'Panel serial', value_text: 'MV-118-07' },
    { id: 'r2', inspection_id: 'n2', field_id: 'i3', label: 'Busbar torque', value_num: 70, outcome: 'pass', equipment_id: 1 },
    { id: 'r3', inspection_id: 'n2', field_id: 'i4', label: 'Earth switch operates', outcome: 'fail' },
    { id: 'r4', inspection_id: 'n2', field_id: 'i5', label: 'Torque wrench used', equipment_id: 1, outcome: 'pass' },
    { id: 'r5', inspection_id: 'n2', field_id: 'i6', label: 'Panel type', value_text: '12 kV metal-clad' },
    { id: 'r6', inspection_id: 'n2', field_id: 'i7', label: 'Photo of assembly', value_text: '2 photos', value_num: 2, outcome: 'pass' },
    { id: 'r7', inspection_id: 'n2', field_id: 'i9', label: 'Faults found', value_text: '1 fault', value_num: 1, outcome: 'fail' },
    { id: 'r8', inspection_id: 'n2', field_id: 'i8', label: 'Inspector signature', value_text: 'signed', outcome: 'pass' }
  ];

  const insp = w.GRID_TEST_DATA.inspections.find(i => i.id === 'n2');
  insp.signed_at = '2026-08-27T14:22:00Z';
  insp.signed_by = 'u1';
  insp.signature_hash = '9f2c41ab77de5501';

  d.querySelector('#nav button[data-go="work"]').click(); await sleep(60);
  d.querySelector('.tabs button[data-tab="2"]').click(); await sleep(220);

  s.group('getting to it');
  s.check('the register offers a report per inspection',
    !!d.querySelector('[data-act="print-report"]'));
  d.querySelector('[data-act="print-report"]').click(); await sleep(800);
  const text = () => $('page').textContent.replace(/\s+/g, ' ');
  s.check('the report opens', text().includes('Inspection report'));
  s.check('the app chrome is hidden for printing',
    d.body.classList.contains('printing'));
  s.check('there is a way back', !!d.querySelector('[data-act="close-report"]'));

  s.group('what makes it evidence');
  /* Each of these answers a question asked about an old record. */
  s.check('the reference is on the page', text().includes('INS-26-1189'));
  s.check('the division is named', text().includes('ACTOM MV Switchgear'));
  s.check('the project and works order are shown',
    text().includes('P-26118') && text().includes('WO-44812'));
  s.check('the unit is identified', text().includes('MV-118-07'));
  /* "Which version of the checksheet was this" is the first thing asked. */
  s.check('the checksheet code AND revision are shown',
    /IT-ASM-04/.test(text()) && /rev 3/.test(text()));
  s.check('who signed it', text().includes('Varshan Mahabel'));
  s.check('when it was signed', text().includes('2026/08/27'));
  /* A fragment of the hash ties a printed page back to the row. */
  s.check('a record fingerprint is printed', text().includes('9f2c41ab77de'));
  s.check('who printed it and when', text().includes('Printed'));
  s.check('it says where identity comes from',
    text().includes("signatory's ACTOM account"));

  s.group('the answers');
  /* A measurement printed the word "Pass" and threw the reading away. The
     reading is the evidence: an auditor checks 70 against 66-74. */
  s.check('a measurement prints its reading, not its verdict', /70 Nm/.test(text()));
  s.check('the tolerance it was judged against is shown', /66 to 74/.test(text()));
  s.check('the verdict is shown as well', text().includes('within tolerance'));
  s.check('a pass/fail prints its outcome', text().includes('Fail'));
  s.check('the instrument used is named', text().includes('MME-0517'));
  s.check('faults are listed with their code', text().includes('DF020'));
  s.check('clearing and verification are on the report',
    text().includes('Cleared by') && text().includes('Verified by'));

  s.group('a signed record never prints as unsigned');
  /* Records signed before the pad existed, or a drawing that failed to
     upload, would otherwise print "not signed" on a signed certificate. */
  s.check('a missing drawing says so without contradicting the record',
    text().includes('no drawn signature on file'));
  s.check('it does not say the record is unsigned', !text().includes('not signed'));

  s.group('printing');
  d.querySelector('[data-act="do-print"]').click(); await sleep(120);
  s.check('print is handed to the browser', printed);
  d.querySelector('[data-act="close-report"]').click(); await sleep(200);
  s.check('closing returns to the register',
    !d.body.classList.contains('printing') && $('page').textContent.includes('Register')
      || !!d.querySelector('[data-act="print-report"]'));

  s.group('paper is not a screen');
  const css = require('fs').readFileSync(
    require('path').join(__dirname, 'apps/inspect/styles.css'), 'utf8');
  const printBlock = css.slice(css.indexOf('@media print'));
  s.check('a print stylesheet exists', css.includes('@media print'));
  s.check('the navigation and buttons are hidden',
    /\.side[^{]*\{[^}]*display:\s*none/.test(printBlock) || printBlock.includes('.side,'));
  /* A shop-floor printer is not colour: a pale grey label that vanishes on
     paper is a missing field on a quality record. */
  s.check('colour is flattened for a mono printer', printBlock.includes('#000 !important'));
  s.check('sections are kept off page breaks', printBlock.includes('page-break-inside:avoid'));
  s.check('the page size is set', printBlock.includes('size:A4'));

  s.done();
})();
