-- ============================================================
--  ACTOM Grid — 021 the customer care form as it is controlled
--
--  019 was built from the spreadsheet. QA-FM-005 revision 03 is the
--  controlled form, and it asks for a good deal the spreadsheet never
--  captured. Where the two disagree the form wins: it is the approved
--  document, and an auditor compares the system against it rather than
--  against the workbook somebody kept alongside it.
--
--  A DECISION FROM 019 THAT THIS REVERSES
--
--  019 refused to close a technical complaint without a linked NCR, on
--  the grounds that root cause and corrective action belong in the NCR
--  module where an action gets verified. That was right about the
--  engineering and wrong about this division's process: QA-FM-005 puts
--  5 Why, root cause, containment and preventive action ON THE CUSTOMER
--  CARE. Building it otherwise would mean the system cannot produce the
--  form it is supposed to produce.
--
--  So the investigation lives here, and ncr_id becomes an optional link
--  for when a complaint also warrants a nonconformance. The overlap is
--  real and worth watching: if the same failure ends up investigated
--  twice under two references, that is a process question rather than a
--  schema one, and the link is what makes it visible.
--
--  THE FORM IS AN APPROVAL WORKFLOW, which the spreadsheet was not.
--  Field Service Project Coordinator and Divisional CEO both sign, and a
--  signature block with no date is the commonest finding on a paper QMS.
--  Name and date are stored together or not at all.
-- ============================================================

do $prereq$
begin
  if to_regclass('public.complaints') is null then
    raise exception '021 needs 019-customer-complaints.sql first.';
  end if;
end $prereq$;

-- ------------------------------------------------------------
--  1. Who the customer is.
--
--  The form separates Company Name from Customer Name — the business and
--  the person at it. The spreadsheet had one field and lost the
--  distinction, which is why chasing a complaint means asking who rang.
-- ------------------------------------------------------------
alter table complaints
  add column if not exists company_name      text,
  add column if not exists contact_person    text,
  add column if not exists contact_tel       text,
  add column if not exists contracts_engineer text,
  add column if not exists date_received     date,
  add column if not exists date_delivered    date,
  add column if not exists date_installed    date;

comment on column complaints.company_name is
  'QA-FM-005 separates Company Name from Customer Name. `customer` holds '
  'the company; this is kept for the form and for imports that had both.';

-- ------------------------------------------------------------
--  2. Severity, as the form has it. Two values, not three.
-- ------------------------------------------------------------
do $sev$
begin
  if not exists (select 1 from pg_type where typname = 'complaint_severity') then
    create type complaint_severity as enum ('minor', 'major');
  end if;
end $sev$;

alter table complaints
  add column if not exists severity complaint_severity;

-- ------------------------------------------------------------
--  3. Cost: estimated and actual, and who carries it.
--
--  The form asks for an estimate up front and an allocation. The
--  spreadsheet recorded actuals on 8–20% of records and an estimate on
--  20%, so the variance between the two has never been visible. It is
--  the number a Divisional CEO signing the approval would want.
-- ------------------------------------------------------------
alter table complaints
  add column if not exists cost_estimated numeric(12,2),
  add column if not exists cost_other     numeric(12,2),
  add column if not exists cost_charged_to text
    check (cost_charged_to is null or cost_charged_to in ('client','insurance','actom'));

comment on column complaints.cost_charged_to is
  'Charged to client, Insurance claim, or Charged to ACTOM — the three '
  'boxes on QA-FM-005. Null means nobody has decided yet, which is a '
  'different fact from ACTOM carrying it.';

/* cost_total was generated from material + labour in 019. It has to be
   dropped and rebuilt to take `other` in as well: a generated column
   cannot be altered in place. */
alter table complaints drop column if exists cost_total;
alter table complaints
  add column cost_total numeric(12,2) generated always as
    (coalesce(cost_material,0) + coalesce(cost_labour,0) + coalesce(cost_other,0)) stored;

