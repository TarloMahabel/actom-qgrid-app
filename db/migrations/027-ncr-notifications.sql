-- ============================================================
--  027 — NCR notification config + daily digest schedule
--
--  Adds two columns to division_profile so the pg_cron daily
--  digest job can call the notify-ncr Edge Function without
--  hard-coding division-specific URLs in the job definition.
--
--  After applying this migration, for each division:
--    1. Deploy the supabase/functions/notify-ncr Edge Function.
--    2. Set three Supabase secrets on the project:
--         RESEND_API_KEY   your Resend API key
--         NOTIFY_FROM      e.g. "QMS 360 <noreply@actom.co.za>"
--         APP_URL          this division's Netlify URL
--    3. Populate the config columns and schedule the cron job:
--
--       update division_profile set
--         ncr_notify_fn_url   = 'https://<project-ref>.supabase.co/functions/v1',
--         ncr_notify_anon_key = '<anon-key>';
--
--       select cron.schedule(
--         'ncr-daily-digest',
--         '0 5 * * *',
--         'select public.trigger_ncr_digest()'
--       );
--
--  pg_cron must be enabled on the project (Dashboard → Extensions).
-- ============================================================

-- ------------------------------------------------------------
--  1. Notification config on the division profile.
-- ------------------------------------------------------------
alter table division_profile
  add column if not exists ncr_notify_fn_url   text,
  add column if not exists ncr_notify_anon_key text;

comment on column division_profile.ncr_notify_fn_url is
  'Base URL of this project''s Supabase Edge Functions, e.g. '
  'https://mxoaalgcrhynebrtgruz.supabase.co/functions/v1. '
  'Required by trigger_ncr_digest(). Set after migration.';

comment on column division_profile.ncr_notify_anon_key is
  'The anon (public) key for this project. Used by the pg_cron '
  'digest job to authenticate the Edge Function call.';

-- ------------------------------------------------------------
--  2. Helper function called by the pg_cron daily digest job.
--
--  Reads target URL and auth key from division_profile so the
--  scheduled job definition contains no division-specific values
--  and can be identical across all divisions.
-- ------------------------------------------------------------
create or replace function public.trigger_ncr_digest()
returns void
language plpgsql
security definer
as $$
declare
  v_url text;
  v_key text;
begin
  select ncr_notify_fn_url, ncr_notify_anon_key
    into v_url, v_key
    from division_profile
   limit 1;

  if v_url is null or v_key is null then
    raise notice 'trigger_ncr_digest: ncr_notify_fn_url or ncr_notify_anon_key '
                 'not set in division_profile — digest skipped.';
    return;
  end if;

  perform net.http_post(
    url     := v_url || '/notify-ncr',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := '{"type":"digest"}'::jsonb
  );
end $$;

comment on function public.trigger_ncr_digest() is
  'Calls the notify-ncr Edge Function with type=digest. Scheduled '
  'by pg_cron at 05:00 UTC (07:00 SAST). Reads its config from '
  'division_profile so it is division-agnostic.';

-- ------------------------------------------------------------
--  3. Verify.
-- ------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name  = 'division_profile'
       and column_name = 'ncr_notify_fn_url'
  ) then
    raise exception '027: ncr_notify_fn_url column was not added.';
  end if;

  if not exists (
    select 1 from pg_proc
     where proname = 'trigger_ncr_digest'
       and pronamespace = 'public'::regnamespace
  ) then
    raise exception '027: trigger_ncr_digest function was not created.';
  end if;

  raise notice '027: NCR notification columns and digest function ready.';
end $verify$;
