alter table public.intakes
  add column if not exists published_at        timestamptz,
  add column if not exists published_by        uuid references auth.users(id),
  add column if not exists closed_at           timestamptz,
  add column if not exists show_further_study  boolean not null default true,
  add column if not exists show_technical      boolean not null default true,
  add column if not exists intro_heading       text,
  add column if not exists intro_body          text,
  add column if not exists closed_message      text,
  add column if not exists consent_version     text default '2026.1',
  add column if not exists max_upload_mb       smallint not null default 8,
  add column if not exists scoring_enabled     boolean not null default true,
  add column if not exists auto_flag_below     boolean not null default true;
comment on column public.intakes.status is
  'draft = editable config, no applications. open = live, config frozen. closed = no new applications, config frozen. archived = hidden.';
alter table public.intake_trades
  add column if not exists active         boolean not null default true,
  add column if not exists label_override text,
  add column if not exists sort_order     smallint not null default 100,
  add column if not exists min_score      numeric(5,2),
  add column if not exists notes          text;
create table if not exists public.intake_trade_subjects (
  id          uuid primary key default gen_random_uuid(),
  intake_id   uuid not null references public.intakes(id) on delete cascade,
  trade_id    uuid not null references public.trades(id)  on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  stream      text not null check (stream in ('academic','technical','qualification')),
  required    boolean not null default false,
  min_mark    smallint check (min_mark between 0 and 100),
  weight      smallint not null default 1 check (weight between 0 and 10),
  sort_order  smallint not null default 100,
  unique (intake_id, trade_id, subject_id, stream)
);
create index if not exists its_intake_trade_idx
  on public.intake_trade_subjects(intake_id, trade_id);
create table if not exists public.intake_documents (
  id          uuid primary key default gen_random_uuid(),
  intake_id   uuid not null references public.intakes(id) on delete cascade,
  doc_type    text not null check (doc_type in
              ('id_document','matric_certificate','qualification','other')),
  label       text not null,
  hint        text,
  required    boolean not null default false,
  max_files   smallint not null default 1 check (max_files between 1 and 6),
  visible     boolean not null default true,
  sort_order  smallint not null default 100,
  unique (intake_id, doc_type)
);
create or replace function app_private.protect_id_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.doc_type = 'id_document' then
    new.required := true;
    new.visible  := true;
  end if;
  return new;
end;
$$;
drop trigger if exists intake_documents_protect on public.intake_documents;
create trigger intake_documents_protect
  before insert or update on public.intake_documents
  for each row execute function app_private.protect_id_document();
alter table public.applications
  add column if not exists auto_score       numeric(5,2),
  add column if not exists auto_rank        integer,
  add column if not exists auto_flags       text[] not null default '{}',
  add column if not exists meets_minimum    boolean,
  add column if not exists scored_at        timestamptz;
create index if not exists applications_score_idx
  on public.applications(intake_id, trade_id, auto_score desc nulls last);
drop trigger if exists guard_intake_trades         on public.intake_trades;
drop trigger if exists guard_intake_trade_subjects on public.intake_trade_subjects;
drop trigger if exists guard_intake_documents      on public.intake_documents;
drop trigger if exists guard_intakes               on public.intakes;
do $$
declare i record; t record;
begin
  for i in select * from public.intakes loop
    insert into public.intake_documents (intake_id, doc_type, label, hint, required, max_files, sort_order)
    values
      (i.id, 'id_document', 'Certified copy of your ID',
       'Certified within the last three months.', true, 1, 10),
      (i.id, 'matric_certificate', 'Grade 12 certificate or statement of results',
       'If you are still waiting for results, upload your latest school report.', false, 1, 20),
      (i.id, 'qualification', 'Further qualification certificates',
       'N-certificates, diplomas, trade test results.', false, 4, 30),
      (i.id, 'other', 'Other supporting documents',
       'Proof of residence, a reference letter, a CV.', false, 2, 40)
    on conflict (intake_id, doc_type) do nothing;
    for t in select trade_id from public.intake_trades where intake_id = i.id loop
      insert into public.intake_trade_subjects
        (intake_id, trade_id, subject_id, stream, required, min_mark, weight, sort_order)
      select i.id, t.trade_id, s.id, s.stream,
             s.name in ('Mathematics','Technical Mathematics','Physical Science','Technical Science'),
             case when s.name in ('Mathematics','Technical Mathematics','Physical Science','Technical Science')
                  then 40 else null end,
             case when s.name in ('Mathematics','Technical Mathematics','Physical Science','Technical Science') then 3
                  when s.name in ('Engineering Graphics and Design','Mechanical Technology',
                                  'Electrical Technology','Technical Drawing') then 2
                  when s.name in ('Life Orientation') then 0
                  else 1 end,
             s.sort_order
        from public.subjects s
       where s.active and s.stream in ('academic','technical')
         and s.name in ('Mathematics','Mathematical Literacy','Physical Science','Life Science',
                        'Life Orientation','Home Language','First Additional Language',
                        'Technical Mathematics','Technical Science','Engineering Graphics and Design',
                        'Mechanical Technology','Electrical Technology','Technical Drawing',
                        'Fitting and Machining Theory','Trade Theory')
      on conflict (intake_id, trade_id, subject_id, stream) do nothing;
    end loop;
  end loop;
