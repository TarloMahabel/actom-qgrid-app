-- ============================================================
--  ACTOM Grid — 034 report chart config
--
--  Adds chart configuration columns to saved_reports so that
--  a user's chosen chart type and axis selections are saved
--  as part of the report definition rather than being ephemeral
--  run-time state.
--
--  chart_type   : "none" | "bar" | "pie" | "trend"
--  chart_x      : view column to use as the category / x axis
--  chart_y      : view column to aggregate, or "__count__"
-- ============================================================

do $prereq$
begin
  if to_regclass('public.saved_reports') is null then
    raise exception '034 needs 031-report-builder.sql first.';
  end if;
end $prereq$;

alter table saved_reports
  add column if not exists chart_type   text check (chart_type in ('none','bar','pie','trend')) default 'none',
  add column if not exists chart_x      text,
  add column if not exists chart_y      text;

do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'saved_reports' and column_name = 'chart_type'
  ) then
    raise exception '034: chart_type column was not added to saved_reports.';
  end if;
  raise notice '034 applied. saved_reports now carries chart_type, chart_x, chart_y.';
end $verify$;
