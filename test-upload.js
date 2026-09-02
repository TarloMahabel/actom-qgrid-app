const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const RESOLVE = require('./test/harness').resolver('applicant');

const vc = new VirtualConsole(); const logs = [];
vc.on('jsdomError', e => logs.push('JSDOM: ' + e.message));
vc.on('error', (...a) => logs.push('err: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(RESOLVE('index.html'), 'utf8'),
  { runScripts: 'dangerously', url: 'https://localhost/', virtualConsole: vc, pretendToBeVisual: true });
const { window } = dom, d = window.document;
window.URL.createObjectURL = () => 'blob:x';
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};
window.alert = m => logs.push('ALERT: ' + m);
window.confirm = () => true;
window.Element.prototype.scrollIntoView = function () {};

function inject(rel) {
  const s = d.createElement('script');
  s.textContent = fs.readFileSync(RESOLVE(rel), 'utf8');
  d.body.appendChild(s);
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = id => d.getElementById(id);
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));

const checks = [];
const check = (n, ok, x) => checks.push({ n, ok: !!ok, x: x || '' });

// A minimal valid PDF, so the magic-byte sniff passes.
/* A PDF whose arrayBuffer() takes a while to resolve, standing in for a
   multi-megabyte photo being read and SHA-256 hashed on a phone. This is
   the window in which the double-upload bug happened: the guard used to
   be armed only after hashing finished. */
function slowPdfFile(name, delayMs) {
  const f = pdfFile(name);
  const realArrayBuffer = f.arrayBuffer.bind(f);
  f.arrayBuffer = () => new Promise(res => setTimeout(() => res(realArrayBuffer()), delayMs));
  return f;
}

function pdfFile(name) {
  const bytes = new Uint8Array(64);
  bytes[0] = 0x25; bytes[1] = 0x50; bytes[2] = 0x44; bytes[3] = 0x46;  // %PDF
  return new window.File([bytes], name, { type: 'application/pdf' });
}

