-- ============================================================
--  ACTOM Grid — 030 calibration summary views + division profile
--
--  Adds the aggregate views that drive the calibration dashboard:
--  a summary by expiry bucket (mirrors the CALC pivot table in the
--  spreadsheet), instruments expiring per calendar month for the
--  next 12 months, and a division-level alert threshold column.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.v_instruments') is null then
    raise exception '030 needs 029-calibrations.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Alert threshold on division profile.
-- ------------------------------------------------------------
alter table division_profile
  add column if not exists cal_alert_days smallint not null default 90;

comment on column division_profile.cal_alert_days is
  'Instruments expiring within this many days are flagged in the '
  'top-bar alert chip. Default 90 matches the spreadsheet colour key.';

-- ------------------------------------------------------------
--  2. Summary by expiry bucket.
--
--  One row per bucket, ordered for display. Mirrors the CALC
--  sheet pivot: overdue first, then approaching expiry, then valid.
-- ------------------------------------------------------------
create or replace view v_calibration_summary with (security_invoker = on) as
select
  bucket,
  count(*)                                          as instruments,
  count(*) filter (where calibration_type = 'external') as external_count,
  count(*) filter (where calibration_type = 'internal') as internal_count,
  case bucket
    when 'overdue'        then 1
    when 'due_90d'        then 2
    when 'due_180d'       then 3
    when 'due_365d'       then 4
    when 'valid'          then 5
    when 'faulty_equipment' then 6
    when 'on_hold'        then 7
    when 'not_in_service' then 8
    when 'no_record'      then 9
    else                       10
  end                                               as sort_order
from v_instruments
where active = true
group by bucket
order by sort_order;

grant select on v_calibration_summary to authenticated;

comment on view v_calibration_summary is
  'Active instruments grouped by expiry bucket. '
  'Mirrors the pivot table on the CALC sheet of QA-REG-002.';

-- ------------------------------------------------------------
--  3. Instruments expiring per calendar month (next 12).
--
--  Used by the "upcoming calibrations" chart. Shows how many
--  instruments expire each month so resources can be planned.
--  Only active instruments with a calibration record are counted.
-- ------------------------------------------------------------
create or replace view v_calibration_due_by_month with (security_invoker = on) as
select
  date_trunc('month', expires_at)::date             as period,
  count(*)                                          as instruments,
  count(*) filter (where calibration_type = 'external') as external_count,
  count(*) filter (where calibration_type = 'internal') as internal_count
from v_instruments
where active = true
  and expires_at is not null
  and expires_at >= date_trunc('month', current_date)
  and expires_at <  date_trunc('month', current_date) + interval '12 months'
group by 1
order by 1;

grant select on v_calibration_due_by_month to authenticated;

-- ------------------------------------------------------------
--  4. Verification.
-- ------------------------------------------------------------
do $verify$
begin
  if to_regclass('public.v_calibration_summary') is null then
    raise exception '030: v_calibration_summary was not created.';
  end if;
  raise notice '030 applied. v_calibration_summary and v_calibration_due_by_month ready.';
end $verify$;
