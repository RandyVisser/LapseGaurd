-- The admin_invites token flow now serves both admin and property-manager
-- invites. `role` is the login role created when the invite is accepted:
-- 'hoa_admin' (default, existing behavior) or 'property_manager'.
alter table admin_invites add column if not exists role text not null default 'hoa_admin';
