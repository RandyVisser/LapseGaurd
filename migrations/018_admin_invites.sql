-- Single-use admin setup tokens. Mirrors unit_invites: the Invite-admin action
-- creates a token and emails a /admin-setup/<token> link; the admin's login is
-- created only when they submit the set-password form (so opening the link is
-- safe to prefetch — no Supabase OTP to consume).
create table if not exists admin_invites (
  id uuid primary key default gen_random_uuid(),
  hoa_id uuid not null references hoas(id) on delete cascade,
  email text not null,
  token text not null unique,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_invites_token_idx on admin_invites (token);
