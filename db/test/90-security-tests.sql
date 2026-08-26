-- ============================================================
--  Security tests: the controls an ISO auditor will test.
--
--  Each test runs as a specific user by setting test.uid, which the
--  shim's auth.uid() reads. A test that passes here has been exercised
--  against real policies and real triggers, not a mock.
-- ============================================================
\set ON_ERROR_STOP on
set client_min_messages to warning;

-- ---------- fixtures ----------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'qm@actom.co.za'),
  ('22222222-2222-2222-2222-222222222222', 'inspector.a@actom.co.za'),
  ('33333333-3333-3333-3333-333333333333', 'inspector.b@actom.co.za')
on conflict do nothing;

insert into profiles (id, full_name, email, role, department_id, active) values
  ('11111111-1111-1111-1111-111111111111','Q Manager','qm@actom.co.za','quality_manager',
    (select id from departments where name='Assembly'), true),
  ('22222222-2222-2222-2222-222222222222','Inspector A','inspector.a@actom.co.za','inspector',
    (select id from departments where name='Assembly'), true),
  ('33333333-3333-3333-3333-333333333333','Inspector B','inspector.b@actom.co.za','inspector',
    (select id from departments where name='Paint Shop'), true)
on conflict (id) do nothing;

insert into projects (code, name, family_id) values
  ('P-TEST','Test project',(select id from product_families limit 1)) on conflict do nothing;
insert into works_orders (code, project_id, qty) values
  ('WO-TEST',(select id from projects where code='P-TEST'),1) on conflict do nothing;

insert into inspection_templates (id, code, name, stage_id, min_competency)
values ('aaaaaaaa-0000-0000-0000-000000000001','IT-TEST','Test template',
        (select id from manufacturing_stages where name='Assembly'), 3)
on conflict do nothing;

insert into template_revisions (id, template_id, rev, status, definition, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,'published',
  '{"sections":[{"id":"s1","title":"T","items":[
     {"id":"f1","type":"passfail","label":"Check one","req":true},
     {"id":"f2","type":"instr","label":"Instrument"}]}]}'::jsonb,
  '11111111-1111-1111-1111-111111111111')
on conflict do nothing;

insert into equipment (asset_no, name, category, status, next_due) values
  ('MME-OK','Good gauge','Torque','calibrated', current_date + 200),
  ('MME-BAD','Overdue gauge','Torque','overdue', current_date - 10)
on conflict (asset_no) do nothing;

insert into inspections (id, ref, template_rev_id, stage_id, project_id, works_order_id,
                         unit_ref, assigned_to, department_id, planned_date, status)
values ('cccccccc-0000-0000-0000-000000000001','INS-TEST-0001',
        'bbbbbbbb-0000-0000-0000-000000000001',
        (select id from manufacturing_stages where name='Assembly'),
        (select id from projects where code='P-TEST'),
        (select id from works_orders where code='WO-TEST'),
        'UNIT-1','22222222-2222-2222-2222-222222222222',
        (select id from departments where name='Assembly'), current_date, 'in_progress')
on conflict do nothing;

