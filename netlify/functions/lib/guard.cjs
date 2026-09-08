/* =====================================================================
   The conformance boundary.

   THIS FILE IS THE CONTROL. The system prompt asks the model not to decide
   whether something conforms; this file is what stops it. A prompt is a
   request, and a request is not a control — an ISO 9001 quality system
   cannot rest an acceptance decision on one, and neither can we.

   Nothing here is about the model being unreliable. Even a model that
   followed instructions perfectly would be the wrong thing to ask: clause
   8.5.1 puts the determination with a competent, identified person, and a
   suggestion that reads like a verdict invites an inspector to defer to it.
   The suggestion is a draft for a human to accept, always.

   Two layers, in this order:

     1. STRUCTURE.  Every intent declares the exact shape of its answer,
        and anything the model can name — a defect code, a fault id — is
        checked against the list the request supplied. A code that was not
        offered cannot come back. This is the strong layer: it makes a
        whole class of wrong answer unrepresentable rather than detected.

     2. LANGUAGE.  What free text remains is scanned for verdict phrasing.
        This is the weak layer, a backstop, and it is written to be
        over-eager: a suggestion wrongly withheld costs a few seconds, a
        verdict wrongly shown is a finding.

   Required reading before changing anything here: test-assist.js. Every
   pattern below has a case, and several are phrasings a real model
   produced when the adversarial suite asked it to grade a panel.
   ===================================================================== */

const INTENTS = ["spell", "defect_code", "ncr_draft", "similar_faults", "explain_check"];

/* Hard caps. A spelling correction is a word; an explanation is a
   paragraph. Anything wildly outside that is not the answer to the
   question asked, whatever it says. */
const LIMITS = {
  input:        4000,   // characters of user text accepted per request
  freeText:     1200,   // characters of model prose accepted per field
  corrections:    25,
  suggestions:     5,
  matches:         5,
  bullets:         8
};

/* ---------------------------------------------------------------------
   Verdict phrasing.

   Tuned against real engineering language, because the naive version was
   unusable. "Failure" is not a verdict — "bearing failure" is a root
   cause and appears in almost every NCR. "Pass" is not a verdict —
   "busbar passes through the gland plate" is a description of geometry.
   What matters is a judgement APPLIED TO the thing being inspected.
   --------------------------------------------------------------------- */
const SUBJECT = "(?:this|the|that)\\s+(?:\\w+\\s+){0,2}" +
  "(?:panel|cubicle|inspection|check|item|unit|assembly|busbar|spouts?|shutters?|component|part|weld|joint|termination)";

