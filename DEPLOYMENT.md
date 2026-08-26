# Deploying QGrid

Supabase, Microsoft Entra, GitHub, Netlify. Do these in order; step 9 repeats the
whole thing for each further division with one command.

Roughly two hours end to end, most of it waiting for DNS and project provisioning.

Do these in order. Steps 1–4 stand up the pilot division (MV Switchgear); step 8 repeats
the whole thing for each further division with one command.

Roughly two hours end to end, most of it waiting for DNS and project provisioning.

---

## 1. GitHub

The repository is `TarloMahabel/actom-qgrid-app`.

```bash
git init
git branch -M main
git add -A
git commit -m "ACTOM QGrid Inspections - Phase 1"
git remote add origin https://github.com/TarloMahabel/actom-qgrid-app.git
git push -u origin main
git branch production
git push -u origin production
```

Two long-lived branches: `main` for work, `production` for what divisions run.

In **Settings → Branches**, protect `production`: require a pull request, require the
*Verify pull request* check to pass. On a private repository under a personal account this
may need a paid plan — if the option is greyed out, the workflow still runs and still
reports, it simply cannot block a merge. Worth resolving before other divisions go live. That check applies every migration to a throwaway
Postgres from scratch and fails if any table is missing RLS. It is the only thing standing
between a bad migration and 27 live databases — do not make it optional.

---

## 2. Supabase

**Create the project.** `actom-qgrid-mvs`, region `eu-west-1`, Pro plan. Save the database
password to the ACTOM password vault immediately — you cannot retrieve it later.

**Apply the schema.**

```bash
supabase login
export DB_URL_MVS="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
supabase db push --db-url "$DB_URL_MVS" --include-all
psql "$DB_URL_MVS" -v ON_ERROR_STOP=1 -f db/seed/reference_data.sql
psql "$DB_URL_MVS" -v ON_ERROR_STOP=1 -f db/seed/division_mvs.sql
```

**Check what you got.** Nine stages, nine departments, fourteen defect codes, and RLS on
every table:

```sql
select count(*) from manufacturing_stages;   -- 9
select tablename, rowsecurity from pg_tables
 where schemaname='public' and rowsecurity is false;   -- must return 0 rows
```

**Collect the keys.** Settings → API: the project URL and the `anon` key. The anon key is
public by design — it goes in the browser and RLS is what protects the data. The
`service_role` key must never appear in Netlify, in the repo, or in a browser.

---

## 3. Microsoft Entra

**App registration** (Entra admin centre → App registrations → New):

- Name: `ACTOM QGrid`
- Accounts in this organizational directory only
- Redirect URI, type *Web*: `https://<ref>.supabase.co/auth/v1/callback`

One registration serves every division. Each division's Supabase project has its own
callback URL, so **add a redirect URI per division as you roll them out** — this is the
step most often forgotten, and the symptom is a sign-in that loops back to the gate.

- **Certificates & secrets** → New client secret. Copy the value now; set a calendar
  reminder for its expiry, because sign-in stops working the day it lapses.
- **API permissions** → Microsoft Graph delegated: `openid`, `profile`, `email`,
  `User.Read`. Grant admin consent.
- **Token configuration** → add the optional claim `email` (ID token). Without it the
  profile row is created with a blank email.

**In Supabase** → Authentication → Providers → Azure: enable it, paste the Application
(client) ID, the client secret, and set the Azure Tenant URL to
`https://login.microsoftonline.com/<tenant-id>`.

Under Authentication → URL Configuration, set Site URL to the Netlify domain and add it
to Redirect URLs.

---

## 4. Netlify

Create a site from the GitHub repo:

| Setting | Value |
|---|---|
| Branch | `production` |
| Base directory | `apps/inspect` |
| Build command | `node ../../scripts/gen-config.mjs` |
| Publish directory | `apps/inspect` |

Site configuration → Environment variables:

```
SUPABASE_URL       https://<ref>.supabase.co
SUPABASE_ANON_KEY  eyJ...
DIVISION_CODE      MVS
DIVISION_NAME      ACTOM MV Switchgear
```

