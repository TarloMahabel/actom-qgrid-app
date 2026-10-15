-- ACTOM Power Transformers — division seed
-- Target: APT Supabase project qjpwsrtwafhrrcoqoftx
-- Idempotent: safe to re-run; all statements use ON CONFLICT.

-- ============================================================
-- DIVISION PROFILE
-- ============================================================
INSERT INTO division_profile (code, name, hold_points)
VALUES ('APT', 'ACTOM Power Transformers', false)
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name;

-- ============================================================
-- MANUFACTURING STAGES (APT-specific)
-- ============================================================
INSERT INTO manufacturing_stages (name, sort_order) VALUES
  ('Incoming Inspection',        1),
  ('Core & Coil Assembly',       2),
  ('Tank Fabrication',           3),
  ('Winding',                    4),
  ('Dry-out / Vacuum Treatment', 5),
  ('Oil Filling',                6),
  ('Routine Tests',              7),
  ('Final QA Inspection',        8),
  ('Packing / Dispatch',         9)
ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order;

-- ============================================================
-- PRODUCT FAMILIES
-- ============================================================
INSERT INTO product_families (name) VALUES
  ('Generator Step-Up'),
  ('Grid / Transmission'),
  ('Auto-transformer'),
  ('Distribution (HV)'),
  ('Phase Shifting'),
  ('Shunt Reactor'),
  ('Repair & Rewind')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- INSPECTION TEMPLATES AND REVISIONS
-- ============================================================
DO $$
DECLARE
  v_user uuid := '07ed1631-5e8f-43bc-b9bb-f8be4ac34af0';
  v_date date := '2026-10-15';
  t      uuid;
  s_inc  smallint;
  s_cca  smallint;
  s_tnk  smallint;
  s_wnd  smallint;
  s_vpd  smallint;
  s_oil  smallint;
  s_fqa  smallint;
