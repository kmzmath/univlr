-- UNIVLR - controle positivo das permissoes
--
-- >>> RODE SO EM PROJETO DE DESENVOLVIMENTO. <<< Faz rollback no fim.
--
-- Par obrigatorio do `rls_test.sql`. Aquele prova que o ataque falha; este
-- prova que o uso legitimo passa. Os dois juntos, e so juntos, dizem que a
-- permissao esta CERTA em vez de apenas FECHADA.
--
-- O exemplo concreto: `update profiles set role='admin'` e recusado com
-- "permission denied for table profiles". A mesma mensagem apareceria se o
-- grant de `bio` estivesse quebrado e o usuario nao pudesse editar nada. Sem
-- o caso 2 daqui, aquele teste passaria por permissao quebrada, e ninguem
-- perceberia ate um usuario reclamar que nao consegue salvar a bio.
begin;

create temp table _p (ordem serial, caso text, esperado text, obtido text) on commit drop;
grant all on _p to authenticated;
grant usage on sequence _p_ordem_seq to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@teste.univlr', '', now(), now(), now(),
   '{"username":"alice_teste"}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bruno@teste.univlr', '', now(), now(), now(),
   '{"username":"bruno_teste"}');

do $p$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  bruno uuid := '22222222-2222-2222-2222-222222222222';
  c_alice uuid; c_resp uuid; c_men uuid;
  n int; t text;
