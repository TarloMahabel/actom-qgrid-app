# Database test suite

The jsdom suites prove the application logic. They cannot prove RLS, the
triggers, or the RPCs — those run inside PostgreSQL, and a mock backend
will happily let through a write the real database would refuse.

That gap matters more here than in most projects, because the controls an
ISO auditor tests are *all* in the database: a signed inspection cannot be
edited, an out-of-calibration instrument cannot be used, a template cannot
be self-published, the audit trail cannot be deleted from.

## Running them

Needs a local PostgreSQL 16 with the `pgcrypto` extension available.

    sudo apt-get install postgresql-16
    db/test/run-tests.sh

The runner creates a scratch database, applies `00-shim.sql` (which stands
in for the parts of Supabase that are not plain PostgreSQL — the `auth`
schema, `auth.uid()`, `storage`), then the real migrations from `db/`, then
the test files in order.

## What is covered

`90-security-tests.sql` asserts the controls hold when exercised as a
specific user:

- an inspector sees their own department's inspections and nobody else's
- a signed inspection rejects UPDATE
- a result referencing overdue equipment rejects INSERT
- signing without the required competency is refused
- publishing your own template revision is refused
- `audit_trail` rejects UPDATE and DELETE from `authenticated`
- the three views return nothing to a caller with no rows of their own

## What is not covered, and why

Storage policies. They need the Supabase storage schema and its own
functions, which the shim does not reproduce faithfully enough to be worth
trusting. Verify photo upload against a real project instead — it is a
five-minute manual check and a shim that lies is worse than no shim.
