/* ============================================================
   ACTOM Grid — Inspections (Phase 1)
   Wired application. Plain script, no build step.

   WRAPPED IN A FUNCTION, DELIBERATELY.

   vendor/supabase.js declares a global `var supabase`. This file needs a
   local binding of the same name. At the top level of a classic script a
   `const supabase` collides with that existing global and the browser
   refuses to parse the WHOLE FILE:

     Uncaught SyntaxError: Identifier 'supabase' has already been declared

   Nothing runs, nothing is logged beyond that one line, and the splash
   screen sits there forever. A function scope keeps the binding local and
   the clash cannot happen.

   Reading order:
     1. state and helpers
     2. auth gate
     3. data layer
     4. views
     5. actions (writes)
     6. boot
   ============================================================ */
(function () {
"use strict";

/* No imports: this is a plain script. The Supabase client is set up by
   supabase.js, which runs first and exposes window.GRID. That keeps the
   Content-Security-Policy at script-src 'self' with no CDN origins. */
if (!window.GRID) {
  /* supabase.js sets window.GRID. If it is absent, either vendor/supabase.js did
     not execute — a missing file served as index.html by the SPA redirect looks
     exactly like this — or config.js is absent. Say which. */
  const why = !window.supabase
    ? "vendor/supabase.js did not load. The deploy is missing that file, or it was served as HTML by the catch-all redirect."
    : !window.GRID_CONFIG
      ? "config.js did not load. The build generates it from the site environment variables."
      : "supabase.js did not run.";
  document.getElementById("loader")?.remove();
  document.body.insertAdjacentHTML("afterbegin",
    `<div style="font:15px system-ui;padding:40px;max-width:620px;margin:0 auto">
       <h2>Grid could not start</h2><p>${why}</p></div>`);
  throw new Error("ACTOM Grid: " + why);
}
const { supabase, DIVISION, BUILD, signIn, signOutNow, signInWithPassword,
        currentProfile, explain } = window.GRID;

/* ------------------------------------------------------------
   1. State and helpers
   ------------------------------------------------------------ */
const S = {
  profile: null,
  division: null,                 // division_profile row (holds hold_points)
  view: "dash", tab: 0,
  stages: [], departments: [], families: [], defects: [], equipment: [],
  templates: [], revisions: [], requirements: [],
  projects: [], worksOrders: [], inspections: [], failedChecks: [], people: [],
  dash: {},
  refDraft: {},                   // pending reference-list edits, keyed table|id|field
  designer: { open: false, tplId: null, revId: null, def: null, sel: null, preview: false, dirty: false },
  capture: { id: null, results: {} }
};

/* CHANGELOG lives in changelog.js so a release note is a one-line edit
   in one place, not a hunt through the application. */

const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const HP = () => !!S.division?.hold_points;
/* Off by default: a division with one Quality Manager would otherwise be
   unable to publish anything it had built. */
const NEEDS_2ND = () => !!S.division?.require_second_approver;
const isRole = (...r) => r.includes(S.profile?.role);
const canConfigure = () => isRole("quality_manager", "sysadmin");
const canPlan = () => isRole("planner", "quality_engineer", "quality_manager", "sysadmin");
const stageName = id => S.stages.find(s => s.id === id)?.name ?? "—";
const byId = (arr, id) => arr.find(x => x.id === id);
const fmtDate = d => d ? new Date(d).toLocaleDateString("en-ZA", { day:"2-digit", month:"short" }) : "—";
const today = () => new Date().toISOString().slice(0, 10);

let toastTimer;
function toast(msg, kind = "") {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), kind === "bad" ? 7000 : 3500);
}
const busy = on => $("busy").classList.toggle("hidden", !on);

function pill(t) {
  const s = String(t).toLowerCase(); let c = "p-grey";
  if (/pass|complete|published|active|in date|awaiting activation/.test(s)) c = "p-ok";
  else if (/fail|overdue|held|quarantin|draft|expired|blocked/.test(s)) c = "p-bad";
  else if (/scheduled|progress|review|unassigned|due|awaiting|optional/.test(s)) c = "p-warn";
  else if (/required|superseded|hold/.test(s)) c = "p-info";
  return `<span class="pill ${c}">${esc(t)}</span>`;
}
function T(cols, rows) {
  if (!rows.length) return `<div class="card"><div class="empty">Nothing to show yet.</div></div>`;
  return `<div class="card"><div style="overflow-x:auto"><table><thead><tr>${
    cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${
    rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")
  }</tbody></table></div></div>`;
}

/* ------------------------------------------------------------
   2. Auth gate
   ------------------------------------------------------------ */
const show = which => {
  ["gateSignIn","gatePending","app"].forEach(id => $(id).classList.add("hidden"));
  if (which) $(which).classList.remove("hidden");
};

let recheckTimer;
async function gate() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { show("gateSignIn"); return false; }

  let profile;
  try { profile = await currentProfile(); }
  catch (e) { $("signInErr").textContent = explain(e); $("signInErr").classList.remove("hidden"); show("gateSignIn"); return false; }

  // The profile row is created by a database trigger on first sign-in, but a
  // moment can pass between the two. Treat "not there yet" as pending, not broken.
  if (!profile || !profile.active) {
    $("pendingWho").textContent = session.user.email;
    show("gatePending");
    clearInterval(recheckTimer);
    recheckTimer = setInterval(() => gate().then(ok => { if (ok) clearInterval(recheckTimer); }), 20000);
    return false;
  }

  clearInterval(recheckTimer);
  S.profile = profile;
  bootedUserId = session.user.id;
  show("app");
  return true;
}

/* ------------------------------------------------------------
   3. Data layer
   Parallel waves, not sequential awaits: on a shop-floor tablet the
   difference between the two is several seconds of staring at a spinner.
   ------------------------------------------------------------ */
async function loadData() {
  busy(true);
  try {
    const [division, ref] = await Promise.all([
      supabase.from("division_profile").select("*").maybeSingle(),
      Promise.all([
        supabase.from("manufacturing_stages").select("*").eq("active", true).order("sort_order"),
        supabase.from("departments").select("*").order("sort_order"),
        supabase.from("product_families").select("*").eq("active", true).order("name"),
        supabase.from("defect_codes").select("*").eq("active", true).order("code"),
        supabase.from("equipment").select("*").eq("active", true).order("asset_no")
      ])
    ]);
    if (division.error) throw division.error;
    S.division = division.data || { hold_points: false, name: DIVISION.name };
    const [st, dp, fm, df, eq] = ref;
    for (const r of ref) if (r.error) throw r.error;
    S.stages = st.data; S.departments = dp.data; S.families = fm.data;
    S.defects = df.data; S.equipment = eq.data;

    const [tpl, rev, req, prj, wo, ins, fc, ppl, dash] = await Promise.all([
      supabase.from("inspection_templates").select("*").order("code"),
      supabase.from("template_revisions").select("*").order("rev", { ascending: false }),
      supabase.from("inspection_requirements").select("*"),
      supabase.from("projects").select("*").eq("active", true).order("code"),
      supabase.from("works_orders").select("*").order("code"),
      supabase.from("inspections").select("*").order("planned_date").limit(500),
      supabase.from("failed_checks").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("profiles").select("id,full_name,email,role,department_id,active"),
      supabase.from("v_dashboard").select("*").maybeSingle()
    ]);
    for (const r of [tpl, rev, req, prj, wo, ins, fc, ppl]) if (r.error) throw r.error;
    S.templates = tpl.data; S.revisions = rev.data; S.requirements = req.data;
    S.projects = prj.data; S.worksOrders = wo.data;
    S.inspections = ins.data; S.failedChecks = fc.data;
    S.people = ppl.data || []; S.dash = dash.data || {};
  } catch (e) {
    console.error(e);
    toast(explain(e), "bad");
  } finally {
    busy(false);
  }
}
const reload = async () => { await loadData(); render(); };

/* Realtime, debounced. Several inspectors submitting at once should cause
   one repaint, not six.

   The channel is torn down before a new one is opened. supabase.channel()
   hands back the EXISTING channel when the name is already in use, and
   calling .on() on a channel that has already subscribed throws:

     cannot add `postgres_changes` callbacks for realtime:qgrid after `subscribe()`

   which is what happened every time boot ran twice. */
let rtTimer, channel = null;
function subscribe() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
  const bump = () => { clearTimeout(rtTimer); rtTimer = setTimeout(reload, 600); };
  channel = supabase.channel("qgrid")
    .on("postgres_changes", { event: "*", schema: "public", table: "inspections" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "failed_checks" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "template_revisions" }, bump)
    .on("postgres_changes", { event: "*", schema: "public", table: "inspection_requirements" }, bump)
    .subscribe();
}

/* ------------------------------------------------------------
   4. Views
   ------------------------------------------------------------ */
const NAV = [
  { g: "Inspections" },
  { id: "dash",  n: 1, t: "Dashboard",               col: "--m1", tabs: ["Overview", "Yield by stage"] },
  { id: "work",  n: 2, t: "Inspection workbench",    col: "--m2", tabs: ["My queue", "Capture", "Register", "Failed checks"] },
  { id: "sched", n: 3, t: "Scheduling",              col: "--m3",
    tabs: ["Schedule", "Unassigned", "Projects & works orders"] },
  { g: "Setup" },
  { id: "dsn",   n: 4, t: "Form designer",           col: "--m4", tabs: [] },
  { id: "req",   n: 5, t: "Inspection requirements", col: "--m5", tabs: ["Requirements matrix"] },
  { id: "adm",   n: 6, t: "Administration",          col: "--m6", tabs: ["Users & roles", "Reference lists", "Options", "Audit trail"] },
  { g: "Later phases" },
  ...["NCR management","Calibration","Document control","Training & competency",
      "Supplier quality","Customer quality","Audits & compliance","Performance analytics"]
     .map(t => ({ off: 1, t }))
];
const setupIds = ["dsn", "req", "adm"];

function buildNav() {
  $("nav").innerHTML = NAV.filter(n => !(setupIds.includes(n.id) && !canConfigure()))
    .map(n => {
      if (n.g) return `<div class="grp">${n.g}</div>`;
      if (n.off) return `<button class="off" title="Deferred to a later phase"><span class="num" style="background:#8593a9">·</span><span>${n.t}</span><span class="later">Phase 2+</span></button>`;
      const badge = n.id === "work" ? myQueue().length : n.id === "sched" ? unassigned().length : 0;
      return `<button class="${n.id === S.view ? "on" : ""}" data-go="${n.id}">
        <span class="num" style="background:var(${n.col})">${n.n}</span><span>${n.t}</span>
        ${badge ? `<span class="badge">${badge}</span>` : ""}</button>`;
    }).join("");
}
const go = v => { S.view = v; S.tab = 0; buildNav(); render(); window.scrollTo(0, 0); };
function tabsFor(m) { return m.tabs; }
function tabbar(m) {
  const ts = tabsFor(m);
  return ts.length ? `<div class="tabs">${ts.map((t, i) =>
    `<button class="${i === S.tab ? "on" : ""}" data-tab="${i}">${t}</button>`).join("")}</div>` : "";
}
function head(m, desc, act) {
  return `<div class="phead"><div>
    <h1>${m.t}</h1><div class="accent"></div>
    <div class="eyebrow">Module ${m.n} · ACTOM Grid</div>
    <p>${desc}</p></div><div class="pact">${act || ""}</div></div>`;
}
const foot = () => `<div class="foot">
  <div><span class="b">${S.inspections.filter(i => i.status !== "completed").length} open</span> ·
       <span class="b">${S.failedChecks.filter(f => f.disposition === "awaiting").length} awaiting disposition</span> ·
       <span class="b">${publishedRevs().length} of ${S.templates.length} templates published</span></div>
  <div>${esc(S.division?.name || DIVISION.name)} · hold points ${HP() ? "enabled" : "disabled"}</div>
  <div>ACTOM Grid · a division of ACTOM (Pty) Ltd · Since 1903</div></div>`;

const publishedRevs = () => S.revisions.filter(r => r.status === "published");
const revFor = tplId => publishedRevs().find(r => r.template_id === tplId);
const tplForRev = revId => {
  const r = byId(S.revisions, revId);
  return r ? byId(S.templates, r.template_id) : null;
};
const myQueue = () => S.inspections.filter(i =>
  i.status !== "completed" && i.status !== "cancelled" &&
  (i.assigned_to === S.profile?.id || i.department_id === S.profile?.department_id));
const unassigned = () => S.inspections.filter(i => !i.assigned_to && i.status === "scheduled");

