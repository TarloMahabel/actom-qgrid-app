-- ============================================================
--  ACTOM Grid — 014 NCR management (Module 3), step 1
--
--  Built from Module_3_NCR_Management.xlsx: 475 records, 29 columns.
--  What the fill rates in that register say about the process shaped
--  this schema more than the column list did.
--
--    NCR no, department, date, status, details   99-100% filled
--    containment action                          91%
--    person responsible                          49%
--    corrective action                           19%
--    total cost                                  22%
--    severity                                     7%
--    root cause                                   1%   (7 of 475)
--    material and labour cost                      0%   (never, in two years)
--
--  368 of 475 are still open. The register records a non-conformance
--  well and closes one badly, so the two questions the business needs
--  answering — what keeps causing this, and what is it costing us —
--  cannot be answered from its own data.
--
--  A faithful copy would preserve that. So the closing half is what this
--  schema makes structural:
--
--    * status is DERIVED from the facts, never typed. Five spellings of
--      two states (Open/open/Closed/closed) is what free text produces.
--    * root cause is a coded value plus detail, and closing requires it.
--    * corrective actions are their own rows with an owner, a due date
--      and a verification — not one free-text column.
--    * cost totals are computed from their parts.
--    * supplier is a field, not a spelling inside "Department".
--
--  DECISIONS TAKEN HERE, all reversible, all worth challenging:
--    1. New numbering NCR-YY-NNNN; the old number is kept in legacy_ref
--       because 475 records and every historic email use it.
--    2. Severity becomes REQUIRED. At 7% filled it is currently worse
--       than absent: reports built on it would lie.
--    3. Cost breakdown stays optional, total computed when given.
--    4. Independent verification of a corrective action is a division
--       setting, default off, matching hold points and template approval.
-- ============================================================

-- ------------------------------------------------------------
--  PREREQUISITES. Run migrations in order.
-- ------------------------------------------------------------
do $prereq$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'failed_checks' and column_name = 'source') then
    raise exception '014 needs 008-fault-list.sql first (failed_checks.source is missing).';
  end if;
  if to_regclass('public.quality_actions') is null then
    raise exception '014 needs 012-dashboard.sql first (quality_actions is missing).';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Root causes, coded.
--
--  Seeded from the register's own "Standard Defect" list, which is the
--  one analysis field that works (88% filled, 44 distinct values). Root
--  cause proper is at 1%, so there is nothing to migrate — this gives it
--  somewhere to go.
--
--  Codes are the unit of record and category is how they group for
--  reporting, exactly as defect_codes works.
-- ------------------------------------------------------------
create table if not exists root_causes (
  id         bigserial primary key,
  code       text not null unique,
  name       text not null,
  category   text,
  active     boolean not null default true,
  sort_order smallint
);

alter table root_causes enable row level security;
create policy rc_read on root_causes for select using (auth.uid() is not null);
create policy rc_write on root_causes for all
  using (has_role('quality_engineer','quality_manager','sysadmin'))
  with check (has_role('quality_engineer','quality_manager','sysadmin'));

insert into root_causes (code, name, category, sort_order) values
  ('RC-PROC', 'Procedure not followed',            'Method',   10),
  ('RC-WORK', 'Poor workmanship',                  'People',   20),
  ('RC-TRAIN','Inadequate training or competence', 'People',   30),
  ('RC-HAND', 'Poor handling and storage',         'Method',   40),
  ('RC-DESN', 'Incorrect design',                  'Design',   50),
  ('RC-DRAW', 'Drawing or specification error',    'Design',   60),
  ('RC-TOOL', 'Tool or tooling defect',            'Machine',  70),
  ('RC-MACH', 'Machine setup or programming',      'Machine',  80),
  ('RC-MAINT','Equipment wear or maintenance',     'Machine',  90),
  ('RC-MATL', 'Raw material defect',               'Material',100),
  ('RC-SUPP', 'Supplier defect',                   'Material',110),
  ('RC-MEAS', 'Measurement or inspection escape',  'Measurement',120),
  ('RC-COMM', 'Communication or handover',         'Method',  130),
  ('RC-PLAN', 'Planning or routing error',         'Method',  140),
  ('RC-OTHER','Other — see detail',                'Other',   999)
on conflict (code) do nothing;

