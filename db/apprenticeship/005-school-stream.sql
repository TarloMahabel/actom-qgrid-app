-- =====================================================================
-- Migration 005 — one school stream per applicant
--
-- A South African learner writes EITHER the academic NSC or the
-- technical NSC, never both. The form and the scoring engine both
-- treated the two as independent blocks that could each be filled in.
--
-- Two consequences, the second serious:
--
--   1. The form invited marks for subjects the applicant could not
--      have taken.
--
--   2. score_application() evaluated every rule configured for the
--      trade, whatever its stream. If HR marked both Mathematics
--      (academic) and Technical Mathematics as required — the obvious
--      thing to do, since either is acceptable — then EVERY applicant
--      was flagged for the one they could not have written, and
--      meets_minimum was false across the board. The weighted average
--      was dragged down too, because a missing required subject counts
--      as zero.
--
-- The stream is derived from the certificate type the applicant already
-- selects. No extra question.
--
-- Run after 002-form-config.sql. Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Certificate type -> school stream
--
--   nsc, senior_certificate, amended_senior_certificate -> academic
--   nsc_technical, ncv_l4                               -> technical
--
-- NC(V) Level 4 is a vocational qualification and its subjects sit in
-- the technical catalogue, so it maps there.
-- ---------------------------------------------------------------------
create or replace function public.school_stream(p_grade12_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_grade12_type
           when 'nsc_technical'              then 'technical'
           when 'ncv_l4'                     then 'technical'
           when 'nsc'                        then 'academic'
           when 'senior_certificate'         then 'academic'
           when 'amended_senior_certificate' then 'academic'
           else null                     -- 'none', or not yet answered
         end;
$$;
grant execute on function public.school_stream(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Stream-aware scoring
--
-- Rules whose stream does not apply to this applicant are skipped
-- entirely — not failed, not counted as zero, not weighted. The
-- 'qualification' stream always applies, since a further qualification
-- sits alongside either school route.
-- ---------------------------------------------------------------------
create or replace function app_private.score_application(p_application uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a               record;
  r               record;
  v_stream        text;
  v_weighted      numeric := 0;
  v_weight_total  numeric := 0;
  v_flags         text[]  := '{}';
  v_meets         boolean := true;
  v_mark          smallint;
  v_score         numeric;
  v_min_score     numeric;
  v_enabled       boolean;
  v_auto_flag     boolean;
begin
  select * into a from public.applications where id = p_application;
  if a.id is null or a.trade_id is null then return; end if;

  select scoring_enabled, auto_flag_below into v_enabled, v_auto_flag
    from public.intakes where id = a.intake_id;
  if not coalesce(v_enabled, false) then return; end if;

  v_stream := public.school_stream(a.grade12_type);

  for r in
    select its.*, s.name as subject_name
      from public.intake_trade_subjects its
      join public.subjects s on s.id = its.subject_id
     where its.intake_id = a.intake_id
       and its.trade_id  = a.trade_id
       -- Only the applicant's own school stream, plus further study.
       and (its.stream = 'qualification'
            or v_stream is null
            or its.stream = v_stream)
  loop
    select mark into v_mark
      from public.application_subjects
     where application_id = p_application
       and stream = r.stream
       and subject_name = r.subject_name;

    if v_mark is null then
      if r.required then
        v_flags := array_append(v_flags, (r.subject_name || ' not supplied'));
        v_meets := false;
        if r.weight > 0 then
          v_weight_total := v_weight_total + r.weight;   -- counts as zero
        end if;
      end if;
      continue;
    end if;

    if r.min_mark is not null and v_mark < r.min_mark then
      v_flags := array_append(v_flags,
        (r.subject_name || ' ' || v_mark || '%, below the ' || r.min_mark || '% minimum'));
      v_meets := false;
    end if;

    if r.weight > 0 then
      v_weighted     := v_weighted + (v_mark * r.weight);
      v_weight_total := v_weight_total + r.weight;
    end if;
  end loop;

  v_score := case when v_weight_total > 0
                  then round(v_weighted / v_weight_total, 2)
                  else null end;

  select min_score into v_min_score
    from public.intake_trades
   where intake_id = a.intake_id and trade_id = a.trade_id;

  if v_min_score is not null and v_score is not null and v_score < v_min_score then
    v_flags := array_append(v_flags,
      ('Overall score ' || v_score || ', below the ' || v_min_score || ' minimum'));
    v_meets := false;
  end if;

  update public.applications
     set auto_score    = v_score,
         auto_flags    = case when coalesce(v_auto_flag, true) then v_flags else '{}' end,
         meets_minimum = v_meets,
         scored_at     = now()
   where id = p_application;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Marks from the wrong stream are discarded on write
--
-- Belt and braces: if the applicant changes certificate type after
-- capturing marks, the stale block must not survive to be scored. The
-- client clears it too, but the client is not the enforcement point.
-- ---------------------------------------------------------------------
create or replace function app_private.enforce_subject_stream()
returns trigger language plpgsql set search_path = '' as $$
declare v_type text; v_stream text;
begin
  if new.stream = 'qualification' then return new; end if;

  select grade12_type into v_type
    from public.applications where id = new.application_id;

  v_stream := public.school_stream(v_type);
  if v_stream is null then return new; end if;   -- type not yet chosen

  if new.stream <> v_stream then
    return null;                                  -- silently drop the row
  end if;
  return new;
end;
$$;

drop trigger if exists application_subjects_stream on public.application_subjects;
create trigger application_subjects_stream
  before insert or update on public.application_subjects
  for each row execute function app_private.enforce_subject_stream();


-- ---------------------------------------------------------------------
-- 4. Clear the other stream when the certificate type changes
-- ---------------------------------------------------------------------
create or replace function app_private.clear_stale_stream()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_stream text;
begin
  if new.grade12_type is not distinct from old.grade12_type then
    return new;
  end if;

  v_stream := public.school_stream(new.grade12_type);
  if v_stream is null then return new; end if;

  delete from public.application_subjects
   where application_id = new.id
     and stream <> 'qualification'
     and stream <> v_stream;

  return new;
end;
$$;

drop trigger if exists applications_clear_stream on public.applications;
create trigger applications_clear_stream
  after update of grade12_type on public.applications
  for each row execute function app_private.clear_stale_stream();


-- ---------------------------------------------------------------------
-- 5. Re-score anything already submitted under the old logic
-- ---------------------------------------------------------------------
do $$
declare r record; n integer := 0;
begin
  for r in select id from public.applications
            where status <> 'draft' and scored_at is not null
  loop
    perform app_private.score_application(r.id);
    n := n + 1;
  end loop;
  raise notice 'Re-scored % application(s) under the stream-aware rules.', n;
end $$;