/* ---- 1 Dashboard ---- */
function vDash(m) {
  const d = S.dash;
  const overdueCls = d.overdue > 0 ? "alert" : "good";
  let body;
  if (S.tab === 0) {
    body = `<div class="four" style="margin-bottom:13px">
      <div class="card kpi good"><div class="k">Pass rate — 30 days</div><div class="v">${d.pass_rate_30d ?? "—"}${d.pass_rate_30d != null ? "%" : ""}</div><div class="d">${d.completed_30d ?? 0} inspections completed</div></div>
      <div class="card kpi ${overdueCls}"><div class="k">Overdue</div><div class="v">${d.overdue ?? 0}</div><div class="d">past their planned date</div></div>
      <div class="card kpi ${d.unassigned ? "warn" : "good"}"><div class="k">Unassigned</div><div class="v">${d.unassigned ?? 0}</div><div class="d">scheduled with no inspector</div></div>
      <div class="card kpi ${d.awaiting_disposition ? "alert" : "good"}"><div class="k">Awaiting disposition</div><div class="v">${d.awaiting_disposition ?? 0}</div><div class="d">failed checks with no decision</div></div>
    </div>
    ${nextStep() ? readinessCard("Setup is not finished") : ""}
    <div class="card"><h3>Open work</h3>${
      T(["Reference", "Inspection", "Stage", "Unit", "Planned", "Inspector", "Status"],
        S.inspections.filter(i => i.status !== "completed").slice(0, 12).map(i => {
          const t = tplForRev(i.template_rev_id);
          return [`<span class="id">${esc(i.ref)}</span>`, esc(t?.name || "—"), esc(stageName(i.stage_id)),
                  esc(i.unit_ref || "—"), fmtDate(i.planned_date),
                  esc(byId(S.people, i.assigned_to)?.full_name || "—"),
                  pill(i.planned_date < today() && i.status === "scheduled" ? "Overdue" : i.status)];
        })).replace('<div class="card">', "<div>")}</div>`;
  } else {
    body = `<div class="card"><h3>Pass rate by stage <span class="cl">rolling 30 days</span></h3>
      <div class="bd" id="yieldHost"><div class="empty">Loading…</div></div></div>`;
    loadYield();
  }
  return head(m, `Inspection performance for ${esc(S.division?.name || DIVISION.name)}. Every figure is read from a database view, so it cannot drift from the records.`,
    `<button class="btn" data-act="refresh">Refresh</button>`) + tabbar(m) + body;
}
/* Called from render() without await, so a thrown error here becomes an
   unhandled rejection: nothing on screen, nothing actionable in the console.
   Checking the returned `error` covered a Postgres error but not a network
   failure, which throws. */
async function loadYield() {
  const host = $("yieldHost"); if (!host) return;
  let data, error;
  try { ({ data, error } = await supabase.from("v_stage_yield").select("*")); }
  catch (e) { error = e; }
  if (!$("yieldHost")) return;                       // view changed while loading
  if (error) { host.innerHTML = `<div class="empty">${esc(explain(error))}</div>`; return; }
  if (!data?.length) { host.innerHTML = `<div class="empty">No completed inspections in the last 30 days.</div>`; return; }
  const max = Math.max(...data.map(r => r.inspections));
  host.innerHTML = `<div class="bars">${data.map(r => `<div class="b">
      <b>${r.pass_rate ?? 0}%</b>
      <i style="height:${Math.round(r.inspections / max * 100)}%;background:${
        r.pass_rate < 90 ? "var(--bad)" : r.pass_rate < 95 ? "var(--warn)" : "var(--brand)"}"></i>
      <span>${esc(r.stage)}</span></div>`).join("")}</div>
    <div class="legend"><span><i style="background:var(--bad)"></i>below 90%</span>
    <span><i style="background:var(--warn)"></i>90–95%</span>
    <span><i style="background:var(--brand)"></i>above 95%</span>
    <span style="margin-left:auto">bar height is volume, label is pass rate</span></div>`;
}

/* ---- 2 Workbench ---- */
function vWork(m) {
  let body = "";
  if (S.tab === 0) {
    const q = myQueue();
    body = q.length ? T(["Reference", "Inspection", "Stage", "Unit", "Planned", "Status", ""],
      q.map(i => {
        const t = tplForRev(i.template_rev_id);
        return [`<span class="id">${esc(i.ref)}</span>`, esc(t?.name || "—"), esc(stageName(i.stage_id)),
          esc(i.unit_ref || "—"), fmtDate(i.planned_date),
          pill(i.planned_date < today() && i.status === "scheduled" ? "Overdue" : i.status),
          `<button class="btn sm pri" data-open-capture="${i.id}">${i.status === "in_progress" ? "Resume" : "Start"}</button>`];
      }))
      : emptyBecause("Nothing assigned to you",
          "Nothing assigned to you. Scheduled work appears here automatically.");
  }
  else if (S.tab === 1) body = renderCapture();
  else if (S.tab === 2) {
    const done = S.inspections.filter(i => i.status === "completed");
    body = T(["Reference", "Template", "Stage", "Unit", "Inspector", "Completed", "Result"],
      done.slice(0, 60).map(i => {
        const r = byId(S.revisions, i.template_rev_id), t = tplForRev(i.template_rev_id);
        return [`<span class="id">${esc(i.ref)}</span>`,
          `<span class="id">${esc(t?.code || "—")} rev ${r?.rev ?? "?"}</span>`,
          esc(stageName(i.stage_id)), esc(i.unit_ref || "—"),
          esc(byId(S.people, i.signed_by)?.full_name || "—"),
          i.completed_at ? new Date(i.completed_at).toLocaleString("en-ZA") : "—",
          pill(i.result || "—")];
      }));
  }
  else {
    const cols = ["Reference", "Inspection", "Defect", "Recorded"]
      .concat(HP() ? ["Hold point"] : []).concat(["Disposition", ""]);
    body = T(cols, S.failedChecks.map(f => {
      const insp = byId(S.inspections, f.inspection_id);
      const base = [`<span class="id">${esc(f.ref)}</span>`,
        `<span class="id">${esc(insp?.ref || "—")}</span>`,
        esc(byId(S.defects, f.defect_code_id)?.code || "—"),
        new Date(f.created_at).toLocaleString("en-ZA")];
      const hp = HP() ? [f.is_hold ? pill("Hold point") : "—"] : [];
      return base.concat(hp, [pill(f.disposition || "awaiting"),
        f.disposition === "awaiting" && isRole("supervisor", "quality_engineer", "quality_manager")
          ? `<button class="btn sm" data-dispose="${f.id}">Disposition</button>` : ""]);
    }));
  }
  return head(m, "Your queue, the capture form, and where a failed check goes next.",
    `<button class="btn" data-act="refresh">Refresh</button>`) + tabbar(m) + body;
}

