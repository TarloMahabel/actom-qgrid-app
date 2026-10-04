-- ============================================================
--  ACTOM QMS 360 — 024 inspections by month
--
--  The design brief's dashboard is built around a wide monthly comparison
--  chart: two series side by side, month by month. Nothing in the
--  database gave inspections by month, and the brief is explicit about
--  not fabricating data -- so this provides the figure rather than the
--  chart inventing one.
--
--  THE SAME DEFINITION AS THE HEADLINE FIGURE. "Passed first time" here is
--  exactly what v_dashboard.pass_rate_30d and v_scorecard.fpy_30d count:
--  completed inspections whose result is 'pass'. A monthly chart that used
--  a different rule from the first-pass-yield card above it would show
--  two numbers that cannot be reconciled, and the first question at the
--  monthly review would be which one is right.
--
--  Twelve months, counted from the first of the month eleven months ago,
--  so the current month is always the last bar and is visibly partial
--  rather than missing.
--
--  No DO blocks: this pastes into the Supabase SQL editor as it stands.
-- ============================================================

create or replace view v_inspections_by_month with (security_invoker = on) as
select date_trunc('month', completed_at)::date                           as period,
       count(*)                                                           as completed,
       count(*) filter (where result = 'pass')                            as passed,
       round(100.0 * count(*) filter (where result = 'pass')
             / nullif(count(*), 0), 1)                                    as fpy
  from inspections
 where status = 'completed'
   and completed_at >= date_trunc('month', now()) - interval '11 months'
 group by 1;

grant select on v_inspections_by_month to authenticated;

comment on view v_inspections_by_month is
  'Completed inspections and those passed first time, per month, for the '
  'last twelve months. Same definition as v_scorecard.fpy_30d, so the '
  'dashboard''s chart and its headline figure always reconcile.';

notify pgrst, 'reload schema';
