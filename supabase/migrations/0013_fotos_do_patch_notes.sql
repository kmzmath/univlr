-- UNIVLR - fotos dos patch notes (16/11/2026)
--
-- O dono pediu para adicionar fotos aos patch notes, escolhendo o Storage do
-- Supabase (opcao A). As fotos ficam numa pasta publica, `patch-notes`: qualquer
-- um ve pelo endereco, so admin envia. O site reduz a foto no navegador antes
-- de enviar (ate 1600px, WebP), entao o limite de 5 MB e so uma rede de
-- seguranca.
--
-- O Storage grava cada arquivo em storage.objects com o papel de quem envia,
-- entao a regra de quem pode mandar foto e a RLS desta tabela. Sem regra de
-- alterar: foto enviada nao e sobrescrita.
--
-- Compativel com o site no ar: nada aqui muda tabela ou funcao do Forum.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patch-notes', 'patch-notes', true, 5242880, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Enviar: so admin, so nesta pasta.
create policy patch_notes_fotos_envia on storage.objects
  for insert to authenticated
  with check (bucket_id = 'patch-notes' and public.is_admin());

-- Ler a lista e apagar: so admin. A foto em si e lida pelo endereco publico,
-- que nao passa por aqui.
create policy patch_notes_fotos_le on storage.objects
  for select to authenticated
  using (bucket_id = 'patch-notes' and public.is_admin());

create policy patch_notes_fotos_apaga on storage.objects
  for delete to authenticated
  using (bucket_id = 'patch-notes' and public.is_admin());
