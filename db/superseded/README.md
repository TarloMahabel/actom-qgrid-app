# Superseded

Kept for reference. Nothing here is applied, built, or scanned by any script
or test.

## `007-no-empty-published-revision.sql`

A second migration numbered 007. Both it and `007-no-empty-templates.sql`
redefine `publish_template_revision` to refuse publishing a revision with no
answerable fields, and both declare the same signature, so whichever ran last
won outright. Sorting put this one first, meaning `no-empty-templates` was
already the effective one.

`migrations/007-no-empty-templates.sql` is the version kept, on three counts:

- it carries the `PREREQUISITES` guard that `test-integrity.js` requires of
  every migration numbered 007, 008, 010, 011 or 012
- it grants `publish_template_revision(uuid)` naming the argument list, where
  this one grants the bare name — the exact fault integrity's "every function
  grant names its argument list" check exists to catch, and the reason that
  check was failing
- it is null-safe on an empty definition:
  `coalesce(v_def->'sections', '[]'::jsonb)` rather than dereferencing
  `tr.definition->'sections'` directly

**Worth salvaging.** The block at the end of this file walks published
revisions that have no answerable fields and raises a warning naming each
template and revision. The kept 007 has no equivalent, and it is a useful
thing to run against a live division. Lift it into a standalone audit script
rather than folding it into a migration that has already been applied —
editing an applied migration is how a ledger starts lying.

**Known bug, present in both.** Both files contain:

```sql
select require_second_approver into v_require from division_profile where id;
```

`where id` has no comparison, and Postgres requires a boolean there. plpgsql
does not analyse statements inside a function body at creation time, so this
creates cleanly and throws at runtime. It originates in `006-fix-silent-
publish.sql`, which is applied. It needs its own migration.

## `schema_complete.sql`

The hand-maintained predecessor of `schema-complete.sql` — note the
underscore. It stopped at 002 while claiming to be complete, which is the
reason `build-schema.mjs` exists. Superseded entirely.
