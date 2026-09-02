-- =====================================================================
-- ACTOM Apprenticeship Portal — catalogue and intake setup
--
-- PART 1  reference catalogue: trades, subjects, consent wording
-- PART 2  the intake, with trades, subject rules and documents attached
--
-- Order matters: part 2 attaches the part 1 catalogue to the intake, so
-- running it against an empty catalogue silently yields an intake with
-- no trades. Both parts are here so that cannot happen.
--
-- Safe to re-run. Nothing duplicates.
--
-- Run AFTER schema.sql and 002-form-config.sql.
-- The intake is created as DRAFT. Configure and publish it in the
-- reviewer console under Form setup, never from SQL.
-- =====================================================================

-- =====================================================================
-- PART 1 — reference catalogue
-- =====================================================================
insert into public.trades (code, name, division, stream, sort_order) values
  ('ELEC',  'Electrician',                    'Electrical Products',      'both',      10),
  ('MILL',  'Millwright',                     'Electrical Machines',      'technical', 20),
  ('FITT',  'Fitter and Turner',              'Electrical Machines',      'technical', 30),
  ('BOIL',  'Boilermaker',                    'Power Systems',            'technical', 40),
  ('WELD',  'Welder',                         'Power Systems',            'technical', 50),
  ('TRWD',  'Transformer Winder',             'Power Transformers',       'technical', 60),
  ('INST',  'Instrument Mechanician',         'Protection and Control',   'both',      70),
  ('DIES',  'Diesel Mechanic',                'Static Power',             'technical', 80),
  ('RIGG',  'Rigger',                         'Power Systems',            'technical', 90),
  ('TOOL',  'Toolmaker',                      'Electrical Machines',      'technical', 100),
  ('PLAT',  'Plater',                         'Power Systems',            'technical', 110)
on conflict (code) do nothing;
insert into public.subjects (stream, name, sort_order) values
  ('academic','Mathematics',10),
  ('academic','Mathematical Literacy',15),
  ('academic','Physical Science',20),
  ('academic','Life Science',30),
  ('academic','Life Orientation',40),
  ('academic','Home Language',50),
  ('academic','First Additional Language',60),
  ('academic','Agricultural Science',70),
  ('academic','Geography',80),
  ('academic','History',90),
  ('academic','Religious Studies',100),
  ('academic','Business Studies',110),
  ('academic','Accounting',120),
  ('academic','Economics',130),
  ('academic','Computer Applications Technology',140),
  ('academic','Information Technology',145),
  ('academic','Design',150),
  ('academic','Tourism',160),
  ('academic','Consumer Studies',170)
on conflict (stream, name) do nothing;
insert into public.subjects (stream, name, sort_order) values
  ('technical','Technical Mathematics',10),
  ('technical','Technical Science',20),
  ('technical','Engineering Graphics and Design',30),
  ('technical','Technical Drawing',40),
  ('technical','Mechanical Drawing',50),
  ('technical','Electrical Technology',60),
  ('technical','Mechanical Technology',70),
  ('technical','Civil Technology',75),
  ('technical','Mechanical Welding',80),
  ('technical','Fitting and Machining Theory',90),
  ('technical','Trade Theory',100),
  ('technical','Agricultural Management',110),
  ('technical','Life Orientation',120),
  ('technical','Home Language',130),
  ('technical','First Additional Language',140),
  ('technical','Design',150)
