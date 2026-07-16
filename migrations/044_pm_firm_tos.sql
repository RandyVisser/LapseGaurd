-- ToS acceptance for self-serve firm signups (POST /onboard/firm), mirroring
-- the hoas columns from 022. Acceptance was required but unrecorded between
-- the firm-signup launch (2026-07-14) and this migration — firms created in
-- that window legitimately have NULLs here; do not backfill fabricated stamps.
alter table pm_firms add column if not exists tos_accepted_at timestamptz;
alter table pm_firms add column if not exists tos_version text;
alter table pm_firms add column if not exists tos_accepted_ip text;
