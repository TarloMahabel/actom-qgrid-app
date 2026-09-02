-- =====================================================================
-- Migration 011 — consent wording, editable in the console
--
-- Consent text currently lives only in the database and is changed by
-- hand in SQL. That is fine for a developer and useless for the
-- Information Officer, who is the person actually accountable for the
-- wording under POPIA.
--
-- THE CONSTRAINT THAT SHAPES THIS
--
--   A consent version must become IMMUTABLE the moment an applicant has
--   agreed to it. POPIA requires ACTOM to show what a person actually
--   consented to, not what the paragraph says today. Editing in place
--   destroys that evidence.
--
--   The schema already anticipates this: consents.body_sha256 records
--   the hash at the moment of granting, while consent_versions.body_sha256
--   is generated from the current text. If a used version were edited,
--   the two diverge — which is detectable, and is exactly the kind of
--   thing that turns an audit into an incident.
--
--   So: editing is allowed freely until the first applicant consents,
--   and refused by the database afterwards. To change wording that is
--   already in use you create a NEW revision. That is not a limitation
--   to work around; it is the point.
--
-- Run after 010-decline-reason.sql. Idempotent.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Immutability, enforced in the database
--
-- A trigger rather than a policy: this must hold regardless of who is
-- connected, including a developer in the SQL editor.
-- ---------------------------------------------------------------------
create or replace function app_private.guard_consent_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_used integer;
begin
  select count(*) into v_used from public.consents where consent_version_id = old.id;

  if v_used = 0 then
    return new;                       -- never agreed to; safe to change
  end if;

  -- Retiring a version is legitimate: it stops new applications using
  -- it while leaving the historical record intact.
  if new.body is distinct from old.body
     or new.version is distinct from old.version
     or new.audience is distinct from old.audience then
    raise exception
      'Consent version % (%) has been agreed to by % applicant(s) and cannot be reworded. Create a new revision instead.',
      old.version, old.audience, v_used
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists consent_versions_guard on public.consent_versions;
create trigger consent_versions_guard before update on public.consent_versions
  for each row execute function app_private.guard_consent_version();

create or replace function app_private.guard_consent_version_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_used integer;
begin
  select count(*) into v_used from public.consents where consent_version_id = old.id;
  if v_used > 0 then
    raise exception
      'Consent version % (%) has been agreed to by % applicant(s) and cannot be deleted.',
      old.version, old.audience, v_used
      using errcode = 'integrity_constraint_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists consent_versions_guard_delete on public.consent_versions;
create trigger consent_versions_guard_delete before delete on public.consent_versions
  for each row execute function app_private.guard_consent_version_delete();


-- ---------------------------------------------------------------------
-- 2. Reading it in the console
--
-- Usage count is what tells the Information Officer whether a version is
-- still editable, so it belongs in the same view as the text.
-- ---------------------------------------------------------------------
create or replace view public.v_consent_versions as
select
  cv.id, cv.version, cv.audience, cv.body, cv.body_sha256,
  cv.effective_from, cv.active,
  (select count(*) from public.consents c where c.consent_version_id = cv.id) as times_agreed,
  (select count(*) from public.consents c where c.consent_version_id = cv.id) = 0 as editable,
  exists (select 1 from public.intakes i where i.consent_version = cv.version) as used_by_intake
from public.consent_versions cv;

grant select on public.v_consent_versions to authenticated;


-- ---------------------------------------------------------------------
-- 3. Writing it
--
-- Restricted to admin and information_officer. A manager can configure
-- an intake; the consent paragraph is the Information Officer's
-- responsibility and should not be casually edited by whoever happens
-- to be setting up the next intake.
-- ---------------------------------------------------------------------
create or replace function public.save_consent_version(
  p_version text, p_audience text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_used integer; v_existing record;
begin
  perform app.require_role('admin', 'information_officer');

  if p_audience not in ('applicant', 'guardian') then
    raise exception 'Audience must be applicant or guardian.';
  end if;
  if btrim(coalesce(p_version, '')) = '' then
    raise exception 'A version number is required.';
  end if;
  if length(btrim(coalesce(p_body, ''))) < 50 then
    raise exception 'The consent wording looks too short to be complete.';
  end if;

  select * into v_existing from public.consent_versions
   where version = btrim(p_version) and audience = p_audience;

  if v_existing.id is null then
    insert into public.consent_versions (version, audience, body, active)
    values (btrim(p_version), p_audience, btrim(p_body), true)
    returning id into v_id;

    insert into public.application_events (actor_id, event, detail)
    values (auth.uid(), 'consent_version_created',
            jsonb_build_object('version', btrim(p_version), 'audience', p_audience));

    return jsonb_build_object('ok', true, 'created', true, 'id', v_id);
  end if;

  select count(*) into v_used from public.consents
   where consent_version_id = v_existing.id;

  if v_used > 0 then
    return jsonb_build_object('ok', false, 'times_agreed', v_used,
      'reason', 'Version ' || btrim(p_version) || ' has already been agreed to by ' ||
                v_used || ' applicant(s). Its wording is now part of the record and cannot ' ||
                'be changed. Save this as a new version number instead.');
  end if;

  update public.consent_versions
     set body = btrim(p_body), effective_from = now()
   where id = v_existing.id;

  insert into public.application_events (actor_id, event, detail)
  values (auth.uid(), 'consent_version_edited',
          jsonb_build_object('version', btrim(p_version), 'audience', p_audience));

  return jsonb_build_object('ok', true, 'created', false, 'id', v_existing.id);
end;
$$;

grant execute on function public.save_consent_version(text, text, text) to authenticated;


create or replace function public.set_consent_version_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role('admin', 'information_officer');
  update public.consent_versions set active = p_active where id = p_id;

  insert into public.application_events (actor_id, event, detail)
  select auth.uid(), case when p_active then 'consent_version_activated'
                          else 'consent_version_retired' end,
         jsonb_build_object('version', version, 'audience', audience)
    from public.consent_versions where id = p_id;
end;
$$;

grant execute on function public.set_consent_version_active(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Tamper detection
--
-- If a consent's recorded hash no longer matches the version's current
-- text, the wording was changed after someone agreed to it. With the
-- triggers above that should be impossible; this is the check that
-- proves it, and belongs in the standing audit.
-- ---------------------------------------------------------------------
create or replace view public.v_consent_integrity as
select
  c.id as consent_id, c.application_id, cv.version, cv.audience,
  c.granted_at, c.body_sha256 as agreed_hash, cv.body_sha256 as current_hash
from public.consents c
join public.consent_versions cv on cv.id = c.consent_version_id
where c.body_sha256 is distinct from cv.body_sha256;

grant select on public.v_consent_integrity to authenticated;