The build writes `config.js` **and `_headers`** from these four — the second pins the CSP `connect-src` to this division's project. **If any is missing the build fails on
purpose** — a site that deploys without knowing which database it belongs to is worse than
a site that does not deploy.

Deploy, then point `qgrid-mvs.actom.co.za` at it and add that hostname to the Supabase
redirect URLs and the Entra registration.

---

## 5. First sign-in and the first administrator

The first person to sign in gets a profile row with `active = false` and no role — by
design, since authenticating is not access. Nobody can activate them because there is no
administrator yet. Break the loop once, by hand:

```sql
update profiles
   set role = 'sysadmin', active = true
 where email = 'varshan.mahabel@actom.co.za';
```

From then on, activation happens in Administration → Users & roles.

---

## 6. GitHub Actions secrets

Repository → Settings → Secrets and variables → Actions:

- `DB_URL_MVS` — the service-role connection string

Add `DB_URL_<CODE>` for each division as it goes live. **A division with no secret
silently stops receiving migrations**, which is exactly the drift the nightly check exists
to catch. Add the secret in the same sitting as the project.

---

## 7. Smoke test the whole loop

1. Sign in with an ACTOM account → sign-in gate → pending screen.
2. Activate that user and give them `quality_manager`.
3. Form designer → New template → add a measurement field with a tolerance → Save draft.
4. Sign in as a *second* Quality Manager and publish it. The database refuses
   self-publishing, so this proves the second-approver rule rather than assuming it.
5. Requirements matrix → click a cell → attach the template as Required.
6. Insert a project and works order, then Scheduling → Generate from works order.
7. Workbench → My queue → Start → record a value outside tolerance → Sign and submit.
8. Confirm: the inspection is `fail`, a failed check exists, and the audit trail has rows.
9. Try to edit the signed inspection through the API. It must be rejected with `INS_SIGNED`.

Step 9 is the one worth doing properly. Everything else is features; that one is the
control an ISO auditor will actually test.

---

## 8. Each further division

```bash
export SUPABASE_ACCESS_TOKEN=... SUPABASE_ORG_ID=... NETLIFY_AUTH_TOKEN=...
export DB_PASSWORD_NEW=... GITHUB_REPO=TarloMahabel/actom-qgrid-app
node scripts/new-division.mjs --code DTX --name "ACTOM Distribution Transformers"
```

Then the four manual steps the script prints: Entra redirect URI, `DB_URL_DTX` secret,
custom domain, division seed data.

---

## What is not wired yet

Being explicit so none of this is discovered late:

- **Photo upload.** The bucket, the policies and the form field exist; the compress-and-upload
  handler does not. Half a day, needs a real device to test against.
- **Offline capture.** The form writes each answer through as it is given, so a dropped
  connection loses one field rather than an inspection. True offline queueing with a service
  worker is a separate piece of work and should be scoped against the actual shop-floor
  Wi-Fi rather than guessed at.
- **Works orders.** Created by hand in Phase 1. The SYSPRO read is Phase 2 and should not
  collide with the 5 October JTU go-live.
- **Amendments.** The schema carries `amends_id` and the database blocks edits to signed
  records, but the amendment screen is not built.
- **Competency data.** The signing check reads the `competencies` table, which is empty
  until competencies are loaded. Until then it will block level 2 and 3 sign-off — either
  load the data before go-live or set every template to level 1 for the pilot.

---

## Testing

```bash
node t/run.mjs     # 45 checks: gate, every module and tab, capture, designer, matrix, admin
```

These run against a mocked Supabase, so they prove the application logic and the rendering
paths, not the policies. **RLS and the triggers can only be verified against a real
project** — that is what step 7 is for, and it is worth repeating after any migration that
touches a policy.

---

Supabase is up. Three layers to connect, in this order. Prove each one before
moving to the next — a front end pointed at a half-configured project produces
errors that look like front-end bugs.

---

## Appendix — running it locally

From Supabase → Settings → API, copy the **Project URL** and the **anon** key.
The anon key is meant to be public; RLS is what protects the data. The
`service_role` key must never appear here, in the repo, or in a browser.

    copy apps\inspect\config.js.example apps\inspect\config.js

Edit `config.js` and paste both values in. It is gitignored — on Netlify this
file is generated at build time from the site environment variables.

