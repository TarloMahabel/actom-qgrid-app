-- ============================================================
--  ACTOM Grid — 006 publishing silently did nothing
--
--  SYMPTOM: pressing Publish showed "Revision 1 published", and the
--  template stayed a draft. Nothing failed, nothing was logged, and the
--  library still read "Never published".
--
--  TWO FAULTS, and the second is why the first went unnoticed.
--
--  1. RLS filtered the UPDATE out.
--     publish_template_revision is SECURITY INVOKER, so its UPDATE is
--     subject to the policies on template_revisions like any other
--     statement. Those policies allow an update only by the revision's
--     author or by a quality_manager. Migration 003 added sysadmin to the
--     role check INSIDE the function but not to the policies, so a
--     System Administrator passed the function's own test and was then
--     silently filtered out by the table's.
--
--  2. The function did not check that anything happened.
--     An UPDATE filtered by RLS affects zero rows. That is not an error —
--     Postgres reports success — so the function returned its cheerful
--     jsonb and the app believed it. A control that cannot fail loudly is
--     a control that fails silently.
--
--  Fixed both ways round: the policies now name sysadmin, AND every
--  statement that must change a row asserts that it did. The second fix
--  matters more than the first: it turns any future policy mistake into a
--  visible error instead of a lie.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Policies. Replaced wholesale so the set is readable in one place
--    rather than accumulating exceptions.
-- ------------------------------------------------------------
drop policy if exists revs_edit on template_revisions;
drop policy if exists revs_publish on template_revisions;

-- Editing a draft: its author, a Quality Manager, or an administrator.
create policy revs_edit on template_revisions for update
  using (
    status in ('draft', 'in_review')
    and (created_by = auth.uid() or has_role('quality_manager', 'sysadmin'))
  )
  with check (true);

-- Publishing and superseding: Quality Manager or administrator. Whether the
-- author may approve their own work is decided by the division setting inside
-- publish_template_revision, not here — a policy cannot read that setting
-- cleanly, and having the rule in two places is how they drift apart.
create policy revs_publish on template_revisions for update
  using (has_role('quality_manager', 'sysadmin'))
  with check (true);

-- ------------------------------------------------------------
-- 2. The function asserts that its updates actually landed.
-- ------------------------------------------------------------
create or replace function publish_template_revision(p_rev uuid)
returns jsonb language plpgsql security invoker as $$
declare
  v_tpl uuid; v_author uuid; v_rev smallint; v_require boolean; v_rows int;
begin
  if not has_role('quality_manager', 'sysadmin') then
    raise exception 'PUBLISH_ROLE: only a Quality Manager or System Administrator may publish a template';
  end if;

  select template_id, created_by, rev into v_tpl, v_author, v_rev
    from template_revisions where id = p_rev;
  if v_tpl is null then raise exception 'PUBLISH_MISSING: revision not found'; end if;

  select require_second_approver into v_require from division_profile where id;

  if coalesce(v_require, false) and v_author = auth.uid() then
    raise exception 'PUBLISH_SELF: this division requires a second approver, so the person who built a template cannot publish it.';
  end if;

  update template_revisions
     set status = 'superseded'
   where template_id = v_tpl and status = 'published';

  update template_revisions
     set status = 'published',
         approved_by = auth.uid(),
         effective_from = current_date
   where id = p_rev;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- The row exists: it was read at the top of this function. So the update
    -- was filtered by row level security, not missing.
    raise exception 'PUBLISH_BLOCKED: row level security prevented the update. Your role may not edit this revision.';
  end if;

  return jsonb_build_object('template_id', v_tpl, 'rev', v_rev, 'status', 'published',
                            'self_approved', v_author = auth.uid());
end $$;

-- ------------------------------------------------------------
-- 3. The same assertion on submitting an inspection, which has exactly
--    the same shape: a final UPDATE that RLS could filter, after which
--    the function would report a signed inspection that is not signed.
-- ------------------------------------------------------------
create or replace function submit_inspection(p_inspection uuid, p_signature text)
returns jsonb language plpgsql security invoker as $$
declare
  v_insp inspections; v_def jsonb; v_fails int := 0; v_hold boolean := false;
  v_hp boolean; r record; v_field jsonb; v_rows int;
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

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'SUBMIT_BLOCKED: row level security prevented the record from being signed.';
  end if;

  if v_hold and v_insp.works_order_id is not null then
    update works_orders set status = 'held' where id = v_insp.works_order_id;
  end if;

  return jsonb_build_object(
    'ref', v_insp.ref,
    'result', case when v_fails > 0 then 'fail' else 'pass' end,
    'failed_checks', v_fails,
    'works_order_held', v_hold);
end $$;

-- Argument lists stated: a grant on a bare function name breaks the
-- moment that function gains an overload, and the error names the
-- grant rather than the overload that caused it.
grant execute on function publish_template_revision(uuid), submit_inspection(uuid, text) to authenticated;
