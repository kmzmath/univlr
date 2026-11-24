-- UNIVLR - limite que vale em paralelo, e suspensao que cala a conta inteira
--
-- Achados da auditoria de 23/11/2026:
--
-- 1. O limite de comentarios (5 por minuto, 50 por dia) e o de threads (3 por
--    hora, 10 por dia) contavam e depois gravavam, sem trava. Chamadas feitas
--    ao mesmo tempo contavam juntas antes de qualquer uma gravar, e todas
--    passavam: um script com 50 chamadas em paralelo postava as 50. Agora a
--    primeira coisa depois das checagens e uma trava por conta, que dura ate o
--    fim da transacao: a segunda chamada da mesma conta espera a primeira
--    gravar e so entao conta. Contas diferentes nao esperam umas pelas outras.
--
--    A trava e "advisory", e nao `select ... for update` na linha do perfil: o
--    aviso de resposta grava uma chave estrangeira para o perfil de outra
--    pessoa, e duas contas respondendo uma a outra ao mesmo tempo dariam
--    deadlock com a linha travada.
--
-- 2. A suspensao bloqueava comentar, votar, denunciar e abrir ou editar thread,
--    mas a conta suspensa ainda trocava a bio, os favoritos e o nome, e
--    editava o proprio comentario dentro dos 15 minutos.
--
-- Os corpos de post_comment, create_topic, edit_comment e set_username sao os
-- da 0009, 0011 e 0003, com as linhas novas marcadas por "0014". Compativel com
-- o site no ar: as assinaturas sao as mesmas.
--
-- Aplicar depois da 0013. O teste: `begin; 0014; rls_test; positive_test;
-- rollback;` no SQL Editor, tudo `ok`, e entao aplicar a 0014 de verdade.

-- ------------------------------------------------------------ post_comment

