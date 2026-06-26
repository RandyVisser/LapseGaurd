-- Property-manager licensing details (CAM manager license + CAB firm license),
-- visible/editable to super-users only. Stored as JSON on the PM's units row:
--   { cam_number, cam_address, cam_city, cam_state, cam_zip,
--     cab_number, cab_address, cab_city, cab_state, cab_zip }
alter table units add column if not exists pm_license jsonb;
