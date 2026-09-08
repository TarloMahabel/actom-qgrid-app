-- =====================================================================
-- Repair: return a prematurely-opened intake to draft
--
-- The seed originally created its intake as 'open'. Migration 002 then
-- installs the publish lock, which freezes it — so its trades, subjects
-- and documents can never be added, and Form setup shows empty grids
-- that cannot be filled.
--
-- The lock is working exactly as designed. The mistake was seeding an
-- intake as open before it had any configuration.
--
-- This script only touches intakes that have NO applications against
-- them. An intake that real applicants have used is a legal record and
-- is left alone, whatever its status.
-- =====================================================================

do $$
declare
  v_ids  uuid[];
  v_id   uuid;
  v_name text;
  v_stat text;
  v_apps integer;
  v_fixed integer := 0;
begin
  -- Collect first. A cursor open over public.intakes blocks the
  -- ALTER TABLE below with "relation is being used by active queries
  -- in this session", so the loop must not be reading from it.
  select array_agg(id) into v_ids
    from public.intakes i
   where i.status <> 'draft'
     and not exists (select 1 from public.applications a where a.intake_id = i.id);

  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise notice 'Nothing to repair: no non-draft intake without applications.';
    return;
  end if;

  -- guard_intake_write() refuses a direct return to draft, and rightly
  -- so. Disabled only for this repair, then immediately re-enabled.
  alter table public.intakes disable trigger guard_intakes;

  foreach v_id in array v_ids loop
    select name, status into v_name, v_stat from public.intakes where id = v_id;
    update public.intakes
       set status = 'draft', published_at = null, closed_at = null
     where id = v_id;
    raise notice 'Returned "%" to draft (was %).', v_name, v_stat;
    v_fixed := v_fixed + 1;
  end loop;

  alter table public.intakes enable trigger guard_intakes;

  raise notice '% intake(s) repaired.', v_fixed;

  -- Any intake WITH applications is a legal record; report and leave alone.
  for v_id in select i.id from public.intakes i
               where i.status <> 'draft'
                 and exists (select 1 from public.applications a where a.intake_id = i.id)
  loop
    select name into v_name from public.intakes where id = v_id;
    raise notice 'SKIPPED "%" — it has applications against it.', v_name;
  end loop;
end $$;


-- ---------------------------------------------------------------------
-- Confirm. Every intake here should read 'draft' before you run
-- 003-create-intake.sql to populate its configuration.
-- ---------------------------------------------------------------------
select i.name, i.status,
       (select count(*) from public.applications a where a.intake_id = i.id) as applications,
       (select count(*) from public.intake_trades it
         where it.intake_id = i.id and it.active)                            as trades,
       (select count(*) from public.intake_trade_subjects s
         where s.intake_id = i.id)                                           as subject_rules,
       (select count(*) from public.intake_documents d
         where d.intake_id = i.id)                                           as documents
  from public.intakes i
 order by i.created_at;