function renderCapture() {
  const insp = byId(S.inspections, S.capture.id);
  if (!insp) return `<div class="card"><div class="empty">Pick an inspection from your queue to start capturing.</div></div>`;
  const rev = byId(S.revisions, insp.template_rev_id);
  const tpl = tplForRev(insp.template_rev_id);
  const def = rev?.definition;
  if (!def?.sections) return `<div class="card"><div class="empty">This template has no fields defined.</div></div>`;

  const val = fid => S.capture.results[fid] || {};
  const fields = def.sections.flatMap(s => s.items).filter(f => !["info", "section"].includes(f.type));
  const answered = fields.filter(f => { const v = val(f.id); return v.outcome || v.value_text || v.value_num != null; }).length;
  const fails = fields.filter(f => val(f.id).outcome === "fail");

  const control = f => {
    const v = val(f.id);
    if (f.type === "passfail") return `<div class="seg" data-field="${f.id}">
      ${["pass","fail","na"].map(o => `<button data-outcome="${o}" class="${v.outcome === o ? (o === "pass" ? "p" : o === "fail" ? "f" : "n") : ""}">${o === "na" ? "N/A" : o[0].toUpperCase() + o.slice(1)}</button>`).join("")}</div>`;
    if (f.type === "measure") {
      const n = v.value_num, out = n == null ? "" : (Number(n) < Number(f.min) || Number(n) > Number(f.max)) ? "bad" : "ok";
      return `<div class="mrow"><input type="number" step="any" data-num="${f.id}" value="${n ?? ""}"
        style="padding:6px 9px;border:1px solid ${out === "bad" ? "var(--bad)" : "var(--line)"};border-radius:7px">
        <span class="tol">${esc(f.unit || "")} · target ${esc(f.tgt || "—")} · tolerance ${esc(f.min ?? "—")} to ${esc(f.max ?? "—")}</span></div>
        ${out === "bad" ? `<div class="note q" style="margin-top:7px;font-size:11.5px"><b>Out of tolerance.</b> This will raise a failed check on submit${f.hold && HP() ? " and hold the works order" : ""}.</div>` : ""}`;
    }
    if (f.type === "number") return `<input type="number" step="any" data-num="${f.id}" value="${v.value_num ?? ""}" style="max-width:160px;padding:6px 9px;border:1px solid var(--line);border-radius:7px">`;
    if (f.type === "text") return f.multi
      ? `<textarea rows="2" data-txt="${f.id}" style="width:100%;padding:6px 9px;border:1px solid var(--line);border-radius:7px">${esc(v.value_text || "")}</textarea>`
      : `<input data-txt="${f.id}" value="${esc(v.value_text || "")}" style="width:100%;padding:6px 9px;border:1px solid var(--line);border-radius:7px">`;
    if (f.type === "select") return `<select data-txt="${f.id}" style="max-width:280px;padding:6px 9px;border:1px solid var(--line);border-radius:7px">
      <option value=""></option>${(f.opts || []).map(o => `<option ${v.value_text === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    if (f.type === "date") return `<input type="date" data-txt="${f.id}" value="${esc(v.value_text || "")}" style="max-width:180px;padding:6px 9px;border:1px solid var(--line);border-radius:7px">`;
    if (f.type === "serial") return `<input data-txt="${f.id}" value="${esc(v.value_text || insp.unit_ref || "")}" placeholder="Scan or type" style="max-width:320px;padding:6px 9px;border:1px solid var(--line);border-radius:7px">`;
    if (f.type === "instr") {
      // Overdue instruments are shown but disabled. The database blocks them
      // too, so this is a courtesy rather than the control.
      const list = S.equipment.filter(e => !f.cat || f.cat === "Any" || e.category === f.cat);
      return `<select data-equip="${f.id}" style="max-width:420px;padding:6px 9px;border:1px solid var(--line);border-radius:7px">
        <option value="">— select —</option>
        ${list.map(e => `<option value="${e.id}" ${v.equipment_id == e.id ? "selected" : ""}
          ${["overdue","out_of_service"].includes(e.status) ? "disabled" : ""}>${esc(e.asset_no)} — ${esc(e.name)}${
          ["overdue","out_of_service"].includes(e.status) ? ` (${e.status.replace("_"," ").toUpperCase()} — blocked)` : ""}</option>`).join("")}
      </select>`;
    }
    if (f.type === "photo") return `<div><input type="file" accept="image/*" capture="environment" multiple data-photo="${f.id}">
      <div class="hint">Minimum ${f.minp || 1}. Photos are compressed before upload.</div></div>`;
    if (f.type === "sign") return `<div class="drop" style="border-color:var(--brand);color:var(--brand-dk)">Signing happens when you submit below</div>`;
    return `<div class="ro">${esc(f.type)}</div>`;
  };

  return `<div class="grid" style="grid-template-columns:1fr 300px">
    <div><div class="card" style="margin-bottom:13px"><h3>${esc(insp.ref)} · ${esc(tpl?.name || "")} <span class="cl">rev ${rev?.rev}</span></h3><div class="bd">
      <div class="three">
        <div class="fld"><label>Project</label><div class="ro">${esc(byId(S.projects, insp.project_id)?.code || "—")}</div></div>
        <div class="fld"><label>Works order</label><div class="ro">${esc(byId(S.worksOrders, insp.works_order_id)?.code || "—")}</div></div>
        <div class="fld"><label>Stage</label><div class="ro">${esc(stageName(insp.stage_id))}</div></div>
      </div>
      <div class="three" style="margin-bottom:0">
        <div class="fld" style="margin-bottom:0"><label>Inspector</label><div class="ro">${esc(S.profile.full_name)}</div></div>
        <div class="fld" style="margin-bottom:0"><label>Unit</label><div class="ro">${esc(insp.unit_ref || "—")}</div></div>
        <div class="fld" style="margin-bottom:0"><label>Started</label><div class="ro">${insp.started_at ? new Date(insp.started_at).toLocaleString("en-ZA") : "not yet"}</div></div>
      </div>
    </div></div>
    <div class="card"><h3>Inspection form</h3><div class="bd"><div class="pv" id="captureForm">
      ${def.sections.map(s => `<div class="pvsec"><div class="h">${esc(s.title)}</div>
        ${s.items.map(f => {
          if (f.type === "info") return `<div class="note" style="margin-bottom:8px">${esc(f.label)}</div>`;
          if (f.cond && val(f.cond.on).outcome !== "fail") return "";
          return `<div class="pvi"><div class="q">${esc(f.label)}${f.req ? '<span class="req">*</span>' : ""}
            ${f.hold && HP() ? '<span class="tag hold" style="margin-left:6px">Hold point</span>' : ""}</div>
            ${f.help ? `<div class="h2">${esc(f.help)}</div>` : ""}${control(f)}</div>`;
        }).join("")}</div>`).join("")}
    </div></div></div></div>
    <div>
      <div class="card" style="margin-bottom:13px"><h3>Progress</h3><div class="bd">
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px"><span>${answered} of ${fields.length} answered</span><b>${Math.round(answered / fields.length * 100)}%</b></div>
        <div style="height:7px;background:#eef1f6;border-radius:4px;overflow:hidden;margin-bottom:13px"><i style="display:block;height:100%;width:${answered / fields.length * 100}%;background:var(--brand)"></i></div>
        ${fails.length ? `<div class="note q" style="margin-bottom:11px"><b>${fails.length} failure${fails.length > 1 ? "s" : ""} recorded.</b> A failed check will be raised for each on submit.</div>` : ""}
        <button class="btn pri" style="width:100%;justify-content:center" data-act="submit-inspection">Sign and submit</button>
        <div class="hint" style="margin-top:8px">Signing locks the record. Corrections create a linked amendment.</div>
      </div></div>
      <div class="card"><h3>Saving</h3><div class="bd">
        <div style="font-size:12.3px" id="saveState">Answers save as you go.</div>
      </div></div>
    </div>
  </div>`;
}

/* ---- 3 Scheduling ---- */
function vSched(m) {
  let body;
  if (S.tab === 0) {
    body = `<div class="filters">
        <select id="fStage"><option value="">All stages</option>${S.stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>
        <select id="fStatus"><option value="">All statuses</option>${["scheduled","in_progress","completed"].map(x => `<option>${x}</option>`).join("")}</select>
        <span class="spacer"></span>
        ${canPlan() ? `<button class="btn" data-tab="2">Projects &amp; works orders →</button>` : ""}
      </div>` +
      (S.inspections.length
        ? T(["Reference", "Inspection", "Stage", "Project / works order", "Unit", "Planned", "Inspector", "Status"],
        S.inspections.slice(0, 80).map(i => {
          const t = tplForRev(i.template_rev_id);
          return [`<span class="id">${esc(i.ref)}</span>`, esc(t?.name || "—"), esc(stageName(i.stage_id)),
            `${esc(byId(S.projects, i.project_id)?.code || "—")}<div class="sub">${esc(byId(S.worksOrders, i.works_order_id)?.code || "")}</div>`,
            esc(i.unit_ref || "—"), fmtDate(i.planned_date),
            i.assigned_to ? esc(byId(S.people, i.assigned_to)?.full_name || "—") : pill("Unassigned"),
            pill(i.planned_date < today() && i.status === "scheduled" ? "Overdue" : i.status)];
        }))
        : emptyBecause("Nothing is scheduled yet",
            "Nothing scheduled. Generate from a works order when there is work to inspect."));
  } else if (S.tab === 1) {
    const u = unassigned();
    body = u.length ? T(["Reference", "Inspection", "Stage", "Unit", "Planned", "Assign to"],
      u.map(i => {
        const t = tplForRev(i.template_rev_id);
        return [`<span class="id">${esc(i.ref)}</span>`, esc(t?.name || "—"), esc(stageName(i.stage_id)),
          esc(i.unit_ref || "—"), fmtDate(i.planned_date),
          `<select data-assign="${i.id}"><option value="">— choose —</option>${
            S.people.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}</select>`];
      }))
      : emptyBecause("Nothing unassigned",
          "Nothing unassigned. This list is the leading indicator of an overdue, so an empty one is the goal.");
  } else {
    body = worksView();
  }

  return head(m, "Inspections are generated from the requirements matrix, then assigned.",
    `<button class="btn" data-act="refresh">Refresh</button>`) + tabbar(m) + body;
}

/* ---- 4 Form designer ---- */
const TYPES = {
  section:{n:"Section",c:"#5a6672",ic:"§",d:"Groups checkpoints under a heading"},
  info:{n:"Instruction",c:"#7b8794",ic:"i",d:"Read-only guidance for the inspector"},
  passfail:{n:"Pass / Fail",c:"#1e8e5a",ic:"P/F",d:"Three-state: pass, fail, not applicable"},
  measure:{n:"Measurement",c:"#0063AF",ic:"mm",d:"Numeric value judged against a tolerance"},
  number:{n:"Number",c:"#2a7fd4",ic:"#",d:"Numeric value with no tolerance"},
  text:{n:"Text",c:"#5b4bbd",ic:"Ab",d:"Short or long free text"},
  select:{n:"Dropdown",c:"#7b4bb8",ic:"▾",d:"Choose from a controlled list"},
  date:{n:"Date",c:"#0f8f8f",ic:"31",d:"Date"},
  photo:{n:"Photo",c:"#e8821e",ic:"◙",d:"Camera or upload, with a minimum count"},
  instr:{n:"Instrument used",c:"#c17d00",ic:"⚙",d:"Pick from the calibrated equipment register"},
  serial:{n:"Serial / panel",c:"#0063AF",ic:"SN",d:"Ties the result to a specific unit"},
  sign:{n:"Signature",c:"#d93025",ic:"✍",d:"Electronic signature — locks the record"}
};
function vDsn(m) {
  /* Library first, designer second. Landing straight in whichever template
     happened to be first made it look as though there was only one, and gave
     no view of what exists, what is published and what is still a draft —
     which is the question a Quality Manager actually opens this screen to ask. */
  return S.designer.open ? designerView(m) : libraryView(m);
}

function libraryView(m) {
  const rows = S.templates.map(t => {
    const revs = S.revisions.filter(r => r.template_id === t.id);
    const pub = revs.find(r => r.status === "published");
    const draft = revs.find(r => ["draft", "in_review"].includes(r.status));
    const fields = (rev) => rev ? (rev.definition?.sections || [])
      .reduce((a, sec) => a + (sec.items || []).length, 0) : 0;
    const inUse = S.requirements.filter(r => r.template_id === t.id).length;
    return { t, pub, draft, revs, fields: fields(pub || draft), inUse };
  });

  const card = r => `<div class="card" style="margin-bottom:11px"><div class="bd">
    <div style="display:flex;gap:13px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">
        <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
          <span class="id" style="font-size:12.6px">${esc(r.t.code)}</span>
          <b style="font-size:13.5px">${esc(r.t.name)}</b>
          ${r.pub ? pill(`Published rev ${r.pub.rev}`) : pill("Never published")}
          ${r.draft ? pill(`Draft rev ${r.draft.rev}`) : ""}
        </div>
        <div class="sub" style="margin-top:4px">
          ${esc(stageName(r.t.stage_id))} ·
          ${esc(byId(S.families, r.t.family_id)?.name || "all families")} ·
          ${r.fields} field${r.fields === 1 ? "" : "s"} ·
          competency level ${r.t.min_competency} ·
          ${r.revs.length} revision${r.revs.length === 1 ? "" : "s"}
        </div>
        <div class="sub" style="margin-top:3px">
          ${r.inUse
            ? `Used by ${r.inUse} requirement${r.inUse === 1 ? "" : "s"} in the matrix`
            : `<span style="color:var(--warn)">Not referenced by the requirements matrix — nothing will be scheduled from it</span>`}
        </div>
      </div>
      <div style="display:flex;gap:7px;align-items:center">
        <button class="btn sm" data-act="open-preview" data-tpl="${r.t.id}">Preview</button>
        <button class="btn sm pri" data-act="open-designer" data-tpl="${r.t.id}">Design</button>
      </div>
    </div>
    ${!r.pub && r.draft ? `<div class="note q" style="margin-top:11px">This template is a draft.
      It can be attached to the requirements matrix, but the scheduler skips it until a
      revision is published.</div>` : ""}
  </div></div>`;

  const drafts = rows.filter(r => r.draft).length;
  const unused = rows.filter(r => !r.inUse).length;

  return head(m, "The inspection forms this division uses. Open one to change it, or create a new one.",
    `<button class="btn pri" data-act="new-template">New template</button>`)
    + `<div class="four" style="margin-bottom:14px">
        <div class="card kpi"><div class="k">Templates</div><div class="v">${S.templates.length}</div><div class="d">across ${new Set(S.templates.map(t => t.stage_id)).size} stages</div></div>
        <div class="card kpi ${rows.filter(r => r.pub).length === S.templates.length ? "good" : "warn"}"><div class="k">Published</div><div class="v">${rows.filter(r => r.pub).length}</div><div class="d">usable by the scheduler</div></div>
        <div class="card kpi ${drafts ? "warn" : "good"}"><div class="k">Open drafts</div><div class="v">${drafts}</div><div class="d">awaiting a second approver</div></div>
        <div class="card kpi ${unused ? "warn" : "good"}"><div class="k">Not in the matrix</div><div class="v">${unused}</div><div class="d">nothing scheduled from them</div></div>
      </div>`
    + (S.templates.length
        ? rows.sort((a, b) => a.t.code.localeCompare(b.t.code)).map(card).join("")
        : `<div class="card"><div class="empty">No templates yet. Create one to get started.</div></div>`);
}

function designerView(m) {
  const tpl = byId(S.templates, S.designer.tplId);
  if (!tpl) { S.designer.open = false; return libraryView(m); }
  const revs = S.revisions.filter(r => r.template_id === tpl.id);
  const draft = revs.find(r => ["draft", "in_review"].includes(r.status));
  const pub = revs.find(r => r.status === "published");
  const rev = draft || pub || revs[0];
  if (!S.designer.def || S.designer.revId !== rev?.id) {
    S.designer.revId = rev?.id;
    S.designer.def = structuredClone(rev?.definition || { sections: [] });
    S.designer.dirty = false;
  }
  const def = S.designer.def;
  const nFields = def.sections.reduce((a, sec) => a + sec.items.length, 0);

  const pal = (g, list) => `<div class="gh">${g}</div>${list.map(k =>
    `<button class="pi" data-add="${k}"><span class="ic" style="background:${TYPES[k].c}">${TYPES[k].ic}</span>${TYPES[k].n}</button>`).join("")}`;

  const canvas = def.sections.map((sec, si) => `<div class="sec">
    <div class="sh"><input value="${esc(sec.title)}" data-sec-title="${si}"
      style="font-weight:700;font-size:12.5px;text-transform:uppercase;letter-spacing:.02em;border:0;background:none;outline:0;color:var(--ink-2);width:60%">
      <span class="sc">${sec.items.length} field${sec.items.length === 1 ? "" : "s"}</span>
      <button class="btn sm danger" data-del-sec="${si}" style="margin-left:auto">Remove section</button></div>
    ${sec.items.map(it => `<div class="it ${S.designer.sel === it.id ? "sel" : ""}" data-sel="${it.id}">
      <span class="tb" style="background:${TYPES[it.type]?.c || "#8593a9"}">${TYPES[it.type]?.ic || "?"}</span>
      <div><div class="lb">${esc(it.label)}
        ${it.req ? '<span class="tag req">Required</span>' : ""}
        ${it.hold && HP() ? '<span class="tag hold">Hold point</span>' : ""}
        ${it.ncr ? '<span class="tag ncr">Raises defect</span>' : ""}
        ${it.cond ? '<span class="tag cond">Conditional</span>' : ""}</div>
        <div class="mt">${it.type === "measure" ? `<b>${esc(it.min ?? "—")} to ${esc(it.max ?? "—")} ${esc(it.unit || "")}</b>` : ""}
          ${it.type === "select" ? `${(it.opts || []).length} options` : ""}
          ${it.help ? esc(it.help.slice(0, 54)) : ""}</div></div>
      <div class="ac"><button data-move="${it.id}:-1">↑</button><button data-move="${it.id}:1">↓</button><button data-del="${it.id}">×</button></div>
    </div>`).join("") || `<div class="empt">No fields yet — choose a type on the left.</div>`}
  </div>`).join("");

  /* Publishing. The button is always shown, and says why it cannot be used,
     because a control that silently hides itself is indistinguishable from a
     missing feature — which is how this was first reported. */
  const canPublishRole = isRole("quality_manager", "sysadmin");
  const isAuthor = draft && draft.created_by === S.profile.id;
  const publishBlock = !draft
    ? { label: "Publish", why: "There is no draft to publish. Change something and save a draft first." }
    : !canPublishRole
      ? { label: `Publish rev ${draft.rev}`, why: "Only a Quality Manager or System Administrator may publish." }
      : (NEEDS_2ND() && isAuthor)
        ? { label: `Publish rev ${draft.rev}`, why: "This division requires a second approver, so the person who built a template cannot publish it. Turn it off in Administration → Options if that is not how you work." }
        : null;

  const act = `
    <button class="btn" data-act="back-to-library">← Library</button>
    <button class="btn" data-act="toggle-preview">${S.designer.preview ? "Back to designer" : "Preview as inspector"}</button>
    <button class="btn" data-act="save-draft"${S.designer.dirty ? "" : " disabled"}>Save draft</button>
    ${publishBlock
      ? `<button class="btn" disabled title="${esc(publishBlock.why)}">${publishBlock.label}</button>`
      : `<button class="btn pri" data-act="publish">Publish rev ${draft.rev}</button>`}`;

  return head(m, `${esc(tpl.code)} — ${esc(tpl.name)}`, act)
    + `<div class="filters">
        <span class="cnt">rev ${rev?.rev ?? "—"} · ${pill(rev?.status || "none")} ·
          ${nFields} fields · ${esc(stageName(tpl.stage_id))} ·
          ${esc(byId(S.families, tpl.family_id)?.name || "all families")}
          ${S.designer.dirty ? ' · <b style="color:var(--warn)">unsaved changes</b>' : ""}</span>
      </div>`
    + (publishBlock && draft ? `<div class="note q" style="margin-bottom:13px"><b>Cannot publish yet.</b> ${publishBlock.why}</div>` : "")
    + (S.designer.preview
      ? `<div class="card"><h3>Preview <span class="cl">${esc(tpl.code)} rev ${rev?.rev}</span></h3><div class="bd">${previewHtml(def)}</div></div>`
      : `<div class="dsn">
          <div class="pal">${pal("Structure", ["section","info"])}${pal("Results", ["passfail","measure","number"])}${pal("Capture", ["text","select","date","photo"])}${pal("Traceability", ["serial","instr","sign"])}</div>
          <div class="cv">
            <div class="cvhead"><div><div class="tn">${esc(tpl.name)}</div>
              <div class="sub">${esc(tpl.code)} · ${esc(stageName(tpl.stage_id))} · ${esc(byId(S.families, tpl.family_id)?.name || "all families")}</div></div>
              <div style="margin-left:auto"><button class="btn sm" data-add="section">Add section</button></div></div>
            ${canvas}
            <div class="note" style="margin-top:14px">Publishing creates a new revision. Inspections already captured keep the revision they were captured against, so history never changes underneath you.</div>
          </div>
          <div class="props"><div class="ph">Field settings</div><div class="pb">${propsHtml()}</div></div>
        </div>`);
}

function findItem(id) {
  for (const s of S.designer.def.sections) { const it = s.items.find(x => x.id === id); if (it) return { s, it }; }
  return null;
}
function propsHtml() {
  const f = S.designer.sel && findItem(S.designer.sel);
  if (!f) return `<div class="empt">Select a field to edit it.</div>`;
  const it = f.it, ty = TYPES[it.type] || { n: it.type, c: "#8593a9", ic: "?", d: "" };
  let extra = "";
  if (it.type === "measure") extra = `
    <div class="two" style="gap:8px"><div class="fld"><label>Unit</label><input data-p="unit" value="${esc(it.unit || "")}"></div>
    <div class="fld"><label>Target</label><input data-p="tgt" value="${esc(it.tgt || "")}"></div></div>
    <div class="two" style="gap:8px"><div class="fld"><label>Minimum</label><input data-p="min" value="${esc(it.min ?? "")}"></div>
    <div class="fld"><label>Maximum</label><input data-p="max" value="${esc(it.max ?? "")}"></div></div>
    <div class="note" style="margin-bottom:12px;font-size:11.5px">A value outside the tolerance is a fail. The inspector cannot override it.</div>`;
  if (it.type === "select") extra = `<div class="fld"><label>Options — one per line</label><textarea rows="4" data-p="opts">${esc((it.opts || []).join("\n"))}</textarea></div>`;
  if (it.type === "photo") extra = `<div class="fld"><label>Minimum photos</label><input type="number" data-p="minp" value="${it.minp || 1}"></div>`;
  if (it.type === "instr") extra = `<div class="fld"><label>Equipment category</label><select data-p="cat">
    ${["Any", ...new Set(S.equipment.map(e => e.category))].map(c => `<option ${it.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
    <div class="hint">Instruments out of calibration are blocked at capture, by the database.</div></div>`;

  return `<div class="fld"><label>Field type</label><div class="ro" style="display:flex;align-items:center;gap:7px">
      <span style="background:${ty.c};width:20px;height:20px;border-radius:5px;display:grid;place-items:center;font-size:9px;font-weight:700;color:#fff">${ty.ic}</span>${ty.n}</div>
      <div class="hint">${ty.d}</div></div>
    <div class="fld"><label>Label the inspector sees</label><input data-p="label" value="${esc(it.label)}"></div>
    <div class="fld"><label>Help text</label><input data-p="help" value="${esc(it.help || "")}"></div>
    ${extra}
    <div style="font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:14px 0 4px;font-weight:600">Behaviour</div>
    <div class="sw"><div><div class="t">Required</div><div class="d">Cannot submit without it</div></div><button class="tg ${it.req ? "on" : ""}" data-tg="req"></button></div>
    ${HP() ? `<div class="sw"><div><div class="t">Hold point</div><div class="d">A fail stops the works order</div></div><button class="tg ${it.hold ? "on" : ""}" data-tg="hold"></button></div>` : ""}
    <div class="sw"><div><div class="t">Raise defect on fail</div><div class="d">Creates a failed-check record</div></div><button class="tg ${it.ncr ? "on" : ""}" data-tg="ncr"></button></div>
    ${it.ncr ? `<div class="fld" style="margin-top:12px"><label>Default defect code</label><select data-p="dfc">
      <option value=""></option>${S.defects.map(d => `<option value="${d.code}" ${it.dfc === d.code ? "selected" : ""}>${esc(d.code)} — ${esc(d.description)}</option>`).join("")}</select></div>` : ""}`;
}
function previewHtml(def) {
  return `<div class="pv">${def.sections.map(s => `<div class="pvsec"><div class="h">${esc(s.title)}</div>
    ${s.items.map(it => it.type === "info"
      ? `<div class="note" style="margin-bottom:8px">${esc(it.label)}</div>`
      : `<div class="pvi"><div class="q">${esc(it.label)}${it.req ? '<span class="req">*</span>' : ""}</div>
         ${it.help ? `<div class="h2">${esc(it.help)}</div>` : ""}
         <div class="ro" style="max-width:320px">${esc(TYPES[it.type]?.n || it.type)}</div></div>`).join("")}
  </div>`).join("")}</div>`;
}

/* ---- 5 Requirements matrix ---- */
function vReq(m) {
  const cell = (fid, sid) => S.requirements.find(r => r.family_id === fid && r.stage_id === sid);
  const levelName = l => ({ hold: "hold point", required: "required", optional: "optional", na: "not applicable" }[l] || l);
  const cls = l => ({ hold: "hold", required: "req", optional: "opt", na: "na" }[l] || "na");

  const table = `<div class="mx"><table><thead><tr><th>Product family</th>
    ${S.stages.map(s => `<th style="text-align:center;white-space:normal;max-width:92px">${esc(s.name)}</th>`).join("")}</tr></thead><tbody>
    ${S.families.map(f => `<tr style="cursor:default"><td><b>${esc(f.name)}</b></td>
      ${S.stages.map(s => {
        const c = cell(f.id, s.id);
        const tpl = c ? byId(S.templates, c.template_id) : null;
        if (!c || c.level === "na" || !tpl)
          return `<td><div class="mc na" style="cursor:pointer" data-cell="${f.id}:${s.id}">+</div></td>`;
        return `<td><div class="mc ${cls(c.level)}" style="cursor:pointer" data-cell="${f.id}:${s.id}">${esc(tpl.code)}
          <div style="font-weight:500;opacity:.8;font-size:9.5px">${levelName(c.level)}</div></div></td>`;
      }).join("")}</tr>`).join("")}
  </tbody></table></div>`;

  const noPub = publishedRevs().length === 0;
  return head(m, "Which inspection is required, at which stage, for which product. Click any cell to configure it.",
    `<button class="btn" data-act="refresh">Refresh</button>`) + tabbar(m)
    + (noPub ? `<div class="note q" style="margin-bottom:13px"><b>No template is published.</b>
        A requirement can be set against a draft, but the scheduler skips it — nothing will be
        generated until a revision is published.
        <button class="btn sm" data-goto="dsn" style="margin-left:8px">Form designer →</button></div>` : "")
    + `<div class="card"><div class="bd">${table}
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:14px;font-size:11.5px;align-items:center">
          ${HP() ? `<span><span class="mc hold" style="padding:2px 8px">Hold point</span> blocks the works order</span>` : ""}
          <span><span class="mc req" style="padding:2px 8px">Required</span> must be completed</span>
          <span><span class="mc opt" style="padding:2px 8px">Optional</span> only if requested</span>
          <span><span class="mc na">+</span> click to add</span>
        </div></div></div>
      <div class="note${HP() ? " q" : " q"}" style="margin-top:13px">${HP()
        ? "<b>Hold points are on.</b> Keep the number small — too many and the shop floor finds ways around them."
        : "<b>Hold points are off.</b> Requirements record the inspection but never block production. Switch them on in Administration → Options."}</div>`;
}

/* ---- 6 Administration ---- */
function vAdm(m) {
  let body;
  if (S.tab === 0) {
    body = T(["User", "Email", "Role", "Department", "Status", ""],
      S.people.map(p => [`<b>${esc(p.full_name)}</b>`, esc(p.email),
        `<select data-role="${p.id}">${["inspector","supervisor","quality_engineer","quality_manager","planner","sysadmin","readonly"]
          .map(r => `<option ${p.role === r ? "selected" : ""}>${r}</option>`).join("")}</select>`,
        `<select data-dept="${p.id}"><option value="">—</option>${S.departments.map(d => `<option value="${d.id}" ${p.department_id === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>`,
        pill(p.active ? "Active" : "Awaiting activation"),
        `<button class="btn sm ${p.active ? "" : "pri"}" data-toggle-active="${p.id}">${p.active ? "Deactivate" : "Activate"}</button>`]));
  }
  else if (S.tab === 1) {
    body = REF_LISTS.map(refGrid).join("") + `
      <div class="note" style="margin-top:13px">Changes are held until you press Save, so a
        list can be reworked in one pass. <b>Retiring</b> hides an entry from new forms and
        keeps every historic record intact — that is almost always what you want.
        <b>Deleting</b> is refused by the database while anything still references the entry.</div>
      <div class="note q" style="margin-top:11px">Defect <b>codes</b> are permanent once records
        exist against them: every trend, Pareto and count is grouped by the code, not the wording.
        Reword the description freely; do not repurpose a code for a different defect.</div>`;
  }
  else if (S.tab === 2) {
    body = `<div class="card" style="max-width:640px"><h3>Optional features</h3><div class="bd">
      <div class="sw"><div><div class="t">Hold points</div><div class="d">Let a failed checkpoint stop the works order until a named role releases it. Off by default.</div></div>
        <button class="tg ${HP() ? "on" : ""}" data-act="toggle-hp"></button></div>
      <div class="note" style="margin-top:12px">${HP()
        ? "Hold points are <b>on</b>. The matrix, the designer and the workbench all show hold-point controls."
        : "Hold points are <b>off</b>. Inspections still record failures — they simply never block production."}</div>
      <div class="note q" style="margin-top:11px">One switch, one behaviour. A half-used hold-point setting is worse than none: inspectors learn that some failures stop the line and some do not, and the ones that do not get ignored.</div>

      <div class="sw" style="margin-top:20px;border-top:1px solid var(--line);padding-top:16px">
        <div><div class="t">Require a second approver on templates</div>
          <div class="d">The person who builds a template revision cannot publish it. Off by default.</div></div>
        <button class="tg ${NEEDS_2ND() ? "on" : ""}" data-act="toggle-2nd"></button></div>
      <div class="note" style="margin-top:12px">${NEEDS_2ND()
        ? "On. A draft has to be published by someone other than its author, which means this division needs at least two people holding Quality Manager."
        : "Off. Whoever designs a form can publish it. Every publish is still recorded in the audit trail with who approved it and when, so the evidence exists either way."}</div>
      <div class="note q" style="margin-top:11px">Separating author from approver is the usual reading of ISO 9001 clause 7.5 for a controlled document. It is off because one Quality Manager builds the forms here and the rule would block every publish. Worth switching on once a second Quality Manager exists — and worth expecting a certification body to ask about it.</div>
    </div></div>`;
  }
  else { body = `<div class="card"><h3>Audit trail</h3><div class="bd" id="auditHost"><div class="empty">Loading…</div></div></div>`; loadAudit(); }

  return head(m, "Users, roles, reference lists and division options.",
    `<button class="btn" data-act="refresh">Refresh</button>`) + tabbar(m) + body;
}
/* ---------------------------------------------------------------
   Editable reference lists.

   One generic grid rather than four bespoke ones: the tables differ only
   in their columns, so a shared renderer keeps the save path, the retire
   semantics and the error handling identical everywhere.

   Edits are held in S.refDraft and written on Save (the draft-then-save
   pattern used for the other admin grids), because renaming nine stages
   one round-trip at a time is slow and half-applies if the connection
   drops mid-way.
   --------------------------------------------------------------- */
