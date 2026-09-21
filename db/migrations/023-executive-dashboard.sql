-- ============================================================
--  ACTOM Grid — 023 the executive dashboard
--
--  One page answering "how is quality doing", drawn from the modules
--  that exist. Two things in here are about honesty rather than
--  arithmetic, and they are the reason it is a migration rather than
--  three lines of JavaScript.
--
--  COST OF QUALITY IS A TOTAL, NOT A PERCENTAGE.
--
--  The usual figure is cost of quality as a share of production value.
--  This system does not know production value — it inspects panels, it
--  does not invoice them — and a percentage against a denominator
--  nobody has is a number that will be quoted in a board pack and
--  cannot be defended. So the view reports Rands, from the records that
--  actually carry a cost, and says how many records that is. A total of
--  R1.34m across 40 records out of 300 is a different claim from R1.34m,
--  and the second one is the one that gets believed.
--
--  THE FINANCIAL YEAR IS THE DIVISION'S.
--
--  division_profile already carries fy_start_month. Reporting "year to
--  date" on a calendar year when the division closes its books in
--  another month produces a number that disagrees with finance, and the
--  quality department loses that argument every time.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.complaints') is null then
    raise exception '023 needs 019-customer-complaints.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. What good looks like.
--
--  Targets on the division rather than in the code: they differ by
--  division and by year, and a number the app hardcodes is a number
--  nobody can change without a release.
-- ------------------------------------------------------------
alter table division_profile
  add column if not exists fpy_target numeric(4,1) not null default 97.0;

comment on column division_profile.fpy_target is
  'First pass yield target, as a percentage. The dashboard draws against '
  'it. 97 is what the existing reporting uses.';

-- ------------------------------------------------------------
--  2. Cost of quality, financial year to date.
--
--  Both sources, separately as well as together, because "is this
--  costing us more in nonconformance or in customer complaints" is the
--  question, and one combined figure cannot answer it.
-- ------------------------------------------------------------
create or replace function fy_start(p_on date default current_date)
returns date language sql stable as $$
  select make_date(
    case when extract(month from p_on)::int
              >= coalesce((select fy_start_month from division_profile limit 1), 1)
         then extract(year from p_on)::int
         else extract(year from p_on)::int - 1 end,
    coalesce((select fy_start_month from division_profile limit 1), 1),
    1);
$$;

grant execute on function fy_start(date) to authenticated;

create or replace view v_cost_of_quality with (security_invoker = on) as
select 'Nonconformance'::text                      as source,
       count(*)                                     as records,
       count(*) filter (where coalesce(n.cost_total,0) > 0) as records_with_cost,
       coalesce(sum(n.cost_total), 0)               as cost
  from ncrs n
 where n.raised_at >= fy_start()
union all
select 'Customer cares',
       count(*),
       count(*) filter (where coalesce(c.cost_total,0) > 0),
       coalesce(sum(c.cost_total), 0)
  from complaints c
 where c.called_at >= fy_start();

grant select on v_cost_of_quality to authenticated;

comment on view v_cost_of_quality is
  'Cost of quality for the division financial year to date, by source. '
  'records_with_cost is reported alongside because a total drawn from a '
  'fifth of the records is a different claim from the same total drawn '
  'from all of them, and the difference is what makes it defensible.';

-- ------------------------------------------------------------
--  3. One row the dashboard can open with.
--
--  Computed here rather than in the browser because the registers are
--  capped on load, and a headline figure built from a capped list is a
--  headline figure that quietly stops counting.
-- ------------------------------------------------------------
create or replace view v_scorecard with (security_invoker = on) as
select
  -- Inspections
  (select round(100.0 * count(*) filter (where result = 'pass') / nullif(count(*),0), 1)
     from inspections
    where status = 'completed' and completed_at > now() - interval '30 days')  as fpy_30d,
  (select count(*) from inspections
    where status = 'completed' and completed_at > now() - interval '30 days')  as inspections_30d,
  (select count(*) from inspections where status in ('scheduled','in_progress')) as inspections_open,
  (select count(*) from inspections
    where status = 'scheduled' and planned_date < current_date)                as inspections_overdue,
  (select count(*) from failed_checks where disposition = 'awaiting')          as faults_awaiting,

  -- Nonconformance. `open` here means not closed, which is the question
  -- people ask; `open` is only the first rung of the status ladder.
  (select count(*) from ncrs where closed_at is null)                          as ncrs_open,
  (select count(*) from ncrs where closed_at is null and severity = 'major')   as ncrs_major,
  (select count(*) from ncrs where closed_at is null and severity = 'critical') as ncrs_critical,
  (select count(*) from ncrs
    where closed_at is null and raised_at < now() - interval '30 days')        as ncrs_over_30d,
  (select count(*) from ncrs
    where closed_at is null and root_cause_id is null)                         as ncrs_no_cause,

  -- Customer cares
  (select count(*) from complaints
    where closed_at is null and not legacy_closed)                             as cares_open,
  (select count(*) from complaints
    where closed_at is null and not legacy_closed and responded_at is null)    as cares_no_reply,
  (select round(avg(extract(epoch from (responded_at - called_at)) / 86400.0)::numeric, 1)
     from complaints
    where responded_at is not null and called_at >= fy_start())                as care_response_days,

  -- Money
  (select coalesce(sum(cost), 0) from v_cost_of_quality)                       as cost_of_quality,
  (select coalesce(sum(records_with_cost), 0) from v_cost_of_quality)          as cost_records,
  (select coalesce(sum(records), 0) from v_cost_of_quality)                    as cost_population,
  fy_start()                                                                   as fy_from;

grant select on v_scorecard to authenticated;

comment on view v_scorecard is
  'The executive dashboard in one row. Every figure comes from records '
  'captured in a module that exists — nothing here is estimated, and no '
  'figure is shown for a module that has not been built, because a zero '
  'against Calibration would read as nothing overdue rather than as '
  'nobody tracking it.';

do $verify$
begin
  if to_regclass('public.v_scorecard') is null then
    raise exception 'v_scorecard was not created.';
  end if;
  raise notice '023 applied. The executive dashboard reads v_scorecard and v_cost_of_quality.';
end $verify$;
