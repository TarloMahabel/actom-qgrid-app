/* ============================================================
   ACTOM QGrid — Inspections (Phase 1)
   Wired application. Vanilla ES modules, no build step.

   Reading order:
     1. state and helpers
     2. auth gate
     3. data layer
     4. views
     5. actions (writes)
     6. boot
   ============================================================ */

import { supabase, DIVISION, BUILD, signIn, signOutNow, currentProfile, explain }
  from "./mock.mjs";

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
  designer: { tplId: null, revId: null, def: null, sel: null, preview: false, dirty: false },
  capture: { id: null, results: {} }
};

const CHANGELOG = [
  { d: "2026-08-26", t: "Phase 1 wired to Supabase — inspections, scheduling, form designer, requirements." }
];

const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const HP = () => !!S.division?.hold_points;
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
   one repaint, not six. */
let rtTimer;
function subscribe() {
  const bump = () => { clearTimeout(rtTimer); rtTimer = setTimeout(reload, 600); };
  supabase.channel("qgrid")
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
  { id: "sched", n: 3, t: "Scheduling",              col: "--m3", tabs: ["Schedule", "Unassigned"] },
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
    <div class="eyebrow">Module ${m.n} · QGrid Inspections</div>
    <p>${desc}</p></div><div class="pact">${act || ""}</div></div>`;
}
const foot = () => `<div class="foot">
  <div><span class="b">${S.inspections.filter(i => i.status !== "completed").length} open</span> ·
       <span class="b">${S.failedChecks.filter(f => f.disposition === "awaiting").length} awaiting disposition</span> ·
       <span class="b">${publishedRevs().length} of ${S.templates.length} templates published</span></div>
  <div>${esc(S.division?.name || DIVISION.name)} · hold points ${HP() ? "enabled" : "disabled"}</div>
  <div>ACTOM QGrid · a division of ACTOM (Pty) Ltd · Since 1903</div></div>`;

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
async function loadYield() {
  const { data, error } = await supabase.from("v_stage_yield").select("*");
  const host = $("yieldHost"); if (!host) return;
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
      : `<div class="card"><div class="empty">Nothing assigned to you. Scheduled work appears here automatically.</div></div>`;
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
        ${canPlan() ? `<button class="btn pri" data-act="generate">Generate from works order</button>` : ""}
      </div>` +
      T(["Reference", "Inspection", "Stage", "Project / works order", "Unit", "Planned", "Inspector", "Status"],
        S.inspections.slice(0, 80).map(i => {
          const t = tplForRev(i.template_rev_id);
          return [`<span class="id">${esc(i.ref)}</span>`, esc(t?.name || "—"), esc(stageName(i.stage_id)),
            `${esc(byId(S.projects, i.project_id)?.code || "—")}<div class="sub">${esc(byId(S.worksOrders, i.works_order_id)?.code || "")}</div>`,
            esc(i.unit_ref || "—"), fmtDate(i.planned_date),
            i.assigned_to ? esc(byId(S.people, i.assigned_to)?.full_name || "—") : pill("Unassigned"),
            pill(i.planned_date < today() && i.status === "scheduled" ? "Overdue" : i.status)];
        }));
  } else {
    const u = unassigned();
    body = u.length ? T(["Reference", "Inspection", "Stage", "Unit", "Planned", "Assign to"],
      u.map(i => {
        const t = tplForRev(i.template_rev_id);
        return [`<span class="id">${esc(i.ref)}</span>`, esc(t?.name || "—"), esc(stageName(i.stage_id)),
          esc(i.unit_ref || "—"), fmtDate(i.planned_date),
          `<select data-assign="${i.id}"><option value="">— choose —</option>${
            S.people.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}</select>`];
      }))
      : `<div class="card"><div class="empty">Nothing unassigned. This list is the leading indicator of an overdue, so an empty one is the goal.</div></div>`;
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
  if (!S.templates.length)
    return head(m, "Build the inspection form. Quality owns this screen.",
      `<button class="btn pri" data-act="new-template">New template</button>`) +
      `<div class="card"><div class="empty">No templates yet. Create one to get started.</div></div>`;

  if (!S.designer.tplId) S.designer.tplId = S.templates[0].id;
  const tpl = byId(S.templates, S.designer.tplId);
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
  const nFields = def.sections.reduce((a, s) => a + s.items.length, 0);

  const pal = (g, list) => `<div class="gh">${g}</div>${list.map(k =>
    `<button class="pi" data-add="${k}"><span class="ic" style="background:${TYPES[k].c}">${TYPES[k].ic}</span>${TYPES[k].n}</button>`).join("")}`;

  const canvas = def.sections.map((s, si) => `<div class="sec">
    <div class="sh"><input value="${esc(s.title)}" data-sec-title="${si}"
      style="font-weight:700;font-size:12.5px;text-transform:uppercase;letter-spacing:.02em;border:0;background:none;outline:0;color:var(--ink-2);width:60%">
      <span class="sc">${s.items.length} field${s.items.length === 1 ? "" : "s"}</span>
      <button class="btn sm danger" data-del-sec="${si}" style="margin-left:auto">Remove section</button></div>
    ${s.items.map(it => `<div class="it ${S.designer.sel === it.id ? "sel" : ""}" data-sel="${it.id}">
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

  const act = `
    <button class="btn" data-act="toggle-preview">${S.designer.preview ? "Back to designer" : "Preview as inspector"}</button>
    <button class="btn" data-act="save-draft"${S.designer.dirty ? "" : " disabled"}>Save draft</button>
    ${draft && isRole("quality_manager") ? `<button class="btn pri" data-act="publish">Publish rev ${draft.rev}</button>` : ""}`;

  return head(m, "Build the inspection form itself. Adding a checkpoint does not need a developer.", act)
    + `<div class="filters">
        <select id="tplPick">${S.templates.map(t => `<option value="${t.id}" ${t.id === tpl.id ? "selected" : ""}>${esc(t.code)} — ${esc(t.name)}</option>`).join("")}</select>
        <button class="btn sm" data-act="new-template">New template</button>
        <span class="spacer"></span>
        <span class="cnt">rev ${rev?.rev ?? "—"} · ${pill(rev?.status || "none")} · ${nFields} fields
        ${S.designer.dirty ? ' · <b style="color:var(--warn)">unsaved changes</b>' : ""}</span>
      </div>`
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

  return head(m, "Which inspection is required, at which stage, for which product. Click any cell to configure it.",
    `<button class="btn" data-act="refresh">Refresh</button>`) + tabbar(m)
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
    body = `<div class="two">
      ${refCard("Manufacturing stages", S.stages.map(s => s.name))}
      ${refCard("Product families", S.families.map(f => f.name))}
      ${refCard("Departments", S.departments.map(d => d.name))}
      ${refCard("Defect codes", S.defects.map(d => `${d.code} — ${d.description}`))}
    </div>
    <div class="note" style="margin-top:13px">Codes are permanent, descriptions are editable. Retiring a code hides it from new forms and keeps every historic record intact.</div>`;
  }
  else if (S.tab === 2) {
    body = `<div class="card" style="max-width:640px"><h3>Optional features</h3><div class="bd">
      <div class="sw"><div><div class="t">Hold points</div><div class="d">Let a failed checkpoint stop the works order until a named role releases it. Off by default.</div></div>
        <button class="tg ${HP() ? "on" : ""}" data-act="toggle-hp"></button></div>
      <div class="note" style="margin-top:12px">${HP()
        ? "Hold points are <b>on</b>. The matrix, the designer and the workbench all show hold-point controls."
        : "Hold points are <b>off</b>. Inspections still record failures — they simply never block production."}</div>
      <div class="note q" style="margin-top:11px">One switch, one behaviour. A half-used hold-point setting is worse than none: inspectors learn that some failures stop the line and some do not, and the ones that do not get ignored.</div>
    </div></div>`;
  }
  else { body = `<div class="card"><h3>Audit trail</h3><div class="bd" id="auditHost"><div class="empty">Loading…</div></div></div>`; loadAudit(); }

  return head(m, "Users, roles, reference lists and division options.",
    `<button class="btn" data-act="refresh">Refresh</button>`) + tabbar(m) + body;
}
const refCard = (title, items) => `<div class="card"><h3>${title} <span class="cl">${items.length}</span></h3><div class="bd">
  <div style="font-size:12.5px;line-height:1.9">${items.map(i => esc(i)).join("<br>") || "—"}</div></div></div>`;

