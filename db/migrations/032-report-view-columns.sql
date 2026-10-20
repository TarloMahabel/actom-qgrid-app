-- ============================================================
--  ACTOM Grid — 032 report view column introspection
--
--  The report builder needs to show the available columns for a
--  given view before any data exists in that view. A limit(1)
--  query returns [] for empty views so column detection fails.
--
--  This function queries information_schema.columns instead.
--  It is security definer so it can read information_schema,
--  but it gates on report_allowed_views so callers cannot
--  introspect arbitrary tables.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.report_allowed_views') is null then
    raise exception '032 needs 031-report-builder.sql first.';
  end if;
end $prereq$;

create or replace function get_report_view_columns(p_view text)
returns table(column_name text, data_type text, ordinal_position integer)
security definer
stable
language sql
as $$
  select
    c.column_name::text,
    c.data_type::text,
    c.ordinal_position::integer
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name   = p_view
    and exists (
      select 1 from report_allowed_views rav
      where rav.view_name = p_view
    )
  order by c.ordinal_position;
$$;

grant execute on function get_report_view_columns(text) to authenticated;

comment on function get_report_view_columns(text) is
  'Returns column names for a whitelisted report view regardless '
  'of whether the view contains data. Callers cannot introspect '
  'views that are not in report_allowed_views.';

do $verify$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_report_view_columns'
  ) then
    raise exception '032: get_report_view_columns was not created.';
  end if;
  raise notice '032 applied. get_report_view_columns ready.';
end $verify$;