on conflict (stream, name) do nothing;
insert into public.subjects (stream, name, sort_order) values
  ('qualification','Mathematics',10),
  ('qualification','Engineering Science',20),
  ('qualification','Engineering Drawing',30),
  ('qualification','Engineering Graphics and Design',40),
  ('qualification','Engineering Fundamentals',50),
  ('qualification','Engineering Systems',60),
  ('qualification','Engineering Technology',70),
  ('qualification','Applied Engineering Technology',80),
  ('qualification','Engineering Processes',90),
  ('qualification','Engineering Practice and Maintenance',100),
  ('qualification','Professional Engineering Practice',110),
  ('qualification','Electrical Principles and Practice',120),
  ('qualification','Electrical Systems and Construction',130),
  ('qualification','Electrical Workmanship',140),
  ('qualification','Electronic Control and Digital Electronics',150),
  ('qualification','Industrial Electronics',160),
  ('qualification','Digital Electronics',170),
  ('qualification','Communication Electronics',180),
  ('qualification','Logic Systems',190),
  ('qualification','Electrotechnics',200),
  ('qualification','Computer Principles',210),
  ('qualification','Workshop Practice',220),
  ('qualification','Material Technology',230),
  ('qualification','Fitting and Turning',240),
  ('qualification','Fitting and Machining',250),
  ('qualification','Mechanotechnics',260),
  ('qualification','Mechanical Draughting',270),
  ('qualification','Mechanical Drawing and Design',280),
  ('qualification','Engineering Fabrication',290),
  ('qualification','Engineering Fabrication - Boiler Making',300),
  ('qualification','Welding',310),
  ('qualification','Plating and Structural Steel Drawing',320),
  ('qualification','Platers Theory',330),
  ('qualification','Strength of Materials and Structures',340),
  ('qualification','Power Machines',350),
  ('qualification','Fluid Mechanics',360),
  ('qualification','Diesel Trade Theory',370),
  ('qualification','Trade Theory',380),
  ('qualification','Supervisory Management',390),
  ('qualification','Life Orientation',400),
  ('qualification','Language',410)
on conflict (stream, name) do nothing;
alter table public.consent_versions
  drop constraint if exists consent_versions_version_key;
create unique index if not exists consent_versions_version_audience_key
  on public.consent_versions (version, audience);
