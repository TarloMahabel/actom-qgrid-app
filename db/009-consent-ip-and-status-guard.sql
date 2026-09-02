-- =====================================================================
-- Migration 009 — consent IP cast, and status transition rules
--
-- SEVERITY: N3 is medium and time-sensitive. It can stop applicants
-- submitting, and it does so at the very last step of the form.
--
-- Run after 008-fix-role-guard.sql. Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. N3 — record_consent could raise on a proxy-chained header
--
-- The original recorded the applicant's IP with:
--
--     nullif(... ->> 'x-forwarded-for','')::inet
--
-- X-Forwarded-For is a LIST, not a single address. The moment any proxy
-- or CDN sits in the path the header arrives as
--
--     "41.13.24.7, 10.0.0.1"
--
-- and casting that to inet raises invalid_text_representation. The
-- exception propagates out of record_consent, so the applicant cannot
-- record consent — and consent is checked by submit_application, so
-- they cannot submit at all. The failure appears at the final step of a
-- long form, which is the worst possible place to lose someone.
--
-- Whether production hits this depends on Supabase's edge configuration
-- on any given day. That is not something to leave to chance during an
-- intake.
--
-- The fix takes the first hop (the client, per RFC 7239 ordering) and
-- refuses to let a malformed value break the write: the IP is evidence
-- for a POPIA consent record, useful but never worth failing a consent
-- over. A bad value now stores NULL instead of raising.
-- ---------------------------------------------------------------------
create or replace function app_private.client_ip()
returns inet language plpgsql stable set search_path = '' as $$
declare v_raw text; v_first text;
begin
  v_raw := nullif(btrim(coalesce(
             current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', '')), '');
  if v_raw is null then return null; end if;

  -- First hop only. Everything after the first comma is proxy chain.
  v_first := btrim(split_part(v_raw, ',', 1));

  -- Strip a port if one is present. IPv4 "1.2.3.4:56" splits on the
  -- single colon; bracketed IPv6 "[::1]:56" keeps its address intact.
  if v_first ~ '^\[' then
    v_first := split_part(btrim(v_first, '[]'), ']', 1);
  elsif (length(v_first) - length(replace(v_first, ':', ''))) = 1 then
    v_first := split_part(v_first, ':', 1);
  end if;

  return v_first::inet;
exception when others then
  -- An unparseable header must never cost an applicant their consent.
  return null;
end;
$$;

revoke all on function app_private.client_ip() from public, anon, authenticated;


create or replace function public.record_consent(
  p_application uuid, p_version text, p_audience text, p_user_agent text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_v record;
begin
  if not exists (select 1 from public.applications
                 where id = p_application and applicant_user_id = auth.uid()) then
    raise exception 'Application not found.';
  end if;

  select id, body_sha256 into v_v from public.consent_versions
   where version = p_version and audience = p_audience and active;
  if v_v.id is null then raise exception 'Consent wording not found.'; end if;

  insert into public.consents (application_id, consent_version_id, audience,
                               body_sha256, granted_ip, user_agent)
  values (p_application, v_v.id, p_audience, v_v.body_sha256,
          app_private.client_ip(),
          left(coalesce(p_user_agent,''), 400));
end;
$$;
grant execute on function public.record_consent(uuid, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. N4 — set_application_status accepted any source state
--
-- The function checked that the caller was a reviewer with access to the
-- trade, but never what it was acting on. Two gaps followed.
--
--   a) A draft could be moved to under_review. The applicant's own
--      update policy requires status = 'draft', so this locks a person
--      out of a form they have not finished, with no way back — the
--      function cannot return a record to draft. Drafts are invisible to
--      reviewer SELECTs and UUIDs are unguessable, so this is unlikely
--      rather than impossible. It should still be refused.
--
--   b) No transition rules at all: declined -> shortlisted was accepted
--      silently. For a selection process that has to stand up to an
--      audit, a decision being quietly reversed with no recorded reason
--      is the part that matters.
--
-- The rule below is deliberately not a rigid matrix. Reversing a
-- decision stays possible, because genuine mistakes happen and an
-- inflexible system gets worked around in ways nobody can see. It just
-- has to be deliberate: reversing shortlisted or declined now requires
-- a reason, which lands in application_reviews.notes and the event log.
--
-- 'withdrawn' and 'enrolled' are terminal here. Withdrawal belongs to
-- the applicant (POPIA s24) and a reviewer must not undo it; enrolment
-- is reversed only by unenrol_apprentice, which is admin-only and
-- restores the retention date the enrolment cleared.
-- ---------------------------------------------------------------------
create or replace function public.set_application_status(
  p_application uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_from text; v_trade uuid;
begin
  if not app.is_reviewer() then raise exception 'Not authorised.'; end if;
  if p_status not in ('under_review','shortlisted','declined') then
    raise exception 'Unknown status.';
  end if;

  select status, trade_id into v_from, v_trade
    from public.applications where id = p_application;
  if v_from is null then raise exception 'Application not found.'; end if;
  if not app.can_see_trade(v_trade) then raise exception 'Not authorised for this trade.'; end if;

  -- (a) never touch an unsubmitted form
  if v_from = 'draft' then
    raise exception 'This application has not been submitted yet. It cannot be moved into review.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- terminal states
  if v_from = 'withdrawn' then
    raise exception 'The applicant withdrew this application. It cannot be reopened by a reviewer.'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_from = 'enrolled' then
    raise exception 'This applicant is on the apprentice register. Remove them from the register first.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- no-op, rather than a second identical review row
  if v_from = p_status then return; end if;

  -- (b) reversing a recorded decision has to be deliberate and reasoned
  if v_from in ('shortlisted','declined')
     and btrim(coalesce(p_notes,'')) = '' then
    raise exception
      'This application was already %. Changing that decision needs a reason.', v_from
      using errcode = 'invalid_parameter_value';
  end if;

  update public.applications set status = p_status where id = p_application;

  insert into public.application_reviews (application_id, reviewer_id, decision, notes)
  values (p_application, auth.uid(),
          case p_status when 'shortlisted' then 'shortlist'
                        when 'declined' then 'decline' else 'hold' end, p_notes);

  insert into public.application_events (application_id, actor_id, event, from_status, to_status, detail)
  values (p_application, auth.uid(), 'status_change', v_from, p_status,
          case when v_from in ('shortlisted','declined')
               then jsonb_build_object('reversal', true, 'reason', btrim(p_notes))
               else null end);
end;
$$;
grant execute on function public.set_application_status(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Verification
--
-- Both should report PASS.
-- ---------------------------------------------------------------------
do $$
declare v inet;
begin
  -- The cast that used to raise.
  perform set_config('request.headers',
    '{"x-forwarded-for":"41.13.24.7, 10.0.0.1, 172.16.0.4"}', true);
  v := app_private.client_ip();
  raise notice '%  chained X-Forwarded-For yields first hop (%)',
    case when v = '41.13.24.7'::inet then 'PASS' else 'FAIL' end, v;

  perform set_config('request.headers', '{"x-forwarded-for":"not an address"}', true);
  raise notice '%  malformed X-Forwarded-For stores NULL rather than raising',
    case when app_private.client_ip() is null then 'PASS' else 'FAIL' end;

  perform set_config('request.headers', '{}', true);
end $$;