(async () => {
  inject('vendor/supabase.js'); inject('config.js'); inject('app.js');
  await wait(250);
  $('emailInput').value = 'upload.test@example.com';
  click($('sendCodeBtn')); await wait(200);
  $('codeInput').value = '123456'; click($('verifyBtn')); await wait(900);

  const c = $('content');
  // Walk to the documents step
  $('fullName').value = 'Upload Test'; $('idNumber').value = '9803122081084';
  click(c.querySelector('[data-nav="next"]')); await wait(700);
  $('contact_number').value = '0821234567'; $('address_line1').value = '1 Main'; $('city').value = 'Benoni';
  click(c.querySelector('[data-nav="next"]')); await wait(500);
  click(c.querySelectorAll('[data-trade]')[1]);
  click(c.querySelector('[data-nav="next"]')); await wait(900);
  click(c.querySelector('[data-nav="next"]')); await wait(500);   // equity
  $('grade12_type').value = 'nsc';
  c.querySelectorAll('input[data-required]').forEach(i => { i.value = '65'; });
  click(c.querySelector('[data-nav="next"]')); await wait(700);   // school
  click(c.querySelector('[data-nav="next"]')); await wait(700);   // further
  check('reached documents step', /Your documents/.test(c.textContent));

  // --- visit 1: upload one file
  async function uploadInto(docType, name) {
    const input = c.querySelector('[data-input="' + docType + '"]');
    Object.defineProperty(input, 'files', { value: [pdfFile(name)], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait(500);
  }

  await uploadInto('id_document', 'id-one.pdf');
  const after1 = c.querySelectorAll('[data-list="id_document"] .file-item').length;
  check('first upload produces exactly one row', after1 === 1, 'rows=' + after1);

  // --- leave the step and come back, which is what triggered the doubling
  click(c.querySelector('[data-nav="back"]')); await wait(500);
  click(c.querySelector('[data-nav="next"]')); await wait(700);
  check('back on documents step', /Your documents/.test(c.textContent));
  const persisted = c.querySelectorAll('[data-list="id_document"] .file-item').length;
  check('existing upload still listed after revisit', persisted === 1, 'rows=' + persisted);

  // --- a second file into a max:1 slot must be refused, not duplicated
  await uploadInto('id_document', 'id-two.pdf');
  const after2 = c.querySelectorAll('[data-list="id_document"] .file-item').length;
  check('second file into a single-file slot refused', after2 === 1, 'rows=' + after2);
  check('refusal is explained to the applicant',
        /Remove one first/.test(c.querySelector('[data-err="doc_id_document"]').textContent),
        c.querySelector('[data-err="doc_id_document"]').textContent.slice(0, 50));

  // --- multi-file slot after a revisit must add exactly one per upload
  await uploadInto('qualification', 'cert-a.pdf');
  await uploadInto('qualification', 'cert-b.pdf');
  const quals = c.querySelectorAll('[data-list="qualification"] .file-item').length;
  check('two uploads into a multi-file slot give exactly two rows', quals === 2, 'rows=' + quals);

  // --- remove fires once, not once per visit
  const before = c.querySelectorAll('[data-list="qualification"] .file-item').length;
  click(c.querySelector('[data-list="qualification"] [data-remove]'));
  await wait(500);
  const afterRemove = c.querySelectorAll('[data-list="qualification"] .file-item').length;
  check('remove deletes exactly one row', afterRemove === before - 1,
        before + ' -> ' + afterRemove);

  console.log('');
  // ---- accepted file types ------------------------------------------
  // HEIC is no longer accepted (the Supabase bucket rejects it too), but
  // it must still be RECOGNISED so an iPhone user gets told how to fix
  // it rather than a generic refusal.
  const cfgTypes = Object.keys(window.ACTOM_CONFIG.ACCEPTED_TYPES);
  check('only PDF, JPEG and PNG accepted',
    cfgTypes.sort().join(',') === 'application/pdf,image/jpeg,image/png',
    cfgTypes.join(','));

  const picker = $('content').querySelector('[data-input]');
  check('file picker offers no HEIC',
    picker && !/heic/i.test(picker.getAttribute('accept') || ''),
    picker ? picker.getAttribute('accept') : '(none)');

  const src = fs.readFileSync(RESOLVE('app.js'), 'utf8');
  check('HEIC still detected so the message can be specific',
    /ftyp\(heic/.test(src));
  check('HEIC gets iPhone-specific guidance',
    /Most Compatible/.test(src));

  // ---- waiting state -------------------------------------------------
  check('busy helper exists', /function setUploadBusy/.test(src));
  check('drop zone is disabled during upload, not just relabelled',
    /input\.disabled = !!busy/.test(src));
  check('busy state is announced to screen readers',
    /aria-live/.test(src));
  check('busy state is cleared however the upload ends',
    /setUploadBusy\(docType, false\)/.test(src));

  const css = fs.readFileSync(
    require('path').join(__dirname, 'shared', 'applicant.css'), 'utf8');
  check('spinner styled', /\.spinner\s*\{/.test(css));
  check('drag-and-drop also blocked while busy',
    /\.drop\.is-busy[\s\S]{0,160}pointer-events: none/.test(css));
  check('reduced-motion respected', /prefers-reduced-motion[\s\S]{0,120}\.spinner/.test(css));

  // ---- the double-upload bug -----------------------------------------
  // Reported: "nothing happens, so I redo the upload, then 2 uploads
  // happen at the same time". Reproduced by choosing a slow-to-read file
  // twice in quick succession, which is exactly what an impatient
  // applicant does when the first tap appears to do nothing.
  const beforeDouble =
    $('content').querySelectorAll('[data-list="matric_certificate"] .file-item').length;

  const slowInput = $('content').querySelector('[data-input="matric_certificate"]');
  if (slowInput) {
    Object.defineProperty(slowInput, 'files',
      { value: [slowPdfFile('slow-one.pdf', 400)], configurable: true });
    slowInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    // Feedback must appear IMMEDIATELY, not after hashing finishes.
    await wait(60);
    const drop = $('content').querySelector('[data-doctype="matric_certificate"]');
    check('waiting state shows before hashing finishes',
      drop && drop.classList.contains('is-busy'));
    check('control is disabled straight away',
      slowInput.disabled === true);

    // The impatient second attempt, while the first is still hashing.
    Object.defineProperty(slowInput, 'files',
      { value: [slowPdfFile('slow-two.pdf', 400)], configurable: true });
    slowInput.dispatchEvent(new window.Event('change', { bubbles: true }));

    await wait(1600);
    const afterDouble =
      $('content').querySelectorAll('[data-list="matric_certificate"] .file-item').length;
    check('two rapid attempts produce exactly ONE upload',
      afterDouble === beforeDouble + 1,
      beforeDouble + ' -> ' + afterDouble);

    check('control is released once finished', slowInput.disabled === false);
    check('waiting state cleared',
      !$('content').querySelector('[data-doctype="matric_certificate"]').classList.contains('is-busy'));
  }

  // A rejected file must not leave the slot locked.
  const badInput = $('content').querySelector('[data-input="matric_certificate"]');
  if (badInput) {
    const notPdf = new window.File([new Uint8Array([0x00, 0x01, 0x02, 0x03])],
      'bad.pdf', { type: 'application/pdf' });
    Object.defineProperty(badInput, 'files', { value: [notPdf], configurable: true });
    badInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await wait(500);
    check('a rejected file releases the slot for a retry',
      badInput.disabled === false);
  }

  console.log('');
  // ---- the configured limit is stated, not just enforced -------------
  // The count comes from the intake config, so it cannot be written into
  // the copy. An applicant should know the limit before hitting it.
  const qualField = Array.from($('content').querySelectorAll('.field'))
    .find(f => f.querySelector('[data-doctype="qualification"]'));
  check('multi-file slot states its limit',
    qualField && /up to \d+ files/.test(qualField.querySelector('.hint').textContent),
    qualField ? qualField.querySelector('.hint').textContent.slice(-40) : '(none)');

  const idField = Array.from($('content').querySelectorAll('.field'))
    .find(f => f.querySelector('[data-doctype="id_document"]'));
  check('single-file slot says so',
    idField && /One file only/.test(idField.querySelector('.hint').textContent),
    idField ? idField.querySelector('.hint').textContent.slice(-30) : '(none)');

  // ---- a full slot looks full ----------------------------------------
  // id_document is max:1 and already holds a file from earlier.
  const idDrop = $('content').querySelector('[data-doctype="id_document"]');
  const idBtn = idDrop && idDrop.querySelector('[data-pick="id_document"]');
  check('full slot is marked full', idDrop && idDrop.classList.contains('is-full'));
  check('full slot disables its button', idBtn && idBtn.disabled === true);
  check('full slot says what to do instead',
    idDrop && /Remove one to replace it/.test(idDrop.textContent));

  // The hidden input must NOT be disabled by fullness — that flag means
  // "upload in flight" and setUploadBusy owns it. Overloading the two
  // makes "did the busy lock release?" unanswerable.
  const idInput = $('content').querySelector('[data-input="id_document"]');
  check('fullness does not touch the busy flag on the input',
    idInput && idInput.disabled === false);

  // ---- removing a file reopens the slot ------------------------------
  click($('content').querySelector('[data-list="id_document"] [data-remove]'));
  await wait(500);
  const idDrop2 = $('content').querySelector('[data-doctype="id_document"]');
  const idBtn2 = idDrop2 && idDrop2.querySelector('[data-pick="id_document"]');
  check('removing a file reopens the slot',
    idDrop2 && !idDrop2.classList.contains('is-full'));
  check('button is usable again after a removal', idBtn2 && idBtn2.disabled === false);

  // ---- the slot state survives leaving and returning ------------------
  await uploadInto('id_document', 'id-again.pdf');
  click(c.querySelector('[data-nav="back"]')); await wait(500);
  click(c.querySelector('[data-nav="next"]')); await wait(700);
  const idDrop3 = $('content').querySelector('[data-doctype="id_document"]');
  check('full state is restored on returning to the step',
    idDrop3 && idDrop3.classList.contains('is-full'));

  // ---- the database is the real limit --------------------------------
  // The count is enforced by a trigger (migration 015). Its message has
  // to become something an applicant can act on, or the browser check
  // being bypassed produces raw Postgres text on a phone.
  check('database limit errors are translated',
    /Upload limit reached/.test(src) && /function uploadErrorText/.test(src));
  check('hidden document type error is translated',
    /is not accepted for this intake/.test(src));
  check('storage refusal is translated',
    /row-level security/.test(src));

  // ---- orphaned storage objects --------------------------------------
  // The object goes up before the catalogue row. A failed row used to
  // leave the bytes in the bucket forever, counting against the storage
  // ceiling with nothing pointing at them.
  check('a failed catalogue insert removes the uploaded object',
    /if \(stored\)[\s\S]{0,120}\.remove\(\[path\]\)/.test(src));

  const cl = fs.readFileSync(
    require('path').join(__dirname, 'shared', 'changelog.js'), 'utf8');
  check('changelog records the enforcement change',
    /Max files[\s\S]{0,160}enforced by the database/.test(cl));

  let fails = 0;
  for (const ch of checks) { if (!ch.ok) fails++;
    console.log((ch.ok ? 'PASS  ' : 'FAIL  ') + ch.n + (ch.x ? '   [' + ch.x + ']' : '')); }
  if (logs.length) { console.log('\n--- captured ---'); logs.slice(0,8).forEach(l => console.log('  ' + l)); }
  console.log('\n' + (checks.length - fails) + '/' + checks.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
