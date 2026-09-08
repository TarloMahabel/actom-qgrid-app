-- =====================================================================
-- Migration 010 — a deliberate "not selected" action, structured like
-- enrolment rather than a plain status button
--
-- Declining already worked: set_application_status requires a non-empty
-- note, blocks a draft/withdrawn/enrolled application, and demands a
-- reason to reverse a recorded decision. What it did not have was a
-- REASON CATEGORY — free text only, which cannot be reported on ("why
-- do people not make it into a trade?" is unanswerable from a text blob).
--
-- This adds a controlled-vocabulary reason alongside the existing note,
-- and a dedicated RPC that composes a sensible note from the category so
-- a reviewer is not typing the same handful of explanations by hand
-- every time. It deliberately calls the EXISTING set_application_status
-- rather than reimplementing its guards — the draft/withdrawn/enrolled
-- blocks and the reversal-requires-reason rule apply exactly as before,
-- with one function instead of two that could drift apart.
--
-- Run after 009-consent-ip-and-status-guard.sql. Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The structured reason
-- ---------------------------------------------------------------------
alter table public.applications
  add column if not exists decline_reason_category text,
  add column if not exists decline_reason_detail   text;

alter table public.applications drop constraint if exists applications_decline_reason_check;
alter table public.applications add constraint applications_decline_reason_check
  check (decline_reason_category is null or decline_reason_category in (
    'below_minimum', 'position_filled', 'failed_assessment',
    'incomplete_docs', 'unreachable', 'other'
  ));


-- ---------------------------------------------------------------------
-- 2. decline_applicant()
--
-- Composes the note from the category, appends any extra detail, then
-- hands off to set_application_status for everything that already
-- worked correctly. Left open to any active reviewer, matching the
-- access level the plain Decline button already had — this is not being
-- newly restricted to managers the way enrolment is.
-- ---------------------------------------------------------------------
create or replace function public.decline_applicant(
  p_application uuid, p_category text, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_notes text;
begin
  if p_category not in ('below_minimum', 'position_filled', 'failed_assessment',
                        'incomplete_docs', 'unreachable', 'other') then
    raise exception 'Unknown decline reason.';
  end if;

  if p_category = 'other' and btrim(coalesce(p_detail, '')) = '' then
    raise exception 'Add a short explanation when the reason is Other.';
  end if;

  v_notes := case p_category
    when 'below_minimum'    then 'Did not meet the minimum subject or mark requirements.'
    when 'position_filled'  then 'Position filled by a stronger candidate.'
    when 'failed_assessment' then 'Did not pass the interview or aptitude assessment.'
    when 'incomplete_docs'  then 'Documents were incomplete, unverifiable, or could not be cleared.'
    when 'unreachable'      then 'Could not be reached, or withdrew informally.'
    else 'Other reason recorded — see detail.'
  end;
  if btrim(coalesce(p_detail, '')) <> '' then
    v_notes := v_notes || ' ' || btrim(p_detail);
  end if;

  -- Every existing guard applies unchanged: cannot decline a draft, a
  -- withdrawn application, or someone already enrolled; reversing a
  -- prior shortlist/decline still requires this same non-empty note,
  -- which v_notes always is.
  perform public.set_application_status(p_application, 'declined', v_notes);

  -- Recorded regardless of whether set_application_status changed the
  -- status just now (it no-ops if already declined) — this lets a
  -- reviewer correct or add detail to the category afterwards without
  -- needing to bounce the status away and back.
  update public.applications
     set decline_reason_category = p_category,
         decline_reason_detail   = nullif(btrim(coalesce(p_detail, '')), '')
   where id = p_application;
end;
$$;

grant execute on function public.decline_applicant(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Reporting
--
-- The reason ACTOM most needs an answer to eventually: where in the
-- pipeline are trades losing candidates. Aggregate only, per trade.
-- ---------------------------------------------------------------------
create or replace view public.v_decline_reasons as
select
  t.name as trade,
  a.decline_reason_category,
  count(*) as n
from public.applications a
join public.trades t on t.id = a.trade_id
where a.status = 'declined' and a.decline_reason_category is not null
group by t.name, a.decline_reason_category;

grant select on public.v_decline_reasons to authenticated;
