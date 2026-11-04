-- Imaging: image files live in a PRIVATE storage bucket; the imaging_results row
-- keeps the file's path (patient_id/random-id.ext). Nobody gets a permanent public
-- link: the app asks for a short-lived signed link each time an image is opened.
--
-- Who can do what with the files (enforced by the database, not the browser):
--   upload : radtech only, only into a real patient's folder, only JPG/PNG/WebP
--   view   : physician, nurse, radtech, and the patient the image belongs to
--   delete : the radtech who uploaded it, and only while no imaging result uses it
--   edit   : nobody (no overwrite)

-- 1. imaging_results keeps a storage path instead of a web link.
--    The only row so far is the fake [TEST] chest X-ray I added for testing.
delete from public.imaging_results
where imaging_type = '[TEST] Chest X-ray' and image_url = 'https://example.com/xray.png';

alter table public.imaging_results rename column image_url to image_path;

alter table public.imaging_results
  add constraint imaging_image_path_check check (
    image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and split_part(image_path, '/', 1) = patient_id::text
  ),
  add constraint imaging_image_path_key unique (image_path);

-- 2. The private bucket: 10 MB per file, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imaging', 'imaging', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3. Access rules for the files.
create policy imaging_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imaging'
    and private.has_any_role(array['radtech'])
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and exists (select 1 from public.patients p where p.patient_id::text = (storage.foldername(name))[1])
  );

create policy imaging_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'imaging'
    and (
      private.has_any_role(array['physician', 'nurse', 'radtech'])
      or (storage.foldername(name))[1] = private.my_patient_id()::text
    )
  );

create policy imaging_files_delete_unused on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'imaging'
    and private.has_any_role(array['radtech'])
    and owner_id = (select auth.uid())::text
    and not exists (select 1 from public.imaging_results r where r.image_path = name)
  );
