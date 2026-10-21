-- ============================================================
--  ACTOM Grid — 035 report layout
--
--  Adds a layout column to saved_reports so that a report can
--  store a multi-widget canvas definition (the report designer).
--
--  layout: { widgets: [{ id, type, title, col, row, w, h,
--                        view, x_col, y_col, filters }] }
-- ============================================================

do $prereq$
begin
  if to_regclass('public.saved_reports') is null then
    raise exception '035 needs 031-report-builder.sql first.';
  end if;
end $prereq$;

alter table saved_reports
  add column if not exists layout jsonb;

do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'saved_reports' and column_name = 'layout'
  ) then
    raise exception '035: layout column was not added to saved_reports.';
  end if;
  raise notice '035 applied. saved_reports now carries a layout column for the report designer.';
end $verify$;
