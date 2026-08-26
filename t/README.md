# Tests

Runs the application against a mocked Supabase in jsdom. Proves the auth gate,
every module and tab, the capture flow (including tolerance-derived failures and
blocked instruments), the form designer, the requirements matrix and administration.

    npm install jsdom
    node t/run.mjs

`app.test.mjs` is generated from app.js with the Supabase import redirected:

    cp app.js t/app.test.mjs && sed -i 's#"./lib/supabase.js?v=1"#"./mock.mjs"#' t/app.test.mjs

What this does NOT prove: RLS policies, triggers, or RPC behaviour. Those need a
real project — see the smoke test in SETUP.md step 7.
