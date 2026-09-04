-- ============================================================
--  ACTOM Grid — 010 handing an inspection to someone else
--
--  THE SITUATION: an inspector starts a panel, then is off sick. The work
--  has to be finished. Today nobody else can: the results policy ties
--  writing answers to the assigned inspector, so even a Quality Manager
--  can submit the inspection but cannot record anything on it — which is
--  the worst of both.
--
--  WHAT THIS DOES NOT DO: let two people edit the same inspection, or let
--  a supervisor sign in someone else's name. A signature says who did the
--  work. Blurring that is the one thing a quality record cannot afford.
--
--  WHAT IT DOES: a recorded handover. A supervisor, planner, Quality
--  Engineer or Quality Manager reassigns the inspection to a named person,
--  with a reason. Answers already captured stay, attributed to whoever
--  captured them. The new inspector continues and signs in their own name.
--  The record then shows started by X, completed by Y, handed over by Z
--  because of R — which is exactly what an auditor asks when two names
--  appear on one inspection.
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
  if not exists (select 1 from information_schema.routines
                where routine_name = 'has_role') then
    raise exception '010 needs 001-init-inspections.sql first.';
  end if;
end $prereq$;


-- Who first opened it. assigned_to moves on a handover; this does not.
alter table inspections
  add column if not exists started_by uuid references profiles(id);

comment on column inspections.started_by is
  'The inspector who first opened the inspection. assigned_to moves on a '
  'handover, signed_by records who finished it. All three can differ.';

create table if not exists inspection_handovers (
  id            uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  from_profile  uuid references profiles(id),
  to_profile    uuid not null references profiles(id),
  handed_by     uuid not null references profiles(id),
  reason        text not null check (length(btrim(reason)) > 0),
  at            timestamptz not null default now()
);
create index if not exists handovers_inspection_idx on inspection_handovers (inspection_id, at);

comment on table inspection_handovers is
  'Why an inspection changed hands. A reason is required: "the record shows '
  'two names" is only defensible if it also shows why.';

alter table inspection_handovers enable row level security;

create policy handover_read on inspection_handovers for select
  using (auth.uid() is not null);

-- Only the roles that can reassign may write one, and the row must say who
-- did it — no anonymous handovers.
create policy handover_write on inspection_handovers for insert
  with check (
    handed_by = auth.uid()
    and has_role('supervisor', 'planner', 'quality_engineer', 'quality_manager', 'sysadmin')
  );

-- A handover is part of the record. It is never edited or removed.
revoke update, delete on inspection_handovers from anon, authenticated;

-- A supervisor can reassign within their own department; the wider roles
-- anywhere. Everything else about insp_update is unchanged.
drop policy if exists insp_update on inspections;
create policy insp_update on inspections for update
  using (
    (assigned_to = auth.uid() and status in ('scheduled', 'in_progress'))
    or has_role('quality_engineer', 'quality_manager', 'planner', 'sysadmin')
    or (has_role('supervisor') and department_id = my_department())
  );

-- ------------------------------------------------------------
--  Reassigning, as one operation.
--
--  Doing it from the browser would be three writes that can half-apply:
--  move the inspection, log the handover, note who started it. This does
--  all three or none, and refuses the cases that should be refused.
-- ------------------------------------------------------------
create or replace function hand_over_inspection(
  p_inspection uuid, p_to uuid, p_reason text)
returns jsonb language plpgsql security invoker as $$
declare v_insp inspections; v_from uuid; v_rows int; v_to_active boolean;
begin
  if not has_role('supervisor', 'planner', 'quality_engineer', 'quality_manager', 'sysadmin') then
    raise exception 'HANDOVER_ROLE: only a supervisor or above can reassign an inspection';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'HANDOVER_REASON: a reason is required';
  end if;

  select * into v_insp from inspections where id = p_inspection;
  if v_insp.id is null then raise exception 'HANDOVER_MISSING: inspection not found'; end if;

  -- A signed inspection is finished. If it is wrong, it needs an amendment,
  -- not a new owner.
  if v_insp.signed_at is not null then
    raise exception 'INS_SIGNED: % is already signed and cannot be reassigned', v_insp.ref;
  end if;

  select active into v_to_active from profiles where id = p_to;
  if v_to_active is not true then
    raise exception 'HANDOVER_TARGET: that person is not an active user';
  end if;
  if v_insp.assigned_to = p_to then
    raise exception 'HANDOVER_SAME: it is already assigned to that person';
  end if;

  v_from := v_insp.assigned_to;

  insert into inspection_handovers (inspection_id, from_profile, to_profile, handed_by, reason)
  values (p_inspection, v_from, p_to, auth.uid(), btrim(p_reason));

  update inspections
     set assigned_to = p_to,
         -- Remember who opened it, the first time it moves.
         started_by = coalesce(started_by, v_from)
   where id = p_inspection;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'HANDOVER_BLOCKED: row level security prevented the reassignment.';
  end if;

  return jsonb_build_object('ref', v_insp.ref, 'from', v_from, 'to', p_to);
end $$;

-- Argument lists stated: a grant on a bare function name breaks the
-- moment that function gains an overload, and the error names the
-- grant rather than the overload that caused it.
grant execute on function hand_over_inspection(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------
--  Answers follow the CURRENT assignee.
--
--  Unchanged in substance — the policy already keyed on assigned_to — but
--  restated here so the whole rule is in one migration alongside the
--  handover that makes it move.
-- ------------------------------------------------------------
drop policy if exists res_write on inspection_results;
create policy res_write on inspection_results for all
  using (
    exists (select 1 from inspections i
             where i.id = inspection_id and i.signed_at is null
               and (i.assigned_to = auth.uid()
                    or has_role('quality_engineer', 'quality_manager')))
  )
  with check (
    exists (select 1 from inspections i
             where i.id = inspection_id and i.signed_at is null
               and (i.assigned_to = auth.uid()
                    or has_role('quality_engineer', 'quality_manager')))
  );

-- ------------------------------------------------------------
--  The register needs to show when two names are on one inspection.
-- ------------------------------------------------------------
create or replace view v_inspection_people with (security_invoker = on) as
select i.id,
       i.ref,
       s.full_name as started_by_name,
       a.full_name as assigned_to_name,
       g.full_name as signed_by_name,
       (select count(*) from inspection_handovers h where h.inspection_id = i.id) as handovers
  from inspections i
  left join profiles s on s.id = i.started_by
  left join profiles a on a.id = i.assigned_to
  left join profiles g on g.id = i.signed_by;

grant select on v_inspection_people to authenticated;
