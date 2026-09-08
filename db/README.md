# Database

```
db/
  migrations/       ACTOM Grid. Numbered 001-015, one number each, applied in order.
  seed/             Reference data and the per-division seeds.
  test/             The PostgreSQL suite (RLS, triggers, RPCs).
  superseded/       Kept for reference. NOT applied and NOT built into anything.
  apprenticeship/   The Apprenticeship Portal's schema. A DIFFERENT PRODUCT.
  schema-complete.sql   Generated. Do not edit.
```

**`apprenticeship/` is not this system's.** Those files were sitting loose in
`db/` alongside Grid's, and `scripts/build-schema.mjs` globbed the directory
flat — so `schema-complete.sql`, the script a new division is provisioned
from, carried applicant, intake and consent tables into a quality database
and stamped them into this product's migration ledger as though they were
Grid's. Nothing outside that folder should ever read from it. The build now
refuses to run if two migrations share a number, which is the condition that
let the two sets sit unnoticed in one directory.

## Migrations

Numbered files, applied in order, once each. `scripts/migrate.mjs` records
every applied file in `public.qgrid_migrations`, so a second run is a no-op.

## Applying them by hand

Paste each file into the Supabase SQL editor **in number order**. A migration
that depends on an earlier one now checks for it and stops with a message
naming the file to run first — but it cannot fix the order for you.

To see what a project already has:

```sql
select filename, applied_at from public.qgrid_migrations order by filename;
```

That table only exists if migrations were applied with `scripts/migrate.mjs`
or from `schema-complete.sql`. If you have been pasting files by hand it will
be empty or missing, and this tells you what is actually there instead:

```sql
select
  to_regclass('public.inspections')            is not null as "001 base schema",
  to_regproc('public.submit_inspection')       is not null as "002 app wiring",
  exists (select 1 from information_schema.columns
           where table_name='division_profile' and column_name='require_second_approver')
                                                            as "004 approval setting",
  exists (select 1 from information_schema.columns
           where table_name='failed_checks' and column_name='source')
                                                            as "008 fault list",
  to_regclass('public.inspection_handovers')   is not null as "010 handover",
  exists (select 1 from information_schema.columns
           where table_name='failed_checks' and column_name='verified_by')
                                                            as "011 fault clearing",
  to_regclass('public.quality_actions')        is not null as "012 dashboard";
```

## What each one is for

| File | Why it exists |
|---|---|
| 001 | Base schema: tables, RLS, the triggers that enforce the quality controls |
| 002 | App wiring: auth trigger, reference numbering, storage bucket, the three RPCs |
| 003 | Let a System Administrator publish a template, not only a Quality Manager |
| 004 | The second-approver rule on templates becomes a division setting, off by default |
| 005 | Close `ref_sequences` and the migration ledger to clients |
| 006 | Publishing was silently filtered by RLS and reported success anyway |
| 007 | A template with no questions on it cannot be published |
| 008 | Fault lists: many faults on one panel, sharing `failed_checks` |
| 009 | Photo storage: the bucket, its policies, and detaching an attachment |
| 010 | Handing an in-progress inspection to another inspector, with a reason |
| 011 | Who cleared a fault and who verified it |
| 012 | Faults per project, defect categories, and the monthly actions |
| 013 | Planned dates on generated schedules, with per-stage working-day offsets |
| 014 | NCR management: the register, severities, causes and corrective actions |
| 015 | NCR status derived from the row being written, and the closure path |

## A new division

Do not replay all fifteen. `db/schema-complete.sql` is generated from them by
`scripts/build-schema.mjs` and includes the ledger stamp, so the next
migration run picks up from the right place. Regenerate it after adding a
migration — `test-integrity.js` fails if it is stale.