const REF_LISTS = [
  { table: "manufacturing_stages", title: "Manufacturing stages", state: "stages",
    order: "sort_order",
    note: "The sequence work moves through. Drives which checklist loads and the pass-rate-by-stage chart.",
    cols: [{ f: "name", label: "Stage", type: "text" },
           { f: "sort_order", label: "Order", type: "number", w: "90px" }] },

  { table: "departments", title: "Departments", state: "departments",
    order: "sort_order",
    note: "Who owns the work. An inspector sees their own department's inspections and no others.",
    cols: [{ f: "name", label: "Department", type: "text" },
           { f: "stage_id", label: "Stage", type: "select", w: "190px",
             options: () => S.stages.map(x => [x.id, x.name]) },
           { f: "sort_order", label: "Order", type: "number", w: "90px" }] },

  { table: "product_families", title: "Product families", state: "families",
    order: "name",
    note: "The rows of the requirements matrix. Adding one here adds a row there.",
    cols: [{ f: "name", label: "Family", type: "text" }] },

  { table: "defect_codes", title: "Defect codes", state: "defects",
    order: "code",
    note: "What a failure is called. Analytics group by the code, so codes are permanent and descriptions are not.",
    cols: [{ f: "code", label: "Code", type: "text", w: "110px", lockIfUsed: true },
           { f: "description", label: "Description", type: "text" },
           { f: "default_department_id", label: "Default department", type: "select", w: "190px",
             options: () => S.departments.map(x => [x.id, x.name]) }] }
];

