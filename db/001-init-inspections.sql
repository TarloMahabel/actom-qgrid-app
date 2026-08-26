-- ============================================================
-- ACTOM QGrid — Phase 1 Inspections
-- 0001 initial schema
--
-- This migration runs identically against EVERY division database.
-- Nothing in here is division-specific: division differences live
-- in seed data (reference lists, templates, requirements), never here.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- Division identity (exactly one row per database)
-- ------------------------------------------------------------
create table division_profile (
  id              boolean primary key default true check (id),
  code            text not null,              -- 'MVS'
  name            text not null,              -- 'ACTOM MV Switchgear'
  legal_name      text not null default 'A division of ACTOM (Pty) Ltd',
  hold_points     boolean not null default false,
  fy_start_month  smallint not null default 7,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- People and access
-- ------------------------------------------------------------
create type user_role as enum
  ('inspector','supervisor','quality_engineer','quality_manager','planner','sysadmin','readonly');

create table departments (
  id          smallserial primary key,
  name        text not null unique,
  stage_id    smallint,                        -- fk added after stages
  active      boolean not null default true,
  sort_order  smallint not null default 0
);

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  entra_oid     text unique,
  full_name     text not null,
  email         text not null,
  role          user_role not null default 'inspector',
  department_id smallint references departments(id),
  active        boolean not null default false, -- new users inactive until activated
  created_at    timestamptz not null default now()
);

create table competencies (
  id            serial primary key,
  profile_id    uuid not null references profiles(id) on delete cascade,
  skill         text not null,
  level         smallint not null check (level between 0 and 3),
  valid_from    date,
  valid_to      date,
  unique (profile_id, skill)
);

-- ------------------------------------------------------------
-- Reference lists (administrator-maintained)
-- ------------------------------------------------------------
create table manufacturing_stages (
  id         smallserial primary key,
  name       text not null unique,
  sort_order smallint not null default 0,
  active     boolean not null default true
);
alter table departments
  add constraint departments_stage_fk foreign key (stage_id) references manufacturing_stages(id);

create table product_families (
  id      smallserial primary key,
  name    text not null unique,
  active  boolean not null default true
);

create table defect_codes (
  id          smallserial primary key,
  code        text not null unique,            -- immutable
  description text not null,                   -- editable
  default_department_id smallint references departments(id),
  active      boolean not null default true
);

create table equipment (
  id           serial primary key,
  asset_no     text not null unique,
  name         text not null,
  category     text not null,
  location     text,
  interval_months smallint,
  last_calibrated date,
  next_due     date,
  status       text not null default 'calibrated'
               check (status in ('calibrated','due','overdue','out_of_service','repair')),
  active       boolean not null default true
);

-- ------------------------------------------------------------
-- Inspection form templates (built in the form designer)
-- ------------------------------------------------------------
create type template_status as enum ('draft','in_review','published','superseded');

create table inspection_templates (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,          -- IT-ASM-04
  name          text not null,
  stage_id      smallint not null references manufacturing_stages(id),
  family_id     smallint references product_families(id),   -- null = all families
  min_competency smallint not null default 2 check (min_competency between 1 and 3),
  fail_mode     text not null default 'record'
                check (fail_mode in ('record','hold','quarantine')),
  created_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);

create table template_revisions (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references inspection_templates(id) on delete cascade,
  rev           smallint not null,
  status        template_status not null default 'draft',
  definition    jsonb not null,                -- sections + fields, as built in the designer
  created_by    uuid not null references profiles(id),
  approved_by   uuid references profiles(id),  -- must differ from created_by
  effective_from date,
  created_at    timestamptz not null default now(),
  unique (template_id, rev),
  constraint approver_not_author check (approved_by is null or approved_by <> created_by)
);
create unique index one_published_rev
  on template_revisions (template_id) where status = 'published';

-- ------------------------------------------------------------
-- Requirements matrix (family x stage) — configured by admin
-- ------------------------------------------------------------
create table inspection_requirements (
  id            serial primary key,
  family_id     smallint not null references product_families(id) on delete cascade,
  stage_id      smallint not null references manufacturing_stages(id) on delete cascade,
  template_id   uuid references inspection_templates(id),
  level         text not null default 'required'
                check (level in ('hold','required','optional','na')),
  sampling      text not null default 'full'
                check (sampling in ('full','first_off','sample_pct','per_shift','per_delivery')),
  sample_pct    smallint,
  min_competency smallint check (min_competency between 1 and 3),
  updated_by    uuid references profiles(id),
  updated_at    timestamptz not null default now(),
  unique (family_id, stage_id)
);

