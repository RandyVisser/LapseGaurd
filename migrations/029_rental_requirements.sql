-- Additional per-association requirements applied when a unit is flagged as
-- rented. Additive + inert until configured in Settings.

alter table hoas add column if not exists lease_required        boolean not null default false;  -- require a copy of the lease
alter table hoas add column if not exists lease_min_term_days   integer;                          -- minimum lease term (days)
alter table hoas add column if not exists ho4_required          boolean not null default false;  -- require the renter to carry an HO-4
