-- ============================================================
--  ACTOM Grid — 007 a published revision must have questions on it
--
--  A template revision could be published with no fields. The scheduler
--  then generated inspections against it, and the inspector opened a form
--  with a heading and nothing under it: "0 of 0 answered", and a progress
--  bar reading NaN%.
--
--  It happens naturally. A template is created, the empty first revision
--  is published to get it into the requirements matrix, and the fields are
--  added afterwards into a later revision. Inspections are locked to the
--  revision they were generated against — deliberately, so a captured
--  record cannot have its questions changed underneath it — so the fields
--  never reach the inspections already created.
--
--  Refusing the publish is the right place to stop it. The alternative is
--  catching it at capture, by which point inspections have been scheduled,
--  assigned and handed to someone standing at a panel.
-- ============================================================

create or replace function publish_template_revision(p_rev uuid)
returns jsonb language plpgsql security invoker as $$
declare
  v_tpl uuid; v_author uuid; v_rev smallint; v_require boolean;
  v_rows int; v_fields int;
begin
  if not has_role('quality_manager', 'sysadmin') then
    raise exception 'PUBLISH_ROLE: only a Quality Manager or System Administrator may publish a template';
  end if;

  select template_id, created_by, rev into v_tpl, v_author, v_rev
    from template_revisions where id = p_rev;
  if v_tpl is null then raise exception 'PUBLISH_MISSING: revision not found'; end if;

  -- Count answerable fields. Sections and instructions are not questions.
  select count(*) into v_fields
    from template_revisions tr,
         jsonb_array_elements(tr.definition->'sections') s,
         jsonb_array_elements(s->'items') f
   where tr.id = p_rev
     and coalesce(f->>'type', '') not in ('section', 'info');

  if coalesce(v_fields, 0) = 0 then
    raise exception 'PUBLISH_EMPTY: this revision has no questions on it. An inspection generated from it could not be filled in.';
  end if;

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

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'PUBLISH_BLOCKED: row level security prevented the update. Your role may not edit this revision.';
  end if;

  return jsonb_build_object('template_id', v_tpl, 'rev', v_rev, 'status', 'published',
                            'fields', v_fields,
                            'self_approved', v_author = auth.uid());
end $$;

grant execute on function publish_template_revision to authenticated;

-- ------------------------------------------------------------
--  Anything already published empty is a live trap: it will keep
--  generating unfillable inspections. Report them so they can be dealt
--  with, rather than changing status underneath a running division.
-- ------------------------------------------------------------
do $$
declare r record; n int := 0;
begin
  for r in
    select t.code, tr.rev
      from template_revisions tr
      join inspection_templates t on t.id = tr.template_id
     where tr.status = 'published'
       and (select count(*)
              from jsonb_array_elements(tr.definition->'sections') s,
                   jsonb_array_elements(s->'items') f
             where coalesce(f->>'type','') not in ('section','info')) = 0
  loop
    n := n + 1;
    raise warning 'Published revision with no questions: % rev % — inspections generated from it cannot be filled in.', r.code, r.rev;
  end loop;
  if n > 0 then
    raise warning '% published revision(s) have no questions. Add fields, publish a new revision, and move any unstarted inspections onto it.', n;
  end if;
end $$;
