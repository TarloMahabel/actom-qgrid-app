/* Administration: activation, roles, reference lists, feature switch. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-admin — administration');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.QG_CALLS;

  d.querySelector('#nav button[data-go="adm"]').click(); await sleep(80);
  s.check('inactive user shows an Activate action', $('page').innerHTML.includes('Activate'));
  s.check('inactive user flagged as awaiting activation',
    $('page').innerHTML.includes('Awaiting activation'));
  d.querySelector('[data-toggle-active]').click(); await sleep(250);
  s.check('activation writes to profiles',
    CALLS.some(c => c[0] === 'update' && c[1] === 'profiles'));

  d.querySelector('.tabs button[data-tab="1"]').click(); await sleep(80);
  s.check('reference lists shown', $('page').innerHTML.includes('Manufacturing stages'));

  d.querySelector('.tabs button[data-tab="2"]').click(); await sleep(80);
  s.check('hold point switch present', !!d.querySelector('[data-act="toggle-hp"]'));
  d.querySelector('[data-act="toggle-hp"]').click(); await sleep(250);
  s.check('switch writes to division_profile',
    CALLS.some(c => c[0] === 'update' && c[1] === 'division_profile'));

  d.querySelector('.tabs button[data-tab="3"]').click(); await sleep(200);
  s.check('audit trail read', CALLS.length > 0 && $('page').innerHTML.includes('Audit trail'));
  s.done();
})();
