-- Group-standard reference data. Identical in every division database.
-- Division-specific stages, families and templates are loaded separately.

insert into manufacturing_stages (name, sort_order) values
  ('Incoming Inspection',1),('Fabrication',2),('Machine Shop',3),('Paint Shop',4),
  ('Assembly',5),('Wiring',6),('Testing (FAT)',7),('Final QA Inspection',8),
  ('Packing / Dispatch',9)
on conflict (name) do nothing;

insert into departments (name, stage_id, sort_order)
select s.name, s.id, s.sort_order from manufacturing_stages s
on conflict (name) do nothing;

insert into defect_codes (code, description) values
  ('DF010','Fabrication defect'),('DF011','Weld defect'),
  ('DF012','Dimensional out of tolerance'),('DF020','Assembly defect'),
  ('DF021','Incorrect component fitted'),('DF030','Wiring defect'),
  ('DF031','Incorrect termination'),('DF040','Paint defect'),
  ('DF041','DFT below specification'),('DF050','Test failure - dielectric'),
  ('DF051','Contact resistance high'),('DF060','Supplier material defect'),
  ('DF070','Documentation defect'),('DF080','Handling / transit damage')
on conflict (code) do nothing;
