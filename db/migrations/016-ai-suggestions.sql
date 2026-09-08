-- ============================================================
--  ACTOM Grid — 016 assisted drafting, and the record of it
--
--  The system can now offer an inspector a suggestion: a spelling fix, a
--  defect code that may fit, a first draft of an NCR description, past
--  faults that look like the same problem, or an explanation of what a
--  requirement is asking for.
--
--  It never decides whether anything conforms. That is enforced in
--  netlify/functions/lib/guard.cjs, before a suggestion leaves the
--  server, and tested adversarially in test-assist.js. This migration is
--  the other half of the same control: the part that makes it provable
--  afterwards.
--
--  WHY A TABLE AT ALL
--
--  An auditor looking at an inspection record is entitled to ask how the
--  wording got there. Without this table the answer is "an inspector
--  typed it, probably". With it the answer is the truth: what was
--  offered, when, to whom, on which record, from which model, and whether
--  the person took it.
--
--  Rows are written BEFORE the suggestion reaches the browser, not when
--  it is accepted. A suggestion that was shown and ignored is still part
--  of what happened, and recording only the accepted ones would produce a
--  register that flatters the feature.
--
--  Suggestions the boundary REFUSED are recorded too, with the reason and
--  withheld = true. A control nobody can see firing is a control nobody
--  can show is working.
--
--  DECISIONS TAKEN HERE, all reversible, all worth challenging:
--    1. Off by default, per division — a new column on division_profile,
--       the same shape as hold_points and require_second_approver. A
--       quality system should not gain a behaviour because someone
--       deployed; somebody should switch it on and own that.
--    2. input_text is kept in full. It is what the inspector typed, it is
--       already in failed_checks or ncrs, and truncating it would leave
--       the audit trail unable to explain a suggestion.
--    3. accepted is three-state: null until the inspector acts, then true
--       or false. "Not yet answered" and "declined" are different facts.
--    4. No service role key anywhere. The function writes as the signed-in
--       user, so these policies are the whole access model.
-- ============================================================

-- ------------------------------------------------------------
--  PREREQUISITES. Run migrations in order.
-- ------------------------------------------------------------
do $prereq$
begin
  if to_regclass('public.division_profile') is null then
    raise exception '016 needs 001-init-inspections.sql first (division_profile is missing).';
  end if;
  if to_regclass('public.ncrs') is null then
    raise exception '016 needs 014-ncr.sql first (ncrs is missing).';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. The division switch. Off.
-- ------------------------------------------------------------
alter table division_profile
  add column if not exists ai_assist boolean not null default false;

comment on column division_profile.ai_assist is
  'Assisted drafting. Off until a division turns it on deliberately. The '
  'Netlify function refuses every request while this is false, so switching '
  'it off stops the feature everywhere in that division immediately.';

-- ------------------------------------------------------------
--  2. The register.
-- ------------------------------------------------------------
create table if not exists ai_suggestions (
  id              bigserial primary key,
  profile_id      uuid        not null references profiles(id),
  intent          text        not null
                    check (intent in ('spell','defect_code','ncr_draft','similar_faults','explain_check')),
  -- What the suggestion was about, loosely coupled on purpose: a
  -- suggestion may concern a record that is later deleted, and losing the
  -- audit row with it would be the wrong trade.
  context_type    text        check (context_type is null or length(context_type) <= 40),
  context_id      text        check (context_id  is null or length(context_id)  <= 64),
  input_text      text        not null,
  suggestion      jsonb       not null default '{}'::jsonb,
  model           text        not null,
  -- The boundary refused this one.
  withheld        boolean     not null default false,
  withheld_reason text,
  -- null = the inspector has not answered yet.
  accepted        boolean,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),

  -- A withheld suggestion has a reason; a shown one does not.
  constraint ai_withheld_has_reason
    check ((withheld and withheld_reason is not null) or (not withheld and withheld_reason is null)),
  -- Acceptance and its timestamp arrive together or not at all.
  constraint ai_accepted_timestamped
    check ((accepted is null and accepted_at is null) or (accepted is not null and accepted_at is not null)),
  -- Nothing that was refused can be recorded as accepted.
  constraint ai_withheld_not_accepted
    check (not (withheld and accepted is true))
);

create index if not exists ai_suggestions_profile_idx on ai_suggestions (profile_id, created_at desc);
create index if not exists ai_suggestions_context_idx on ai_suggestions (context_type, context_id);
create index if not exists ai_suggestions_created_idx on ai_suggestions (created_at desc);

comment on table ai_suggestions is
  'Every suggestion offered to an inspector, written before it was shown. '
  'Append-only: the only field that may change after insert is whether the '
  'person took it, and that may be set once.';