insert into public.consent_versions (version, audience, body) values
('2026.1','applicant',
'ACTOM (Pty) Ltd collects the information in this form to assess your application for an apprenticeship or learnership, to verify your identity and qualifications, and to meet our reporting duties under the Employment Equity Act 55 of 1998 and the Skills Development Act 97 of 1998.
Some of what we ask for is special personal information under section 26 of the Protection of Personal Information Act 4 of 2013, specifically your race or ethnic group and whether you have a disability. You may answer "prefer not to say" to both. Doing so will not affect your application.
Your identity number is encrypted while we hold it. Only trained ACTOM staff who need it to verify your application can view it, and every time it is viewed we record who did so and why.
We keep your application for 12 months after this intake closes so that we can consider you for later positions. After that we delete it, along with your uploaded documents. If you are appointed, your information moves to your employee record and is kept under our employee retention rules instead.
We do not sell your information and we do not share it outside ACTOM except with the Sector Education and Training Authority for the registration of a contract of apprenticeship, or where the law requires it.
You may ask to see, correct or delete what we hold about you at any time by writing to the ACTOM Information Officer at informationofficer@actom.co.za. You may also lodge a complaint with the Information Regulator of South Africa.
By ticking the box below you confirm that the information you have given is true and complete, and that you agree to ACTOM processing it for the purposes set out above.'),
('2026.1','guardian',
'This applicant is under 18 years of age. Under section 35 of the Protection of Personal Information Act 4 of 2013, ACTOM (Pty) Ltd may not process a child''s personal information without the consent of a competent person.
By completing this section you confirm that you are the parent or legal guardian of the applicant, that you have read the applicant privacy notice, and that you consent to ACTOM collecting and processing the applicant''s personal information, including their identity number, race or ethnic group and disability status, for the purpose of assessing their application for an apprenticeship or learnership.
You may withdraw this consent at any time by writing to informationofficer@actom.co.za. Withdrawing consent will end the application.')
on conflict (version, audience) do nothing;
insert into public.intakes (name, opens_at, closes_at, status, retention_months)
select '2027 Apprenticeship Intake',
       now(), now() + interval '60 days', 'draft', 12
 where not exists (select 1 from public.intakes
                    where name = '2027 Apprenticeship Intake');

-- =====================================================================
-- PART 2 — the intake and its configuration
-- =====================================================================
do $$
declare
  v_intake uuid;
  t        record;
begin
  ------------------------------------------------------------------
  -- 1. The intake itself
  ------------------------------------------------------------------
  select id into v_intake from public.intakes
   where name = '2027 Apprenticeship Intake';

  if v_intake is null then
    insert into public.intakes (
      name, opens_at, closes_at, status, retention_months,
      show_further_study, show_technical, consent_version,
      max_upload_mb, scoring_enabled, auto_flag_below)
    values (
      '2027 Apprenticeship Intake',
      now(),
      now() + interval '60 days',
      'draft',            -- configure in the console, publish there
      12,                 -- months to keep applications after closing
      true, true, '2026.1', 8, true, true)
    returning id into v_intake;
    raise notice 'Created intake %', v_intake;
  else
    raise notice 'Intake already exists: %', v_intake;
  end if;

  ------------------------------------------------------------------
  -- 2. Trades — every active trade, switched on
  ------------------------------------------------------------------
  insert into public.intake_trades
    (intake_id, trade_id, active, positions, sort_order)
  select v_intake, tr.id, true, 2, tr.sort_order
    from public.trades tr
   where tr.active
  on conflict (intake_id, trade_id) do nothing;

  ------------------------------------------------------------------
  -- 3. Documents
  ------------------------------------------------------------------
  insert into public.intake_documents
    (intake_id, doc_type, label, hint, required, max_files, sort_order)
  values
    (v_intake, 'id_document', 'Certified copy of your ID',
     'Certified within the last three months.', true, 1, 10),
    (v_intake, 'matric_certificate', 'Grade 12 certificate or statement of results',
     'If you are still waiting for results, upload your latest school report.', false, 1, 20),
    (v_intake, 'qualification', 'Further qualification certificates',
     'N-certificates, diplomas, trade test results.', false, 4, 30),
    (v_intake, 'other', 'Other supporting documents',
     'Proof of residence, a reference letter, a CV.', false, 2, 40)
  on conflict (intake_id, doc_type) do nothing;

  ------------------------------------------------------------------
  -- 4. Subjects per trade
  --
  -- A starting point only: maths and science compulsory at 40% and
  -- weighted 3, drawing and technology weighted 2, life orientation
  -- captured but not scored. Adjust per trade in the console — a
  -- Millwright and a Plater should not be scored identically.
  ------------------------------------------------------------------
  for t in select trade_id from public.intake_trades
            where intake_id = v_intake
  loop
    insert into public.intake_trade_subjects
      (intake_id, trade_id, subject_id, stream, required, min_mark, weight, sort_order)
    select
      v_intake, t.trade_id, s.id, s.stream,
      s.name in ('Mathematics','Technical Mathematics','Physical Science','Technical Science'),
      case when s.name in ('Mathematics','Technical Mathematics',
                           'Physical Science','Technical Science')
           then 40 else null end,
      case when s.name in ('Mathematics','Technical Mathematics',
                           'Physical Science','Technical Science') then 3
           when s.name in ('Engineering Graphics and Design','Mechanical Technology',
                           'Electrical Technology','Technical Drawing') then 2
           when s.name = 'Life Orientation' then 0
           else 1 end,
      s.sort_order
      from public.subjects s
     where s.active
       and s.stream in ('academic','technical')
       and s.name in ('Mathematics','Mathematical Literacy','Physical Science',
                      'Life Science','Life Orientation','Home Language',
                      'First Additional Language','Technical Mathematics',
                      'Technical Science','Engineering Graphics and Design',
                      'Mechanical Technology','Electrical Technology',
                      'Technical Drawing','Fitting and Machining Theory','Trade Theory')
    on conflict (intake_id, trade_id, subject_id, stream) do nothing;
  end loop;

  raise notice 'Configuration complete for intake %', v_intake;
end $$;
select i.name, i.status, i.opens_at::date, i.closes_at::date,
       (select count(*) from public.intake_trades it
         where it.intake_id = i.id and it.active)          as trades,
       (select count(*) from public.intake_trade_subjects s
         where s.intake_id = i.id)                          as subject_rules,
       (select count(*) from public.intake_documents d
         where d.intake_id = i.id)                          as documents
  from public.intakes i
 order by i.created_at;

-- =====================================================================
-- Expect: 11 trades, 76 subjects, 2 consent versions, ONE intake row
-- showing 11 trades / 198 subject rules / 4 documents.
-- =====================================================================
select
  (select count(*) from public.trades)           as trades_catalogue,
  (select count(*) from public.subjects)         as subjects_catalogue,
  (select count(*) from public.consent_versions) as consent_versions,
  (select count(*) from public.intakes)          as intakes;
