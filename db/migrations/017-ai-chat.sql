-- ============================================================
--  ACTOM Grid — 017 the assistant can be asked questions
--
--  016 recorded suggestions offered into a field. This adds conversation:
--  an inspector can ask what the register says and get an answer drawn
--  from it by read-only lookups, under their own row level security.
--
--  Three things this migration is for.
--
--  1. `chat` becomes a permitted intent. The check constraint from 016
--     listed five and would reject it.
--
--  2. `thread_id` groups the turns of one conversation. It is not
--     decoration: netlify/functions/chat.mjs rebuilds the conversation
--     by reading these rows rather than trusting the browser to send the
--     history back. A client that can assert what the assistant said
--     previously can talk it into repeating a determination it never
--     made, so the register is the only history there is. That makes this
--     column load-bearing for the conformance boundary, not just for
--     reporting.
--
--  3. `ai_chat` is a SEPARATE switch from `ai_assist`. A division may
--     reasonably want spelling help in a fault note and not want a
--     chatbot over its nonconformance register. Bundling them would
--     force a choice nobody asked for, and would mean turning off the
--     chatbot after an audit question also turned off the spell checker.
--
--  WHAT DOES NOT CHANGE. Append-only, delete revoked, the immutability
--  trigger, and the rule that a turn is written before it is shown. A
--  conversation the register cannot account for is exactly what this
--  table exists to prevent.
-- ============================================================

-- ------------------------------------------------------------
--  PREREQUISITES.
-- ------------------------------------------------------------
do $prereq$
begin
  if to_regclass('public.ai_suggestions') is null then
    raise exception '017 needs 016-ai-suggestions.sql first (ai_suggestions is missing).';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Its own switch. Off.
-- ------------------------------------------------------------
alter table division_profile
  add column if not exists ai_chat boolean not null default false;

comment on column division_profile.ai_chat is
  'The question-and-answer assistant. Separate from ai_assist so a division '
  'can have drafting help without a chatbot over its register, or stop the '
  'chatbot without losing the spell checker.';

-- ------------------------------------------------------------
--  2. Thread grouping.
-- ------------------------------------------------------------
alter table ai_suggestions
  add column if not exists thread_id uuid;

create index if not exists ai_suggestions_thread_idx
  on ai_suggestions (thread_id, created_at)
  where thread_id is not null;

comment on column ai_suggestions.thread_id is
  'Groups the turns of one conversation. Read back by the chat function to '
  'rebuild context, because the browser is not a trustworthy source for what '
  'the assistant said earlier.';

-- ------------------------------------------------------------
--  3. Permit the new intent.
--
--  The constraint is looked up rather than named. A column check gets an
--  auto-generated name, and hardcoding the one PostgreSQL happened to
--  choose on one project is how a migration works in staging and fails in
--  production.
-- ------------------------------------------------------------
do $intent$
declare v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public' and rel.relname = 'ai_suggestions'
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%intent%similar_faults%';

  if v_name is not null then
    execute format('alter table ai_suggestions drop constraint %I', v_name);
  end if;

  -- NOT VALID would be wrong here: this widens what is allowed, so every
  -- existing row already satisfies it and there is nothing to tolerate.
  alter table ai_suggestions
    add constraint ai_suggestions_intent_check
    check (intent in ('spell','defect_code','ncr_draft','similar_faults','explain_check','chat'));
end $intent$;

-- ------------------------------------------------------------
--  4. A chat turn must belong to a conversation.
--
--  Without this, a turn written with no thread_id is invisible to the
--  history rebuild and the conversation silently loses its memory — which
--  presents as the assistant contradicting itself rather than as an error.
-- ------------------------------------------------------------
alter table ai_suggestions
  drop constraint if exists ai_chat_has_thread;
alter table ai_suggestions
  add constraint ai_chat_has_thread
  check (intent <> 'chat' or thread_id is not null) not valid;

-- NOT VALID, then validated separately: if a division somehow already has
-- chat rows without a thread, this reports them rather than refusing to
-- apply, and deleting rows from an append-only register is not a decision
-- a migration should take.
do $validate$
begin
  begin
    alter table ai_suggestions validate constraint ai_chat_has_thread;
  exception when check_violation then
    raise warning 'Some chat rows have no thread_id. The constraint is in force for new rows but existing ones need looking at: select id, created_at from ai_suggestions where intent = ''chat'' and thread_id is null;';
  end;
end $validate$;

-- ------------------------------------------------------------
--  5. Oversight, extended.
--
--  The chat-specific question a Quality Manager will ask is not "how many
--  turns" but "what was it asked that it refused", because that is where
--  the boundary is under pressure.
-- ------------------------------------------------------------
create or replace view v_ai_refusals with (security_invoker = on) as
select a.created_at,
       a.intent,
       p.full_name        as asked_by,
       a.input_text       as question,
       a.withheld_reason  as refused_because
  from ai_suggestions a
  join profiles p on p.id = a.profile_id
 where a.withheld
 order by a.created_at desc;

grant select on v_ai_refusals to authenticated;

comment on view v_ai_refusals is
  'Every time the conformance boundary stopped an answer, and what was asked. '
  'Read this before an audit. A pattern of the same person asking the same '
  'question is a training conversation, not a system fault.';

-- ------------------------------------------------------------
--  6. Verification.
-- ------------------------------------------------------------
do $verify$
declare v_ok boolean;
begin
  select pg_get_constraintdef(con.oid) ilike '%chat%' into v_ok
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
   where rel.relname = 'ai_suggestions' and con.conname = 'ai_suggestions_intent_check';
  if not coalesce(v_ok, false) then
    raise exception 'The intent constraint does not permit chat.';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_name = 'ai_suggestions' and column_name = 'thread_id') then
    raise exception 'thread_id was not added.';
  end if;

  if exists (select 1 from information_schema.role_table_grants
              where table_name = 'ai_suggestions' and privilege_type = 'DELETE'
                and grantee in ('anon','authenticated')) then
    raise exception 'DELETE is granted on ai_suggestions. It must not be.';
  end if;

  raise notice '017 applied. The assistant is OFF for this division until ai_chat is switched on in Administration.';
end $verify$;