-- ------------------------------------------------------------
--  4. The investigation, as the form lays it out.
--
--  Five Why lines rather than one free-text box, because the form asks
--  for five and a single box collapses into a restatement of the fault.
--  Stored as an array: the questions are ordered and the order carries
--  meaning, and five columns would be five columns.
-- ------------------------------------------------------------
alter table complaints
  add column if not exists why_chain        text[],
  add column if not exists root_cause_text  text,
  add column if not exists cause_completed  date,
  add column if not exists containment_kind text
    check (containment_kind is null or containment_kind in ('scrap','rework','concession','other')),
  add column if not exists containment_note text,
  add column if not exists preventive_action text;

comment on column complaints.why_chain is
  'The five Why answers in order. Fewer than five is allowed — an honest '
  'three beats five where the last two restate the third.';

-- ------------------------------------------------------------
--  5. Approval and clearing. Name and date together or not at all.
-- ------------------------------------------------------------
alter table complaints
  add column if not exists coordinator_name text,
  add column if not exists coordinator_at   date,
  add column if not exists ceo_name         text,
  add column if not exists ceo_at           date,
  add column if not exists cleared_name     text,
  add column if not exists cleared_at       date;

alter table complaints drop constraint if exists complaint_sig_coordinator;
alter table complaints add constraint complaint_sig_coordinator
  check ((coordinator_name is null) = (coordinator_at is null));
alter table complaints drop constraint if exists complaint_sig_ceo;
alter table complaints add constraint complaint_sig_ceo
  check ((ceo_name is null) = (ceo_at is null));
alter table complaints drop constraint if exists complaint_sig_cleared;
alter table complaints add constraint complaint_sig_cleared
  check ((cleared_name is null) = (cleared_at is null));

-- ------------------------------------------------------------
--  6. Closing no longer demands an NCR.
--
--  See the header. The investigation is on this form now, so the rule
--  that stood in 019 would block a complaint the division has properly
--  dealt with on its own paperwork.
--
--  What replaces it: a technical complaint needs a root cause, the same
--  way an NCR does. The workbook recorded one on 20% of complaints, and
--  requiring it is the only thing that changes that number.
-- ------------------------------------------------------------
create or replace function close_complaint(p_id uuid, p_correction text, p_note text default null)
returns complaints language plpgsql security invoker as $$
declare c complaints; v_rows int; v_tech boolean; v_cause text;
begin
  if coalesce(btrim(p_correction), '') = '' then
    raise exception 'COMPLAINT_CORRECTION: say what was done for the customer before closing this.';
  end if;

  select t.is_technical, x.root_cause_text into v_tech, v_cause
    from complaints x left join complaint_types t on t.id = x.type_id
   where x.id = p_id;

  if coalesce(v_tech, false) and coalesce(btrim(coalesce(v_cause, '')), '') = '' then
    raise exception 'COMPLAINT_NEEDS_CAUSE: this is a technical complaint, so QA-FM-005 wants a root cause before it is cleared. Work the five Why and record what you found. Closing without one is how the old register reached 20%%.';
  end if;

  update complaints
     set closed_at  = now(),
         closed_by  = auth.uid(),
         correction = btrim(p_correction),
         closure_note = nullif(btrim(coalesce(p_note,'')), ''),
         responded_at = coalesce(responded_at, now()),
         responded_by = coalesce(responded_by, auth.uid())
   where id = p_id and closed_at is null
   returning * into c;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'COMPLAINT_CLOSE: that complaint is already closed, or row level security prevented the update.';
  end if;
  return c;
end $$;

