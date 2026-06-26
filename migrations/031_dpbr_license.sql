-- DPBR (Dept. of Business & Professional Regulation) license number, shown in
-- Association Settings alongside the SunBiz corporate details.
alter table hoas add column if not exists dpbr_license_number text;
