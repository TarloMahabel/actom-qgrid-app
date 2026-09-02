-- ============================================================
--  ACTOM Grid — 012 faults per project, and the actions arising
--
--  Two things the monthly quality review needs and the schema could not
--  answer.
--
--  1. GROUPING. The chart shows "Labelling & Identification" as one bar
--     segment, but that is two defect codes (incorrect labels, missing
--     labels). Several codes roll up into one thing people talk about, so
--     defect_codes gets a category. Without it the legend has fourteen
--     entries and says nothing.
--
--     The code stays the unit of RECORD — analytics group by code, and an
--     inspector picks a code. The category is only how codes are
--     presented together.
--
--  2. THE ACTIONS. A Pareto with no actions against it is a chart nobody
--     acts on. The table under the chart — item, action, deadline, status
--     — is the part that changes anything, so it is stored, not typed
--     into a slide each month.
-- ============================================================

-- ------------------------------------------------------------
--  PREREQUISITES. Run migrations in order.
--
--  Without this, a missing earlier migration shows up as a raw error
--  about a column that does not exist, several statements in, with
--  nothing saying which file to run first.
-- ------------------------------------------------------------
do $prereq$
begin
  if not exists (select 1 from information_schema.columns
                where table_name = 'failed_checks' and column_name = 'verified_by') then
    raise exception '012 needs 011-fault-clearing.sql first (failed_checks.verified_by is missing).';
  end if;
  if not exists (select 1 from information_schema.columns
                where table_name = 'failed_checks' and column_name = 'source') then
    raise exception '012 needs 008-fault-list.sql first (failed_checks.source is missing).';
  end if;
end $prereq$;


alter table defect_codes
  add column if not exists category text;

comment on column defect_codes.category is
  'How this code is grouped for reporting. Several codes share a category — '
  'incorrect and missing labels are both Labelling & Identification. Codes '
  'remain the unit of record; the category is only presentation.';

-- Anything without a category groups under its own description, so nothing
-- disappears from a chart because somebody has not categorised it yet.
update defect_codes set category = description where category is null;

-- ------------------------------------------------------------
--  Faults per project, by category and month.
--
--  Counts BOTH kinds of defect — a failed checkpoint and a line typed on
--  a fault list — because splitting them would mean two charts of the
--  same thing.
-- ------------------------------------------------------------
create or replace view v_faults_by_project with (security_invoker = on) as
select date_trunc('month', f.created_at)::date        as period,
       p.id                                           as project_id,
       p.code                                         as project_code,
       p.name                                         as project_name,
       coalesce(d.category, d.description, 'Uncoded') as category,
       count(*)                                       as faults,
       count(*) filter (where f.verified_by is null)  as outstanding
  from failed_checks f
  join inspections i on i.id = f.inspection_id
  left join projects p on p.id = i.project_id
  left join defect_codes d on d.id = f.defect_code_id
 group by 1, 2, 3, 4, 5;

grant select on v_faults_by_project to authenticated;

-- ------------------------------------------------------------
--  Actions arising from the review.
-- ------------------------------------------------------------
create table if not exists quality_actions (
  id          bigserial primary key,
  period      date not null,                 -- the month it was raised for
  seq         smallint,
  item        text not null check (length(btrim(item)) > 0),
  action      text not null check (length(btrim(action)) > 0),
  owner_id    uuid references profiles(id),
  deadline    date,
  status      text not null default 'open'
              check (status in ('open', 'monitoring', 'closed')),
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists quality_actions_period_idx on quality_actions (period, seq);

comment on table quality_actions is
  'What was decided about the faults, month by month. A Pareto with no '
  'actions against it is a chart nobody acts on.';

alter table quality_actions enable row level security;

create policy qa_read on quality_actions for select
  using (auth.uid() is not null);

create policy qa_write on quality_actions for insert
  with check (has_role('quality_engineer', 'quality_manager', 'supervisor', 'sysadmin'));

create policy qa_edit on quality_actions for update
  using (has_role('quality_engineer', 'quality_manager', 'supervisor', 'sysadmin'))
  with check (true);

create policy qa_remove on quality_actions for delete
  using (has_role('quality_manager', 'sysadmin'));

-- Closing an action stamps when, from the database rather than the browser.
create or replace function stamp_action_closed()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.closed_at := case when new.status = 'closed' then now() else null end;
  end if;
  return new;
end $$;

drop trigger if exists trg_action_closed on quality_actions;
create trigger trg_action_closed
  before update on quality_actions
  for each row execute function stamp_action_closed();