create or replace function public.post_comment(
  p_kind       text,
  p_subject_id text,
  p_body       text,
  p_parent_id  uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid       uuid := auth.uid();
  v_body      text := btrim(p_body);
  v_thread_id uuid;
  v_comment   uuid;
  v_parent_author uuid;
  v_topic_author  uuid;
  v_mention   text;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;
  if public.is_banned() then
    raise exception 'conta suspensa' using errcode = 'P0001';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'comentario precisa ter entre 1 e 2000 caracteres' using errcode = 'P0001';
  end if;

  -- Thread livre: o assunto vive no banco, entao da para conferir aqui (as
  -- outras vivem no JSON e nao). A regex vem ANTES do ::uuid, senao um texto
  -- qualquer chegaria como erro de conversao em vez de mensagem legivel.
  if p_kind = 'topic' then
    if p_subject_id is null
       or p_subject_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'thread nao existe' using errcode = 'P0001';
    end if;
    select author_id into v_topic_author from public.topics
     where id = p_subject_id::uuid and deleted_at is null;
    if not found then
      raise exception 'thread nao existe' using errcode = 'P0001';
    end if;
  elsif p_kind <> 'card' and not public.subject_id_valido(p_kind, p_subject_id) then
    -- Os assuntos do JSON nao tem como ser conferidos aqui, mas o formato tem:
    -- sem isto um id de qualquer tamanho virava thread. A cartinha fica com a
    -- restricao propria da 0007 (`threads_card_subject_format`), que o
    -- rls_test confere pelo nome.
    raise exception 'assunto invalido' using errcode = 'P0001';
  end if;

  -- 0014: uma escrita por vez para cada conta, ate o fim da transacao. Sem
  -- isto, chamadas em paralelo contavam antes de qualquer uma gravar.
  perform pg_advisory_xact_lock(hashtextextended('univlr-escrita:' || v_uid::text, 0));

  -- Rate limit. Sem verificacao de e-mail obrigatoria, criar conta descartavel
  -- e barato, entao esta e a defesa principal contra spam - e por isso ela
  -- mora no banco, nao na UI. Ver secao "Anti-spam" do plano.
  if (select count(*) from public.comments
      where author_id = v_uid and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'muitos comentarios seguidos, espere um minuto' using errcode = 'P0001';
  end if;
  if (select count(*) from public.comments
      where author_id = v_uid and created_at > now() - interval '1 day') >= 50 then
    raise exception 'limite diario de comentarios atingido' using errcode = 'P0001';
  end if;

  -- Thread sob demanda: nao faz sentido pre-criar linha para as milhares de
  -- partidas que ninguem vai comentar. O `on conflict` cobre a corrida de dois
  -- primeiros comentarios simultaneos na mesma partida.
  insert into public.threads (subject_kind, subject_id)
  values (p_kind, p_subject_id)
  on conflict (subject_kind, subject_id) do nothing;

  select id into v_thread_id from public.threads
   where subject_kind = p_kind and subject_id = p_subject_id;

  -- Resposta precisa ser da MESMA thread. Sem esta checagem daria para pendurar
  -- um comentario de uma partida como resposta de outra.
  if p_parent_id is not null then
    select author_id into v_parent_author from public.comments
     where id = p_parent_id and thread_id = v_thread_id and deleted_at is null;
    if v_parent_author is null then
      raise exception 'comentario respondido nao existe nesta thread' using errcode = 'P0001';
    end if;
  end if;

  insert into public.comments (thread_id, parent_id, author_id, body)
  values (v_thread_id, p_parent_id, v_uid, v_body)
  returning id into v_comment;

  -- Aviso de resposta, menos quando a pessoa responde a si mesma.
  if v_parent_author is not null and v_parent_author <> v_uid then
    insert into public.notifications (user_id, kind, comment_id)
    values (v_parent_author, 'reply', v_comment);
  end if;

  -- Aviso para quem abriu a thread livre: e o que faz a pessoa voltar para a
  -- conversa que comecou. Nao duplica o aviso de resposta.
  if v_topic_author is not null and v_topic_author <> v_uid
     and v_topic_author is distinct from v_parent_author then
    insert into public.notifications (user_id, kind, comment_id)
    values (v_topic_author, 'topic_reply', v_comment);
  end if;

  -- Mencoes @fulano: so as 5 primeiras pessoas distintas, na ordem em que
  -- aparecem no texto (maiuscula e minuscula contam como a mesma, como no
  -- username). As outras seguem como link no comentario, sem aviso. Exclui
  -- quem ja recebeu o aviso de resposta ou de thread, para a mesma pessoa nao
  -- ser notificada duas vezes pelo mesmo comentario.
  for v_mention in
    select nome from (
      select lower(m.r[1]) as nome, min(m.ordem) as primeira
        from regexp_matches(v_body, '@([A-Za-z0-9_]{3,20})', 'g') with ordinality as m(r, ordem)
       group by lower(m.r[1])
    ) mencoes
     order by primeira
     limit 5
  loop
    insert into public.notifications (user_id, kind, comment_id)
    select p.id, 'mention', v_comment
      from public.profiles p
     where p.username = v_mention::citext
       and p.id <> v_uid
       and (v_parent_author is null or p.id <> v_parent_author)
       and (v_topic_author is null or p.id <> v_topic_author);
  end loop;

  return v_comment;
end;
$fn$;

-- ------------------------------------------------------------ create_topic

create or replace function public.create_topic(p_title text, p_body text, p_secao text default 'geral')
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid := auth.uid();
  v_title text := public.limpa_titulo(p_title);
  v_body  text := btrim(coalesce(p_body, ''));
  v_secao text := coalesce(p_secao, 'geral');
  v_max   int;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;
  if public.is_banned() then
    raise exception 'conta suspensa' using errcode = 'P0001';
  end if;
  if v_secao not in ('geral', 'patch') then
    raise exception 'secao desconhecida' using errcode = 'P0001';
  end if;
  if v_secao = 'patch' and not public.is_admin() then
    raise exception 'so admin publica patch notes' using errcode = 'P0001';
  end if;
  if not public.titulo_valido(v_title) then
    raise exception 'titulo precisa ter entre 5 e 120 caracteres' using errcode = 'P0001';
  end if;
  v_max := case when v_secao = 'patch' then 8000 else 2000 end;
  if char_length(v_body) > v_max then
    raise exception 'texto pode ter no maximo % caracteres', v_max using errcode = 'P0001';
  end if;

  -- 0014: a mesma trava do post_comment, pelo mesmo motivo.
  perform pg_advisory_xact_lock(hashtextextended('univlr-escrita:' || v_uid::text, 0));

  -- Os mesmos limites do 0008, para todas as secoes.
  if (select count(*) from public.topics
      where author_id = v_uid and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'muitas threads seguidas, espere um pouco' using errcode = 'P0001';
  end if;
  if (select count(*) from public.topics
      where author_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'limite diario de threads atingido' using errcode = 'P0001';
  end if;

  insert into public.topics (author_id, title, body, secao)
  values (v_uid, v_title, v_body, v_secao)
  returning id into v_id;

  insert into public.threads (subject_kind, subject_id) values ('topic', v_id::text);

  return v_id;
end;
$fn$;

-- ------------------------------------------------------------ edit_comment

create or replace function public.edit_comment(p_comment_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid  uuid := auth.uid();
  v_body text := btrim(p_body);
  v_ok   boolean;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;
  -- 0014: como no edit_topic, a suspensa nao reescreve nem dentro da janela.
  if public.is_banned() then
    raise exception 'conta suspensa' using errcode = 'P0001';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'comentario precisa ter entre 1 e 2000 caracteres' using errcode = 'P0001';
  end if;

  -- A janela de 15 min existe para nao deixar trocar o texto de um comentario
  -- ja respondido ou votado, o que reescreveria a conversa depois do fato.
  select true into v_ok from public.comments
   where id = p_comment_id
     and author_id = v_uid
     and deleted_at is null
     and created_at > now() - interval '15 minutes';

  if v_ok is null then
    raise exception 'so da para editar comentario proprio, nos primeiros 15 minutos' using errcode = 'P0001';
  end if;

  update public.comments set body = v_body, edited_at = now() where id = p_comment_id;
end;
$fn$;

-- ------------------------------------------------------------- set_username

create or replace function public.set_username(p_username citext)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_changed timestamptz;
  v_created timestamptz;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;
  -- 0014: trocar de nome durante a suspensao despistava a moderacao, que acha
  -- a conta pelo username.
  if public.is_banned() then
    raise exception 'conta suspensa' using errcode = 'P0001';
  end if;
  if not public.username_available(p_username) then
    raise exception 'username invalido ou ja usado' using errcode = 'P0001';
  end if;

  select username_changed_at, created_at into v_changed, v_created
    from public.profiles where id = v_uid;

  -- Trocar de nome quebra mencao e dificulta moderacao, entao a conta segura o
  -- primeiro username por 30 dias e depois so muda a cada 30 dias.
  if coalesce(v_changed, v_created) > now() - interval '30 days' then
    raise exception 'username so pode mudar a cada 30 dias' using errcode = 'P0001';
  end if;

  update public.profiles
     set username = p_username, username_changed_at = now()
   where id = v_uid;
end;
$fn$;

-- ------------------------------------------------- bio e favoritos da suspensa

-- No `with check`, e nao no `using`: assim a conta suspensa recebe erro de
-- permissao em vez de um "salvo" que nao salvou nada.
drop policy profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and not public.is_banned());
