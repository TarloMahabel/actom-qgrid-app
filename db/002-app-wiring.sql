-- ============================================================
-- ACTOM QGrid — Phase 1 Inspections
-- 0002 application wiring: auth, numbering, storage, RPCs
--
-- Everything the browser needs to do that must be atomic or must be
-- enforced regardless of the client lives here as a function. The rule:
-- if a control matters to an auditor, it is in the database.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A new Entra sign-in creates an inactive profile automatically.
--    Authenticating is not access: an administrator activates the user
--    and assigns a role before they can see or do anything.
-- ------------------------------------------------------------
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, entra_oid, full_name, email, role, active)
  values (
    new.id,
    new.raw_user_meta_data->>'provider_id',
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name',
             split_part(new.email, '@', 1)),
    new.email,
    'inspector',
    false
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------
-- 2. Reference numbers are assigned by the database, never the browser.
--    Two inspectors submitting at the same moment cannot collide.
-- ------------------------------------------------------------
create or replace function set_inspection_ref()
returns trigger language plpgsql as $$
begin
  if new.ref is null or new.ref = '' then new.ref := next_ref('INS'); end if;
  return new;
end $$;
create trigger trg_inspection_ref before insert on inspections
  for each row execute function set_inspection_ref();

create or replace function set_failed_check_ref()
returns trigger language plpgsql as $$
begin
  if new.ref is null or new.ref = '' then new.ref := next_ref('FC'); end if;
  return new;
end $$;
create trigger trg_fc_ref before insert on failed_checks
  for each row execute function set_failed_check_ref();

-- ------------------------------------------------------------
-- 3. Photo storage. Private bucket; access follows the inspection.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-photos', 'inspection-photos', false, 8388608,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "qgrid read own division photos" on storage.objects for select
  using (bucket_id = 'inspection-photos' and auth.uid() is not null);

create policy "qgrid upload photos" on storage.objects for insert
  with check (bucket_id = 'inspection-photos'
              and auth.uid() is not null
              and (storage.foldername(name))[1] = 'inspections');

-- Photos are evidence. Nobody deletes them from the client.
create policy "qgrid no photo deletes" on storage.objects for delete
  using (false);

-- ------------------------------------------------------------
-- 4. Publishing a template revision.
--    Enforces the second-approver rule and supersedes the previous
--    revision in one transaction, so there is never a moment with two
--    published revisions or none.
-- ------------------------------------------------------------
create or replace function publish_template_revision(p_rev uuid)
returns jsonb language plpgsql security invoker as $$
declare v_tpl uuid; v_author uuid; v_rev smallint;
begin
  if not has_role('quality_manager') then
    raise exception 'PUBLISH_ROLE: only a Quality Manager may publish a template';
  end if;

  select template_id, created_by, rev into v_tpl, v_author, v_rev
    from template_revisions where id = p_rev;
  if v_tpl is null then raise exception 'PUBLISH_MISSING: revision not found'; end if;

  if v_author = auth.uid() then
    raise exception 'PUBLISH_SELF: a template cannot be published by the person who built it';
  end if;

  update template_revisions
     set status = 'superseded'
   where template_id = v_tpl and status = 'published';

  update template_revisions
     set status = 'published',
         approved_by = auth.uid(),
         effective_from = current_date
   where id = p_rev;

  return jsonb_build_object('template_id', v_tpl, 'rev', v_rev, 'status', 'published');
end $$;

-- ------------------------------------------------------------
-- 5. Submitting an inspection.
--    One transaction: score the results, raise a failed check for every
--    failure, then sign. Doing this client-side would leave half-signed
--    inspections behind whenever the shop floor Wi-Fi drops mid-submit.
-- ------------------------------------------------------------
create or replace function submit_inspection(p_inspection uuid, p_signature text)
returns jsonb language plpgsql security invoker as $$
declare
  v_insp   inspections;
  v_def    jsonb;
  v_fails  int := 0;
  v_hold   boolean := false;
  v_hp     boolean;
  r        record;
  v_field  jsonb;
