-- =====================================================================
-- Migration 016 — advisory qualification recognition
--
-- WHAT THIS IS NOT
--
--   It does not change auto_score, auto_rank, meets_minimum or
--   auto_flags. Scoring stays exactly as migration 005 left it: a
--   weighted mean of the marks configured for the trade. Nothing here
--   moves an applicant up or down the ranking.
--
-- WHAT THIS IS
--
--   HR's scoring workbook awards points for the qualification a person
--   HOLDS, separately from their marks: Academic Matric 1, N2 1,
--   Technical Matric 2, NCV L4 2, N3 2, N4 3, N5 4, N6 5. The portal
--   has never had an equivalent — intake_trade_subjects scores marks in
--   the 'qualification' stream, but nothing recognises the certificate
--   itself.
--
--   This reads applications.highest_qualification, which is free text
--   the applicant types, and records what it appears to say. A reviewer
--   sees the reading and can disregard it.
--
-- WHY PARSING FREE TEXT IS SAFE HERE, AND ONLY HERE
--
--   Parsing what a person typed is unreliable by nature. "N4" and "NCV
--   Level 4" and "Grade 12" all mean different things, applicants
--   abbreviate, and the field has no validation behind it. That is
--   tolerable precisely because the output is advisory. If this ever
--   feeds a score, the free-text source has to be replaced with a
--   structured field first — see the note on qual_source below.
--
--   The workbook's own approach was SUMPRODUCT(SEARCH(...)), a plain
--   substring scan. That reads "Technical Matric" as containing
--   "Matric" and awards both. Here, patterns are word-bounded and a
--   more specific qualification suppresses the ones it supersedes.
--
-- POPIA
--
--   s71 restricts decisions based solely on automated processing.
--   Keeping this advisory, with the reading shown to the reviewer
--   rather than folded into a rank, is the point rather than a
--   limitation.
--
-- Supabase SQL editor safe: no meta-commands, output via SELECT.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Catalogue
--
-- Points come straight from the workbook. patterns are case-insensitive
-- POSIX regexes, word-bounded with \y so "N4" does not match inside
-- "N40" and "matric" does not match inside a longer word. supersedes
-- lists codes that are dropped when this one matches, which is how
-- "Technical Matric" avoids also counting as "Academic Matric".
-- ---------------------------------------------------------------------

create table if not exists public.qualification_catalogue (
  code        text primary key,
  label       text     not null,
  points      smallint not null check (points between 0 and 10),
  patterns    text[]   not null,
  supersedes  text[]   not null default '{}',
  sort_order  smallint not null default 0
);

comment on table public.qualification_catalogue is
  'Advisory only. Recognises what applications.highest_qualification appears to say. Does not affect auto_score.';

insert into public.qualification_catalogue (code, label, points, patterns, supersedes, sort_order) values
  ('ACADEMIC_MATRIC', 'Academic Matric', 1,
   array['\y(academic\s+matric|matric|nsc|national\s+senior\s+certificate|grade\s*12|gr\s*12)\y'],
   '{}', 10),

  ('TECHNICAL_MATRIC', 'Technical Matric', 2,
   array['\y(technical\s+matric|technical\s+grade\s*12|technical\s+nsc|nsc\s*\(?\s*technical)\y'],
   array['ACADEMIC_MATRIC'], 20),

  ('NCV_L4', 'NCV Level 4', 2,
   array['\yncv\s*(l|level)?\s*4\y', '\ynational\s+certificate\s+vocational\s*(l|level)?\s*4\y'],
   '{}', 30),

  ('N2', 'N2', 1, array['\yn\s*2\y'], '{}', 40),
  ('N3', 'N3', 2, array['\yn\s*3\y'], '{}', 50),
  ('N4', 'N4', 3, array['\yn\s*4\y'], '{}', 60),
  ('N5', 'N5', 4, array['\yn\s*5\y'], '{}', 70),
  ('N6', 'N6', 5, array['\yn\s*6\y'], '{}', 80)
on conflict (code) do update
  set label      = excluded.label,
      points     = excluded.points,
      patterns   = excluded.patterns,
      supersedes = excluded.supersedes,
      sort_order = excluded.sort_order;

alter table public.qualification_catalogue enable row level security;

drop policy if exists qualification_catalogue_read on public.qualification_catalogue;
create policy qualification_catalogue_read on public.qualification_catalogue
  for select to authenticated using (true);

drop policy if exists qualification_catalogue_write on public.qualification_catalogue;
create policy qualification_catalogue_write on public.qualification_catalogue
  for all to authenticated
  using (app.require_role('admin'))
  with check (app.require_role('admin'));

revoke all on public.qualification_catalogue from anon;
grant select on public.qualification_catalogue to authenticated;


-- ---------------------------------------------------------------------
-- 2. Advisory columns
--
-- qual_source records how the reading was arrived at. Today it is
-- always 'parsed'. It exists so that when a structured field or a
-- reviewer confirmation replaces the guess, old rows still say which
-- they were — and so nothing downstream can treat a guess and a
-- confirmed value as the same thing.
-- ---------------------------------------------------------------------

alter table public.applications
  add column if not exists qual_codes    text[]   not null default '{}',
  add column if not exists qual_points   smallint,
  add column if not exists qual_highest  text,
  add column if not exists qual_note     text,
  add column if not exists qual_source   text not null default 'parsed'
    check (qual_source in ('parsed', 'confirmed', 'overridden'));