begin
  -- A trigger de cadastro criou os dois perfis?
  select count(*) into n from public.profiles where id in (alice, bruno);
  insert into _p (caso, esperado, obtido) values ('trigger cria perfil no signup', '2', n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', alice)::text, true);
  set local role authenticated;

  -- CONTROLE POSITIVO do grant por coluna: bio TEM de funcionar. Se falhasse,
  -- os testes "virar admin" e "se desbanir" estariam passando por permissao
  -- quebrada, nao por seguranca.
  begin
    update public.profiles set bio = 'bio da alice' where id = alice;
    select bio into t from public.profiles where id = alice;
    insert into _p (caso, esperado, obtido) values ('editar a propria bio', 'bio da alice', coalesce(t, 'NULO'));
  exception when others then
    insert into _p (caso, esperado, obtido) values ('editar a propria bio', 'bio da alice', 'ERRO: ' || SQLERRM);
  end;

  -- Editar a bio de OUTRO nao pode passar (mesma coluna, linha errada).
  begin
    update public.profiles set bio = 'invadido' where id = bruno;
    select bio into t from public.profiles where id = bruno;
    insert into _p (caso, esperado, obtido) values ('editar bio alheia', 'nao muda', coalesce(t, 'nao muda'));
  exception when others then
    insert into _p (caso, esperado, obtido) values ('editar bio alheia', 'nao muda', 'bloqueado');
  end;

  -- Perfil alheio e publico para leitura.
  select count(*) into n from public.profiles where id = bruno;
  insert into _p (caso, esperado, obtido) values ('ler perfil alheio', '1', n::text);

  c_alice := public.post_comment('match', 'partida-pos', 'comentario raiz da alice');

  -- Cartinhas (0007): a conversa da colecao e a de uma cartinha.
  begin
    perform public.post_comment('card', '2026', 'comentario na colecao');
    perform public.post_comment('card', '2026:puuid-de_teste123', 'comentario na cartinha');
    select count(*) into n from public.threads
     where subject_kind = 'card' and subject_id in ('2026', '2026:puuid-de_teste123');
    insert into _p (caso, esperado, obtido) values ('comentar nas cartinhas', '2', n::text);
  exception when others then
    insert into _p (caso, esperado, obtido) values ('comentar nas cartinhas', '2', 'ERRO: ' || SQLERRM);
  end;

  -- Editar o proprio, dentro dos 15 min.
  begin
    perform public.edit_comment(c_alice, 'texto editado pela alice');
    select body into t from public.comments where id = c_alice;
    insert into _p (caso, esperado, obtido) values ('editar comentario proprio', 'texto editado pela alice', t);
  exception when others then
    insert into _p (caso, esperado, obtido) values ('editar comentario proprio', 'texto editado', 'ERRO: ' || SQLERRM);
  end;

  select edited_at is not null into t from public.comments where id = c_alice;
  insert into _p (caso, esperado, obtido) values ('marca edited_at', 'true', t);

  -- Bruno responde: a Alice tem de receber aviso de resposta.
  perform set_config('request.jwt.claims', json_build_object('sub', bruno)::text, true);
  c_resp := public.post_comment('match', 'partida-pos', 'resposta do bruno', c_alice);
  reset role;
  select count(*) into n from public.notifications
   where user_id = alice and kind = 'reply' and comment_id = c_resp;
  set local role authenticated;
  insert into _p (caso, esperado, obtido) values ('aviso de resposta', '1', n::text);

  -- Mencao a um terceiro (a alice), num comentario sem parent.
  c_men := public.post_comment('match', 'partida-pos', 'oi @alice_teste, viu isso?');
  reset role;
  select count(*) into n from public.notifications
   where user_id = alice and kind = 'mention' and comment_id = c_men;
  set local role authenticated;
  insert into _p (caso, esperado, obtido) values ('aviso de mencao', '1', n::text);

  -- Mencao a nome que nao existe nao pode criar nada nem estourar.
  begin
    perform public.post_comment('match', 'partida-pos', 'oi @ninguem_aqui');
    insert into _p (caso, esperado, obtido) values ('mencao a nome inexistente', 'ignora', 'ignora');
  exception when others then
    insert into _p (caso, esperado, obtido) values ('mencao a nome inexistente', 'ignora', 'ERRO: ' || SQLERRM);
  end;

  -- Voto sobe e desce.
  insert into public.comment_votes (comment_id, user_id) values (c_alice, bruno);
  select score into n from public.comments where id = c_alice;
  insert into _p (caso, esperado, obtido) values ('voto soma', '1', n::text);
  delete from public.comment_votes where comment_id = c_alice and user_id = bruno;
  select score into n from public.comments where id = c_alice;
  insert into _p (caso, esperado, obtido) values ('desfazer voto subtrai', '0', n::text);

  -- Ver o proprio voto (a policy de leitura e user_id = auth.uid()).
  insert into public.comment_votes (comment_id, user_id) values (c_alice, bruno);
  select count(*) into n from public.comment_votes where comment_id = c_alice;
  insert into _p (caso, esperado, obtido) values ('ver o proprio voto', '1', n::text);

  -- Favoritar.
  -- Favorito e UM de cada tipo, guardado em coluna de profiles. Escolher outro
  -- troca o atual, e o grant por coluna e quem permite escrever so nele.
  update public.profiles set fav_team = 'uninassau_griffins' where id = bruno;
  select fav_team into t from public.profiles where id = bruno;
  insert into _p (caso, esperado, obtido) values ('virar fa de uma equipe', 'uninassau_griffins', coalesce(t, 'NULO'));

  update public.profiles set fav_team = 'ceub_octopus' where id = bruno;
  select fav_team into t from public.profiles where id = bruno;
  insert into _p (caso, esperado, obtido) values ('trocar de equipe substitui', 'ceub_octopus', coalesce(t, 'NULO'));

  update public.profiles set fav_player = 'algum_jogador' where id = bruno;
  select fav_team into t from public.profiles where id = bruno;
  insert into _p (caso, esperado, obtido) values ('jogador nao mexe na equipe', 'ceub_octopus', coalesce(t, 'NULO'));

  -- E continua sem alcancar as colunas de papel: o grant e por COLUNA.
  begin
    update public.profiles set fav_team = 'x', role = 'admin' where id = bruno;
    insert into _p (caso, esperado, obtido) values ('favorito junto com role', 'bloqueado', 'PASSOU');
  exception when others then
    insert into _p (caso, esperado, obtido) values ('favorito junto com role', 'bloqueado', 'bloqueado');
  end;

  -- Marcar notificacao como lida.
  perform set_config('request.jwt.claims', json_build_object('sub', alice)::text, true);
  update public.notifications set read_at = now() where user_id = alice;
  select count(*) into n from public.notifications where user_id = alice and read_at is not null;
  insert into _p (caso, esperado, obtido) values ('marcar aviso como lido', '2', n::text);

  -- Apagar o proprio, e a resposta pendurada nele continua existindo.
  perform public.delete_comment(c_alice);
  select count(*) into n from public.comments where id = c_resp and deleted_at is null;
  insert into _p (caso, esperado, obtido) values ('resposta sobrevive ao pai apagado', '1', n::text);

  -- Denunciar.
  perform public.post_comment('match', 'partida-pos', 'algo denunciavel');
  insert into public.reports (comment_id, reporter_id, reason)
  values (c_men, alice, 'teste de denuncia');
  insert into _p (caso, esperado, obtido) values ('denunciar comentario', 'ok', 'ok');

  reset role;
end;
$p$;

-- ----------------------------------------------------------- threads livres
-- Contas proprias, para nao esbarrar no limite de comentarios da Alice e do
-- Bruno acima.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'carla@teste.univlr', '', now(), now(), now(),
   '{"username":"carla_teste"}'),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'davi@teste.univlr', '', now(), now(), now(),
   '{"username":"davi_teste"}');

