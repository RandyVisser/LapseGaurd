-- Lightweight, privacy-preserving funnel analytics. No PII: just an event name,
-- the page path, and a client-generated random session id (to count unique-ish
-- visitors). Powers the super-user signup-funnel card on /admin/feedback.
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  path        text,
  session_id  text,
  created_at  timestamptz not null default now()
);
create index if not exists events_name_created_idx on events (name, created_at desc);
