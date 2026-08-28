-- ============================================================
--  ACTOM Grid — 007 an empty template cannot be published
--
--  A template revision with no answerable fields produces inspections
--  nobody can complete: the form opens with a section heading, nothing
--  to fill in, and progress reading "0 of 0". It reached the shop floor
--  because a revision was published before its fields were added, and
--  nothing stopped it.
--
--  The app disables the button now, but the button is not the control.
--  Sections and instruction text do not count: an inspector cannot answer
--  a heading.
-- ============================================================

create or replace function publish_template_revision(p_rev uuid)
returns jsonb language plpgsql security invoker as $$
declare
  v_tpl uuid; v_author uuid; v_rev smallint; v_require boolean;
  v_rows int; v_fields int; v_def jsonb;
begin
  if not has_role('quality_manager', 'sysadmin') then
    raise exception 'PUBLISH_ROLE: only a Quality Manager or System Administrator may publish a template';
  end if;

  select template_id, created_by, rev, definition
    into v_tpl, v_author, v_rev, v_def
    from template_revisions where id = p_rev;
  if v_tpl is null then raise exception 'PUBLISH_MISSING: revision not found'; end if;

  -- Something an inspector can actually answer. Headings and instructions
  -- are not questions.
  select count(*) into v_fields
    from jsonb_array_elements(coalesce(v_def->'sections', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'items', '[]'::jsonb)) f
   where coalesce(f->>'type', '') not in ('section', 'info');

  if v_fields = 0 then
    raise exception 'PUBLISH_EMPTY: this revision has no questions on it, so an inspection generated from it could not be completed.';
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
                            'fields', v_fields, 'self_approved', v_author = auth.uid());
end $$;

grant execute on function publish_template_revision to authenticated;
