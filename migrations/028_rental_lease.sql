-- Subrental Phase 2: lease storage on the rented (parent) unit. The owner
-- uploads a copy of the lease; we AI-parse it to pull the renter name(s), which
-- prefill the linked "{unit}-Rntl" sub-unit. Additive + inert until the flag is on.

alter table units add column if not exists lease_document_url text;
alter table units add column if not exists lease_extracted    jsonb;
alter table units add column if not exists lease_uploaded_at   timestamptz;
