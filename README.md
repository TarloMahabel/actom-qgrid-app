# ACTOM QGrid — Inspections

Quality inspections for ACTOM. Phase 1 of the quality management system:
capture, scheduling, a configurable form designer and the requirements matrix.

Built on the ACTOM internal tool template — vanilla JS/HTML/CSS, no build step,
Supabase backend, Netlify hosting — and on the same repository conventions as the
Apprenticeship Application Portal.

```
netlify.toml           MUST be at the root — Netlify reads it nowhere else
apps/inspect/          the inspection app → one Netlify site PER DIVISION
shared/                source of truth for tokens.css, the client, logo, changelog
shared/sync.sh         copies shared assets into every app — run after editing shared/
db/001…002-*.sql       numbered migrations, applied in order to every division
db/seed.sql            group reference data: stages, departments, defect codes
db/seed-division-*.sql per-division data: product families, equipment, requirements
db/test/               local PostgreSQL harness — RLS, triggers and RPCs
test/harness.js        loads the REAL app from apps/, mocking only the backend
test-*.js              front-end suites (jsdom)
run-tests.mjs          every suite in one command — `npm test`, works on Windows
run-all-tests.sh       the same, for CI on Linux
scripts/               config generation, migrations, drift check, provisioning
divisions/registry.json which divisions exist — metadata only, no secrets
.githooks/pre-commit   blocks secrets, out-of-sync shared assets, CDN imports
test-hook.js           proves the hook fires on real leaks and not on placeholders
test-deploy.js         proves the Netlify config and build produce a working site
test-boot.js           boots with the REAL vendored client — no mock
DEPLOYMENT.md          step-by-step runbook — start here
```

Before anything else: `npm install && npm test`. Nine suites, ~157 checks, no network
needed. If they pass, the local copy is sound, and anything that breaks afterwards
is a console problem rather than a code problem.

---

## Two conventions worth understanding before you change anything

### 1. Shared assets are edited in `shared/`, never in `apps/`

There is no build step to resolve a shared import at deploy time, so each app
carries its own physical copy of the stylesheet, the Supabase client, the logo and
the changelog. `./shared/sync.sh` is that build step, run by hand.

Editing `apps/inspect/styles.css` directly appears to work and is then silently
overwritten the next time anyone runs sync. The pre-commit hook blocks a commit
where `shared/` and `apps/` disagree, and `test-security.js` fails on it too.

### 2. The pre-commit hook looks for credential shapes, not keywords

Install it once per clone or it does nothing:

    git config core.hooksPath .githooks

The first version grepped for the word `service_role` and blocked five innocent
files on the very first commit — a placeholder password in `.env.example`, the word
in two documents, and `create role service_role` in the test shim, which is a
legitimate PostgreSQL role name. A guard that cries wolf gets bypassed with
`--no-verify`, and then it protects nothing.

It now looks for the *shape* of a credential: a JWT whose payload claims the
service_role, a key with Supabase's `sb_secret_` prefix, or a connection string
whose password is not obviously a placeholder. `test-hook.js` proves both
directions — that it fires on six real faults, and stays quiet on four
placeholder forms and on this repository as it stands.

### 3. netlify.toml lives at the repository root

Netlify reads `netlify.toml` from the root of the repository and nowhere else,
unless a base directory is set in the site UI. The Apprenticeship Portal keeps one
inside each app, which works because its sites have that field filled in by hand.

The first QGrid deploy served a 404 for exactly this reason: the file was in
`apps/inspect/`, Netlify never read it, published the repository root, found no
`index.html` there and 404'd. One app, one root file, nothing to remember in the UI.

`scripts/gen-config.mjs` now resolves paths from the repository root rather than
`process.cwd()`, so setting a base directory later cannot silently write
`apps/inspect/apps/inspect/config.js` and leave the site unconfigured.
`test-deploy.js` covers both.

### 4. The Supabase client is vendored, not fetched

