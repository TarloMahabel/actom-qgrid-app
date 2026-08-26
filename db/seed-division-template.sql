-- Starting point for a new division. Copy, rename and edit before first load.
-- Only product families, equipment and the requirements matrix differ between
-- divisions; stages and defect codes come from reference_data.sql.

-- insert into division_profile (code, name, hold_points) values ('XXX','Division name', false)
--   on conflict (id) do update set code=excluded.code, name=excluded.name;

-- insert into product_families (name) values ('...') on conflict (name) do nothing;
