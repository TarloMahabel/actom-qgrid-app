/* =====================================================================
   POST /api/assist

   The only server-side code in this project. It exists for three reasons,
   in order of how much they matter:

     1. THE API KEY STAYS OFF THE TABLET. The browser never sees it. A key
        shipped to the client is a key on every shop-floor device and in
        every browser cache, and it cannot be rotated without a deploy.

     2. EVERY SUGGESTION IS AUDITED BEFORE IT IS SHOWN. Not after it is
        accepted — before it is displayed. What an inspector was offered is
        part of the record even when they ignored it, because "the system
        suggested X and the inspector wrote Y" is a question an auditor is
        entitled to ask and the answer must not depend on what happened next.

     3. THE CONFORMANCE BOUNDARY IS ENFORCED SOMEWHERE THE USER CANNOT
        REACH. See lib/guard.cjs. A check in the browser is a suggestion
        to the browser.

   WHAT THIS DELIBERATELY DOES NOT HAVE

   No service role key. The caller's own JWT is used for every database
   operation, so row level security applies exactly as it does everywhere
   else and this function has no privilege the signed-in user lacks. A
   service key here would be a key that bypasses every policy in the
   database, sitting in an environment variable, to save one join.

   ENVIRONMENT, per division site
     ANTHROPIC_API_KEY     required. Scope it to Functions, not Builds.
     SUPABASE_URL          already set for the build; must ALSO be scoped
     SUPABASE_ANON_KEY     to Functions or this returns 500 on every call.
     ASSIST_MODEL_FAST     optional override
     ASSIST_MODEL_CAREFUL  optional override
   ===================================================================== */
import guard from "./lib/guard.cjs";
import prompts from "./lib/prompts.cjs";

const { INTENTS, LIMITS, validate, parseJson } = guard;
const { systemFor, userFor, SPEC } = prompts;

const MODELS = {
  haiku:  process.env.ASSIST_MODEL_FAST    || "claude-haiku-4-5-20251001",
  sonnet: process.env.ASSIST_MODEL_CAREFUL || "claude-sonnet-5"
};

/* Per person, per minute. Generous for typing, mean enough that a runaway
   loop on one tablet cannot spend the division's budget overnight. The
   window is counted in the audit table rather than in memory, because
   there is no shared memory between function instances and an in-process
   counter would reset on every cold start. */
const RATE_PER_MINUTE = 30;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});

/* The sub claim, read without verifying. Safe only because it is used for
   nothing but a rate-limit lookup, and every database call below is made
   with the token itself — PostgREST verifies it, and a forged token fails
   there, before the model is ever called. */
function subjectOf(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8"));
    return typeof p.sub === "string" ? p.sub : null;
  } catch { return null; }
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const ANON = process.env.SUPABASE_ANON_KEY;
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!SUPABASE_URL || !ANON) return json(500, { error: "SUPABASE_URL and SUPABASE_ANON_KEY must be scoped to Functions on this site." });
  if (!KEY) return json(503, { error: "Assistance is not configured for this division." });

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const profileId = token && subjectOf(token);
  if (!profileId) return json(401, { error: "Sign in again." });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Malformed request." }); }

  const intent = body && body.intent;
  if (!INTENTS.includes(intent)) return json(400, { error: "Unknown intent." });

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "Nothing to work on." });
  if (text.length > LIMITS.input) return json(413, { error: `Text is longer than ${LIMITS.input} characters.` });

  const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init && init.headers) }
  });

  /* Both of these are made with the caller's token, so both fail closed on
     a bad one — and both happen before any spend. Run together: the
     inspector is waiting with a cursor in a field. */
  let division, used;
  try {
    const since = new Date(Date.now() - 60000).toISOString();
    const [d, r] = await Promise.all([
      rest("division_profile?select=ai_assist,name&limit=1"),
      rest(`ai_suggestions?select=id&profile_id=eq.${encodeURIComponent(profileId)}&created_at=gte.${encodeURIComponent(since)}`,
           { headers: { prefer: "count=exact", range: "0-0" } })
    ]);
    if (d.status === 401 || r.status === 401) return json(401, { error: "Sign in again." });
    if (!d.ok) return json(502, { error: "Could not read the division settings." });
    division = (await d.json())[0] || {};
    const cr = r.headers.get("content-range") || "";
    used = Number((cr.split("/")[1] || "0")) || 0;
  } catch {
    return json(502, { error: "The database did not respond." });
  }

  if (!division.ai_assist) return json(403, { error: "Assistance is switched off for this division." });
  if (used >= RATE_PER_MINUTE) return json(429, { error: "Too many requests in the last minute. Try again shortly." });

  const spec = SPEC[intent];
  const model = MODELS[spec.model];

  let raw;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: systemFor(intent, { divisionName: division.name }),
        messages: [{ role: "user", content: userFor(intent, { ...body, text }) }]
      })
    });
    if (!res.ok) return json(502, { error: "The assistant is unavailable. Carry on without it." });
    const data = await res.json();
    raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  } catch {
    return json(502, { error: "The assistant is unavailable. Carry on without it." });
  }

  const parsed = parseJson(raw);
  if (!parsed) return json(422, { error: "The assistant did not answer usefully. Carry on without it." });

  const checked = validate(intent, parsed, { input: text, codes: body.codes, ids: (body.faults || []).map(f => f.id) });

  /* A rejected suggestion is recorded too, with the reason. A boundary
     that fires silently cannot be shown to be working, and "how often does
     it fire, and on what" is the first question anyone will ask about it. */
  const row = {
    profile_id:   profileId,
    intent,
    context_type: typeof body.context_type === "string" ? body.context_type.slice(0, 40) : null,
    context_id:   body.context_id == null ? null : String(body.context_id).slice(0, 64),
    input_text:   text,
    suggestion:   checked.ok ? checked.value : {},
    model,
    withheld:     !checked.ok,
    withheld_reason: checked.ok ? null : String(checked.reason).slice(0, 300)
  };

  let id = null;
  try {
    const w = await rest("ai_suggestions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row)
    });
    if (w.ok) id = ((await w.json())[0] || {}).id ?? null;
  } catch { /* fall through */ }

  /* No audit row, no suggestion. This is the one failure that must not
     degrade gracefully: showing an inspector something the record does not
     contain is exactly the gap the audit table exists to close. */
  if (id == null) return json(503, { error: "Could not record the suggestion, so it is not being shown." });

  if (!checked.ok) return json(200, { id, intent, withheld: true, reason: checked.reason, suggestion: null });
  return json(200, { id, intent, withheld: false, suggestion: checked.value });
};

export const config = { path: "/api/assist" };