async function loadAudit() {
  const { data, error } = await supabase.from("audit_trail")
    .select("at,actor_name,action,entity,entity_id").order("at", { ascending: false }).limit(60);
  const host = $("auditHost"); if (!host) return;
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
    toast(`Published rev ${data.rev}.`, "ok");
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
    S.designer = { tplId: data.id, revId: null, def: null, sel: null, preview: false, dirty: false };
    S.view = "dsn"; buildNav(); await reload();
  } catch (e) { toast(explain(e), "bad"); }
  finally { busy(false); }
}

function generateSchedule() {
  openModal("Generate inspections", `
    <div class="fld"><label>Works order</label><select id="gWo">
      ${S.worksOrders.filter(w => w.status === "open").map(w => {
        const p = byId(S.projects, w.project_id);
        return `<option value="${w.id}">${esc(w.code)} — ${esc(p?.code || "")} × ${w.qty}</option>`;
      }).join("")}</select></div>
    <div class="note">Reads the requirements matrix for that product family and creates every inspection it calls for. Templates without a published revision are skipped.</div>`,
    [["Cancel", "close"], ["Generate", "save-generate", "pri"]], {});
}
async function saveGenerate() {
  busy(true);
  try {
    const { data, error } = await supabase.rpc("generate_inspections", { p_works_order: +$("gWo").value });
    if (error) throw error;
    toast(`${data.created} inspection(s) created for ${data.works_order}.`, data.created ? "ok" : "bad");
    closeModal(); await reload();
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
  const t = e.target.closest("[data-go],[data-tab],[data-act],[data-open-capture],[data-sel],[data-add],[data-move],[data-del],[data-del-sec],[data-tg],[data-cell],[data-toggle-active],[data-dispose],[data-outcome]");
  if (!t) return;
  const d = t.dataset;

  if (d.go) return go(d.go);
  if (d.tab !== undefined) { S.tab = +d.tab; return render(); }
  if (d.openCapture) return openCapture(d.openCapture);
  if (d.sel) { S.designer.sel = d.sel; return render(); }
  if (d.toggleActive) {
    const p = byId(S.people, d.toggleActive);
    return setProfileField(p.id, { active: !p.active });
  }
  if (d.dispose) return disposeFailedCheck(d.dispose);
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
    case "toggle-preview": S.designer.preview = !S.designer.preview; return render();
    case "save-draft": return saveDraft();
    case "publish": return publishDraft();
    case "new-template": return newTemplate();
    case "save-template": return saveTemplate();
    case "submit-inspection": return submitInspection();
    case "toggle-hp": return toggleHoldPoints();
    case "generate": return generateSchedule();
    case "save-generate": return saveGenerate();
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
  if (d.p) {
    const f = findItem(S.designer.sel); if (!f) return;
    f.it[d.p] = d.p === "opts" ? e.target.value.split("\n").filter(Boolean) : e.target.value;
    S.designer.dirty = true; return render();
  }
  if (d.secTitle !== undefined) { S.designer.def.sections[+d.secTitle].title = e.target.value; S.designer.dirty = true; return; }
  if (e.target.id === "tplPick") {
    S.designer = { tplId: e.target.value, revId: null, def: null, sel: null, preview: false, dirty: false };
    return render();
  }
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
$("btnRecheck").addEventListener("click", () => start());
$("btnSignOut").addEventListener("click", signOutNow);
$("btnSignOut2").addEventListener("click", signOutNow);
$("btnRefresh").addEventListener("click", reload);
$("whatsNew").addEventListener("click", () => openModal("What's new",
  CHANGELOG.map(c => `<div class="fld"><label>${c.d}</label><div class="val">${esc(c.t)}</div></div>`).join(""),
  [["Close", "close", "pri"]], {}));

/* ------------------------------------------------------------
   Boot
   ------------------------------------------------------------ */
async function start() {
  $("gateDivision").textContent = DIVISION.name || "Inspections";
  if (!(await gate())) { $("loader")?.classList.add("gone"); return; }
  await loadData();
  buildNav();
  render();
  subscribe();
  $("loader")?.classList.add("gone");
  setTimeout(() => $("loader")?.remove(), 600);
}
supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT") start();
});
start();