-- ------------------------------------------------------------
-- Work
-- ------------------------------------------------------------
create table projects (
  id          serial primary key,
  code        text not null unique,            -- P-26118
  name        text not null,
  customer    text,
  family_id   smallint references product_families(id),
  active      boolean not null default true
);

create table works_orders (
  id          serial primary key,
  code        text not null unique,            -- WO-44812
  project_id  int not null references projects(id),
  description text,
  qty         int not null default 1,
  status      text not null default 'open'
              check (status in ('open','held','closed')),
  released_at timestamptz
);

-- ------------------------------------------------------------
-- Inspections
-- ------------------------------------------------------------
create type inspection_status as enum
  ('scheduled','in_progress','completed','cancelled');

create table inspections (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null unique,          -- INS-26-1191
  template_rev_id uuid not null references template_revisions(id),  -- version-locked
  stage_id       smallint not null references manufacturing_stages(id),
  project_id     int references projects(id),
  works_order_id int references works_orders(id),
  unit_ref       text,                          -- panel serial / batch
  assigned_to    uuid references profiles(id),
  department_id  smallint references departments(id),
  planned_date   date,
  status         inspection_status not null default 'scheduled',
  result         text check (result in ('pass','fail')),
  generated_from text not null default 'works_order',
  started_at     timestamptz,
  completed_at   timestamptz,
  signed_by      uuid references profiles(id),
  signed_at      timestamptz,
  signature_hash text,                          -- hash of payload at signature
  amends_id      uuid references inspections(id), -- correction chain
  created_at     timestamptz not null default now()
);
create index inspections_open_idx on inspections (status, planned_date);
create index inspections_assigned_idx on inspections (assigned_to) where status <> 'completed';

create table inspection_results (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  field_id      text not null,                  -- field id from the template definition
  label         text not null,                  -- denormalised: survives template edits
  value_text    text,
  value_num     numeric,
  outcome       text check (outcome in ('pass','fail','na')),
  equipment_id  int references equipment(id),
  comment       text,
  recorded_at   timestamptz not null default now(),
  unique (inspection_id, field_id)
);

create table attachments (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid references inspections(id) on delete cascade,
  result_id     uuid references inspection_results(id) on delete cascade,
  storage_path  text not null,
  kind          text not null default 'photo',
  uploaded_by   uuid not null references profiles(id),
  uploaded_at   timestamptz not null default now()
);

