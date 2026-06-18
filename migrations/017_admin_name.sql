-- Store the admin's name captured at signup so welcome / invite emails can
-- greet them by name (previously only admin_email was kept on the association).
alter table hoas add column if not exists admin_name text;
