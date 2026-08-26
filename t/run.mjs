import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8")
  .replace('<script src="config.js?v=1"></script>', "")
  .replace('<script type="module" src="app.js?v=1"></script>', "");

const dom = new JSDOM(html, { url: "https://qgrid-mvs.test/", pretendToBeVisual: true, runScripts: "outside-only" });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(global,"navigator",{value:dom.window.navigator,configurable:true});
Object.defineProperty(global,"location",{value:dom.window.location,configurable:true});
global.confirm = () => true; global.structuredClone = v => JSON.parse(JSON.stringify(v));
global.HTMLElement = dom.window.HTMLElement;

const app = await import("./app.test.mjs");
const { CALLS } = await import("./mock.mjs");
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(300);

let pass = 0, fail = 0;
const check = (name, cond, extra="") => { if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " — " + extra : "")); } };

console.log("\n— gate —");
check("app shell visible after auth", !$("app").classList.contains("hidden"));
check("sign-in gate hidden", $("gateSignIn").classList.contains("hidden"));
check("user name rendered", $("whoName").textContent.includes("Varshan"));
check("division shown", $("sideDivision").textContent.includes("MV Switchgear"));
check("build tag shown", $("buildTag").textContent.includes("abc1234"));

console.log("\n— navigation —");
const navBtns = [...document.querySelectorAll("#nav button[data-go]")];
check("6 modules in nav", navBtns.length === 6, navBtns.length + " found");
check("later phases greyed", document.querySelectorAll("#nav button.off").length === 8);

console.log("\n— every module and tab renders —");
const views = { dash:2, work:4, sched:2, dsn:1, req:1, adm:4 };
for (const [id, tabs] of Object.entries(views)) {
  document.querySelector(`#nav button[data-go="${id}"]`).click();
  await sleep(60);
  for (let t = 0; t < tabs; t++) {
    const tb = document.querySelector(`.tabs button[data-tab="${t}"]`);
    if (tb) { tb.click(); await sleep(60); }
    const len = $("page").innerHTML.length;
    check(`${id} tab ${t} renders`, len > 900, len + " chars");
  }
}

console.log("\n— capture flow —");
document.querySelector('#nav button[data-go="work"]').click(); await sleep(60);
const startBtn = document.querySelector("[data-open-capture]");
check("start button present in queue", !!startBtn);
startBtn.click(); await sleep(200);
check("capture form rendered", !!$("captureForm"));
check("measurement field present", !!document.querySelector('[data-num="i3"]'));
check("overdue instrument disabled", (() => {
  const sel = document.querySelector('[data-equip="i5"]');
  return sel && [...sel.options].some(o => o.disabled && o.textContent.includes("MME-0412"));
})());
check("pass/fail control rendered", !!document.querySelector('[data-field="i4"] [data-outcome="fail"]'));

// record an out-of-tolerance measurement: the app must derive fail from the template
const num = document.querySelector('[data-num="i3"]');
num.value = "61";
num.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await sleep(700);
const upsert = CALLS.filter(c => c[0] === "upsert" && c[1] === "inspection_results").pop();
check("answer written through", !!upsert);
check("out-of-tolerance derived as fail", upsert && upsert[2].outcome === "fail",
  upsert ? JSON.stringify(upsert[2]) : "no call");

document.querySelector('[data-field="i4"] [data-outcome="fail"]').click(); await sleep(500);
const pf = CALLS.filter(c => c[0]==="upsert" && c[2].field_id === "i4").pop();
check("pass/fail written through", pf && pf[2].outcome === "fail");
check("failure warning shown", $("page").innerHTML.includes("failure"));

document.querySelector('[data-act="submit-inspection"]').click(); await sleep(300);
check("submit calls the RPC", CALLS.some(c => c[0]==="rpc" && c[1]==="submit_inspection"));

console.log("\n— form designer —");
document.querySelector('#nav button[data-go="dsn"]').click(); await sleep(80);
const before = document.querySelectorAll(".it").length;
document.querySelector('[data-add="passfail"]').click(); await sleep(60);
check("adding a field grows the canvas", document.querySelectorAll(".it").length === before + 1);
check("save draft enabled once dirty", !document.querySelector('[data-act="save-draft"]').disabled);
document.querySelector(".it.sel [data-del]").click(); await sleep(60);
check("removing a field shrinks it back", document.querySelectorAll(".it").length === before);
document.querySelector('[data-act="toggle-preview"]').click(); await sleep(60);
check("preview renders", $("page").innerHTML.includes("Preview"));
document.querySelector('[data-act="toggle-preview"]').click(); await sleep(60);
document.querySelector('[data-act="publish"]')?.click(); await sleep(200);
check("publish calls the RPC", CALLS.some(c => c[0]==="rpc" && c[1]==="publish_template_revision"));

console.log("\n— requirements matrix —");
document.querySelector('#nav button[data-go="req"]').click(); await sleep(80);
check("matrix has a row per family", document.querySelectorAll(".mx tbody tr").length === 2);
check("hold points absent while disabled", !$("page").innerHTML.includes("Hold point</span> blocks"));
document.querySelector("[data-cell]").click(); await sleep(80);
check("cell editor opens", $("modal").classList.contains("open"));
check("cell editor offers templates", !!$("cTpl"));
check("no hold-point level offered", ![...$("cLvl").options].some(o => o.value === "hold"));
document.querySelector('[data-act="save-cell"]').click(); await sleep(200);
check("saving the cell writes", CALLS.some(c => ["insert","update"].includes(c[0]) && c[1]==="inspection_requirements"));

console.log("\n— administration —");
document.querySelector('#nav button[data-go="adm"]').click(); await sleep(80);
check("inactive user shows activate", $("page").innerHTML.includes("Activate"));
document.querySelector("[data-toggle-active]").click(); await sleep(200);
check("activation writes to profiles", CALLS.some(c => c[0]==="update" && c[1]==="profiles"));
document.querySelector('.tabs button[data-tab="2"]').click(); await sleep(80);
document.querySelector('[data-act="toggle-hp"]').click(); await sleep(200);
check("hold-point switch writes to division", CALLS.some(c => c[0]==="update" && c[1]==="division_profile"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
