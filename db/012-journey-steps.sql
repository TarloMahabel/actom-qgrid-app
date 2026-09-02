-- =====================================================================
-- Migration 012 — "What happens from here", editable per intake
--
-- The steps shown to an applicant after they submit were hard-coded in
-- the applicant app. They describe ACTOM's own process — when screening
-- happens, whether there is a medical, how long training runs — and that
-- changes between intakes. Changing it should not require a deploy.
--
-- A NOTE ON THE PUBLISH LOCK
--
--   Publishing an intake freezes its form, because an applicant must
--   experience exactly the form they were shown. These steps are
--   deliberately NOT frozen.
--
--   They are a forward-looking description of what ACTOM will do, not
--   part of what the applicant filled in or agreed to. If the process
--   genuinely shifts mid-intake — assessments move, a medical is added —
--   the honest thing is to correct the description rather than leave
--   applicants reading something untrue. The guard in 002 is a denylist
--   of specific columns, so a new column is editable by default; that is
--   the intended behaviour here, not an oversight.
--
-- Run after 011-consent-editor.sql. Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The column
--
-- jsonb array of { title, detail }. Order is the order shown.
-- ---------------------------------------------------------------------
alter table public.intakes
  add column if not exists journey_steps jsonb;

-- A DEFAULT, not just a one-off backfill. Without it any intake created
-- later — including by clone_intake — starts with null steps and the
-- applicant sees an empty "what happens from here" section. Found by
-- checking get_form_config against a freshly created intake rather than
-- the seeded one.
alter table public.intakes alter column journey_steps set default jsonb_build_array(
  jsonb_build_object('title', 'Application received',
    'detail', 'Today. Nothing more is needed from you right now.'),
  jsonb_build_object('title', 'Screening',
    'detail', 'After the intake closes. We check every application against the requirements for your trade.'),
  jsonb_build_object('title', 'Aptitude assessment',
    'detail', 'If you are shortlisted we phone you on the number you gave us to arrange it.'),
  jsonb_build_object('title', 'Interview and medical',
    'detail', 'A conversation about the work, and a fitness-for-duty check.'),
  jsonb_build_object('title', 'Contract of apprenticeship',
    'detail', 'Signed and registered with the SETA. You start earning.'),
  jsonb_build_object('title', 'Three years of training',
    'detail', 'Workshop, site and classroom, working towards your trade test.'),
  jsonb_build_object('title', 'Qualified artisan',
    'detail', 'A national trade certificate, and a skill that travels.')
);

alter table public.intakes drop constraint if exists intakes_journey_steps_check;
alter table public.intakes add constraint intakes_journey_steps_check
  check (journey_steps is null or jsonb_typeof(journey_steps) = 'array');


-- ---------------------------------------------------------------------
-- 2. Seed with what the app has been showing
--
-- Only where nothing is set, so re-running never overwrites edited text.
-- The first step is marked current; the rest are still to come.
-- ---------------------------------------------------------------------
update public.intakes
   set journey_steps = jsonb_build_array(
     jsonb_build_object('title', 'Application received',
       'detail', 'Today. Nothing more is needed from you right now.'),
     jsonb_build_object('title', 'Screening',
       'detail', 'After the intake closes. We check every application against the requirements for your trade.'),
     jsonb_build_object('title', 'Aptitude assessment',
       'detail', 'If you are shortlisted we phone you on the number you gave us to arrange it.'),
     jsonb_build_object('title', 'Interview and medical',
       'detail', 'A conversation about the work, and a fitness-for-duty check.'),
     jsonb_build_object('title', 'Contract of apprenticeship',
       'detail', 'Signed and registered with the SETA. You start earning.'),
     jsonb_build_object('title', 'Three years of training',
       'detail', 'Workshop, site and classroom, working towards your trade test.'),
     jsonb_build_object('title', 'Qualified artisan',
       'detail', 'A national trade certificate, and a skill that travels.')
   )
 where journey_steps is null;


