-- ============================================================
--  ACTOM Grid — 013 planned dates
--
--  Generating a schedule stamped current_date on every inspection. Two
--  things wrong with that, and the second matters more.
--
--  1. It cannot be planned ahead. A works order released on Monday for
--     panels due in three weeks had every inspection dated Monday, so
--     everything was overdue by Tuesday and the overdue count — the one
--     number a supervisor acts on — was meaningless.
--
--  2. It puts a nine-stage route on one day. Incoming inspection,
--     fabrication, paint, assembly, wiring and FAT do not happen on the
--     same date. A schedule that says they do is not a schedule.
--
--  So: generate takes a start date, and each manufacturing stage carries
--  how many working days after that start its inspection falls due. The
--  offsets are a division's own build lead time and belong with the
--  stages, not in the code.
--
--  Working days, not calendar days: a route that lands a FAT on a Sunday
--  is a route nobody meets. Public holidays are NOT handled — that needs
--  a calendar table, and guessing them would be worse than the honest
--  gap. Dates land on weekdays; a supervisor still moves them.
-- ============================================================

alter table manufacturing_stages
  add column if not exists offset_days smallint not null default 0;

comment on column manufacturing_stages.offset_days is
  'Working days after the schedule start date that this stage''s inspection '
  'falls due. Reflects this division''s build lead time, so it is data.';

-- A first pass from the existing sequence: one working day per stage. Wrong
-- in detail for every division, right in shape, and visible to correct in
-- Administration rather than hidden in a function.
update manufacturing_stages
   set offset_days = greatest(0, coalesce(sort_order, 1) - 1)
 where offset_days = 0;

-- ------------------------------------------------------------
--  Add n working days to a date. Saturdays and Sundays skipped.
-- ------------------------------------------------------------
create or replace function add_working_days(p_from date, p_days int)
returns date language plpgsql immutable as $$
declare v_date date := p_from; v_left int := greatest(0, coalesce(p_days, 0));
begin
  -- If the start itself is a weekend, move to Monday first: a schedule that
  -- begins on Saturday begins on Monday.
  while extract(isodow from v_date) > 5 loop v_date := v_date + 1; end loop;
  while v_left > 0 loop
    v_date := v_date + 1;
    if extract(isodow from v_date) <= 5 then v_left := v_left - 1; end if;
  end loop;
  return v_date;
end $$;

grant execute on function add_working_days to authenticated;

-- ------------------------------------------------------------
--  Generate, with a start date.
-- ------------------------------------------------------------
create or replace function generate_inspections(
  p_works_order bigint, p_start date default null)
returns jsonb language plpgsql security invoker as $$
declare
  v_wo works_orders; v_family bigint; v_made int := 0; r record; i int;
  v_start date; v_first date; v_last date;
begin
  if not has_role('planner','quality_engineer','quality_manager','supervisor','sysadmin') then
    raise exception 'GEN_ROLE: you do not have permission to generate a schedule';
  end if;

  v_start := coalesce(p_start, current_date);

  select * into v_wo from works_orders where id = p_works_order;
  if v_wo.id is null then raise exception 'GEN_MISSING: works order not found'; end if;
  select family_id into v_family from projects where id = v_wo.project_id;
  if v_family is null then
    raise exception 'GEN_NO_FAMILY: % has no product family on its project, so the requirements matrix cannot be read', v_wo.code;
  end if;

  for r in
    select req.*, tr.id as rev_id, d.id as dept_id,
           coalesce(ms.offset_days, 0) as offset_days
      from inspection_requirements req
      join template_revisions tr
        on tr.template_id = req.template_id and tr.status = 'published'
      left join departments d on d.stage_id = req.stage_id
      left join manufacturing_stages ms on ms.id = req.stage_id
     where req.family_id = v_family
       and req.level <> 'na'
       and req.template_id is not null
  loop
    for i in 1 .. case when r.sampling = 'full' then v_wo.qty else 1 end loop
      insert into inspections
        (template_rev_id, stage_id, project_id, works_order_id, unit_ref,
         department_id, planned_date, status, generated_from)
      values
        (r.rev_id, r.stage_id, v_wo.project_id, p_works_order,
         case when r.sampling = 'full' then v_wo.code || '/' || i else v_wo.code end,
         r.dept_id, add_working_days(v_start, r.offset_days), 'scheduled', 'works_order');
      v_made := v_made + 1;
    end loop;
  end loop;

  select min(planned_date), max(planned_date) into v_first, v_last
    from inspections where works_order_id = p_works_order and status = 'scheduled';

  update works_orders set released_at = coalesce(released_at, now()) where id = p_works_order;

  return jsonb_build_object('works_order', v_wo.code, 'created', v_made,
                            'first_date', v_first, 'last_date', v_last);
end $$;

grant execute on function generate_inspections to authenticated;

-- ------------------------------------------------------------
--  Moving a date afterwards. A plan is a forecast, and forecasts move.
--  Only while the inspection has not been started: changing the planned
--  date of something already under way rewrites history.
-- ------------------------------------------------------------
create or replace function reschedule_inspection(p_inspection uuid, p_date date)
returns jsonb language plpgsql security invoker as $$
declare v_insp inspections; v_rows int;
begin
  if not has_role('planner','quality_engineer','quality_manager','supervisor','sysadmin') then
    raise exception 'GEN_ROLE: you do not have permission to change a schedule';
  end if;
  if p_date is null then raise exception 'RESCHEDULE_DATE: a date is required'; end if;

  select * into v_insp from inspections where id = p_inspection;
  if v_insp.id is null then raise exception 'RESCHEDULE_MISSING: inspection not found'; end if;
  if v_insp.signed_at is not null then
    raise exception 'INS_SIGNED: % is signed and cannot be rescheduled', v_insp.ref;
  end if;
  if v_insp.status <> 'scheduled' then
    raise exception 'RESCHEDULE_STARTED: % has already been started', v_insp.ref;
  end if;

  update inspections set planned_date = p_date where id = p_inspection;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'RESCHEDULE_BLOCKED: row level security prevented the change.';
  end if;

  return jsonb_build_object('ref', v_insp.ref, 'planned_date', p_date);
end $$;

grant execute on function reschedule_inspection to authenticated;