-- ------------------------------------------------------------
--  2. The register.
-- ------------------------------------------------------------
do $enums$
begin
  if not exists (select 1 from pg_type where typname = 'ncr_severity') then
    create type ncr_severity as enum ('minor', 'major', 'critical');
  end if;
  if not exists (select 1 from pg_type where typname = 'ncr_disposition') then
    create type ncr_disposition as enum
      ('rework', 'scrap', 'return_to_supplier', 'concession', 'use_as_is', 'not_yet_decided');
  end if;
  if not exists (select 1 from pg_type where typname = 'ncr_origin') then
    create type ncr_origin as enum
      ('inspection', 'fault_list', 'supplier', 'site', 'customer', 'internal', 'audit');
  end if;
end $enums$;

create table if not exists ncrs (
  id                uuid primary key default gen_random_uuid(),
  ref               text unique,                    -- NCR-YY-NNNN, set by trigger
  legacy_ref        text,                           -- 026/001, M025/156, HB025/015

  -- where it came from
  origin            ncr_origin not null default 'internal',
  inspection_id     uuid references inspections(id) on delete set null,
  failed_check_id   uuid references failed_checks(id) on delete set null,
  project_id        bigint references projects(id),
  works_order_id    bigint references works_orders(id),

  -- what
  part_description  text not null,
  part_no           text,
  qty               numeric(12,2),
  qty_unit          text,                           -- 'units', 'kg', 'sheets', 'm'
  details           text not null,                  -- the non-conformance itself

  -- who
  raised_by         uuid not null references profiles(id),
  department_id     bigint references departments(id),
  person_responsible uuid references profiles(id),
  supplier          text,                           -- named when origin = supplier

  severity          ncr_severity not null,
  disposition       ncr_disposition not null default 'not_yet_decided',
  concession_by     uuid references profiles(id),
  concession_note   text,

  -- containment: what was done immediately
  containment       text,
  contained_by      uuid references profiles(id),
  contained_at      timestamptz,

  -- cause
  root_cause_id     bigint references root_causes(id),
  root_cause_detail text,
  cause_by          uuid references profiles(id),
  cause_at          timestamptz,

  -- cost. Breakdown optional; total computed from it when given.
  cost_material     numeric(12,2),
  cost_labour       numeric(12,2),
  cost_rework       numeric(12,2),
  cost_other        numeric(12,2),
  cost_total        numeric(12,2),

  syspro_captured   boolean not null default false,

  status            text not null default 'open',   -- DERIVED, see trigger
  closed_by         uuid references profiles(id),
  closed_at         timestamptz,

  raised_at         timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  constraint ncr_supplier_named check (origin <> 'supplier' or supplier is not null),
  constraint ncr_concession_authorised check
    (disposition <> 'concession' or concession_by is not null)
);

create index if not exists ncrs_status_idx      on ncrs (status, raised_at desc);
create index if not exists ncrs_dept_idx        on ncrs (department_id, raised_at desc);
create index if not exists ncrs_cause_idx       on ncrs (root_cause_id);
create index if not exists ncrs_supplier_idx    on ncrs (supplier) where supplier is not null;
create index if not exists ncrs_inspection_idx  on ncrs (inspection_id);
create index if not exists ncrs_legacy_idx      on ncrs (legacy_ref);

comment on column ncrs.status is
  'DERIVED by trg_ncr_status from what has actually been recorded. Never set '
  'directly: the spreadsheet it replaces held five spellings of two states.';
comment on column ncrs.legacy_ref is
  'The number from the spreadsheet register. Kept because 475 records and '
  'every historic email refer to it.';
comment on column ncrs.cost_total is
  'Computed from the breakdown when any part is given, otherwise entered '
  'directly. Material and labour were never once filled in the old register, '
  'so a single total has to remain workable.';

