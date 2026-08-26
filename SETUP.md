# Wiring QGrid — Supabase, Microsoft Entra, GitHub, Netlify

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
| Build command | `node scripts/gen-config.mjs` |
| Publish directory | `.` |

Site configuration → Environment variables:

```
SUPABASE_URL       https://<ref>.supabase.co
SUPABASE_ANON_KEY  eyJ...
DIVISION_CODE      MVS
DIVISION_NAME      ACTOM MV Switchgear
```

The build writes `config.js` from these four. **If any is missing the build fails on
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
