# Extracting this archive

Snapshot of `TarloMahabel/actom-apprentice-portal` at commit `6add1e0`, plus
the migration 016 change set. 91 files.

## Files deliberately NOT in this zip

Extracting over your working copy would overwrite these with whatever was in
the snapshot, and they carry environment-specific values that are painful to
reconstruct. They are left out so extraction cannot touch them:

```
apps/admin/config.js
apps/applicant/config.js
apps/admin/netlify.toml
apps/applicant/netlify.toml
apps/admin/vercel.json
apps/applicant/vercel.json
demo/admin/config.js
demo/applicant/config.js
```

`test/fixtures/config.js` IS included — it holds no real values and the test
harness needs it.

If you extract into an empty directory rather than over your existing clone,
those eight files will be missing and neither app will deploy. Copy them from
your working copy, or `git checkout` them after extracting.

## Not included

- `.git/` — extracting a snapshot history over your own would be destructive.
- `node_modules/` — gitignored. `npm install jsdom --no-save` to run tests.
- `admin/`, `applicant/`, `admin~` — untracked strays in the working tree.
  They are not in the repository and are not reproduced here.

## What changed from 6add1e0

```
db/016-qualification-advisory.sql   new
apps/admin/admin.js                 qualificationCard() + APP_COLS
shared/changelog.js                 APP_VERSION 1.15.0 + entry
apps/admin/changelog.js             synced from shared/
test-xss.js                         4 assertions on the new card
```

## After extracting

```bash
npm install jsdom --no-save
bash run-all-tests.sh          # expect ALL SUITES PASSED
git status                     # confirm only the five files above differ
```

Then run `db/016-qualification-advisory.sql` in the Supabase SQL editor.

## Install the hooks if this is a fresh clone

```bash
git config core.hooksPath .githooks
```
