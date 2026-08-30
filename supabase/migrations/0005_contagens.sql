-- UNIVLR - contagem de comentarios por assunto
--
-- Problema: as listas do site (partidas, eventos, jogadores, equipes) sao
-- montadas de uma vez em string, sincronamente, a partir do JSON buildado. A
-- contagem vive no Supabase. Perguntar "quantos comentarios tem?" por linha
-- seria uma requisicao por item - 40 requisicoes numa lista de partidas.
--
-- Solucao: uma view que devolve TODAS as contagens de uma vez. O cliente busca
-- uma vez na carga e guarda em memoria; a partir dai a consulta e sincrona e a
-- lista desenha o selo sem esperar rede.
--
-- A tabela e pequena por construcao: uma linha por assunto que alguem
-- comentou, nao por assunto que existe. Milhares de partidas, dezenas de
-- threads.

create or replace view public.thread_counts
with (security_invoker = true) as
select
  t.subject_kind,
  t.subject_id,
  count(c.id)::int as comentarios,
  max(c.created_at) as ultimo_em
from public.threads t
left join public.comments c
       on c.thread_id = t.id
      and c.deleted_at is null
group by t.subject_kind, t.subject_id;

-- `security_invoker = true` importa: sem isso a view roda com os privilegios
-- de quem a criou e ignora a RLS das tabelas de baixo. Aqui daria no mesmo,
-- porque comentario e publico de qualquer jeito - mas uma view que fura RLS
-- por padrao e o tipo de coisa que envelhece mal quando alguem adiciona uma
-- coluna sensivel embaixo.

grant select on public.thread_counts to anon, authenticated;
