/* Inspection capture: the form, tolerance handling, blocked instruments,
   write-through and submit. This is the path an inspector uses all day. */
const { loadApp, suite } = require('./test/harness');

(async () => {
  const s = suite('test-capture — inspection capture');
  const { window: w, $, sleep } = await loadApp('inspect');
  const d = w.document;
  const CALLS = w.GRID_CALLS;

  d.querySelector('#nav button[data-go="work"]').click(); await sleep(60);
  const start = d.querySelector('[data-open-capture]');
  s.check('queue offers an inspection to start', !!start);
  start.click(); await sleep(200);

  s.group('form built from the template');
  s.check('capture form rendered', !!$('captureForm'));
  s.check('measurement field present', !!d.querySelector('[data-num="i3"]'));
  s.check('pass/fail control present', !!d.querySelector('[data-field="i4"] [data-outcome="fail"]'));
  s.check('instruction rendered read-only', $('page').innerHTML.includes('WI-MV-14'));
  s.check('overdue instrument disabled in the picker', (() => {
    const sel = d.querySelector('[data-equip="i5"]');
    return sel && Array.from(sel.options).some(o => o.disabled && o.textContent.includes('MME-0412'));
  })());

  s.group('tolerance decides pass or fail, not the inspector');
  const num = d.querySelector('[data-num="i3"]');
  num.value = '61';
  num.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(700);
  const up = CALLS.filter(c => c[0] === 'upsert' && c[1] === 'inspection_results').pop();
  s.check('answer written through as typed', !!up);
  s.check('61 Nm against 66-74 derived as a fail', up && up[2].outcome === 'fail',
    up ? JSON.stringify(up[2]) : 'no call');

  num.value = '70';
  num.dispatchEvent(new w.Event('change', { bubbles: true }));
  await sleep(700);
  const up2 = CALLS.filter(c => c[0] === 'upsert' && c[2].field_id === 'i3').pop();
  s.check('70 Nm inside tolerance derived as a pass', up2 && up2[2].outcome === 'pass');

  s.group('failures and submit');
  d.querySelector('[data-field="i4"] [data-outcome="fail"]').click(); await sleep(500);
  const pf = CALLS.filter(c => c[0] === 'upsert' && c[2].field_id === 'i4').pop();
  s.check('pass/fail written through', pf && pf[2].outcome === 'fail');
  s.check('failure warned about before submit', $('page').innerHTML.includes('failure'));
  /* Sign first: an unsigned form is refused now, which is the point of the
     signature group further down. */
  w.__sign(d.querySelector('[data-sig]'), [[20, 40], [80, 70], [150, 50]]);
  await sleep(700);
  d.querySelector('[data-act="submit-inspection"]').click(); await sleep(400);
  s.check('submit goes through the RPC, not client-side writes',
    CALLS.some(c => c[0] === 'rpc' && c[1] === 'submit_inspection'));
  s.check('the drawn signature is uploaded with it',
    CALLS.some(c => c[0] === 'storage.upload' && /signature-/.test(c[2])));
  s.group('projects and works orders read as one ordered flow');
  d.querySelector('#nav button[data-go="sched"]').click(); await sleep(80);
  const woTab = d.querySelector('.tabs button[data-tab="2"]');
  s.check('scheduling has a projects and works orders tab', !!woTab);
  woTab.click(); await sleep(140);

  /* The prerequisites are shown up front. Generating depends on a published
     template and a populated matrix, and failing silently at the end of the
     flow taught the user nothing. */
  s.check('the full setup chain is listed before anything else',
    $('page').innerHTML.includes('Getting to a scheduled inspection'));
  s.check('a works order is drawn inside its project',
    $('page').innerHTML.indexOf('Add works order') > $('page').innerHTML.indexOf('works order'));
  s.check('adding a project is offered', !!d.querySelector('[data-act="add-project"]'));
  s.check('adding a works order is offered', !!d.querySelector('[data-act="add-wo"]'));
  s.check('generate sits on the works order', !!d.querySelector('[data-act="gen-wo"]'));
  s.check('how many inspections exist is shown', $('page').innerHTML.includes('generated'));

  d.querySelector('[data-act="gen-wo"]').click(); await sleep(280);
  s.check('generate calls the RPC', CALLS.some(c => c[0] === 'rpc' && c[1] === 'generate_inspections'));

  s.group('adding uses a labelled form, not a table row');
  d.querySelector('[data-act="add-project"]').click(); await sleep(120);
  s.check('project form opens', !!$('pCode') && !!$('pFamily'));
  s.check('the family field explains why it matters',
    $('mBody').innerHTML.includes('nothing generates'));
  $('pCode').value = 'P-26999'; $('pName').value = 'Test project';
  d.querySelector('[data-act="save-project"]').click(); await sleep(250);
  const ins = CALLS.filter(c => c[0] === 'insert' && c[1] === 'projects').pop();
  s.check('saving inserts the project', ins && ins[2].code === 'P-26999',
    ins ? JSON.stringify(ins[2]) : 'no call');

  d.querySelector('[data-act="add-wo"]').click(); await sleep(120);
  s.check('works order form opens', !!$('wCode') && !!$('wQty'));
  s.check('quantity explains what it drives', $('mBody').innerHTML.includes('one inspection per unit'));
  $('wCode').value = 'WO-99999';
  d.querySelector('[data-act="save-wo"]').click(); await sleep(250);
  const insW = CALLS.filter(c => c[0] === 'insert' && c[1] === 'works_orders').pop();
  s.check('saving inserts the works order', insW && insW[2].code === 'WO-99999',
    insW ? JSON.stringify(insW[2]) : 'no call');

  s.group('the signature is drawn, not implied');
  /* The field used to be a label reading "signing happens when you submit
     below". The submit does carry the real control — an authenticated
     identity, a timestamp and a hash — but a test certificate handed to a
     customer needs a visible mark, and an inspector expects to make one. */
  const sg = await loadApp('inspect');
  const sw = sg.window, sd = sw.document;
  sd.querySelector('#nav button[data-go="work"]').click(); await sg.sleep(60);
  sd.querySelector('[data-open-capture]').click(); await sg.sleep(420);

  const pad = sd.querySelector('[data-sig]');
  s.check('there is a pad to sign on', !!pad);
  s.check('it says the identity comes from the sign-in, not the drawing',
    sg.$('page').textContent.includes('come from your sign-in'));
  s.check('clear is disabled before anything is drawn',
    sd.querySelector('[data-sig-clear]').disabled);

  sw.__sign(pad, [[20, 40], [60, 70], [120, 45], [180, 80]]);
  await sg.sleep(800);
  s.check('drawing marks the field signed', sg.$('page').textContent.includes('Signed'));
  s.check('and records an answer',
    sw.GRID_CALLS.some(c => c[0] === 'upsert' && c[2] && c[2].value_text === 'signed'));
  s.check('clear becomes available', !sd.querySelector('[data-sig-clear]').disabled);

  /* A canvas bitmap does not survive a re-render. Strokes are held in state
     and repainted, or an unrelated refresh would silently wipe a signature. */
  sd.querySelector('.tabs button[data-tab="0"]').click(); await sg.sleep(80);
  sd.querySelector('.tabs button[data-tab="1"]').click(); await sg.sleep(200);
  s.check('a signature survives a re-render', sg.$('page').textContent.includes('Signed'));

  sd.querySelector('[data-sig-clear]').click(); await sg.sleep(400);
  s.check('clearing resets the pad', sg.$('page').textContent.includes('Sign in the box above'));

  s.group('submitting requires the form to be signed');
  const us = await loadApp('inspect');
  const ud = us.window.document;
  ud.querySelector('#nav button[data-go="work"]').click(); await us.sleep(60);
  ud.querySelector('[data-open-capture]').click(); await us.sleep(420);
  const submit = ud.querySelector('[data-act="submit-inspection"]');
  if (submit) {
    submit.click(); await us.sleep(350);
    s.check('an unsigned form is not submitted',
      !us.window.GRID_CALLS.some(c => c[0] === 'rpc' && c[1] === 'submit_inspection'));
    s.check('and it names the field that is empty',
      (ud.querySelector('.toast') || {}).textContent.includes('Inspector signature'));
  }

  s.group('an inspection can be handed to someone else');
  /* An inspector starts a panel and is then off sick. Somebody has to finish
     it. What must NOT happen is two people sharing one inspection, or a
     supervisor signing in another person's name — a signature says who did
     the work. So: reassignment, with a reason, and all three names kept. */
  const ho = await loadApp('inspect');
  const hw = ho.window, hd = hw.document;
  hd.querySelector('#nav button[data-go="work"]').click(); await ho.sleep(80);
  const hoBtn = hd.querySelector('[data-act="hand-over"]');
  s.check('handing over is offered on the queue', !!hoBtn);
  hoBtn.click(); await ho.sleep(150);
  s.check('it asks who it goes to', !!ho.$('hoTo'));
  s.check('it asks why', !!ho.$('hoReason'));
  s.check('it says the competency needed to sign',
    ho.$('mBody').textContent.includes('can sign it off'));
  s.check('it says captured answers stay as they are',
    ho.$('mBody').textContent.includes('stay as they are'));

  hd.querySelector('[data-act="save-handover"]').click(); await ho.sleep(200);
  s.check('it refuses without a person',
    !hw.GRID_CALLS.some(c => c[0] === 'rpc' && c[1] === 'hand_over_inspection'));

  ho.$('hoTo').value = 'u2';
  hd.querySelector('[data-act="save-handover"]').click(); await ho.sleep(200);
  s.check('it refuses without a reason',
    !hw.GRID_CALLS.some(c => c[0] === 'rpc' && c[1] === 'hand_over_inspection'));

  ho.$('hoReason').value = 'T. Nkosi off sick, panel needed for despatch';
  hd.querySelector('[data-act="save-handover"]').click(); await ho.sleep(500);
  const call = hw.GRID_CALLS.filter(c => c[0] === 'rpc' && c[1] === 'hand_over_inspection').pop();
  s.check('the handover is recorded', !!call);
  s.check('with the reason', call && /off sick/.test(call[2].p_reason));
  s.check('a handover record exists', hw.GRID_TEST_DATA.inspection_handovers.length === 1);
  s.check('the inspection moves to the new person',
    hw.GRID_TEST_DATA.inspections.some(i => i.assigned_to === 'u2'));
  s.check('who started it is remembered',
    hw.GRID_TEST_DATA.inspections.some(i => i.started_by && i.started_by !== i.assigned_to));

  /* And the person picking it up is told what they inherited. */
  hd.querySelector('#nav button[data-go="work"]').click(); await ho.sleep(80);
  const resume = hd.querySelector('[data-open-capture]');
  if (resume) {
    resume.click(); await ho.sleep(420);
    const txt = ho.$('page').textContent;
    s.check('the capture screen says it was handed over', txt.includes('Handed over'));
    s.check('and shows the reason', txt.includes('off sick'));
  }

  s.group('a panel can carry many faults');
  /* A checksheet answers fixed questions, one answer each. A fault list is
     the other shape: one panel, however many faults are found. The form
     could only hold the first. */
  const fl = await loadApp('inspect');
  const fw = fl.window, fd = fw.document;
  fd.querySelector('#nav button[data-go="work"]').click(); await fl.sleep(60);
  fd.querySelector('[data-open-capture]').click(); await fl.sleep(400);

  s.check('the form offers a fault list', !!fd.querySelector('[data-fault-add]'));
  s.check('an empty list asks for a fault or a confirmation',
    fl.$('page').textContent.includes('Add a fault, or confirm there are none'));

  fd.querySelector('[data-fault-add]').click(); await fl.sleep(420);
  s.check('adding a fault writes a record',
    fw.GRID_CALLS.some(c => c[0] === 'insert' && c[1] === 'failed_checks'));
  const firstInsert = fw.GRID_CALLS.filter(c => c[0] === 'insert' && c[1] === 'failed_checks').pop();
  s.check('it is marked as coming from a fault list',
    firstInsert && firstInsert[2].source === 'fault_list');
  s.check('it carries a line number', firstInsert && firstInsert[2].seq === 1);

  fd.querySelector('[data-fault-add]').click(); await fl.sleep(420);
  s.check('a second fault can be added on the same panel',
    fd.querySelectorAll('[data-fault-del]').length === 2);
  const ids = Array.from(fd.querySelectorAll('[data-fault-del]'))
    .map(x => x.dataset.faultDel.split('|')[1]);
  s.check('each line is a separate record', new Set(ids).size === 2, ids.join(','));

  const desc = Array.from(fd.querySelectorAll('[data-fault]'))
    .find(x => x.dataset.fault.endsWith('|description'));
  desc.value = 'Paint chipped on LV door';
  desc.dispatchEvent(new fw.Event('change', { bubbles: true }));
  await fl.sleep(750);
  s.check('typing a fault saves it as you go',
    fw.GRID_CALLS.some(c => c[0] === 'update' && c[1] === 'failed_checks' &&
      c[2].description === 'Paint chipped on LV door'));

  const answers = fw.GRID_CALLS.filter(c => c[0] === 'upsert' && c[2] && c[2].field_id === 'i9');
  s.check('the field counts as answered once a fault exists', answers.length > 0);
  s.check('the answer records how many', answers.length &&
    /\d+ faults?/.test(answers[answers.length - 1][2].value_text));

  fd.querySelector('[data-fault-del]').click(); await fl.sleep(520);
  s.check('a line can be removed on its own',
    fd.querySelectorAll('[data-fault-del]').length === 1);

  s.group('who cleared a fault and who verified it');
  /* Its own app: the handover group above navigates away, and reusing that
     document meant these checks were querying a page with no fault list on
     it — they failed for a reason that had nothing to do with the feature. */
  const cv = await loadApp('inspect');
  const cw = cv.window, cvd = cv.window.document;
  cvd.querySelector('#nav button[data-go="work"]').click(); await cv.sleep(60);
  cvd.querySelector('[data-open-capture]').click(); await cv.sleep(420);
  cvd.querySelector('[data-fault-add]').click(); await cv.sleep(500);
  const flTxt = () => cv.$('page').textContent;
  s.check('each line records who cleared it', flTxt().includes('Cleared by'));
  s.check('and who verified it', flTxt().includes('Verified by'));

  const sel = suffix => Array.from(cvd.querySelectorAll('[data-fault]'))
    .find(x => x.dataset.fault.endsWith(suffix));
  /* Verification is a check ON the clearing. Recording it first would assert
     that somebody checked work nobody is recorded as having done. */
  s.check('verified cannot be set before cleared', sel('|verified_by').disabled);
  s.check('and it says why', flTxt().includes('record who cleared it first'));

  sel('|cleared_by').value = 'u2';
  sel('|cleared_by').dispatchEvent(new cw.Event('change', { bubbles: true }));
  await cv.sleep(900);
  s.check('cleared by is saved',
    cw.GRID_CALLS.some(c => c[0] === 'update' && c[1] === 'failed_checks' &&
      'cleared_by' in (c[2] || {})));
  s.check('verified then becomes available', !sel('|verified_by').disabled);
  s.check('the line shows it is awaiting verification',
    flTxt().includes('Awaiting verification'));

  sel('|verified_by').value = 'u2';
  sel('|verified_by').dispatchEvent(new cw.Event('change', { bubbles: true }));
  await cv.sleep(900);
  /* Allowed, because a small shop may have nobody else — but never silent.
     Independent verification is the point of having two columns. */
  s.check('the same person doing both is flagged, not hidden',
    flTxt().includes('same person'));

  s.group('no faults is stated, not assumed');
  /* An empty section and a clean panel must not look the same in a quality
     record: "nobody looked" and "nothing was wrong" are different facts. */
  const clean = await loadApp('inspect');
  const cd = clean.window.document;
  cd.querySelector('#nav button[data-go="work"]').click(); await clean.sleep(60);
  cd.querySelector('[data-open-capture]').click(); await clean.sleep(400);
  const tick = cd.querySelector('[data-fault-none]');
  s.check('there is a way to confirm a clean panel', !!tick);
  tick.checked = true;
  tick.dispatchEvent(new clean.window.Event('change', { bubbles: true }));
  await clean.sleep(700);
  const none = clean.window.GRID_CALLS
    .filter(c => c[0] === 'upsert' && c[2] && c[2].field_id === 'i9').pop();
  s.check('confirming writes an answer', !!none);
  s.check('and records it as no faults found',
    none && none[2].value_text === 'no faults found');
  s.check('the two states cannot both be set',
    cd.querySelector('[data-fault-add]').disabled);

  /* Re-query: ticking re-renders the form, so the original checkbox is a
     detached node and its event never reaches the delegated listener. */
  const tick2 = cd.querySelector('[data-fault-none]');
  tick2.checked = false;
  tick2.dispatchEvent(new clean.window.Event('change', { bubbles: true }));
  await clean.sleep(700);
  s.check('unticking blanks the answer rather than deleting it',
    clean.window.GRID_CALLS.some(c => c[0] === 'update' && c[1] === 'inspection_results') &&
    !clean.window.GRID_CALLS.some(c => c[0] === 'delete' && c[1] === 'inspection_results'));


  s.group('starting an inspection opens the current form');
  /* An inspection is locked to the revision it was generated against — right
     for a record with answers in it, wrong for one nobody has started.
     Publishing a template with no fields and adding them in a later revision
     left every scheduled inspection pointing at the empty one: the form opened
     with a heading, nothing to fill in, and progress reading "0 of 0". */
  const stale = await loadApp('inspect', {
    afterMock: win => {
      const D = win.GRID_TEST_DATA;
      const good = D.template_revisions.find(r => r.status === 'published');
      D.template_revisions.push({ id: 'r0', template_id: good.template_id, rev: 0,
        status: 'superseded', created_by: 'u2',
        definition: { sections: [{ id: 's1', title: 'IDENTIFICATION', items: [] }] } });
      D.inspections[0].template_rev_id = 'r0';
      D.inspections[0].status = 'scheduled';
    }
  });
  const st = stale.window.document;
  st.querySelector('#nav button[data-go="work"]').click(); await stale.sleep(60);
  st.querySelector('[data-open-capture]').click(); await stale.sleep(420);
  const moved = stale.window.GRID_CALLS
    .filter(c => c[0] === 'update' && c[1] === 'inspections' && c[2].template_rev_id).pop();
  s.check('an untouched inspection moves to the published revision', !!moved,
    'it would otherwise open an empty form');
  s.check('the form then has questions on it',
    !stale.$('page').textContent.includes('no questions on it'));
  s.check('progress is a number, not NaN', !stale.$('page').textContent.includes('NaN'));

  /* And the opposite, which matters more: a record with answers on it must
     never have the form changed underneath it. */
  const started = await loadApp('inspect', {
    afterMock: win => {
      const D = win.GRID_TEST_DATA;
      const good = D.template_revisions.find(r => r.status === 'published');
      D.template_revisions.push({ id: 'r0', template_id: good.template_id, rev: 0,
        status: 'superseded', created_by: 'u2',
        definition: { sections: [{ id: 's1', title: 'OLD', items: [
          { id: 'x1', type: 'passfail', label: 'An old question', req: 1 }] }] } });
      D.inspections[0].template_rev_id = 'r0';
      D.inspections[0].status = 'in_progress';
      D.inspection_results = [{ id: 'ir1', inspection_id: D.inspections[0].id,
        field_id: 'x1', label: 'An old question', outcome: 'pass' }];
    }
  });
  const sd3 = started.window.document;
  sd3.querySelector('#nav button[data-go="work"]').click(); await started.sleep(60);
  sd3.querySelector('[data-open-capture]').click(); await started.sleep(420);
  const movedToo = started.window.GRID_CALLS
    .filter(c => c[0] === 'update' && c[1] === 'inspections' && c[2].template_rev_id).pop();
  s.check('an inspection in progress is NOT moved', !movedToo,
    'changing the form under a part-captured record would orphan its answers');
  s.check('it still shows the questions it was captured against',
    started.$('page').textContent.includes('An old question'));

  s.group('photos attach, upload and count as answered');
  /* The field rendered a file picker that did nothing: choosing a file
     recorded no answer, so submitting failed with "Photo has not been
     answered" and nothing was ever uploaded. */
  const ph = await loadApp('inspect');
  const pw = ph.window, pdoc = pw.document;
  pdoc.querySelector('#nav button[data-go="work"]').click(); await ph.sleep(60);
  pdoc.querySelector('[data-open-capture]').click(); await ph.sleep(280);
  const cam = pdoc.querySelector('[data-shoot]');
  const fil = pdoc.querySelector('[data-pick]');
  /* Two controls, not one. A single input with capture="environment" forces
     the camera on a tablet and gives no way to attach a photo that already
     exists — a drawing, a supplier certificate, a shot taken earlier. */
  s.check('taking a photo is offered', !!cam);
  s.check('uploading an existing file is offered', !!fil);
  s.check('the camera picker asks for the camera',
    pdoc.getElementById('cameraPicker').getAttribute('capture') === 'environment');
  s.check('the file picker does not force the camera',
    !pdoc.getElementById('photoPicker').hasAttribute('capture'));
  s.check('several files can be attached at once',
    pdoc.getElementById('photoPicker').hasAttribute('multiple'));

  /* THE BUG THIS GUARDS. The pickers must live outside #page. They used to be
     rendered inside the capture form, and the native file dialog stays open
     for as long as the user is browsing — any repaint in that window replaced
     the input the dialog belonged to, so the chosen file landed on a detached
     element and nothing happened at all, with no error. */
  s.check('the pickers live outside the re-rendered page',
    !pdoc.getElementById('page').contains(pdoc.getElementById('photoPicker')));

  /* Re-query the input every time: the page re-renders after each upload, so
     a held reference is a detached node and its event never reaches the
     delegated listener on document. */
  const pick = files => {
    pdoc.querySelector('[data-pick]').click();          // sets the target field
    const el = pdoc.getElementById('photoPicker');
    pw.__setFiles(el, files);                           // live FileList, as the browser gives
    el.dispatchEvent(new pw.Event('change', { bubbles: true }));
  };
  pick([{ name: 'a.jpg', size: 5e6 }]);
  await ph.sleep(600);
  const pc = pw.GRID_CALLS;
  s.check('the image is uploaded to storage',
    pc.some(c => c[0] === 'storage.upload' && c[1] === 'inspection-photos'));
  s.check('it is resized first, not sent at camera size',
    pc.some(c => c[0] === 'storage.upload' && c[3] < 1e6),
    String((pc.find(c => c[0] === 'storage.upload') || [])[3]));
  s.check('the path is scoped to the inspection and field',
    pc.some(c => c[0] === 'storage.upload' && /^inspections\/[^/]+\/[^/]+\//.test(c[2])));
  s.check('an attachment record is written',
    pc.some(c => c[0] === 'insert' && c[1] === 'attachments'));
  s.check('one photo does NOT satisfy a minimum of two',
    !pc.some(c => c[0] === 'upsert' && c[2] && c[2].field_id === 'i7'));
  s.check('progress shows how many are still needed',
    /1 of 2 required/.test(ph.$('page').textContent));

  pick([{ name: 'b.jpg', size: 5e6 }]);
  await ph.sleep(600);
  const answer = pc.filter(c => c[0] === 'upsert' && c[2] && c[2].field_id === 'i7').pop();
  s.check('reaching the minimum records the answer', !!answer,
    'without this, submit fails with "Photo has not been answered"');
  s.check('the answer says how many', answer && answer[2].value_num === 2);
  s.check('thumbnails are shown', (ph.$('page').innerHTML.match(/<img[^>]+src=/g) || []).length >= 2);

  pdoc.querySelector('[data-rm-photo]').click(); await ph.sleep(450);
  s.check('a photo can be removed', /1 of 2 required/.test(ph.$('page').textContent));
  /* Blanked, never deleted. DELETE on inspection_results is revoked from
     every client role — a captured answer is evidence — so clearing one by
     deleting produced "You do not have access to that record" and left the
     form insisting the field was still answered. */
  s.check('dropping below the minimum clears the answer again',
    pc.some(c => c[0] === 'update' && c[1] === 'inspection_results' &&
      c[2] && c[2].outcome === null && c[2].value_text === null));
  s.check('an answer is never deleted, only blanked',
    !pc.some(c => c[0] === 'delete' && c[1] === 'inspection_results'));

  s.group('as many photos as the job needs');
  /* Multiple photos always worked; the wording did not. Once past the
     minimum it read "4 of 2 taken", which looks like a limit and made it
     seem no more could be added. */
  const many = await loadApp('inspect');
  const mw = many.window, mdoc = many.window.document;
  mdoc.querySelector('#nav button[data-go="work"]').click(); await many.sleep(60);
  mdoc.querySelector('[data-open-capture]').click(); await many.sleep(420);
  const mpick = files => {
    mdoc.querySelector('[data-pick]').click();
    const el = mdoc.getElementById('photoPicker');
    mw.__setFiles(el, files);
    el.dispatchEvent(new mw.Event('change', { bubbles: true }));
  };
  const label = () => many.$('page').textContent;

  s.check('an empty field states the requirement', /0 of 2 required/.test(label()));
  mpick([{ name: 'a.jpg', size: 5e6 }]); await many.sleep(700);
  s.check('below the minimum it counts towards it', /1 of 2 required/.test(label()));
  mpick([{ name: 'b.jpg', size: 5e6 }, { name: 'c.jpg', size: 5e6 }]); await many.sleep(1200);
  s.check('several can be chosen at once', mdoc.querySelectorAll('[data-rm-photo]').length === 3);
  s.check('past the minimum it reports a count, not a target',
    /3 photos attached/.test(label()) && !/3 of 2/.test(label()));
  s.check('the buttons invite another', /Take another/.test(label()) && /Upload another/.test(label()));
  mpick([{ name: 'd.jpg', size: 5e6 }]); await many.sleep(700);
  s.check('there is no cap by default', mdoc.querySelectorAll('[data-rm-photo]').length === 4);
  s.check('and it says so', /Add as many as you need/.test(label()));

  s.group('a maximum can be set when a form needs one');
  const capped = await loadApp('inspect', {
    afterMock: win => {
      const rev = win.GRID_TEST_DATA.template_revisions.find(r => r.status === 'published');
      rev.definition.sections.flatMap(x => x.items)
        .filter(f => f.type === 'photo').forEach(f => { f.minp = 1; f.maxp = 2; });
    }
  });
  const cd2 = capped.window.document;
  cd2.querySelector('#nav button[data-go="work"]').click(); await capped.sleep(60);
  cd2.querySelector('[data-open-capture]').click(); await capped.sleep(420);
  const cpick = files => {
    cd2.querySelector('[data-pick]').click();
    const el = cd2.getElementById('photoPicker');
    capped.window.__setFiles(el, files);
    el.dispatchEvent(new capped.window.Event('change', { bubbles: true }));
  };
  cpick([{ name: 'a.jpg', size: 5e6 }, { name: 'b.jpg', size: 5e6 }]); await capped.sleep(1200);
  s.check('the maximum is shown', /maximum 2/.test(capped.$('page').textContent));
  s.check('the buttons stop at the maximum',
    cd2.querySelector('[data-pick]').disabled && cd2.querySelector('[data-shoot]').disabled);
  cpick([{ name: 'c.jpg', size: 5e6 }]); await capped.sleep(700);
  s.check('and a third is not attached', cd2.querySelectorAll('[data-rm-photo]').length === 2);

  s.group('a repaint while the dialog is open does not lose the photo');
  const mid = await loadApp('inspect');
  const md = mid.window.document;
  md.querySelector('#nav button[data-go="work"]').click(); await mid.sleep(60);
  md.querySelector('[data-open-capture]').click(); await mid.sleep(400);
  md.querySelector('[data-pick]').click(); await mid.sleep(40);
  // repaint, as a realtime event or a tab change would
  md.querySelector('.tabs button[data-tab="0"]').click(); await mid.sleep(80);
  md.querySelector('.tabs button[data-tab="1"]').click(); await mid.sleep(120);
  const mp = md.getElementById('photoPicker');
  s.check('the picker is still attached after a repaint', mp && mp.isConnected);
  mid.window.__setFiles(mp, [{ name: 'x.jpg', size: 5e6 }]);
  mp.dispatchEvent(new mid.window.Event('change', { bubbles: true }));
  await mid.sleep(700);
  s.check('the photo still uploads',
    mid.window.GRID_CALLS.some(c => c[0] === 'storage.upload'));

  s.group('an upload that fails says so, on the field');
  /* Reported as "I can browse but when I upload nothing happens". The failure
     went to a toast that lasts seven seconds — indistinguishable from nothing
     happening, which is precisely how it was described. */
  const noBucket = await loadApp('inspect', {
    afterMock: win => { win.GRID_TEST_DATA.__storageFails = "bucket"; }
  });
  const nb = noBucket.window.document;
  nb.querySelector('#nav button[data-go="work"]').click(); await noBucket.sleep(60);
  nb.querySelector('[data-open-capture]').click(); await noBucket.sleep(400);
  nb.querySelector('[data-pick]').click();
  const nbf = nb.getElementById('photoPicker');
  noBucket.window.__setFiles(nbf, [{ name: 'x.jpg', size: 5e6 }]);
  nbf.dispatchEvent(new noBucket.window.Event('change', { bubbles: true }));
  await noBucket.sleep(800);
  const nbt = noBucket.$('page').textContent;
  s.check('the failure is shown on the field, not only in a toast',
    nbt.includes('did not upload'));
  s.check('a missing bucket is translated into something actionable',
    nbt.includes('photo store has not been set up'));
  s.check('and says who fixes it', nbt.includes('Group IT'));

  s.group('an upload that fails does not look like success');
  const bad = await loadApp('inspect', {
    afterMock: win => { win.GRID_TEST_DATA.__storageFails = true; }
  });
  const bdoc = bad.window.document;
  bdoc.querySelector('#nav button[data-go="work"]').click(); await bad.sleep(60);
  bdoc.querySelector('[data-open-capture]').click(); await bad.sleep(280);
  bdoc.querySelector('[data-pick]').click();
  const bin = bdoc.getElementById('photoPicker');
  bad.window.__setFiles(bin, [{ name: 'c.jpg', size: 5e6 }]);
  bin.dispatchEvent(new bad.window.Event('change', { bubbles: true }));
  await bad.sleep(600);
  s.check('no thumbnail is left behind', !/uploading/.test(bad.$('page').textContent));
  s.check('the count still reads zero', /0 of \d+ required/.test(bad.$('page').textContent));

  s.group('Generate is enabled exactly when it can work');
  /* The button disabled itself. It was gated on a global count of unmet
     readiness steps, and that list ends with "Generate the inspections" —
     never done before the first generate. So the button that creates
     inspections was disabled because no inspections existed.

     The check is per works order now, and each case below asserts both the
     state AND that the reason names the specific thing missing. */
  const genCases = [
    ['everything ready', d2 => { d2.inspections = []; }, null],
    ['no published template', d2 => {
      d2.inspections = []; d2.template_revisions.forEach(r => { r.status = 'draft'; });
    }, 'No template is published'],
    ['project has no product family', d2 => {
      d2.inspections = []; d2.projects.forEach(p => { p.family_id = null; });
    }, 'no product family'],
    ['no requirement for that family', d2 => {
      d2.inspections = []; d2.inspection_requirements = [];
    }, 'No requirements are set'],
    ['works order closed', d2 => {
      d2.inspections = []; d2.works_orders.forEach(o => { o.status = 'closed'; });
    }, 'closed']
  ];
  for (const [label, patch, expectReason] of genCases) {
    const g = await loadApp('inspect', { afterMock: win => patch(win.GRID_TEST_DATA) });
    const gd = g.window.document;
    gd.querySelector('#nav button[data-go="sched"]').click(); await g.sleep(60);
    gd.querySelector('.tabs button[data-tab="2"]').click(); await g.sleep(130);
    const btn = gd.querySelector('[data-act="gen-wo"]');
    if (!expectReason) {
      s.check(`enabled when ${label}`, btn && !btn.disabled,
        btn ? btn.title : 'no button');
    } else {
      s.check(`disabled when ${label}`, btn && btn.disabled, btn ? 'enabled' : 'no button');
      s.check(`  and says why: ${expectReason}`,
        btn && btn.title.includes(expectReason), btn ? btn.title : '');
      s.check('  and says it on the row too, not just a tooltip',
        g.$('page').textContent.includes(expectReason));
    }
  }

  s.group('an empty schedule says what is blocking it');
  /* Reported as "I cannot schedule even if a project is created": the Schedule
     tab said only "Nothing to show yet", which is indistinguishable from a
     broken app. Every screen that can be empty now names the same next step. */
  const partial = await loadApp('inspect', {
    afterMock: win => {
      const D = win.GRID_TEST_DATA;
      D.works_orders = []; D.inspections = []; D.inspection_requirements = [];
      D.projects = [{ id: 1, code: 'P-26118', name: 'Eskom panels', family_id: null, active: true }];
    }
  });
  const pd = partial.window.document;
  for (const [tab, label] of [[0, 'Schedule'], [1, 'Unassigned']]) {
    pd.querySelector('#nav button[data-go="sched"]').click(); await partial.sleep(60);
    pd.querySelector(`.tabs button[data-tab="${tab}"]`).click(); await partial.sleep(120);
    const txt = partial.$('page').textContent;
    s.check(`${label} names the next step`, txt.includes('Next step'));
    s.check(`${label} says what is missing`, txt.includes('tells the scheduler what to inspect'));
    s.check(`${label} links to the screen that fixes it`,
      !!pd.querySelector('[data-goto="req"]'));
  }
  /* The blocker is the FIRST unmet step, not just any of them: a project with
     no family and no works orders are also missing, but the requirements
     matrix comes first in the chain and is what to do next. */
  pd.querySelector('[data-goto="req"]').click(); await partial.sleep(140);
  /* Assert the heading, not body copy: the first version matched a lowercase
     phrase that only appeared as a capitalised table header, so it failed
     against a link that worked perfectly. */
  s.check('the link lands on the requirements matrix',
    partial.$('page').querySelector('h1').textContent.includes('Inspection requirements'));

  pd.querySelector('#nav button[data-go="sched"]').click(); await partial.sleep(60);
  pd.querySelector('.tabs button[data-tab="2"]').click(); await partial.sleep(140);
  const chain = partial.$('page').textContent;
  s.check('the full chain is shown with progress', chain.includes('of 6 done'));
  s.check('completed steps are ticked', chain.includes('1 published'));
  s.check('a project with no product family is flagged',
    chain.includes("Set the project's product family"));
  s.check('deep links carry the tab', !!pd.querySelector('[data-goto="sched:2"]'));

  s.group('an empty division is guided, not left blank');
  /* Booted with nothing set up. Two empty tables and a Save button with
     nothing to save was the confusing part; this asserts the replacement
     tells the user what to do first. */
  const bare = await loadApp('inspect', {
    afterMock: win => {
      win.GRID_TEST_DATA.projects = [];
      win.GRID_TEST_DATA.works_orders = [];
      win.GRID_TEST_DATA.template_revisions.forEach(r => { r.status = 'draft'; });
      win.GRID_TEST_DATA.inspection_requirements = [];
    }
  });
  const bd = bare.window.document;
  bd.querySelector('#nav button[data-go="sched"]').click(); await bare.sleep(80);
  bd.querySelector('.tabs button[data-tab="2"]').click(); await bare.sleep(140);
  const bare_html = bare.$('page').innerHTML;
  s.check('it names the single next step', bare_html.includes('Start with a project'));
  s.check('it flags the missing published template',
    bare_html.includes('has to be published'));
  s.check('it flags the empty requirements matrix',
    bare_html.includes('what to inspect'));
  s.check('it links straight to the screens that fix it',
    !!bd.querySelector('[data-goto="dsn"]') && !!bd.querySelector('[data-goto="req"]'));
  s.check('no empty table with a dead Save button', !bare_html.includes('No unsaved changes'));

  /* Generating has exactly one home now — the works order row. The old header
     dialog was a second path to the same action and, being a dropdown, could
     not show which project or family a works order belonged to. */
  bd.querySelector('.tabs button[data-tab="0"]').click(); await bare.sleep(120);
  s.check('no duplicate generate dialog on the schedule tab',
    !bd.querySelector('[data-act="generate"]'));
  s.check('the schedule tab points at where generating happens',
    bare.$('page').innerHTML.includes('works orders'));

  s.done();
})();
