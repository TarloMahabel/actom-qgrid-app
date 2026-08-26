-- ============================================================
--  ACTOM QGrid — 003 publishing roles
--
--  Two changes to publish_template_revision, both learned from setting
--  the pilot up for real.
--
--  1. sysadmin may publish.
--     The original split gave the System Administrator configuration
--     rights but no quality authority, which is right in steady state.
--     It is wrong during a rollout: Group IT builds the first templates
--     for each of 27 divisions before that division has a Quality
--     Manager in the system at all, and there was no one who could
--     publish them.
--
--  2. The second-approver rule stays.
--     A template is a controlled document and the author still cannot
--     approve their own. That is the control an auditor tests, so it is
--     not being relaxed for convenience.
--
--  CONSEQUENCE FOR A ONE-PERSON PILOT: if you are the only account, you
--  cannot publish anything, by design. Two ways through, both fine:
--
--    a) Create a second account and give it quality_manager. This is the
--       real answer and it is what production will look like anyway.
--
--    b) For the pilot only, publish from the SQL editor, which runs as
--       the table owner and bypasses the check:
--
--         update template_revisions set status = 'superseded'
--          where template_id = (select template_id from template_revisions
--                                where id = '<rev-id>')
--            and status = 'published';
--         update template_revisions
--            set status = 'published', approved_by = created_by,
--                effective_from = current_date
--          where id = '<rev-id>';
--
--       Do (b) knowingly: it records the author as their own approver,
--       which is exactly what the rule exists to prevent. Fine for
--       seeding a pilot, not acceptable once real inspections are being
--       captured against the template.
-- ============================================================

create or replace function publish_template_revision(p_rev uuid)
returns jsonb language plpgsql security invoker as $$
declare v_tpl uuid; v_author uuid; v_rev smallint;
begin
  if not has_role('quality_manager', 'sysadmin') then
    raise exception 'PUBLISH_ROLE: only a Quality Manager or System Administrator may publish a template';
  end if;

  select template_id, created_by, rev into v_tpl, v_author, v_rev
    from template_revisions where id = p_rev;
  if v_tpl is null then raise exception 'PUBLISH_MISSING: revision not found'; end if;

  if v_author = auth.uid() then
    raise exception 'PUBLISH_SELF: a template cannot be published by the person who built it. Ask a second Quality Manager to approve it.';
  end if;

  update template_revisions
     set status = 'superseded'
   where template_id = v_tpl and status = 'published';

  update template_revisions
     set status = 'published',
         approved_by = auth.uid(),
         effective_from = current_date
   where id = p_rev;

  return jsonb_build_object('template_id', v_tpl, 'rev', v_rev, 'status', 'published');
end $$;

grant execute on function publish_template_revision to authenticated;
