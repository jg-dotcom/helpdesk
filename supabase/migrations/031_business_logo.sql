-- JAY-138 — owner-configurable company logo shown in the sidebar brand mark.
-- DRAFT migration — not applied. Review and run manually against Supabase.
--
-- Public bucket (unlike the private `resumes`/`documents` buckets) since the
-- logo is meant to be visible in the app UI via a plain public URL, not a
-- signed one, and carries no sensitive data.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- `logo_url` was already referenced by /api/settings/business's POST handler
-- (JAY-18 era) but the column itself was never created — this finishes that.
alter table business_profiles
  add column if not exists logo_url text;

-- Anyone can read (bucket is public), but only the owning user can
-- write/replace/delete their own logo. Path convention: `${user_id}/...`.
create policy if not exists "Logo owners can upload"
  on storage.objects for insert
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy if not exists "Logo owners can update"
  on storage.objects for update
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy if not exists "Logo owners can delete"
  on storage.objects for delete
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy if not exists "Logos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'logos');