comment on column public.applications.qual_points is
  'Advisory workbook points for the qualification held. Deliberately NOT part of auto_score.';
comment on column public.applications.qual_source is
  'parsed = guessed from free text. Do not use a parsed value in any ranking.';


-- ---------------------------------------------------------------------
-- 3. Parser
--
-- Pure: takes text, returns rows. No side effects, so it can be called
-- in a SELECT to preview what a wording would be read as before
-- anything is written.
-- ---------------------------------------------------------------------

create or replace function public.parse_qualifications(p_text text)
returns table (code text, label text, points smallint)
language sql
stable
as $$
  with hit as (
    select q.code, q.label, q.points, q.supersedes, q.sort_order
      from public.qualification_catalogue q
     where coalesce(p_text, '') <> ''
       and exists (
         select 1 from unnest(q.patterns) pat
          where p_text ~* pat
       )
  ),
  beaten as (
    select distinct unnest(supersedes) as code from hit
  )
  select h.code, h.label, h.points
    from hit h
   where h.code not in (select code from beaten)
   order by h.points desc, h.sort_order;
$$;

revoke all on function public.parse_qualifications(text) from anon;
grant execute on function public.parse_qualifications(text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Apply to an application
--
-- Writes only the qual_* columns. It never touches auto_score,
-- auto_rank, auto_flags, meets_minimum or scored_at — if a future edit
-- makes it do so, that is a change of policy, not a refactor.
-- ---------------------------------------------------------------------

create or replace function app_private.assess_qualification(p_application uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text    text;
  v_codes   text[] := '{}';
  v_points  smallint;
  v_highest text;
  v_note    text;
begin
  select highest_qualification into v_text
    from public.applications where id = p_application;

  select array_agg(code order by points desc, code),
         max(points),
         (array_agg(label order by points desc, code))[1]
    into v_codes, v_points, v_highest
    from public.parse_qualifications(v_text);

  v_codes := coalesce(v_codes, '{}');

  if btrim(coalesce(v_text, '')) = '' then
    v_note := 'No further qualification captured.';
  elsif cardinality(v_codes) = 0 then
    v_note := 'Not recognised from what the applicant typed. Check the certificate.';
  elsif cardinality(v_codes) > 1 then
    v_note := 'Reading of free text. Highest counted; the rest are listed for context.';
  else
    v_note := 'Reading of free text. Confirm against the certificate.';
  end if;

  update public.applications
     set qual_codes   = v_codes,
         qual_points  = v_points,
         qual_highest = v_highest,
         qual_note    = v_note,
         qual_source  = 'parsed'
   where id = p_application;
end;
$$;

revoke all on function app_private.assess_qualification(uuid) from anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. Keep it current
--
-- Separate from applications_score deliberately. Scoring fires only on
-- the draft -> submitted transition and returns early when the intake
-- has scoring_enabled = false. The qualification reading should be
-- present regardless, and should follow a later correction to the text.
-- ---------------------------------------------------------------------

create or replace function app_private.assess_qualification_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.highest_qualification is distinct from old.highest_qualification then
    perform app_private.assess_qualification(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists applications_assess_qualification on public.applications;
create trigger applications_assess_qualification
  after insert or update of highest_qualification on public.applications
  for each row execute function app_private.assess_qualification_trg();


-- ---------------------------------------------------------------------
-- 6. Grants
--
-- Column-level, matching the auto_score grant in migration 002.
-- ---------------------------------------------------------------------

grant select (qual_codes, qual_points, qual_highest, qual_note, qual_source)
  on public.applications to authenticated;


-- ---------------------------------------------------------------------
-- 7. Backfill
-- ---------------------------------------------------------------------

do $$
declare r record;
begin
  for r in select id from public.applications loop
    perform app_private.assess_qualification(r.id);
  end loop;
end;
$$;


-- =====================================================================
-- 8. Verification
-- =====================================================================

select 'catalogue rows' as check, count(*)::text as result
  from public.qualification_catalogue;

-- Precedence and word boundaries. Every row below should read as stated.
select t.wording,
       coalesce(string_agg(p.code, ' + ' order by p.points desc), '(none)') as reads_as,
       coalesce(max(p.points)::text, '—') as highest_points
  from (values
    ('Academic Matric',            'ACADEMIC_MATRIC only'),
    ('Technical Matric',           'TECHNICAL_MATRIC only, not also ACADEMIC_MATRIC'),
    ('Academic matric and NCV L4', 'ACADEMIC_MATRIC + NCV_L4'),
    ('Academic Matric and N6',     'ACADEMIC_MATRIC + N6'),
    ('NCV Level 4',                'NCV_L4 only, not N4'),
    ('N4 and N5',                  'N4 + N5, highest 4'),
    ('Grade 12',                   'ACADEMIC_MATRIC'),
    ('BTech Mechanical',           '(none) — unrecognised, flagged for the reviewer'),
    ('',                           '(none) — nothing captured')
  ) as t(wording, expected)
  left join lateral public.parse_qualifications(t.wording) p on true
 group by t.wording, t.expected
 order by t.wording;

-- Confirm the ranking columns were untouched.
select 'applications with a parsed qualification' as check,
       count(*) filter (where cardinality(qual_codes) > 0)::text as result
  from public.applications
union all
select 'applications where the text was not recognised',
       count(*) filter (
         where btrim(coalesce(highest_qualification,'')) <> ''
           and cardinality(qual_codes) = 0)::text
  from public.applications;
