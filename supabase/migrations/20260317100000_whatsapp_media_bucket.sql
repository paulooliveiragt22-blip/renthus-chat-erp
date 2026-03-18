-- Bucket público para upload de mídia enviada pelo painel WhatsApp (imagem, vídeo, áudio, documento).
-- A API /api/whatsapp/upload grava aqui; a URL pública é enviada para a Meta.
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', true)
on conflict (id) do update set public = true;

-- Permite que o service role (e usuários autenticados, se necessário) façam upload.
-- RLS em storage.objects: policy para INSERT e SELECT no bucket whatsapp-media.
drop policy if exists "Service role can upload whatsapp-media" on storage.objects;
create policy "Service role can upload whatsapp-media"
on storage.objects for insert
with check (bucket_id = 'whatsapp-media');

drop policy if exists "Public read whatsapp-media" on storage.objects;
create policy "Public read whatsapp-media"
on storage.objects for select
using (bucket_id = 'whatsapp-media');
