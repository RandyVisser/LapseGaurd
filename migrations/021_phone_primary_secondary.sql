-- Owner phone numbers, parallel to email_primary/email_secondary. Reuse the PM
-- `phone` column (migration 020) as phone_primary and add phone_secondary.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='units' and column_name='phone')
     and not exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='units' and column_name='phone_primary') then
    alter table units rename column phone to phone_primary;
  end if;
end $$;
alter table units add column if not exists phone_primary text;
alter table units add column if not exists phone_secondary text;
