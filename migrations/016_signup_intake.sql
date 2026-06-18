-- Extra intake captured on the association signup form (Signup.jsx):
--   unit_count       — self-reported number of units in the association
--   has_owner_emails — whether the manager already has unit-owner email addresses
-- Both are nullable (older associations predate these questions).
alter table hoas add column if not exists unit_count integer;
alter table hoas add column if not exists has_owner_emails boolean;