grant execute on function close_complaint(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
--  7. Documents.
--
--  Quotes, printed emails, delivery notes. A separate bucket from
--  inspection-photos because that one allows images only, by design —
--  widening it to take PDFs would widen it for every photo field in the
--  inspection module too.
-- ------------------------------------------------------------
create table if not exists complaint_documents (
  id           uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references complaints(id) on delete cascade,
  storage_path text not null,
  filename     text not null,
  bytes        integer,
  uploaded_by  uuid not null references profiles(id),
  uploaded_at  timestamptz not null default now()
);

create index if not exists complaint_documents_idx on complaint_documents (complaint_id, uploaded_at);

alter table complaint_documents enable row level security;
revoke all on complaint_documents from anon, authenticated;
grant select, insert on complaint_documents to authenticated;

create policy complaint_docs_read on complaint_documents for select
  using (auth.uid() is not null);
create policy complaint_docs_add on complaint_documents for insert
  with check (uploaded_by = auth.uid()
              and exists (select 1 from complaints c
                           where c.id = complaint_id and c.closed_at is null));

-- No delete, and no update. A document attached to a complaint is part of
-- what was considered when it was cleared.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-care-docs', 'customer-care-docs', false, 15728640,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update
  set file_size_limit = 15728640,
      allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

drop policy if exists "care docs read" on storage.objects;
create policy "care docs read" on storage.objects for select to authenticated
  using (bucket_id = 'customer-care-docs');

drop policy if exists "care docs write" on storage.objects;
create policy "care docs write" on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-care-docs');

-- ------------------------------------------------------------
--  8. The view, carrying all of it.
-- ------------------------------------------------------------
create or replace view v_complaints with (security_invoker = on) as
select c.id, c.ref, c.legacy_ref, c.customer, c.company_name, c.site, c.details,
       c.contact_person, c.contact_tel, c.contracts_engineer,
       c.contract_number, c.delivery_date,
       c.date_received, c.date_delivered, c.date_installed,
       complaint_status(c)                       as status,
       c.legacy_closed, c.imported_at,
       c.severity::text                          as severity,
       coalesce(s.name, c.legacy_section)        as section,
       coalesce(t.name, c.legacy_type)           as complaint_type,
       coalesce(t.is_technical, false)           as is_technical,
       coalesce(dc.description, c.legacy_defect) as defect_code,
       coalesce(ow.full_name, c.owner_name)      as owner,
       c.site_engineer,
       c.called_at, c.responded_at, c.closed_at,
       c.correction, c.closure_note,
       c.why_chain, c.root_cause_text, c.cause_completed,
       c.containment_kind, c.containment_note, c.preventive_action,
       c.coordinator_name, c.coordinator_at, c.ceo_name, c.ceo_at,
       c.cleared_name, c.cleared_at,
       c.cost_estimated, c.cost_material, c.cost_labour, c.cost_other,
       c.cost_total, c.cost_charged_to,
       n.ref                                     as ncr_ref,
       c.ncr_id,
       rb.full_name                              as raised_by_name,
       (select count(*) from complaint_documents d where d.complaint_id = c.id) as documents,
       round(extract(epoch from (c.responded_at - c.called_at)) / 3600.0, 1) as response_hours,
       round(extract(epoch from (c.responded_at - c.called_at)) / 86400.0, 1) as response_days,
       (c.closed_at::date - c.called_at::date)   as days_to_close,
       (current_date - c.called_at::date)        as age_days
  from complaints c
  left join complaint_sections s on s.id = c.section_id
  left join complaint_types t    on t.id = c.type_id
  left join defect_codes dc      on dc.id = c.defect_code_id
  left join profiles ow          on ow.id = c.owner_id
  left join profiles rb          on rb.id = c.raised_by
  left join ncrs n               on n.id = c.ncr_id;

grant select on v_complaints to authenticated;

-- ------------------------------------------------------------
--  9. The response-time target.
--
--  The After Sales report draws a limit line on response time, so a
--  target exists and is already being reported against. It belongs on
--  division_profile rather than in the code: divisions will differ, and
--  a number the app hardcodes is a number nobody can change without a
--  release.
-- ------------------------------------------------------------
alter table division_profile
  add column if not exists response_target_days smallint not null default 3;

comment on column division_profile.response_target_days is
  'Working days to a first response, drawn as the limit line on the After '
  'Sales report. Three is what the existing report uses.';

do $verify$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'complaints' and column_name = 'why_chain') then
    raise exception 'The form fields were not added.';
  end if;
  raise notice '021 applied. Closing a technical customer care now needs a root cause rather than a linked NCR.';
end $verify$;
