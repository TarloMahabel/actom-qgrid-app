/* =====================================================================
   What the chatbot is allowed to look at.

   THIS IS THE STRUCTURAL LAYER FOR CHAT, and it is the reason a chatbot
   over quality records is defensible at all.

   The five drafting intents are safe mostly because of shape: each
   returns strict JSON and anything nameable is checked against a list the
   request supplied. Free prose has none of that, so chat needs its
   equivalent somewhere else. It is here, on the way IN rather than the
   way out: the model cannot ask a question that is not on this list.

   WHAT WAS REJECTED, and why it matters more than what was built.

   Text-to-SQL. The model writes a query, the server runs it. It is the
   obvious design, it demos well, and it is indefensible in a quality
   system: an unbounded query surface against records that are legal
   evidence, with the model's output as the only thing standing between a
   question and the database. No amount of statement parsing makes that a
   control. It is not implemented here and should not be.

   A generic PostgREST passthrough. Marginally better and still wrong: the
   filter grammar is expressive enough to be an injection surface, and
   `select=*` on the wrong relation is a data leak rather than a bug.

   So: named tools. Each is one relation, one fixed column list, a small
   number of validated parameters, and a hard row cap. Adding a capability
   means adding an entry here, in a diff someone reads.

   ROW LEVEL SECURITY IS STILL THE REAL CONTROL. Every query runs through
   PostgREST with the signed-in inspector's own token, so the chatbot can
   never see a row that person could not open in the application. This
   list narrows what is asked for; RLS decides what comes back. If the two
   ever disagree, RLS wins, which is the correct way round.

   READ ONLY. There is no write tool and there must never be one. The
   assistant may be wrong in conversation; it may not be wrong in the
   register.
   ===================================================================== */

/* Rows per call. Small on purpose: the answer to "how many NCRs are open"
   is a count, not 400 rows, and an assistant that pulls the register into
   its context to count it is both expensive and worse at counting than
   the database. Where a total matters the tool asks PostgREST for an
   exact count and returns that alongside the sample. */
const MAX_ROWS = 25;
const MAX_ROUNDS = 4;      // tool calls per question, then it must answer

const str = (v, max) => typeof v === "string" && v.trim() ? v.trim().slice(0, max || 60) : null;
const int = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : null;
};
/* Returns null when nothing was supplied, false when something invalid
   was. The caller must distinguish them: silently defaulting an
   unrecognised value is how `status=open` became a confident "0 open
   NCRs" when the register held one at a different stage. A refusal the
   model reports honestly beats a number that is wrong. */
const oneOf = (v, list) => v === undefined || v === null ? null : (list.includes(v) ? v : false);
/* YYYY-MM only. A free-text date is a filter grammar in disguise. */
const month = v => (typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)) ? v : null;

const SEVERITY = ["minor", "major", "critical"];

/* Derived by the ncr_status trigger, not an enum, and it is a LADDER
   rather than a set of states:
       open -> contained -> cause_identified -> action_agreed
            -> action_done -> verified -> closed
   `open` therefore means "nothing done yet", NOT "not closed". Reading it
   as the latter is the mistake this tool made on its first outing: it
   filtered status=eq.open against a register whose only outstanding
   record sat at `contained`, and reported zero with complete confidence.
   Anyone asking "how many are open" means "how many are not closed", so
   that is the default, and the ladder is spelled out to the model. */
const NCR_STATUS = ["open", "contained", "cause_identified", "action_agreed",
                    "action_done", "verified", "closed"];
const INSP_STATUS = ["scheduled", "in_progress"];

/* Each tool: what the model is told it does, what it may pass, and how
   that becomes exactly one PostgREST request. `count` asks for an exact
   total in the Content-Range header.

   EVERY COLUMN NAMED BELOW IS ASSERTED AGAINST THE MIGRATIONS by
   test-chat.js. The first version of this file was written from memory
   and got four column names wrong on the very first tool — raised_on for
   raised_at, part for part_description, part_number for part_no, and a
   summary column that does not exist. PostgREST rejects the whole select,
   so the tool returned nothing and the model told the inspector the
   lookup had failed. Worse, `repeat_parts` was pointed at v_ncr_repeat,
   which is causes by month and not parts at all — a mislabelled tool is
   more dangerous than a broken one, because the answer comes back
   confident and wrong. */
