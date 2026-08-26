-- ============================================================
--  ACTOM Grid — 004 second approver becomes optional
--
--  The author of a template revision could not publish it. That rule is
--  defensible on paper — a template is a controlled document under
--  ISO 9001 clause 7.5, and separating author from approver is the usual
--  reading — but it does not survive contact with how this division
--  actually works: one Quality Manager builds the forms, so nothing
--  could ever be published.
--
--  So it becomes a division setting rather than a law, defaulting OFF.
--  A division that wants the separation switches it on and the old
--  behaviour returns, including the message telling the author who has to
--  approve. Nothing about the audit trail changes: every publish still
--  records who approved it and when, so the evidence is there either way.
--
--  Two things have to change together. The RPC is the obvious one. The
--  CHECK constraint on template_revisions is the one that would have been
--  missed — it refuses any row where approved_by equals created_by, so
--  self-publishing would still have failed with a constraint violation
--  even after the RPC allowed it.
-- ============================================================

-- 1. The setting.
alter table division_profile
  add column if not exists require_second_approver boolean not null default false;

comment on column division_profile.require_second_approver is
  'When true, the author of a template revision cannot publish it. Off by '
  'default: a division with a single Quality Manager would otherwise be '
  'unable to publish anything.';

-- 2. The constraint has to go: it enforced the rule unconditionally, so it
--    would override the setting. The rule now lives in the function, which
--    can read the setting.
alter table template_revisions drop constraint if exists approver_not_author;

-- 3. The function.
create or replace function publish_template_revision(p_rev uuid)
returns jsonb language plpgsql security invoker as $$
declare
  v_tpl uuid; v_author uuid; v_rev smallint; v_require boolean;
begin
  if not has_role('quality_manager', 'sysadmin') then
    raise exception 'PUBLISH_ROLE: only a Quality Manager or System Administrator may publish a template';
  end if;

  select template_id, created_by, rev into v_tpl, v_author, v_rev
    from template_revisions where id = p_rev;
  if v_tpl is null then raise exception 'PUBLISH_MISSING: revision not found'; end if;

  select require_second_approver into v_require from division_profile where id;

  if coalesce(v_require, false) and v_author = auth.uid() then
    raise exception 'PUBLISH_SELF: this division requires a second approver, so the person who built a template cannot publish it.';
  end if;

  update template_revisions
     set status = 'superseded'
   where template_id = v_tpl and status = 'published';

  update template_revisions
     set status = 'published',
         approved_by = auth.uid(),
         effective_from = current_date
   where id = p_rev;

  return jsonb_build_object('template_id', v_tpl, 'rev', v_rev, 'status', 'published',
                            'self_approved', v_author = auth.uid());
end $$;

grant execute on function publish_template_revision to authenticated;
