/* Injection surface: applicant-supplied text rendered in the console. */
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'), path = require('path');
const RESOLVE = require('./test/harness').resolver('admin');
const vc = new VirtualConsole();
const dom = new JSDOM(fs.readFileSync(RESOLVE('index.html'),'utf8'),
  { runScripts:'dangerously', url:'https://localhost/', virtualConsole: vc, pretendToBeVisual:true });
const { window } = dom, d = window.document;
window.URL.createObjectURL=()=>'blob:x'; window.URL.revokeObjectURL=()=>{};
window.scrollTo=()=>{}; window.open=()=>{}; window.alert=()=>{};
window.confirm=()=>true; window.prompt=()=>'checking the file';
function inject(r){const s=d.createElement('script');s.textContent=fs.readFileSync(RESOLVE(r),'utf8');d.body.appendChild(s);}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const $=id=>d.getElementById(id);
const click=el=>el.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const checks=[]; const t=(n,ok,x)=>checks.push({n,ok:!!ok,x:x||''});

(async()=>{
  const uid=(e=>{let h=0;for(const c of e)h=(h*31+c.charCodeAt(0))>>>0;
    return 'demo-'+h.toString(16).padStart(8,'0')+'-0000-4000-8000-000000000000'.slice(8);})('p.naidoo@actom.co.za');

  // PHASE 1 — throwaway page, purely to let the mock seed itself so we
  // have a database to poison. Re-injecting the mock into a running page
  // does not work: the client holds the first instance in a closure, so
  // the second one is ignored and the payload never reaches the screen.
  const seedDom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts:'dangerously', url:'https://localhost/', virtualConsole: vc });
  seedDom.window.eval(fs.readFileSync(RESOLVE('vendor/supabase.js'),'utf8'));
  const seeded = JSON.parse(seedDom.window.localStorage.getItem('actom_demo_db'));

  // Payloads an applicant can type into ordinary text fields. Nothing
  // stops them: these are free-text inputs and the database stores text.
  const a = seeded.applications[0];
  a.full_name        = 'Victim <span id="X1">Name</span>';
  a.address_line1    = '<img src=x onerror="window.__PWN1=1">12 Main';
  a.disability_other = '<span id="X2" onmouseover="window.__PWN2=1">note</span>';
  a.city             = '<script>window.__PWN3=1</script>Benoni';
  a.contact_number   = '<button id="X3">082</button>';
  // Migration 016 surfaces this field on its own card. It is free text
  // the applicant types, so it belongs in this list.
  a.highest_qualification = 'N4 <img src=x onerror="window.__PWN4=1"><span id="X4">x</span>';
  a.qual_codes   = ['N4'];
  a.qual_points  = 3;
  a.qual_highest = 'N4';
  a.qual_note    = 'Reading of free text. Confirm against the certificate.';
  a.qual_source  = 'parsed';

  // PHASE 2 — the real page, with the poisoned database already in place
  // before a single script runs.
  window.localStorage.setItem('actom_demo_db', JSON.stringify(seeded));
  window.localStorage.setItem('actom_demo_session',
    JSON.stringify({user:{id:uid,email:'p.naidoo@actom.co.za'}}));

  inject('vendor/supabase.js');inject('config.js');inject('logo.js');
  inject('changelog.js');inject('formsetup.js');inject('admin.js');
  await wait(900);

  click($('navBtn'));
  click($('drawer').querySelector('[data-tab="queue"]'));
  await wait(700);

  // Confirm the payload is actually on screen. Without this the checks
  // below would pass on an empty page and prove nothing.
  t('poisoned record reaches the queue', /Victim/.test($('content').textContent),
    'payload present');

  click($('content').querySelector('tr[data-open]'));
  await wait(800);

  const html = $('content').innerHTML;
  t('poisoned record reaches the detail view', /Victim|12 Main/.test($('content').textContent));
  t('injected span does not become an element', !d.getElementById('X1'));
  t('injected span in notes does not become an element', !d.getElementById('X2'));
  t('injected button does not become an element', !d.getElementById('X3'));
  t('img onerror did not execute', !window.__PWN1);
  t('inline script did not execute', !window.__PWN3);
  // Check for real ATTRIBUTES, not the substring. Escaped payloads still
  // contain the characters "onerror=" as inert text — matching on the
  // string would fail on correctly escaped output and pass on nothing.
  // Scoped to #content: the demo banner carries its own onclick for the
  // reset button, which is harness furniture and not production code.
  t('no live event-handler attribute in rendered data',
    $('content').querySelectorAll('[onerror],[onmouseover],[onload],[onclick]').length === 0,
    'nodes=' + $('content').querySelectorAll('[onerror],[onmouseover],[onload],[onclick]').length);
  t('no injected element of any kind',
    $('content').querySelectorAll('img,script,iframe,object,embed').length === 0);
  t('payload rendered as escaped text', /&lt;/.test(html));

  // Migration 016 — the qualification card renders a free-text field.
  t('qualification card reaches the detail view', /Qualification held/.test($('content').textContent));
  t('injected span in qualification does not become an element', !d.getElementById('X4'));
  t('img onerror in qualification did not execute', !window.__PWN4);
  t('qualification card says the points do not count',
    /not part of the score or the rank/.test($('content').textContent));

  const src = fs.readFileSync(path.join(__dirname,'apps/admin/admin.js'),'utf8');
  t('kv() escapes by default rather than sniffing',
    /function kv\(k, v, isHtml\)/.test(src) && !/<button\|<span/.test(src));

  let f=0; console.log('');
  for (const c of checks){ if(!c.ok) f++;
    console.log((c.ok?'PASS  ':'FAIL  ')+c.n+(c.x?'   ['+c.x+']':'')); }
  console.log('\n'+(checks.length-f)+'/'+checks.length+' passed');
  process.exit(f?1:0);
})();