`apps/inspect/vendor/supabase.js` is supabase-js 2.112.3, committed. Nothing loads
code from the internet at runtime, which buys two things:

- The Content-Security-Policy can be `script-src 'self'` with no external origins.
- The client version is pinned in the repository. A CDN can change what it serves
  under the same URL; a committed file cannot.

To upgrade it, replace `shared/vendor-supabase.js`, run sync, run the suites.

---

## Where this repository deviates from the Apprenticeship Portal

Both follow the same template. One convention is deliberately inverted, and the
reason is the deployment model.

**The Portal commits `apps/*/config.js`. QGrid generates it.**

The Portal has one Supabase project, so its configuration is a fact about the
repository and committing it is the only thing that works without a build step.

QGrid has **one database and one Netlify site per division**, all running the same
commit. A committed `config.js` could only ever name one division's project. So it
is generated per site by `scripts/gen-config.mjs` from four environment variables —
and that is why there is a build command in an otherwise no-build-step project.

The same reasoning applies to the CSP. `netlify.toml` cannot hardcode
`connect-src https://<ref>.supabase.co` because the ref differs per division, and a
wildcard `https://*.supabase.co` would let a compromised page talk to any Supabase
project in the world. So `gen-config.mjs` writes a `_headers` file alongside
`config.js` with `connect-src` pinned to that division's project and nothing else.

---

## The deployment model

```
                    GitHub: TarloMahabel/actom-qgrid-app
                                  │
                  ┌───────────────┼───────────────┐
                  │               │               │
            Netlify MVS     Netlify DTX     Netlify R&M   ← same commit
                  │               │               │          different env vars
            Supabase MVS    Supabase DTX    Supabase R&M ← same migrations
                                                            different data
```

**Differences between divisions are data, never code.** Manufacturing stages,
product families, defect codes, templates, the requirements matrix, whether hold
points are switched on — all rows. The moment a division needs its own branch you
stop having one product and start having 27.

Separate databases mean a bad deploy or a bad query in one division cannot touch
another's records, and a division can be restored to a point in time without
co-ordinating with 26 others. The cost is 27 Supabase projects and a schema change
that has to reach all of them in the right order — which is why
`scripts/verify-drift.mjs` runs nightly.

### Would a second app be worth it?

The Portal splits into `apps/applicant` and `apps/admin` because a public app and
an internal console on the same origin share localStorage and a single XSS reaches
both. QGrid has the same shape available: a lean tablet app for inspectors, a
desktop console for the designer, matrix and administration.

It is not split, for one reason: **two apps per division is 54 Netlify sites, 54
sets of environment variables and 54 domains.** For a single deployment that trade
is obviously worth it; multiplied by 27 divisions it is not, yet. The `apps/`
layout means a second app can be added later without restructuring anything.

---

## Testing

    npm test                        every suite
    node run-tests.mjs --only nav   one suite
    node test-capture.js            or call it directly

The front-end suites run the real files from `apps/inspect/`, substituting only
`config.js` and `vendor/supabase.js` from `test/fixtures/`. An earlier version of
this repository tested a rewritten copy of `app.js` that had to be regenerated by
hand; a suite passing against a stale copy is worse than no suite, because it
reports green while the deployed code is untested.

`test-boot.js` is the exception to the mocking: it loads the actual
`vendor/supabase.js`, builds a real client and boots the app through to the
sign-in screen. Everything else substitutes the client, so nothing was checking
that the real bundle works — and a deploy missing that file looks identical to a
hung splash screen, which is how one deploy failed with nothing on screen to act
on. It also asserts the app now *says* what went wrong instead of hanging.

**What the jsdom suites cannot prove: RLS, the triggers and the RPCs.** Those are
the controls an ISO auditor actually tests, and a mock backend will happily allow a
write the real database refuses. `db/test/` covers them against a local PostgreSQL —
run it before any deploy that touches a policy.
