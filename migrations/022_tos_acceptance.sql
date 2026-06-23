-- Auditable record of legal acceptances captured at signup:
--   tos_accepted_at / tos_version / tos_accepted_ip — Terms of Service agreement
--   authorized_certified_at — the "I am authorized to enroll this Association" cert
-- Timestamps are server-set (now()) for trustworthiness.
alter table hoas add column if not exists tos_accepted_at timestamptz;
alter table hoas add column if not exists tos_version text;
alter table hoas add column if not exists tos_accepted_ip text;
alter table hoas add column if not exists authorized_certified_at timestamptz;
