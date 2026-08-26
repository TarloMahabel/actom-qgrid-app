/* Boots the app with the REAL vendored Supabase client — no mock.
   The other suites substitute vendor/supabase.js, so nothing was checking
   that the actual bundle loads, exposes window.supabase, and lets the
   wrapper build window.QG. A deploy where that file is missing or served
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
const CONFIG = 'window.QGRID_CONFIG={url:"https://abcdefghij.supabase.co",key:"eyJfake",' +
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

  s.group('the wrapper builds window.QG');
  w.eval(CONFIG);
  w.eval(read('supabase.js'));
  s.check('window.QG created', typeof w.QG === 'object');
  for (const k of ['supabase', 'DIVISION', 'BUILD', 'signIn', 'signInWithPassword',
                   'signOutNow', 'currentProfile', 'explain']) {
    s.check(`QG.${k} exported`, w.QG[k] !== undefined);
  }
  s.check('a real client was constructed', typeof w.QG.supabase.from === 'function');

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
  s.check('ACTOM mark painted', !el('loaderMark') || el('loaderMark').innerHTML.includes('svg'));
  s.check('sign-in screen shown', !el('gateSignIn').classList.contains('hidden'));
  s.check('dev password box hidden in a production build',
    el('devSignIn').classList.contains('hidden'));

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

  s.group('a hang is reported, not endured');
  /* The real failure this covers: supabase.auth.getSession() never settling.
     No exception, no console output, splash screen forever. */
  const d4 = makeDom(); const w4 = d4.window;
  w4.eval(read('vendor/supabase.js'));
  w4.eval(CONFIG);
  w4.eval(read('supabase.js'));
  // Replace getSession with a promise that never resolves.
  w4.QG.supabase.auth.getSession = () => new Promise(() => {});
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
    read('app.js').includes('QGrid app.js loaded'));

  s.done();
})();
