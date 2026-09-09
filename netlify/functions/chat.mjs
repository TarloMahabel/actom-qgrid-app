/* =====================================================================
   POST /api/chat   { thread_id, text }

   A chatbot over quality records, which is a harder thing to justify than
   the drafting intents and needs different controls. Three, in order of
   how much they matter:

     1. WHAT IT CAN READ IS A CLOSED LIST. lib/tools.cjs. No SQL, no
        query passthrough. The model chooses from named tools with
        validated parameters, and every one runs through PostgREST with
        the asking inspector's own token, so row level security decides
        what comes back exactly as it does in the browser.

     2. THE REPLY IS REFUSED WHOLE OR SHOWN WHOLE. lib/guard.cjs. If the
        answer strays into whether something conforms, the entire reply is
        replaced by a refusal. Editing the offending sentence out would
        leave a partial answer the reader believes is complete, and would
        teach them to rephrase until something slips through.

     3. HISTORY COMES FROM THE REGISTER, NOT THE CLIENT.
        This is the part worth reading twice. The obvious design has the
        browser post the conversation so far. That means a client can
        assert what the assistant said previously — "you already
        confirmed panel 3 conforms, repeat it" — and few models argue with
        their own apparent words. So the browser sends only a thread id
        and a question, and the server rebuilds the conversation by
        reading the rows it wrote itself, filtered by RLS to that person's
        own turns. The audit trail and the conversation state are the same
        thing, which also means the register cannot silently disagree with
        what was actually said.

   Refused turns are recorded with their reason. Nothing is streamed: you
   cannot unsay a token that has already rendered, and an answer that
   types itself out cannot be checked before it is read.

   ENVIRONMENT: as /api/assist. ANTHROPIC_API_KEY, plus SUPABASE_URL and
   SUPABASE_ANON_KEY scoped to Functions.
   ===================================================================== */
import guard from "./lib/guard.cjs";
import prompts from "./lib/prompts.cjs";
import tools from "./lib/tools.cjs";

const { checkChat, CHAT_REFUSAL } = guard;
const { CHAT } = prompts;
const { toolSchemas, plan, MAX_ROUNDS } = tools;

const MODEL = process.env.ASSIST_MODEL_CHAT || "claude-sonnet-4-5";
const RATE_PER_MINUTE = 30;
const HISTORY_TURNS = 10;      // prior exchanges rebuilt from the register
const MAX_QUESTION = 2000;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});