-- ------------------------------------------------------------
--  3. Corrective actions: rows, not a text column.
--
--  19% of the old register had a corrective action at all. Giving each
--  one an owner, a due date and a verification is the whole point.
-- ------------------------------------------------------------
create table if not exists ncr_actions (
  id           bigserial primary key,
  ncr_id       uuid not null references ncrs(id) on delete cascade,
  seq          smallint,
  action       text not null check (length(btrim(action)) > 0),
  owner_id     uuid references profiles(id),
  due_date     date,
  done_by      uuid references profiles(id),
  done_at      timestamptz,
  verified_by  uuid references profiles(id),
  verified_at  timestamptz,
  created_by   uuid references profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists ncr_actions_ncr_idx on ncr_actions (ncr_id, seq);

comment on table ncr_actions is
  'What stops it happening again. Separate rows because one non-conformance '
  'often needs several, each owned by somebody different.';

-- ------------------------------------------------------------
--  4. Photographs and documents on an NCR.
--     attachments.inspection_id is already nullable, so it only needs a
--     column and the shape rule.
-- ------------------------------------------------------------
alter table attachments
  add column if not exists ncr_id uuid references ncrs(id) on delete cascade;

alter table attachments drop constraint if exists attachments_belongs_to;
alter table attachments add constraint attachments_belongs_to check (
  inspection_id is not null or ncr_id is not null
);

create index if not exists attachments_ncr_idx on attachments (ncr_id);

-- ------------------------------------------------------------
--  5. Numbering, the same mechanism as INS and FC.
-- ------------------------------------------------------------
create or replace function set_ncr_ref()
returns trigger language plpgsql as $$
begin
  if new.ref is null then new.ref := next_ref('NCR'); end if;
  return new;
end $$;

drop trigger if exists trg_ncr_ref on ncrs;
create trigger trg_ncr_ref before insert on ncrs
  for each row execute function set_ncr_ref();

-- ------------------------------------------------------------
--  6. Status, derived.
--
--  open                     raised, nothing done
--  contained                immediate action recorded
--  cause_identified         root cause recorded
--  action_agreed            at least one corrective action exists
--  action_done              every corrective action carried out
--  verified                 every corrective action verified
--  closed                   verified and closed off
--
--  Closing requires a root cause and a verified corrective action. That
--  is the rule the old register had no way to hold, and the reason 368
--  of 475 sit open.
-- ------------------------------------------------------------
create or replace function ncr_status(p_ncr uuid)
returns text language plpgsql stable as $$
declare
  n ncrs; v_actions int; v_done int; v_verified int;
begin
  select * into n from ncrs where id = p_ncr;
  if n.id is null then return 'open'; end if;
  if n.closed_at is not null then return 'closed'; end if;

  select count(*), count(done_at), count(verified_at)
    into v_actions, v_done, v_verified
    from ncr_actions where ncr_id = p_ncr;

  if v_actions > 0 and v_verified = v_actions then return 'verified'; end if;
  if v_actions > 0 and v_done = v_actions     then return 'action_done'; end if;
  if v_actions > 0                             then return 'action_agreed'; end if;
  if n.root_cause_id is not null               then return 'cause_identified'; end if;
  if n.containment is not null and length(btrim(n.containment)) > 0 then return 'contained'; end if;
  return 'open';
end $$;

create or replace function refresh_ncr_status()
returns trigger language plpgsql as $$
declare v_id uuid;
begin
  v_id := coalesce(new.ncr_id, old.ncr_id);
  update ncrs set status = ncr_status(v_id) where id = v_id;
  return coalesce(new, old);
end $$;

create or replace function stamp_ncr()
returns trigger language plpgsql as $$
begin
  -- Cost total from its parts when any part is given.
  if coalesce(new.cost_material, new.cost_labour, new.cost_rework, new.cost_other) is not null then
    new.cost_total := coalesce(new.cost_material,0) + coalesce(new.cost_labour,0)
                    + coalesce(new.cost_rework,0)  + coalesce(new.cost_other,0);
  end if;

  -- Who did what, when, written by the database rather than the browser.
  if tg_op = 'UPDATE' then
    if new.containment is distinct from old.containment
       and new.containment is not null and length(btrim(new.containment)) > 0 then
      new.contained_by := coalesce(new.contained_by, auth.uid());
      new.contained_at := coalesce(new.contained_at, now());
    end if;
    if new.root_cause_id is distinct from old.root_cause_id and new.root_cause_id is not null then
      new.cause_by := coalesce(new.cause_by, auth.uid());
      new.cause_at := coalesce(new.cause_at, now());
    end if;
  end if;

  new.status := ncr_status(new.id);
  return new;
end $$;

drop trigger if exists trg_ncr_stamp on ncrs;
create trigger trg_ncr_stamp before update on ncrs
  for each row execute function stamp_ncr();

drop trigger if exists trg_ncr_action_status on ncr_actions;
create trigger trg_ncr_action_status after insert or update or delete on ncr_actions
  for each row execute function refresh_ncr_status();

-- ------------------------------------------------------------
--  7. Closing an NCR. One operation, with the rules in one place.
-- ------------------------------------------------------------
alter table division_profile
  add column if not exists ncr_independent_verification boolean not null default false;

comment on column division_profile.ncr_independent_verification is
  'When true, the person who carried out a corrective action cannot verify it. '
  'Off by default, like hold points and template approval: a division with one '
  'quality engineer would otherwise be unable to close anything.';

create or replace function close_ncr(p_ncr uuid, p_note text default null)
returns jsonb language plpgsql security invoker as $$
declare n ncrs; v_actions int; v_verified int; v_rows int;
begin
  if not has_role('quality_engineer','quality_manager','sysadmin') then
    raise exception 'NCR_ROLE: only a Quality Engineer or above may close an NCR';
  end if;

  select * into n from ncrs where id = p_ncr;
  if n.id is null then raise exception 'NCR_MISSING: not found'; end if;
  if n.closed_at is not null then
    raise exception 'NCR_CLOSED: % is already closed', n.ref;
  end if;

  -- The two things the old register could not enforce, and did not have.
  if n.root_cause_id is null then
    raise exception 'NCR_NO_CAUSE: % cannot be closed without a root cause', n.ref;
  end if;

  select count(*), count(verified_at) into v_actions, v_verified
    from ncr_actions where ncr_id = p_ncr;
  if v_actions = 0 then
    raise exception 'NCR_NO_ACTION: % cannot be closed without a corrective action', n.ref;
  end if;
  if v_verified < v_actions then
    raise exception 'NCR_UNVERIFIED: % has % corrective action(s) not yet verified',
      n.ref, v_actions - v_verified;
  end if;

  update ncrs
     set closed_by = auth.uid(), closed_at = now(),
         concession_note = coalesce(p_note, concession_note)
   where id = p_ncr;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'NCR_BLOCKED: row level security prevented the change.';
  end if;

  update ncrs set status = 'closed' where id = p_ncr;
  return jsonb_build_object('ref', n.ref, 'status', 'closed');
end $$;

grant execute on function close_ncr(uuid, text) to authenticated;
grant execute on function ncr_status(uuid) to authenticated;

-- ------------------------------------------------------------
--  8. Raising an NCR from a fault that has already been found.
--
--  The reason to build this inside Grid rather than beside it: the
--  inspection, the panel, the defect code and the photographs are
--  already here. In the spreadsheet an inspection and its NCR are two
--  unconnected records.
-- ------------------------------------------------------------
create or replace function raise_ncr_from_fault(
  p_failed_check uuid, p_severity ncr_severity default 'minor')
returns jsonb language plpgsql security invoker as $$
declare f failed_checks; i inspections; v_id uuid; v_ref text; v_desc text;
begin
  if not has_role('inspector','supervisor','quality_engineer','quality_manager','sysadmin') then
    raise exception 'NCR_ROLE: you do not have permission to raise an NCR';
  end if;

  select * into f from failed_checks where id = p_failed_check;
  if f.id is null then raise exception 'NCR_MISSING: that fault was not found'; end if;

  if exists (select 1 from ncrs where failed_check_id = p_failed_check) then
    raise exception 'NCR_DUPLICATE: an NCR has already been raised from %', f.ref;
  end if;

  select * into i from inspections where id = f.inspection_id;

  v_desc := coalesce(f.description, 'Failed checkpoint on ' || coalesce(i.ref, 'an inspection'));

  insert into ncrs (origin, inspection_id, failed_check_id, project_id, works_order_id,
                    part_description, details, raised_by, department_id, severity,
                    root_cause_id)
  values ('fault_list', i.id, f.id, i.project_id, i.works_order_id,
          coalesce(i.unit_ref, 'unit not recorded'),
          v_desc, auth.uid(), i.department_id, p_severity,
          -- carry the defect code across as a first guess at the cause, which
          -- is a guess and marked as one by leaving the detail empty
          (select rc.id from root_causes rc
             join defect_codes d on d.id = f.defect_code_id
            where lower(rc.name) = lower(d.description) limit 1))
  returning id, ref into v_id, v_ref;

  return jsonb_build_object('id', v_id, 'ref', v_ref, 'from', f.ref);
end $$;

grant execute on function raise_ncr_from_fault(uuid, ncr_severity) to authenticated;

-- ------------------------------------------------------------
--  9. Row level security.
-- ------------------------------------------------------------
alter table ncrs enable row level security;
alter table ncr_actions enable row level security;

-- Everyone signed in can read the register: an NCR nobody can see is an NCR
-- nobody acts on, and the whole point is visibility across departments.
create policy ncr_read on ncrs for select using (auth.uid() is not null);

create policy ncr_raise on ncrs for insert
  with check (raised_by = auth.uid()
              and has_role('inspector','supervisor','quality_engineer','quality_manager','sysadmin'));

create policy ncr_edit on ncrs for update
  using (
    closed_at is null
    and (raised_by = auth.uid()
         or person_responsible = auth.uid()
         or has_role('supervisor','quality_engineer','quality_manager','sysadmin'))
  )
  with check (true);

-- A closed NCR is a record. Reopening is a deliberate act by Quality, not an
-- edit, and deleting is nobody's.
revoke delete on ncrs from anon, authenticated;

create policy ncra_read on ncr_actions for select using (auth.uid() is not null);
create policy ncra_write on ncr_actions for insert
  with check (has_role('supervisor','quality_engineer','quality_manager','sysadmin'));
create policy ncra_edit on ncr_actions for update
  using (has_role('supervisor','quality_engineer','quality_manager','sysadmin'))
  with check (true);
create policy ncra_remove on ncr_actions for delete
  using (has_role('quality_engineer','quality_manager','sysadmin')
         and verified_at is null);

-- ------------------------------------------------------------
--  10. Audit. Same append-only trail as everything else.
-- ------------------------------------------------------------
drop trigger if exists trg_audit_ncrs on ncrs;
create trigger trg_audit_ncrs after insert or update on ncrs
  for each row execute function write_audit();

drop trigger if exists trg_audit_ncr_actions on ncr_actions;
create trigger trg_audit_ncr_actions after insert or update on ncr_actions
  for each row execute function write_audit();

-- ------------------------------------------------------------
--  11. Views for the register and the analysis the pivots did.
-- ------------------------------------------------------------
create or replace view v_ncr_list with (security_invoker = on) as
select n.id, n.ref, n.legacy_ref, n.status, n.severity, n.disposition, n.origin,
       n.part_description, n.part_no, n.qty, n.qty_unit,
       n.raised_at, n.closed_at, n.cost_total, n.supplier,
       d.name        as department,
       p.code        as project_code,
       rb.full_name  as raised_by_name,
       pr.full_name  as person_responsible_name,
       rc.name       as root_cause,
       rc.category   as cause_category,
       i.ref         as inspection_ref,
       (select count(*) from ncr_actions a where a.ncr_id = n.id)                  as actions,
       (select count(*) from ncr_actions a where a.ncr_id = n.id and a.verified_at is null) as actions_open,
       (current_date - n.raised_at::date)                                          as age_days
  from ncrs n
  left join departments d  on d.id = n.department_id
  left join projects p     on p.id = n.project_id
  left join profiles rb    on rb.id = n.raised_by
  left join profiles pr    on pr.id = n.person_responsible
  left join root_causes rc on rc.id = n.root_cause_id
  left join inspections i  on i.id = n.inspection_id;

grant select on v_ncr_list to authenticated;

-- Repeat defects by month — the sheet doing the most valuable work in the old
-- workbook, and the hardest to keep by hand.
create or replace view v_ncr_repeat with (security_invoker = on) as
select date_trunc('month', n.raised_at)::date as period,
       coalesce(rc.name, 'Cause not identified') as cause,
       coalesce(rc.category, 'Unknown')          as category,
       count(*)                                  as ncrs,
       sum(coalesce(n.cost_total, 0))            as cost,
       count(*) filter (where n.closed_at is null) as still_open
  from ncrs n
  left join root_causes rc on rc.id = n.root_cause_id
 group by 1, 2, 3;

grant select on v_ncr_repeat to authenticated;

-- By responsible department, and by supplier — the two pivots the monthly
-- review is built on.
create or replace view v_ncr_by_department with (security_invoker = on) as
select coalesce(d.name, 'Not allocated') as department,
       date_trunc('month', n.raised_at)::date as period,
       count(*) as ncrs,
       sum(coalesce(n.cost_total, 0)) as cost,
       count(*) filter (where n.closed_at is null) as still_open
  from ncrs n left join departments d on d.id = n.department_id
 group by 1, 2;

create or replace view v_ncr_by_supplier with (security_invoker = on) as
select n.supplier,
       date_trunc('month', n.raised_at)::date as period,
       count(*) as ncrs,
       sum(coalesce(n.cost_total, 0)) as cost,
       count(*) filter (where n.closed_at is null) as still_open
  from ncrs n
 where n.supplier is not null
 group by 1, 2;

grant select on v_ncr_by_department, v_ncr_by_supplier to authenticated;

-- ------------------------------------------------------------
--  12. Check it landed.
-- ------------------------------------------------------------
do $verify$
declare v_causes int; v_policies int;
begin
  select count(*) into v_causes from root_causes;
  if v_causes = 0 then raise exception 'Root causes were not seeded.'; end if;

  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename in ('ncrs','ncr_actions','root_causes');
  if v_policies < 8 then
    raise exception 'Expected at least 8 policies on the NCR tables, found %.', v_policies;
  end if;

  raise notice 'NCR schema ready: % root causes, % policies.', v_causes, v_policies;
end $verify$;
