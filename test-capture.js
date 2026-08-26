/* Inspection capture: the form, tolerance handling, blocked instruments,
   write-through and submit. This is the path an inspector uses all day. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-capture — inspection capture');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.GRID_CALLS;

  d.querySelector('#nav button[data-go="work"]').click(); await sleep(60);
  const start = d.querySelector('[data-open-capture]');
  s.check('queue offers an inspection to start', !!start);
  start.click(); await sleep(200);

  s.group('form built from the template');
  s.check('capture form rendered', !!$('captureForm'));
  s.check('measurement field present', !!d.querySelector('[data-num="i3"]'));
  s.check('pass/fail control present', !!d.querySelector('[data-field="i4"] [data-outcome="fail"]'));
  s.check('instruction rendered read-only', $('page').innerHTML.includes('WI-MV-14'));
  s.check('overdue instrument disabled in the picker', (() => {
    const sel = d.querySelector('[data-equip="i5"]');
    return sel && Array.from(sel.options).some(o => o.disabled && o.textContent.includes('MME-0412'));
  })());

  s.group('tolerance decides pass or fail, not the inspector');
  const num = d.querySelector('[data-num="i3"]');
  num.value = '61';
  num.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(700);
  const up = CALLS.filter(c => c[0] === 'upsert' && c[1] === 'inspection_results').pop();
  s.check('answer written through as typed', !!up);
  s.check('61 Nm against 66-74 derived as a fail', up && up[2].outcome === 'fail',
    up ? JSON.stringify(up[2]) : 'no call');

  num.value = '70';
  num.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(700);
  const up2 = CALLS.filter(c => c[0] === 'upsert' && c[2].field_id === 'i3').pop();
  s.check('70 Nm inside tolerance derived as a pass', up2 && up2[2].outcome === 'pass');

  s.group('failures and submit');
  d.querySelector('[data-field="i4"] [data-outcome="fail"]').click(); await sleep(500);
  const pf = CALLS.filter(c => c[0] === 'upsert' && c[2].field_id === 'i4').pop();
  s.check('pass/fail written through', pf && pf[2].outcome === 'fail');
  s.check('failure warned about before submit', $('page').innerHTML.includes('failure'));
  d.querySelector('[data-act="submit-inspection"]').click(); await sleep(300);
  s.check('submit goes through the RPC, not client-side writes',
    CALLS.some(c => c[0] === 'rpc' && c[1] === 'submit_inspection'));
  s.group('projects and works orders read as one ordered flow');
  d.querySelector('#nav button[data-go="sched"]').click(); await sleep(80);
  const woTab = d.querySelector('.tabs button[data-tab="2"]');
  s.check('scheduling has a projects and works orders tab', !!woTab);
  woTab.click(); await sleep(140);

  /* The prerequisites are shown up front. Generating depends on a published
     template and a populated matrix, and failing silently at the end of the
     flow taught the user nothing. */
  s.check('prerequisites are listed before anything else',
    $('page').innerHTML.includes('Before inspections can be generated'));
  s.check('a works order is drawn inside its project',
    $('page').innerHTML.indexOf('Add works order') > $('page').innerHTML.indexOf('works order'));
  s.check('adding a project is offered', !!d.querySelector('[data-act="add-project"]'));
  s.check('adding a works order is offered', !!d.querySelector('[data-act="add-wo"]'));
  s.check('generate sits on the works order', !!d.querySelector('[data-act="gen-wo"]'));
  s.check('how many inspections exist is shown', $('page').innerHTML.includes('generated'));

  d.querySelector('[data-act="gen-wo"]').click(); await sleep(280);
  s.check('generate calls the RPC', CALLS.some(c => c[0] === 'rpc' && c[1] === 'generate_inspections'));

  s.group('adding uses a labelled form, not a table row');
  d.querySelector('[data-act="add-project"]').click(); await sleep(120);
  s.check('project form opens', !!$('pCode') && !!$('pFamily'));
  s.check('the family field explains why it matters',
    $('mBody').innerHTML.includes('nothing generates'));
  $('pCode').value = 'P-26999'; $('pName').value = 'Test project';
  d.querySelector('[data-act="save-project"]').click(); await sleep(250);
  const ins = CALLS.filter(c => c[0] === 'insert' && c[1] === 'projects').pop();
  s.check('saving inserts the project', ins && ins[2].code === 'P-26999',
    ins ? JSON.stringify(ins[2]) : 'no call');

  d.querySelector('[data-act="add-wo"]').click(); await sleep(120);
  s.check('works order form opens', !!$('wCode') && !!$('wQty'));
  s.check('quantity explains what it drives', $('mBody').innerHTML.includes('one inspection per unit'));
  $('wCode').value = 'WO-99999';
  d.querySelector('[data-act="save-wo"]').click(); await sleep(250);
  const insW = CALLS.filter(c => c[0] === 'insert' && c[1] === 'works_orders').pop();
  s.check('saving inserts the works order', insW && insW[2].code === 'WO-99999',
    insW ? JSON.stringify(insW[2]) : 'no call');

  s.group('an empty division is guided, not left blank');
  /* Booted with nothing set up. Two empty tables and a Save button with
     nothing to save was the confusing part; this asserts the replacement
     tells the user what to do first. */
  const bare = await loadApp('inspect', {
    afterMock: win => {
      win.GRID_TEST_DATA.projects = [];
      win.GRID_TEST_DATA.works_orders = [];
      win.GRID_TEST_DATA.template_revisions.forEach(r => { r.status = 'draft'; });
      win.GRID_TEST_DATA.inspection_requirements = [];
    }
  });
  const bd = bare.window.document;
  bd.querySelector('#nav button[data-go="sched"]').click(); await bare.sleep(80);
  bd.querySelector('.tabs button[data-tab="2"]').click(); await bare.sleep(140);
  const bare_html = bare.$('page').innerHTML;
  s.check('it names the single next step', bare_html.includes('Start with a project'));
  s.check('it flags the missing published template',
    bare_html.includes('Publish one in the Form designer'));
  s.check('it flags the empty requirements matrix',
    bare_html.includes('what to inspect'));
  s.check('it links straight to the screens that fix it',
    !!bd.querySelector('[data-go="dsn"]') && !!bd.querySelector('[data-go="req"]'));
  s.check('no empty table with a dead Save button', !bare_html.includes('No unsaved changes'));

  /* Generating has exactly one home now — the works order row. The old header
     dialog was a second path to the same action and, being a dropdown, could
     not show which project or family a works order belonged to. */
  bd.querySelector('.tabs button[data-tab="0"]').click(); await bare.sleep(120);
  s.check('no duplicate generate dialog on the schedule tab',
    !bd.querySelector('[data-act="generate"]'));
  s.check('the schedule tab points at where generating happens',
    bare.$('page').innerHTML.includes('works orders'));

  s.done();
})();
