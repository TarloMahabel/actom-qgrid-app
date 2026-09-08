-- ============================================================
--  ACTOM Grid — 005 lock down the reference-number counters
--
--  FOUND BY AUDIT, NOT BY A TEST. ref_sequences was the one table in the
--  schema with row level security never enabled and no policies. Supabase
--  grants the `authenticated` role default privileges on tables in public,
--  so any signed-in user could SELECT and — the part that matters —
--  UPDATE the counters that issue INS- and FC- reference numbers.
--
--  The consequence is not a data leak, it is worse: rewind a counter and
--  the next inspection is issued a reference number that already belongs
--  to a signed, locked record. Two different inspections with the same
--  reference is precisely the kind of thing that invalidates a quality
--  record, and nothing in the app would have complained.
--
--  It was left open because next_ref() runs as the calling user, so the
--  caller needed table access. The fix is to give the privilege to the
--  FUNCTION instead of the user: next_ref becomes SECURITY DEFINER, and
--  the table is closed to clients entirely.
--
--  Every other table already had RLS on. test-integrity.js now asserts
--  that for all of them, so this cannot recur quietly.
-- ============================================================

-- 1. The function does the privileged work, with a pinned search_path so a
--    caller cannot shadow the table it writes to.
create or replace function next_ref(p_prefix text, p_width int default 4)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_period text; v_next int;
begin
  v_period := to_char(now(), 'YY');
  perform pg_advisory_xact_lock(hashtext(p_prefix));
  insert into ref_sequences (prefix, period, last_val)
    values (p_prefix, v_period, 0)
    on conflict (prefix) do nothing;
  update ref_sequences
     set last_val = case when period = v_period then last_val + 1 else 1 end,
         period   = v_period
   where prefix = p_prefix
  returning last_val into v_next;
  return p_prefix || '-' || v_period || '-' || lpad(v_next::text, p_width, '0');
end $$;

-- 2. The table is closed. RLS on with no policies denies every client
--    request; the revoke removes the default grants as well, so both
--    layers say no.
alter table ref_sequences enable row level security;
revoke all on ref_sequences from anon, authenticated;

comment on table ref_sequences is
  'Reference number counters. No client access at all: read and written only '
  'by next_ref(), which is SECURITY DEFINER. Rewinding a counter would issue '
  'a reference number that already belongs to a signed record.';

-- 3. next_ref is called from BEFORE INSERT triggers on inspections and
--    failed_checks, so authenticated must still be able to execute it.
grant execute on function next_ref(text, int) to authenticated;

-- ------------------------------------------------------------
--  The migration ledger, same treatment.
--
--  public.qgrid_migrations records which numbered files have been applied.
--  It is created by scripts/migrate.mjs and by schema-complete.sql rather
--  than by a migration, so it had escaped the RLS sweep entirely. A
--  signed-in user could delete a row from it and the next migration run
--  would re-apply that file — against a database that already has it.
--
--  Created here too, idempotently, so the lockdown travels with the
--  schema rather than depending on which route was used to build it.
-- ------------------------------------------------------------
create table if not exists public.qgrid_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
);

alter table public.qgrid_migrations enable row level security;
revoke all on public.qgrid_migrations from anon, authenticated;

comment on table public.qgrid_migrations is
  'Which numbered migrations have been applied. No client access: read and '
  'written only by scripts/migrate.mjs over a service-role connection.';
