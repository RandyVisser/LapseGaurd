-- Storage RLS policies for the two app buckets, captured here as the source of
-- truth (they otherwise live only in the Supabase dashboard, which makes them
-- invisible and easy to get wrong — a missing SELECT policy silently broke all
-- uploads because upload({ upsert: true }) runs as INSERT ... ON CONFLICT DO
-- UPDATE and needs INSERT + UPDATE + SELECT to all pass).
--
-- Buckets:
--   policy-documents  — tenant/admin dec-page uploads ({unit_id}/{ts}.{ext})
--   hoa-documents     — admin shared HOA docs        ({hoa_id}/{ts}.{ext})
--
-- Model: any logged-in user (auth.uid() present) may read/write objects in
-- these buckets. Writes are gated to authenticated users; public READ still
-- works through the buckets' public URLs (that path does not go through RLS).
-- Re-runnable: drops the managed policies by name first, then recreates them.

-- ── Clean up every policy name this project has used on storage.objects ──
-- Canonical (current) names
drop policy if exists "policy-docs upload" on storage.objects;
drop policy if exists "policy-docs read"   on storage.objects;
drop policy if exists "policy-docs modify" on storage.objects;
drop policy if exists "hoa-docs upload"    on storage.objects;
drop policy if exists "hoa-docs read"      on storage.objects;
drop policy if exists "hoa-docs modify"    on storage.objects;
-- Legacy / superseded names (safe no-ops if already gone)
drop policy if exists "tenants_upload_own_policy"     on storage.objects;
drop policy if exists "admins_upload_hoa_documents"   on storage.objects;
drop policy if exists "policy-docs authenticated insert" on storage.objects;
drop policy if exists "policy-docs authenticated update" on storage.objects;
drop policy if exists "hoa-docs authenticated insert"    on storage.objects;
drop policy if exists "hoa-docs authenticated update"    on storage.objects;
-- Wide-open diagnostics that must never ship
drop policy if exists "policy-docs OPEN TEST"   on storage.objects;
drop policy if exists "policy-docs OPEN SELECT" on storage.objects;
drop policy if exists "policy-docs OPEN UPDATE" on storage.objects;

-- ── policy-documents: INSERT + SELECT + UPDATE for logged-in users ──
create policy "policy-docs upload" on storage.objects for insert to public
  with check (bucket_id = 'policy-documents' and auth.uid() is not null);
create policy "policy-docs read" on storage.objects for select to public
  using (bucket_id = 'policy-documents' and auth.uid() is not null);
create policy "policy-docs modify" on storage.objects for update to public
  using      (bucket_id = 'policy-documents' and auth.uid() is not null)
  with check (bucket_id = 'policy-documents' and auth.uid() is not null);

-- ── hoa-documents: INSERT + SELECT + UPDATE for logged-in users ──
create policy "hoa-docs upload" on storage.objects for insert to public
  with check (bucket_id = 'hoa-documents' and auth.uid() is not null);
create policy "hoa-docs read" on storage.objects for select to public
  using (bucket_id = 'hoa-documents' and auth.uid() is not null);
create policy "hoa-docs modify" on storage.objects for update to public
  using      (bucket_id = 'hoa-documents' and auth.uid() is not null)
  with check (bucket_id = 'hoa-documents' and auth.uid() is not null);
