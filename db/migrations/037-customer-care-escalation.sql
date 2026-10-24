-- ============================================================
--  037 — Customer care: responsible person + escalation matrix
--
--  1. responsible_id on complaints — who is handling a care
--  2. Escalation thresholds + CEO contact on division_profile
--  3. Rebuild v_complaints to surface responsible_name
-- ============================================================

-- 1. Responsible person on a complaint
alter table complaints
  add column if not exists responsible_id uuid references profiles(id);

-- 2. Escalation config on division_profile
alter table division_profile
  add column if not exists escalation_l1_days  int not null default 1,
  add column if not exists escalation_l2_days  int not null default 3,
  add column if not exists escalation_ceo_days int not null default 5,
  add column if not exists ceo_name            text,
  add column if not exists ceo_email           text;

-- 3. Rebuild v_complaints with responsible_name
drop view if exists v_complaints;
create view v_complaints with (security_invoker = on) as
select c.id, c.ref, c.legacy_ref, c.customer, c.site, c.details,
       c.contract_number, c.delivery_date,
       complaint_status(c)               as status,
       s.name                            as section,
       t.name                            as complaint_type,
       t.is_technical                    as is_technical,
       dc.description                    as defect_code,
       ow.full_name                      as owner,
       c.site_engineer                   as site_engineer,
       c.called_at, c.responded_at, c.closed_at,
       c.correction, c.closure_note,
       c.cost_material, c.cost_labour, c.cost_total,
       n.ref                             as ncr_ref,
       c.ncr_id                          as ncr_id,
       rb.full_name                      as raised_by_name,
       rp.full_name                      as responsible_name,
       c.responsible_id,
       round(extract(epoch from (c.responded_at - c.called_at)) / 3600.0, 1) as response_hours,
       (c.closed_at::date - c.called_at::date)                              as days_to_close,
       (current_date - c.called_at::date)                                   as age_days
  from complaints c
  left join complaint_sections s on s.id = c.section_id
  left join complaint_types t    on t.id = c.type_id
  left join defect_codes dc      on dc.id = c.defect_code_id
  left join profiles ow          on ow.id = c.owner_id
  left join profiles rb          on rb.id = c.raised_by
  left join profiles rp          on rp.id = c.responsible_id
  left join ncrs n               on n.id = c.ncr_id;

grant select on v_complaints to authenticated;

-- ------------------------------------------------------------
--  Verification
-- ------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'complaints' and column_name = 'responsible_id'
  ) then
    raise exception '037: responsible_id was not added to complaints.';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_name = 'division_profile' and column_name = 'ceo_name'
  ) then
    raise exception '037: ceo_name was not added to division_profile.';
  end if;

  raise notice '037 applied. responsible_id on complaints, escalation matrix config on division_profile.';
end $verify$;
