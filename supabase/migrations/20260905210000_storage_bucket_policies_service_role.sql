-- Storage: upload/delete só service_role. Leitura pública permanece
-- (URL pública enviada à Meta / cardápio). Limites alinhados a lib/security/uploadGuards.ts.
-- Docs: Supabase Storage RLS (Context7 /websites/supabase) — INSERT precisa WITH CHECK
-- explícito; policy só com bucket_id = X e roles {public} = qualquer um com anon key sobe arquivo.

drop policy if exists "Service role can upload whatsapp-media" on storage.objects;
drop policy if exists "Authenticated users can upload product images" on storage.objects;
drop policy if exists "Authenticated users can delete product images" on storage.objects;

drop policy if exists whatsapp_media_service_insert on storage.objects;
create policy whatsapp_media_service_insert
  on storage.objects for insert to public
  with check (bucket_id = 'whatsapp-media' and auth.role() = 'service_role');

drop policy if exists whatsapp_media_service_update on storage.objects;
create policy whatsapp_media_service_update
  on storage.objects for update to public
  using (bucket_id = 'whatsapp-media' and auth.role() = 'service_role')
  with check (bucket_id = 'whatsapp-media' and auth.role() = 'service_role');

drop policy if exists whatsapp_media_service_delete on storage.objects;
create policy whatsapp_media_service_delete
  on storage.objects for delete to public
  using (bucket_id = 'whatsapp-media' and auth.role() = 'service_role');

update storage.buckets
   set file_size_limit = 16777216,
       allowed_mime_types = array[
         'image/jpeg',
         'image/png',
         'image/webp',
         'image/gif',
         'video/mp4',
         'audio/mpeg',
         'audio/mp4',
         'audio/ogg',
         'audio/webm',
         'application/pdf'
       ]
 where id = 'whatsapp-media';
