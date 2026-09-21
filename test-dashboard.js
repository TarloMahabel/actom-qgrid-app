/* The monthly quality review: faults per project, and the actions arising. */
const { loadApp, suite, REPO } = require('./test/harness');

(async () => {
  const s = suite('test-dashboard — faults per project and actions');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.GRID_CALLS;

  d.querySelector('#nav button[data-go="dash"]').click(); await sleep(80);

  s.group('tabs');
  const tabs = Array.from(d.querySelectorAll('.tabs button')).map(b => b.textContent);
  s.check('faults per project has its own tab', tabs.some(t => /Faults per project/.test(t)));
  s.check('actions has its own tab', tabs.some(t => /Actions/.test(t)));

  s.group('the chart');
  d.querySelector('.tabs button[data-tab="1"]').click(); await sleep(220);
  const html = $('page').innerHTML, text = $('page').textContent;
  s.check('a chart is drawn', html.includes('<svg'));
  s.check('nothing is fetched to draw it', !/<script|cdn|unpkg/i.test(html));
  s.check('one segment per project and category', (html.match(/<rect/g) || []).length === 6);
  s.check('the total sits above each bar', text.includes('348'));
  s.check('segment values are labelled', text.includes('184'));
  s.check('projects are ordered tallest first',
    text.indexOf('AT9119.1') < text.indexOf('AX9090.1'));

  /* Several defect codes roll up into one legend entry — incorrect and
     missing labels are both Labelling & Identification. Without that the
     legend has fourteen entries and says nothing. */
  s.check('categories group codes together', text.includes('Labelling & Identification'));
  s.check('the legend carries totals', /Labelling & Identification\s*143/.test(text.replace(/\s+/g, ' ')));

  s.group('the period');
  s.check('a month can be chosen', !!$('period'));
  const before = $('page').textContent;
  $('period').value = '2020-01';
  $('period').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(200);
  s.check('an empty month says so, rather than showing a blank chart',
    $('page').textContent.includes('No faults recorded in this period'));
  s.check('and says how to tell good news from no data',
    $('page').textContent.includes('Register will tell you which'));
  $('period').value = new Date().toISOString().slice(0, 7);
  $('period').dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(200);
  s.check('choosing the month back restores it', $('page').textContent.includes('348'));

  s.group('actions');
  d.querySelector('.tabs button[data-tab="2"]').click(); await sleep(200);
  s.check('existing actions are listed', $('page').textContent.includes('Wiring Defects'));
  s.check('a deadline is shown', $('page').textContent.includes('2026-09-30'));
  s.check('status can be changed in place', !!d.querySelector('[data-action-set]'));

  const sel = d.querySelector('[data-action-set]');
  sel.value = 'closed';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(250);
  s.check('changing status is saved',
    CALLS.some(c => c[0] === 'update' && c[1] === 'quality_actions' && c[2].status === 'closed'));

  d.querySelector('[data-act="add-action"]').click(); await sleep(150);
  s.check('an action can be added', !!$('aItem') && !!$('aAction'));
  d.querySelector('[data-act="save-action"]').click(); await sleep(200);
  s.check('an empty action is refused',
    !CALLS.some(c => c[0] === 'insert' && c[1] === 'quality_actions'));
  $('aItem').value = 'Missing components';
  $('aAction').value = 'Weekly parts shortage report from Production Control.';
  $('aDeadline').value = '2026-09-30';
  d.querySelector('[data-act="save-action"]').click(); await sleep(300);
  const ins = CALLS.filter(c => c[0] === 'insert' && c[1] === 'quality_actions').pop();
  s.check('a complete action is saved', !!ins);
  s.check('it is recorded against the chosen month',
    ins && ins[2].period.startsWith(new Date().toISOString().slice(0, 7)));

  s.group('the dashboard still works before migration 012');
  /* A division that has not run the migration should still be able to
     capture inspections — the review views are not load-bearing. */
  const old = await loadApp('inspect', {
    afterMock: win => {
      delete win.GRID_TEST_DATA.v_faults_by_project;
      delete win.GRID_TEST_DATA.quality_actions;
    }
  });
  const od = old.window.document;
  od.querySelector('#nav button[data-go="dash"]').click(); await old.sleep(80);
  s.check('the dashboard still loads', old.$('page').innerHTML.length > 500);
  od.querySelector('.tabs button[data-tab="1"]').click(); await old.sleep(200);
  s.check('and says there is nothing to show rather than breaking',
    old.$('page').textContent.includes('No faults recorded'));

  s.group('the executive view across modules');
const exSrc = require('fs').readFileSync(require('path').join(REPO, 'apps/inspect/app.js'), 'utf8');
const ex023 = require('fs').readFileSync(require('path').join(REPO, 'db/migrations/023-executive-dashboard.sql'), 'utf8');

s.check('the dashboard opens on it', /if \(S\.tab === 0\) return head\(m\) \+ vExec\(\)/.test(exSrc));
s.check('figures are counted in the database, not from the capped registers',
  /v_scorecard/.test(exSrc) && /quietly stops counting/.test(exSrc));
s.check('a division without the migration is told so rather than shown zeroes',
  /023-executive-dashboard\.sql/.test(exSrc));

/* A tile reading 0 against Calibration says nothing is overdue. The truth
   is that nobody is tracking it. Opposite claims. */
s.check('their absence is stated rather than shown as zero', /Not built yet/.test(exSrc));
s.check('with the reason, not just the list', /would read as nothing overdue/.test(exSrc));

/* Cost of quality is normally a share of turnover. This system does not
   know turnover, and a percentage against a denominator nobody holds gets
   quoted and cannot be defended. */
s.check('cost of quality is money, not a percentage of turnover',
  !/of production value/.test(exSrc));
s.check('and says how many records carry a cost',
  /records that carry a cost/.test(exSrc) && /records_with_cost/.test(ex023));
s.check('the financial year comes from the division',
  /fy_start\(\)/.test(ex023) && /fy_start_month/.test(ex023));
s.check('the yield target is a setting, not a constant', /fpy_target/.test(ex023));

/* `open` on an NCR is the first rung of the ladder, not "not closed" --
   the mistake that reported nought open NCRs in v0.21.3. */
s.check('open nonconformances means not closed', /from ncrs where closed_at is null/.test(ex023));

s.done();
})();
