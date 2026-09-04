/* NCR management (Module 3).

   Shaped by what the spreadsheet register it replaces actually contained.
   Across 475 records: details 99% filled, containment 91%, but person
   responsible 49%, corrective action 19%, root cause 1%, material and
   labour cost 0%, and 368 of 475 still open.

   So the tests below weight the CLOSING half. The register half already
   worked in Excel; it is closing that never happened. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-ncr — NCR management');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.GRID_CALLS;

  s.group('the register');
  s.check('NCR management is a live module, not a later phase',
    !!d.querySelector('#nav button[data-go="ncr"]'));
  d.querySelector('#nav button[data-go="ncr"]').click(); await sleep(250);
  const text = () => $('page').textContent.replace(/\s+/g, ' ');
  s.check('NCRs are listed', text().includes('NCR-26-0001'));
  /* 475 records and every historic email use the old number. */
  s.check('the old number is kept and shown', text().includes('was 026/001'));
  s.check('a supplier NCR shows its supplier', text().includes('Schneider Electric'));
  s.check('an NCR raised from an inspection shows which', text().includes('INS-26-1189'));

  s.group('the register reports what is missing, not just what exists');
  s.check('it counts NCRs with no root cause', text().includes('No root cause'));
  s.check('it counts NCRs with no corrective action', text().includes('No corrective action'));
  s.check('it says why those two matter',
    text().includes('cannot be closed') && text().includes('nothing stops recurrence'));
  s.check('it names the figures from the old register',
    text().includes('1% root cause') || text().includes('19% corrective action'));

  s.group('the three stages');
  d.querySelector('[data-act="open-ncr"]').click(); await sleep(600);
  const detail = () => $('page').textContent.replace(/\s+/g, ' ');
  s.check('containment is a stage', detail().includes('1 · Containment'));
  s.check('root cause is a stage', detail().includes('2 · Root cause'));
  s.check('corrective action is a stage', detail().includes('3 · Corrective action'));
  s.check('progress through them is shown', detail().includes('Cause identified'));
  s.check('containment is distinguished from corrective action',
    detail().includes('stop the problem spreading') &&
    detail().includes('what changes so'));

  s.group('root cause is coded, not free text');
  s.check('a cause can be chosen', !!$('nCause'));
  s.check('the causes are grouped by category',
    $('nCause').innerHTML.includes('Method') || $('nCause').innerHTML.includes('Material'));
  s.check('there is room for the specifics too', !!$('nCauseDetail'));
  $('nCause').value = '1';
  $('nCauseDetail').value = 'First-off not checked against the drawing';
  d.querySelector('[data-act="save-ncr-cause"]').click(); await sleep(400);
  const causeSave = CALLS.filter(c => c[0] === 'update' && c[1] === 'ncrs').pop();
  s.check('saving the cause writes a coded value',
    causeSave && causeSave[2].root_cause_id === 1, causeSave ? JSON.stringify(causeSave[2]) : 'none');

  s.group('corrective actions are owned rows');
  d.querySelector('[data-act="add-ncr-action"]').click(); await sleep(200);
  s.check('an action asks what will be done', !!$('aAct'));
  s.check('and who owns it', !!$('aOwner'));
  s.check('and when by', !!$('aDue'));
  d.querySelector('[data-act="save-ncr-action"]').click(); await sleep(250);
  s.check('an empty action is refused',
    !CALLS.some(c => c[0] === 'insert' && c[1] === 'ncr_actions'));
  $('aAct').value = 'Machine setter to check the first-off against the drawing.';
  $('aOwner').value = 'u2';
  $('aDue').value = '2026-09-30';
  d.querySelector('[data-act="save-ncr-action"]').click(); await sleep(450);
  const ins = CALLS.filter(c => c[0] === 'insert' && c[1] === 'ncr_actions').pop();
  s.check('a complete action is saved', !!ins);
  s.check('with its owner and due date',
    ins && ins[2].owner_id === 'u2' && ins[2].due_date === '2026-09-30');

  s.group('closing refuses what the old register allowed');
  /* 368 of 475 sat open with no cause and no action. Closing now requires
     both, and every action verified. */
  const noCause = await loadApp('inspect');
  const ncd = noCause.window.document;
  ncd.querySelector('#nav button[data-go="ncr"]').click(); await noCause.sleep(250);
  ncd.querySelector('[data-act="open-ncr"]').click(); await noCause.sleep(600);
  ncd.querySelector('[data-act="do-close-ncr"]').click(); await noCause.sleep(450);
  const closeCall = noCause.window.GRID_CALLS
    .filter(c => c[0] === 'rpc' && c[1] === 'close_ncr').pop();
  s.check('closing goes through the database, not the browser', !!closeCall);
  s.check('an NCR with no root cause is not closed',
    noCause.window.GRID_TEST_DATA.v_ncr_list[0].status !== 'closed');
  s.check('and the reason is shown',
    (ncd.querySelector('.toast') || {}).textContent?.includes('root cause'),
    (ncd.querySelector('.toast') || {}).textContent || 'no toast');

  s.group('raising one from a fault already found');
  /* The reason to build this inside Grid: the inspection, the panel and the
     photographs are already here. In the spreadsheet they were unconnected. */
  const wb = await loadApp('inspect');
  const wd = wb.window.document;
  wd.querySelector('#nav button[data-go="work"]').click(); await wb.sleep(80);
  wd.querySelector('.tabs button[data-tab="3"]').click(); await wb.sleep(250);
  const raise = wd.querySelector('[data-act="raise-ncr"]');
  s.check('a failed check offers to raise an NCR', !!raise);
  raise.click(); await wb.sleep(320);
  /* Normalised: the phrase wraps across a newline in the template, so a raw
     textContent check fails against copy that reads perfectly on screen. */
  const flat = el => el.textContent.replace(/\s+/g, ' ');
  s.check('it says what comes across with it',
    flat(wb.$('mBody')).includes('come across with it'));
  /* A checkpoint fault has no description of its own — the checkpoint IS the
     description — so the field is pre-filled rather than left blank, which
     would read as nothing having come across. */
  s.check('the details are pre-filled from the fault',
    wb.$('cDetails').value.length > 0, JSON.stringify(wb.$('cDetails').value));
  wb.$('cPart').value = 'MV-118-07';
  wd.querySelector('[data-act="save-ncr"]').click(); await wb.sleep(500);
  const raised = wb.window.GRID_CALLS.filter(c => c[0] === 'insert' && c[1] === 'ncrs').pop();
  s.check('the NCR links back to the fault', raised && !!raised[2].failed_check_id,
    raised ? JSON.stringify(raised[2]).slice(0, 90) : 'no insert');
  s.check('and to the inspection', raised && !!raised[2].inspection_id);
  s.check('the origin is recorded as a fault list',
    raised && raised[2].origin === 'fault_list');

  s.group('severity and supplier are proper fields');
  const nn = await loadApp('inspect');
  const nnd = nn.window.document;
  nnd.querySelector('#nav button[data-go="ncr"]').click(); await nn.sleep(200);
  nnd.querySelector('[data-act="new-ncr"]').click(); await nn.sleep(250);
  s.check('severity is asked for', !!nn.$('cSeverity'));
  /* 7% filled in the old register, so any report built on it lied. */
  s.check('it says why it is required',
    nn.$('mBody').textContent.replace(/\s+/g, ' ').includes('7% filled'));
  s.check('supplier is its own field, not a department', !!nn.$('cSupplier'));
  s.check('and says why supplier is separate',
    nn.$('mBody').textContent.replace(/\s+/g, ' ').includes('column called Department'));
  s.check('quantity has a unit', !!nn.$('cQtyUnit'));
  nn.$('cPart').value = 'Rating plate';
  nn.$('cDetails').value = 'Bus section rated normal current is wrong.';
  nn.$('cOrigin').value = 'supplier';
  nnd.querySelector('[data-act="save-ncr"]').click(); await nn.sleep(350);
  s.check('a supplier NCR without a supplier is refused',
    !nn.window.GRID_CALLS.some(c => c[0] === 'insert' && c[1] === 'ncrs'));
  s.check('and says to name them',
    (nnd.querySelector('.toast') || {}).textContent?.includes('Name the supplier'));

  s.group('the analysis the pivots used to do');
  const an = await loadApp('inspect');
  const and = an.window.document;
  and.querySelector('#nav button[data-go="ncr"]').click(); await an.sleep(200);
  and.querySelector('.tabs button[data-tab="1"]').click(); await an.sleep(250);
  s.check('repeat causes has its own tab', an.$('page').textContent.includes('Repeat causes'));
  s.check('it counts by cause and month', an.$('page').textContent.includes('Supplier defect'));
  s.check('it says why a repeat matters',
    an.$('page').textContent.includes('did not work'));
  and.querySelector('.tabs button[data-tab="3"]').click(); await an.sleep(250);
  s.check('suppliers are reported separately',
    an.$('page').textContent.includes('Schneider Electric'));

  s.group('the module degrades before migration 014');
  const old = await loadApp('inspect', {
    afterMock: win => {
      delete win.GRID_TEST_DATA.v_ncr_list;
      delete win.GRID_TEST_DATA.ncr_actions;
      delete win.GRID_TEST_DATA.root_causes;
    }
  });
  const od = old.window.document;
  od.querySelector('#nav button[data-go="ncr"]').click(); await old.sleep(250);
  s.check('it says there is nothing yet rather than breaking',
    old.$('page').textContent.includes('No NCRs yet'));
  s.check('and points at raising one from a failed check',
    old.$('page').textContent.includes('failed check'));

  s.done();
})();
