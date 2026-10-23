-- ============================================================
--  036 — Allow inspectors to mark NCR actions as done
--
--  The ncra_edit policy excluded the inspector role, so when an
--  inspector tried to set "Done by" on a corrective action they
--  owned the work for, Supabase rejected the UPDATE and the UI
--  showed "You do not have access to that record."
--
--  Fix: add inspector to the UPDATE policy on ncr_actions.
--  INSERT and DELETE policies are unchanged — only supervisors+
--  can add or remove actions.
-- ============================================================

drop policy if exists ncra_edit on ncr_actions;

create policy ncra_edit on ncr_actions for update
  using  (has_role('inspector','supervisor','quality_engineer','quality_manager','sysadmin'))
  with check (true);

-- ------------------------------------------------------------
--  Verify
-- ------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from pg_policies
     where tablename  = 'ncr_actions'
       and policyname = 'ncra_edit'
       and cmd        = 'UPDATE'
  ) then
    raise exception '036: ncra_edit UPDATE policy was not created.';
  end if;

  raise notice '036: ncra_edit policy updated — inspector can now mark actions done.';
end $verify$;