Then check the project from outside the browser:

    npm run check

This verifies the key is accepted, all 15 tables and 3 RPCs are exposed, the
Azure provider is enabled, and — the one that matters most — that an anonymous
caller gets **nothing** back from `inspections`, `profiles` and `audit_trail`.
If any of those leak rows, stop and fix RLS before loading real data.

---

## 2. Serve it

`app.js` is an ES module, so `file://` will not work — the browser blocks module
loading from the filesystem. You need a local web server:

    npm run dev            # serves apps/inspect on http://localhost:8888

In Supabase → Authentication → URL Configuration, add
`http://localhost:8888` to **Redirect URLs**, or sign-in will bounce.

### Proving it before Entra exists

The Entra app registration takes a while to get approved. To test the data path
now, create a user in Supabase → Authentication → Users → Add user (with a
password, and tick "auto confirm"). The sign-in screen shows a password box
**only** when `config.build.context === "local"`, which Netlify never sets, so
this cannot appear on a deployed site.

Sign in with it and you should land on the pending screen. Then make yourself an
administrator, once:

    update profiles set role = 'sysadmin', active = true
     where email = 'you@actom.co.za';

Click **Check again**. You should now be in the app.

---

## 3. Switch to Microsoft Entra

Follow SETUP.md section 3. The two steps that catch people:

- **The redirect URI is Supabase's, not Netlify's**:
  `https://<ref>.supabase.co/auth/v1/callback`. Every division's project needs
  its own URI added to the same app registration.
- **Add the optional `email` claim** under Token configuration. Without it the
  profile row is created with a blank email, and the users list is unusable.

---

## First-run checklist

Once you are in the app, work through this in order. It is the shortest path
that exercises every wired control.

1. **Administration → Reference lists** — 9 stages, 9 departments, 14 defect
   codes, 4 product families. If any are empty, section 3 or 4 of the schema
   script did not run.
2. **Form designer → New template** — add a measurement field with a tolerance
   (say 66 to 74 Nm), tick Required and Raise defect on fail. Save draft.
3. **Publish it.** This will *fail* if you are the person who created it — the
   database refuses self-approval. That is the second-approver rule working.
   Either add a second Quality Manager, or publish a template someone else built.
4. **Requirements matrix** — click a cell, attach the template as Required.
5. **Add a project and works order.** No screen for this in Phase 1, so:

       insert into projects (code, name, customer, family_id)
       values ('P-26118','Eskom 12 kV panels','Eskom Distribution',
               (select id from product_families where name = '12 kV metal-clad'));

       insert into works_orders (code, project_id, description, qty)
       values ('WO-44812',(select id from projects where code = 'P-26118'),
               'Panels 1-3', 3);

6. **Scheduling → Generate from works order.** Should create one inspection per
   unit. If it creates none, the template has no published revision.
7. **Workbench → My queue → Start.** Record a value outside the tolerance. The
   field turns red and warns you.
8. **Sign and submit.** Expect result `fail` and one failed check.
9. **Failed checks tab** → disposition it.
10. **Try to break it.** In the Supabase SQL editor:

        update inspections set result = 'pass' where ref = 'INS-26-0001';

    This must be rejected with `INS_SIGNED`. That is the control an ISO auditor
    will actually test, and it is the only item on this list worth repeating
    after every migration.

---

## If something does not work

| Symptom | Cause |
|---|---|
| "This site is not configured" | `config.js` missing or missing url/key |
| Blank page, console shows a module error | opened over `file://` — use `npm run dev` |
| Sign-in redirects back to the gate | redirect URL not added in Supabase, or Entra URI wrong |
| Stuck on the pending screen | profile is `active = false` — activate it |
| Empty dropdowns everywhere | reference data not seeded (schema script section 3) |
| "no published revision" on generate | template is still a draft — publish it |
| Sign-off refused with COMPETENCY | `competencies` table is empty; set templates to level 1 for the pilot or load competency data |
| Everything empty but no errors | RLS is working and your profile has no department — set one |

The last row is worth internalising. In a system where RLS is doing its job,
"missing data" and "no permission" look identical from the front end. Check the
profile's role and department before assuming the data is not there.
