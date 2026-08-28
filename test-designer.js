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
  /* The author CAN publish by default. Requiring a second approver is the
     usual reading of ISO 9001 for a controlled document, but a division with
     one Quality Manager could then never publish anything — so it is a
     division setting, off by default, not a law. */
  const active = d.querySelector('[data-act="publish"]');
  s.check('the author can publish while a second approver is not required', !!active);
  if (active) {
    /* Double-click. The button used to stay live for the whole round trip, so
       an impatient second click sent a second publish and put two approvals in
       the audit trail for one revision. */
    active.click(); active.click(); active.click();
    await sleep(400);
    const publishCalls = CALLS.filter(c => c[0] === 'rpc' && c[1] === 'publish_template_revision');
    s.check('publish goes through the RPC', publishCalls.length > 0);
    s.check('three rapid clicks send exactly one publish', publishCalls.length === 1,
      publishCalls.length + ' calls');

    const after = $('page').textContent;
    s.check('the result is stated on the page, not only in a toast',
      after.includes('published'), after.slice(0, 90));
    s.check('it says the published revision is live', after.includes('live now'));
    s.check('it says what the next revision will be', /starts revision \d+/.test(after));
    s.check('the publish button is no longer offered',
      !d.querySelector('[data-act="publish"]'));
  } else {
    s.check('a disabled publish button explains why', !!anyPublish[0].title,
      anyPublish[0].title || 'no title');
    s.check('the reason is also stated on the page',
      $('page').innerHTML.includes('Cannot publish yet'));
  }

  s.group('an empty template cannot be published');
  /* Publishing a revision with no questions is how an inspection reached the
     shop floor with nothing to fill in. */
  const empty = await loadApp('inspect', {
    afterMock: win => {
      const D = win.GRID_TEST_DATA;
      D.template_revisions.forEach(r => {
        if (r.status === 'draft') r.definition = { sections: [{ id: 's1', title: 'ID', items: [
          { id: 'h1', type: 'info', label: 'Read the work instruction first' }] }] };
      });
    }
  });
  const ed = empty.window.document;
  ed.querySelector('#nav button[data-go="dsn"]').click(); await empty.sleep(80);
  ed.querySelector('[data-act="open-designer"]').click(); await empty.sleep(140);
  s.check('publish is refused with no questions', !ed.querySelector('[data-act="publish"]'));
  s.check('and says an instruction is not a question',
    empty.$('page').textContent.includes('no questions on it'));

  s.group('a publish that quietly did nothing is caught');
  /* The reported fault: the banner said "Revision 1 published", the status
     line still said draft, and the library still said Never published. The
     database now raises on a zero-row update, and the client verifies the
     revision actually changed rather than trusting the response. */
  const silent = await loadApp('inspect', {
    afterMock: win => { win.GRID_TEST_DATA.__silentPublish = true; }
  });
  const sd2 = silent.window.document;
  sd2.querySelector('#nav button[data-go="dsn"]').click(); await silent.sleep(80);
  sd2.querySelector('[data-act="open-designer"]').click(); await silent.sleep(140);
  const pubBtn = sd2.querySelector('[data-act="publish"]');
  if (pubBtn) {
    pubBtn.click(); await silent.sleep(400);
    const txt = silent.$('page').textContent;
    s.check('the app does not claim success', !txt.includes('It is live now'));
    s.check('it says nothing was published', txt.includes('Nothing was published'));
    s.check('it names the revision and its real state', /still (draft|in_review)/.test(txt));
  } else {
    s.check('publish available in the silent-failure fixture', false, 'no publish button');
  }

  s.group('the revision a button will write is named on the button');
  const back = d.querySelector('[data-act="back-to-library"]');
  if (back) { back.click(); await sleep(120); }
  d.querySelector('[data-act="open-designer"]').click(); await sleep(140);
  const saveBtn = d.querySelector('[data-act="save-draft"]');
  s.check('the save button names the revision it will write',
    saveBtn && /rev \d+/.test(saveBtn.textContent), saveBtn ? saveBtn.textContent : 'missing');
  s.check('the status line says what is live',
    /published rev \d+ is live|nothing published yet/.test($('page').textContent));

  s.group('leaving the designer');
  d.querySelector('[data-act="back-to-library"]').click(); await sleep(120);
  s.check('returns to the library', !!d.querySelector('[data-act="open-designer"]'));
  s.group('the second-approver rule can be switched on');
  /* Booted fresh with the setting ON, because the app reads division settings
     once during boot — flipping the fixture on a running instance proves
     nothing. */
  const strict = await loadApp('inspect', {
    afterMock: win => {
      const D = win.GRID_TEST_DATA;
      D.division_profile.require_second_approver = true;
      /* And make the signed-in user the AUTHOR of the draft. Without this the
         draft belongs to someone else and publishing is correctly allowed —
         the first version of this test asserted a block that should not have
         happened, and would have passed against broken code just as happily. */
      D.template_revisions.find(r => r.status === 'draft').created_by = 'u1';
    }
  });
  const sd = strict.window.document;
  sd.querySelector('#nav button[data-go="dsn"]').click(); await strict.sleep(80);
  sd.querySelector('[data-act="open-designer"]').click(); await strict.sleep(140);
  s.check('the author is then blocked', !sd.querySelector('[data-act="publish"]'));
  s.check('and told why on the page',
    strict.$('page').innerHTML.includes('second approver'));
  s.check('and pointed at the setting',
    strict.$('page').innerHTML.includes('Administration'));
  s.check('the button is still shown, disabled',
    Array.from(sd.querySelectorAll('button')).some(b => /Publish/.test(b.textContent) && b.disabled));

  s.done();
})();