BEGIN
  SELECT id INTO s_inc FROM manufacturing_stages WHERE name = 'Incoming Inspection';
  SELECT id INTO s_cca FROM manufacturing_stages WHERE name = 'Core & Coil Assembly';
  SELECT id INTO s_tnk FROM manufacturing_stages WHERE name = 'Tank Fabrication';
  SELECT id INTO s_wnd FROM manufacturing_stages WHERE name = 'Winding';
  SELECT id INTO s_vpd FROM manufacturing_stages WHERE name = 'Dry-out / Vacuum Treatment';
  SELECT id INTO s_oil FROM manufacturing_stages WHERE name = 'Oil Filling';
  SELECT id INTO s_fqa FROM manufacturing_stages WHERE name = 'Final QA Inspection';

  -- --------------------------------------------------------
  -- STAGE 1: INCOMING INSPECTION
  -- --------------------------------------------------------

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-INC-001', 'QF123 — Core Inspection at Supplier', s_inc, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "General Information", "items": [{"id": "i001", "type": "text", "label": "Serial number"}, {"id": "i002", "type": "text", "label": "Customer"}, {"id": "i003", "type": "text", "label": "Supplier name"}, {"id": "i004", "type": "text", "label": "Purchase order number"}, {"id": "i005", "type": "text", "label": "Inspection date"}]}, {"title": "Dimensional Checks", "items": [{"id": "d001", "type": "measure", "unit": "mm", "label": "Core circle diameter (design +3mm/-0mm tolerance)"}, {"id": "d002", "type": "measure", "unit": "mm", "label": "Phase centre A-B"}, {"id": "d003", "type": "measure", "unit": "mm", "label": "Phase centre B-C"}, {"id": "d004", "type": "measure", "unit": "mm", "label": "Yoke clamp to yoke clamp (+/-1mm)"}, {"id": "d005", "type": "measure", "unit": "mm", "label": "HV yoke clamp to LV yoke clamp"}, {"id": "d006", "type": "measure", "unit": "mm", "label": "Leg length / window height A-B (+2mm/-0mm)"}, {"id": "d007", "type": "measure", "unit": "mm", "label": "Leg length / window height B-C"}, {"id": "d008", "type": "measure", "unit": "mm", "label": "A Phase side dimension A"}, {"id": "d009", "type": "measure", "unit": "mm", "label": "A Phase side dimension B"}, {"id": "d010", "type": "measure", "unit": "mm", "label": "Centre step measurement"}]}, {"title": "Visual Checks", "items": [{"id": "v001", "type": "pass_fail", "label": "Core steel grade and plate thickness verified"}, {"id": "v002", "type": "pass_fail", "label": "Step blocks alignment correct"}, {"id": "v003", "type": "pass_fail", "label": "Core insulation fitted as per drawing"}, {"id": "v004", "type": "pass_fail", "label": "Resin applied — even finish, free of runs and high spots"}, {"id": "v005", "type": "pass_fail", "label": "Centre step correctly installed"}, {"id": "v006", "type": "pass_fail", "label": "Core plate tips free from damage or bending"}, {"id": "v007", "type": "pass_fail", "label": "Bottom insulation in position, clean and tight"}, {"id": "v008", "type": "pass_fail", "label": "Four core tip protection brackets inspected per drawing"}, {"id": "v009", "type": "pass_fail", "label": "Cooling ducts correctly fitted"}]}, {"title": "Testing and Certification", "items": [{"id": "t001", "type": "pass_fail", "label": "Measurement of core loss verified"}, {"id": "t002", "type": "pass_fail", "label": "All fasteners torqued to correct settings"}, {"id": "t003", "type": "pass_fail", "label": "Supplier test certificate verified"}, {"id": "t004", "type": "pass_fail", "label": "Photographic evidence recorded"}, {"id": "t005", "type": "pass_fail", "label": "Core manufactured in accordance with OI 17"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-INC-002', 'QF520 — Cylinder Inspection at Supplier', s_inc, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Supplier and Order Details", "items": [{"id": "i001", "type": "text", "label": "APT serial number"}, {"id": "i002", "type": "text", "label": "Order number"}, {"id": "i003", "type": "text", "label": "Supplier (WILEC / ISOTECH)"}, {"id": "i004", "type": "text", "label": "Inspection date"}, {"id": "i005", "type": "text", "label": "Inspected by"}]}, {"title": "Cylinder 1", "items": [{"id": "c101", "type": "measure", "unit": "mm", "label": "Cylinder 1 — OD measured"}, {"id": "c102", "type": "measure", "unit": "mm", "label": "Cylinder 1 — Circumference"}, {"id": "c103", "type": "measure", "unit": "mm", "label": "Cylinder 1 — Length"}]}, {"title": "Cylinder 2", "items": [{"id": "c201", "type": "measure", "unit": "mm", "label": "Cylinder 2 — OD measured"}, {"id": "c202", "type": "measure", "unit": "mm", "label": "Cylinder 2 — Circumference"}, {"id": "c203", "type": "measure", "unit": "mm", "label": "Cylinder 2 — Length"}]}, {"title": "Cylinder 3", "items": [{"id": "c301", "type": "measure", "unit": "mm", "label": "Cylinder 3 — OD measured"}, {"id": "c302", "type": "measure", "unit": "mm", "label": "Cylinder 3 — Circumference"}, {"id": "c303", "type": "measure", "unit": "mm", "label": "Cylinder 3 — Length"}]}, {"title": "Acceptance", "items": [{"id": "a001", "type": "pass_fail", "label": "All cylinder dimensions within specification"}, {"id": "a002", "type": "pass_fail", "label": "No visible damage to cylinders"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-INC-003', 'Conductor Inspection Check Sheet', s_inc, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Order Details", "items": [{"id": "i001", "type": "text", "label": "APT serial number"}, {"id": "i002", "type": "text", "label": "Order number"}, {"id": "i003", "type": "text", "label": "Supplier"}, {"id": "i004", "type": "text", "label": "Conductor supplier"}, {"id": "i005", "type": "text", "label": "Bare conductor size (nominal)"}]}, {"title": "Bare Conductor", "items": [{"id": "b001", "type": "pass_fail", "label": "Bare conductor vs. material certificate verified"}, {"id": "b002", "type": "measure", "unit": "mm", "label": "Bare conductor width — measured"}, {"id": "b003", "type": "measure", "unit": "mm", "label": "Bare conductor thickness — measured"}, {"id": "b004", "type": "pass_fail", "label": "Deviation within tolerance"}]}, {"title": "Insulated Conductor", "items": [{"id": "p001", "type": "measure", "unit": "mm", "label": "Supplier conductor with paper covering — width"}, {"id": "p002", "type": "measure", "unit": "mm", "label": "Supplier conductor with paper covering — thickness"}, {"id": "p003", "type": "measure", "unit": "mm", "label": "APT measured with paper covering — width"}, {"id": "p004", "type": "measure", "unit": "mm", "label": "APT measured with paper covering — thickness"}, {"id": "p005", "type": "pass_fail", "label": "Covering type confirmed (paper / paper-netting / enamelling / epoxy)"}]}, {"title": "CTC Checks", "items": [{"id": "ct001", "type": "pass_fail", "label": "CTC conductor specification verified"}, {"id": "ct002", "type": "pass_fail", "label": "CTC tested for shorts"}, {"id": "ct003", "type": "pass_fail", "label": "Drum numbers recorded"}]}, {"title": "Release", "items": [{"id": "r001", "type": "pass_fail", "label": "Conductor released for production (contact Engineering if outside tolerance)"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  -- --------------------------------------------------------
  -- STAGE 2: CORE & COIL ASSEMBLY
  -- --------------------------------------------------------

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-CCA-001', 'QF124 — Core Inspection at APT', s_cca, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Level and Alignment", "items": [{"id": "l001", "type": "pass_fail", "label": "Core level vertical and horizontal (within tolerance)"}, {"id": "l002", "type": "pass_fail", "label": "Step blocks alignment correct"}, {"id": "l003", "type": "pass_fail", "label": "Centre step level with A and B phases"}, {"id": "l004", "type": "text", "label": "Level deviation — record mm if applicable"}]}, {"title": "Insulation and Fittings", "items": [{"id": "f001", "type": "pass_fail", "label": "Core insulation correctly fitted and centred"}, {"id": "f002", "type": "pass_fail", "label": "Common oil ring fitted correctly (not damaged)"}, {"id": "f003", "type": "pass_fail", "label": "Bottom insulation in position, properly cleaned"}]}, {"title": "Condition", "items": [{"id": "c001", "type": "pass_fail", "label": "Core properly cleaned — no debris or loose fibres"}, {"id": "c002", "type": "pass_fail", "label": "Core tip protection brackets fitted per drawing"}, {"id": "c003", "type": "pass_fail", "label": "No damage to core laminations"}]}, {"title": "Evidence", "items": [{"id": "ph001", "type": "pass_fail", "label": "Photographic evidence recorded"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-CCA-002', 'QF502 — Bottom Line-Up Inspection', s_cca, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Yoke and Laminations", "items": [{"id": "y001", "type": "pass_fail", "label": "No damage or defects on bottom yoke laminations"}, {"id": "y002", "type": "pass_fail", "label": "No damage or defects on bottom yoke insulation"}, {"id": "y003", "type": "pass_fail", "label": "Core lamination tip protection fitted before coil fitment"}]}, {"title": "Press Frames", "items": [{"id": "p001", "type": "pass_fail", "label": "Bottom press frames fitted correctly — cutouts correct and centred"}, {"id": "p002", "type": "pass_fail", "label": "Press frames level with centre step"}, {"id": "p003", "type": "pass_fail", "label": "B Phase press frames level with A and C phase frames"}, {"id": "p004", "type": "pass_fail", "label": "Yoke clamp exit protecting barrier fitted"}, {"id": "p005", "type": "pass_fail", "label": "Bottom press finger insulation fitted correctly"}, {"id": "p006", "type": "text", "label": "Packing dimension if frames need packing (mm)"}]}, {"title": "Core and Vacuum", "items": [{"id": "m001", "type": "pass_fail", "label": "Core standing vertical and horizontal level"}, {"id": "m002", "type": "measure", "unit": "mm", "label": "Core diameter over strapping"}, {"id": "m003", "type": "pass_fail", "label": "Insulation setup properly vacuumed before coil fitment"}]}, {"title": "Common Oil Rings", "items": [{"id": "o001", "type": "pass_fail", "label": "Common oil rings correctly fitted and aligned with press frames"}, {"id": "o002", "type": "pass_fail", "label": "All edges clean and correctly seated"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-CCA-003', 'QF501 — Top Line-Up Inspection', s_cca, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Coil Exits", "items": [{"id": "e001", "type": "pass_fail", "label": "Coil exits placed per exit layout drawing"}, {"id": "e002", "type": "pass_fail", "label": "Winding exits not protruding into adjacent winding oil duct"}, {"id": "e003", "type": "pass_fail", "label": "Winding exit type correct with no visible damage"}, {"id": "e004", "type": "measure", "unit": "mm", "label": "Limb pitch A to B"}, {"id": "e005", "type": "measure", "unit": "mm", "label": "Limb pitch B to C"}]}, {"title": "Shields and Hardware", "items": [{"id": "s001", "type": "pass_fail", "label": "Yoke clamp shield correctly installed"}, {"id": "s002", "type": "pass_fail", "label": "Collars and snouts correctly installed"}]}, {"title": "Spacers and Insulation", "items": [{"id": "sp001", "type": "pass_fail", "label": "Top line-up properly vacuumed and free from loose fibres"}, {"id": "sp002", "type": "pass_fail", "label": "Winding spacers aligned — unobstructed oil flow"}, {"id": "sp003", "type": "pass_fail", "label": "Any spacer reduction within allowable tolerance"}, {"id": "sp004", "type": "pass_fail", "label": "No buckling or deformation of former cylinders"}, {"id": "sp005", "type": "pass_fail", "label": "Insulation blocks and rings correctly installed with correct dimensions"}, {"id": "sp006", "type": "pass_fail", "label": "Cutouts in rings neatly finished — no visible fibres"}, {"id": "sp007", "type": "pass_fail", "label": "All oil ducts properly sealing and free from debris"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-CCA-004', 'QF500 — Crimp Joint Records', s_cca, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Joint Identification", "items": [{"id": "j001", "type": "text", "label": "Joint position (lead number, phase, locating info)"}, {"id": "j002", "type": "text", "label": "Recorded by"}]}, {"title": "Crimp Dimensions", "items": [{"id": "d001", "type": "measure", "unit": "mm", "label": "N1 dimension"}, {"id": "d002", "type": "measure", "unit": "mm", "label": "N2 dimension"}]}, {"title": "Tap Readings", "items": [{"id": "t001", "type": "measure", "unit": "mm", "label": "TAP A reading"}, {"id": "t002", "type": "measure", "unit": "mm", "label": "TAP B reading"}, {"id": "t003", "type": "measure", "unit": "mm", "label": "TAP C reading"}]}, {"title": "Result", "items": [{"id": "r001", "type": "pass_fail", "label": "Crimp joint accepted"}, {"id": "r002", "type": "text", "label": "Actions required / observations (transfer to punch list if applicable)"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-CCA-005', 'QF505 — Connections Check', s_cca, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Documentation", "items": [{"id": "d001", "type": "pass_fail", "label": "Crimp joint in-progress measurement recorded on QF form"}, {"id": "d002", "type": "pass_fail", "label": "Exit clearance dimensions recorded on QF form"}, {"id": "d003", "type": "pass_fail", "label": "Route card completed and signed by supervisor"}]}, {"title": "Lead Condition", "items": [{"id": "l001", "type": "pass_fail", "label": "Leads clean and free from insulation damage"}, {"id": "l002", "type": "pass_fail", "label": "No cracks in cleat bar structure"}]}, {"title": "Crimp Sample", "items": [{"id": "s001", "type": "pass_fail", "label": "Crimp joint sample done and quality acceptable"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-CCA-006', 'QF504 — Active Part Inspection', s_cca, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Spacers and Insulation", "items": [{"id": "s001", "type": "pass_fail", "label": "Bottom spacers still aligned"}, {"id": "s002", "type": "pass_fail", "label": "Top yoke insulation correctly installed and aligned"}, {"id": "s003", "type": "measure", "unit": "mm", "label": "Bottom to top yoke dimension"}, {"id": "s004", "type": "pass_fail", "label": "Core yoke insulation correctly installed"}, {"id": "s005", "type": "pass_fail", "label": "Top yoke correctly stacked — no damage to core tips"}, {"id": "s006", "type": "pass_fail", "label": "Exit to yoke insulation correctly installed"}, {"id": "s007", "type": "pass_fail", "label": "Exit clearance verified and recorded"}]}, {"title": "Earthing and Bonding", "items": [{"id": "e001", "type": "pass_fail", "label": "All supports, retainers and yoke straps flashed"}, {"id": "e002", "type": "measure", "unit": "MOhm", "label": "Megger: yoke straps to earth"}, {"id": "e003", "type": "measure", "unit": "MOhm", "label": "Megger: core to earth"}, {"id": "e004", "type": "measure", "unit": "MOhm", "label": "Megger: core to yoke clamps"}, {"id": "e005", "type": "pass_fail", "label": "All yoke straps, cross bars, retainers and earth straps bonded to yoke clamps"}, {"id": "e006", "type": "pass_fail", "label": "HV and LV yoke clamps and cross bars joined to earth"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  -- --------------------------------------------------------
  -- STAGE 3: TANK FABRICATION
  -- --------------------------------------------------------

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-TNK-001', 'Tank Fabrication Inspection', s_tnk, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Materials and Documentation", "items": [{"id": "m001", "type": "pass_fail", "label": "Material certificates reviewed and on file"}, {"id": "m002", "type": "pass_fail", "label": "Material quantity correct per drawing"}, {"id": "m003", "type": "pass_fail", "label": "Welder qualifications verified"}, {"id": "m004", "type": "pass_fail", "label": "Drawing standards compliance confirmed"}]}, {"title": "Cut Material", "items": [{"id": "c001", "type": "pass_fail", "label": "Cut material dimensions correct per drawing"}]}, {"title": "Welding", "items": [{"id": "w001", "type": "pass_fail", "label": "Visual weld check — no visible defects"}, {"id": "w002", "type": "pass_fail", "label": "Weld measurements recorded"}, {"id": "w003", "type": "pass_fail", "label": "Dye penetrant test completed (where required)"}]}, {"title": "Assembly and Pressure", "items": [{"id": "a001", "type": "pass_fail", "label": "Assembled components visual check acceptable"}, {"id": "a002", "type": "pass_fail", "label": "Dimensional checks after assembly within drawing tolerance"}, {"id": "a003", "type": "pass_fail", "label": "Tank pressure test completed and passed"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-TNK-002', 'QF351 — Tank Deflection Test', s_tnk, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Vacuum Test", "items": [{"id": "vac001", "type": "measure", "unit": "mm", "label": "Measurement before vacuum applied"}, {"id": "vac002", "type": "measure", "unit": "mm", "label": "Measurement with vacuum applied"}, {"id": "vac003", "type": "measure", "unit": "mm", "label": "Measurement after vacuum released"}]}, {"title": "Pressure Test", "items": [{"id": "pre001", "type": "measure", "unit": "mm", "label": "Measurement before pressure applied"}, {"id": "pre002", "type": "measure", "unit": "mm", "label": "Measurement with pressure applied"}, {"id": "pre003", "type": "measure", "unit": "mm", "label": "Measurement after pressure released"}]}, {"title": "Result", "items": [{"id": "r001", "type": "measure", "unit": "mm", "label": "Permanent deflection calculated"}, {"id": "r002", "type": "pass_fail", "label": "Permanent deflection within allowable limit"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-TNK-003', 'QF338 — Paint Inspection and DFT Measurements', s_tnk, null, 2, 'record', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Environmental Conditions", "items": [{"id": "env001", "type": "pass_fail", "label": "Temperature > 5 degrees C confirmed"}, {"id": "env002", "type": "pass_fail", "label": "Humidity < 80% confirmed"}, {"id": "env003", "type": "measure", "unit": "C", "label": "Ambient temperature"}, {"id": "env004", "type": "measure", "unit": "%", "label": "Humidity"}]}, {"title": "Shotblast", "items": [{"id": "sb001", "type": "pass_fail", "label": "Shotblast surface preparation completed"}]}, {"title": "Primer — Carbozinc 859", "items": [{"id": "pr001", "type": "text", "label": "Primer batch number"}, {"id": "pr002", "type": "measure", "unit": "um", "label": "Primer DFT average"}, {"id": "pr003", "type": "pass_fail", "label": "Primer within specified DFT range"}]}, {"title": "Intermediate Coat — Carboguard 880 (A+B)", "items": [{"id": "im001", "type": "text", "label": "Intermediate coat batch number"}, {"id": "im002", "type": "measure", "unit": "um", "label": "Intermediate DFT average"}, {"id": "im003", "type": "pass_fail", "label": "Intermediate coat within specified DFT range"}]}, {"title": "Top Coats — Carbothane 1342A", "items": [{"id": "tc001", "type": "text", "label": "Top coat 1 batch number"}, {"id": "tc002", "type": "measure", "unit": "um", "label": "Top coat 1 DFT average"}, {"id": "tc003", "type": "text", "label": "Top coat 2 batch number"}, {"id": "tc004", "type": "measure", "unit": "um", "label": "Top coat 2 DFT average"}, {"id": "tc005", "type": "pass_fail", "label": "HOLD: Inspector verified tank and conservator colour before top coat"}]}, {"title": "Final and Sign-Off", "items": [{"id": "fc001", "type": "measure", "unit": "um", "label": "Final coat DFT average"}, {"id": "fc002", "type": "pass_fail", "label": "Cosmetic inspection passed"}, {"id": "fc003", "type": "pass_fail", "label": "Paint foreman sign-off obtained"}, {"id": "fc004", "type": "pass_fail", "label": "QC inspector sign-off obtained"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  -- --------------------------------------------------------
  -- STAGE 4: WINDING
  -- --------------------------------------------------------

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-WND-001', 'Winding Manufacturing QC Check Sheet', s_wnd, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Conductor Specification", "items": [{"id": "cs001", "type": "pass_fail", "label": "Bare conductor size within tolerance"}, {"id": "cs002", "type": "measure", "unit": "mm", "label": "Bare conductor width actual"}, {"id": "cs003", "type": "measure", "unit": "mm", "label": "Bare conductor thickness actual"}, {"id": "cs004", "type": "pass_fail", "label": "Conductor covering specification verified"}, {"id": "cs005", "type": "pass_fail", "label": "CTC conductor specification verified"}, {"id": "cs006", "type": "pass_fail", "label": "CTC tested for shorts"}, {"id": "cs007", "type": "pass_fail", "label": "Drum numbers recorded"}]}, {"title": "Cylinder and Coil Dimensions", "items": [{"id": "cy001", "type": "measure", "unit": "mm", "label": "Cylinder circumference measured"}, {"id": "cy002", "type": "measure", "unit": "mm", "label": "Cylinder ID measured"}, {"id": "cy003", "type": "measure", "unit": "mm", "label": "Cylinder OD measured"}, {"id": "cy004", "type": "measure", "unit": "mm", "label": "Cylinder length actual"}, {"id": "cy005", "type": "measure", "unit": "mm", "label": "Thickness of joint or overlap"}, {"id": "cy006", "type": "measure", "unit": "mm", "label": "Thickness of spacers"}, {"id": "cy007", "type": "measure", "unit": "mm", "label": "Actual circumference over strips or T-strips"}]}, {"title": "Coil Build", "items": [{"id": "cb001", "type": "pass_fail", "label": "Number of turns or discs matches specification"}, {"id": "cb002", "type": "measure", "unit": "mm", "label": "Coil length copper to copper"}, {"id": "cb003", "type": "measure", "unit": "mm", "label": "Radial height actual"}, {"id": "cb004", "type": "pass_fail", "label": "Radial height within specification"}, {"id": "cb005", "type": "measure", "unit": "mm", "label": "Bottom insulation dimension actual"}, {"id": "cb006", "type": "pass_fail", "label": "Inner oil seal positions verified"}, {"id": "cb007", "type": "pass_fail", "label": "Joints in copper recorded (disk and sector number)"}, {"id": "cb008", "type": "pass_fail", "label": "Exit paper covering thickness verified"}, {"id": "cb009", "type": "text", "label": "Number of sectors or divisions — spec vs. actual"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-WND-002', 'QF503 — Coil Pressing Check Sheet', s_wnd, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Pre-Drying", "items": [{"id": "pr001", "type": "measure", "unit": "mm", "label": "Coil height before drying"}, {"id": "pr002", "type": "text", "label": "Ambient temperature at measurement"}]}, {"title": "80 Percent Stabilising Pressure", "items": [{"id": "s801", "type": "measure", "unit": "mm", "label": "Coil height — 80% stabilising pressure applied"}, {"id": "s802", "type": "measure", "unit": "mm", "label": "Coil height — 80% stabilising pressure released"}]}, {"title": "Post VPD Drying", "items": [{"id": "vpd001", "type": "measure", "unit": "mm", "label": "Coil height after VPD drying"}]}, {"title": "100 Percent Pressure Cycle", "items": [{"id": "p100a", "type": "measure", "unit": "mm", "label": "2nd 100% pressure applied — coil height"}, {"id": "p100b", "type": "measure", "unit": "mm", "label": "2nd 100% pressure released — coil height"}]}, {"title": "Final Sizing", "items": [{"id": "fs001", "type": "measure", "unit": "mm", "label": "Final sizing coil height"}, {"id": "fs002", "type": "measure", "unit": "mm", "label": "Final sizing post adjustment if required"}, {"id": "fs003", "type": "pass_fail", "label": "Final dimensions within specification"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-WND-003', 'QF509 — Winding Exit Check Sheet', s_wnd, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "HV Winding Exits", "items": [{"id": "hv001", "type": "measure", "unit": "mm", "label": "HV A Phase — exit protrusion"}, {"id": "hv002", "type": "measure", "unit": "mm", "label": "HV B Phase — exit protrusion"}, {"id": "hv003", "type": "measure", "unit": "mm", "label": "HV C Phase — exit protrusion"}, {"id": "hv004", "type": "pass_fail", "label": "HV exits within specification and not off-centre"}]}, {"title": "LV Winding Exits", "items": [{"id": "lv001", "type": "measure", "unit": "mm", "label": "LV A Phase — exit protrusion"}, {"id": "lv002", "type": "measure", "unit": "mm", "label": "LV B Phase — exit protrusion"}, {"id": "lv003", "type": "measure", "unit": "mm", "label": "LV C Phase — exit protrusion"}, {"id": "lv004", "type": "pass_fail", "label": "LV exits within specification and not off-centre"}]}, {"title": "Auxiliary Exits (if applicable)", "items": [{"id": "xx001", "type": "measure", "unit": "mm", "label": "XX A Phase — exit protrusion"}, {"id": "xx002", "type": "measure", "unit": "mm", "label": "XX B Phase — exit protrusion"}, {"id": "xx003", "type": "measure", "unit": "mm", "label": "XX C Phase — exit protrusion"}]}, {"title": "Off-Centre Check", "items": [{"id": "oc001", "type": "pass_fail", "label": "All exits centred — no off-centre exits noted"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  -- --------------------------------------------------------
  -- STAGE 5: DRY-OUT / VACUUM TREATMENT
  -- --------------------------------------------------------

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-VPD-001', 'QF511-A — Pre-Tanking Checklist', s_vpd, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Winding Block Dimensions", "items": [{"id": "wb001", "type": "measure", "unit": "mm", "label": "Shim thickness under core foot"}, {"id": "wb002", "type": "measure", "unit": "mm", "label": "A Phase winding block (common oil ring to common oil ring)"}, {"id": "wb003", "type": "measure", "unit": "mm", "label": "B Phase winding block dimension"}, {"id": "wb004", "type": "measure", "unit": "mm", "label": "C Phase winding block dimension"}]}, {"title": "Yoke Clamp Dimensions", "items": [{"id": "yc001", "type": "measure", "unit": "mm", "label": "Bottom A Phase HV yoke clamp to Top HV yoke clamp"}, {"id": "yc002", "type": "measure", "unit": "mm", "label": "Bottom A Phase LV yoke clamp to Top HV yoke clamp"}, {"id": "yc003", "type": "measure", "unit": "mm", "label": "Bottom C Phase HV yoke clamp to Top HV yoke clamp"}, {"id": "yc004", "type": "measure", "unit": "mm", "label": "Bottom C Phase LV yoke clamp to Top HV yoke clamp"}]}, {"title": "Process Conditions", "items": [{"id": "env001", "type": "text", "label": "Time started"}, {"id": "env002", "type": "measure", "unit": "%", "label": "Humidity at start"}, {"id": "env003", "type": "text", "label": "Time back to VPD or unit tanked"}, {"id": "env004", "type": "measure", "unit": "C", "label": "Core temperature when placed back in VPD or tanked"}]}, {"title": "Pressing Pressures", "items": [{"id": "pp001", "type": "measure", "unit": "kN", "label": "Pressing pressure A Phase"}, {"id": "pp002", "type": "measure", "unit": "kN", "label": "Pressing pressure B Phase"}, {"id": "pp003", "type": "measure", "unit": "kN", "label": "Pressing pressure C Phase"}]}, {"title": "Mechanical Checks", "items": [{"id": "mc001", "type": "pass_fail", "label": "All bolts torqued and marked"}, {"id": "mc002", "type": "pass_fail", "label": "Phase barriers correctly installed and secured"}, {"id": "mc003", "type": "pass_fail", "label": "Earthing straps correctly installed"}, {"id": "mc004", "type": "pass_fail", "label": "Press frames centralised"}, {"id": "mc005", "type": "pass_fail", "label": "Grove spacers fitted"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  -- --------------------------------------------------------
  -- STAGE 6: OIL FILLING
  -- --------------------------------------------------------

  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-OIL-001', 'QF511-B — Tanking Checklist', s_oil, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Tank Preparation", "items": [{"id": "tp001", "type": "pass_fail", "label": "Tank and tap-changer compartments clean"}, {"id": "tp002", "type": "pass_fail", "label": "Tank inside paint surface condition acceptable"}, {"id": "tp003", "type": "pass_fail", "label": "Fiber insulation fitted inside tank"}, {"id": "tp004", "type": "pass_fail", "label": "Gasket surface checked — no damage or oxidation"}, {"id": "tp005", "type": "pass_fail", "label": "No damage or oxidation on core"}]}, {"title": "Active Part Installation", "items": [{"id": "ap001", "type": "pass_fail", "label": "Active part located in guide blocks"}, {"id": "ap002", "type": "pass_fail", "label": "Active part secured to tanking brackets"}, {"id": "ap003", "type": "pass_fail", "label": "Active part clean — no debris"}, {"id": "ap004", "type": "measure", "unit": "mm", "label": "Active part clearance to tank wall (including studs)"}, {"id": "ap005", "type": "pass_fail", "label": "Megger test completed and acceptable"}]}, {"title": "Connections and Hardware", "items": [{"id": "cn001", "type": "pass_fail", "label": "Tapping leads connected, torqued and taped"}, {"id": "cn002", "type": "measure", "unit": "mm", "label": "Tapping leads to tank clearance"}, {"id": "cn003", "type": "pass_fail", "label": "Bushing centred in corona shield"}, {"id": "cn004", "type": "pass_fail", "label": "Earthing link to tank correctly secured"}, {"id": "cn005", "type": "pass_fail", "label": "CT properly secured"}, {"id": "cn006", "type": "pass_fail", "label": "Fiber optic correctly installed and neatly secured"}, {"id": "cn007", "type": "pass_fail", "label": "Crimp connections correctly crimped"}, {"id": "cn008", "type": "pass_fail", "label": "Shunt insulation fitted"}]}, {"title": "Cover and Fittings", "items": [{"id": "cv001", "type": "pass_fail", "label": "Main cover correctly aligned with tank"}, {"id": "cv002", "type": "pass_fail", "label": "Pipe and fittings correctly fitted to main cover and tank"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  -- --------------------------------------------------------
  -- STAGE 8: FINAL QA INSPECTION
  -- --------------------------------------------------------

  -- All families except Auto-transformer
  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-FQA-001', 'QF315 — Clean Condition and Torque Check Register', s_fqa, null, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Off-Circuit Link Board", "items": [{"id": "oc001", "type": "pass_fail", "label": "Off-circuit link board torqued (M12 x 2)"}]}, {"title": "HV Bushing Connections", "items": [{"id": "hv001", "type": "pass_fail", "label": "HV bushing A phase — torqued and checked"}, {"id": "hv002", "type": "pass_fail", "label": "HV bushing B phase — torqued and checked"}, {"id": "hv003", "type": "pass_fail", "label": "HV bushing C phase — torqued and checked"}, {"id": "hv004", "type": "pass_fail", "label": "HV YN torqued"}]}, {"title": "LV Bushing Connections", "items": [{"id": "lv001", "type": "pass_fail", "label": "LV1 a phase bushing physically checked"}, {"id": "lv002", "type": "pass_fail", "label": "LV1 b phase bushing physically checked"}, {"id": "lv003", "type": "pass_fail", "label": "LV1 c phase bushing physically checked"}, {"id": "lv004", "type": "pass_fail", "label": "LV2 a phase bushing physically checked"}, {"id": "lv005", "type": "pass_fail", "label": "LV2 b phase bushing physically checked"}, {"id": "lv006", "type": "pass_fail", "label": "LV2 c phase bushing physically checked"}, {"id": "lv007", "type": "pass_fail", "label": "LV1 yn torqued"}, {"id": "lv008", "type": "pass_fail", "label": "LV2 yn torqued"}]}, {"title": "CT Wiring and Links", "items": [{"id": "ct001", "type": "pass_fail", "label": "CT secondary terminal wiring (M4 brass) — physical check (no torque setting)"}, {"id": "lt001", "type": "pass_fail", "label": "Links and tapping terminals — physical check (non-ferrous, no torque setting)"}, {"id": "lt002", "type": "pass_fail", "label": "Blocks checked for tightness"}]}, {"title": "Clean Condition", "items": [{"id": "cc001", "type": "text", "label": "Site name"}, {"id": "cc002", "type": "text", "label": "Sign-in time"}, {"id": "cc003", "type": "text", "label": "Sign-out time"}, {"id": "cc004", "type": "pass_fail", "label": "Clean condition maintained throughout inspection"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  -- Auto-transformer variant (family_id 3 = Auto-transformer)
  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-FQA-002', 'QF319 — Internal Inspection (Auto-Transformers)', s_fqa, 3, 2, 'hold', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Off-Circuit Link Board", "items": [{"id": "oc001", "type": "pass_fail", "label": "Off-circuit link board torqued (M12 x 2)"}]}, {"title": "HV Side 220kV", "items": [{"id": "hv001", "type": "pass_fail", "label": "HV Side (220kV) A phase bushing torqued and checked"}, {"id": "hv002", "type": "pass_fail", "label": "HV Side (220kV) B phase bushing torqued and checked"}, {"id": "hv003", "type": "pass_fail", "label": "HV Side (220kV) C phase bushing torqued and checked"}, {"id": "hv004", "type": "pass_fail", "label": "HV YN torqued"}]}, {"title": "MV Side 132kV", "items": [{"id": "mv001", "type": "pass_fail", "label": "MV Side (132kV) a phase bushing checked"}, {"id": "mv002", "type": "pass_fail", "label": "MV Side (132kV) b phase checked"}, {"id": "mv003", "type": "pass_fail", "label": "MV Side (132kV) c phase checked"}]}, {"title": "TV Side 22kV", "items": [{"id": "tv001", "type": "pass_fail", "label": "TV Side (22kV) a phase bushing checked"}, {"id": "tv002", "type": "pass_fail", "label": "TV Side (22kV) b phase checked"}, {"id": "tv003", "type": "pass_fail", "label": "TV Side (22kV) c phase checked"}]}, {"title": "CT Wiring and Links", "items": [{"id": "ct001", "type": "pass_fail", "label": "CT secondary terminal wiring (M4 brass) — physical check (no torque setting)"}, {"id": "ct002", "type": "pass_fail", "label": "Links and tapping terminals — physical check (non-ferrous)"}, {"id": "ct003", "type": "pass_fail", "label": "Blocks checked for tightness"}]}, {"title": "Clean Condition", "items": [{"id": "cc001", "type": "text", "label": "Site name"}, {"id": "cc002", "type": "text", "label": "Sign-in time"}, {"id": "cc003", "type": "text", "label": "Sign-out time"}, {"id": "cc004", "type": "pass_fail", "label": "Clean condition maintained throughout inspection"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  -- Punch list (all families, record mode)
  INSERT INTO inspection_templates (code, name, stage_id, family_id, min_competency, fail_mode, created_by)
  VALUES ('IT-FQA-003', 'QF154 — Punch List', s_fqa, null, 2, 'record', v_user)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO t;
  INSERT INTO template_revisions (template_id, rev, status, definition, created_by, effective_from)
  VALUES (t, 1, 'published', '{"sections": [{"title": "Punch List Items", "items": [{"id": "pl001", "type": "pass_fail", "label": "All outstanding punch list items corrected and signed off"}, {"id": "pl002", "type": "text", "label": "Minor defects observed (count and description)"}, {"id": "pl003", "type": "text", "label": "Major defects observed (count and description)"}, {"id": "pl004", "type": "pass_fail", "label": "Paper damage items corrected"}, {"id": "pl005", "type": "pass_fail", "label": "Clearance issues corrected"}, {"id": "pl006", "type": "pass_fail", "label": "Alignment issues corrected or accepted by QC"}, {"id": "pl007", "type": "text", "label": "Department responsible"}, {"id": "pl008", "type": "text", "label": "Requested by"}, {"id": "pl009", "type": "pass_fail", "label": "Correction sign-off obtained"}]}]}', v_user, v_date)
  ON CONFLICT (template_id, rev) DO UPDATE SET definition = EXCLUDED.definition, status = EXCLUDED.status;

  RAISE NOTICE 'APT templates done: 20 templates across 7 stages.';
END $$;

-- ============================================================
-- REQUIREMENTS MATRIX
-- family_id + stage_id is unique; upsert to handle re-runs.
-- Supplementary templates (IT-CCA-001..005, IT-TNK-002..003,
-- IT-WND-002..003, IT-INC-002..003, IT-FQA-003) are published
-- and available for ad-hoc use but not assigned in the matrix.
-- ============================================================
WITH
  fam AS (SELECT id, name FROM product_families),
  stg AS (SELECT id, name FROM manufacturing_stages),
  tpl AS (SELECT id, code FROM inspection_templates),
  mx (fname, sname, tcode, lvl, samp) AS (VALUES
    -- Generator Step-Up
    ('Generator Step-Up',  'Incoming Inspection',        'IT-INC-001', 'required', 'per_delivery'),
    ('Generator Step-Up',  'Core & Coil Assembly',       'IT-CCA-006', 'hold',     'full'),
    ('Generator Step-Up',  'Tank Fabrication',           'IT-TNK-001', 'required', 'full'),
    ('Generator Step-Up',  'Winding',                    'IT-WND-001', 'required', 'full'),
    ('Generator Step-Up',  'Dry-out / Vacuum Treatment', 'IT-VPD-001', 'hold',     'full'),
    ('Generator Step-Up',  'Oil Filling',                'IT-OIL-001', 'hold',     'full'),
    ('Generator Step-Up',  'Final QA Inspection',        'IT-FQA-001', 'hold',     'full'),
    -- Grid / Transmission
    ('Grid / Transmission', 'Incoming Inspection',        'IT-INC-001', 'required', 'per_delivery'),
    ('Grid / Transmission', 'Core & Coil Assembly',       'IT-CCA-006', 'hold',     'full'),
    ('Grid / Transmission', 'Tank Fabrication',           'IT-TNK-001', 'required', 'full'),
    ('Grid / Transmission', 'Winding',                    'IT-WND-001', 'required', 'full'),
    ('Grid / Transmission', 'Dry-out / Vacuum Treatment', 'IT-VPD-001', 'hold',     'full'),
    ('Grid / Transmission', 'Oil Filling',                'IT-OIL-001', 'hold',     'full'),
    ('Grid / Transmission', 'Final QA Inspection',        'IT-FQA-001', 'hold',     'full'),
    -- Auto-transformer (FQA uses auto-transformer-specific template)
    ('Auto-transformer',    'Incoming Inspection',        'IT-INC-001', 'required', 'per_delivery'),
    ('Auto-transformer',    'Core & Coil Assembly',       'IT-CCA-006', 'hold',     'full'),
    ('Auto-transformer',    'Tank Fabrication',           'IT-TNK-001', 'required', 'full'),
    ('Auto-transformer',    'Winding',                    'IT-WND-001', 'required', 'full'),
    ('Auto-transformer',    'Dry-out / Vacuum Treatment', 'IT-VPD-001', 'hold',     'full'),
    ('Auto-transformer',    'Oil Filling',                'IT-OIL-001', 'hold',     'full'),
    ('Auto-transformer',    'Final QA Inspection',        'IT-FQA-002', 'hold',     'full'),
    -- Distribution (HV)
    ('Distribution (HV)',  'Incoming Inspection',        'IT-INC-001', 'required', 'per_delivery'),
    ('Distribution (HV)',  'Core & Coil Assembly',       'IT-CCA-006', 'hold',     'full'),
    ('Distribution (HV)',  'Tank Fabrication',           'IT-TNK-001', 'required', 'full'),
    ('Distribution (HV)',  'Winding',                    'IT-WND-001', 'required', 'full'),
    ('Distribution (HV)',  'Dry-out / Vacuum Treatment', 'IT-VPD-001', 'hold',     'full'),
    ('Distribution (HV)',  'Oil Filling',                'IT-OIL-001', 'hold',     'full'),
    ('Distribution (HV)',  'Final QA Inspection',        'IT-FQA-001', 'hold',     'full'),
    -- Phase Shifting
    ('Phase Shifting',     'Incoming Inspection',        'IT-INC-001', 'required', 'per_delivery'),
    ('Phase Shifting',     'Core & Coil Assembly',       'IT-CCA-006', 'hold',     'full'),
    ('Phase Shifting',     'Tank Fabrication',           'IT-TNK-001', 'required', 'full'),
    ('Phase Shifting',     'Winding',                    'IT-WND-001', 'required', 'full'),
    ('Phase Shifting',     'Dry-out / Vacuum Treatment', 'IT-VPD-001', 'hold',     'full'),
    ('Phase Shifting',     'Oil Filling',                'IT-OIL-001', 'hold',     'full'),
    ('Phase Shifting',     'Final QA Inspection',        'IT-FQA-001', 'hold',     'full'),
    -- Shunt Reactor
    ('Shunt Reactor',      'Incoming Inspection',        'IT-INC-001', 'required', 'per_delivery'),
    ('Shunt Reactor',      'Core & Coil Assembly',       'IT-CCA-006', 'hold',     'full'),
    ('Shunt Reactor',      'Tank Fabrication',           'IT-TNK-001', 'required', 'full'),
    ('Shunt Reactor',      'Winding',                    'IT-WND-001', 'required', 'full'),
    ('Shunt Reactor',      'Dry-out / Vacuum Treatment', 'IT-VPD-001', 'hold',     'full'),
    ('Shunt Reactor',      'Oil Filling',                'IT-OIL-001', 'hold',     'full'),
    ('Shunt Reactor',      'Final QA Inspection',        'IT-FQA-001', 'hold',     'full'),
    -- Repair & Rewind (no Incoming stage; Tank Fabrication is optional)
    ('Repair & Rewind',    'Core & Coil Assembly',       'IT-CCA-006', 'hold',     'full'),
    ('Repair & Rewind',    'Tank Fabrication',           'IT-TNK-001', 'optional',  'full'),
    ('Repair & Rewind',    'Winding',                    'IT-WND-001', 'required', 'full'),
    ('Repair & Rewind',    'Dry-out / Vacuum Treatment', 'IT-VPD-001', 'hold',     'full'),
    ('Repair & Rewind',    'Oil Filling',                'IT-OIL-001', 'hold',     'full'),
    ('Repair & Rewind',    'Final QA Inspection',        'IT-FQA-001', 'hold',     'full')
  )
INSERT INTO inspection_requirements (family_id, stage_id, template_id, level, sampling, updated_by)
SELECT
  f.id,
  s.id,
  t.id,
  mx.lvl,
  mx.samp,
  '07ed1631-5e8f-43bc-b9bb-f8be4ac34af0'::uuid
FROM mx
JOIN fam f ON f.name = mx.fname
JOIN stg s ON s.name = mx.sname
JOIN tpl t ON t.code = mx.tcode
ON CONFLICT (family_id, stage_id) DO UPDATE SET
  template_id = EXCLUDED.template_id,
  level       = EXCLUDED.level,
  sampling    = EXCLUDED.sampling,
  updated_by  = EXCLUDED.updated_by;
