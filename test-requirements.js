/* Requirements matrix and the hold-point feature switch. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-requirements — matrix and hold points');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.QG_CALLS;

  d.querySelector('#nav button[data-go="req"]').click(); await sleep(80);
  s.check('a row per product family', d.querySelectorAll('.mx tbody tr').length === 2);
  s.check('a column per stage',
    d.querySelectorAll('.mx thead th').length === w.QG_TEST_DATA.manufacturing_stages.length + 1);

  s.group('hold points are off for this division');
  s.check('no hold-point legend shown', !$('page').innerHTML.includes('blocks the works order'));
  d.querySelector('[data-cell]').click(); await sleep(80);
  s.check('cell editor opens', $('modal').classList.contains('open'));
  s.check('template picker offered', !!$('cTpl'));
  s.check('hold point not offered as a level',
    !Array.from($('cLvl').options).some(o => o.value === 'hold'));
  d.querySelector('[data-act="save-cell"]').click(); await sleep(250);
  s.check('saving the cell writes to inspection_requirements',
    CALLS.some(c => ['insert', 'update'].includes(c[0]) && c[1] === 'inspection_requirements'));
  s.done();
})();
