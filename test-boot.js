/* Boots the app with the REAL vendored Supabase client — no mock.
   The other suites substitute vendor/supabase.js, so nothing was checking
   that the actual bundle loads, exposes window.supabase, and lets the
   wrapper build window.GRID. A deploy where that file is missing or served
   as HTML looks identical to a hung splash screen, which is how the first
   deploy failed with nothing useful on screen. */
const { suite, REPO } = require('./test/harness');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const s = suite('test-boot — real client, real boot path');
const app = f => path.join(REPO, 'apps/inspect', f);
const read = f => fs.readFileSync(app(f), 'utf8');

function makeDom() {
  const dom = new JSDOM(read('index.html'),
    { url: 'https://qgrid.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.structuredClone = v => JSON.parse(JSON.stringify(v));
  dom.window.scrollTo = () => {};
  return dom;
}
const CONFIG = 'window.GRID_CONFIG={url:"https://abcdefghij.supabase.co",key:"eyJfake",' +
  'division:{code:"MVS",name:"ACTOM MV Switchgear"},build:{commit:"x",context:"production"}};';

(async () => {
  s.group('top-level declarations do not collide');
  /* THE BUG THIS EXISTS FOR.
     vendor/supabase.js declares a global `var supabase`. app.js declared a
     top-level `const supabase`. In a classic script those share one global
     lexical scope, so the browser refused to parse app.js at all:

       Uncaught SyntaxError: Identifier 'supabase' has already been declared

     Nothing ran and the splash screen hung. Neither eval() nor jsdom
     reproduces it — both give each script its own scope, so nine suites
     reported green against a site that could not boot.

     Compiling the scripts CONCATENATED is faithful for this purpose: a
     browser shares the global lexical environment across classic scripts,
     so a clash between them is a clash within the concatenation too. */
  const vm = require('vm');
  const order = Array.from(read('index.html').matchAll(/<script src="([^"]+)"/g))
    .map(m => m[1].split('?')[0]);
  const combined = order.map(f =>
    f === 'config.js' ? CONFIG : fs.readFileSync(app(f), 'utf8')).join('\n;\n');
  let compileErr = null;
  try { new vm.Script(combined, { filename: 'combined.js' }); }
  catch (e) { compileErr = e.message; }
  s.check('all scripts compile together without a redeclaration',
    compileErr === null, compileErr || '');
  s.check('app.js keeps its declarations out of the global scope',
    /^\(function \(\)/m.test(read('app.js')) || !/^const \{[^}]*supabase/m.test(read('app.js')));

  s.group('every class the app applies has a CSS rule');
  /* .hidden was used twenty times and defined nowhere — lost when the mockup
     stylesheet was split into tokens.css and styles.css, because it sat above
     the :root block and fell outside both halves. The result: every screen
     rendered at once with the busy overlay permanently on top, so the site
     looked hung behind a grey sheet. .legend and .val went the same way. */
  const css = read('tokens.css') + read('styles.css');
  const defined = new Set(Array.from(css.matchAll(/\.([a-zA-Z][\w-]*)/g)).map(m => m[1]));
  const applied = new Set();
  for (const f of ['app.js', 'index.html']) {
    const t = read(f);
    for (const m of t.matchAll(/class="([^"$]+)"/g)) m[1].split(/\s+/).forEach(c => c && applied.add(c));
    for (const m of t.matchAll(/classList\.(?:add|remove|toggle)\("([\w-]+)"/g)) applied.add(m[1]);
  }
  const undefinedClasses = [...applied].filter(c => !defined.has(c)).sort();
  s.check('no class is applied without a rule', undefinedClasses.length === 0,
    undefinedClasses.join(', '));
  for (const critical of ['hidden', 'gate', 'busy', 'shell', 'legend', 'val']) {
    s.check(`.${critical} is defined`, defined.has(critical));
  }

  s.group('the vendored bundle is usable');
  const files = ['vendor/supabase.js', 'supabase.js', 'logo.js', 'changelog.js', 'app.js',
                 'tokens.css', 'styles.css', 'index.html'];
  for (const f of files) s.check(`${f} present`, fs.existsSync(app(f)));

  // index.html must reference exactly what is on disk. A missing file is served
  // as index.html by the SPA redirect and then refused for MIME mismatch.
  const refs = Array.from(read('index.html').matchAll(/<script src="([^"]+)"/g)).map(m => m[1].split('?')[0]);
  const brokenRefs = refs.filter(r => r !== 'config.js' && !fs.existsSync(app(r)));
  s.check('every script index.html references exists', brokenRefs.length === 0, brokenRefs.join(', '));
  s.check('config.js is referenced but generated', refs.includes('config.js'));

  let w = makeDom().window;
  w.eval(read('vendor/supabase.js'));
  s.check('bundle exposes window.supabase', typeof w.supabase === 'object');
  s.check('bundle exposes createClient', typeof w.supabase.createClient === 'function');

  s.group('the wrapper builds window.GRID');
  w.eval(CONFIG);
  w.eval(read('supabase.js'));
  s.check('window.GRID created', typeof w.GRID === 'object');
  for (const k of ['supabase', 'DIVISION', 'BUILD', 'signIn', 'signInWithPassword',
                   'signOutNow', 'currentProfile', 'explain']) {
    s.check(`QG.${k} exported`, w.GRID[k] !== undefined);
  }
  s.check('a real client was constructed', typeof w.GRID.supabase.from === 'function');

  s.group('a full boot with no session reaches the sign-in screen');
  const dom = makeDom(); w = dom.window;
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  w.eval(read('vendor/supabase.js'));
  w.eval(CONFIG);
  w.eval(read('supabase.js'));
  w.eval(read('logo.js'));
  w.eval(read('changelog.js'));
  w.eval(read('app.js'));
  await new Promise(r => setTimeout(r, 1500));
  const el = id => w.document.getElementById(id);
  s.check('no uncaught errors during boot', errors.length === 0, errors.join('; '));
  s.check('loader was dismissed', !el('loader') || el('loader').className.includes('gone'));
  const mark = el('loaderMark') ? el('loaderMark').innerHTML : '';
  s.check('ACTOM badge painted on the loading screen',
    !el('loaderMark') || /src="data:image\/png;base64,/.test(mark));
  s.check('the energising line is drawn', !el('loaderMark') || mark.includes('pyl-pulse'));
  s.check('the loading screen fetches nothing',
    !/src="(?!data:)/.test(mark) && !/url\((?!#)/.test(mark));
  s.check('sign-in screen shown', !el('gateSignIn').classList.contains('hidden'));
  s.check('dev password box hidden in a production build',
    el('devSignIn').classList.contains('hidden'));
  /* Exactly one screen at a time. All three rendered together when .hidden
     had no rule, stacked down the page, and the site looked broken. */
  const screens = ['gateSignIn', 'gatePending', 'app']
    .filter(id => !el(id).classList.contains('hidden'));
  s.check('exactly one screen is visible', screens.length === 1, screens.join(', '));
  s.check('the busy overlay is dismissed', el('busy').classList.contains('hidden'));

  s.group('a broken deploy says so instead of hanging');
  // vendor/supabase.js missing entirely — the exact failure that produced a
  // splash screen with no message.
  const d2 = makeDom(); const w2 = d2.window;
  w2.eval(CONFIG);
  try { w2.eval(read('app.js')); } catch (e) { /* expected */ }
  await new Promise(r => setTimeout(r, 200));
  const body = w2.document.body.textContent;
  s.check('missing client produces a visible message', body.includes('could not start'), body.slice(0, 80));
  s.check('the message names the missing file', body.includes('vendor/supabase.js'));

  // config.js missing
  const d3 = makeDom(); const w3 = d3.window;
  w3.eval(read('vendor/supabase.js'));
  try { w3.eval(read('supabase.js')); } catch (e) { /* expected */ }
  try { w3.eval(read('app.js')); } catch (e) { /* expected */ }
  await new Promise(r => setTimeout(r, 200));
  s.check('missing config produces a visible message',
    w3.document.body.textContent.includes('not configured') ||
    w3.document.body.textContent.includes('could not start'));

  s.group('booting twice does not break realtime');
  /* The reported failure: start() ran once at the bottom of app.js and again
     from onAuthStateChange on page load. The second run re-used the existing
     realtime channel and Supabase threw
       cannot add `postgres_changes` callbacks for realtime:qgrid after `subscribe()`
     which surfaced to the user as "Grid could not start". */
  s.check('a repeat subscribe tears the old channel down first',
    read('app.js').includes('removeChannel'));
  s.check('boot is guarded against re-entry', read('app.js').includes('if (booting) return'));
  s.check('routine auth events do not re-boot',
    read('app.js').includes('TOKEN_REFRESHED'));
  s.check('a repeat sign-in for the same user is ignored',
    read('app.js').includes('uid === bootedUserId'));

  /* Behavioural, not textual: the mock now emits INITIAL_SESSION, SIGNED_IN
     and TOKEN_REFRESHED after the listener registers, exactly as the real
     client does. That is what made boot run twice. */
  const d5 = makeDom(); const w5 = d5.window;
  w5.eval(read('vendor/supabase.js'));
  w5.eval(CONFIG);
  w5.eval(read('supabase.js'));
  w5.eval(read('logo.js')); w5.eval(read('changelog.js')); w5.eval(read('app.js'));
  await new Promise(r => setTimeout(r, 900));
  const body5 = w5.document.body.textContent;
  s.check('auth events do not produce a boot failure',
    !body5.includes('could not start'),
    (body5.match(/could not start[\s\S]{0,90}/) || [''])[0].trim());

  s.group('a hang is reported, not endured');
  /* The real failure this covers: supabase.auth.getSession() never settling.
     No exception, no console output, splash screen forever. */
  const d4 = makeDom(); const w4 = d4.window;
  w4.eval(read('vendor/supabase.js'));
  w4.eval(CONFIG);
  w4.eval(read('supabase.js'));
  // Replace getSession with a promise that never resolves.
  w4.GRID.supabase.auth.getSession = () => new Promise(() => {});
  w4.eval(read('logo.js'));
  w4.eval(read('changelog.js'));
  w4.eval(read('app.js'));
  s.check('boot guards every await with a timeout',
    read('app.js').includes('withTimeout(gate('));
  s.check('the timeout message is actionable',
    read('app.js').includes('did not respond within'));
  s.check('a missing logo.js is warned about, not silently ignored',
    read('app.js').includes('logo.js did not load'));
  s.check('app.js announces itself in the console',
    read('app.js').includes('Grid app.js loaded'));

  s.done();
})();
