# Not this product

These files belong to the **ACTOM Apprentice & Learnership Application
Portal**. They are a different system with a different database, and they are
in this repository only because they were committed here.

They are kept, rather than deleted, because deleting another product's schema
on the strength of a filename is not a call this repository should make. But
nothing here is part of ACTOM Grid:

- `scripts/build-schema.mjs` does not read this folder
- `scripts/migrate.mjs` does not apply anything in it
- `test-integrity.js` does not scan it

## Why they were separated

`db/` was flat, and both products' migrations sat in it together. Both
`build-schema.mjs` and `migrate.mjs` globbed `db/*.sql` on a `NNN-` pattern,
so both swept up both products.

The consequence was not cosmetic. `db/schema-complete.sql` is the one-file
script pasted into the SQL editor when standing up a new division. It was
being generated with the Portal's schema inside it — applicants, intakes,
consent records, journey steps — so a division provisioned from it received
those tables in its quality database. Worse, the generated ledger stamp
listed the Portal's migrations as applied Grid migrations, so
`scripts/verify-drift.mjs` would have compared divisions against a baseline
that was partly another product's and reported them consistent.

`test-integrity.js` had been reporting this the whole time. Its duplicate-
number and numbering-gap checks failed on every run, and its RLS policy check
was failing on `apprentices`, `intake_documents` and `intake_trade_subjects` —
tables that are not Grid's and whose policies live in a schema Grid never
applies. Five failures, all of them this.

## If you are working on the Portal

Use the Portal's own repository. Changing these copies changes nothing that
runs anywhere.
