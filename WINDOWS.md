# Working on QGrid from Windows

## Prerequisites

    winget install OpenJS.NodeJS.LTS          # Node 20+
    winget install Git.Git
    winget install GitHub.cli
    winget install Supabase.cli
    winget install PostgreSQL.PostgreSQL.16    # for psql, used by the migration scripts

Close and reopen the terminal so PATH picks them up, then check:

    node -v; git --version; supabase --version; psql --version

`scripts/migrate.mjs`, `verify-drift.mjs` and `new-division.mjs` shell out to
`psql`, and `new-division.mjs` also needs `supabase`. If either is missing from
PATH those scripts fail with ENOENT rather than a useful message.

You can skip both if you apply `db/schema-complete.sql` through the Supabase SQL
editor instead — see DEPLOYMENT.md step 2.

## Where to put it

Anywhere not synced by OneDrive. The repo lives at
`C:\Users\vmahabel.HQ\Documents\actom-qgrid`, which is fine — Documents on this
machine is local.

If this repo is ever cloned onto a profile where Documents *is* synced, move it
out. OneDrive locks files while `npm install` is writing them, and the symptom is
an install that half-succeeds plus a git index reporting phantom changes.

## First run

    cd C:\Users\vmahabel.HQ\Documents\actom-qgrid
    npm install
    npm test            # 6 suites, 92 checks, no network needed

`npm test` exercises the real app files against a mocked Supabase. If it passes,
the local copy is sound before you touch any console.

It does NOT cover RLS, the triggers or the RPCs — those need PostgreSQL. On Windows
the simplest route is the Supabase smoke test in DEPLOYMENT.md rather than a local
PostgreSQL install; see db/test/README.md if you want the full suite.

## Git hooks

Install once per clone, or the pre-commit guards do nothing:

    git config core.hooksPath .githooks

It blocks a service_role key, a connection string, a committed config.js, a CDN
import, and a commit where `shared/` and `apps/` have drifted apart.

## Line endings

`.gitattributes` normalises everything to LF in the repo. Set this once globally
so Git stops rewriting files on checkout:

    git config --global core.autocrlf input

If you cloned before that was set, refresh the working tree:

    git rm --cached -r .
    git reset --hard

## Environment variables in PowerShell

The scripts read connection strings from the environment. PowerShell syntax
differs from the bash examples in SETUP.md:

    $env:DB_URL_MVS = "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"
    npm run migrate -- --division MVS

These last for the session only. Do not put them in a committed file — that is
what GitHub Actions secrets are for.

## Long paths

Not an issue for this repo, but if you ever nest it deeply:

    git config --global core.longpaths true
