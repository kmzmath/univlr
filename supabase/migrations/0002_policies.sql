-- UNIVLR - RLS e grants
--
-- Duas camadas, e as duas precisam liberar para a operacao passar:
--   RLS   decide QUAIS LINHAS o usuario alcanca.
--   GRANT decide QUAIS COLUNAS ele pode escrever.
-- A segunda existe porque RLS e row-level: uma policy `id = auth.uid()` em
-- profiles deixaria a pessoa editar a propria linha inteira, inclusive
-- `role` e `banned_until` - ou seja, se promover a admin e se desbanir.
-- O grant por coluna e o que fecha essa porta.

alter table public.profiles      enable row level security;
alter table public.threads       enable row level security;
alter table public.comments      enable row level security;
alter table public.comment_votes enable row level security;
alter table public.reports       enable row level security;
alter table public.notifications enable row level security;
alter table public.favorites     enable row level security;

-- Fecha tudo primeiro e reabre item a item. Supabase concede grants amplos a
-- anon/authenticated por padrao; sem este revoke, o default venceria.
revoke all on public.profiles      from anon, authenticated;
revoke all on public.threads       from anon, authenticated;
revoke all on public.comments      from anon, authenticated;
revoke all on public.comment_votes from anon, authenticated;
revoke all on public.reports       from anon, authenticated;
revoke all on public.notifications from anon, authenticated;
revoke all on public.favorites     from anon, authenticated;

-- ------------------------------------------------------------------ leitura

grant select on public.profiles      to anon, authenticated;
grant select on public.threads       to anon, authenticated;
grant select on public.comments      to anon, authenticated;
grant select on public.favorites     to anon, authenticated;
grant select on public.comment_votes to authenticated;
grant select on public.notifications to authenticated;
grant select on public.reports       to authenticated;

create policy profiles_read  on public.profiles  for select using (true);
create policy threads_read   on public.threads   for select using (true);
create policy favorites_read on public.favorites for select using (true);

-- Comentario apagado continua legivel como LINHA (a arvore de respostas
-- depende dele), mas post_comment/delete_comment zeram o `body`. O texto some
-- de verdade; so a casca fica, e o front desenha "[removido]".
create policy comments_read on public.comments for select using (true);

-- Voto e privado: cada um enxerga so o proprio. O total publico vem de
-- comments.score, mantido por trigger. Sem isso, daria para montar a lista de
-- quem votou em que - dado que ninguem pediu para publicar.
create policy votes_read on public.comment_votes
  for select using (user_id = auth.uid());

create policy notifications_read on public.notifications
  for select using (user_id = auth.uid());

-- Denuncia so o admin le. O denunciante nao precisa reler a propria denuncia,
-- e expor a lista entregaria quem denunciou quem.
create policy reports_read on public.reports for select using (public.is_admin());

-- ------------------------------------------------------------------ escrita

-- profiles: so a bio, e so a propria linha. username, role e banned_until
-- ficam fora do grant - mudam por RPC ou por admin no painel do Supabase.
grant update (bio) on public.profiles to authenticated;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Voto: a chave primaria (comment_id, user_id) e o que impede votar duas
-- vezes. Nao ha UPDATE - alternar voto e insert ou delete.
grant insert, delete on public.comment_votes to authenticated;
create policy votes_insert_own on public.comment_votes
  for insert with check (user_id = auth.uid() and not public.is_banned());
create policy votes_delete_own on public.comment_votes
  for delete using (user_id = auth.uid());

grant insert, delete on public.favorites to authenticated;
create policy favorites_insert_own on public.favorites
  for insert with check (user_id = auth.uid());
create policy favorites_delete_own on public.favorites
  for delete using (user_id = auth.uid());

-- Denuncia: cria e nunca mais mexe. O unique (comment_id, reporter_id) do
-- schema impede denunciar o mesmo comentario duas vezes.
grant insert on public.reports to authenticated;
create policy reports_insert_own on public.reports
  for insert with check (reporter_id = auth.uid() and not public.is_banned());

-- notifications: so marcar como lida.
grant update (read_at) on public.notifications to authenticated;
create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------ comments
--
-- Nenhum grant de INSERT/UPDATE/DELETE, e nenhuma policy de escrita. Escrever
-- em `comments` pelo PostgREST e impossivel por construcao: post_comment(),
-- edit_comment() e delete_comment() sao o unico caminho (ver 0003).
-- Consequencia pratica: nao existe forjar `author_id`, porque o cliente nunca
-- fornece esse campo.