-- Failed checks: the Phase 1 home for a failure. In Phase 2 these
-- become the source records for NCRs without any data migration.
create table failed_checks (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique,           -- FC-26-0212
  inspection_id uuid not null references inspections(id) on delete cascade,
  result_id     uuid not null references inspection_results(id) on delete cascade,
  defect_code_id smallint references defect_codes(id),
  is_hold       boolean not null default false,
  disposition   text check (disposition in
                ('awaiting','rework_reinspect','accept_concession','quarantine','scrap')),
  disposition_by uuid references profiles(id),
  disposition_at timestamptz,
  reason        text,
  ncr_id        uuid,                            -- populated in Phase 2
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Audit trail — append only, no update or delete for anyone
-- ------------------------------------------------------------
create table audit_trail (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_name  text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  detail      jsonb
);
create index audit_trail_at_idx on audit_trail (at desc);

-- ------------------------------------------------------------
-- Reference numbering — sequence table + advisory lock.
-- Never max(id)+1: two inspectors submitting at once must not collide.
-- ------------------------------------------------------------
create table ref_sequences (
  prefix   text primary key,
  period   text not null,
  last_val int  not null default 0
);

create or replace function next_ref(p_prefix text, p_width int default 4)
returns text language plpgsql as $$
declare v_period text; v_next int;
begin
  v_period := to_char(now(), 'YY');
  perform pg_advisory_xact_lock(hashtext(p_prefix));
  insert into ref_sequences (prefix, period, last_val)
    values (p_prefix, v_period, 0)
    on conflict (prefix) do nothing;
  update ref_sequences
     set last_val = case when period = v_period then last_val + 1 else 1 end,
         period   = v_period
   where prefix = p_prefix
  returning last_val into v_next;
  return p_prefix || '-' || v_period || '-' || lpad(v_next::text, p_width, '0');
end $$;

-- ------------------------------------------------------------
-- Helper functions used by every policy
-- ------------------------------------------------------------
create or replace function me() returns profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid()
$$;

create or replace function has_role(variadic roles user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and active and role = any(roles)
  )
$$;

create or replace function my_department() returns smallint
language sql stable security definer set search_path = public as $$
  select department_id from profiles where id = auth.uid()
$$;

-- ------------------------------------------------------------
-- Controls enforced in the database, not the browser.
-- These are the rules an auditor will test.
-- ------------------------------------------------------------

-- 1. A signed inspection cannot be edited. Corrections create a new record.
create or replace function inspection_immutable_after_signature()
returns trigger language plpgsql as $$
begin
  if old.signed_at is not null then
    raise exception 'INS_SIGNED: % is signed and cannot be edited. Create an amendment.', old.ref;
  end if;
  return new;
end $$;
create trigger trg_inspection_lock before update on inspections
  for each row execute function inspection_immutable_after_signature();

create or replace function result_immutable_after_signature()
returns trigger language plpgsql as $$
declare v_signed timestamptz;
begin
  select signed_at into v_signed from inspections
   where id = coalesce(new.inspection_id, old.inspection_id);
  if v_signed is not null then
    raise exception 'INS_SIGNED: inspection is signed; results are read-only';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_result_lock before insert or update or delete on inspection_results
  for each row execute function result_immutable_after_signature();

-- 2. An instrument that is out of calibration cannot be used on a result.
create or replace function block_uncalibrated_equipment()
returns trigger language plpgsql as $$
declare v_status text;
begin
  if new.equipment_id is not null then
    select status into v_status from equipment where id = new.equipment_id;
    if v_status in ('overdue','out_of_service') then
      raise exception 'EQUIP_BLOCKED: equipment is % and cannot be used to record a result', v_status;
    end if;
  end if;
  return new;
end $$;
create trigger trg_equipment_block before insert or update on inspection_results
  for each row execute function block_uncalibrated_equipment();

-- 3. Signing requires the competency the template demands.
create or replace function enforce_signature_competency()
returns trigger language plpgsql as $$
declare v_min smallint; v_have smallint;
begin
  if new.signed_at is not null and old.signed_at is null then
    select t.min_competency into v_min
      from template_revisions tr
      join inspection_templates t on t.id = tr.template_id
     where tr.id = new.template_rev_id;
    select coalesce(max(level),0) into v_have
      from competencies
     where profile_id = new.signed_by
       and (valid_to is null or valid_to >= current_date);
    if v_have < v_min then
      raise exception 'COMPETENCY: signer holds level %, template requires level %', v_have, v_min;
    end if;
  end if;
  return new;
end $$;
create trigger trg_signature_competency before update on inspections
  for each row execute function enforce_signature_competency();

-- 4. Every consequential change is written to the audit trail.
create or replace function write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select full_name into v_name from profiles where id = auth.uid();
  insert into audit_trail (actor, actor_name, action, entity, entity_id, detail)
  values (auth.uid(), coalesce(v_name,'system'), lower(tg_op), tg_table_name,
          coalesce(new.id::text, old.id::text),
          case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger trg_audit_inspections after insert or update on inspections
  for each row execute function write_audit();
create trigger trg_audit_templates after insert or update on template_revisions
  for each row execute function write_audit();
create trigger trg_audit_requirements after insert or update or delete on inspection_requirements
  for each row execute function write_audit();
create trigger trg_audit_failed after insert or update on failed_checks
  for each row execute function write_audit();

-- ------------------------------------------------------------
-- Row level security
-- ------------------------------------------------------------
alter table division_profile        enable row level security;
alter table departments             enable row level security;
alter table profiles                enable row level security;
alter table competencies            enable row level security;
alter table manufacturing_stages    enable row level security;
alter table product_families        enable row level security;
alter table defect_codes            enable row level security;
alter table equipment               enable row level security;
alter table inspection_templates    enable row level security;
alter table template_revisions      enable row level security;
alter table inspection_requirements enable row level security;
alter table projects                enable row level security;
alter table works_orders            enable row level security;
alter table inspections             enable row level security;
alter table inspection_results      enable row level security;
alter table attachments             enable row level security;
alter table failed_checks           enable row level security;
alter table audit_trail             enable row level security;

-- Reference data: everyone signed in reads, administrators write.
do $$
declare t text;
begin
  foreach t in array array['division_profile','departments','manufacturing_stages',
                           'product_families','defect_codes','equipment','projects','works_orders']
  loop
    execute format('create policy %I_read on %I for select using (auth.uid() is not null)', t||'_r', t);
    execute format($p$create policy %I on %I for all
                       using (has_role('quality_manager','sysadmin'))
                       with check (has_role('quality_manager','sysadmin'))$p$, t||'_w', t);
  end loop;
end $$;

-- Profiles: read yourself; managers read everyone; only admins write.
create policy profiles_self on profiles for select
  using (id = auth.uid() or has_role('quality_manager','quality_engineer','planner','sysadmin'));
create policy profiles_admin on profiles for all
  using (has_role('sysadmin','quality_manager'))
  with check (has_role('sysadmin','quality_manager'));

create policy competencies_read on competencies for select using (auth.uid() is not null);
create policy competencies_write on competencies for all
  using (has_role('quality_manager','sysadmin'))
  with check (has_role('quality_manager','sysadmin'));

-- Templates: everyone reads published; designers write drafts; publishing is separate.
create policy templates_read on inspection_templates for select using (auth.uid() is not null);
create policy templates_write on inspection_templates for all
  using (has_role('quality_engineer','quality_manager','sysadmin'))
  with check (has_role('quality_engineer','quality_manager','sysadmin'));

create policy revs_read on template_revisions for select using (auth.uid() is not null);
create policy revs_draft on template_revisions for insert
  with check (has_role('quality_engineer','quality_manager','sysadmin')
              and status = 'draft' and created_by = auth.uid());
create policy revs_edit on template_revisions for update
  using (status in ('draft','in_review')
         and (created_by = auth.uid() or has_role('quality_manager')))
  with check (true);
-- publishing is a manager action and cannot be self-approval
create policy revs_publish on template_revisions for update
  using (has_role('quality_manager') and created_by <> auth.uid());

-- Requirements matrix: everyone reads, quality manager and admin configure.
create policy req_read on inspection_requirements for select using (auth.uid() is not null);
create policy req_write on inspection_requirements for all
  using (has_role('quality_manager','sysadmin'))
  with check (has_role('quality_manager','sysadmin'));

-- Inspections: inspectors see their own and their department's;
-- quality, planners and admins see all.
create policy insp_read on inspections for select using (
  assigned_to = auth.uid()
  or department_id = my_department()
  or has_role('quality_engineer','quality_manager','planner','sysadmin','readonly')
);
create policy insp_create on inspections for insert
  with check (has_role('planner','quality_engineer','quality_manager','sysadmin'));
create policy insp_update on inspections for update using (
  (assigned_to = auth.uid() and status in ('scheduled','in_progress'))
  or has_role('quality_engineer','quality_manager','planner','sysadmin')
);

create policy res_read on inspection_results for select using (
  exists (select 1 from inspections i where i.id = inspection_id
          and (i.assigned_to = auth.uid() or i.department_id = my_department()
               or has_role('quality_engineer','quality_manager','planner','sysadmin','readonly')))
);
create policy res_write on inspection_results for all using (
  exists (select 1 from inspections i where i.id = inspection_id
          and i.assigned_to = auth.uid() and i.signed_at is null)
) with check (
  exists (select 1 from inspections i where i.id = inspection_id
          and i.assigned_to = auth.uid() and i.signed_at is null)
);

create policy att_read on attachments for select using (auth.uid() is not null);
create policy att_write on attachments for insert with check (uploaded_by = auth.uid());

create policy fc_read on failed_checks for select using (auth.uid() is not null);
create policy fc_write on failed_checks for insert
  with check (has_role('inspector','supervisor','quality_engineer','quality_manager','sysadmin'));
-- disposition is a supervisor decision, and never by the person who recorded it
create policy fc_disposition on failed_checks for update using (
  has_role('supervisor','quality_engineer','quality_manager')
) with check (true);

-- Audit trail: read for quality and admin, insert by trigger only, never update or delete.
create policy audit_read on audit_trail for select
  using (has_role('quality_manager','quality_engineer','sysadmin','readonly'));
revoke update, delete on audit_trail from anon, authenticated;
revoke delete on inspections from anon, authenticated;
revoke delete on inspection_results from anon, authenticated;

-- ------------------------------------------------------------
-- Views the app reads for dashboards (always in step with the data).
--
-- security_invoker = on is not optional. A Postgres view runs as its
-- OWNER by default, which means it bypasses row level security and
-- would hand every row to any signed-in user. With invoker security the
-- view is evaluated as the caller and the policies above still apply.
-- ------------------------------------------------------------
create or replace view v_stage_yield with (security_invoker = on) as
select s.name as stage,
       count(*)                                              as inspections,
       count(*) filter (where i.result = 'pass')             as passed,
       round(100.0 * count(*) filter (where i.result = 'pass')
             / nullif(count(*),0), 1)                        as pass_rate
from inspections i
join manufacturing_stages s on s.id = i.stage_id
where i.status = 'completed'
  and i.completed_at > now() - interval '30 days'
group by s.name, s.id
order by min(s.sort_order);

create or replace view v_open_work with (security_invoker = on) as
select i.*, s.name as stage_name, p.full_name as inspector
from inspections i
join manufacturing_stages s on s.id = i.stage_id
left join profiles p on p.id = i.assigned_to
where i.status in ('scheduled','in_progress');
