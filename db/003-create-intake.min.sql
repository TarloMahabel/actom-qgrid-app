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