end $$;
create or replace function app_private.intake_is_editable(p_intake uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select status = 'draft' from public.intakes where id = p_intake), false);
$$;
create or replace function app_private.guard_config_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_intake uuid;
begin
  v_intake := coalesce(new.intake_id, old.intake_id);
  if not app_private.intake_is_editable(v_intake) then
    raise exception
      'This intake has been published. Its form can no longer be changed. Clone it to start a new intake.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists guard_intake_trades         on public.intake_trades;
drop trigger if exists guard_intake_trade_subjects on public.intake_trade_subjects;
drop trigger if exists guard_intake_documents      on public.intake_documents;
create trigger guard_intake_trades
  before insert or update or delete on public.intake_trades
  for each row execute function app_private.guard_config_write();
create trigger guard_intake_trade_subjects
  before insert or update or delete on public.intake_trade_subjects
  for each row execute function app_private.guard_config_write();
create trigger guard_intake_documents
  before insert or update or delete on public.intake_documents
  for each row execute function app_private.guard_config_write();
create or replace function app_private.guard_intake_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'draft' then return new; end if;
  if new.name             is distinct from old.name
  or new.opens_at         is distinct from old.opens_at
  or new.retention_months is distinct from old.retention_months
  or new.show_further_study is distinct from old.show_further_study
  or new.show_technical   is distinct from old.show_technical
  or new.consent_version  is distinct from old.consent_version
  or new.max_upload_mb    is distinct from old.max_upload_mb
  or new.scoring_enabled  is distinct from old.scoring_enabled then
    raise exception
      'This intake has been published. Only the closing date and closing message can still be changed.'
      using errcode = 'check_violation';
  end if;
  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'A published intake cannot be returned to draft.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_intakes on public.intakes;
create trigger guard_intakes before update on public.intakes
  for each row execute function app_private.guard_intake_write();
create or replace function app_private.score_application(p_application uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a               record;
  r               record;
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
  for r in
    select its.*, s.name as subject_name
      from public.intake_trade_subjects its
      join public.subjects s on s.id = its.subject_id
     where its.intake_id = a.intake_id and its.trade_id = a.trade_id
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
      v_flags := array_append(v_flags, (r.subject_name || ' ' || v_mark || '%, below the ' || r.min_mark || '% minimum'));
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
    v_flags := array_append(v_flags, ('Overall score ' || v_score || ', below the ' || v_min_score || ' minimum'));
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
create or replace function public.recalculate_ranks(p_intake uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not app.is_reviewer() then raise exception 'Not authorised.'; end if;
  with ranked as (
    select id, rank() over (
             partition by intake_id, trade_id
             order by meets_minimum desc nulls last, auto_score desc nulls last, submitted_at asc
           ) as rnk
      from public.applications
     where intake_id = p_intake and status <> 'draft'
  )
  update public.applications a
     set auto_rank = ranked.rnk
    from ranked where ranked.id = a.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.recalculate_ranks(uuid) to authenticated;
create or replace function public.get_form_config(p_intake uuid, p_trade uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; i record;
begin
  select * into i from public.intakes where id = p_intake and status = 'open';
  if i.id is null then return jsonb_build_object('open', false); end if;
  select jsonb_build_object(
    'open', true,
    'intake', jsonb_build_object(
      'id', i.id, 'name', i.name, 'closes_at', i.closes_at,
      'show_further_study', i.show_further_study,
      'show_technical', i.show_technical,
      'intro_heading', i.intro_heading, 'intro_body', i.intro_body,
      'consent_version', i.consent_version,
      'max_upload_mb', i.max_upload_mb),
    'trades', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', t.id,
               'name', coalesce(it.label_override, t.name),
               'division', t.division,
               'notes', it.notes) order by it.sort_order, t.name), '[]'::jsonb)
        from public.intake_trades it
        join public.trades t on t.id = it.trade_id
       where it.intake_id = p_intake and it.active),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'doc_type', d.doc_type, 'label', d.label, 'hint', d.hint,
               'required', d.required, 'max_files', d.max_files) order by d.sort_order), '[]'::jsonb)
        from public.intake_documents d
       where d.intake_id = p_intake and d.visible),
    'subjects', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'stream', its.stream, 'name', s.name,
               'required', its.required, 'min_mark', its.min_mark,
               'weight', its.weight) order by its.stream, its.sort_order, s.name), '[]'::jsonb)
        from public.intake_trade_subjects its
        join public.subjects s on s.id = its.subject_id
       where its.intake_id = p_intake
         and (p_trade is null or its.trade_id = p_trade))
  ) into v;
  return v;
