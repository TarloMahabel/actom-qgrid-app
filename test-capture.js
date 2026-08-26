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
  s.group('works orders can be created and generated from');
  d.querySelector('#nav button[data-go="sched"]').click(); await sleep(80);
  const woTab = d.querySelector('.tabs button[data-tab="2"]');
  s.check('scheduling has a projects and works orders tab', !!woTab);
  woTab.click(); await sleep(140);
  s.check('projects grid shown', $('page').innerHTML.includes('Projects'));
  s.check('works orders grid shown', $('page').innerHTML.includes('Works orders'));
  s.check('projects are editable', !!d.querySelector('[data-ref^="projects|"]'));
  s.check('works orders are editable', !!d.querySelector('[data-ref^="works_orders|"]'));
  s.check('a works order can be added', !!d.querySelector('[data-ref-add="works_orders"]'));
  s.check('generate offered on the works order row', !!d.querySelector('[data-generate-wo]'));

  d.querySelector('[data-generate-wo]').click(); await sleep(280);
  s.check('generate calls the RPC with the works order',
    CALLS.some(c => c[0] === 'rpc' && c[1] === 'generate_inspections'));

  const newCode = d.querySelector('[data-new="projects|code"]');
  newCode.value = 'P-26999';
  d.querySelector('[data-ref-add="projects"]').click(); await sleep(220);
  const ins = CALLS.filter(c => c[0] === 'insert' && c[1] === 'projects').pop();
  s.check('adding a project inserts it', ins && ins[2].code === 'P-26999',
    ins ? JSON.stringify(ins[2]) : 'no call');

  s.group('the generate dialog explains an empty list');
  /* Booted with no works orders: the dropdown used to render empty with no
     explanation, which reads as broken rather than unconfigured. */
  const bare = await loadApp('inspect', {
    afterMock: win => { win.GRID_TEST_DATA.works_orders = []; }
  });
  const bd = bare.window.document;
  bd.querySelector('#nav button[data-go="sched"]').click(); await bare.sleep(80);
  bd.querySelector('[data-act="generate"]').click(); await bare.sleep(140);
  s.check('it says there are no works orders',
    bare.$('mBody').innerHTML.includes('no open works orders'));
  s.check('it says where to add one',
    bare.$('mBody').innerHTML.includes('Projects'));
  s.check('it offers to take you there',
    !!bd.querySelector('[data-act="goto-works-orders"]'));

  s.done();
})();
