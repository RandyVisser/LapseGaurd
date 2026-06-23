-- When an Admin/PM row is deleted, their login is revoked but the admin_invites
-- record is kept for audit (email + ToS acceptance). revoked_at records when
-- access was removed.
alter table admin_invites add column if not exists revoked_at timestamptz;
