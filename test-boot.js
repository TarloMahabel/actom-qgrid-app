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
    read('app.js').includes('app.js loaded — build'));

  s.group('the visual system holds together');
  const tok = read('tokens.css'), sheet = read('styles.css');

  /* The brief's palette. Checked as values rather than as names, because
     a token renamed to something sensible while keeping the old colour
     is not the failure worth catching. */
  s.check('the canvas is near-white', /--bg:#FAFBFC/i.test(tok));
  s.check('the sidebar sits a shade off it', /--side:#F4F6F9/i.test(tok));
  s.check('one primary blue', /--brand:#3B82F6/i.test(tok));
  s.check('ink is charcoal-blue, not black', /--ink:#1E293B/i.test(tok));
  s.check('hairline cool-grey borders', /--line:#E2E8F0/i.test(tok));
  s.check('radii stay restrained', /--r:8px/.test(tok));

  /* A whole card tinted red reads as an alarm when it is a number
     slightly under target. */
  /* The brief's reference carries status in the colour of the line under
     the figure. 0.27 used a left stripe -- and a duplicated rule gave
     every card one, so cards with nothing wrong carried a coloured edge. */
  s.check('status is the line under the figure, not a stripe or a fill',
    /\.kpi\.alert \.d\{color:var\(--bad\)/.test(sheet) && !/\.kpi[^{]*\{[^}]*border-left/.test(sheet));
  s.check('figures are tabular so columns of them line up', /font-variant-numeric:tabular-nums/.test(sheet));

  /* :focus-visible rather than :focus, so a mouse click leaves no ring —
     the reason rings get removed altogether, which is the wrong fix. */
  s.check('keyboard focus is visible', /button:focus-visible/.test(sheet) && /outline:2px solid var\(--brand\)/.test(sheet));
  s.check('reduced motion is honoured', /prefers-reduced-motion:reduce/.test(sheet));

  /* font-src is 'self', so a Google webfont is refused and the page
     falls back silently. Better to choose the fallback deliberately. */
  s.check('no webfont is requested that the CSP would refuse',
    !/@import\s+url\(|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(sheet + tok));
  /* Sora and Manrope, self-hosted: font-src 'self' refuses Google Fonts,
     and same-origin files need no change to it. */
  s.check('the brief\'s fonts are self-hosted', /src:url\("fonts\/sora-latin\.woff2"\)/.test(tok)
    && /src:url\("fonts\/manrope-latin\.woff2"\)/.test(tok)
    && fs.existsSync(app('fonts/sora-latin.woff2')) && fs.existsSync(app('fonts/manrope-latin.woff2')));
  s.check('with their licences alongside', fs.existsSync(app('fonts/OFL-Sora.txt')) && fs.existsSync(app('fonts/OFL-Manrope.txt')));
  s.check('and preloaded so text does not change face on first load',
    /rel="preload" href="fonts\/manrope-latin\.woff2" as="font" type="font\/woff2" crossorigin/.test(read('index.html')));
  s.check('accented-name subsets load only when needed', (tok.match(/unicode-range:/g) || []).length === 4);

  s.group('the treatment reaches every component, not just the dashboard');
  const sh = read('styles.css');

  /* The module numbers are gone (0.28.2): they identified nothing a name
     did not, and took the attention the active marker should have. */
  s.check('the menu carries no module numbers', !/class="num"/.test(read('app.js')));
  s.check('the active module is a card lifted off the menu, as in the brief',
    /\.nav button\.on\{background:var\(--card\)/.test(sh) && /\.nav button\.on \.ni\{color:var\(--brand\)\}/.test(sh));
  /* The headings were hard to make out: too close to the items in size,
     colour and spacing. Icons indent every item so headings sit flush
     left; a rule and space separate the sections. */
  s.check('every menu item carries an icon', /\$\{navIcon\(n\.id\)\}<span>/.test(read('app.js')));
  s.check('section headings are separated by space and a rule',
    /\.nav \.grp\{[^}]*padding:1\dpx[^}]*border-top:1px solid var\(--line\)/.test(sh));
  s.check('the division sits at the foot of the menu', /class="divnm" id="sideDivision"/.test(read('index.html')));
  s.check('the eyebrow comes before the title', /<div class="eyebrow">\$\{esc\(navGroup\(m\.id\)\)\}<\/div>\s*<h1>/.test(read('app.js')));
  s.check('the page eyebrow names the section, not a number',
    /<div class="eyebrow">\$\{esc\(navGroup\(m\.id\)\)\}<\/div>/.test(read('app.js')));

  /* A solid blue pill on every module's tab bar competes with the
     primary action, which should be the only solid blue on a page. */
  s.check('tabs are an underline, not a filled block',
    /\.tabs button\.on\{background:transparent/.test(sh));

  /* The filled header band made every table look like a spreadsheet,
     which is the thing this system replaces. */
  s.check('tables have a rule, not a grey header band',
    /th\{[^}]*background:transparent/.test(sh));
  s.check('rows respond to the pointer', /tbody tr:hover td/.test(sh));

  /* Panels stay in the brief's 4-8px range. Capsules -- the nav badge,
     the toggle, the mock flag -- keep their fully-rounded form; a capsule
     at 8px reads as a mistake rather than as restraint. */
  s.check('panel radii stay in range',
    !/border-radius:1[1-9]px/.test(sh) && !/border-radius:[2-9]\d px/.test(sh));
  s.check('deferred modules are dimmed but readable', /\.nav button\.off\{opacity:\.6/.test(sh));

  s.group('wide screens use their width');
  const sheet2 = read('styles.css'), appjs = read('app.js');
  /* At 1620px the content stopped and a wide monitor showed a third of
     itself as empty canvas. */
  /* A numeric cap; the print rule's max-width:none is the opposite. */
  s.check('the page has no width cap', !/(^|[^.\w])\.page\{[^}]*max-width:\s*\d/m.test(sheet2));
  s.check('there is no page footer', !/foot\(\)/.test(appjs) && !/^\.foot\{/m.test(sheet2));
  s.check('the sign-in screen keeps its own footer style',
    /\.gatebox \.foot\{[^}]*text-align:center/.test(sheet2));
  /* With the cap gone a fixed 760-unit chart stretched to 2560px drew its
     labels at about 24px. It is drawn at its real width instead. */
  s.check('charts are drawn at the width they are shown', /width: chartWidth\(/.test(appjs));
  /* Dashboard charts are drawn through fitBox, small, then redrawn by
     fitCharts at the width and height the layout actually gave them. */
  s.check('both dashboard charts start from an estimated width',
    /fitBox\("monthChart"[\s\S]{0,400}width: chartWidth\(/.test(appjs) && /fitBox\("stageChart"[\s\S]{0,300}width: chartWidth\(/.test(appjs));
  s.check('and are redrawn at the measured width', /width: Math\.max\(stacked \? 460 : 260, w\)/.test(appjs));
  s.check('the After Sales charts pass their width', (appjs.match(/better: "lower", width: chartWidth\(1\)/g) || []).length === 2);
  /* Height is what is left in the card below the header -- measured, not
     card minus chart, which with the card stretched is the empty space. */
  s.check('charts are fitted to the height the layout gives them',
    /c\.bottom - b\.top - below/.test(appjs) && /requestAnimationFrame\(fitCharts\)/.test(appjs));
  /* A dashboard you have to scroll is one whose bottom half nobody reads. */
  s.check('the dashboard page is one screen tall on a large display',
    /\.page\.fill\{[^}]*height:calc\(100vh - 52px\)/.test(sh) && /\$\("page"\)\.classList\.toggle\("fill", exec\)/.test(appjs));
  s.check('the charts row takes the spare height but never less than its content',
    /grid-template-rows:auto minmax\(min-content,1fr\) auto/.test(sh));
  /* The phone minimum stretched desktop charts proportionally, 439px tall
     in a 300px space. */
  s.check('the phone minimum chart width does not apply on a desktop grid',
    /@media\(min-width:760px\)\{\.execgrid \.chartbox > svg\{min-width:0\}\}/.test(sh));
  s.check('the quieter chart series is outlined to meet 3:1', /"#E2E8F0", opts\.names\[0\], r\.k, "#7D8DA3"/.test(appjs));
  s.check('a division without 024 gets the stage chart, not an empty one', /S\.inspByMonth = ibm\.error \? null/.test(appjs));
  s.check('and are redrawn when the window changes size', /chartResizeT = setTimeout/.test(appjs));
  /* auto-fill kept an empty fifth track for four cards and left a column
     of white on a 2560px screen. */
  s.check('help fills the row rather than leaving empty columns', /repeat\(auto-fit,minmax\(440px/.test(sheet2));

  s.group('the type is easy to read');
  const tk = read('tokens.css'), aj = read('app.js');
  /* Thirty sizes, sixty of them between 9 and 11.5px, and small capitals
     tracked out to .16em: the hardest combination to read on a tablet. */
  const sizes = [...sh.matchAll(/font-size:([0-9.]+)px/g)].map(m => +m[1]);
  s.check('nothing in the stylesheet is below 12px', Math.min(...sizes) >= 11.5, Math.min(...sizes) + 'px');
  s.check('a short scale, not thirty sizes', new Set(sizes).size <= 16, new Set(sizes).size + ' sizes');
  const lb = aj.slice(aj.indexOf('function lineBarChart'), aj.indexOf('\nfunction ', aj.indexOf('function lineBarChart') + 10));
  const chartSizes = [...lb.matchAll(/font-size="([0-9.]+)"/g)].map(m => +m[1]);
  s.check('nor is any text inside a chart', Math.min(...chartSizes) >= 12, Math.min(...chartSizes) + 'px');
  const tracking = [...sh.matchAll(/letter-spacing:(\.[0-9]+)em/g)].map(m => +m[1]);
  /* Small capitals need a little spacing to stay legible; it was .16em at
     9.5px that made the old labels hard to read, not spacing itself. */
  s.check('small capitals are not tracked out', Math.max(...tracking) <= .1, Math.max(...tracking) + 'em');
  s.check('card titles are in the case they are written in',
    /\.card h3\{[^}]*text-transform:none/.test(sh));
  s.check('body text is 15px', /body\{[^}]*font-size:15px/.test(sh));
  /* The old muted grey was 4.40:1 on the sidebar, under WCAG AA. */
  s.check('secondary text clears AA with margin', /--muted:#4F5D72/.test(tk) && /--ink-2:#334155/.test(tk));
  s.check('a reference never breaks across lines', /\.id\{[^}]*white-space:nowrap/.test(sh));

  s.done();
})();