end;
$$;
grant execute on function public.get_form_config(uuid, uuid) to anon, authenticated;
create or replace function public.publish_intake(p_intake uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i record; v_problems text[] := '{}'; v_trades int; v_docs int;
begin
  if app.reviewer_role() not in ('admin','manager') then
    raise exception 'Only an administrator or manager can publish an intake.';
  end if;
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
  if v_docs = 0 then v_problems := array_append(v_problems, 'The ID document requirement is missing.'); end if;
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
    v_problems := array_append(v_problems, 'Scoring is on, but one or more active trades have no subjects set.');
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
grant execute on function public.publish_intake(uuid) to authenticated;
create or replace function public.close_intake(p_intake uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if app.reviewer_role() not in ('admin','manager') then
    raise exception 'Only an administrator or manager can close an intake.';
  end if;
  update public.intakes set status = 'closed', closed_at = now(), closes_at = least(closes_at, now())
   where id = p_intake and status = 'open';
  insert into public.application_events (actor_id, event, detail)
  values (auth.uid(), 'intake_closed', jsonb_build_object('intake_id', p_intake));
end;
$$;
grant execute on function public.close_intake(uuid) to authenticated;
create or replace function public.clone_intake(p_intake uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_new uuid;
begin
  if app.reviewer_role() not in ('admin','manager') then
    raise exception 'Only an administrator or manager can create an intake.';
  end if;
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
grant execute on function public.clone_intake(uuid, text) to authenticated;
create or replace function public.save_trade_subjects(
  p_intake uuid, p_trade uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_count integer := 0;
begin
  if app.reviewer_role() not in ('admin','manager') then
    raise exception 'Not authorised.';
  end if;
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
grant execute on function public.save_trade_subjects(uuid, uuid, jsonb) to authenticated;
create or replace function app_private.score_on_submit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted' and coalesce(old.status,'') = 'draft' then
    perform app_private.score_application(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists applications_score on public.applications;
create trigger applications_score after update on public.applications
  for each row execute function app_private.score_on_submit();
alter table public.intake_trade_subjects enable row level security;
alter table public.intake_documents      enable row level security;
drop policy if exists its_read on public.intake_trade_subjects;
create policy its_read on public.intake_trade_subjects for select
  using (exists (select 1 from public.intakes i
                 where i.id = intake_id and i.status in ('open','closed'))
         or app.is_reviewer());
drop policy if exists its_write on public.intake_trade_subjects;
create policy its_write on public.intake_trade_subjects for all
  using (app.reviewer_role() in ('admin','manager'))
  with check (app.reviewer_role() in ('admin','manager'));
drop policy if exists intake_docs_read on public.intake_documents;
create policy intake_docs_read on public.intake_documents for select
  using (exists (select 1 from public.intakes i
                 where i.id = intake_id and i.status in ('open','closed'))
         or app.is_reviewer());
drop policy if exists intake_docs_write on public.intake_documents;
create policy intake_docs_write on public.intake_documents for all
  using (app.reviewer_role() in ('admin','manager'))
  with check (app.reviewer_role() in ('admin','manager'));
drop policy if exists intakes_read on public.intakes;
create policy intakes_read on public.intakes for select
  using (status in ('open','closed') or app.is_reviewer());
drop policy if exists intakes_write on public.intakes;
create policy intakes_write on public.intakes for all
  using (app.reviewer_role() in ('admin','manager'))
  with check (app.reviewer_role() in ('admin','manager'));
drop policy if exists intake_trades_write on public.intake_trades;
create policy intake_trades_write on public.intake_trades for all
  using (app.reviewer_role() in ('admin','manager'))
  with check (app.reviewer_role() in ('admin','manager'));
drop policy if exists trades_write on public.trades;
create policy trades_write on public.trades for all
  using (app.reviewer_role() in ('admin','manager'))
  with check (app.reviewer_role() in ('admin','manager'));
drop policy if exists subjects_write on public.subjects;
create policy subjects_write on public.subjects for all
  using (app.reviewer_role() in ('admin','manager'))
  with check (app.reviewer_role() in ('admin','manager'));
grant select on public.intake_trade_subjects, public.intake_documents to anon, authenticated;
grant insert, update, delete on public.intake_trade_subjects, public.intake_documents,
                                public.intake_trades, public.intakes,
                                public.trades, public.subjects to authenticated;
grant select (auto_score, auto_rank, auto_flags, meets_minimum, scored_at)
  on public.applications to authenticated;
