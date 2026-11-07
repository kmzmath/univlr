-- UNIVLR - teste das policies de seguranca
--
-- >>> RODE SO EM PROJETO DE DESENVOLVIMENTO. <<<
-- O script cria dois usuarios em auth.users e apaga tudo no fim.
--
-- O que ele prova: que cada ataque falha NO BANCO. Um teste que passa porque o
-- botao esta escondido na interface nao vale nada - a chave `anon` esta no
-- navegador de todo mundo e qualquer pessoa pode chamar a API na mao.
--
-- Como rodar: cole inteiro no SQL Editor do Supabase e execute. A ultima
-- consulta devolve uma tabela de resultados; TUDO precisa estar como 'ok'.

begin;

create temp table _r (ordem serial, teste text, esperado text, resultado text) on commit drop;

-- O corpo do teste roda com `set local role authenticated` (senao a RLS nem
-- entraria em jogo, ja que `postgres` tem bypassrls). Esse papel tambem
-- precisa alcancar a tabela de resultados e a sequencia do `serial`.
grant all on _r to authenticated;
grant usage on sequence _r_ordem_seq to authenticated;

-- ------------------------------------------------------------------ arranjo

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'alice@teste.univlr', '', now(), now(), now(),
   '{"username":"alice_teste"}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'bruno@teste.univlr', '', now(), now(), now(),
   '{"username":"bruno_teste"}');

do $teste$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  bruno uuid := '22222222-2222-2222-2222-222222222222';
  c_alice uuid;
  n int;
  restricao text;
