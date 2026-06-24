-- Subrental support (Phase 1: data model). Additive + inert until the rentals
-- feature flag is turned on. No effect on existing associations.
--
-- A rented unit (e.g. "3A") is flagged is_rental=true and spawns a linked
-- sub-unit ("3A-Rntl", parent_unit_id -> 3A) that holds the renter + their HO-4.
-- Sub-units are EXCLUDED from unit_count / billing / board counts (same physical
-- unit; the owner already pays for 3A).

alter table units add column if not exists is_rental      boolean not null default false;
alter table units add column if not exists parent_unit_id uuid references units(id) on delete cascade;
create index if not exists units_parent_unit_idx on units(parent_unit_id);

-- Renter requirements, set per-association in Settings.
alter table hoas add column if not exists ho4_liability_min          integer;  -- min HO-4 liability for subrented units
alter table hoas add column if not exists rental_endorsement_required boolean not null default true;  -- owner HO-6 must carry a rental endorsement
