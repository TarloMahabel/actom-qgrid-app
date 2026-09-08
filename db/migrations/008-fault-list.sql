-- ============================================================
--  ACTOM Grid — 008 multiple faults on one panel
--
--  THE PROBLEM. A checksheet answers a fixed set of questions: one
--  answer per question, which is what inspection_results holds — it is
--  unique on (inspection_id, field_id). A fault list is a different
--  shape: one panel, an unknown number of faults, each with its own
--  code, description and location. There was nowhere to put the second
--  fault.
--
--  THE CHOICE, and why it went this way.
--
--  (a) Repeat the field with a suffix — f3#1, f3#2 — and keep everything
--      in inspection_results. Cheapest. Rejected: every Pareto, defect
--      trend and NCR in Phase 2 counts faults, and counting them would
--      mean parsing field ids out of strings. Analytics built on string
--      parsing is analytics nobody trusts.
--
--  (b) A new inspection_faults table. Clean, but it creates a SECOND
--      place a defect can live. failed_checks already holds "a defect was
--      found here" for a failed checkpoint, and Phase 2 turns those into
--      NCRs. Two tables feeding one NCR workflow is two of everything
--      forever: two queries per report, two things to keep in step.
--
--  (c) Extend failed_checks — chosen. A fault-list entry and a failed
--      checkpoint ARE the same fact: a defect, on a unit, with a code.
--      They differ only in how they were found. So result_id becomes
--      optional, a `source` column records which, and the free-text
--      columns a fault list needs are added.
--
--  The payoff: the Pareto is one query, the Failed checks queue shows
--  both kinds side by side, and Phase 2 reads one table.
-- ============================================================

-- ------------------------------------------------------------
--  PREREQUISITES. Run migrations in order.
--
--  Without this, a missing earlier migration shows up as a raw error
--  about a column that does not exist, several statements in, with
--  nothing saying which file to run first.
-- ------------------------------------------------------------
do $prereq$
begin
  if not exists (select 1 from information_schema.columns
                where table_name = 'division_profile' and column_name = 'require_second_approver') then
    raise exception '008 needs 004-publish-approval-optional.sql first.';
  end if;
end $prereq$;


-- result_id is only meaningful for a defect found AT a checkpoint. A fault
-- typed into a fault list is not attached to one.
alter table failed_checks alter column result_id drop not null;

alter table failed_checks
  add column if not exists source text not null default 'checkpoint'
    check (source in ('checkpoint', 'fault_list')),
  add column if not exists field_id    text,      -- which fault list it came from
  add column if not exists seq         smallint,  -- line number as the inspector sees it
  add column if not exists description text,
  add column if not exists location    text,      -- where on the panel
  add column if not exists severity    text check (severity in ('minor', 'major')),
  add column if not exists qty         smallint not null default 1;

comment on column failed_checks.source is
  'checkpoint: a checklist question failed. fault_list: typed into a fault '
  'list on the form. Both are defects and both become NCRs in Phase 2.';

-- A defect found at a checkpoint must still name the checkpoint; one typed
-- into a fault list must say what it is. Neither rule can be expressed by a
-- NOT NULL now that both kinds share the table.
-- Added NOT VALID and then validated, rather than added and hoped.
--
-- Every existing row should satisfy it: result_id was NOT NULL until the
-- statement above made it nullable, so nothing can yet have a null one. That
-- reasoning is probably right, which is not the same as being right — and a
-- constraint that aborts a migration half way through leaves a division in a
-- state nobody planned. So: add it without checking history, then check, and
-- if history disagrees say so instead of failing.
alter table failed_checks drop constraint if exists failed_checks_shape;
alter table failed_checks add constraint failed_checks_shape check (
  (source = 'checkpoint' and result_id is not null)
  or
  (source = 'fault_list' and field_id is not null
   and description is not null and length(btrim(description)) > 0)
) not valid;

do $validate$
declare v_bad int;
begin
  select count(*) into v_bad from failed_checks
   where not ((source = 'checkpoint' and result_id is not null)
              or (source = 'fault_list' and field_id is not null
                  and description is not null and length(btrim(description)) > 0));
  if v_bad = 0 then
    alter table failed_checks validate constraint failed_checks_shape;
    raise notice 'failed_checks_shape validated against every existing row.';
  else
    raise notice '--------------------------------------------------------------';
    raise notice '% existing failed_checks row(s) do not fit the new shape rule.', v_bad;
    raise notice 'Nothing was changed or deleted. New rows are checked; these are not.';
    raise notice 'Look at them with:';
    raise notice '  select id, ref, source, result_id, field_id, description';
    raise notice '    from failed_checks where not ((source = ''checkpoint'' and result_id is not null)';
    raise notice '      or (source = ''fault_list'' and field_id is not null and description is not null));';
    raise notice 'Then: alter table failed_checks validate constraint failed_checks_shape;';
    raise notice '--------------------------------------------------------------';
  end if;
end $validate$;

create index if not exists failed_checks_inspection_idx
  on failed_checks (inspection_id, source, seq);

-- ------------------------------------------------------------
--  Counting defects. One query over both kinds, which was the whole
--  point of not adding a second table.
-- ------------------------------------------------------------
create or replace view v_defect_pareto with (security_invoker = on) as
select d.code,
       d.description                      as defect,
       count(*)                           as occurrences,
       sum(f.qty)                         as units_affected,
       count(*) filter (where f.source = 'fault_list')  as from_fault_lists,
       count(*) filter (where f.source = 'checkpoint')  as from_checkpoints,
       count(*) filter (where f.disposition = 'awaiting') as awaiting
  from failed_checks f
  join defect_codes d on d.id = f.defect_code_id
 group by d.code, d.description
 order by count(*) desc;

grant select on v_defect_pareto to authenticated;

-- ------------------------------------------------------------
--  Submitting an inspection must not lose the fault list.
--
--  submit_inspection raises a failed check per failed checkpoint. Faults
--  are written as the inspector types them, so they already exist — but
--  the inspection's overall result has to account for them, or a panel
--  with five faults and no failed checkpoint would submit as a pass.
-- ------------------------------------------------------------
create or replace function submit_inspection(p_inspection uuid, p_signature text)
returns jsonb language plpgsql security invoker as $$
declare
  v_insp inspections; v_def jsonb; v_fails int := 0; v_faults int := 0;
  v_hold boolean := false; v_hp boolean; r record; v_field jsonb; v_rows int;
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

  -- Required fields must be answered. A fault list answers itself: the
  -- inspector either listed faults or confirmed there were none, and both
  -- write a result row.
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
    insert into failed_checks (inspection_id, result_id, defect_code_id, is_hold,
                               disposition, source)
    select p_inspection, r.result_id,
           (select id from defect_codes where code = r.field->>'dfc'),
           v_hp and (r.field->>'hold')::boolean is true,
           'awaiting', 'checkpoint';
  end loop;

  -- Faults recorded on a fault list count towards the result.
  select count(*) into v_faults
    from failed_checks
   where inspection_id = p_inspection and source = 'fault_list';

  update inspections
     set status = 'completed',
         result = case when v_fails + v_faults > 0 then 'fail' else 'pass' end,
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
    'result', case when v_fails + v_faults > 0 then 'fail' else 'pass' end,
    'failed_checks', v_fails,
    'faults', v_faults,
    'works_order_held', v_hold);
end $$;

-- Argument lists stated: a grant on a bare function name breaks the
-- moment that function gains an overload, and the error names the
-- grant rather than the overload that caused it.
grant execute on function submit_inspection(uuid, text) to authenticated;
