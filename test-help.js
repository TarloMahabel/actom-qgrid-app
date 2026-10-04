/* =====================================================================
   test-help — the help says what the application does.

   Help that is wrong is worse than none. For one release the Customer
   cares form told people a technical care needed a linked NCR after the
   rule had changed to a root cause, and a test was defending the old
   wording. Writing this help against the database, rather than from
   memory, found three more: closing a nonconformance also needs every
   corrective action VERIFIED and a Quality Engineer or above to do it,
   and inspectors can raise nonconformances, none of which the first
   draft said.

   So the content is checked against the things it describes. Rename a
   module, drop a tab, or change a closing rule, and this suite fails
   until the help is brought up to date -- rather than the help quietly
   going on describing a system that no longer exists.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, loadApp, REPO } = require('./test/harness');

(async () => {
const s = suite('test-help — the help says what the application does');
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');
const app = read('apps/inspect/app.js');
const html = read('apps/inspect/index.html');
const migs = fs.readdirSync(path.join(REPO, 'db/migrations'))
  .filter(f => f.endsWith('.sql')).map(f => read('db/migrations/' + f)).join('\n');

/* Pull the declarations out of app.js and evaluate them on their own, so
   the suite reads the real content rather than a copy that could drift
   from it. */
function grab(name) {
  const start = app.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`${name} not found in app.js`);
  let depth = 0, i = app.indexOf('[', start);
  for (; i < app.length; i++) {
    if (app[i] === '[') depth++;
    else if (app[i] === ']' && --depth === 0) break;
  }
  return vm.runInNewContext('(' + app.slice(app.indexOf('[', start), i + 1) + ')');
}
const NAV = grab('NAV');
const HELP = grab('HELP');
const GLOSSARY = grab('GLOSSARY');
const TOUR = grab('TOUR');
const live = NAV.filter(n => n.id);
const setupIds = (app.match(/const setupIds = \[([^\]]*)\]/) || [, ''])[1]
  .match(/"(\w+)"/g).map(x => x.replace(/"/g, ''));

/* ------------------------------------------------------------------ */
s.group('every module has help, and every help topic names a real module');

for (const m of live) {
  s.check(`${m.t} has a topic`, HELP.some(h => h.view === m.id));
}
for (const h of HELP.filter(h => h.view)) {
  const m = NAV.find(n => n.id === h.view);
  s.check(`"${h.title}" points at a module that exists`, !!m, h.view);
  if (!m) continue;
  s.check(`"${h.title}" uses the module's own name`, h.title === m.t, `${h.title} vs ${m.t}`);
  /* The tabs a topic lists must be the module's tabs, in its order.
     Help that names a tab nobody can find is the commonest way help
     goes wrong. */
  s.check(`"${h.title}" lists the module's tabs exactly`,
    JSON.stringify(h.tabs || []) === JSON.stringify(m.tabs || []),
    `${JSON.stringify(h.tabs || [])} vs ${JSON.stringify(m.tabs || [])}`);
  s.check(`"${h.title}" is marked setup exactly when the module is`,
    !!h.setup === setupIds.includes(h.view));
}

/* ------------------------------------------------------------------ */
s.group('the rules the help states are the rules the database enforces');

const text = HELP.map(h => h.body.join(' ')).join(' ');
const says = re => re.test(text);

s.check('help: an NCR needs a root cause to close', says(/root cause/));
s.check('  database agrees', /NCR_NO_CAUSE/.test(migs));
s.check('help: an NCR needs a corrective action to close', says(/a corrective action/));
s.check('  database agrees', /NCR_NO_ACTION/.test(migs));
s.check('help: every corrective action must be verified first', says(/every corrective action[^.]*verified/));
s.check('  database agrees', /NCR_UNVERIFIED/.test(migs));
s.check('help: only a Quality Engineer or above can close one', says(/Only a Quality Engineer or above can close/));
s.check('  database agrees', /NCR_ROLE: only a Quality Engineer or above may close/.test(migs));
s.check('help: inspectors can raise a nonconformance', says(/raise a nonconformance/));
s.check('  database agrees',
  /create policy ncr_raise[\s\S]{0,160}has_role\('inspector'/.test(migs));
s.check('help: supervisors can edit open nonconformances and customer cares',
  says(/Supervisor[^.]*edit open nonconformances and customer cares/));
s.check('  database agrees for nonconformances',
  /create policy ncr_edit[\s\S]{0,260}has_role\('supervisor'/.test(migs));
s.check('  database agrees for customer cares',
  /create policy complaint_edit[\s\S]{0,260}has_role\('supervisor'/.test(migs));
s.check('help: a customer care needs a note of what was done to clear', says(/note of what was done/));
s.check('  database agrees', /COMPLAINT_CORRECTION/.test(migs));
s.check('help: a technical customer care needs a root cause', says(/technical[^.]*root cause/));
s.check('  database agrees', /COMPLAINT_NEEDS_CAUSE/.test(migs));
s.check('help: nothing can be attached once a care is cleared', says(/Nothing can be attached once it is cleared/));
s.check('  database agrees',
  /create policy complaint_docs_add[\s\S]{0,260}c\.closed_at is null/.test(migs));
s.check('help: an empty form cannot be published', says(/no questions on it cannot be published/));
s.check('  database agrees', /007 an empty template cannot be published/.test(migs));
s.check('help: second approval of a form is a division option', says(/second person must approve/));
s.check('  database agrees', /require_second_approver boolean/.test(migs));
s.check('help: new accounts start switched off', says(/created but switched off/));
s.check('  the app agrees', /inactive|active:false|\.active\b/.test(app));

/* The AI boundary is the stop-ship rule. The help must state it, in the
   terms the guard enforces. */
s.check('help: the assistant never decides pass, fail or conformance',
  says(/never decides whether anything passes, fails or conforms/));
s.check('  the guard agrees', /verdict/i.test(read('netlify/functions/lib/guard.cjs')));

/* ------------------------------------------------------------------ */
s.group('written for the people using it');

/* Database and developer vocabulary is meaningless to an inspector and
   is the surest sign help was written for the author. */
const jargon = /\b(RLS|Supabase|PostgREST|API|SQL|JSON|null|enum|RPC|schema|migration|localStorage|endpoint)\b/;
for (const h of HELP) {
  s.check(`"${h.title}" has no developer vocabulary`,
    !jargon.test(h.title + ' ' + h.body.join(' ')), (h.title + ' ' + h.body.join(' ')).match(jargon)?.[0]);
}
s.check('every topic has a body', HELP.every(h => h.body.length && h.body.every(p => p.trim().length > 20)));
s.check('topic ids are unique', new Set(HELP.map(h => h.id)).size === HELP.length);
s.check('the glossary is in alphabetical order',
  GLOSSARY.map(g => g[0]).join('|') === [...GLOSSARY.map(g => g[0])].sort((a, b) => a.localeCompare(b)).join('|'));
s.check('every glossary entry is a sentence', GLOSSARY.every(([, v]) => /\.$/.test(v.trim())));

/* ------------------------------------------------------------------ */
s.group('the tour points at things that exist');

for (const st of TOUR.filter(t => t.sel)) {
  const id = st.sel.match(/^#(\w+)$/);
  const go = st.sel.match(/data-go="(\w+)"/);
  if (id) s.check(`"${st.title}" targets #${id[1]}, which is in the page`,
    new RegExp(`id="${id[1]}"`).test(html));
  else if (go) s.check(`"${st.title}" targets a module that exists`,
    live.some(m => m.id === go[1]), go[1]);
  else s.check(`"${st.title}" targets a class the app draws`,
    app.includes(`class="${st.sel.replace(/^\./, '')}"`) || app.includes(`class="${st.sel.replace(/^\./, '')} `));
}
s.check('a step that cannot be seen is skipped, not shown pointing at nothing',
  /return undefined/.test(app) && /tourMove\(1\)/.test(app));
/* Having a size is not the same as being on screen. */
s.check('off-screen is treated as not visible', /r\.right <= 0 \|\| r\.left >= window\.innerWidth/.test(app));

/* The tour describes what the page looks like, so it goes stale when the
   look changes. 0.29.0 moved metric-card status from a left edge to the
   line beneath the figure, and the tour went on saying "a coloured edge
   on the left" -- caught by reading, not by this suite, until now. */
const css = read('apps/inspect/styles.css');
const tourText = TOUR.map(t => t.body).join(' ');
s.check('the tour does not describe a coloured edge the cards no longer have',
  !/coloured edge|left edge|stripe/i.test(tourText) || /\.kpi[^{]*\{[^}]*border-left/.test(css));
s.check('what the tour says about a figure needing attention is what the page does',
  /line beneath it turns red/.test(tourText) && /\.kpi\.alert \.d\{color:var\(--bad\)/.test(css));

s.group('offered, not imposed');
/* A forced walkthrough would land on everyone already using the system
   the day it shipped. */
s.check('boot offers the tour rather than starting it',
  /setTimeout\(offerTour, \d+\)/.test(app) && !/setTimeout\(startTour/.test(app));
s.check('the offer can be declined', /case "tour-later"/.test(app));
/* Shop-floor tablets are shared; a tour taken by whoever signed in first
   should not count for everyone after them. */
s.check('it is remembered per person, not per device', /qms\.tour\.\$\{S\.profile\?\.id/.test(app));
s.check('Escape leaves the tour', /e\.key === "Escape"\) \{ e\.preventDefault\(\); endTour\(\)/.test(app));
s.check('the card is announced as a dialog', /role="dialog" aria-modal="true"/.test(app));
s.check('it respects reduced motion', /prefers-reduced-motion: reduce/.test(app));

s.group('the menu can be reached on a narrow screen');
/* Below 900px the menu sat off the left edge with nothing to bring it
   back: on a phone or an upright tablet nobody could change module. */
s.check('there is a menu button', /id="btnMenu"/.test(html));
s.check('it says whether the menu is open', /aria-expanded="false" aria-controls="sideNav"/.test(html));
s.check('and what it controls exists', /id="sideNav"/.test(html));
s.check('choosing a module closes the menu', /const go = v => \{ setMenu\(false\)/.test(app));
s.check('the tour opens the menu for the steps that point into it', /if \(narrow\(\)\) setMenu\(want\)/.test(app));

/* ------------------------------------------------------------------ */
s.group('it works in the page');
const { window: w, sleep } = await loadApp('inspect');
const d = w.document;
d.getElementById('btnHelp').click(); await sleep(80);
const pg = d.getElementById('page');
s.check('Help opens from the top bar', /Help/.test(pg.querySelector('.phead h1')?.textContent || ''));
s.check('it has its four tabs', d.querySelectorAll('.tabs button').length === 4);
s.check('it shows the getting-started topics', pg.querySelectorAll('.helpcard').length >= 3);
d.querySelector('.tabs button[data-tab="1"]').click(); await sleep(60);
s.check('the modules tab lists modules', pg.querySelectorAll('.helpcard').length >= 6);
s.check('a module topic links to its module', !!pg.querySelector('.helpcard [data-go="ncr"]'));
d.querySelector('.tabs button[data-tab="3"]').click(); await sleep(60);
s.check('the glossary renders', pg.querySelectorAll('.glos').length === GLOSSARY.length);
const q = d.getElementById('helpQ');
q.value = 'verified'; q.dispatchEvent(new w.Event('input', { bubbles: true })); await sleep(60);
s.check('search finds matching topics', d.getElementById('page').querySelectorAll('.helpcard').length >= 1);
s.check('and keeps the cursor in the box', d.activeElement && d.activeElement.id === 'helpQ');
s.check('there is no footer on Help', d.getElementById('page').querySelectorAll('.foot').length === 0);

s.done();
})();
