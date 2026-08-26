-- ACTOM MV Switchgear. Everything here is data, not code: another division
-- loads its own file and runs the identical application.

insert into division_profile (code, name, hold_points)
values ('MVS','ACTOM MV Switchgear', false)
on conflict (id) do update set code=excluded.code, name=excluded.name;

insert into product_families (name) values
  ('12 kV metal-clad'),('22 kV RMU'),('11 kV MCC'),('Retrofit / refurbishment')
on conflict (name) do nothing;

insert into equipment (asset_no,name,category,location,interval_months,last_calibrated,next_due,status) values
  ('MME-0412','Secondary injection set - Omicron CMC 356','High voltage','Test bay 2',12,'2025-07-30','2026-07-30','overdue'),
  ('MME-0517','Torque wrench 40-200 Nm (#7)','Torque','Assembly',6,'2026-03-02','2026-09-02','due'),
  ('MME-0288','HV divider 100 kV','High voltage','Test hall',24,'2025-03-11','2027-03-11','calibrated'),
  ('MME-0601','DFT gauge - Elcometer 456','Coating','Paint shop',12,'2026-01-28','2027-01-28','calibrated'),
  ('MME-0722','Vernier caliper 0-300 mm (#12)','Dimensional','Machine shop',12,'2026-04-15','2027-04-15','calibrated')
on conflict (asset_no) do nothing;

-- Requirements matrix. Hold points are off for this division, so every
-- requirement records the inspection without blocking production.
insert into inspection_requirements (family_id, stage_id, level, sampling)
select f.id, s.id, 'required', 'full'
from product_families f
cross join manufacturing_stages s
where f.name = '12 kV metal-clad'
on conflict (family_id, stage_id) do nothing;