do $topicos$
declare
  carla uuid := '33333333-3333-3333-3333-333333333333';
  davi  uuid := '44444444-4444-4444-4444-444444444444';
  t1 uuid; t2 uuid; c_davi uuid; c_carla uuid; c_resp uuid; c_t2 uuid;
  n int; t text; ts1 timestamptz; ts2 timestamptz;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', carla)::text, true);
  set local role authenticated;

  t1 := public.create_topic('  Quem leva a Univava?  ', '');
  insert into _p (caso, esperado, obtido) values ('abrir thread devolve id', 'sim', case when t1 is not null then 'sim' else 'nao' end);

  select count(*) into n from public.topic_list where id = t1 and respostas = 0
     and author_username = 'carla_teste' and title = 'Quem leva a Univava?' and ultima_atividade = created_at;
  insert into _p (caso, esperado, obtido) values ('thread nova na lista, titulo aparado', '1', n::text);

  select count(*) into n from public.threads where subject_kind = 'topic' and subject_id = t1::text;
  insert into _p (caso, esperado, obtido) values ('thread de conversa criada junto', '1', n::text);

  -- A abertura fica uma hora no passado, para a ultima atividade ter de vir
  -- do comentario e nao da abertura.
  reset role;
  update public.topics set created_at = now() - interval '1 hour' where id = t1;
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', davi)::text, true);
  c_davi := public.post_comment('topic', t1::text, 'eu acho que a Golden');

  select respostas, ultima_atividade into n, ts1 from public.topic_list where id = t1;
  select created_at into ts2 from public.comments where id = c_davi;
  insert into _p (caso, esperado, obtido) values ('comentario conta resposta', '1', coalesce(n::text, 'NULO'));
  insert into _p (caso, esperado, obtido) values ('ultima atividade vem do comentario', 'sim', case when ts1 = ts2 then 'sim' else 'nao' end);

  perform set_config('request.jwt.claims', json_build_object('sub', carla)::text, true);
  select count(*) into n from public.notifications where user_id = carla and kind = 'topic_reply' and comment_id = c_davi;
  insert into _p (caso, esperado, obtido) values ('aviso de comentario na thread', '1', n::text);

  -- Comentar na propria thread nao avisa a si mesma.
  c_carla := public.post_comment('topic', t1::text, 'vamos ver');
  select count(*) into n from public.notifications where comment_id = c_carla;
  insert into _p (caso, esperado, obtido) values ('comentar na propria thread nao avisa', '0', n::text);

  -- Resposta a ela, na thread dela, com mencao: um aviso so.
  perform set_config('request.jwt.claims', json_build_object('sub', davi)::text, true);
  c_resp := public.post_comment('topic', t1::text, 'concordo @carla_teste', c_carla);
  perform set_config('request.jwt.claims', json_build_object('sub', carla)::text, true);
  select count(*) into n from public.notifications where user_id = carla and comment_id = c_resp;
  insert into _p (caso, esperado, obtido) values ('resposta, mencao e thread: um aviso so', '1', n::text);

  -- Editar dentro dos 15 minutos (a janela conta da abertura; volta a abertura
  -- para agora).
  reset role;
  update public.topics set created_at = now() where id = t1;
  set local role authenticated;
  perform public.edit_topic(t1, 'Quem leva a Univava 2026?', 'palpites aqui');
  select title into t from public.topics where id = t1 and edited_at is not null and body = 'palpites aqui';
  insert into _p (caso, esperado, obtido) values ('editar a propria thread', 'Quem leva a Univava 2026?', coalesce(t, 'NULO'));

  -- Invisiveis nas pontas saem, como o espaco comum.
  reset role;
  update public.topics set created_at = now() where id = t1;
  set local role authenticated;
  perform public.edit_topic(t1, U&'\00A0\200B' || E'\t' || 'Titulo com sobra' || U&'\00A0', '');
  select title into t from public.topics where id = t1;
  insert into _p (caso, esperado, obtido) values ('invisiveis nas pontas saem do titulo', 'Titulo com sobra', coalesce(t, 'NULO'));

  -- Apagar: some da lista, titulo e texto vao a vazio.
  perform public.delete_topic(t1);
  select count(*) into n from public.topic_list where id = t1;
  insert into _p (caso, esperado, obtido) values ('thread apagada sai da lista', '0', n::text);
  select count(*) into n from public.topics where id = t1 and title = '' and body = '' and deleted_at is not null;
  insert into _p (caso, esperado, obtido) values ('apagar zera titulo e texto', '1', n::text);

  -- Conta apagada nao leva a thread.
  t2 := public.create_topic('Procurando quinto para a LUCE', '');
  perform set_config('request.jwt.claims', json_build_object('sub', davi)::text, true);
  c_t2 := public.post_comment('topic', t2::text, 'eu topo');
  reset role;
  delete from auth.users where id = carla;
  set local role authenticated;
  select count(*) into n from public.topic_list where id = t2 and author_username is null;
  insert into _p (caso, esperado, obtido) values ('thread fica sem autor quando a conta some', '1', n::text);
  select count(*) into n from public.comments where id = c_t2;
  insert into _p (caso, esperado, obtido) values ('comentario dos outros fica', '1', n::text);

  reset role;
end;
$topicos$;

delete from auth.users where email in ('alice@teste.univlr', 'bruno@teste.univlr', 'carla@teste.univlr', 'davi@teste.univlr');
delete from public.threads where subject_id = 'partida-pos';

select ordem, caso, esperado, obtido,
       case when esperado = obtido then 'ok' else 'DIVERGE' end as veredito
  from _p order by ordem;
rollback;
