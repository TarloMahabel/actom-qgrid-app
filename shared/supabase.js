/* =====================================================================
   ACTOM Grid — Supabase client.

   A plain script, not an ES module, and it uses the client vendored at
   vendor/supabase.js rather than fetching one from a CDN. Two reasons
   that matter:

     1. The Content-Security-Policy can be script-src 'self' with no
        external origins at all. Nothing on the shop floor loads code
        from the internet.
     2. The client version is pinned in the repository. A CDN can change
        what it serves under the same URL; a committed file cannot.

   Edit HERE, then run ./shared/sync.sh.
   ===================================================================== */
(function () {
  'use strict';

  var cfg = window.GRID_CONFIG;

  if (!cfg || !cfg.url || !cfg.key) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML =
        '<div style="font:15px system-ui;padding:40px;max-width:560px;margin:0 auto">' +
        '<h2>This site is not configured</h2><p>config.js is missing or incomplete, so Grid ' +
        'cannot reach its database. The Netlify build generates that file from the site ' +
        'environment variables — check SUPABASE_URL and SUPABASE_ANON_KEY are set, then ' +
        'redeploy.</p></div>';
    });
    throw new Error('GRID_CONFIG missing');
  }
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error('vendor/supabase.js did not load before supabase.js');
  }

  var client = window.supabase.createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  /* Signs in through the ACTOM Entra tenant. */
  async function signIn() {
    var res = await client.auth.signInWithOAuth({
      provider: 'azure',
      options: { scopes: 'openid profile email', redirectTo: window.location.origin }
    });
    if (res.error) throw res.error;
  }

  /* Local development only. Lets the data layer be proved before the Entra
     app registration exists. The button that calls this renders only when
     BUILD.context === 'local', and Netlify always sets CONTEXT, so it
     cannot appear on a deployed site. */
  async function signInWithPassword(email, password) {
    var res = await client.auth.signInWithPassword({ email: email, password: password });
    if (res.error) throw res.error;
  }

  async function signOutNow() {
    await client.auth.signOut();
    location.reload();
  }

  /* Returns the signed-in user's profile, or null.
     A new user exists in auth but is inactive until an administrator
     activates them, so an authenticated session is not by itself access. */
  async function currentProfile() {
    var u = await client.auth.getUser();
    var user = u && u.data && u.data.user;
    if (!user) return null;
    var res = await client.from('profiles')
      .select('*, department:departments(name)')
      .eq('id', user.id).maybeSingle();
    if (res.error) throw res.error;
    return res.data;
  }

  /* Turns a Postgres error into something an inspector can act on. The
     database raises these codes from its own triggers, so the wording is
     the same whether the block came from the browser or the API. */
  function explain(error) {
    var m = (error && error.message) || '';
    if (m.indexOf('INS_SIGNED') > -1)
      return 'This inspection is signed and cannot be changed. Create an amendment instead.';
    if (m.indexOf('EQUIP_BLOCKED') > -1)
      return 'That instrument is out of calibration. Choose another, or have it recalled before recording a result.';
    if (m.indexOf('COMPETENCY') > -1)
      return 'You do not hold the competency level this inspection requires. Ask a qualified colleague to sign it off.';
    if (m.indexOf('SUBMIT_INCOMPLETE') > -1)
      return 'Not finished yet — ' + m.split('SUBMIT_INCOMPLETE:')[1].trim();
    if (m.indexOf('SUBMIT_OWNER') > -1)
      return 'This inspection is assigned to someone else.';
    if (m.indexOf('PUBLISH_SELF') > -1)
      return 'A template cannot be published by the person who built it. Ask another Quality Manager to approve it.';
    if (m.indexOf('PUBLISH_ROLE') > -1)
      return 'Only a Quality Manager may publish a template.';
    if (m.indexOf('GEN_ROLE') > -1)
      return 'You do not have permission to generate a schedule.';
    if ((error && error.code) === '42501' || m.indexOf('row-level security') > -1)
      return 'You do not have access to that record.';
    if ((error && error.code) === '23505')
      return 'That already exists — the code or name has to be unique.';
    if ((error && error.code) === '23503')
      return 'Still in use. Something references this entry, so it cannot be deleted. ' +
             'Retire it instead: that hides it from new forms and keeps historic records readable.';
    if ((error && error.code) === '23502')
      return 'A required field is empty.';
    return m || 'Something went wrong. Try again, and tell IT if it keeps happening.';
  }

  window.GRID = {
    supabase: client,
    DIVISION: cfg.division || { code: '', name: '' },
    BUILD: cfg.build || { commit: 'local', context: 'local' },
    signIn: signIn,
    signInWithPassword: signInWithPassword,
    signOutNow: signOutNow,
    currentProfile: currentProfile,
    explain: explain
  };
})();
