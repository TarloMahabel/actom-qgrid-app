-- ============================================================
--  ACTOM Grid — 031 report builder
--
--  Users can define, save and rerun tabular reports against any
--  of the module views. A report is a stored query definition:
--  which view, which columns, which filters, which sort. The app
--  runs it as a PostgREST query and renders the results as a
--  paginated table that can be exported as CSV or Excel.
--
--  DESIGN DECISIONS
--
--  STORED DEFINITION, NOT STORED RESULTS
--  The report definition is stored; the data is always live.
--  A report that caches results goes stale and people lose faith
--  in it. The app re-runs the query each time the report is opened.
--
--  JSON COLUMNS FOR FLEXIBLE SCHEMA
--  columns and filters are jsonb arrays. This avoids a separate
--  report_columns table and lets the schema evolve without a
--  migration each time a new filter operator is added.
--
--  columns: [{key, label, type, format?, width?}]
--    key    = the view column name (e.g. "serial_number")
--    label  = display header the user gave it
--    type   = "text" | "number" | "date" | "boolean"
--    format = optional display format (e.g. "date:YYYY-MM-DD")
--    width  = optional column width hint in pixels
--
--  filters: [{column, op, value}]
--    op     = "eq" | "neq" | "lt" | "lte" | "gt" | "gte"
--             | "like" | "ilike" | "is" | "in" | "not_in"
--
--  BASE VIEWS ALLOWED
--  Reports can only query the published views listed in
--  report_allowed_views. This prevents arbitrary SQL and keeps
--  RLS in effect (all views use security_invoker = on).
-- ============================================================

do $prereq$
begin
  if to_regclass('public.profiles') is null then
    raise exception '031 needs 001-init-inspections.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Allowed base views.
--
--  The app's "new report" picker shows only these. Add new views
--  here when a module is released — no migration required for the
--  report builder itself.
-- ------------------------------------------------------------
create table if not exists report_allowed_views (
  view_name    text primary key,
  label        text not null,
  module       text not null,
  sort_order   smallint not null default 99
);

insert into report_allowed_views (view_name, label, module, sort_order) values
  ('v_instruments',           'Instrument Calibration Register', 'calibration', 1),
  ('v_calibration_summary',   'Calibration Summary by Bucket',   'calibration', 2),
  ('v_ncr_list',              'NCR Register',                    'ncr',         3),
  ('v_complaints',            'Customer Care Register',          'customer',    4),
  ('v_care_by_month',         'Customer Cares by Month',         'customer',    5),
  ('v_scorecard',             'Executive Scorecard',             'dashboard',   6),
  ('v_cost_of_quality',       'Cost of Quality',                 'dashboard',   7),
  ('v_inspections_by_month',  'Inspections by Month',            'inspection',  8)
on conflict (view_name) do update
  set label      = excluded.label,
      module     = excluded.module,
      sort_order = excluded.sort_order;

alter table report_allowed_views enable row level security;
revoke all on report_allowed_views from anon, authenticated;
grant select on report_allowed_views to authenticated;
create policy report_views_read on report_allowed_views for select using (auth.uid() is not null);

-- ------------------------------------------------------------
--  2. Saved reports.
-- ------------------------------------------------------------
create table if not exists saved_reports (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  base_view     text not null references report_allowed_views(view_name),
  columns       jsonb not null default '[]'::jsonb,
  filters       jsonb not null default '[]'::jsonb,
  sort_column   text,
  sort_direction text check (sort_direction in ('asc','desc')),
  is_shared     boolean not null default false,
  created_by    uuid not null references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists saved_reports_owner_idx  on saved_reports (created_by, updated_at desc);
create index if not exists saved_reports_shared_idx on saved_reports (is_shared, updated_at desc);

alter table saved_reports enable row level security;
revoke all on saved_reports from anon, authenticated;
grant select, insert, update, delete on saved_reports to authenticated;

-- Owner can always read and modify their own reports.
create policy saved_reports_own on saved_reports
  using (created_by = auth.uid());

-- Anyone can read shared reports.
create policy saved_reports_shared_read on saved_reports
  for select using (is_shared = true and auth.uid() is not null);

create or replace function touch_saved_report()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_touch_saved_report on saved_reports;
create trigger trg_touch_saved_report
  before update on saved_reports
  for each row execute function touch_saved_report();

-- ------------------------------------------------------------
--  3. Verification.
-- ------------------------------------------------------------
do $verify$
begin
  if to_regclass('public.saved_reports') is null then
    raise exception '031: saved_reports table was not created.';
  end if;
  if (select count(*) from report_allowed_views) = 0 then
    raise exception '031: report_allowed_views is empty.';
  end if;
  raise notice '031 applied. Report builder ready. % allowed views registered.',
    (select count(*) from report_allowed_views);
end $verify$;