-- ------------------------------------------------------------
--  3. Append-only.
--
--  The same shape as inspection_results and the NCR tables. Without this
--  the register is a set of rows anyone can rewrite, which is not
--  evidence of anything.
-- ------------------------------------------------------------
create or replace function ai_suggestions_immutable()
returns trigger language plpgsql as $$
begin
  if new.profile_id   is distinct from old.profile_id
  or new.intent       is distinct from old.intent
  or new.context_type is distinct from old.context_type
  or new.context_id   is distinct from old.context_id
  or new.input_text   is distinct from old.input_text
  or new.suggestion   is distinct from old.suggestion
  or new.model        is distinct from old.model
  or new.withheld     is distinct from old.withheld
  or new.withheld_reason is distinct from old.withheld_reason
  or new.created_at   is distinct from old.created_at then
    raise exception 'AI_IMMUTABLE: a recorded suggestion cannot be altered. Only whether it was accepted may be set, once.';
  end if;

  -- Set once. Changing one's mind is a new suggestion, not a rewritten one.
  if old.accepted is not null and new.accepted is distinct from old.accepted then
    raise exception 'AI_ANSWERED: this suggestion was already answered.';
  end if;

  -- The client does not get to choose when it happened.
  if new.accepted is not null then new.accepted_at := coalesce(old.accepted_at, now()); end if;
  return new;
end $$;

drop trigger if exists trg_ai_suggestions_immutable on ai_suggestions;
create trigger trg_ai_suggestions_immutable before update on ai_suggestions
  for each row execute function ai_suggestions_immutable();

-- ------------------------------------------------------------
--  4. Row level security.
-- ------------------------------------------------------------
alter table ai_suggestions enable row level security;

revoke all on ai_suggestions from anon, authenticated;
-- Column-level UPDATE, so the trigger above is the second line and not the
-- only one. A grant that permits rewriting input_text and a trigger that
-- forbids it is one mistake away from permitting it.
grant select, insert on ai_suggestions to authenticated;
grant update (accepted, accepted_at) on ai_suggestions to authenticated;
grant usage on sequence ai_suggestions_id_seq to authenticated;

-- You see your own. A Quality Engineer and above sees all of them,
-- because the point of the register is oversight of the feature.
create policy ai_read on ai_suggestions for select
  using (profile_id = auth.uid()
         or has_role('quality_engineer','quality_manager','sysadmin'));

-- You may only record a suggestion made to you.
create policy ai_write on ai_suggestions for insert
  with check (profile_id = auth.uid());

-- You may only answer your own, and only while it is unanswered.
create policy ai_answer on ai_suggestions for update
  using (profile_id = auth.uid() and accepted is null)
  with check (profile_id = auth.uid());

-- No delete policy, and delete revoked above. Deliberate.

-- ------------------------------------------------------------
--  5. Oversight.
--
--  The questions a Quality Manager will actually ask: is anyone using it,
--  are they taking what it offers, and is the boundary firing.
-- ------------------------------------------------------------
create or replace view v_ai_oversight with (security_invoker = on) as
select date_trunc('month', created_at)::date            as period,
       intent,
       count(*)                                          as offered,
       count(*) filter (where withheld)                  as withheld,
       count(*) filter (where accepted is true)          as accepted,
       count(*) filter (where accepted is false)         as declined,
       count(*) filter (where accepted is null
                          and not withheld)              as no_answer,
       count(distinct profile_id)                        as people
  from ai_suggestions
 group by 1, 2;

grant select on v_ai_oversight to authenticated;

comment on view v_ai_oversight is
  'Monthly use of assisted drafting. `withheld` is the conformance boundary '
  'firing — a rising count is worth reading the reasons for, not celebrating.';

-- ------------------------------------------------------------
--  6. Verification. Run these and read the results.
-- ------------------------------------------------------------
do $verify$
declare v_policies int; v_cols int;
begin
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'ai_suggestions';
  if v_policies < 3 then
    raise exception 'Expected at least 3 policies on ai_suggestions, found %.', v_policies;
  end if;

  select count(*) into v_cols from information_schema.columns
   where table_name = 'division_profile' and column_name = 'ai_assist';
  if v_cols <> 1 then raise exception 'division_profile.ai_assist was not added.'; end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_name = 'ai_suggestions' and privilege_type = 'DELETE'
                and grantee in ('anon','authenticated')) then
    raise exception 'DELETE is granted on ai_suggestions. It must not be.';
  end if;

  raise notice '016 applied. Assisted drafting is OFF for this division until switched on in Administration.';
end $verify$;
