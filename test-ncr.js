/* NCR management (Module 3).

   Shaped by what the spreadsheet register it replaces actually contained.
   Across 475 records: details 99% filled, containment 91%, but person
   responsible 49%, corrective action 19%, root cause 1%, material and
   labour cost 0%, and 368 of 475 still open.

   So the tests below weight the CLOSING half. The register half already
   worked in Excel; it is closing that never happened. */
const { loadApp, suite, REPO } = require('./test/harness');
const read = p => require('fs').readFileSync(require('path').join(REPO, p), 'utf8');

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

  s.group('reports');
  d.querySelector('#nav button[data-go="ncr"]').click(); await sleep(120);
  d.querySelector('.tabs button[data-tab="4"]').click(); await sleep(160);
  const rep = $('page').textContent;
  s.check('closure time is reported as a median', rep.includes('Median closure'));
  s.check('causes are grouped by category', rep.includes('Causes by category'));
  s.check('with a running cumulative share', /cum\./.test(rep));
  s.check('the open population is banded by age',
    rep.includes('Open population by age') && rep.includes('Over 90 days'));
  s.check('closure time is broken down by severity', rep.includes('Closure time by severity'));
  s.check('repeat parts are listed', rep.includes('Parts raised more than once'));
  /* A closure with no cause or no action is the one an auditor samples, so it is
     counted on its own rather than folded into the closed total. */
  s.check('incomplete closures are counted separately', rep.includes('Incomplete closures'));

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

  s.group('the printable NCR');
/* Step 6 of NCR-PLAN. The register carried an Open button and a comment
   saying the report did not exist yet; a dead control is worse than a
   missing one, so the comment was right until the thing was built. */
const appSrc = require('fs').readFileSync(require('path').join(REPO, 'apps/inspect/app.js'), 'utf8');
s.check('the register offers a report', /data-act="ncr-report"/.test(appSrc));
s.check('so does the detail view', (appSrc.match(/data-act="ncr-report"/g) || []).length >= 2);
s.check('the action has a handler', /case "ncr-report"/.test(appSrc));
s.check('there is a loader', /async function openNcrReport/.test(appSrc));
s.check('and a view', /function vNcrPrint/.test(appSrc));
s.check('the print view dispatches on the kind of record',
  /\(S\.report \|\| \{\}\)\.kind === "ncr"/.test(appSrc));
s.check('the placeholder comment is gone', !/printable NCR is step 6/.test(appSrc));

/* The things an auditor samples. Each was absent from the old register
   and each is why this report exists at all. */
for (const [what, needle] of [
  ['the root cause', 'Root cause'],
  ['corrective action, with verified separate from done', 'Verified'],
  ['a warning when no corrective action is recorded', 'No corrective action is recorded'],
  ['a warning when no root cause is recorded', 'cannot be closed without one'],
  ['containment', 'Containment'],
  ['the cost breakdown', 'Cost of this nonconformance'],
  ['photographs', 'Photographs'],
  ['who closed it and when', 'Closure'],
  ['who printed it', 'Printed']
]) s.check(`the report shows ${what}`, appSrc.includes(needle));

s.check('costs are in Rands', /money = v => Number\(v \|\| 0\) \? "R" \+/.test(appSrc));
/* Returning an NCR report to the inspection workbench is the kind of
   small wrongness that makes people distrust the navigation. */
s.check('closing an NCR report returns to the register',
  /wasNcr \) \{ S\.view = "ncr"/.test(appSrc.replace(/\s+/g, ' ')) ||
  /if \(wasNcr\) \{ S\.view = "ncr"/.test(appSrc));

s.group('downloading the register');
/* A register you cannot get out of the system is a register somebody
   keeps a private copy of in Excel, which is how the last one ended up
   with 475 records and 1% root cause. */
s.check('the register offers a download', /data-act="ncr-csv"/.test(appSrc));
s.check('the action has a handler', /case "ncr-csv"/.test(appSrc));
s.check('it exports every row, not the 120 drawn', /const rows = S\.ncrs \|\| \[\]/.test(appSrc));

/* Excel executes a cell beginning = + - or @. Every text field in this
   register was typed by an inspector, so this is a live exposure and not
   a theoretical one. */
s.check('formula characters are neutralised', /\^\[=\+\\-@/.test(appSrc));
s.check('quotes are doubled and fields containing separators are quoted',
  /replace\(\/"\/g, '""'\)/.test(appSrc));
s.check('a byte order mark is written so Excel reads UTF-8', /\\ufeff/.test(appSrc));
s.check('a blob is used rather than a data URL', /new Blob\(/.test(appSrc) && !/href = "data:text\/csv/.test(appSrc));
s.check('the object URL is released', /revokeObjectURL/.test(appSrc));
s.check('the file names the division and the date', /NCR-register-\$\{DIVISION\.code/.test(appSrc));
s.check('an empty register says so rather than downloading nothing',
  /nothing in the register to download/.test(appSrc));

s.group('what was done before, under this cause');
/* The feature exists because a generator would be worse than nothing:
   filling the corrective action field with something plausible makes the
   numbers improve while recurrence carries on. Every assertion here is
   about it staying recall rather than becoming advice. */
s.check('prior actions are shown on an NCR', /function priorActions/.test(appSrc));
s.check('only once a root cause is recorded', /const cause = row && row\.root_cause;\s*if \(!cause\) return ""/.test(appSrc.replace(/\n\s*/g, ' ')) || /if \(!cause\) return ""/.test(appSrc));
s.check('it is shown before the detail, not after',
  appSrc.indexOf('+ prior') < appSrc.indexOf('<h3>What happened</h3>'));
s.check('no model is involved', !/priorActions[\s\S]{0,2000}?Assist\.|priorActions[\s\S]{0,2000}?api\/chat/.test(appSrc));
s.check('an action that was verified and came back is marked', /came back \$\{again\}/.test(appSrc));
s.check('a cause with peers but no actions says so', /none carries a corrective action/.test(appSrc));
s.check('a first-of-its-kind cause says so', /first nonconformance recorded/.test(appSrc));
s.check('it states that it is not a recommendation', /not a\s*\n?\s*recommendation/.test(appSrc));
/* Null part numbers must not be matched to each other, or missing data
   manufactures recurrences. */
s.check('recurrence needs a part number on both sides', /if \(!src\.part_no\) return 0/.test(appSrc));

const mig018 = read('db/migrations/018-actions-by-cause.sql');
s.check('the view exists', /create or replace view v_ncr_actions_by_cause/.test(mig018));
s.check('it is security_invoker', /v_ncr_actions_by_cause with \(security_invoker = on\)/.test(mig018));
s.check('it is granted to authenticated', /grant select on v_ncr_actions_by_cause/.test(mig018));
s.check('it carries the recurrence count', /recurred_on_same_part/.test(mig018));
s.check('null part numbers are excluded from the recurrence match',
  /later\.part_no is not null/.test(mig018) && /n\.part_no is not null/.test(mig018));
s.check('it states its prerequisites', /PREREQUISITES|prereq/.test(mig018));

s.done();
})();
