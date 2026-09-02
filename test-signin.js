const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const R = __dirname;
const html = fs.readFileSync(path.join(R,'apps/applicant/index.html'),'utf8');
const dom = new JSDOM(html);
const d = dom.window.document;
const checks = []; const t = (n,ok,x)=>checks.push({n,ok:!!ok,x:x||''});

const shell = d.querySelector('.signin-shell');
t('shell exists', !!shell);
const kids = [...shell.children];
t('shell has exactly two children (hero + panel)', kids.length === 2, 'children=' + kids.length);
t('first child is the hero', kids[0] && kids[0].classList.contains('signin-pitch'));
t('second child is the panel wrapper, not the card',
  kids[1] && kids[1].classList.contains('signin-panel'), kids[1] && kids[1].className);
const card = d.querySelector('.signin-card');
t('card sits inside the panel', card && card.parentElement.classList.contains('signin-panel'));
t('card contains the email field', !!card.querySelector('#emailInput'));
t('card contains the send button', !!card.querySelector('#sendCodeBtn'));
t('card contains the privacy note', /privacy notice/.test(card.textContent));

const css = fs.readFileSync(path.join(R,'shared/applicant.css'),'utf8');
t('flex centring is on the panel, not the card', /\.signin-panel \{\s*display: flex/.test(css));
t('card is explicitly block flow', /\.signin-card \{[\s\S]*?display: block/.test(css));
t('no flex rule targets the card directly',
  !/\.signin-shell > div:last-child \{\s*display: flex/.test(css));

const logo = fs.readFileSync(path.join(R,'shared/logo.js'),'utf8');
t('real logo baked in', /data:image\/png;base64,iVBOR/.test(logo));
t('logo is not the empty placeholder', !/var LOGO_LIGHT = '';/.test(logo));
t('logo installed flag true', /installed: !!\(LOGO_LIGHT/.test(logo));
t('three logo slots in applicant html', (html.match(/data-actom-logo/g)||[]).length === 3);

let f=0; console.log('');
for (const c of checks){ if(!c.ok) f++; console.log((c.ok?'PASS  ':'FAIL  ')+c.n+(c.x?'   ['+c.x+']':'')); }
console.log('\n'+(checks.length-f)+'/'+checks.length+' passed');
process.exit(f?1:0);