begin
  -- Alice publica um comentario legitimo. Isto roda como superusuario ainda,
  -- mas via RPC, que e o caminho real.
  perform set_config('request.jwt.claims', json_build_object('sub', alice)::text, true);
  set local role authenticated;

  c_alice := public.post_comment('match', 'partida-de-teste', 'comentario da alice');
  insert into _r (teste, esperado, resultado)
  values ('alice publica pela RPC', 'ok', case when c_alice is not null then 'ok' else 'FALHOU' end);

  -- ATAQUE 1 - escrever direto na tabela, forjando autoria.
  -- Deve morrer no grant: `comments` nao tem INSERT para authenticated.
  begin
    insert into public.comments (thread_id, author_id, body)
    select thread_id, bruno, 'forjado' from public.comments where id = c_alice;
    insert into _r (teste, esperado, resultado)
    values ('insert direto em comments', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('insert direto em comments', 'bloqueado', 'ok');
  end;

  -- ATAQUE 2 - Bruno tenta editar o comentario da Alice.
  perform set_config('request.jwt.claims', json_build_object('sub', bruno)::text, true);
  begin
    perform public.edit_comment(c_alice, 'texto trocado pelo bruno');
    insert into _r (teste, esperado, resultado)
    values ('bruno edita comentario da alice', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('bruno edita comentario da alice', 'bloqueado', 'ok');
  end;

  -- ATAQUE 3 - Bruno tenta apagar o comentario da Alice.
  begin
    perform public.delete_comment(c_alice);
    insert into _r (teste, esperado, resultado)
    values ('bruno apaga comentario da alice', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('bruno apaga comentario da alice', 'bloqueado', 'ok');
  end;

  -- ATAQUE 4 - votar duas vezes no mesmo comentario.
  insert into public.comment_votes (comment_id, user_id) values (c_alice, bruno);
  begin
    insert into public.comment_votes (comment_id, user_id) values (c_alice, bruno);
    insert into _r (teste, esperado, resultado)
    values ('votar duas vezes', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('votar duas vezes', 'bloqueado', 'ok');
  end;

  -- O score precisa ter subido para 1 pela trigger, nao por contagem no front.
  select score into n from public.comments where id = c_alice;
  insert into _r (teste, esperado, resultado)
  values ('trigger de score', '1', case when n = 1 then 'ok' else 'FALHOU - score=' || n end);

  -- ATAQUE 5 - votar no lugar de outra pessoa.
  begin
    insert into public.comment_votes (comment_id, user_id) values (c_alice, alice);
    insert into _r (teste, esperado, resultado)
    values ('votar como outro usuario', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('votar como outro usuario', 'bloqueado', 'ok');
  end;

  -- ATAQUE 6 - se promover a admin. O grant e so da coluna `bio`.
  begin
    update public.profiles set role = 'admin' where id = bruno;
    insert into _r (teste, esperado, resultado)
    values ('virar admin sozinho', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('virar admin sozinho', 'bloqueado', 'ok');
  end;

  -- ATAQUE 7 - se desbanir.
  begin
    update public.profiles set banned_until = null where id = bruno;
    insert into _r (teste, esperado, resultado)
    values ('limpar o proprio banimento', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('limpar o proprio banimento', 'bloqueado', 'ok');
  end;

  -- ATAQUE 8 - ler o voto dos outros. Nao levanta erro: a policy simplesmente
  -- nao devolve linha. Por isso aqui a checagem e por contagem.
  select count(*) into n from public.comment_votes where user_id = alice;
  insert into _r (teste, esperado, resultado)
  values ('ler voto alheio', '0 linhas', case when n = 0 then 'ok' else 'FALHOU - viu ' || n end);

  -- ATAQUE 9 - ler a fila de denuncias sem ser admin.
  insert into public.reports (comment_id, reporter_id, reason) values (c_alice, bruno, 'teste');
  select count(*) into n from public.reports;
  insert into _r (teste, esperado, resultado)
  values ('ler denuncias sem ser admin', '0 linhas', case when n = 0 then 'ok' else 'FALHOU - viu ' || n end);

  -- ATAQUE 10 - responder um comentario de OUTRA thread.
  begin
    perform public.post_comment('match', 'outra-partida', 'resposta cruzada', c_alice);
    insert into _r (teste, esperado, resultado)
    values ('responder atravessando thread', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('responder atravessando thread', 'bloqueado', 'ok');
  end;

  -- ATAQUE 11 - rate limit. Bruno ja postou 0; dispara 6 seguidos.
  begin
    for n in 1..6 loop
      perform public.post_comment('match', 'partida-de-teste', 'spam ' || n);
    end loop;
    insert into _r (teste, esperado, resultado)
    values ('rate limit de 5 por minuto', 'corta no 6o', 'FALHOU - passaram 6');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('rate limit de 5 por minuto', 'corta no 6o', 'ok');
  end;

  -- ATAQUE 12 - usuario banido comentando.
  reset role;
  update public.profiles set banned_until = now() + interval '1 day' where id = bruno;
  set local role authenticated;
  begin
    perform public.post_comment('match', 'partida-de-teste', 'comentario de banido');
    insert into _r (teste, esperado, resultado)
    values ('banido comenta', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('banido comenta', 'bloqueado', 'ok');
  end;

  -- ATAQUE 13 - e-mail de terceiro. auth.users nao pode ser legivel pela anon.
  begin
    select count(*) into n from auth.users;
    insert into _r (teste, esperado, resultado)
    values ('ler e-mail em auth.users', 'bloqueado', 'FALHOU - viu ' || n);
  exception when others then
    insert into _r (teste, esperado, resultado)
    values ('ler e-mail em auth.users', 'bloqueado', 'ok');
  end;

  -- ATAQUE 14 - conversa de cartinha com assunto inventado (0007). Como Alice,
  -- que nao esta banida nem no limite, e conferindo o NOME da restricao: sem a
  -- 0007 o tipo `card` tambem cairia numa checagem, a do tipo, e o teste
  -- passaria pelo motivo errado.
  perform set_config('request.jwt.claims', json_build_object('sub', alice)::text, true);
  begin
    perform public.post_comment('card', 'qualquer coisa', 'assunto inventado');
    insert into _r (teste, esperado, resultado)
    values ('cartinha com assunto fora do formato', 'bloqueado', 'FALHOU - passou');
  exception
    when check_violation then
      get stacked diagnostics restricao = constraint_name;
      insert into _r (teste, esperado, resultado)
      values ('cartinha com assunto fora do formato', 'bloqueado',
              case when restricao = 'threads_card_subject_format' then 'ok' else 'FALHOU - ' || restricao end);
    when others then
      insert into _r (teste, esperado, resultado)
      values ('cartinha com assunto fora do formato', 'bloqueado', 'FALHOU - ' || SQLERRM);
  end;

  -- COMPORTAMENTO - apagar zera o texto mas mantem a linha, senao as respostas
  -- penduradas nela ficariam orfas na arvore.
  perform set_config('request.jwt.claims', json_build_object('sub', alice)::text, true);
  perform public.delete_comment(c_alice);
  select count(*) into n from public.comments where id = c_alice and body = '' and deleted_at is not null;
  insert into _r (teste, esperado, resultado)
  values ('apagar zera texto e mantem linha', '1', case when n = 1 then 'ok' else 'FALHOU' end);

  reset role;
end;
$teste$;

-- ----------------------------------------------------------- threads livres
-- Cada caso confere a MENSAGEM do erro, e nao so que houve erro: antes da
-- migracao 0008 as funcoes nem existem, e "deu erro" passaria sozinho.

do $topicos$
declare
  alice uuid := '11111111-1111-1111-1111-111111111111';
  bruno uuid := '22222222-2222-2222-2222-222222222222';
  t_alice uuid;
  t_apagada uuid;
  n int;
begin
  -- O Bruno saiu do bloco anterior suspenso; aqui ele volta a ser conta comum,
  -- para os ataques dele baterem na regra de autoria e nao na suspensao.
  update public.profiles set banned_until = null where id = bruno;

  perform set_config('request.jwt.claims', json_build_object('sub', alice)::text, true);
  set local role authenticated;

  t_alice := public.create_topic('Quem leva a Univava?', '');

  -- ATAQUE - comentar numa thread com assunto que nao e uuid.
  begin
    perform public.post_comment('topic', 'nao-e-uuid', 'x');
    insert into _r (teste, esperado, resultado) values ('thread com id que nao e uuid', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('thread com id que nao e uuid', 'bloqueado',
      case when SQLERRM like '%thread nao existe%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;
  select count(*) into n from public.threads where subject_kind = 'topic' and subject_id = 'nao-e-uuid';
  insert into _r (teste, esperado, resultado) values ('id invalido nao cria thread', '0', case when n = 0 then 'ok' else 'FALHOU' end);

  -- ATAQUE - comentar numa thread que nunca existiu.
  begin
    perform public.post_comment('topic', '00000000-0000-4000-8000-000000000000', 'x');
    insert into _r (teste, esperado, resultado) values ('thread inexistente', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('thread inexistente', 'bloqueado',
      case when SQLERRM like '%thread nao existe%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;

  -- ATAQUE - comentar numa thread apagada.
  t_apagada := public.create_topic('Thread que vai sumir', '');
  perform public.delete_topic(t_apagada);
  begin
    perform public.post_comment('topic', t_apagada::text, 'x');
    insert into _r (teste, esperado, resultado) values ('comentar em thread apagada', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('comentar em thread apagada', 'bloqueado',
      case when SQLERRM like '%thread nao existe%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;

  -- ATAQUE - titulo curto, so de espacos e longo demais.
  begin
    perform public.create_topic('    ', '');
    insert into _r (teste, esperado, resultado) values ('titulo so de espacos', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('titulo so de espacos', 'bloqueado',
      case when SQLERRM like '%entre 5 e 120%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;
  begin
    perform public.create_topic('  abcd  ', '');
    insert into _r (teste, esperado, resultado) values ('titulo de 4 letras', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('titulo de 4 letras', 'bloqueado',
      case when SQLERRM like '%entre 5 e 120%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;
  begin
    perform public.create_topic(repeat('a', 121), '');
    insert into _r (teste, esperado, resultado) values ('titulo de 121 letras', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('titulo de 121 letras', 'bloqueado',
      case when SQLERRM like '%entre 5 e 120%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;

  -- ATAQUE - quarta thread na mesma hora (ja abriu duas: t_alice e t_apagada,
  -- e a apagada conta).
  perform public.create_topic('Terceira thread da hora', '');
  begin
    perform public.create_topic('Quarta thread da hora', '');
    insert into _r (teste, esperado, resultado) values ('limite de 3 threads por hora', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('limite de 3 threads por hora', 'bloqueado',
      case when SQLERRM like '%muitas threads seguidas%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;

  -- ATAQUE - escrever direto na tabela, sem a RPC.
  begin
    insert into public.topics (author_id, title) values (alice, 'por fora da RPC');
    insert into _r (teste, esperado, resultado) values ('insert direto em topics', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('insert direto em topics', 'bloqueado',
      case when SQLERRM like '%permission denied%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;

  -- ATAQUE - Bruno edita e apaga a thread da Alice.
  perform set_config('request.jwt.claims', json_build_object('sub', bruno)::text, true);
  begin
    perform public.edit_topic(t_alice, 'Trocado pelo bruno', '');
    insert into _r (teste, esperado, resultado) values ('bruno edita thread da alice', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('bruno edita thread da alice', 'bloqueado',
      case when SQLERRM like '%so da para editar thread propria%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;
  begin
    perform public.delete_topic(t_alice);
    insert into _r (teste, esperado, resultado) values ('bruno apaga thread da alice', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('bruno apaga thread da alice', 'bloqueado',
      case when SQLERRM like '%sem permissao%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;

  -- ATAQUE - editar depois dos 15 minutos.
  reset role;
  update public.topics set created_at = now() - interval '16 minutes' where id = t_alice;
  perform set_config('request.jwt.claims', json_build_object('sub', alice)::text, true);
  set local role authenticated;
  begin
    perform public.edit_topic(t_alice, 'Editada tarde demais', '');
    insert into _r (teste, esperado, resultado) values ('editar thread depois de 15 min', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('editar thread depois de 15 min', 'bloqueado',
      case when SQLERRM like '%so da para editar thread propria%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;

  -- ATAQUE - conta suspensa abre ou edita thread (dentro da janela de edicao).
  reset role;
  update public.topics set created_at = now() where id = t_alice;
  update public.profiles set banned_until = now() + interval '1 day' where id = alice;
  set local role authenticated;
  begin
    perform public.edit_topic(t_alice, 'Editada por conta suspensa', '');
    insert into _r (teste, esperado, resultado) values ('suspensa edita thread', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('suspensa edita thread', 'bloqueado',
      case when SQLERRM like '%conta suspensa%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;
  begin
    perform public.create_topic('Aberta por conta suspensa', '');
    insert into _r (teste, esperado, resultado) values ('suspensa abre thread', 'bloqueado', 'FALHOU - passou');
  exception when others then
    insert into _r (teste, esperado, resultado) values ('suspensa abre thread', 'bloqueado',
      case when SQLERRM like '%conta suspensa%' then 'ok' else 'FALHOU - ' || SQLERRM end);
  end;

  reset role;
end;
$topicos$;

-- ------------------------------------------------------------------ limpeza
delete from auth.users where email in ('alice@teste.univlr', 'bruno@teste.univlr');
delete from public.threads where subject_id in ('partida-de-teste', 'outra-partida');

select ordem, teste, esperado, resultado from _r order by ordem;

-- Trocar por `commit` so se quiser inspecionar o estado depois. Como esta,
-- o teste nao deixa rastro no banco.
rollback;