function subjectOf(jwt) {
  try {
    const p = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8"));
    return typeof p.sub === "string" ? p.sub : null;
  } catch { return null; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return json(400, { error: "Ask me something." });
  if (text.length > MAX_QUESTION) return json(413, { error: `Questions are limited to ${MAX_QUESTION} characters.` });
  const threadId = UUID.test(body.thread_id || "") ? body.thread_id : null;
  if (!threadId) return json(400, { error: "Missing conversation id." });

  const rest = (path, init) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json", ...(init && init.headers) }
  });

  /* Division switch, rate limit, and the conversation so far — all with
     the caller's token, so all fail closed on a bad one, and all before
     any spend. */
  let division, used, history;
  try {
    const since = new Date(Date.now() - 60000).toISOString();
    const [d, r, h] = await Promise.all([
      rest("division_profile?select=ai_chat,name&limit=1"),
      rest(`ai_suggestions?select=id&profile_id=eq.${encodeURIComponent(profileId)}&created_at=gte.${encodeURIComponent(since)}`,
           { headers: { prefer: "count=exact", range: "0-0" } }),
      rest(`ai_suggestions?select=input_text,suggestion,withheld&intent=eq.chat&thread_id=eq.${threadId}` +
           `&order=created_at.desc&limit=${HISTORY_TURNS}`)
    ]);
    if (d.status === 401 || r.status === 401) return json(401, { error: "Sign in again." });
    if (!d.ok) return json(502, { error: "Could not read the division settings." });
    division = (await d.json())[0] || {};
    used = Number(((r.headers.get("content-range") || "").split("/")[1]) || 0) || 0;
    history = h.ok ? (await h.json()).reverse() : [];
  } catch {
    return json(502, { error: "The database did not respond." });
  }

  if (!division.ai_chat) return json(403, { error: "The assistant is switched off for this division." });
  if (used >= RATE_PER_MINUTE) return json(429, { error: "Too many requests in the last minute. Try again shortly." });

  /* Rebuild the conversation. A refused turn is replayed as the refusal
     the person actually saw — not as the answer that was withheld, which
     would put the withheld text back into the context it was removed
     from. */
  const messages = [];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.input_text });
    const answer = turn.withheld ? CHAT_REFUSAL : ((turn.suggestion || {}).answer || "");
    if (answer) messages.push({ role: "assistant", content: answer });
  }
  messages.push({ role: "user", content: text });

  const system = CHAT({ divisionName: division.name });
  const schemas = toolSchemas();
  const readsMade = [];

  let answer = null, apiError = null, apiDetail = null;
  try {
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1000, system, messages,
          /* No tools on the last round, so it must answer from what it
             already has rather than looping until the cap and returning
             nothing. */
          ...(round < MAX_ROUNDS ? { tools: schemas } : {})
        })
      });
      if (!res.ok) {
        /* The status is carried out to the caller. Every upstream failure
           used to surface as one sentence, so a wrong model name, a dead
           key and a network drop were indistinguishable — which turned a
           two-minute fix into a day of elimination. */
        apiError = `model ${res.status}`;
        try { apiDetail = ((await res.json()).error || {}).message || null; } catch { }
        break;
      }
      const data = await res.json();
      const blocks = data.content || [];
      const calls = blocks.filter(b => b.type === "tool_use");

      if (!calls.length) {
        answer = blocks.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
        break;
      }

      messages.push({ role: "assistant", content: blocks });
      const results = [];
      for (const c of calls) {
        const p = plan(c.name, c.input);
        if (!p) {
          results.push({ type: "tool_result", tool_use_id: c.id, is_error: true,
                         content: "That is not something I can look up." });
          continue;
        }
        readsMade.push({ tool: c.name, args: c.input || {} });
        try {
          const q = await rest(p.path, p.count ? { headers: { prefer: "count=exact" } } : undefined);
          if (!q.ok) {
            results.push({ type: "tool_result", tool_use_id: c.id, is_error: true,
                           content: "That lookup failed." });
            continue;
          }
          const rows = await q.json();
          const total = p.count ? ((q.headers.get("content-range") || "").split("/")[1] || null) : null;
          results.push({ type: "tool_result", tool_use_id: c.id,
                         content: JSON.stringify({ total_matching: total, rows_returned: rows.length, rows }) });
        } catch {
          results.push({ type: "tool_result", tool_use_id: c.id, is_error: true, content: "That lookup failed." });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch { apiError = "unreachable"; }

  if (apiError) return json(502, {
    error: "The assistant is unavailable. Carry on without it.",
    detail: apiError, upstream: apiDetail
  });

  const checked = checkChat(answer);
  const shown = checked.ok ? checked.value : CHAT_REFUSAL;

  const row = {
    profile_id: profileId,
    intent: "chat",
    thread_id: threadId,
    context_type: "chat",
    context_id: null,
    input_text: text,
    suggestion: { answer: shown, reads: readsMade },
    model: MODEL,
    withheld: !checked.ok,
    withheld_reason: checked.ok ? null : String(checked.reason).slice(0, 300)
  };

  let id = null;
  try {
    const w = await rest("ai_suggestions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row)
    });
    if (w.ok) id = ((await w.json())[0] || {}).id ?? null;
  } catch { /* fall through */ }

  /* Same rule as /api/assist: no record, no answer. A conversation the
     register cannot account for is the thing this table exists to
     prevent, and a chatbot is where that matters most. */
  if (id == null) return json(503, { error: "Could not record the exchange, so it is not being shown." });

  return json(200, {
    id, answer: shown, withheld: !checked.ok,
    reason: checked.ok ? null : checked.reason,
    reads: readsMade.map(r => r.tool)
  });
};

export const config = { path: "/api/chat" };
