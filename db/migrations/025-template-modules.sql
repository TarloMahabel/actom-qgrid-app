-- ============================================================
--  ACTOM Grid — 025 template modules
--
--  The form designer was built for inspection templates. Customer care
--  forms need the same tools — sections, fields, revisions, the approval
--  workflow — but they do not belong to a manufacturing stage, and they
--  must not appear in the inspection requirements matrix.
--
--  TWO CHANGES TO inspection_templates
--
--  1. stage_id becomes nullable.
--     Every existing template keeps its stage. A customer care template
--     has none, and NULL is the honest representation of that rather than
--     a sentinel or a fake stage.
--
--  2. A module column is added.
--     Values: 'inspection' (default, covers all existing rows) and
--     'customer_care'. Further modules — NCR root-cause forms, audit
--     checklists — follow the same pattern without a new migration.
--
--  NOTHING ELSE CHANGES. Revisions, the approval flow, field types,
--  the capture UI — all identical. The module is a routing label, not
--  a schema fork.
--
--  WHY NOT A SEPARATE TABLE
--  A separate table would need its own revision history, its own
--  publish function, and its own RLS policies. That is duplication for
--  the sake of separation, and it would mean the designer has two
--  surfaces to maintain. One table with a discriminator column is simpler,
--  is cheaper to query, and keeps the audit trail in one place.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.v_inspections_by_month') is null then
    raise exception '025 needs 024-inspections-by-month.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. The module discriminator.
--
--  Created before the column so the column definition is clean.
--  The guard prevents a re-run from failing on an existing type.
-- ------------------------------------------------------------
do $mktype$
begin
  if not exists (select 1 from pg_type where typname = 'template_module') then
    create type template_module as enum ('inspection', 'customer_care');
  end if;
end $mktype$;

alter table inspection_templates
  add column if not exists module template_module not null default 'inspection';

comment on column inspection_templates.module is
  'Which part of the app this template belongs to. Inspection templates '
  'appear in the requirements matrix and are scheduled against works orders. '
  'Customer care templates are selected when logging a customer complaint. '
  'The column is a routing label: the revision and approval flow are shared.';

-- ------------------------------------------------------------
--  2. stage_id becomes nullable.
--
--  Existing NOT NULL constraint is dropped. A customer care template
--  has no manufacturing stage, and NULL is the correct value.
--  The foreign key to manufacturing_stages stays: where a stage is
--  set it must still be a real one.
--
--  All existing rows already have a stage, so this is data-safe.
-- ------------------------------------------------------------
alter table inspection_templates
  alter column stage_id drop not null;

comment on column inspection_templates.stage_id is
  'The manufacturing stage this template covers. NULL for non-inspection '
  'modules (customer_care and any future additions). A non-null value must '
  'reference manufacturing_stages even when module = ''customer_care'', so '
  'leave it null rather than setting a placeholder.';

-- ------------------------------------------------------------
--  3. Requirements matrix guard.
--
--  The inspection_requirements table links a family+stage to a template.
--  A customer care template should never appear there. A trigger enforces
--  this at the database level. (PostgreSQL does not allow subqueries in
--  CHECK constraints, so a trigger is the correct tool here.)
-- ------------------------------------------------------------
create or replace function fn_req_inspection_module_only()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from inspection_templates t
    where t.id = new.template_id
      and t.module = 'inspection'
  ) then
    raise exception
      'inspection_requirements: template % must have module = ''inspection''',
      new.template_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_req_inspection_module_only on inspection_requirements;
create trigger trg_req_inspection_module_only
  before insert or update of template_id on inspection_requirements
  for each row execute function fn_req_inspection_module_only();

-- ------------------------------------------------------------
--  4. Verification.
-- ------------------------------------------------------------
do $verify$
declare
  v_bad int;
begin
  -- Every existing template should still have a stage and be 'inspection'.
  select count(*) into v_bad
    from inspection_templates
   where module = 'inspection' and stage_id is null;

  if v_bad > 0 then
    raise exception '025: % inspection template(s) have no stage_id — unexpected.', v_bad;
  end if;

  raise notice '025 applied. stage_id is now nullable; template_module enum and module column added.';
end $verify$;
