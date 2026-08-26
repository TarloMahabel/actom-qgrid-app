/* Form designer: add, reorder, remove, preview, save, publish. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-designer — inspection form designer');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.QG_CALLS;

  d.querySelector('#nav button[data-go="dsn"]').click(); await sleep(80);
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

  const pub = d.querySelector('[data-act="publish"]');
  s.check('publish offered to a Quality Manager', !!pub);
  if (pub) { pub.click(); await sleep(250); }
  s.check('publish goes through the RPC that enforces a second approver',
    CALLS.some(c => c[0] === 'rpc' && c[1] === 'publish_template_revision'));
  s.done();
})();
