-- UNIVLR - favorito unico, e comentario em perfil de jogador e de equipe
--
-- Duas mudancas pedidas depois do ciclo 1:
--
-- 1. Comentario passa a valer tambem em perfil de jogador e de equipe, nao so
--    em partida e evento.
--
-- 2. Favorito vira UM time e UM jogador por pessoa, como na HLTV: escolher
--    outro troca o atual. Por isso a tabela `favorites` morre e vira duas
--    colunas em `profiles`.
--
--    A troca nao e economia de tabela, e modelagem: com "no maximo um", a
--    unicidade fica estrutural em vez de virar regra que alguem precisa
--    fiscalizar. E o favorito passa a chegar no MESMO embed do autor do
--    comentario - sem isso, mostrar o favorito ao lado de cada nome exigiria
--    uma segunda consulta por lista de comentarios.

-- ----------------------------------------------------- 1. threads de perfil

alter table public.threads drop constraint threads_subject_kind_check;
alter table public.threads add constraint threads_subject_kind_check
  check (subject_kind in ('match', 'event', 'article', 'player', 'team'));

-- ------------------------------------------------------- 2. favorito unico

alter table public.profiles
  add column fav_team   text,
  add column fav_player text;

-- Traz o que ja existia. Se alguem tinha mais de um do mesmo tipo (a tabela
-- antiga permitia), fica o primeiro - nao ha criterio melhor, e hoje isso
-- afeta uma linha.
update public.profiles p
   set fav_team   = (select f.ref_id from public.favorites f
                      where f.user_id = p.id and f.kind = 'team'   limit 1),
       fav_player = (select f.ref_id from public.favorites f
                      where f.user_id = p.id and f.kind = 'player' limit 1);

alter table public.profiles
  add constraint fav_team_len   check (fav_team   is null or char_length(fav_team)   between 1 and 64),
  add constraint fav_player_len check (fav_player is null or char_length(fav_player) between 1 and 64);

drop table public.favorites;

-- O grant continua por COLUNA: `role` e `banned_until` seguem fora do alcance
-- de quem esta logado. So a lista permitida cresce.
grant update (bio, fav_team, fav_player) on public.profiles to authenticated;
