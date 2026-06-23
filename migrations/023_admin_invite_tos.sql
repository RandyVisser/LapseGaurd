-- Record ToS acceptance when an invited admin / property manager sets up their
-- account (the /admin-setup/<token> page). Server-set timestamp.
alter table admin_invites add column if not exists tos_accepted_at timestamptz;
alter table admin_invites add column if not exists tos_version text;
alter table admin_invites add column if not exists tos_accepted_ip text;
