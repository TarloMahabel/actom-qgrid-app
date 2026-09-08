-- =====================================================================
-- 015 — NCR status derived from the row being written, and closing made
--       reachable only through close_ncr.
--
-- TWO FAULTS, FOUND TOGETHER.
--
-- 1. A closed NCR displayed as "Verified" in the register.
--
--    stamp_ncr (BEFORE UPDATE) ended with
--        new.status := ncr_status(new.id);
--    and ncr_status(uuid) re-read the row with SELECT * INTO. Inside a
--    BEFORE UPDATE trigger that read returns the row as it stands on disk,
--    not as it is about to be written, so the closed_at that close_ncr had
--    just assigned was invisible and the ladder fell through to 'verified'.
--
--    close_ncr's second `update ncrs set status = 'closed'` was an earlier
--    attempt to work around this. It could not: being a second call to a
--    STABLE function with an unchanged argument inside one transaction, it
--    was answerable from cache and returned the same 'verified'.
--
--    Passing the row value removes the read, so the derivation sees the
--    pending values and is right on the first statement. This also repairs
--    the earlier stage transitions — contained, cause_identified,
--    action_agreed, action_done — which had the same staleness and only
--    settled when some later unrelated write touched the record.
--
-- 2. Closing an NCR did not have to go through close_ncr at all.
--
--    Policy ncr_edit permits update to the raiser, the person responsible
--    and any supervisor, with `with check (true)`. closed_at is an ordinary
--    column, so one PostgREST PATCH could close an NCR with no root cause,
--    no corrective action and no Quality Engineer — bypassing every gate in
--    close_ncr and its role check with it.
--
--    The application never does this; patchNcr only ever sends
--    responsibility, containment, cause and cost. But an authorisation rule
--    that holds only because the client is well-behaved is not a control,
--    and on this table it is the control an auditor would ask to see.
--
--    The gate is put where the client cannot reach around it: a trigger
--    that refuses any change to closed_at or closed_by unless close_ncr has
--    announced itself for the current transaction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 — Derivation over a row value. The ladder is unchanged.
-- ---------------------------------------------------------------------
create or replace function public.ncr_status(n public.ncrs)
returns text language plpgsql stable as $$
declare v_actions int; v_done int; v_verified int;
begin
  if n.closed_at is not null then return 'closed'; end if;
  select count(*), count(done_at), count(verified_at)
    into v_actions, v_done, v_verified
    from ncr_actions where ncr_id = n.id;
  if v_actions > 0 and v_verified = v_actions then return 'verified'; end if;
  if v_actions > 0 and v_done = v_actions     then return 'action_done'; end if;
  if v_actions > 0                             then return 'action_agreed'; end if;
  if n.root_cause_id is not null               then return 'cause_identified'; end if;
  if n.containment is not null and length(btrim(n.containment)) > 0 then return 'contained'; end if;
  return 'open';
end $$;

-- ---------------------------------------------------------------------
-- 2 — The uuid form kept for any other caller, as a wrapper over the row
--     form, so there is one ladder rather than two that can drift apart.
-- ---------------------------------------------------------------------
create or replace function public.ncr_status(p_ncr uuid)
returns text language sql stable as $$
  select public.ncr_status(n) from public.ncrs n where n.id = p_ncr;
$$;

-- ---------------------------------------------------------------------
-- 3 — Trigger derives from NEW, and guards the closure columns.
-- ---------------------------------------------------------------------
create or replace function public.stamp_ncr()
returns trigger language plpgsql as $$
begin
  -- Cost total from its parts when any part is given.
  if coalesce(new.cost_material, new.cost_labour, new.cost_rework, new.cost_other) is not null then
    new.cost_total := coalesce(new.cost_material,0) + coalesce(new.cost_labour,0)
                    + coalesce(new.cost_rework,0)  + coalesce(new.cost_other,0);
  end if;

  if tg_op = 'UPDATE' then
    /* Closing is an act with conditions attached, so it happens in one place.
       close_ncr sets grid.closing for its transaction; a direct PATCH cannot. */
    if (new.closed_at is distinct from old.closed_at
        or new.closed_by is distinct from old.closed_by)
       and coalesce(current_setting('grid.closing', true), '') <> '1' then
      raise exception 'NCR_CLOSE_PATH: an NCR is closed through close_ncr, which '
        'requires a root cause and a verified corrective action. It cannot be '
        'closed by editing the record.';
    end if;

    -- Who did what, when, written by the database rather than the browser.
    if new.containment is distinct from old.containment
       and new.containment is not null and length(btrim(new.containment)) > 0 then
      new.contained_by := coalesce(new.contained_by, auth.uid());
      new.contained_at := coalesce(new.contained_at, now());
    end if;
    if new.root_cause_id is distinct from old.root_cause_id and new.root_cause_id is not null then
      new.cause_by := coalesce(new.cause_by, auth.uid());
      new.cause_at := coalesce(new.cause_at, now());
    end if;
  end if;

  new.status := public.ncr_status(new);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4 — close_ncr.
