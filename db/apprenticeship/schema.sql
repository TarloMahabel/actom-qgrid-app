-- =====================================================================
-- ACTOM Apprentice & Learnership Application Portal
-- Supabase / PostgreSQL schema, security model and retention jobs
--
-- Run order:  this file is idempotent-ish and intended to be run once,
-- top to bottom, in the Supabase SQL editor as the postgres role.
--
-- POPIA NOTE
--   This schema stores Special Personal Information (s26): race/ethnic
--   group and disability status, plus SA ID numbers which encode date of
--   birth, gender and citizenship. Every design decision below is made to
--   satisfy s19 (security safeguards), s14 (retention), s23 (access) and
--   s35 (processing personal information of children).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Extensions and schemas
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto  with schema extensions;
create extension if not exists pg_cron;

-- app         : callable helpers (SECURITY DEFINER, exposed to PostgREST)
-- app_private : never exposed. Key material and raw crypto live here.
create schema if not exists app;
create schema if not exists app_private;

revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app to anon, authenticated;


-- ---------------------------------------------------------------------
-- 1. Key material
--
-- The ID encryption key and the hashing pepper live in Supabase Vault,
-- NOT in this file and NOT in any environment variable the browser sees.
-- Create them once with:
--
--   select vault.create_secret('<64 random hex chars>', 'applicant_id_key');
--   select vault.create_secret('<64 random hex chars>', 'applicant_id_pepper');
--
-- Generate with: openssl rand -hex 32
-- Store the recovery copy in the ACTOM password vault under IT Security.
-- ---------------------------------------------------------------------
create or replace function app_private.secret(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;
revoke all on function app_private.secret(text) from public, anon, authenticated;

create or replace function app_private.encrypt_id(p_plain text)
returns bytea language sql stable security definer set search_path = '' as $$
  select case when p_plain is null or btrim(p_plain) = '' then null
         else extensions.pgp_sym_encrypt(
                btrim(p_plain),
                app_private.secret('applicant_id_key'),
                'compress-algo=0, cipher-algo=aes256')
         end;
$$;
revoke all on function app_private.encrypt_id(text) from public, anon, authenticated;

create or replace function app_private.decrypt_id(p_cipher bytea)
returns text language sql stable security definer set search_path = '' as $$
  select case when p_cipher is null then null
         else extensions.pgp_sym_decrypt(p_cipher, app_private.secret('applicant_id_key'))
         end;
$$;
revoke all on function app_private.decrypt_id(bytea) from public, anon, authenticated;

-- Peppered hash. Lets us detect duplicate applications without ever
-- holding a plaintext ID number in an index.
create or replace function app_private.hash_id(p_plain text)
returns text language sql immutable security definer set search_path = '' as $$
  select case when p_plain is null or btrim(p_plain) = '' then null
         else encode(extensions.digest(
                btrim(p_plain) || app_private.secret('applicant_id_pepper'),
                'sha256'), 'hex')
         end;
$$;
revoke all on function app_private.hash_id(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Reference data
-- ---------------------------------------------------------------------
create table if not exists public.intakes (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  opens_at          timestamptz not null,
  closes_at         timestamptz not null,
  status            text not null default 'draft'
                    check (status in ('draft','open','closed','archived')),
  -- s14: how long after close we may keep unsuccessful applications
  retention_months  smallint not null default 12,
  created_at        timestamptz not null default now()
);

create table if not exists public.trades (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  division      text,
  stream        text not null default 'both'
                check (stream in ('academic','technical','both')),
  active        boolean not null default true,
  sort_order    smallint not null default 100
);

create table if not exists public.intake_trades (
  intake_id  uuid not null references public.intakes(id) on delete cascade,
  trade_id   uuid not null references public.trades(id) on delete cascade,
  positions  smallint,
  primary key (intake_id, trade_id)
);

-- Subject catalogue, replacing the ~180 flat spreadsheet columns.
create table if not exists public.subjects (
  id          uuid primary key default gen_random_uuid(),
  stream      text not null check (stream in ('academic','technical','qualification')),
  name        text not null,
  sort_order  smallint not null default 100,
  active      boolean not null default true,
  unique (stream, name)
);

-- Consent wording is versioned. We store which version an applicant saw,
-- so a later change to the wording can never be back-applied to an old
-- consent record.
create table if not exists public.consent_versions (
  id            uuid primary key default gen_random_uuid(),
  -- Unique on (version, audience), NOT on version alone: one version
  -- number carries both the applicant and the guardian wording, and a
  -- unique(version) constraint silently discards the second on insert.
  version       text not null,
  audience      text not null check (audience in ('applicant','guardian')),
  body          text not null,
  body_sha256   text generated always as
                (encode(extensions.digest(body, 'sha256'), 'hex')) stored,
  effective_from timestamptz not null default now(),
  active        boolean not null default true,
  unique (version, audience)
);


-- ---------------------------------------------------------------------
-- 3. Applications
-- ---------------------------------------------------------------------
create table if not exists public.applications (
  id                    uuid primary key default gen_random_uuid(),
  reference             text unique,
  applicant_user_id     uuid not null references auth.users(id) on delete cascade,
  intake_id             uuid not null references public.intakes(id),
  trade_id              uuid references public.trades(id),

  status                text not null default 'draft'
                        check (status in ('draft','submitted','under_review',
                                          'shortlisted','declined','withdrawn')),

  -- Identity ------------------------------------------------------------
  full_name             text,
  id_type               text check (id_type in ('sa_id','passport')),
  id_number_enc         bytea,        -- AES-256, key in Vault
  id_number_last4       text,         -- for reviewer disambiguation only
  id_number_hash        text,         -- peppered SHA-256, duplicate detection
  passport_country      text,
  date_of_birth         date,         -- derived from SA ID, drives s35 branch
  gender                text check (gender in ('female','male','other','undisclosed')),
  citizenship           text check (citizenship in ('sa_citizen','permanent_resident','other')),
  -- Not a generated column: PostgreSQL requires generation expressions to
  -- be IMMUTABLE, and current_date is only STABLE. Maintained by the
  -- trigger below, which also keeps it correct if a birth date is edited.
  is_minor              boolean not null default false,

  -- Contact -------------------------------------------------------------
  contact_number        text,
  email                 text,
  address_line1         text,
  address_line2         text,
  suburb                text,
  city                  text,
  province              text,
  postal_code           text,
  country               text default 'South Africa',

  -- Employment equity (s26 special personal information) -----------------
  -- Collected under the Employment Equity Act 55 of 1998 reporting duty.
  -- 'undisclosed' is always a valid answer and must never block submission.
  ethnic_group          text check (ethnic_group in
                        ('african','coloured','indian','white','other','undisclosed')),
  has_disability        text check (has_disability in ('yes','no','undisclosed')),
  disability_types      text[] not null default '{}',
  disability_other      text,

  -- Education -----------------------------------------------------------
  grade12_type          text check (grade12_type in
                        ('nsc','nsc_technical','ncv_l4','senior_certificate',
                         'amended_senior_certificate','none')),
  grade12_year          smallint,
  highest_qualification text,
  highest_qual_institution text,
  highest_qual_year     smallint,

  -- Lifecycle -----------------------------------------------------------
  submitted_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- s14 retention: set at submission from intakes.retention_months
  purge_after           date,
  legal_hold            boolean not null default false,

  constraint applications_one_per_intake unique (applicant_user_id, intake_id)
);

create index if not exists applications_status_idx    on public.applications(status);
create index if not exists applications_intake_idx    on public.applications(intake_id);
create index if not exists applications_trade_idx     on public.applications(trade_id);
create index if not exists applications_idhash_idx    on public.applications(id_number_hash)
  where id_number_hash is not null;
create index if not exists applications_purge_idx     on public.applications(purge_after)
  where legal_hold = false;

-- Marks, one row per subject. Replaces the flat column explosion.
create table if not exists public.application_subjects (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications(id) on delete cascade,
  stream          text not null check (stream in ('academic','technical','qualification')),
  subject_name    text not null,
  mark            smallint check (mark between 0 and 100),
  created_at      timestamptz not null default now(),
  unique (application_id, stream, subject_name)
);
create index if not exists application_subjects_app_idx
  on public.application_subjects(application_id);

-- Guardian consent, required when is_minor (POPIA s35).
create table if not exists public.guardians (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null unique
                    references public.applications(id) on delete cascade,
  full_name         text not null,
  relationship      text not null,
  contact_number    text not null,
  email             text,
  id_number_enc     bytea,
  id_number_last4   text,
  created_at        timestamptz not null default now()
);

-- Immutable consent records.
create table if not exists public.consents (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null references public.applications(id) on delete cascade,
  consent_version_id  uuid not null references public.consent_versions(id),
  audience            text not null check (audience in ('applicant','guardian')),
  body_sha256         text not null,
  granted_at          timestamptz not null default now(),
  granted_ip          inet,
  user_agent          text
);
create index if not exists consents_app_idx on public.consents(application_id);

-- Uploaded documents. The bytes live in a private Storage bucket; this
-- table is the catalogue and the integrity record.
create table if not exists public.application_documents (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.applications(id) on delete cascade,
  doc_type          text not null check (doc_type in
                    ('id_document','matric_certificate','qualification','other')),
  storage_path      text not null unique,
  original_filename text not null,
  mime_type         text not null,
  size_bytes        bigint not null,
  sha256            text,
  scan_status       text not null default 'pending'
                    check (scan_status in ('pending','clean','quarantined','failed')),
  uploaded_at       timestamptz not null default now()
);
create index if not exists application_documents_app_idx
  on public.application_documents(application_id);

-- Reviewer workflow
create table if not exists public.application_reviews (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications(id) on delete cascade,
  reviewer_id     uuid not null references auth.users(id),
  decision        text check (decision in ('shortlist','decline','hold')),
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists application_reviews_app_idx
  on public.application_reviews(application_id);


-- ---------------------------------------------------------------------
-- 4. Reviewers (ACTOM staff, Entra-authenticated)
--
-- Inactive until activated: a new Entra sign-in creates a row with
-- active = false and sees nothing until IT/HR flips the flag.
-- ---------------------------------------------------------------------
create table if not exists public.reviewer_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'reviewer'
              check (role in ('reviewer','manager','admin','information_officer')),
  active      boolean not null default false,
  division    text,
  created_at  timestamptz not null default now()
);

-- Reviewers may be scoped to particular trades. No rows = all trades.
create table if not exists public.reviewer_trades (
  user_id   uuid not null references public.reviewer_profiles(user_id) on delete cascade,
  trade_id  uuid not null references public.trades(id) on delete cascade,
  primary key (user_id, trade_id)
);


-- ---------------------------------------------------------------------
-- 5. Audit trails (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.pii_access_log (
  id              bigserial primary key,
  actor_id        uuid,
  actor_email     text,
  application_id  uuid,
  action          text not null,   -- reveal_id | download_document | export | view
  detail          text,
  occurred_at     timestamptz not null default now()
);
create index if not exists pii_access_log_app_idx  on public.pii_access_log(application_id);
create index if not exists pii_access_log_time_idx on public.pii_access_log(occurred_at desc);

create table if not exists public.application_events (
  id              bigserial primary key,
  application_id  uuid,
  actor_id        uuid,
  event           text not null,
  from_status     text,
  to_status       text,
  detail          jsonb,
  occurred_at     timestamptz not null default now()
);
create index if not exists application_events_app_idx on public.application_events(application_id);


-- ---------------------------------------------------------------------
-- 6. Helper functions
-- ---------------------------------------------------------------------
create or replace function app.is_reviewer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reviewer_profiles p
                 where p.user_id = auth.uid() and p.active);
$$;

create or replace function app.reviewer_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.reviewer_profiles p
   where p.user_id = auth.uid() and p.active;
$$;

create or replace function app.can_see_trade(p_trade uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_reviewer()
     and (not exists (select 1 from public.reviewer_trades t where t.user_id = auth.uid())
          or exists (select 1 from public.reviewer_trades t
                     where t.user_id = auth.uid() and t.trade_id = p_trade));
$$;

grant execute on function app.is_reviewer(), app.reviewer_role(),
                         app.can_see_trade(uuid) to authenticated;

-- Reference numbers: ACT-APP-<year>-<6 digits>
create sequence if not exists public.application_ref_seq start 1;

create or replace function app_private.next_reference()
returns text language sql volatile set search_path = '' as $$
  select 'ACT-APP-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('public.application_ref_seq')::text, 6, '0');
$$;

-- Age is derived from the date of birth on every write, so is_minor can
-- never drift from it.
create or replace function app_private.set_is_minor()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.is_minor := new.date_of_birth is not null
                  and new.date_of_birth > (current_date - interval '18 years');
  return new;
end;
$$;

create or replace function app_private.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists applications_touch on public.applications;
create trigger applications_touch before update on public.applications
  for each row execute function app_private.touch_updated_at();

drop trigger if exists applications_is_minor on public.applications;
create trigger applications_is_minor before insert or update on public.applications
  for each row execute function app_private.set_is_minor();


-- ---------------------------------------------------------------------
-- 7. Applicant-facing RPCs
--
-- The browser never writes an ID number directly. It calls these
-- SECURITY DEFINER functions, which encrypt before the value ever
-- reaches a stored page.
-- ---------------------------------------------------------------------

-- Validates a South African ID: 13 digits, valid embedded date, Luhn.
create or replace function app.validate_sa_id(p_id text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_digits text := regexp_replace(coalesce(p_id,''), '\D', '', 'g');
  v_sum int := 0; v_d int; v_i int; v_parity int := 0;
  v_yy int; v_mm int; v_dd int; v_dob date; v_century int;
begin
  if length(v_digits) <> 13 then
    return jsonb_build_object('valid', false, 'reason', 'An SA ID number must be 13 digits.');
  end if;

  -- Luhn
  for v_i in reverse 13..1 loop
    v_d := substr(v_digits, v_i, 1)::int;
    if v_parity = 1 then
      v_d := v_d * 2;
      if v_d > 9 then v_d := v_d - 9; end if;
    end if;
    v_sum := v_sum + v_d;
    v_parity := 1 - v_parity;
  end loop;
  if v_sum % 10 <> 0 then
    return jsonb_build_object('valid', false, 'reason', 'That ID number failed its checksum. Please re-check the digits.');
  end if;

  v_yy := substr(v_digits,1,2)::int;
  v_mm := substr(v_digits,3,2)::int;
  v_dd := substr(v_digits,5,2)::int;
  if v_mm < 1 or v_mm > 12 or v_dd < 1 or v_dd > 31 then
    return jsonb_build_object('valid', false, 'reason', 'The date of birth inside that ID number is not valid.');
  end if;

  v_century := case when v_yy > (extract(year from current_date)::int % 100) then 1900 else 2000 end;
  begin
    v_dob := make_date(v_century + v_yy, v_mm, v_dd);
  exception when others then
    return jsonb_build_object('valid', false, 'reason', 'The date of birth inside that ID number is not valid.');
  end;

  return jsonb_build_object(
    'valid', true,
    'date_of_birth', v_dob,
    'gender', case when substr(v_digits,7,1)::int < 5 then 'female' else 'male' end,
    'citizenship', case when substr(v_digits,11,1) = '0' then 'sa_citizen'
                        when substr(v_digits,11,1) = '1' then 'permanent_resident'
                        else 'other' end,
    'is_minor', v_dob > (current_date - interval '18 years'),
    'last4', right(v_digits, 4));
end;
$$;
revoke all on function app.validate_sa_id(text) from anon;
grant execute on function app.validate_sa_id(text) to authenticated;


-- Start (or fetch) the caller's application for an open intake.
create or replace function public.start_application(p_intake uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_open boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to start an application.'; end if;

  select (status = 'open' and now() between opens_at and closes_at)
    into v_open from public.intakes where id = p_intake;
  if not coalesce(v_open, false) then
    raise exception 'This intake is not currently open for applications.';
  end if;

  select id into v_id from public.applications
   where applicant_user_id = auth.uid() and intake_id = p_intake;
  if v_id is not null then return v_id; end if;

  insert into public.applications (applicant_user_id, intake_id, email)
  values (auth.uid(), p_intake, auth.jwt() ->> 'email')
  returning id into v_id;

  insert into public.application_events (application_id, actor_id, event, to_status)
  values (v_id, auth.uid(), 'created', 'draft');

  return v_id;
end;
$$;
grant execute on function public.start_application(uuid) to authenticated;


-- Set the identity block. This is the only path by which an ID number
-- enters the database, and it is encrypted before insert.
create or replace function public.set_identity(
  p_application uuid, p_id_type text, p_id_number text,
  p_full_name text, p_passport_country text default null,
  p_dob date default null, p_gender text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_check jsonb; v_status text; v_clean text;
begin
  select status into v_status from public.applications
   where id = p_application and applicant_user_id = auth.uid();
  if v_status is null then raise exception 'Application not found.'; end if;
  if v_status <> 'draft' then raise exception 'This application has already been submitted and can no longer be edited.'; end if;

  v_clean := btrim(coalesce(p_id_number, ''));

  if p_id_type = 'sa_id' then
    v_check := app.validate_sa_id(v_clean);
    if not (v_check ->> 'valid')::boolean then return v_check; end if;
    v_clean := regexp_replace(v_clean, '\D', '', 'g');

    update public.applications set
      full_name       = p_full_name,
      id_type         = 'sa_id',
      id_number_enc   = app_private.encrypt_id(v_clean),
      id_number_last4 = v_check ->> 'last4',
      id_number_hash  = app_private.hash_id(v_clean),
      date_of_birth   = (v_check ->> 'date_of_birth')::date,
      gender          = v_check ->> 'gender',
      citizenship     = v_check ->> 'citizenship',
      passport_country = null
    where id = p_application;
  else
    if length(v_clean) < 5 then
      return jsonb_build_object('valid', false, 'reason', 'Please enter your passport number.');
    end if;
    update public.applications set
      full_name        = p_full_name,
      id_type          = 'passport',
      id_number_enc    = app_private.encrypt_id(v_clean),
      id_number_last4  = right(v_clean, 4),
      id_number_hash   = app_private.hash_id(v_clean),
      passport_country = p_passport_country,
      date_of_birth    = p_dob,
      gender           = p_gender,
      citizenship      = 'other'
    where id = p_application;
    v_check := jsonb_build_object('valid', true, 'is_minor',
                 p_dob is not null and p_dob > (current_date - interval '18 years'));
  end if;

  return v_check;
end;
$$;
grant execute on function public.set_identity(uuid, text, text, text, text, date, text) to authenticated;


create or replace function public.set_guardian(
  p_application uuid, p_full_name text, p_relationship text,
  p_contact text, p_email text, p_id_number text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.applications
   where id = p_application and applicant_user_id = auth.uid();
  if v_status is null then raise exception 'Application not found.'; end if;
  if v_status <> 'draft' then raise exception 'This application has already been submitted.'; end if;

  insert into public.guardians (application_id, full_name, relationship, contact_number,
                                email, id_number_enc, id_number_last4)
  values (p_application, p_full_name, p_relationship, p_contact, p_email,
          app_private.encrypt_id(p_id_number), right(regexp_replace(coalesce(p_id_number,''),'\D','','g'), 4))
  on conflict (application_id) do update set
    full_name = excluded.full_name, relationship = excluded.relationship,
    contact_number = excluded.contact_number, email = excluded.email,
    id_number_enc = excluded.id_number_enc, id_number_last4 = excluded.id_number_last4;
end;
$$;
grant execute on function public.set_guardian(uuid, text, text, text, text, text) to authenticated;


-- Record consent. Immutable once written.
create or replace function public.record_consent(
  p_application uuid, p_version text, p_audience text, p_user_agent text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_v record;
begin
  if not exists (select 1 from public.applications
                 where id = p_application and applicant_user_id = auth.uid()) then
    raise exception 'Application not found.';
  end if;

  select id, body_sha256 into v_v from public.consent_versions
   where version = p_version and audience = p_audience and active;
  if v_v.id is null then raise exception 'Consent wording not found.'; end if;

  insert into public.consents (application_id, consent_version_id, audience,
                               body_sha256, granted_ip, user_agent)
  values (p_application, v_v.id, p_audience, v_v.body_sha256,
          nullif(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for','')::inet,
          left(coalesce(p_user_agent,''), 400));
end;
$$;
grant execute on function public.record_consent(uuid, text, text, text) to authenticated;


-- Final submission. Validates completeness server-side, allocates the
-- reference number, sets the retention date and locks the record.
create or replace function public.submit_application(p_application uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a record; v_missing text[] := '{}'; v_ref text; v_months smallint; v_close timestamptz;
begin
  select * into a from public.applications
   where id = p_application and applicant_user_id = auth.uid();
  if a.id is null then raise exception 'Application not found.'; end if;
  if a.status <> 'draft' then
    return jsonb_build_object('ok', true, 'reference', a.reference, 'already', true);
  end if;

  if a.full_name is null or btrim(a.full_name) = '' then v_missing := array_append(v_missing, 'full name'); end if;
  if a.id_number_enc is null                          then v_missing := array_append(v_missing, 'ID or passport number'); end if;
  if a.trade_id is null                               then v_missing := array_append(v_missing, 'trade'); end if;
  if a.contact_number is null                         then v_missing := array_append(v_missing, 'contact number'); end if;
  if a.address_line1 is null                          then v_missing := array_append(v_missing, 'address'); end if;
  if a.grade12_type is null                           then v_missing := array_append(v_missing, 'Grade 12 details'); end if;

  if not exists (select 1 from public.application_documents d
                 where d.application_id = a.id and d.doc_type = 'id_document') then
    v_missing := array_append(v_missing, 'ID document upload');
  end if;
  if not exists (select 1 from public.consents c
                 where c.application_id = a.id and c.audience = 'applicant') then
    v_missing := array_append(v_missing, 'consent');
  end if;
  -- s35: a child's information may not be processed without the consent
  -- of a competent person.
  if a.is_minor and not exists (select 1 from public.consents c
                 where c.application_id = a.id and c.audience = 'guardian') then
    v_missing := array_append(v_missing, 'parent or guardian consent');
  end if;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('ok', false, 'missing', v_missing);
  end if;

  select i.retention_months, i.closes_at into v_months, v_close
    from public.intakes i where i.id = a.intake_id;

  v_ref := app_private.next_reference();

  update public.applications set
    status = 'submitted', submitted_at = now(), reference = v_ref,
    purge_after = (v_close + (v_months || ' months')::interval)::date
  where id = a.id;

  insert into public.application_events (application_id, actor_id, event, from_status, to_status)
  values (a.id, auth.uid(), 'submitted', 'draft', 'submitted');

  return jsonb_build_object('ok', true, 'reference', v_ref);
end;
$$;
grant execute on function public.submit_application(uuid) to authenticated;


-- POPIA s23/s24: the applicant can pull everything held about them, and
-- can withdraw, which flags the record for early purge.
create or replace function public.my_data_export()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  select jsonb_agg(to_jsonb(a) - 'id_number_enc' - 'id_number_hash'
         || jsonb_build_object(
              'id_number', '**** **** ' || coalesce(a.id_number_last4,''),
              'subjects', (select jsonb_agg(to_jsonb(s) - 'application_id')
                             from public.application_subjects s where s.application_id = a.id),
              'documents', (select jsonb_agg(jsonb_build_object(
                              'type', d.doc_type, 'filename', d.original_filename,
                              'uploaded_at', d.uploaded_at))
                             from public.application_documents d where d.application_id = a.id),
              'consents', (select jsonb_agg(jsonb_build_object(
                              'audience', c.audience, 'granted_at', c.granted_at))
                             from public.consents c where c.application_id = a.id)))
    into v
    from public.applications a where a.applicant_user_id = auth.uid();
  return coalesce(v, '[]'::jsonb);
end;
$$;
grant execute on function public.my_data_export() to authenticated;

create or replace function public.withdraw_application(p_application uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.applications
     set status = 'withdrawn', purge_after = current_date + 30
   where id = p_application and applicant_user_id = auth.uid()
     and status in ('draft','submitted','under_review');
  if not found then raise exception 'Application not found or can no longer be withdrawn.'; end if;
  insert into public.application_events (application_id, actor_id, event, to_status, detail)
  values (p_application, auth.uid(), 'withdrawn', 'withdrawn', jsonb_build_object('reason', p_reason));
end;
$$;
grant execute on function public.withdraw_application(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 8. Reviewer RPCs
-- ---------------------------------------------------------------------

-- Revealing a plaintext ID number is always logged. There is no other
-- route to the value from the API surface.
create or replace function public.reveal_id_number(p_application uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_cipher bytea; v_trade uuid; v_plain text;
begin
  if not app.is_reviewer() then raise exception 'Not authorised.'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'A reason is required before an ID number can be revealed.';
  end if;

  select id_number_enc, trade_id into v_cipher, v_trade
    from public.applications where id = p_application;
  if not app.can_see_trade(v_trade) then raise exception 'Not authorised for this trade.'; end if;

  v_plain := app_private.decrypt_id(v_cipher);

  insert into public.pii_access_log (actor_id, actor_email, application_id, action, detail)
  values (auth.uid(), auth.jwt() ->> 'email', p_application, 'reveal_id', btrim(p_reason));

  return v_plain;
end;
$$;
grant execute on function public.reveal_id_number(uuid, text) to authenticated;

create or replace function public.log_pii_access(p_application uuid, p_action text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_reviewer() then raise exception 'Not authorised.'; end if;
  insert into public.pii_access_log (actor_id, actor_email, application_id, action, detail)
  values (auth.uid(), auth.jwt() ->> 'email', p_application, p_action, p_detail);
end;
$$;
grant execute on function public.log_pii_access(uuid, text, text) to authenticated;

create or replace function public.set_application_status(
  p_application uuid, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_from text; v_trade uuid;
begin
  if not app.is_reviewer() then raise exception 'Not authorised.'; end if;
  if p_status not in ('under_review','shortlisted','declined') then
    raise exception 'Unknown status.';
  end if;

  select status, trade_id into v_from, v_trade from public.applications where id = p_application;
  if not app.can_see_trade(v_trade) then raise exception 'Not authorised for this trade.'; end if;

  update public.applications set status = p_status where id = p_application;

  insert into public.application_reviews (application_id, reviewer_id, decision, notes)
  values (p_application, auth.uid(),
          case p_status when 'shortlisted' then 'shortlist'
                        when 'declined' then 'decline' else 'hold' end, p_notes);

  insert into public.application_events (application_id, actor_id, event, from_status, to_status)
  values (p_application, auth.uid(), 'status_change', v_from, p_status);
end;
$$;
grant execute on function public.set_application_status(uuid, text, text) to authenticated;

-- Auto-provision a reviewer row on first Entra sign-in, inactive.
create or replace function app_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and lower(new.email) like '%@actom.co.za' then
    insert into public.reviewer_profiles (user_id, email, full_name, active)
    values (new.id, new.email, new.raw_user_meta_data ->> 'full_name', false)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();


-- ---------------------------------------------------------------------
-- 9. Row Level Security
--
-- Golden rule: a parent policy scopes on its own columns only; child
-- policies reference upward to the parent, never downward.
-- ---------------------------------------------------------------------
alter table public.applications          enable row level security;
alter table public.application_subjects  enable row level security;
alter table public.application_documents enable row level security;
alter table public.guardians             enable row level security;
alter table public.consents              enable row level security;
alter table public.application_reviews   enable row level security;
alter table public.reviewer_profiles     enable row level security;
alter table public.reviewer_trades       enable row level security;
alter table public.pii_access_log        enable row level security;
alter table public.application_events    enable row level security;
alter table public.intakes               enable row level security;
alter table public.trades                enable row level security;
alter table public.intake_trades         enable row level security;
alter table public.subjects              enable row level security;
alter table public.consent_versions      enable row level security;

-- Reference data: readable by anyone, writable by nobody through the API.
create policy intakes_read on public.intakes for select
  using (status in ('open','closed'));
create policy trades_read on public.trades for select using (active);
create policy intake_trades_read on public.intake_trades for select using (true);
create policy subjects_read on public.subjects for select using (active);
create policy consent_versions_read on public.consent_versions for select using (active);

-- Applications -------------------------------------------------------
create policy applications_own_select on public.applications for select
  using (applicant_user_id = auth.uid());

-- Deliberately no INSERT policy: applications are only created through
-- public.start_application().
create policy applications_own_update on public.applications for update
  using (applicant_user_id = auth.uid() and status = 'draft')
  with check (applicant_user_id = auth.uid() and status = 'draft');

create policy applications_reviewer_select on public.applications for select
  using (status <> 'draft' and app.can_see_trade(trade_id));

-- Child tables reference up to applications.
create policy subjects_own_all on public.application_subjects for all
  using (exists (select 1 from public.applications a
                 where a.id = application_id and a.applicant_user_id = auth.uid()
                   and a.status = 'draft'))
  with check (exists (select 1 from public.applications a
                 where a.id = application_id and a.applicant_user_id = auth.uid()
                   and a.status = 'draft'));

create policy subjects_reviewer_select on public.application_subjects for select
  using (exists (select 1 from public.applications a
                 where a.id = application_id and a.status <> 'draft'
                   and app.can_see_trade(a.trade_id)));

create policy documents_own_select on public.application_documents for select
  using (exists (select 1 from public.applications a
                 where a.id = application_id and a.applicant_user_id = auth.uid()));

create policy documents_own_insert on public.application_documents for insert
  with check (exists (select 1 from public.applications a
                 where a.id = application_id and a.applicant_user_id = auth.uid()
                   and a.status = 'draft'));

create policy documents_own_delete on public.application_documents for delete
  using (exists (select 1 from public.applications a
                 where a.id = application_id and a.applicant_user_id = auth.uid()
                   and a.status = 'draft'));

create policy documents_reviewer_select on public.application_documents for select
  using (exists (select 1 from public.applications a
                 where a.id = application_id and a.status <> 'draft'
                   and app.can_see_trade(a.trade_id)));

create policy guardians_own_select on public.guardians for select
  using (exists (select 1 from public.applications a
                 where a.id = application_id and a.applicant_user_id = auth.uid()));
create policy guardians_reviewer_select on public.guardians for select
  using (exists (select 1 from public.applications a
                 where a.id = application_id and a.status <> 'draft'
                   and app.can_see_trade(a.trade_id)));

-- Consents are write-once via RPC and read-only thereafter.
create policy consents_own_select on public.consents for select
  using (exists (select 1 from public.applications a
                 where a.id = application_id and a.applicant_user_id = auth.uid()));
create policy consents_reviewer_select on public.consents for select
  using (app.is_reviewer());

create policy reviews_reviewer_select on public.application_reviews for select
  using (app.is_reviewer());

create policy reviewer_self_select on public.reviewer_profiles for select
  using (user_id = auth.uid() or app.reviewer_role() in ('admin','manager','information_officer'));
create policy reviewer_admin_update on public.reviewer_profiles for update
  using (app.reviewer_role() = 'admin') with check (app.reviewer_role() = 'admin');
create policy reviewer_trades_select on public.reviewer_trades for select
  using (user_id = auth.uid() or app.reviewer_role() = 'admin');

-- Audit logs: readable by oversight roles, never writable through the API.
create policy pii_log_read on public.pii_access_log for select
  using (app.reviewer_role() in ('admin','manager','information_officer'));
create policy events_read on public.application_events for select
  using (app.is_reviewer()
         or exists (select 1 from public.applications a
                    where a.id = application_id and a.applicant_user_id = auth.uid()));


-- ---------------------------------------------------------------------
-- 10. Storage
--
-- Private bucket. Object path is  <application_id>/<doc_type>/<uuid>.<ext>
-- so the first path segment is the ownership key.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('applicant-documents', 'applicant-documents', false, 8388608,
        array['application/pdf','image/jpeg','image/png','image/heic'])
on conflict (id) do update set
  public = false, file_size_limit = 8388608,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/heic'];

drop policy if exists applicant_docs_insert on storage.objects;
create policy applicant_docs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'applicant-documents'
    and exists (select 1 from public.applications a
                where a.id::text = (storage.foldername(name))[1]
                  and a.applicant_user_id = auth.uid()
                  and a.status = 'draft'));

drop policy if exists applicant_docs_select on storage.objects;
create policy applicant_docs_select on storage.objects for select to authenticated
  using (
    bucket_id = 'applicant-documents'
    and (exists (select 1 from public.applications a
                 where a.id::text = (storage.foldername(name))[1]
                   and a.applicant_user_id = auth.uid())
      or exists (select 1 from public.applications a
                 where a.id::text = (storage.foldername(name))[1]
                   and a.status <> 'draft' and app.can_see_trade(a.trade_id))));

drop policy if exists applicant_docs_delete on storage.objects;
create policy applicant_docs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'applicant-documents'
    and exists (select 1 from public.applications a
                where a.id::text = (storage.foldername(name))[1]
                  and a.applicant_user_id = auth.uid()
                  and a.status = 'draft'));


-- ---------------------------------------------------------------------
-- 11. Retention (POPIA s14)
--
-- Records are deleted, not anonymised, once past purge_after unless a
-- legal hold is set. Storage objects go first so nothing is orphaned.
-- ---------------------------------------------------------------------
create or replace function app_private.purge_expired()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; r record;
begin
  for r in
    select id from public.applications
     where legal_hold = false and purge_after is not null and purge_after < current_date
  loop
    delete from storage.objects
     where bucket_id = 'applicant-documents'
       and (storage.foldername(name))[1] = r.id::text;
    delete from public.applications where id = r.id;
    v_count := v_count + 1;
  end loop;

  -- Abandoned drafts: no submission within 90 days of the intake closing.
  delete from public.applications a
   using public.intakes i
   where a.intake_id = i.id and a.status = 'draft'
     and i.closes_at < now() - interval '90 days' and a.legal_hold = false;

  -- Audit logs are kept for three years, then aged out.
  delete from public.pii_access_log where occurred_at < now() - interval '3 years';

  insert into public.application_events (event, detail)
  values ('retention_purge', jsonb_build_object('applications_deleted', v_count));

  return v_count;
end;
$$;

-- Idempotent: unschedule any previous registration before adding it back.
do $$
begin
  perform cron.unschedule('actom-apprentice-retention');
exception when others then null;
end $$;

select cron.schedule('actom-apprentice-retention', '15 2 * * *',
                     $$select app_private.purge_expired();$$);


-- ---------------------------------------------------------------------
-- 12. Lock down the API surface
--
-- Column-level, not table-level. In PostgreSQL a table-level SELECT grant
-- implies every column, and a later column-level REVOKE against it is a
-- no-op. So the ciphertext columns are protected by never granting the
-- table, and enumerating the safe columns instead.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

-- Reference data, readable before sign-in.
grant select on public.intakes, public.trades, public.intake_trades,
                public.subjects, public.consent_versions to anon, authenticated;

-- applications: every column EXCEPT id_number_enc and id_number_hash.
grant select (id, reference, applicant_user_id, intake_id, trade_id, status,
              full_name, id_type, id_number_last4, passport_country, date_of_birth,
              gender, citizenship, is_minor, contact_number, email,
              address_line1, address_line2, suburb, city, province, postal_code,
              country, ethnic_group, has_disability, disability_types,
              disability_other, grade12_type, grade12_year, highest_qualification,
              highest_qual_institution, highest_qual_year, submitted_at,
              created_at, updated_at, purge_after, legal_hold)
       on public.applications to authenticated;

-- The applicant may only update the non-sensitive part of their own draft.
-- Identity, status, reference and retention are set by SECURITY DEFINER
-- functions or by reviewers, never by the browser.
grant update (trade_id, contact_number, address_line1, address_line2, suburb, city,
              province, postal_code, country, ethnic_group, has_disability,
              disability_types, disability_other, grade12_type, grade12_year,
              highest_qualification, highest_qual_institution, highest_qual_year)
       on public.applications to authenticated;

-- guardians: everything except the ciphertext.
grant select (id, application_id, full_name, relationship, contact_number,
              email, id_number_last4, created_at)
       on public.guardians to authenticated;

grant select, insert, update, delete on public.application_subjects to authenticated;
grant select, insert, delete            on public.application_documents to authenticated;
grant select on public.consents, public.application_reviews,
                public.reviewer_profiles, public.reviewer_trades,
                public.pii_access_log, public.application_events to authenticated;
grant update (active, role, division) on public.reviewer_profiles to authenticated;

-- Sanity check. Run this after deploying: it must return zero rows.
--
--   select grantee, table_name, column_name
--     from information_schema.column_privileges
--    where grantee in ('anon','authenticated')
--      and column_name in ('id_number_enc','id_number_hash');
