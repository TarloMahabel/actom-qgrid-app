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
`supabase` and `psql`. If either is missing from PATH those scripts fail with
ENOENT rather than a useful message.

## Where to put it

Prefer `C:\dev\actom-qgrid-app` over anywhere under `Documents`. On a domain
profile Documents is usually OneDrive-synced, and OneDrive locks files while
`npm install` is writing them — the symptom is an install that half-succeeds and
a git index that reports phantom changes.

If it must live in Documents: right-click the folder, "Always keep on this
device", and exclude it from sync.

## First run

    cd C:\dev\actom-qgrid-app
    npm install
    npm test            # 45 checks, no network needed

`npm test` exercises the whole app against a mocked Supabase. If it passes, the
local copy is sound before you touch any console.

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
    node scripts/migrate.mjs --division MVS

These last for the session only. Do not put them in a committed file — that is
what GitHub Actions secrets are for.

## Long paths

Not an issue for this repo, but if you ever nest it deeply:

    git config --global core.longpaths true
