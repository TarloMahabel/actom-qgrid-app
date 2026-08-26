/**
 * Supabase client for QGrid. One file, no build step, loaded from the CDN
 * exactly as in the other ACTOM internal tools.
 *
 * The client knows which division it belongs to only through config.js,
 * which Netlify generates at deploy time. Nothing division-specific is
 * ever hard-coded here, so this file is byte-identical on all 27 sites.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cfg = window.QGRID_CONFIG;
if (!cfg?.url || !cfg?.key) {
  document.body.innerHTML =
    '<div style="font:15px system-ui;padding:40px;max-width:560px;margin:0 auto">' +
    "<h2>This site is not configured</h2>" +
    "<p>config.js is missing or incomplete, so QGrid cannot reach its database. " +
    "The build generates this file from the Netlify site environment variables — " +
    "check that SUPABASE_URL and SUPABASE_ANON_KEY are set, then redeploy.</p></div>";
  throw new Error("QGRID_CONFIG missing");
}

export const supabase = createClient(cfg.url, cfg.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export const DIVISION = cfg.division;   // { code, name }
export const BUILD = cfg.build;         // { commit, deployedAt, context }

/** Signs the user out and returns to the sign-in gate. */
export async function signOutNow() {
  await supabase.auth.signOut();
  location.reload();
}

/** Signs in through the ACTOM Entra tenant. */
export async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: { scopes: "openid profile email", redirectTo: window.location.origin }
  });
  if (error) throw error;
}

/**
 * Returns the signed-in user's profile, or null.
 * New users exist in auth but are inactive until an administrator
 * activates them, so an authenticated session is not by itself access.
 */
export async function currentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*, department:departments(name)")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Turns a Postgres error into something an inspector can act on.
 * The database raises these codes from its own triggers, so the message
 * is the same whether the block came from the browser or an API call.
 */
export function explain(error) {
  const m = error?.message || "";
  if (m.includes("INS_SIGNED"))
    return "This inspection is signed and cannot be changed. Create an amendment instead.";
  if (m.includes("EQUIP_BLOCKED"))
    return "That instrument is out of calibration. Choose another, or have it recalled before recording a result.";
  if (m.includes("COMPETENCY"))
    return "You do not hold the competency level this inspection requires. Ask a qualified colleague to sign it off.";
  if (m.includes("SUBMIT_INCOMPLETE"))
    return "Not finished yet — " + m.split("SUBMIT_INCOMPLETE:")[1].trim();
  if (m.includes("SUBMIT_OWNER"))
    return "This inspection is assigned to someone else.";
  if (m.includes("PUBLISH_SELF"))
    return "A template cannot be published by the person who built it. Ask another Quality Manager to approve it.";
  if (m.includes("PUBLISH_ROLE"))
    return "Only a Quality Manager may publish a template.";
  if (m.includes("GEN_ROLE"))
    return "You do not have permission to generate a schedule.";
  if (error?.code === "42501" || m.includes("row-level security"))
    return "You do not have access to that record.";
  if (error?.code === "23505")
    return "That record already exists.";
  return m || "Something went wrong. Try again, and tell IT if it keeps happening.";
}