const ALL_LISTS = () => REF_LISTS;

const draftKey = (table, id, field) => `${table}|${id}|${field}`;
const draftCount = () => Object.keys(S.refDraft).length;

function refValue(table, row, field) {
  const k = draftKey(table, row.id, field);
  return k in S.refDraft ? S.refDraft[k] : row[field];
}

function refCell(list, row, col) {
  const v = refValue(list.table, row, col.f);
  const key = draftKey(list.table, row.id, col.f);
  const dirty = key in S.refDraft;
  const style = `width:100%;padding:6px 8px;border:1px solid ${dirty ? "var(--brand)" : "var(--line)"};border-radius:7px;background:${row.active === false ? "#f4f6f9" : "#fff"}`;
  if (col.type === "select") {
    return `<select data-ref="${key}" style="${style}">
      <option value="">—</option>
      ${col.options().map(([id, label]) =>
        `<option value="${id}" ${String(v) === String(id) ? "selected" : ""}>${esc(label)}</option>`).join("")}
    </select>`;
  }
  return `<input data-ref="${key}" type="${col.type === "number" ? "number" : "text"}"
    value="${esc(v ?? "")}" style="${style}">`;
}

function refGrid(list) {
  const rows = [...(S[list.state] || [])].sort((a, b) => {
    const av = a[list.order], bv = b[list.order];
    return typeof av === "number" ? av - bv : String(av).localeCompare(String(bv));
  });
  const dirty = Object.keys(S.refDraft).filter(k => k.startsWith(list.table + "|")).length;
  const cols = list.cols;
  const grid = `${cols.map(c => c.w || "1fr").join(" ")} 150px`;

  return `<div class="card" style="margin-bottom:13px"><h3>${esc(list.title)}
      <span class="cl">${rows.length} entries${dirty ? ` · ${dirty} unsaved` : ""}</span></h3>
    <div class="bd">
      <div class="note" style="margin-bottom:12px">${list.note}</div>
      <div style="display:grid;grid-template-columns:${grid};gap:8px;align-items:center;
                  font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);
                  font-weight:700;padding:0 2px 6px">
        ${cols.map(c => `<div>${c.label}</div>`).join("")}<div style="text-align:right">Status</div>
      </div>
      ${rows.map(r => `<div style="display:grid;grid-template-columns:${grid};gap:8px;
            align-items:center;padding:4px 2px;${r.active === false ? "opacity:.6" : ""}">
        ${cols.map(c => `<div>${refCell(list, r, c)}</div>`).join("")}
        <div style="text-align:right;display:flex;gap:5px;justify-content:flex-end">
          <button class="btn sm" data-ref-toggle="${list.table}|${r.id}"
            title="${r.active === false ? "Bring back into use" : "Hide from new forms, keep history"}"
          >${r.active === false ? "Restore" : "Retire"}</button>
          <button class="btn sm danger" data-ref-del="${list.table}|${r.id}"
            title="Only possible if nothing references it">×</button>
        </div></div>`).join("")}
      ${rows.length ? "" : `<div class="empty">Nothing here yet.</div>`}

      <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
        <div style="display:grid;grid-template-columns:${grid};gap:8px;align-items:center">
          ${cols.map(c => c.type === "select"
            ? `<select data-new="${list.table}|${c.f}" style="width:100%;padding:6px 8px;border:1px dashed #c8d6e3;border-radius:7px">
                 <option value="">—</option>
                 ${c.options().map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join("")}
               </select>`
            : `<input data-new="${list.table}|${c.f}" placeholder="new ${esc(c.label.toLowerCase())}"
                 type="${c.type === "number" ? "number" : "text"}"
                 style="width:100%;padding:6px 8px;border:1px dashed #c8d6e3;border-radius:7px">`).join("")}
          <div style="text-align:right">
            <button class="btn sm pri" data-ref-add="${list.table}">Add</button></div>
        </div>
      </div>

      <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
        <span class="cnt">${dirty ? `${dirty} unsaved change${dirty === 1 ? "" : "s"}` : "No unsaved changes"}</span>
        <span style="flex:1"></span>
        <button class="btn" data-ref-cancel="${list.table}" ${dirty ? "" : "disabled"}>Discard</button>
        <button class="btn pri" data-ref-save="${list.table}" ${dirty ? "" : "disabled"}>Save changes</button>
      </div>
    </div></div>`;
}

async function saveRefList(table) {
  const keys = Object.keys(S.refDraft).filter(k => k.startsWith(table + "|"));
  if (!keys.length) return;
  // Group by row: one UPDATE per record rather than one per field.
  const byRow = {};
  for (const k of keys) {
    const [, id, field] = k.split("|");
    (byRow[id] ||= {})[field] = S.refDraft[k];
  }
  busy(true);
  try {
    for (const [id, patch] of Object.entries(byRow)) {
      // Empty select means "no link", not the string "".
      for (const f of Object.keys(patch)) {
        if (patch[f] === "") patch[f] = null;
        else if (/(_id|sort_order)$/.test(f)) patch[f] = Number(patch[f]);
      }
      const { error } = await supabase.from(table).update(patch).eq("id", id);
      if (error) throw error;
    }
    for (const k of keys) delete S.refDraft[k];
    toast(`${Object.keys(byRow).length} entr${Object.keys(byRow).length === 1 ? "y" : "ies"} saved.`, "ok");
    await reload();
  } catch (e) {
    /* Leave the draft intact so nothing typed is lost, and reload so the
       grid shows what the database actually holds rather than a mix. */
    toast(explain(e), "bad");
    await reload();
  } finally { busy(false); }
}

