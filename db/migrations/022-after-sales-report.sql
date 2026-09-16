-- ============================================================
--  ACTOM Grid — 022 the After Sales report
--
--  The report this supports already exists as a spreadsheet: customer
--  cares per month against a limit, response time against a limit,
--  defect type for the month, and a table of actions with deadlines.
--
--  ONE ACTIONS REGISTER, NOT TWO
--
--  The actions table on that report — Item, Action, Deadline, Status —
--  is the same shape as quality_actions, which 012 built for the monthly
--  inspection review. Building a second one would give this division two
--  places where a monthly action can live, and the first time somebody
--  looks for an action in the wrong one they stop trusting both.
--
--  So quality_actions gains a `module`, and the customer report reads its
--  own rows from the same register.
--
--  The three states are already right: open, monitoring, closed. The
--  After Sales report calls them Not yet started, Started and Completed.
--  Same three facts, different words, and the labels are a reporting
--  decision rather than a schema one — adding three more values so each
--  report can have its own vocabulary is how an enum reaches nine values
--  meaning three things.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.quality_actions') is null then
    raise exception '022 needs 012-dashboard.sql first (quality_actions is missing).';
  end if;
  if to_regclass('public.complaints') is null then
    raise exception '022 needs 019-customer-complaints.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Which review an action belongs to.
--
--  Defaulting to 'inspection' keeps every existing row where it is: the
--  monthly inspection review is where they were all raised.
-- ------------------------------------------------------------
alter table quality_actions
  add column if not exists module text not null default 'inspection'
    check (module in ('inspection', 'customer'));

-- An action may hang off a specific customer care, or off none — the
-- report shows both, and "Customer Response Time" as an item belongs to
-- the month rather than to any one care.
alter table quality_actions
  add column if not exists complaint_id uuid references complaints(id) on delete set null;

create index if not exists quality_actions_module_idx on quality_actions (module, period desc);

comment on column quality_actions.module is
  'Which monthly review raised this. One register, so an action cannot be '
  'filed in a place the person looking for it will not open.';

-- ------------------------------------------------------------
--  2. The monthly volume target.
--
--  The existing report draws a limit line on cares per month. 021 added
--  response_target_days; this is the other line on the same page.
-- ------------------------------------------------------------
alter table division_profile
  add column if not exists care_target_per_month smallint not null default 4;

comment on column division_profile.care_target_per_month is
  'The limit line on customer cares per month. Four is roughly where the '
  'existing After Sales report draws it against a 2026 monthly average of three.';

-- ------------------------------------------------------------
--  3. Cares per month, and response time per month.
--
--  Computed in the database rather than in the browser: the register is
--  capped at 500 rows on load, and a chart built from a capped list is a
--  chart that quietly stops counting.
-- ------------------------------------------------------------
create or replace view v_care_by_month with (security_invoker = on) as
select date_trunc('month', c.called_at)::date                    as period,
       count(*)                                                   as cares,
       count(*) filter (where c.responded_at is not null)          as answered,
       count(*) filter (where c.closed_at is not null)             as cleared,
       count(*) filter (where c.closed_at is null
                          and not c.legacy_closed)                 as still_open,
       -- Average days to first response, over the ones that HAVE one.
       -- Null where nothing was answered, rather than zero: the existing
       -- spreadsheet reports a zero for a month with no data, which reads
       -- as instant response.
       round(avg(extract(epoch from (c.responded_at - c.called_at)) / 86400.0)
             filter (where c.responded_at is not null)::numeric, 1) as avg_response_days,
       max(extract(epoch from (c.responded_at - c.called_at)) / 86400.0)
             filter (where c.responded_at is not null)              as worst_response_days,
       sum(coalesce(c.cost_total, 0))                              as cost
  from complaints c
 group by 1;

grant select on v_care_by_month to authenticated;

comment on view v_care_by_month is
  'Customer cares per month with average days to first response. '
  'avg_response_days is null for a month where nothing was answered — a '
  'zero there would read as an instant response, which is how the '
  'spreadsheet version flattered itself.';

-- ------------------------------------------------------------
--  4. Defect type for a month.
-- ------------------------------------------------------------
create or replace view v_care_by_defect with (security_invoker = on) as
select date_trunc('month', c.called_at)::date              as period,
       coalesce(dc.description, c.legacy_defect, 'not recorded') as defect,
       count(*)                                             as cares,
       sum(coalesce(c.cost_total, 0))                       as cost
  from complaints c
  left join defect_codes dc on dc.id = c.defect_code_id
 group by 1, 2;

grant select on v_care_by_defect to authenticated;

do $verify$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'quality_actions' and column_name = 'module') then
    raise exception 'quality_actions.module was not added.';
  end if;
  raise notice '022 applied. The After Sales report reads from v_care_by_month and v_care_by_defect, and its actions share the monthly register.';
end $verify$;
