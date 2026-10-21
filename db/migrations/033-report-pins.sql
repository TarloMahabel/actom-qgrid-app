-- ============================================================
--  ACTOM Grid — 033 report_pins
--
--  Per-user dashboard pins. Each row links a saved_report to a
--  user's dashboard favourites tab with a chosen chart type and
--  the two columns that drive the chart's axes.
-- ============================================================

create table report_pins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users not null default auth.uid(),
  report_id  uuid references saved_reports(id) on delete cascade not null,
  chart_type text not null default 'bar',  -- bar | pie | line
  x_column   text,   -- category / label column
  y_column   text,   -- numeric column, or '__count__' for row count
  pin_label  text,   -- display name override (falls back to report title)
  sort_order int     not null default 0,
  created_at timestamptz not null default now()
);

alter table report_pins enable row level security;

create policy "users manage own pins"
  on report_pins for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

grant all on table report_pins to authenticated;

do $verify$
begin
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'report_pins') then
    raise exception '033: report_pins was not created.';
  end if;
  raise notice '033 applied. report_pins ready.';
end $verify$;
