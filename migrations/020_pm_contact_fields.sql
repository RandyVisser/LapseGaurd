-- Extra contact fields captured when designating a Property Manager:
--   management_firm — the PM's management company
--   phone           — contact phone number
-- Both live on the units row (PMs are stored as unit-less 'Property Manager' rows).
alter table units add column if not exists management_firm text;
alter table units add column if not exists phone text;