-- ---------------------------------------------------------------------
-- 3. Hand it to the applicant app
--
-- get_form_config is what the public form reads. Adding the steps here
-- means the app renders whatever is configured, with its own fallback if
-- an intake somehow has none.
-- ---------------------------------------------------------------------
create or replace function public.get_form_config(p_intake uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare i record; v jsonb;
begin
  if p_intake is null then
    select * into i from public.intakes
     where status = 'open' and opens_at <= now() and closes_at > now()
     order by opens_at desc limit 1;
  else
    select * into i from public.intakes where id = p_intake;
  end if;

  if i.id is null then
    select * into i from public.intakes order by closes_at desc limit 1;
    if i.id is null then
      return jsonb_build_object('open', false, 'message',
        'Applications are not open at the moment.');
    end if;
    return jsonb_build_object('open', false, 'message',
      coalesce(i.closed_message, 'Applications are closed at the moment.'));
  end if;

  if i.status <> 'open' or i.opens_at > now() or i.closes_at <= now() then
    return jsonb_build_object('open', false, 'message',
      coalesce(i.closed_message, 'Applications are closed at the moment.'));
  end if;

  v := jsonb_build_object(
    'open', true,
    'intake', jsonb_build_object(
      'id', i.id, 'name', i.name, 'closes_at', i.closes_at,
      'show_further_study', i.show_further_study,
      'show_technical', i.show_technical,
      'intro_heading', i.intro_heading, 'intro_body', i.intro_body,
      'consent_version', i.consent_version,
      'max_upload_mb', i.max_upload_mb,
      'journey_steps', i.journey_steps),
    'trades', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', coalesce(it.label_override, t.name),
               'division', t.division,
               'notes', it.notes,
               'positions', it.positions
             ) order by it.sort_order, t.name), '[]'::jsonb)
        from public.intake_trades it
        join public.trades t on t.id = it.trade_id
       where it.intake_id = i.id and it.active),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'doc_type', d.doc_type, 'label', d.label, 'hint', d.hint,
               'required', d.required, 'max_files', d.max_files
             ) order by d.sort_order), '[]'::jsonb)
        from public.intake_documents d
       where d.intake_id = i.id and d.visible),
    'subjects', (
      select coalesce(jsonb_agg(distinct jsonb_build_object(
               'id', s.id, 'name', s.name, 'stream', s.stream)), '[]'::jsonb)
        from public.intake_trade_subjects its
        join public.subjects s on s.id = its.subject_id
       where its.intake_id = i.id)
  );

  return v;
end;
$$;

grant execute on function public.get_form_config(uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Saving from the console
-- ---------------------------------------------------------------------
create or replace function public.save_journey_steps(p_intake uuid, p_steps jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform app.require_role('admin', 'manager');

  if jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Steps must be a list.';
  end if;

  n := jsonb_array_length(p_steps);
  if n = 0 then
    return jsonb_build_object('ok', false,
      'reason', 'Keep at least one step — the applicant is shown this straight after submitting.');
  end if;
  if n > 12 then
    return jsonb_build_object('ok', false,
      'reason', 'Twelve steps is plenty. More than that stops being read.');
  end if;

  -- Every step needs a title; detail is optional.
  if exists (
    select 1 from jsonb_array_elements(p_steps) e
     where btrim(coalesce(e->>'title', '')) = ''
  ) then
    return jsonb_build_object('ok', false, 'reason', 'Every step needs a title.');
  end if;

  update public.intakes set journey_steps = p_steps where id = p_intake;

  insert into public.application_events (actor_id, event, detail)
  values (auth.uid(), 'journey_steps_updated',
          jsonb_build_object('intake_id', p_intake, 'steps', n));

  return jsonb_build_object('ok', true, 'steps', n);
end;
$$;

grant execute on function public.save_journey_steps(uuid, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Cloning an intake carries its steps
--
-- clone_intake copies the configuration forward. Without journey_steps
-- in that list the clone silently falls back to the default, quietly
-- discarding wording someone had edited.
-- ---------------------------------------------------------------------
create or replace function public.clone_intake(p_intake uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_new uuid;
begin
  perform app.require_role('admin','manager');

  insert into public.intakes (name, opens_at, closes_at, status, retention_months,
                              show_further_study, show_technical, intro_heading, intro_body,
                              closed_message, consent_version, max_upload_mb,
                              scoring_enabled, auto_flag_below, journey_steps)
  select p_name, now(), now() + interval '60 days', 'draft', retention_months,
         show_further_study, show_technical, intro_heading, intro_body,
         closed_message, consent_version, max_upload_mb,
         scoring_enabled, auto_flag_below, journey_steps
    from public.intakes where id = p_intake
  returning id into v_new;

  insert into public.intake_trades (intake_id, trade_id, positions, active,
                                    label_override, sort_order, min_score, notes)
  select v_new, trade_id, positions, active, label_override, sort_order, min_score, notes
    from public.intake_trades where intake_id = p_intake;

  insert into public.intake_trade_subjects (intake_id, trade_id, subject_id, stream,
                                            required, min_mark, weight, sort_order)
  select v_new, trade_id, subject_id, stream, required, min_mark, weight, sort_order
    from public.intake_trade_subjects where intake_id = p_intake;

  insert into public.intake_documents (intake_id, doc_type, label, hint, required,
                                       max_files, visible, sort_order)
  select v_new, doc_type, label, hint, required, max_files, visible, sort_order
    from public.intake_documents where intake_id = p_intake;

  insert into public.application_events (actor_id, event, detail)
  values (auth.uid(), 'intake_cloned',
          jsonb_build_object('from', p_intake, 'to', v_new, 'name', p_name));

  return v_new;
end;
$$;
