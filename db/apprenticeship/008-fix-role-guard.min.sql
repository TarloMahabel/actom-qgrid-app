create or replace function app.require_role(variadic p_roles text[])
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  v_role := app.reviewer_role();          -- NULL when not an active reviewer

  -- coalesce first: comparing NULL to anything yields NULL, and a NULL
  -- condition means the guard silently does nothing.
  if coalesce(v_role, '') <> all (p_roles) then
    raise exception 'Not authorised. This action needs one of: %.', array_to_string(p_roles, ', ')
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function app.require_role(text[]) from anon;
grant execute on function app.require_role(text[]) to authenticated;
create or replace function public.publish_intake(p_intake uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i record; v_problems text[] := '{}'; v_trades int; v_docs int;
begin
  perform app.require_role('admin','manager');

  select * into i from public.intakes where id = p_intake;
  if i.id is null then raise exception 'Intake not found.'; end if;
  if i.status <> 'draft' then
    return jsonb_build_object('ok', false, 'problems',
      array['This intake has already been published.']);
  end if;

  select count(*) into v_trades from public.intake_trades
   where intake_id = p_intake and active;
  if v_trades = 0 then v_problems := array_append(v_problems, 'No trades are switched on.'); end if;

  select count(*) into v_docs from public.intake_documents
   where intake_id = p_intake and doc_type = 'id_document';
  if v_docs = 0 then
    v_problems := array_append(v_problems, 'The ID document requirement is missing.');
  end if;

  if i.closes_at <= now() then
    v_problems := array_append(v_problems, 'The closing date is in the past.');
  end if;
  if i.closes_at <= i.opens_at then
    v_problems := array_append(v_problems, 'The closing date is not after the opening date.');
  end if;
  if not exists (select 1 from public.consent_versions
                  where version = i.consent_version and audience = 'applicant' and active) then
    v_problems := array_append(v_problems, 'The selected consent wording does not exist.');
  end if;

  if i.scoring_enabled and exists (
      select 1 from public.intake_trades it
       where it.intake_id = p_intake and it.active
         and not exists (select 1 from public.intake_trade_subjects its
                          where its.intake_id = p_intake and its.trade_id = it.trade_id)) then
    v_problems := array_append(v_problems,
      'Scoring is on, but one or more active trades have no subjects set.');
  end if;

  if array_length(v_problems, 1) > 0 then
    return jsonb_build_object('ok', false, 'problems', v_problems);
  end if;

  update public.intakes
     set status = 'open', published_at = now(), published_by = auth.uid()
   where id = p_intake;

  insert into public.application_events (actor_id, event, detail)
  values (auth.uid(), 'intake_published',
          jsonb_build_object('intake_id', p_intake, 'name', i.name));

  return jsonb_build_object('ok', true);
end;
$$;
create or replace function public.close_intake(p_intake uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('admin','manager');
  update public.intakes set status = 'closed', closed_at = now(), closes_at = least(closes_at, now())
   where id = p_intake and status = 'open';
  insert into public.application_events (actor_id, event, detail)
  values (auth.uid(), 'intake_closed', jsonb_build_object('intake_id', p_intake));
end;
$$;
create or replace function public.clone_intake(p_intake uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_new uuid;
begin
  perform app.require_role('admin','manager');

  insert into public.intakes (name, opens_at, closes_at, status, retention_months,
                              show_further_study, show_technical, intro_heading, intro_body,
                              closed_message, consent_version, max_upload_mb,
                              scoring_enabled, auto_flag_below)
  select p_name, now(), now() + interval '60 days', 'draft', retention_months,
         show_further_study, show_technical, intro_heading, intro_body,
         closed_message, consent_version, max_upload_mb,
         scoring_enabled, auto_flag_below
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
create or replace function public.save_trade_subjects(
  p_intake uuid, p_trade uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_count integer := 0;
begin
  perform app.require_role('admin','manager');

  if not app_private.intake_is_editable(p_intake) then
    raise exception 'This intake has been published. Its form can no longer be changed.';
  end if;

  delete from public.intake_trade_subjects
   where intake_id = p_intake and trade_id = p_trade;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.intake_trade_subjects
      (intake_id, trade_id, subject_id, stream, required, min_mark, weight, sort_order)
    values (p_intake, p_trade, (r->>'subject_id')::uuid, r->>'stream',
            coalesce((r->>'required')::boolean, false),
            nullif(r->>'min_mark','')::smallint,
            coalesce((r->>'weight')::smallint, 1),
            coalesce((r->>'sort_order')::smallint, 100));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
create or replace function public.mark_storage_purged(p_ids bigint[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  -- The worker connects as service_role, which bypasses this path; a
  -- human calling it must be an administrator.
  if current_user not in ('postgres', 'service_role') then
    perform app.require_role('admin');
  end if;
  update public.storage_purge_queue
     set deleted_at = now(), last_error = null
   where id = any(p_ids) and deleted_at is null;
  get diagnostics v = row_count;
  return v;
end;
$$;
create or replace function public.enrol_applicant(
  p_application       uuid,
  p_start_date        date,
  p_employee_number   text default null,
  p_seta_number       text default null,
  p_site              text default null,
  p_supervisor        text default null,
  p_contract_signed   date default null,
  p_expected_end      date default null,
  p_notes             text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; v_id uuid; v_end date;
begin
  perform app.require_role('admin','manager');

  select * into a from public.applications where id = p_application;
  if a.id is null then raise exception 'Application not found.'; end if;

  if exists (select 1 from public.apprentices where application_id = p_application) then
    return jsonb_build_object('ok', false,
      'reason', 'This applicant is already on the register.');
  end if;

  if a.status <> 'shortlisted' then
    return jsonb_build_object('ok', false,
      'reason', 'Only a shortlisted applicant can be enrolled. This one is ' || a.status || '.');
  end if;

  if p_start_date is null then
    return jsonb_build_object('ok', false, 'reason', 'A start date is required.');
  end if;

  v_end := coalesce(p_expected_end, p_start_date + interval '3 years');

  insert into public.apprentices (
    application_id, intake_id, trade_id, full_name,
    employee_number, seta_learner_number,
    start_date, expected_end_date, contract_signed_on,
    site, supervisor, notes, enrolled_by)
  values (
    a.id, a.intake_id, a.trade_id, a.full_name,
    nullif(btrim(coalesce(p_employee_number,'')), ''),
    nullif(btrim(coalesce(p_seta_number,'')), ''),
    p_start_date, v_end, p_contract_signed,
    nullif(btrim(coalesce(p_site,'')), ''),
    nullif(btrim(coalesce(p_supervisor,'')), ''),
    nullif(btrim(coalesce(p_notes,'')), ''),
    auth.uid())
  returning id into v_id;

  update public.applications
     set status = 'enrolled', legal_hold = true, purge_after = null
   where id = a.id;

  insert into public.application_events
    (application_id, actor_id, event, from_status, to_status, detail)
  values (a.id, auth.uid(), 'enrolled', 'shortlisted', 'enrolled',
          jsonb_build_object('apprentice_id', v_id, 'start_date', p_start_date));

  insert into public.pii_access_log (actor_id, actor_email, application_id, action, detail)
  values (auth.uid(), auth.jwt() ->> 'email', a.id, 'enrol',
          'Enrolled as an apprentice, starting ' || p_start_date);

  return jsonb_build_object('ok', true, 'apprentice_id', v_id, 'expected_end', v_end);
end;
$$;
create or replace function public.update_apprentice(
  p_id            uuid,
  p_status        text default null,
  p_ended_on      date default null,
  p_end_reason    text default null,
  p_trade_test_date date default null,
  p_trade_test_result text default null,
  p_employee_number text default null,
  p_seta_number   text default null,
  p_site          text default null,
  p_supervisor    text default null,
  p_notes         text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform app.require_role('admin','manager');

  select * into r from public.apprentices where id = p_id;
  if r.id is null then raise exception 'Not on the register.'; end if;

  if p_status is not null and p_status not in ('active','completed') then
    if p_ended_on is null or btrim(coalesce(p_end_reason,'')) = '' then
      return jsonb_build_object('ok', false,
        'reason', 'Ending an apprenticeship needs both a date and a reason.');
    end if;
  end if;

  update public.apprentices set
    status            = coalesce(p_status, status),
    ended_on          = coalesce(p_ended_on, ended_on),
    end_reason        = coalesce(nullif(btrim(coalesce(p_end_reason,'')),''), end_reason),
    trade_test_date   = coalesce(p_trade_test_date, trade_test_date),
    trade_test_result = coalesce(p_trade_test_result, trade_test_result),
    employee_number   = coalesce(nullif(btrim(coalesce(p_employee_number,'')),''), employee_number),
    seta_learner_number = coalesce(nullif(btrim(coalesce(p_seta_number,'')),''), seta_learner_number),
    site              = coalesce(nullif(btrim(coalesce(p_site,'')),''), site),
    supervisor        = coalesce(nullif(btrim(coalesce(p_supervisor,'')),''), supervisor),
    notes             = coalesce(nullif(btrim(coalesce(p_notes,'')),''), notes)
  where id = p_id;

  insert into public.application_events (application_id, actor_id, event, detail)
  values (r.application_id, auth.uid(), 'apprentice_updated',
          jsonb_build_object('apprentice_id', p_id, 'status', coalesce(p_status, r.status)));

  return jsonb_build_object('ok', true);
end;
$$;
create or replace function public.unenrol_apprentice(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_close timestamptz; v_months smallint;
begin
  perform app.require_role('admin');

  if btrim(coalesce(p_reason,'')) = '' then
    raise exception 'A reason is required.';
  end if;

  select * into r from public.apprentices where id = p_id;
  if r.id is null then raise exception 'Not on the register.'; end if;

  delete from public.apprentices where id = p_id;

  select i.closes_at, i.retention_months into v_close, v_months
    from public.intakes i where i.id = r.intake_id;

  update public.applications
     set status = 'shortlisted', legal_hold = false,
         purge_after = (v_close + (coalesce(v_months,12) || ' months')::interval)::date
   where id = r.application_id;

  insert into public.application_events (application_id, actor_id, event, detail)
  values (r.application_id, auth.uid(), 'unenrolled',
          jsonb_build_object('reason', btrim(p_reason)));
end;
$$;
create or replace function app.has_role(variadic p_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.reviewer_role(), '') = any (p_roles);
$$;
grant execute on function app.has_role(text[]) to authenticated;
drop policy if exists pii_log_read on public.pii_access_log;
create policy pii_log_read on public.pii_access_log for select
  using (app.has_role('admin','manager','information_officer'));
drop policy if exists storage_purge_read on public.storage_purge_queue;
create policy storage_purge_read on public.storage_purge_queue for select
  using (app.has_role('admin','manager','information_officer'));
drop policy if exists reviewer_admin_update on public.reviewer_profiles;
create policy reviewer_admin_update on public.reviewer_profiles for update
  using (app.has_role('admin')) with check (app.has_role('admin'));
drop policy if exists its_write on public.intake_trade_subjects;
create policy its_write on public.intake_trade_subjects for all
  using (app.has_role('admin','manager')) with check (app.has_role('admin','manager'));
drop policy if exists intake_docs_write on public.intake_documents;
create policy intake_docs_write on public.intake_documents for all
  using (app.has_role('admin','manager')) with check (app.has_role('admin','manager'));
drop policy if exists intakes_write on public.intakes;
create policy intakes_write on public.intakes for all
  using (app.has_role('admin','manager')) with check (app.has_role('admin','manager'));
drop policy if exists intake_trades_write on public.intake_trades;
create policy intake_trades_write on public.intake_trades for all
  using (app.has_role('admin','manager')) with check (app.has_role('admin','manager'));
drop policy if exists trades_write on public.trades;
create policy trades_write on public.trades for all
  using (app.has_role('admin','manager')) with check (app.has_role('admin','manager'));
drop policy if exists subjects_write on public.subjects;
create policy subjects_write on public.subjects for all
  using (app.has_role('admin','manager')) with check (app.has_role('admin','manager'));