-- ---------- helper ----------
create or replace function t_assert(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok then raise notice '  ok   %', label;
  else raise exception 'FAIL %', label; end if;
end $$;

create or replace function t_refuses(label text, stmt text) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL % — the statement was ALLOWED and should not have been', label;
exception
  when others then
    if sqlerrm like 'FAIL %' then raise; end if;
    raise notice '  ok   % (refused: %)', label, left(sqlerrm, 60);
end $$;

set role authenticated;

-- ============================================================
\echo '--- RLS scoping'
select set_config('test.uid','22222222-2222-2222-2222-222222222222',false);
select t_assert('inspector A sees their department inspection',
  (select count(*) from inspections where ref = 'INS-TEST-0001') = 1);

select set_config('test.uid','33333333-3333-3333-3333-333333333333',false);
select t_assert('inspector B (Paint Shop) sees nothing from Assembly',
  (select count(*) from inspections where ref = 'INS-TEST-0001') = 0);

select set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
select t_assert('quality manager sees all inspections',
  (select count(*) from inspections where ref = 'INS-TEST-0001') = 1);

select set_config('test.uid','',false);
select t_assert('anonymous caller sees no inspections',
  (select count(*) from inspections) = 0);
select t_assert('anonymous caller sees no profiles',
  (select count(*) from profiles) = 0);

-- ============================================================
\echo '--- equipment must be in calibration'
select set_config('test.uid','22222222-2222-2222-2222-222222222222',false);
select t_refuses('a result referencing overdue equipment is refused', $q$
  insert into inspection_results (inspection_id, field_id, label, outcome, equipment_id)
  values ('cccccccc-0000-0000-0000-000000000001','f2','Instrument','pass',
          (select id from equipment where asset_no='MME-BAD'))
$q$);

insert into inspection_results (inspection_id, field_id, label, outcome, equipment_id)
values ('cccccccc-0000-0000-0000-000000000001','f2','Instrument','pass',
        (select id from equipment where asset_no='MME-OK'));
select t_assert('a result referencing in-date equipment is accepted',
  (select count(*) from inspection_results where field_id='f2') = 1);

-- ============================================================
\echo '--- competency is required to sign'
insert into inspection_results (inspection_id, field_id, label, outcome)
values ('cccccccc-0000-0000-0000-000000000001','f1','Check one','pass');

select t_refuses('signing without level 3 competency is refused', $q$
  select submit_inspection('cccccccc-0000-0000-0000-000000000001','sig')
$q$);

reset role;
insert into competencies (profile_id, skill, level)
values ('22222222-2222-2222-2222-222222222222','Routine testing sign-off',3)
on conflict do nothing;
set role authenticated;
select set_config('test.uid','22222222-2222-2222-2222-222222222222',false);

select t_assert('signing with level 3 succeeds',
  (submit_inspection('cccccccc-0000-0000-0000-000000000001','sig')->>'result') = 'pass');

-- ============================================================
\echo '--- a signed inspection is immutable'
select t_refuses('UPDATE on a signed inspection is refused', $q$
  update inspections set result = 'fail' where ref = 'INS-TEST-0001'
$q$);
select t_refuses('changing a result on a signed inspection is refused', $q$
  update inspection_results set outcome = 'fail'
   where inspection_id = 'cccccccc-0000-0000-0000-000000000001' and field_id = 'f1'
$q$);
select t_refuses('DELETE on an inspection is refused for authenticated', $q$
  delete from inspections where ref = 'INS-TEST-0001'
$q$);

-- ============================================================
\echo '--- templates cannot be self-published'
select set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
reset role;
insert into template_revisions (id, template_id, rev, status, definition, created_by)
values ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',2,'draft',
        '{"sections":[]}'::jsonb,'11111111-1111-1111-1111-111111111111')
on conflict do nothing;
set role authenticated;
select t_refuses('publishing your own revision is refused', $q$
  select publish_template_revision('bbbbbbbb-0000-0000-0000-000000000002')
$q$);

-- ============================================================
\echo '--- audit trail is append only'
select t_refuses('UPDATE on audit_trail is refused', $q$
  update audit_trail set action = 'tampered' where id = (select min(id) from audit_trail)
$q$);
select t_refuses('DELETE on audit_trail is refused', $q$
  delete from audit_trail where id = (select min(id) from audit_trail)
$q$);
select set_config('test.uid','11111111-1111-1111-1111-111111111111',false);
select t_assert('the signature was recorded in the audit trail',
  (select count(*) from audit_trail where entity = 'inspections') > 0);

-- ============================================================
\echo '--- views respect RLS'
select set_config('test.uid','33333333-3333-3333-3333-333333333333',false);
select t_assert('v_open_work returns nothing to a user with no rows',
  (select count(*) from v_open_work) = 0);

reset role;
\echo ''
\echo 'All security tests passed.'
