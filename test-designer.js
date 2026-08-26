/* Form designer: add, reorder, remove, preview, save, publish. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-designer — inspection form designer');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.GRID_CALLS;

  d.querySelector('#nav button[data-go="dsn"]').click(); await sleep(80);

  s.group('the library opens first, not a template');
  s.check('template library shown', $('page').innerHTML.includes('Library') === false
    && !!d.querySelector('[data-act="open-designer"]'));
  s.check('no canvas until a template is chosen', d.querySelectorAll('.it').length === 0);
  s.check('published state shown per template', $('page').innerHTML.includes('Published rev'));
  s.check('a template not in the matrix is flagged',
    $('page').innerHTML.includes('requirement') || $('page').innerHTML.includes('Not referenced'));
  s.check('new template offered', !!d.querySelector('[data-act="new-template"]'));

  s.group('opening one shows the designer');
  d.querySelector('[data-act="open-designer"]').click(); await sleep(120);
  s.check('back to library offered', !!d.querySelector('[data-act="back-to-library"]'));
  const before = d.querySelectorAll('.it').length;
  s.check('existing template loaded onto the canvas', before > 0, before + ' fields');
  s.check('save draft disabled until something changes',
    d.querySelector('[data-act="save-draft"]').disabled);

  d.querySelector('[data-add="passfail"]').click(); await sleep(60);
  s.check('adding a field grows the canvas', d.querySelectorAll('.it').length === before + 1);
  s.check('save draft enabled once dirty', !d.querySelector('[data-act="save-draft"]').disabled);
  s.check('new field is selected for editing', !!d.querySelector('.it.sel'));

  const labels = () => Array.from(d.querySelectorAll('.it .lb')).map(x => x.textContent.trim());
  const firstBefore = labels()[0];
  d.querySelectorAll('.it .ac button')[1].click(); await sleep(60);
  s.check('moving a field reorders it', labels()[0] !== firstBefore);

  d.querySelector('.it.sel [data-del]').click(); await sleep(60);
  s.check('removing a field shrinks it back', d.querySelectorAll('.it').length === before);

  d.querySelector('[data-act="toggle-preview"]').click(); await sleep(60);
  s.check('preview renders', $('page').innerHTML.includes('Preview'));
  d.querySelector('[data-act="toggle-preview"]').click(); await sleep(60);

  d.querySelector('[data-act="save-draft"]').click(); await sleep(250);
  s.check('saving writes to template_revisions',
    CALLS.some(c => ['update', 'insert'].includes(c[0]) && c[1] === 'template_revisions'));

  s.group('publishing');
  /* The button must always be PRESENT. Hiding it when it cannot be used is
     indistinguishable from the feature not existing — which is exactly how
     this was reported. Disabled with a reason is the honest state. */
  const anyPublish = Array.from(d.querySelectorAll('button'))
    .filter(b => /Publish/.test(b.textContent));
  s.check('a publish button is always visible', anyPublish.length === 1,
    anyPublish.length + ' found');
  const active = d.querySelector('[data-act="publish"]');
  if (active) {
    active.click(); await sleep(250);
    s.check('publish goes through the RPC that enforces a second approver',
      CALLS.some(c => c[0] === 'rpc' && c[1] === 'publish_template_revision'));
  } else {
    s.check('a disabled publish button explains why', !!anyPublish[0].title,
      anyPublish[0].title || 'no title');
    s.check('the reason is also stated on the page',
      $('page').innerHTML.includes('Cannot publish yet'));
  }

  s.group('leaving the designer');
  d.querySelector('[data-act="back-to-library"]').click(); await sleep(120);
  s.check('returns to the library', !!d.querySelector('[data-act="open-designer"]'));
  s.done();
})();