const VERDICT_PATTERNS = [
  /* "the panel passes", "this check has failed", "that unit did not pass".
     Two exclusions, both learned from real fault notes:
       "the busbar passes THROUGH the gland plate" is geometry, so a
       preposition after the verb means it is not a verdict; and
       "the shutter failed TO RETURN" is a mechanism describing itself,
       whereas "failed to meet" is a judgement and stays caught below. */
  [new RegExp(`\\b${SUBJECT}\\s+(?:has\\s+|had\\s+|did\\s+not\\s+|does\\s+not\\s+|is\\s+)?` +
              `(?:pass(?:es|ed)?|fail(?:s|ed)?)\\b` +
              `(?!\\s+(?:through|thru|over|under|underneath|behind|between|across|along|via|into|inside|out\\s+of|down|up|past|beside|near))` +
              `(?!\\s+to\\s+(?!meet|comply|satisfy|conform|achieve))`, "i"),
   "a pass/fail verdict on the item"],
  // "this is acceptable", "the panel is non-conforming", "it is within tolerance"
  [/\b(?:this|that|it|the|these|those)(?:\s+\w+){0,2}\s+(?:is|are|was|were|appears?\s+to\s+be|looks?)\s+(?:not\s+)?(?:acceptable|unacceptable|satisfactory|unsatisfactory|compliant|non-?compliant|conforming|non-?conforming|in\s+conformance|out\s+of\s+(?:spec|specification|tolerance)|within\s+(?:spec|specification|tolerance))\b/i,
   "a conformance judgement"],
  // "meets the requirement", "does not satisfy the specification"
  [/\b(?:meets?|satisfies|complies\s+with|conforms\s+to|does\s+not\s+meet|fails\s+to\s+meet|does\s+not\s+satisfy|does\s+not\s+comply|fails\s+to\s+comply)\s+(?:with\s+)?(?:the\s+|this\s+|all\s+|any\s+)?(?:requirement|specification|spec|standard|criteria|criterion|clause|tolerance)/i,
   "an assertion about meeting a requirement"],
  // "mark as pass", "record this as failed", "set the result to fail"
  [/\b(?:mark|record|set|log|enter|tick|flag)\s+(?:it|this|that|the\s+\w+)?\s*(?:as|to)\s+(?:a\s+)?(?:pass|fail|passed|failed|conforming|non-?conforming|acceptable)\b/i,
   "an instruction to record a result"],
  // "you should reject", "I recommend accepting this", "reject the panel"
  [/\b(?:should|must|recommend|advise|suggest)\s+(?:that\s+)?(?:you\s+|we\s+)?(?:be\s+)?(?:accept|reject|pass|fail)(?:ed|ing|s)?\b/i,
   "a recommendation to accept or reject"],
  [new RegExp(`\\b(?:accept|reject)\\s+${SUBJECT}\\b`, "i"), "an instruction to accept or reject the item"],
  // Bare verdict tokens: "PASS", "FAIL", "Result: fail", "Verdict: pass"
  [/(?:^|[\s:;,\-–—(])(?:PASS|FAIL|PASSED|FAILED)(?:$|[\s.:;,)!])/,
   "a bare PASS/FAIL token"],
  [/\b(?:verdict|determination|disposition|judgement|judgment|ruling)\s*(?:is|:|=)/i,
   "a stated verdict"],
  // Numeric grading invites the same deference a verdict does.
  [/\b(?:conformance|compliance|quality)\s+(?:score|rating|grade)\b/i,
   "a conformance score"]
];

/* Applied to explain_check only, which is the intent closest to the line:
   it explains what a requirement is asking for, and must stop there. */
const EXPLAIN_EXTRA = [
  [/\b(?:if|when|where)\b[^.]{0,80}\b(?:then\s+)?(?:it\s+)?(?:passes|fails|is\s+a\s+fail|is\s+a\s+pass)\b/i,
   "a pass/fail rule"],
  [/\b(?:criteria|threshold|limit)\s+for\s+(?:a\s+)?(?:pass|fail|acceptance|rejection)\b/i,
   "stated acceptance criteria"]
];

function verdictHit(text, extra) {
  if (typeof text !== "string" || !text) return null;
  for (const [re, why] of VERDICT_PATTERNS) if (re.test(text)) return why;
  if (extra) for (const [re, why] of extra) if (re.test(text)) return why;
  return null;
}

/* ------------------------------------------------------------------ */

const fail = reason => ({ ok: false, reason });
const isStr = v => typeof v === "string";
const clean = v => isStr(v) ? v.replace(/\s+/g, " ").trim() : "";

function checkProse(value, label, extra) {
  const t = clean(value);
  if (!t) return fail(`${label} was empty`);
  if (t.length > LIMITS.freeText) return fail(`${label} was ${t.length} characters, over the ${LIMITS.freeText} limit`);
  const hit = verdictHit(t, extra);
  if (hit) return fail(`${label} contained ${hit}`);
  return { ok: true, value: t };
}

/* A correction is a word, not a sentence. Without this the spell intent is
   an open channel for arbitrary prose: ask for a spelling fix and get back
   a paragraph in the `to` field. Every `from` must also genuinely occur in
   what the user typed, so a correction cannot introduce a word that was
   never there. */
