-- ============================================================
--  ACTOM Grid — 018 what was done before, under this cause
--
--  WHAT THIS IS FOR, and what it deliberately is not.
--
--  The assistant can draft an NCR description. It is now asked whether it
--  can propose corrective actions too. It cannot, and should not: an
--  assistant that invents a plausible action makes the SYMPTOM look
--  fixed. The corrective action field fills up, the percentage climbs,
--  and an auditor finds "retrain the operator" recorded against forty
--  different causes. The register this system replaces sat at 1% root
--  cause and 19% corrective action across 475 records — it did not fail
--  because nobody could think of an action. It failed because nobody was
--  investigating, and a generator would hide that rather than fix it.
--
--  So this view is RECALL, not advice. It answers one question: under
--  this root cause, what has this division actually done before, and did
--  it work. Every row is a record somebody wrote. Nothing is generated.
--
--  The column that earns its keep is `recurred_on_same_part`. An action
--  that was verified, against a part that then came back under the same
--  cause, is a corrective action that did not correct anything. That is
--  a finding, and it is the thing the old workbook could never tell
--  anyone.
--
--  Ordering is deliberately absent: a view with an order by invites
--  callers to depend on it. The tool and the UI each say what they want.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.ncr_actions') is null then
    raise exception '018 needs 014-ncr.sql first (ncr_actions is missing).';
  end if;
end $prereq$;

create or replace view v_ncr_actions_by_cause with (security_invoker = on) as
select rc.name                     as cause,
       rc.category                 as category,
       n.ref                       as ncr_ref,
       n.part_description          as part_description,
       n.part_no                   as part_no,
       n.raised_at::date           as raised_on,
       n.severity                  as severity,
       a.action                    as action,
       ow.full_name                as owner,
       a.due_date                  as due_date,
       a.done_at::date             as done_on,
       a.verified_at::date         as verified_on,
       (a.verified_at is not null) as verified,
       -- The part came back under the same cause AFTER this action was
       -- verified. Null part numbers are not matched to each other:
       -- "unknown part" is not a part, and treating it as one would
       -- manufacture recurrences out of missing data.
       (select count(*)
          from ncrs later
         where later.root_cause_id = n.root_cause_id
           and later.id <> n.id
           and later.part_no is not null
           and n.part_no is not null
           and later.part_no = n.part_no
           and later.raised_at > coalesce(a.verified_at, a.done_at, n.raised_at)
       )                           as recurred_on_same_part
  from ncr_actions a
  join ncrs n         on n.id = a.ncr_id
  join root_causes rc on rc.id = n.root_cause_id
  left join profiles ow on ow.id = a.owner_id
 where n.root_cause_id is not null;

grant select on v_ncr_actions_by_cause to authenticated;

comment on view v_ncr_actions_by_cause is
  'Corrective actions that have actually been recorded, grouped by root cause. '
  'For recall, not recommendation: the assistant may show what this division '
  'has done before under a cause, and may not invent an action. '
  'recurred_on_same_part > 0 means the part came back after this action was '
  'signed off, which is a corrective action that did not correct anything.';

do $verify$
begin
  if not exists (select 1 from pg_class c join pg_namespace nsp on nsp.oid = c.relnamespace
                  where nsp.nspname = 'public' and c.relname = 'v_ncr_actions_by_cause') then
    raise exception 'The view was not created.';
  end if;
  raise notice '018 applied. Prior corrective actions are visible on an NCR once a root cause is recorded.';
end $verify$;
