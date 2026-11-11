-- UNIVLR - limite no assunto da conversa e teto de mencoes
--
-- Dois abusos que uma conta comum conseguia fazer, achados na auditoria de
-- 11/11/2026 (outputs/auditoria-tecnica-2026-11-11/RELATORIO.md, A3 e M6):
--
-- 1. `post_comment()` criava a thread com QUALQUER `subject_id` nos tipos que
--    vivem no JSON (partida, campeonato, equipe, jogador, noticia). Um id de
--    centenas de KB vira uma linha da `thread_counts`, que todo visitante baixa
--    antes do primeiro desenho do site: 5 comentarios deixaram essa consulta
--    com 1,17 MB.
-- 2. Cada `@fulano` distinto gerava um aviso, sem teto: um comentario com 300
--    mencoes mandava 300 avisos.
--
-- Os ids de verdade, medidos no banco do site em 11/11/2026: chave de serie ate
-- 91 caracteres, campeonato ate 35, equipe ate 38, endereco de jogador ate 16,
-- noticia ate 50, todos so com letras, numeros, hifen e sublinhado. O limite
-- fica em 120 para ter folga. Cartinha e thread livre ja tinham formato proprio
-- (0007 e 0008) e nao mudam.
--
-- Aplicar depois da 0008. O teste: `begin; 0009; rls_test; positive_test;
-- rollback;` no SQL Editor, tudo `ok`, e entao aplicar a 0009 de verdade.

-- ------------------------------------------------- formato do subject_id

create or replace function public.subject_id_valido(p_kind text, p_subject_id text)
returns boolean
language sql immutable set search_path = public as $fn$
  select case
    when p_subject_id is null then false
    -- Os dois tipos que ja tinham regra propria seguem com ela.
    when p_kind = 'card' then p_subject_id ~ '^[0-9]{4}(:[A-Za-z0-9_-]{1,100})?$'
    when p_kind = 'topic' then p_subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    else char_length(p_subject_id) between 1 and 120 and p_subject_id ~ '^[A-Za-z0-9_-]+$'
  end
$fn$;

revoke execute on function public.subject_id_valido(text, text) from public;

-- `not valid`: vale para toda linha nova a partir de agora sem precisar varrer
-- a tabela. O bloco logo abaixo valida as antigas quando todas cabem na regra;
-- se alguma nao couber, a migracao nao falha: ela avisa quantas sao, e as
-- antigas ficam como estao ate alguem decidir o que fazer com elas.
alter table public.threads add constraint threads_subject_id_formato
  check (public.subject_id_valido(subject_kind, subject_id)) not valid;

do $valida$
declare
  fora int;
begin
  select count(*) into fora from public.threads
   where not public.subject_id_valido(subject_kind, subject_id);
  if fora = 0 then
    alter table public.threads validate constraint threads_subject_id_formato;
  else
    raise notice '% thread(s) antiga(s) fora do formato; a regra vale so para as novas. Lista: select subject_kind, left(subject_id, 80), char_length(subject_id) from public.threads where not public.subject_id_valido(subject_kind, subject_id);', fora;
  end if;
end;
$valida$;

-- ------------------------------------------------------------ post_comment
-- O corpo e o do 0008, com duas mudancas: o `subject_id` e conferido antes de
-- criar a thread (mensagem legivel em vez do erro da restricao), e as mencoes
-- param nas 5 primeiras pessoas distintas do texto.

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