const WORDLIKE = /^[\p{L}\p{N}][\p{L}\p{N}'’\-./]{0,39}$/u;

function validate(intent, data, ctx) {
  ctx = ctx || {};
  if (!INTENTS.includes(intent)) return fail(`unknown intent ${intent}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) return fail("the model did not return an object");

  if (intent === "spell") {
    if (!Array.isArray(data.corrections)) return fail("corrections was not an array");
    if (data.corrections.length > LIMITS.corrections) return fail("too many corrections");
    const source = (ctx.input || "").toLowerCase();
    const out = [];
    for (const c of data.corrections) {
      if (!c || !isStr(c.from) || !isStr(c.to)) return fail("a correction was malformed");
      const from = c.from.trim(), to = c.to.trim();
      if (!WORDLIKE.test(from) || !WORDLIKE.test(to)) return fail(`"${from}" → "${to}" is not a word-level correction`);
      if (from.toLowerCase() === to.toLowerCase()) continue;
      if (!source.includes(from.toLowerCase())) return fail(`"${from}" does not appear in the text`);
      out.push({ from, to });
    }
    return { ok: true, value: { corrections: out } };
  }

  if (intent === "defect_code") {
    if (!Array.isArray(data.suggestions)) return fail("suggestions was not an array");
    const allowed = new Set((ctx.codes || []).map(c => String(c.code)));
    if (!allowed.size) return fail("no defect codes were offered");
    const out = [];
    for (const sgn of data.suggestions.slice(0, LIMITS.suggestions)) {
      if (!sgn || !isStr(sgn.code)) return fail("a suggestion was malformed");
      /* The allowlist is the point. A model that invents a plausible code
         puts an inspector one click from filing a fault against a code
         this division does not use, and the register carries it forever. */
      if (!allowed.has(sgn.code)) return fail(`code "${sgn.code}" was not one of the codes offered`);
      const why = checkProse(sgn.why, "the reason given");
      if (!why.ok) return why;
      const conf = ["high", "medium", "low"].includes(sgn.confidence) ? sgn.confidence : "low";
      out.push({ code: sgn.code, confidence: conf, why: why.value });
    }
    if (!out.length) return fail("no usable suggestions");
    return { ok: true, value: { suggestions: out } };
  }

  if (intent === "ncr_draft") {
    /* An NCR records a nonconformance a person has already decided exists.
       The words "nonconformance" and "defect" are the subject matter here,
       not a verdict — but the draft still may not assert that anything
       passed, failed, or should be rejected. */
    const desc = checkProse(data.description, "the description");
    if (!desc.ok) return desc;
    const cont = data.containment == null || clean(data.containment) === ""
      ? { ok: true, value: "" }
      : checkProse(data.containment, "the containment");
    if (!cont.ok) return cont;
    return { ok: true, value: { description: desc.value, containment: cont.value } };
  }

  if (intent === "similar_faults") {
    if (!Array.isArray(data.matches)) return fail("matches was not an array");
    const allowed = new Set((ctx.ids || []).map(String));
    const out = [];
    for (const m of data.matches.slice(0, LIMITS.matches)) {
      if (!m || m.id == null) return fail("a match was malformed");
      if (!allowed.has(String(m.id))) return fail(`fault ${m.id} was not one of the faults offered`);
      const why = checkProse(m.why, "the reason given");
      if (!why.ok) return why;
      out.push({ id: String(m.id), why: why.value });
    }
    return { ok: true, value: { matches: out } };
  }

  /* explain_check. The riskiest of the five: an inspector asking what a
     requirement means is one sentence away from asking whether the thing
     in front of them satisfies it. It may describe what to look at. It may
     not say what the answer is, and it gets the extra patterns. */
  const ex = checkProse(data.explanation, "the explanation", EXPLAIN_EXTRA);
  if (!ex.ok) return ex;
  const look = [];
  for (const b of (Array.isArray(data.what_to_look_at) ? data.what_to_look_at : []).slice(0, LIMITS.bullets)) {
    const r = checkProse(b, "a point to look at", EXPLAIN_EXTRA);
    if (!r.ok) return r;
    look.push(r.value);
  }
  return { ok: true, value: { explanation: ex.value, what_to_look_at: look } };
}

/* The model is asked for bare JSON. It sometimes wraps it in a fence
   anyway, and a rejected suggestion because of three backticks is a
   support call, not a safety win. */
function parseJson(raw) {
  if (!isStr(raw)) return null;
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(t); } catch { }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

module.exports = { INTENTS, LIMITS, VERDICT_PATTERNS, EXPLAIN_EXTRA, verdictHit, validate, parseJson };
