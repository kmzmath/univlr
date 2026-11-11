-- UNIVLR - apagar a conta nao apaga mais as respostas dos outros
--
-- Ate aqui `comments.author_id` era `on delete cascade` e `parent_id` tambem.
-- Quem apagava a conta levava os proprios comentarios, e o cascade do
-- `parent_id` levava junto toda resposta de outras pessoas pendurada neles, com
-- os votos e as denuncias dessas respostas (auditoria de 11/11/2026, item A4).
--
-- Decisao do dono em 11/11/2026 (opcao 1): no lugar do comentario de quem saiu
-- fica "Comentario removido.", com as respostas embaixo, como ja acontece
-- quando alguem apaga um comentario isolado (`delete_comment`). Assim:
--
-- - comentario da conta SEM resposta de ninguem embaixo: sai de verdade, como
--   antes ("leva os proprios comentarios");
-- - comentario da conta COM resposta embaixo: vira o mesmo soft delete do
--   `delete_comment` (texto vazio, `deleted_at`), e o autor fica nulo.
--
-- Vale para os dois caminhos de exclusao: o `delete_account()` do site e a
-- exclusao do usuario pelo painel do Supabase, porque a regra mora num gatilho
-- em `profiles`, que o cascade de `auth.users` sempre atravessa.
--
-- A tela ja desenha isso: comentario com `deleted_at` mostra "Comentario
-- removido." e a silhueta neutra, sem ler o autor.

-- ------------------------------------------------- autor pode ficar nulo

alter table public.comments alter column author_id drop not null;

-- Mesmo nome de antes: o front pede o autor com
-- `profiles!comments_author_id_fkey(...)`, e o PostgREST acha a relacao por ele.
alter table public.comments drop constraint comments_author_id_fkey;
alter table public.comments add constraint comments_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;

-- Autor nulo so em comentario apagado: nao existe comentario vivo sem dono.
alter table public.comments add constraint comments_autor_ou_apagado
  check (author_id is not null or deleted_at is not null);

-- ------------------------------------------------- gatilho da exclusao

create or replace function public.comentarios_da_conta_apagada()
returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  -- 1. Sai de verdade todo comentario da conta que nao tem resposta embaixo.
  --    Em laco: apagar a ultima resposta dela numa conversa so com ela deixa o
  --    comentario de cima sem filhos, e ele sai na volta seguinte. Como cada
  --    volta so apaga folha, o cascade do `parent_id` nao leva nada de ninguem.
  loop
    delete from public.comments c
     where c.author_id = old.id
       and not exists (select 1 from public.comments f where f.parent_id = c.id);
    exit when not found;
  end loop;

  -- 2. O que sobrou tem resposta de outra pessoa embaixo: fica como
  --    "Comentario removido.", sem o texto. O autor vira nulo logo depois, pela
  --    chave estrangeira, quando a linha de `profiles` sair.
  update public.comments
     set body = '', deleted_at = coalesce(deleted_at, now())
   where author_id = old.id;

  return old;
end;
$fn$;

revoke execute on function public.comentarios_da_conta_apagada() from public;

create trigger antes_de_apagar_perfil
  before delete on public.profiles
  for each row execute function public.comentarios_da_conta_apagada();
