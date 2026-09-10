/* Boot, authentication gate, navigation, and every module and tab. */
const { loadApp, suite , REPO } = require('./test/harness');

(async () => {
  const s = suite('test-nav — boot, gate and navigation');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;

  s.group('load order');
  s.check('vendored client loaded, not a CDN', typeof w.supabase === 'object');
  s.check('wrapper exposed window.GRID', !!w.GRID && !!w.GRID.supabase);
  s.check('logo module loaded', !!w.ACTOM_LOGO);
  s.check('changelog loaded', Array.isArray(w.CHANGELOG) && w.CHANGELOG.length > 0);
  s.check('no script tag points at a remote origin',
    Array.from(d.querySelectorAll('script[src]')).every(x => !/^https?:/.test(x.getAttribute('src'))));

  s.group('gate');
  s.check('app shell visible after auth', !$('app').classList.contains('hidden'));
  s.check('sign-in gate hidden', $('gateSignIn').classList.contains('hidden'));
  s.check('user rendered', $('whoName').textContent.includes('Varshan'));
  s.check('division rendered', $('sideDivision').textContent.includes('MV Switchgear'));
  s.check('build tag rendered', $('buildTag').textContent.includes('test0000'));
  /* The mark is the supplied badge artwork, embedded as base64, so this
     asserts an <img> with a data URI rather than an inline <svg>. */
  s.check('ACTOM badge painted into the sidebar',
    /<img[^>]+src="data:image\/png;base64,/.test($('sideTile').innerHTML));
  s.check('the badge is embedded, not fetched',
    !/src="[^"]*\.(png|svg)"/.test($('sideTile').innerHTML));
  s.check('password sign-in offered locally only',
    !$('devSignIn').classList.contains('hidden'));

  s.group('navigation');
  const nav = Array.from(d.querySelectorAll('#nav button[data-go]'));
  s.check('8 modules in nav', nav.length === 8, nav.length + ' found');
  s.check('later phases shown but disabled', d.querySelectorAll('#nav button.off').length === 7);

  s.group('every module and tab renders');
  const views = { main: 1, dash: 4, work: 4, sched: 3, dsn: 1, req: 1, ncr: 5, adm: 5 };
  for (const [id, tabs] of Object.entries(views)) {
    d.querySelector(`#nav button[data-go="${id}"]`).click();
    await sleep(60);
    for (let t = 0; t < tabs; t++) {
      const tb = d.querySelector(`.tabs button[data-tab="${t}"]`);
      if (tb) { tb.click(); await sleep(60); }
      const len = $('page').innerHTML.length;
      s.check(`${id} tab ${t}`, len > 900, len + ' chars');
    }
  }
  s.group('the register shows what failed');
/* An inspection carrying a fault stays out of `completed` until the fault
   is dealt with, so a register filtered on status alone hid exactly the
   records people go looking for. */
const regSrc = require('fs').readFileSync(require('path').join(REPO, 'apps/inspect/app.js'), 'utf8');
s.check('the register is not filtered on completed alone',
  !/const done = S\.inspections\.filter\(i => i\.status === "completed"\);/.test(regSrc));
s.check('anything carrying a failed check is included',
  /i\.status === "completed" \|\| faulted\.has\(i\.id\)/.test(regSrc));
s.check('outstanding means not yet verified', /!f\.verified_at/.test(regSrc));
s.check('there is a filter', /data-act="reg-filter"/.test(regSrc));
s.check('the filter has a handler', /case "reg-filter"/.test(regSrc));
s.check('each filter shows how many records it holds', /pool\.filter\(test\)\.length/.test(regSrc));
s.check('an open record says why it is listed', /fault outstanding/.test(regSrc));
s.check('truncation is stated rather than silent', /showing the \$\{CAP\} most recent of/.test(regSrc));

s.done();
})();