const TOOLS = {
  open_ncrs: {
    description:
      "Nonconformance reports, most recently raised first, with a total count. " +
      "Status is a progression, not a set of states: open (nothing done yet), contained, " +
      "cause_identified, action_agreed, action_done, verified, closed. " +
      "IMPORTANT: 'open' means only the first rung. Anything not yet closed is 'outstanding', " +
      "which is what someone means when they ask how many are open — leave status unset for that.",
    params: {
      status:   { type: "string", enum: NCR_STATUS,
                  description: "One specific rung. Omit for everything not closed." },
      severity: { type: "string", enum: SEVERITY },
      limit:    { type: "integer", description: `1 to ${MAX_ROWS}, default 10.` }
    },
    build(a) {
      const q = ["select=ref,raised_at,severity,status,disposition,part_description,part_no,department,project_code,supplier,root_cause,age_days,actions_open"];
      const st = oneOf(a.status, NCR_STATUS);
      if (st === false) return null;                 // asked for a rung that does not exist
      q.push(st ? `status=eq.${st}` : "status=neq.closed");
      const sev = oneOf(a.severity, SEVERITY);
      if (sev === false) return null;
      if (sev) q.push(`severity=eq.${sev}`);
      q.push("order=raised_at.desc", `limit=${int(a.limit, 1, MAX_ROWS) || 10}`);
      return { path: `v_ncr_list?${q.join("&")}`, count: true };
    }
  },

  ncr_by_ref: {
    description: "One nonconformance report in full, by its reference such as NCR-26-0031.",
    params: { ref: { type: "string", description: "The NCR reference." } },
    build(a) {
      const ref = str(a.ref, 32);
      if (!ref) return null;
      return { path: `v_ncr_list?select=*&ref=eq.${encodeURIComponent(ref)}&limit=1` };
    }
  },

  ncr_by_cause: {
    description: "Nonconformances grouped by root cause and month, with how many are still open and what they have cost. Use this for 'what causes most of our nonconformance'.",
    params: { limit: { type: "integer", description: `1 to ${MAX_ROWS}, default 15.` } },
    build(a) {
      return { path: `v_ncr_repeat?select=period,cause,category,ncrs,cost,still_open&order=ncrs.desc&limit=${int(a.limit, 1, MAX_ROWS) || 15}` };
    }
  },

  ncr_by_department: {
    description: "Nonconformance counts and costs grouped by the department held responsible, by month.",
    params: {},
    build() { return { path: `v_ncr_by_department?select=department,period,ncrs,cost,still_open&order=ncrs.desc&limit=${MAX_ROWS}` }; }
  },

  faults_by_project: {
    description: "Faults recorded per project and defect category for a given month, and how many are still outstanding.",
    params: { period: { type: "string", description: "Month as YYYY-MM. Defaults to this month." } },
    build(a) {
      const p = month(a.period) || new Date().toISOString().slice(0, 7);
      return { path: `v_faults_by_project?select=period,project_code,project_name,category,faults,outstanding&period=eq.${p}-01&limit=${MAX_ROWS}` };
    }
  },

  defect_pareto: {
    description: "Defect codes ordered by how many faults each accounts for. Use this for 'what goes wrong most often'.",
    params: { limit: { type: "integer", description: `1 to ${MAX_ROWS}, default 10.` } },
    build(a) {
      return { path: `v_defect_pareto?select=code,defect,occurrences,units_affected,awaiting&limit=${int(a.limit, 1, MAX_ROWS) || 10}` };
    }
  },

  actions_for_cause: {
    description:
      "Corrective actions this division has ALREADY RECORDED under a given root cause, with who owned " +
      "them, whether they were verified, and whether the same part came back afterwards. " +
      "Use this when asked what has been done before about a kind of problem. " +
      "It is history, not advice: report what is here and do not propose an action of your own. " +
      "recurred_on_same_part above zero means the part returned under the same cause after that action " +
      "was signed off, which is worth pointing out plainly.",
    params: {
      cause: { type: "string", description: "The root cause exactly as named in the register, e.g. 'Poor workmanship'." },
      limit: { type: "integer", description: `1 to ${MAX_ROWS}, default 15.` }
    },
    build(a) {
      const q = ["select=cause,category,ncr_ref,part_description,part_no,raised_on,severity,action,owner,due_date,done_on,verified_on,verified,recurred_on_same_part"];
      const c = str(a.cause, 80);
      /* An exact match on the cause name. The catalogue does not offer a
         free-text search: `like` with a model-supplied pattern is a
         filter grammar handed to the model, which is the thing this file
         exists to avoid. */
      if (c) q.push(`cause=eq.${encodeURIComponent(c)}`);
      q.push("order=raised_on.desc", `limit=${int(a.limit, 1, MAX_ROWS) || 15}`);
      return { path: `v_ncr_actions_by_cause?${q.join("&")}`, count: true };
    }
  },

  open_inspections: {
    description: "Inspections still to be done — scheduled or in progress. Filter by status. This does not include completed or cancelled ones.",
    params: {
      status: { type: "string", enum: INSP_STATUS },
      limit:  { type: "integer", description: `1 to ${MAX_ROWS}, default 10.` }
    },
    build(a) {
      const q = ["select=ref,status,stage_name,unit_ref,planned_date,inspector"];
      const st = oneOf(a.status, INSP_STATUS);
      if (st === false) return null;
      if (st) q.push(`status=eq.${st}`);
      q.push("order=planned_date.asc", `limit=${int(a.limit, 1, MAX_ROWS) || 10}`);
      return { path: `v_open_work?${q.join("&")}`, count: true };
    }
  }
};

/* The shape sent to the model. Generated from the catalogue rather than
   written twice: a description that has drifted from what the tool
   actually does is how a model ends up confidently answering from the
   wrong relation. */
function toolSchemas() {
  return Object.entries(TOOLS).map(([name, t]) => {
    const properties = {};
    for (const [k, v] of Object.entries(t.params)) {
      properties[k] = v.enum
        ? { type: v.type, enum: v.enum, description: v.description || "" }
        : { type: v.type, description: v.description || "" };
    }
    return { name, description: t.description, input_schema: { type: "object", properties, required: [] } };
  });
}

/* Returns { path, count } or null. Null means the model asked for
   something the catalogue does not offer, or omitted a required
   parameter — either way the answer is a refusal, not an attempt. */
function plan(name, args) {
  const t = Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
  if (!t) return null;
  if (!args || typeof args !== "object" || Array.isArray(args)) args = {};
  /* Unknown keys are dropped rather than passed through. A parameter the
     catalogue does not name cannot reach the query string. */
  const clean = {};
  for (const k of Object.keys(t.params)) if (k in args) clean[k] = args[k];
  try { return t.build(clean); } catch { return null; }
}

module.exports = { TOOLS, MAX_ROWS, MAX_ROUNDS, toolSchemas, plan };
