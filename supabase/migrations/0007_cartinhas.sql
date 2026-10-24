-- UNIVLR - comentarios nas cartinhas
--
-- A pagina /cartas/ ganha conversa em dois niveis, os dois no tipo `card`:
--
--   subject_id = '2026'          a colecao da temporada inteira
--   subject_id = '2026:<puuid>'  a cartinha daquele jogador
--
-- O puuid, e nao a posicao na colecao: a posicao pode mudar se os overalls
-- forem recalculados depois dos ultimos jogos, e o jogador nao muda. O
-- manifesto da pagina so traz o puuid de quem ja foi revelado.
--
-- O formato e conferido aqui, e nao so no navegador. post_comment() cria a
-- thread com o subject_id que receber; sem esta checagem, qualquer texto
-- viraria uma conversa de cartinha e apareceria na atividade recente.

alter table public.threads drop constraint threads_subject_kind_check;
alter table public.threads add constraint threads_subject_kind_check
  check (subject_kind in ('match', 'event', 'article', 'player', 'team', 'card'));

alter table public.threads add constraint threads_card_subject_format
  check (subject_kind <> 'card' or subject_id ~ '^[0-9]{4}(:[A-Za-z0-9_-]{1,100})?$');