--
--     The redundant second UPDATE comes out: status now follows from
--     closed_at through the trigger, so it has a single writer and there is
--     no statement whose only job is correcting the one before it.
--
--     The returned status is read back from the row rather than asserted as
--     a literal, so the caller can no longer be told 'closed' by a function
--     that closed nothing. The RLS check moves to `returning` for the same
--     reason.
-- ---------------------------------------------------------------------
create or replace function public.close_ncr(p_ncr uuid, p_note text default null)
returns jsonb language plpgsql as $$
declare n ncrs; v_actions int; v_verified int; v_ref text; v_status text;
begin
  if not has_role('quality_engineer','quality_manager','sysadmin') then
    raise exception 'NCR_ROLE: only a Quality Engineer or above may close an NCR';
  end if;
  select * into n from ncrs where id = p_ncr;
  if n.id is null then raise exception 'NCR_MISSING: not found'; end if;
  if n.closed_at is not null then
    raise exception 'NCR_CLOSED: % is already closed', n.ref;
  end if;

  -- The two things the old register could not enforce, and did not have.
  if n.root_cause_id is null then
    raise exception 'NCR_NO_CAUSE: % cannot be closed without a root cause', n.ref;
  end if;
  select count(*), count(verified_at) into v_actions, v_verified
    from ncr_actions where ncr_id = p_ncr;
  if v_actions = 0 then
    raise exception 'NCR_NO_ACTION: % cannot be closed without a corrective action', n.ref;
  end if;
  if v_verified < v_actions then
    raise exception 'NCR_UNVERIFIED: % has % corrective action(s) not yet verified',
      n.ref, v_actions - v_verified;
  end if;

  /* Announce the closure to the trigger guard. Transaction-local: it cannot
     leak into a later statement on the same connection. */
  perform set_config('grid.closing', '1', true);

  update ncrs
     set closed_by = auth.uid(), closed_at = now(),
         concession_note = coalesce(p_note, concession_note)
   where id = p_ncr
   returning ref, status into v_ref, v_status;

  perform set_config('grid.closing', '0', true);

  if v_ref is null then
    raise exception 'NCR_BLOCKED: row level security prevented the change.';
  end if;
  if v_status <> 'closed' then
    raise exception 'NCR_STATUS: % was stamped % rather than closed', v_ref, v_status;
  end if;
  return jsonb_build_object('ref', v_ref, 'status', v_status);
end $$;

-- ---------------------------------------------------------------------
-- 5 — Repair the rows already stranded.
--
--     Scoped to rows whose stored status disagrees with the derivation, so
--     trg_audit_ncrs records real corrections rather than a no-op per NCR.
--     The assignment is nominal — the trigger recomputes it — but the WHERE
--     is what keeps the audit trail honest.
--
--     grid.closing is set because these rows already carry closed_at and the
--     guard would otherwise refuse a repair that changes nothing about it.
-- ---------------------------------------------------------------------
do $$
declare v_rows int;
begin
  perform set_config('grid.closing', '1', true);
  update public.ncrs n
     set status = public.ncr_status(n)
   where n.status is distinct from public.ncr_status(n);
  get diagnostics v_rows = row_count;
  perform set_config('grid.closing', '0', true);
  raise notice '015: corrected the status of % NCR(s).', v_rows;
end $$;
