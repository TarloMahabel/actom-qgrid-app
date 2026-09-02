const { JSDOM } = require('jsdom');
const fs=require('fs'),path=require('path');
const RESOLVE=require('./test/harness').resolver('applicant');

async function run(status){
  const seed=new JSDOM('<!doctype html><body></body>',{runScripts:'dangerously',url:'https://localhost/'});
  seed.window.eval(fs.readFileSync(RESOLVE('vendor/supabase.js'),'utf8'));
  const db=JSON.parse(seed.window.localStorage.getItem('actom_demo_db'));
  const app=db.applications[0];
  app.status=status; app.submitted_at=new Date().toISOString();
  const dom=new JSDOM(fs.readFileSync(RESOLVE('index.html'),'utf8'),
    {runScripts:'dangerously',url:'https://localhost/',pretendToBeVisual:true});
  const {window}=dom,d=window.document;
  window.URL.createObjectURL=()=>'blob:x';window.URL.revokeObjectURL=()=>{};
  window.scrollTo=()=>{};window.open=()=>{};window.alert=()=>{};window.confirm=()=>true;
  window.HTMLElement.prototype.scrollIntoView=function(){};
  window.localStorage.setItem('actom_demo_db',JSON.stringify(db));
  window.localStorage.setItem('actom_demo_session',
    JSON.stringify({user:{id:app.applicant_user_id,email:'a@x.com'}}));
  ['vendor/supabase.js','config.js','logo.js','app.js'].forEach(r=>{
    const s=d.createElement('script');s.textContent=fs.readFileSync(RESOLVE(r),'utf8');d.body.appendChild(s);});
  await new Promise(r=>setTimeout(r,1200));
  return d.getElementById('content');
}

const checks=[];const t=(n,ok,x)=>checks.push({n,ok:!!ok,x:x||''});
(async()=>{
  let c = await run('submitted');
  const okTxt = c.textContent;
  t('submitted: shows the roadmap', /What happens from here/.test(okTxt));
  t('submitted: encouraging heading', /You have applied/.test(okTxt));
  t('submitted: can withdraw', !!c.querySelector('#withdrawBtn'));

  c = await run('declined');
  const dTxt = c.textContent;
  t('declined: roadmap is GONE', !/What happens from here/.test(dTxt));
  t('declined: no "hard part done"', !/hard part done/.test(dTxt));
  t('declined: says not successful', /not successful/i.test(dTxt));
  t('declined: still shows the reference', /ACT-APP/.test(dTxt));
  t('declined: encourages reapplying', /apply again/i.test(dTxt));
  t('declined: no withdraw button', !c.querySelector('#withdrawBtn'));
  t('declined: can still download own data', !!c.querySelector('#exportBtn'));
  t('declined: no future-tense promises', !/You start earning|Qualified artisan/.test(dTxt));

  c = await run('withdrawn');
  const wTxt = c.textContent;
  t('withdrawn: roadmap is GONE', !/What happens from here/.test(wTxt));
  t('withdrawn: says withdrawn', /withdrawn/i.test(wTxt));
  t('withdrawn: no withdraw button', !c.querySelector('#withdrawBtn'));

  let f=0;console.log('');
  for(const ch of checks){if(!ch.ok)f++;console.log((ch.ok?'PASS  ':'FAIL  ')+ch.n+(ch.x?'   ['+ch.x+']':''));}
  console.log('\n'+(checks.length-f)+'/'+checks.length+' passed');process.exit(f?1:0);
})();