async function addRefRow(table) {
  const list = ALL_LISTS().find(l => l.table === table);
  const row = {};
  for (const c of list.cols) {
    const el = document.querySelector(`[data-new="${table}|${c.f}"]`);
    let v = el ? el.value.trim() : "";
    if (v === "") { if (c.f === "sort_order") v = 0; else continue; }
    row[c.f] = /(_id|sort_order)$/.test(c.f) ? Number(v) : v;
  }
  const first = list.cols[0].f;
  if (!row[first]) { toast(`${list.cols[0].label} is required.`, "bad"); return; }
  busy(true);
  try {
    const { error } = await supabase.from(table).insert(row);
    if (error) throw error;
    toast("Added.", "ok");
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function toggleRefActive(table, id) {
  const list = ALL_LISTS().find(l => l.table === table);
  const row = (S[list.state] || []).find(r => String(r.id) === String(id));
  busy(true);
  try {
    const { error } = await supabase.from(table).update({ active: row.active === false }).eq("id", id);
    if (error) throw error;
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function deleteRefRow(table, id) {
  const list = ALL_LISTS().find(l => l.table === table);
  const row = (S[list.state] || []).find(r => String(r.id) === String(id));
  const label = row[list.cols[0].f];
  if (!confirm(`Delete "${label}" permanently?\n\nRetiring is usually better — it keeps historic records readable. Delete only works if nothing references this entry.`)) return;
  busy(true);
  try {
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) throw error;
    toast(`"${label}" deleted.`, "ok");
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function loadAudit() {
  const host = $("auditHost"); if (!host) return;
  let data, error;
  try {
    ({ data, error } = await supabase.from("audit_trail")
      .select("at,actor_name,action,entity,entity_id")
      .order("at", { ascending: false }).limit(60));
  } catch (e) { error = e; }
  if (!$("auditHost")) return;
  if (error) { host.innerHTML = `<div class="empty">${esc(explain(error))}</div>`; return; }
  host.innerHTML = T(["When", "Who", "Action", "Record", "Reference"],
    (data || []).map(r => [`<span class="id">${new Date(r.at).toLocaleString("en-ZA")}</span>`,
      esc(r.actor_name || "system"), pill(r.action), esc(r.entity), `<span class="id">${esc((r.entity_id || "").slice(0, 8))}</span>`]))
    .replace('<div class="card">', "<div>");
}

/* ------------------------------------------------------------
   5. Actions (writes)
   ------------------------------------------------------------ */
async function openCapture(id) {
  S.capture = { id, results: {} };
  const insp = byId(S.inspections, id);
  busy(true);
  try {
    if (insp.status === "scheduled") {
      await supabase.from("inspections")
        .update({ status: "in_progress", started_at: new Date().toISOString(), assigned_to: insp.assigned_to || S.profile.id })
        .eq("id", id);
      insp.status = "in_progress";
    }
    const { data, error } = await supabase.from("inspection_results").select("*").eq("inspection_id", id);
    if (error) throw error;
    for (const r of data) S.capture.results[r.field_id] = r;
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
  S.view = "work"; S.tab = 1; buildNav(); render();
}

/* Answers are written through as they are given, so a dropped connection
   loses one field rather than an entire inspection. */
const saveTimers = {};
function saveAnswer(fieldId, patch) {
  const insp = byId(S.inspections, S.capture.id);
  const rev = byId(S.revisions, insp.template_rev_id);
  const field = rev.definition.sections.flatMap(s => s.items).find(f => f.id === fieldId);
  const row = { inspection_id: S.capture.id, field_id: fieldId, label: field?.label || fieldId, ...patch };

  // Derive pass/fail for a measurement from its tolerance. The inspector
  // records a number; the template decides whether that number is a failure.
  if (field?.type === "measure" && patch.value_num != null && patch.value_num !== "") {
    const n = Number(patch.value_num);
    row.outcome = (n < Number(field.min) || n > Number(field.max)) ? "fail" : "pass";
  }
  S.capture.results[fieldId] = { ...(S.capture.results[fieldId] || {}), ...row };

  clearTimeout(saveTimers[fieldId]);
  saveTimers[fieldId] = setTimeout(async () => {
    const el = $("saveState");
    try {
      const { error } = await supabase.from("inspection_results")
        .upsert(row, { onConflict: "inspection_id,field_id" });
      if (error) throw error;
      if (el) el.textContent = "Saved " + new Date().toLocaleTimeString("en-ZA");
    } catch (e) {
      if (el) el.innerHTML = `<span style="color:var(--bad)">${esc(explain(e))}</span>`;
      toast(explain(e), "bad");
    }
  }, 500);
}

async function submitInspection() {
  const insp = byId(S.inspections, S.capture.id);
  if (!confirm(`Sign and submit ${insp.ref}? This locks the record.`)) return;
  busy(true);
  try {
    const { data, error } = await supabase.rpc("submit_inspection",
      { p_inspection: S.capture.id, p_signature: S.profile.email });
    if (error) throw error;
    toast(`${data.ref} submitted — ${data.result}${data.failed_checks ? `, ${data.failed_checks} failed check(s)` : ""}${data.works_order_held ? ", works order held" : ""}`,
      data.result === "pass" ? "ok" : "");
    S.capture = { id: null, results: {} };
    S.tab = 0;
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function saveDraft() {
  const d = S.designer;
  busy(true);
  try {
    const rev = byId(S.revisions, d.revId);
    if (rev && ["draft", "in_review"].includes(rev.status)) {
      const { error } = await supabase.from("template_revisions")
        .update({ definition: d.def }).eq("id", rev.id);
      if (error) throw error;
    } else {
      // Editing a published revision starts a new draft rather than
      // rewriting history under inspections already captured against it.
      const nextRev = Math.max(0, ...S.revisions.filter(r => r.template_id === d.tplId).map(r => r.rev)) + 1;
      const { error } = await supabase.from("template_revisions").insert({
        template_id: d.tplId, rev: nextRev, status: "draft",
        definition: d.def, created_by: S.profile.id
      });
      if (error) throw error;
      toast(`Started revision ${nextRev} as a draft.`, "ok");
    }
    d.dirty = false;
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function publishDraft() {
  const draft = S.revisions.find(r => r.template_id === S.designer.tplId && ["draft", "in_review"].includes(r.status));
  if (!draft) return;
  busy(true);
  try {
    const { data, error } = await supabase.rpc("publish_template_revision", { p_rev: draft.id });
    if (error) throw error;
    toast(`Published rev ${data.rev}.${data.self_approved ? " Recorded as self-approved." : ""}`, "ok");
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

function editCell(familyId, stageId) {
  const existing = S.requirements.find(r => r.family_id === familyId && r.stage_id === stageId);
  const levels = HP()
    ? [["hold","Hold point — must pass before the works order advances"],
       ["required","Required — must be completed, does not block"],
       ["optional","Optional — scheduled only when requested"],
       ["na","Not applicable"]]
    : [["required","Required — must be completed"],
       ["optional","Optional — scheduled only when requested"],
       ["na","Not applicable"]];
  const fam = byId(S.families, familyId), stg = byId(S.stages, stageId);
  openModal(`${fam.name} · ${stg.name}`, `
    <div class="fld"><label>Inspection template</label><select id="cTpl">
      <option value="">— none —</option>
      ${S.templates.map(t => `<option value="${t.id}" ${existing?.template_id === t.id ? "selected" : ""}>${esc(t.code)} — ${esc(t.name)}${revFor(t.id) ? "" : " (no published revision)"}</option>`).join("")}
    </select><div class="hint">A template with no published revision saves here but generates nothing until it is published.</div></div>
    <div class="fld"><label>Requirement level</label><select id="cLvl">
      ${levels.map(l => `<option value="${l[0]}" ${existing?.level === l[0] ? "selected" : ""}>${l[1]}</option>`).join("")}</select></div>
    <div class="fld"><label>Sampling rule</label><select id="cSmp">
      ${[["full","100% — every unit"],["first_off","First-off — first unit of each batch"],["sample_pct","Sample — percentage of batch"],["per_shift","Per shift"],["per_delivery","Per delivery"]]
        .map(o => `<option value="${o[0]}" ${existing?.sampling === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select></div>`,
    [["Cancel", "close"], ["Clear cell", "clear-cell", "danger"], ["Save requirement", "save-cell", "pri"]],
    { familyId, stageId, existingId: existing?.id });
}
async function saveCell() {
  const { familyId, stageId, existingId } = modalCtx;
  const tpl = $("cTpl").value, level = $("cLvl").value, sampling = $("cSmp").value;
  busy(true);
  try {
    const row = { family_id: familyId, stage_id: stageId,
      template_id: (!tpl || level === "na") ? null : tpl,
      level: (!tpl || level === "na") ? "na" : level, sampling,
      updated_by: S.profile.id, updated_at: new Date().toISOString() };
    const { error } = existingId
      ? await supabase.from("inspection_requirements").update(row).eq("id", existingId)
      : await supabase.from("inspection_requirements").insert(row);
    if (error) throw error;
    closeModal(); await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function toggleHoldPoints() {
  busy(true);
  try {
    const { error } = await supabase.from("division_profile")
      .update({ hold_points: !HP() }).eq("id", true);
    if (error) throw error;
    await reload();
    toast(`Hold points ${HP() ? "enabled" : "disabled"} for this division.`, "ok");
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function toggleSecondApprover() {
  busy(true);
  try {
    const { error } = await supabase.from("division_profile")
      .update({ require_second_approver: !NEEDS_2ND() }).eq("id", true);
    if (error) throw error;
    await reload();
    toast(`Second approver ${NEEDS_2ND() ? "required" : "not required"} for templates.`, "ok");
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function setProfileField(id, patch) {
  busy(true);
  try {
    const { error } = await supabase.from("profiles").update(patch).eq("id", id);
    if (error) throw error;
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function assignInspection(id, personId) {
  busy(true);
  try {
    const { error } = await supabase.from("inspections").update({ assigned_to: personId || null }).eq("id", id);
    if (error) throw error;
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

function disposeFailedCheck(id) {
  const fc = byId(S.failedChecks, id);
  openModal(`Disposition ${fc.ref}`, `
    <div class="fld"><label>Decision</label><select id="dDisp">
      ${[["rework_reinspect","Rework and re-inspect"],["accept_concession","Accept with concession"],["quarantine","Quarantine"],["scrap","Scrap"]]
        .map(o => `<option value="${o[0]}">${o[1]}</option>`).join("")}</select></div>
    <div class="fld"><label>Reason</label><textarea id="dReason" rows="3" placeholder="Why this decision — this is the record an auditor reads"></textarea></div>`,
    [["Cancel", "close"], ["Save disposition", "save-disposition", "pri"]], { fcId: id });
}
async function saveDisposition() {
  busy(true);
  try {
    const { error } = await supabase.from("failed_checks").update({
      disposition: $("dDisp").value, reason: $("dReason").value,
      disposition_by: S.profile.id, disposition_at: new Date().toISOString()
    }).eq("id", modalCtx.fcId);
    if (error) throw error;
    closeModal(); await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

function newTemplate() {
  openModal("New inspection template", `
    <div class="two"><div class="fld"><label>Code</label><input id="tCode" placeholder="IT-ASM-05"></div>
    <div class="fld"><label>Name</label><input id="tName" placeholder="Assembly inspection"></div></div>
    <div class="two"><div class="fld"><label>Manufacturing stage</label><select id="tStage">${S.stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div>
    <div class="fld"><label>Product family</label><select id="tFam"><option value="">All families</option>${S.families.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></div></div>
    <div class="fld"><label>Minimum competency to perform</label><select id="tComp">
      <option value="1">Level 1 — any trained user</option><option value="2" selected>Level 2 — competent under supervision</option><option value="3">Level 3 — may sign off independently</option></select></div>`,
    [["Cancel", "close"], ["Create as draft", "save-template", "pri"]], {});
}
async function saveTemplate() {
  busy(true);
  try {
    const { data, error } = await supabase.from("inspection_templates").insert({
      code: $("tCode").value.trim(), name: $("tName").value.trim(),
      stage_id: +$("tStage").value, family_id: $("tFam").value ? +$("tFam").value : null,
      min_competency: +$("tComp").value, created_by: S.profile.id
    }).select().single();
    if (error) throw error;
    const { error: e2 } = await supabase.from("template_revisions").insert({
      template_id: data.id, rev: 1, status: "draft",
      definition: { sections: [{ id: "s1", title: "Identification", items: [] }] },
      created_by: S.profile.id
    });
    if (e2) throw e2;
    closeModal();
    S.designer = { open: true, tplId: data.id, revId: null, def: null,
                   sel: null, preview: false, dirty: false };
    S.view = "dsn"; buildNav(); await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}



/* ---------------------------------------------------------------
   Readiness.

   Getting from a bare division to a scheduled inspection takes six
   things in order, and every screen that can be empty was saying only
   "Nothing to show yet" — which is indistinguishable from a broken app.
   The chain is computed once here so the works-order view, the schedule,
   the unassigned list and the inspector's queue all name the SAME next
   step rather than each guessing.
   --------------------------------------------------------------- */
function readiness() {
  const published = publishedRevs().length;
  const matrix = S.requirements.filter(r => r.template_id && r.level !== "na").length;
  const withFamily = S.projects.filter(p => p.family_id).length;
  return [
    { ok: published > 0,
      label: "Publish an inspection template",
      detail: published ? `${published} published`
        : "A draft is skipped when generating — it has to be published.",
      go: ["dsn", "Form designer"] },
    { ok: matrix > 0,
      label: "Say which inspections a product family needs",
      detail: matrix ? `${matrix} requirement${matrix === 1 ? "" : "s"} configured`
        : "Nothing yet tells the scheduler what to inspect.",
      go: ["req", "Inspection requirements"] },
    { ok: S.projects.length > 0,
      label: "Add a project",
      detail: S.projects.length ? `${S.projects.length} project${S.projects.length === 1 ? "" : "s"}`
        : "A contract or order.",
      go: ["sched", "Projects & works orders", 2] },
    { ok: withFamily > 0,
      label: "Set the project's product family",
      detail: withFamily ? `${withFamily} with a family set`
        : "Without one, the requirements matrix cannot be read for it.",
      go: ["sched", "Projects & works orders", 2] },
    { ok: S.worksOrders.length > 0,
      label: "Add a works order to the project",
      detail: S.worksOrders.length ? `${S.worksOrders.length} works order${S.worksOrders.length === 1 ? "" : "s"}`
        : "What is actually being built. Its quantity decides how many inspections are created.",
      go: ["sched", "Projects & works orders", 2] },
    { ok: S.inspections.length > 0,
      label: "Generate the inspections",
      detail: S.inspections.length ? `${S.inspections.length} inspection${S.inspections.length === 1 ? "" : "s"}`
        : "Press Generate on the works order.",
      go: ["sched", "Projects & works orders", 2] }
  ];
}
const nextStep = () => readiness().find(x => !x.ok) || null;

function readinessCard(title) {
  const steps = readiness();
  const done = steps.filter(x => x.ok).length;
  return `<div class="card" style="margin-bottom:14px">
    <h3>${esc(title)} <span class="cl">${done} of ${steps.length} done</span></h3>
    <div class="bd">
      ${steps.map((x, i) => `<div style="display:flex;gap:10px;align-items:flex-start;padding:7px 0;
            ${i && !steps[i - 1].ok && !x.ok ? "opacity:.55" : ""}">
        <span style="width:19px;height:19px;border-radius:50%;flex:0 0 19px;display:grid;
              place-items:center;font-size:10.5px;font-weight:700;color:#fff;margin-top:1px;
              background:${x.ok ? "var(--ok)" : "var(--muted)"}">${x.ok ? "✓" : i + 1}</span>
        <div style="flex:1"><div style="font-size:12.8px;font-weight:600">${esc(x.label)}</div>
          <div class="sub">${esc(x.detail)}</div></div>
        ${x.ok ? "" : `<button class="btn sm" data-goto="${x.go[0]}${x.go[2] !== undefined ? ":" + x.go[2] : ""}">${esc(x.go[1])} →</button>`}
      </div>`).join("")}
    </div></div>`;
}

/* The empty state for a list that has nothing in it BECAUSE setup is
   incomplete, as opposed to nothing in it because the work is done. */
function emptyBecause(whatIsEmpty, doneMessage) {
  const step = nextStep();
  if (!step) return `<div class="card"><div class="empty">${esc(doneMessage)}</div></div>`;
  return `<div class="card"><div class="bd" style="text-align:center;padding:34px 20px">
    <div style="font-size:14.5px;font-weight:700;margin-bottom:5px">${esc(whatIsEmpty)}</div>
    <p style="color:var(--ink-2);font-size:13px;max-width:460px;margin:0 auto 6px">
      Next step: <b>${esc(step.label)}</b></p>
    <p style="color:var(--muted);font-size:12.5px;max-width:460px;margin:0 auto 18px">${esc(step.detail)}</p>
    <button class="btn pri" data-goto="${step.go[0]}${step.go[2] !== undefined ? ":" + step.go[2] : ""}">${esc(step.go[1])} →</button>
  </div></div>`;
}

/* ---------------------------------------------------------------
   Projects and works orders.

   Built as an ordered flow rather than two editable tables. The tables
   were technically complete and genuinely confusing: two empty grids
   side by side, an add row that looked like part of the table, a Save
   button with nothing to save, and no hint that a works order belongs to
   a project or that anything had to happen in a particular order.

   A works order IS a child of a project, so it is drawn as one. And
   because generating depends on a published template and a populated
   matrix, the prerequisites are shown as a checklist instead of failing
   silently at the end.
   --------------------------------------------------------------- */
function worksView() {
  const steps = readiness();
  const blocked = steps.filter(x => !x.ok).length;
  const checklist = readinessCard("Getting to a scheduled inspection");

  if (!S.projects.length) {
    return checklist + `<div class="card"><div class="bd" style="text-align:center;padding:38px 20px">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">Start with a project</div>
      <p style="color:var(--ink-2);font-size:13px;max-width:440px;margin:0 auto 18px">
        A project is a contract or order. Its product family is what decides which inspections
        the requirements matrix calls for, so it has to be set.</p>
      <button class="btn pri" data-act="add-project">Add a project</button>
    </div></div>`;
  }

  const card = p => {
    const orders = S.worksOrders.filter(w => w.project_id === p.id);
    const fam = byId(S.families, p.family_id);
    return `<div class="card" style="margin-bottom:13px">
      <div class="bd" style="padding-bottom:6px">
        <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <div style="flex:1;min-width:230px">
            <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap">
              <span class="id" style="font-size:12.8px">${esc(p.code)}</span>
              <b style="font-size:13.5px">${esc(p.name)}</b>
              ${fam ? pill(fam.name) : pill("No product family")}
            </div>
            <div class="sub">${esc(p.customer || "no customer recorded")} ·
              ${orders.length} works order${orders.length === 1 ? "" : "s"}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn sm" data-act="edit-project" data-id="${p.id}">Edit</button>
            <button class="btn sm danger" data-act="del-project" data-id="${p.id}">×</button>
          </div>
        </div>
        ${!fam ? `<div class="note q" style="margin-top:11px">No product family, so the
          requirements matrix cannot be read for this project and nothing will generate.
          Edit it and set one.</div>` : ""}
      </div>

      <div style="border-top:1px solid var(--line);padding:0 16px 14px">
        ${orders.length ? `<div style="display:grid;grid-template-columns:120px 1fr 60px 110px 190px;
              gap:9px;padding:10px 2px 6px;font-size:10px;letter-spacing:.12em;
              text-transform:uppercase;color:var(--muted);font-weight:700">
            <div>Works order</div><div>Description</div><div>Qty</div><div>Inspections</div><div></div>
          </div>` : ""}
        ${orders.map(w => {
          const made = S.inspections.filter(i => i.works_order_id === w.id).length;
          return `<div style="display:grid;grid-template-columns:120px 1fr 60px 110px 190px;gap:9px;
                align-items:center;padding:6px 2px;border-top:1px solid var(--line-2)">
            <span class="id">${esc(w.code)}</span>
            <span style="font-size:12.6px">${esc(w.description || "—")}</span>
            <span style="font-size:12.6px">${w.qty}</span>
            <span>${made ? pill(`${made} generated`) : `<span style="color:var(--muted);font-size:12px">none yet</span>`}</span>
            <div style="display:flex;gap:6px;justify-content:flex-end">
              ${w.status === "held" ? pill("Held") : ""}
              <button class="btn sm" data-act="edit-wo" data-id="${w.id}">Edit</button>
              <button class="btn sm ${made ? "" : "pri"}" data-act="gen-wo" data-id="${w.id}"
                ${blocked ? "disabled title=\"Complete the checklist above first\"" : ""}
              >${made ? "Generate again" : "Generate"}</button>
            </div></div>`;
        }).join("")}
        ${orders.length ? "" : `<div style="padding:12px 2px;color:var(--muted);font-size:12.5px">
          No works orders yet. A works order is what is actually being built — its quantity
          decides how many inspections a 100% rule creates.</div>`}
        <div style="padding-top:10px">
          <button class="btn sm" data-act="add-wo" data-id="${p.id}">+ Add works order</button>
        </div>
      </div></div>`;
  };

  return checklist
    + S.projects.slice().sort((a, b) => a.code.localeCompare(b.code)).map(card).join("")
    + `<div style="margin-top:4px"><button class="btn" data-act="add-project">+ Add a project</button></div>`;
}

function projectModal(existing) {
  const p = existing || {};
  openModal(existing ? `Edit ${p.code}` : "Add a project", `
    <div class="two">
      <div class="fld"><label>Project code</label>
        <input id="pCode" value="${esc(p.code || "")}" placeholder="P-26118"></div>
      <div class="fld"><label>Customer</label>
        <input id="pCustomer" value="${esc(p.customer || "")}" placeholder="Eskom Distribution"></div>
    </div>
    <div class="fld"><label>Name</label>
      <input id="pName" value="${esc(p.name || "")}" placeholder="12 kV panels x 24"></div>
    <div class="fld"><label>Product family</label>
      <select id="pFamily">
        <option value="">— none —</option>
        ${S.families.map(f => `<option value="${f.id}" ${p.family_id === f.id ? "selected" : ""}>${esc(f.name)}</option>`).join("")}
      </select>
      <div class="hint">Decides which inspections the requirements matrix calls for. Without it,
        nothing generates.</div></div>`,
    [["Cancel", "close"], [existing ? "Save" : "Add project", "save-project", "pri"]],
    { id: p.id });
}

function worksOrderModal(projectId, existing) {
  const w = existing || {};
  const pid = existing ? w.project_id : projectId;
  openModal(existing ? `Edit ${w.code}` : "Add a works order", `
    <div class="two">
      <div class="fld"><label>Works order code</label>
        <input id="wCode" value="${esc(w.code || "")}" placeholder="WO-44812"></div>
      <div class="fld"><label>Project</label>
        <select id="wProject">
          ${S.projects.map(p => `<option value="${p.id}" ${String(pid) === String(p.id) ? "selected" : ""}>${esc(p.code)} — ${esc(p.name)}</option>`).join("")}
        </select></div>
    </div>
    <div class="fld"><label>Description</label>
      <input id="wDesc" value="${esc(w.description || "")}" placeholder="Panels 1 to 3"></div>
    <div class="two">
      <div class="fld"><label>Quantity</label>
        <input id="wQty" type="number" min="1" value="${w.qty || 1}">
        <div class="hint">A 100% sampling rule creates one inspection per unit.</div></div>
      <div class="fld"><label>Status</label>
        <select id="wStatus">
          ${["open", "held", "closed"].map(x => `<option ${w.status === x ? "selected" : ""}>${x}</option>`).join("")}
        </select></div>
    </div>`,
    [["Cancel", "close"], [existing ? "Save" : "Add works order", "save-wo", "pri"]],
    { id: w.id });
}

async function saveProject() {
  const row = {
    code: $("pCode").value.trim(), name: $("pName").value.trim(),
    customer: $("pCustomer").value.trim() || null,
    family_id: $("pFamily").value ? Number($("pFamily").value) : null
  };
  if (!row.code || !row.name) { toast("A project needs a code and a name.", "bad"); return; }
  busy(true);
  try {
    const { error } = modalCtx.id
      ? await supabase.from("projects").update(row).eq("id", modalCtx.id)
      : await supabase.from("projects").insert(row);
    if (error) throw error;
    closeModal(); await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function saveWorksOrder() {
  const row = {
    code: $("wCode").value.trim(), project_id: Number($("wProject").value),
    description: $("wDesc").value.trim() || null,
    qty: Math.max(1, Number($("wQty").value) || 1),
    status: $("wStatus").value
  };
  if (!row.code) { toast("A works order needs a code.", "bad"); return; }
  busy(true);
  try {
    const { error } = modalCtx.id
      ? await supabase.from("works_orders").update(row).eq("id", modalCtx.id)
      : await supabase.from("works_orders").insert(row);
    if (error) throw error;
    closeModal(); await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

async function deleteProject(id) {
  const p = byId(S.projects, id);
  if (!confirm(`Delete project "${p.code}"?\n\nRefused if any works order or inspection references it.`)) return;
  busy(true);
  try {
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) throw error;
    toast(`${p.code} deleted.`, "ok"); await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

/* There is no separate "generate" dialog any more. Generating lives on the
   works order it applies to, under Scheduling → Projects & works orders. The
   dialog was a second way to do the same thing, and being a dropdown it could
   not show what mattered — which project, which family, how many inspections
   already exist — so it made a clear action look like a form to fill in. */
async function generateForWorksOrder(id) {
  busy(true);
  try {
    const { data, error } = await supabase.rpc("generate_inspections", { p_works_order: Number(id) });
    if (error) throw error;
    toast(data.created
      ? `${data.created} inspection(s) created for ${data.works_order}.`
      : `Nothing generated for ${data.works_order} — check the requirements matrix has a published template for that product family.`,
      data.created ? "ok" : "bad");
    await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}
/* ---- modal plumbing ---- */
let modalCtx = {};
function openModal(title, body, buttons, ctx) {
  modalCtx = ctx || {};
  $("mTitle").textContent = title;
  $("mBody").innerHTML = body;
  $("mFoot").innerHTML = buttons.map(b => `<button class="btn ${b[2] || ""}" data-act="${b[1]}">${b[0]}</button>`).join("");
  $("modal").classList.add("open");
}
function closeModal() { $("modal").classList.remove("open"); modalCtx = {}; }

/* ------------------------------------------------------------
   6. Render and events
   ------------------------------------------------------------ */
const VIEWS = { dash: vDash, work: vWork, sched: vSched, dsn: vDsn, req: vReq, adm: vAdm };
function render() {
  const m = NAV.find(x => x.id === S.view);
  if (!m || (setupIds.includes(m.id) && !canConfigure())) { S.view = "dash"; S.tab = 0; return render(); }
  $("page").innerHTML = VIEWS[S.view](m) + foot();

  $("whoName").textContent = S.profile.full_name;
  $("whoEmail").textContent = S.profile.email;
  $("whoInitials").textContent = S.profile.full_name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
  $("sideDivision").textContent = S.division?.name || DIVISION.name;
  $("buildTag").textContent = `${BUILD.context} · ${BUILD.commit}`;
  const od = S.dash.overdue || 0;
  $("chipOverdue").classList.toggle("hidden", !od);
  $("chipOverdue").textContent = `${od} overdue`;
  const pr = S.dash.pass_rate_30d;
  $("chipYield").classList.toggle("hidden", pr == null);
  $("chipYield").textContent = `Pass rate ${pr}%`;
}

/* One delegated listener rather than handlers sprinkled through the markup:
   the page is re-rendered constantly, and rebound handlers leak. */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-go],[data-goto],[data-tab],[data-act],[data-open-capture],[data-sel],[data-add],[data-move],[data-del],[data-del-sec],[data-tg],[data-cell],[data-toggle-active],[data-dispose],[data-outcome],[data-ref-save],[data-ref-cancel],[data-ref-add],[data-ref-toggle],[data-ref-del],[data-tpl],[data-id]");
  if (!t) return;
  const d = t.dataset;

  if (d.go) return go(d.go);
  if (d.goto) {
    /* "view" or "view:tab" — the readiness steps point at a specific tab, and
       landing on the right module but the wrong tab is barely better than not
       linking at all. */
    const [v, tb] = d.goto.split(":");
    S.view = v; S.tab = tb ? Number(tb) : 0; buildNav(); render(); window.scrollTo(0, 0);
    return;
  }
  if (d.tab !== undefined) { S.tab = +d.tab; return render(); }
  if (d.openCapture) return openCapture(d.openCapture);
  if (d.sel) { S.designer.sel = d.sel; return render(); }
  if (d.toggleActive) {
    const p = byId(S.people, d.toggleActive);
    return setProfileField(p.id, { active: !p.active });
  }
  if (d.dispose) return disposeFailedCheck(d.dispose);
  if (d.refSave) return saveRefList(d.refSave);
  if (d.refAdd) return addRefRow(d.refAdd);
  if (d.refToggle) { const [tb, id] = d.refToggle.split("|"); return toggleRefActive(tb, id); }
  if (d.refDel) { const [tb, id] = d.refDel.split("|"); return deleteRefRow(tb, id); }
  if (d.generateWo) return generateForWorksOrder(d.generateWo);
  if (d.refCancel) {
    for (const k of Object.keys(S.refDraft)) if (k.startsWith(d.refCancel + "|")) delete S.refDraft[k];
    return render();
  }
  if (d.cell) { const [f, s] = d.cell.split(":").map(Number); return editCell(f, s); }
  if (d.outcome) {
    const fid = t.closest("[data-field]").dataset.field;
    saveAnswer(fid, { outcome: d.outcome, value_num: null, value_text: null });
    return render();
  }
  if (d.add) {
    const def = S.designer.def, nid = "f" + Math.random().toString(36).slice(2, 7);
    if (d.add === "section") def.sections.push({ id: nid, title: "New section", items: [] });
    else {
      const sec = def.sections.find(s => s.items.some(i => i.id === S.designer.sel)) || def.sections.at(-1);
      if (!sec) { def.sections.push({ id: "s" + nid, title: "New section", items: [] }); }
      const target = def.sections.find(s => s.items.some(i => i.id === S.designer.sel)) || def.sections.at(-1);
      const item = { id: nid, type: d.add, label: TYPES[d.add].n, req: 0 };
      if (d.add === "measure") Object.assign(item, { unit: "mm", tgt: "", min: "", max: "" });
      if (d.add === "select") item.opts = ["Option 1", "Option 2"];
      if (d.add === "photo") item.minp = 1;
      target.items.push(item); S.designer.sel = nid;
    }
    S.designer.dirty = true; return render();
  }
  if (d.move) {
    const [id, dir] = d.move.split(":"); const f = findItem(id);
    const arr = f.s.items, i = arr.indexOf(f.it), j = i + Number(dir);
    if (j >= 0 && j < arr.length) { arr.splice(i, 1); arr.splice(j, 0, f.it); S.designer.dirty = true; }
    return render();
  }
  if (d.del) {
    const f = findItem(d.del); f.s.items.splice(f.s.items.indexOf(f.it), 1);
    if (S.designer.sel === d.del) S.designer.sel = null;
    S.designer.dirty = true; return render();
  }
  if (d.delSec) { S.designer.def.sections.splice(+d.delSec, 1); S.designer.dirty = true; return render(); }
  if (d.tg) { const f = findItem(S.designer.sel); f.it[d.tg] = f.it[d.tg] ? 0 : 1; S.designer.dirty = true; return render(); }

  switch (d.act) {
    case "refresh": return reload();
    case "open-designer":
      S.designer = { open: true, tplId: t.dataset.tpl, revId: null, def: null,
                     sel: null, preview: false, dirty: false };
      return render();
    case "open-preview":
      S.designer = { open: true, tplId: t.dataset.tpl, revId: null, def: null,
                     sel: null, preview: true, dirty: false };
      return render();
    case "back-to-library":
      if (S.designer.dirty &&
          !confirm("You have unsaved changes to this template. Leave without saving?")) return;
      S.designer = { open: false, tplId: null, revId: null, def: null,
                     sel: null, preview: false, dirty: false };
      return render();
    case "toggle-preview": S.designer.preview = !S.designer.preview; return render();
    case "save-draft": return saveDraft();
    case "publish": return publishDraft();
    case "new-template": return newTemplate();
    case "save-template": return saveTemplate();
    case "submit-inspection": return submitInspection();
    case "toggle-hp": return toggleHoldPoints();
    case "toggle-2nd": return toggleSecondApprover();
    case "add-project": return projectModal(null);
    case "edit-project": return projectModal(byId(S.projects, Number(t.dataset.id)));
    case "del-project": return deleteProject(Number(t.dataset.id));
    case "save-project": return saveProject();
    case "add-wo": return worksOrderModal(Number(t.dataset.id), null);
    case "edit-wo": return worksOrderModal(null, byId(S.worksOrders, Number(t.dataset.id)));
    case "save-wo": return saveWorksOrder();
    case "gen-wo": return generateForWorksOrder(t.dataset.id);
    case "save-cell": return saveCell();
    case "clear-cell": { const { existingId } = modalCtx;
      if (existingId) { await supabase.from("inspection_requirements").delete().eq("id", existingId); }
      closeModal(); return reload(); }
    case "save-disposition": return saveDisposition();
    case "close": return closeModal();
  }
});

document.addEventListener("change", e => {
  const d = e.target.dataset;
  if (d.ref) {
    /* Recorded on change (blur), not on input, and deliberately WITHOUT a
       re-render: repainting the grid mid-edit moves the caret and loses focus.
       The field is outlined and the Save button enabled by hand instead. */
    const [table, id, field] = d.ref.split("|");
    const row = (S[ALL_LISTS().find(l => l.table === table).state] || [])
      .find(r => String(r.id) === String(id));
    const original = row ? String(row[field] ?? "") : "";
    if (String(e.target.value) === original) delete S.refDraft[d.ref];
    else S.refDraft[d.ref] = e.target.value;
    e.target.style.borderColor = d.ref in S.refDraft ? "var(--brand)" : "var(--line)";
    const n = Object.keys(S.refDraft).filter(k => k.startsWith(table + "|")).length;
    const save = document.querySelector(`[data-ref-save="${table}"]`);
    const cancel = document.querySelector(`[data-ref-cancel="${table}"]`);
    if (save) save.disabled = !n;
    if (cancel) cancel.disabled = !n;
    const counter = save && save.closest("div").querySelector(".cnt");
    if (counter) counter.textContent = n
      ? `${n} unsaved change${n === 1 ? "" : "s"}` : "No unsaved changes";
    return;
  }
  if (d.p) {
    const f = findItem(S.designer.sel); if (!f) return;
    f.it[d.p] = d.p === "opts" ? e.target.value.split("\n").filter(Boolean) : e.target.value;
    S.designer.dirty = true; return render();
  }
  if (d.secTitle !== undefined) { S.designer.def.sections[+d.secTitle].title = e.target.value; S.designer.dirty = true; return; }

  if (d.num !== undefined) return saveAnswer(d.num, { value_num: e.target.value === "" ? null : Number(e.target.value) });
  if (d.txt !== undefined) return saveAnswer(d.txt, { value_text: e.target.value });
  if (d.equip !== undefined) return saveAnswer(d.equip, { equipment_id: e.target.value ? Number(e.target.value) : null });
  if (d.role) return setProfileField(d.role, { role: e.target.value });
  if (d.dept) return setProfileField(d.dept, { department_id: e.target.value ? Number(e.target.value) : null });
  if (d.assign) return assignInspection(d.assign, e.target.value);
});

$("modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
$("mClose").addEventListener("click", closeModal);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
$("btnSignIn").addEventListener("click", async () => {
  try { await signIn(); }
  catch (e) { $("signInErr").textContent = explain(e); $("signInErr").classList.remove("hidden"); }
});
$("btnDevSignIn").addEventListener("click", async () => {
  try { await signInWithPassword($("devEmail").value.trim(), $("devPassword").value); }
  catch (e) { $("signInErr").textContent = explain(e); $("signInErr").classList.remove("hidden"); }
});
$("btnRecheck").addEventListener("click", () => start());
$("btnSignOut").addEventListener("click", signOutNow);
$("btnSignOut2").addEventListener("click", signOutNow);
$("btnRefresh").addEventListener("click", reload);
$("whatsNew").addEventListener("click", () => openModal("What's new",
  (window.CHANGELOG||[]).map(c => `<div class="fld"><label>${c.d}</label><div class="val">${esc(c.t)}</div></div>`).join(""),
  [["Close", "close", "pri"]], {}));

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
function paintLogos() {
  const L = window.ACTOM_LOGO;
  if (!L) return;
  const set = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
  set("loaderMark", L.full());
  // The sign-in card is white, so the badge goes on it as-supplied.
  set("gateMark", L.onLight(58));
  set("sideTile", L.tile(22));
}

/* Shows a readable failure instead of a splash screen that hangs.
   The first deploy of this app sat on the loading screen with no logo and no
   message, which gave nobody anything to act on: the cause was a script that
   had not executed, and a stuck loader looks identical whatever the reason. */
function bootFailed(err) {
  console.error("Grid failed to start", err);
  const l = $("loader");
  if (l) l.remove();
  document.body.insertAdjacentHTML("afterbegin", `
    <div class="gate"><div class="gatebox" style="max-width:560px;text-align:left">
      <h1 style="text-align:center">Grid could not start</h1>
      <div class="err" style="display:block">${String(err && err.message || err)
        .replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div>
      <p>This is a configuration or deployment problem, not something you did.
         Send this message to Group IT along with what you were doing.</p>
      <ul style="font-size:12.5px;color:var(--ink-2);line-height:1.8;padding-left:20px">
        <li>If it mentions <b>GRID</b> or <b>vendor/supabase.js</b>, a script did not load —
            check the deploy included <code>vendor/supabase.js</code>.</li>
        <li>If it mentions <b>config</b>, the site environment variables are not set.</li>
        <li>If it mentions <b>did not respond</b>, the browser could not reach Supabase:
            check the project is running and that the CSP allows
            <code>connect-src</code> to it.</li>
        <li>Otherwise open the browser console for the full error.</li>
      </ul>
      <div class="buildtag" style="margin:10px 0 14px">build ${
        (window.GRID_CONFIG && window.GRID_CONFIG.build &&
         window.GRID_CONFIG.build.commit) || "unknown"}</div>
      <button class="btn pri" style="width:100%;justify-content:center"
              onclick="location.reload()">Try again</button>
    </div></div>`);
}

/* Rejects if the wrapped promise has not settled in time. A boot that hangs
   is worse than a boot that fails: there is nothing on screen, nothing in the
   console, and nothing for IT to act on. supabase.auth.getSession() acquires
   an internal navigator lock and can sit there indefinitely, which is exactly
   what this converts into a visible message. */
function withTimeout(promise, ms, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(
        `${what} did not respond within ${ms / 1000} seconds.`)), ms))
  ]);
}

/* Boot is guarded two ways.

   Re-entrancy: start() was called at the bottom of this file AND again by
   onAuthStateChange, which fires on page load. Two concurrent boots raced
   each other and the second one blew up on the realtime channel.

   Redundant events: TOKEN_REFRESHED and INITIAL_SESSION arrive routinely
   and mean nothing has changed for the user, so they must not trigger a
   full reload — on a shop-floor tablet left open all shift, a token
   refresh every hour would wipe a half-captured inspection. */
let booting = false;
let bootedUserId = null;

async function start() {
  if (booting) return;
  booting = true;
  try { await boot(); } finally { booting = false; }
}

async function boot() {
  paintLogos();
  if (!window.ACTOM_LOGO) console.warn("logo.js did not load — check the deploy includes it.");
  $("gateDivision").textContent = DIVISION.name || "Inspections";
  // Password sign-in is a local convenience only; Netlify always sets CONTEXT.
  if (BUILD.context === "local") $("devSignIn").classList.remove("hidden");
  if (!(await withTimeout(gate(), 15000, "Sign-in check"))) {
    $("loader")?.classList.add("gone");
    return;
  }
  await withTimeout(loadData(), 30000, "Loading data");
  buildNav();
  render();
  subscribe();
  $("loader")?.classList.add("gone");
  setTimeout(() => $("loader")?.remove(), 600);
}
supabase.auth.onAuthStateChange((event, session) => {
  const uid = (session && session.user && session.user.id) || null;
  /* INITIAL_SESSION and TOKEN_REFRESHED arrive routinely and mean nothing has
     changed for this user. Re-booting on them would discard a half-captured
     inspection on a tablet left open all shift — and re-booting on
     INITIAL_SESSION is what made boot run twice and break realtime with
     "cannot add postgres_changes callbacks ... after subscribe()". */
  if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED" ||
      event === "USER_UPDATED") return;
  if (event !== "SIGNED_OUT" && uid === bootedUserId) return;
  bootedUserId = uid;
  start().catch(bootFailed);
});

console.info("Grid app.js loaded — build",
  (window.GRID_CONFIG && window.GRID_CONFIG.build && window.GRID_CONFIG.build.commit) || "?");

start().catch(bootFailed);

})();