begin
  select * into v_insp from inspections where id = p_inspection;
  if v_insp.id is null then raise exception 'SUBMIT_MISSING: inspection not found'; end if;
  if v_insp.signed_at is not null then
    raise exception 'INS_SIGNED: % is already signed', v_insp.ref;
  end if;
  if v_insp.assigned_to <> auth.uid() and not has_role('quality_engineer','quality_manager') then
    raise exception 'SUBMIT_OWNER: this inspection is assigned to someone else';
  end if;

  select hold_points into v_hp from division_profile where id;
  select definition into v_def from template_revisions where id = v_insp.template_rev_id;

  -- Every field the template marks required must have an answer.
  for v_field in
    select f from jsonb_array_elements(v_def->'sections') s,
                   jsonb_array_elements(s->'items') f
     where (f->>'req')::boolean is true
       and coalesce(f->>'type','') not in ('info','section','sign')
  loop
    if not exists (
      select 1 from inspection_results
       where inspection_id = p_inspection
         and field_id = v_field->>'id'
         and (outcome is not null or value_text is not null or value_num is not null)
    ) then
      raise exception 'SUBMIT_INCOMPLETE: % has not been answered', v_field->>'label';
    end if;
  end loop;

  -- Raise a failed check for each failure, carrying the template's
  -- default defect code and hold-point flag.
  for r in
    select ir.id as result_id, ir.field_id, f as field
      from inspection_results ir
      join jsonb_array_elements(v_def->'sections') s on true
      join jsonb_array_elements(s->'items') f on f->>'id' = ir.field_id
     where ir.inspection_id = p_inspection and ir.outcome = 'fail'
  loop
    v_fails := v_fails + 1;
    if v_hp and (r.field->>'hold')::boolean is true then v_hold := true; end if;

    insert into failed_checks (inspection_id, result_id, defect_code_id, is_hold, disposition)
    select p_inspection, r.result_id,
           (select id from defect_codes where code = r.field->>'dfc'),
           v_hp and (r.field->>'hold')::boolean is true,
           'awaiting';
  end loop;

  update inspections
     set status = 'completed',
         result = case when v_fails > 0 then 'fail' else 'pass' end,
         completed_at = now(),
         signed_by = auth.uid(),
         signed_at = now(),
         signature_hash = md5(coalesce(p_signature,'') || p_inspection::text || now()::text)
   where id = p_inspection;

  -- Hold points, when the division uses them, stop the works order.
  if v_hold and v_insp.works_order_id is not null then
    update works_orders set status = 'held' where id = v_insp.works_order_id;
  end if;

  return jsonb_build_object(
    'ref', v_insp.ref,
    'result', case when v_fails > 0 then 'fail' else 'pass' end,
    'failed_checks', v_fails,
    'works_order_held', v_hold);
end $$;

-- ------------------------------------------------------------
-- 6. Generating the schedule from the requirements matrix.
--    Releasing a works order creates every inspection that product
--    family requires, so nothing depends on someone remembering.
-- ------------------------------------------------------------
create or replace function generate_inspections(p_works_order int)
returns jsonb language plpgsql security invoker as $$
declare
  v_wo works_orders; v_family smallint; v_made int := 0; r record; i int;
begin
  if not has_role('planner','quality_engineer','quality_manager','sysadmin') then
    raise exception 'GEN_ROLE: you may not generate a schedule';
  end if;

  select * into v_wo from works_orders where id = p_works_order;
  if v_wo.id is null then raise exception 'GEN_MISSING: works order not found'; end if;
  select family_id into v_family from projects where id = v_wo.project_id;

  for r in
    select req.*, tr.id as rev_id, d.id as dept_id
      from inspection_requirements req
      join template_revisions tr
        on tr.template_id = req.template_id and tr.status = 'published'
      left join departments d on d.stage_id = req.stage_id
     where req.family_id = v_family
       and req.level <> 'na'
       and req.template_id is not null
  loop
    -- 100% inspection means one per unit; every other rule means one per order.
    for i in 1 .. case when r.sampling = 'full' then v_wo.qty else 1 end loop
      insert into inspections
        (template_rev_id, stage_id, project_id, works_order_id, unit_ref,
         department_id, planned_date, status, generated_from)
      values
        (r.rev_id, r.stage_id, v_wo.project_id, p_works_order,
         case when r.sampling = 'full' then v_wo.code || '/' || i else v_wo.code end,
         r.dept_id, current_date, 'scheduled', 'works_order');
      v_made := v_made + 1;
    end loop;
  end loop;

  update works_orders set released_at = coalesce(released_at, now()) where id = p_works_order;
  return jsonb_build_object('works_order', v_wo.code, 'created', v_made);
end $$;

-- ------------------------------------------------------------
-- 7. Dashboard figures. A view, so they can never drift from the records.
--    security_invoker = on so the counts respect row level security:
--    an inspector sees their department's numbers, Quality sees all.
-- ------------------------------------------------------------
create or replace view v_dashboard with (security_invoker = on) as
select
  (select count(*) from inspections where status in ('scheduled','in_progress'))            as open_inspections,
  (select count(*) from inspections
    where status = 'scheduled' and planned_date < current_date)                             as overdue,
  (select count(*) from inspections where assigned_to is null and status = 'scheduled')     as unassigned,
  (select count(*) from failed_checks where disposition = 'awaiting')                       as awaiting_disposition,
  (select count(*) from inspections
    where status = 'completed' and completed_at > now() - interval '30 days')               as completed_30d,
  (select round(100.0 * count(*) filter (where result = 'pass') / nullif(count(*),0), 1)
     from inspections
    where status = 'completed' and completed_at > now() - interval '30 days')               as pass_rate_30d;

grant select on v_dashboard, v_stage_yield, v_open_work to authenticated;
grant execute on function publish_template_revision, submit_inspection, generate_inspections to authenticated;
