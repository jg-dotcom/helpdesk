-- JAY-133 — resume upload on the public careers apply form. DRAFT
-- migration — not applied. Review and run manually against Supabase.
--
-- Private bucket (not public) — resumes are only ever accessed via a
-- server-generated signed URL (see GET /api/applications/[id]/resume),
-- gated on the requesting owner actually owning the application. No
-- storage RLS policy is required for that flow since it goes through the
-- service role; this migration only needs to create the bucket + columns.

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

alter table job_applications
  add column if not exists resume_path text,
  add column if not exists resume_file_name text;
