/* Administration: activation, roles, reference lists, feature switch. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-admin — administration');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.GRID_CALLS;

  d.querySelector('#nav button[data-go="adm"]').click(); await sleep(80);
  s.check('inactive user shows an Activate action', $('page').innerHTML.includes('Activate'));
  s.check('inactive user flagged as awaiting activation',
    $('page').innerHTML.includes('Awaiting activation'));
  d.querySelector('[data-toggle-active]').click(); await sleep(250);
  s.check('activation writes to profiles',
    CALLS.some(c => c[0] === 'update' && c[1] === 'profiles'));

  s.group('reference lists are editable');
  d.querySelector('.tabs button[data-tab="2"]').click(); await sleep(120);
  for (const list of ['Manufacturing stages', 'Departments', 'Product families', 'Defect codes']) {
    s.check(`${list} shown`, $('page').innerHTML.includes(list));
  }
  /* Derive the expected counts from the fixture rather than hard-coding a
     threshold: the mock holds a handful of rows and a fixed number would
     either fail here or pass trivially against real data. */
  const D = w.GRID_TEST_DATA;
  const expectFields = D.manufacturing_stages.length * 2   // name, sort_order
                     + D.departments.length * 3            // name, stage, sort_order
                     + D.product_families.length * 1       // name
                     + D.defect_codes.length * 3;          // code, description, category
  const expectRows = D.manufacturing_stages.length + D.departments.length
                   + D.product_families.length + D.defect_codes.length;
  const editable = d.querySelectorAll('[data-ref]');
  s.check('one editable field per column per entry', editable.length === expectFields,
    `${editable.length} of ${expectFields}`);
  s.check('defect codes carry no default department',
    !$('page').innerHTML.includes('Default department'));
  /* Several codes roll up into one line on the faults chart, so each code
     says what it groups as. Blank groups it under its own description. */
  s.check('defect codes say how they group for reporting',
    $('page').innerHTML.includes('Groups as'));
  s.check('each list has an add row', d.querySelectorAll('[data-ref-add]').length === 4);
  s.check('each list has a save button', d.querySelectorAll('[data-ref-save]').length === 4);
  s.check('save starts disabled', d.querySelector('[data-ref-save]').disabled);
  s.check('retire offered on every entry',
    d.querySelectorAll('[data-ref-toggle]').length === expectRows,
    `${d.querySelectorAll('[data-ref-toggle]').length} of ${expectRows}`);
  s.check('delete offered on every entry',
    d.querySelectorAll('[data-ref-del]').length === expectRows);

  // Edit a stage name. The grid must NOT repaint — repainting mid-edit steals
  // the caret — so the field keeps focus and the button enables in place.
  const field = d.querySelector('[data-ref^="manufacturing_stages|"]');
  const before = field.value;
  field.value = before + ' (renamed)';
  field.focus();
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(80);
  s.check('edit is held as a draft, not written immediately',
    !CALLS.some(c => c[0] === 'update' && c[1] === 'manufacturing_stages'));
  s.check('the edited field keeps focus', d.activeElement === field);
  s.check('the field is still in the DOM (no repaint)', field.isConnected);
  s.check('save is enabled once dirty', !d.querySelector('[data-ref-save="manufacturing_stages"]').disabled);
  s.check('unsaved count is shown', $('page').innerHTML.includes('unsaved change'));

  // Reverting by hand should clear the draft rather than save a no-op.
  field.value = before;
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(80);
  s.check('reverting clears the draft',
    d.querySelector('[data-ref-save="manufacturing_stages"]').disabled);

  field.value = before + ' (renamed)';
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(60);
  d.querySelector('[data-ref-save="manufacturing_stages"]').click();
  await sleep(250);
  const upd = CALLS.filter(c => c[0] === 'update' && c[1] === 'manufacturing_stages').pop();
  s.check('save writes to the table', !!upd);
  s.check('save sends the edited value', upd && String(upd[2].name).includes('renamed'),
    upd ? JSON.stringify(upd[2]) : 'no call');

  d.querySelector('.tabs button[data-tab="2"]').click(); await sleep(120);
  d.querySelector('[data-ref-toggle]').click(); await sleep(200);
  s.check('retire writes an active flag',
    CALLS.some(c => c[0] === 'update' && 'active' in (c[2] || {})));

  const newName = d.querySelector('[data-new="product_families|name"]');
  newName.value = '33 kV outdoor';
  d.querySelector('[data-ref-add="product_families"]').click(); await sleep(200);
  const ins = CALLS.filter(c => c[0] === 'insert' && c[1] === 'product_families').pop();
  s.check('add inserts the new entry', ins && ins[2].name === '33 kV outdoor',
    ins ? JSON.stringify(ins[2]) : 'no call');

  d.querySelector('.tabs button[data-tab="3"]').click(); await sleep(80);
  s.check('hold point switch present', !!d.querySelector('[data-act="toggle-hp"]'));
  s.check('second approver switch present', !!d.querySelector('[data-act="toggle-2nd"]'));
  d.querySelector('[data-act="toggle-hp"]').click(); await sleep(250);
  s.check('hold point switch writes to division_profile',
    CALLS.some(c => c[0] === 'update' && 'hold_points' in (c[2] || {})));
  d.querySelector('.tabs button[data-tab="3"]').click(); await sleep(120);
  d.querySelector('[data-act="toggle-2nd"]').click(); await sleep(250);
  s.check('second approver switch writes to division_profile',
    CALLS.some(c => c[0] === 'update' && 'require_second_approver' in (c[2] || {})));

  d.querySelector('.tabs button[data-tab="4"]').click(); await sleep(200);
  s.check('audit trail read', CALLS.length > 0 && $('page').innerHTML.includes('Audit trail'));
  s.group('competency can be recorded');
  /* The database refuses a signature below the level a template demands —
     correct, and it stays. But there was nowhere to RECORD a competency, so
     the table stayed empty, everyone held 0, and NOBODY could sign anything,
     including an administrator. The control was unreachable, not wrong. */
  d.querySelector('#nav button[data-go="adm"]').click(); await sleep(80);
  d.querySelector('.tabs button[data-tab="1"]').click(); await sleep(140);
  s.check('a competency matrix exists', $('page').innerHTML.includes('Competency matrix'));
  s.check('every active user has a row', d.querySelectorAll('[data-comp]').length > 0);
  s.check('it shows what each template requires',
    $('page').innerHTML.includes('What each template requires'));
  s.check('it names who can sign each template',
    $('page').innerHTML.includes('Who can sign it'));

  const sel = d.querySelector('[data-comp]');
  sel.value = '3';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(250);
  s.check('setting a level writes to competencies',
    CALLS.some(c => c[0] === 'upsert' && c[1] === 'competencies'));

  s.group('a division with no competency recorded is told, not just blocked');
  const none = await loadApp('inspect', {
    afterMock: win => { win.GRID_TEST_DATA.competencies = []; }
  });
  const nd = none.window.document;
  nd.querySelector('#nav button[data-go="adm"]').click(); await none.sleep(80);
  nd.querySelector('.tabs button[data-tab="1"]').click(); await none.sleep(140);
  s.check('it warns that nobody can sign', none.$('page').textContent.includes('Nobody can sign'));
  s.check('it says what to do about it',
    none.$('page').textContent.includes('record competency below'));

  /* And on the capture screen the refusal is shown BEFORE the form is filled
     in, rather than after the signature is attempted. */
  nd.querySelector('#nav button[data-go="work"]').click(); await none.sleep(80);
  const start = nd.querySelector('[data-open-capture]');
  if (start) {
    start.click(); await none.sleep(250);
    const txt = none.$('page').textContent;
    s.check('capture says the signature will be refused', txt.includes('cannot sign this one'));
    s.check('and names the level required and held', /level \d+ and you\s+hold \d+/.test(txt.replace(/\s+/g, ' ')));
    s.check('the submit button is disabled up front',
      Array.from(nd.querySelectorAll('button')).some(b => /Sign and submit/.test(b.textContent) && b.disabled));
  }

  s.done();
})();
