/* Boot, authentication gate, navigation, and every module and tab. */
const { loadApp, suite } = require('./test/harness');

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
  s.check('6 modules in nav', nav.length === 6, nav.length + ' found');
  s.check('later phases shown but disabled', d.querySelectorAll('#nav button.off').length === 8);

  s.group('every module and tab renders');
  const views = { dash: 4, work: 4, sched: 3, dsn: 1, req: 1, adm: 5 };
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
  s.done();
})();
