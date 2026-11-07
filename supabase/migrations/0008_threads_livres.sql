-- UNIVLR - threads livres
--
-- Ate aqui toda conversa do site era presa a um assunto que vive no JSON
-- buildado (partida, campeonato, equipe, jogador, noticia, cartinha). Esta
-- migracao cria o assunto que nasce do proprio usuario: a thread de assunto
-- livre, com titulo e texto.
--
-- O assunto mora em `topics`. A conversa continua em `threads` + `comments`,
-- do tipo novo `topic`, com `subject_id` = id do topico. Assim resposta, voto,
-- denuncia, notificacao e limite anti-spam sao os mesmos de sempre.
--
-- >>> SO APLICAR JUNTO COM O FRONT NA MAIN. <<<
-- O site no ar nao sabe desenhar `topic` nem o aviso `topic_reply`, e o
-- post_comment() da producao aceitaria a conversa assim que o tipo existisse.

-- ------------------------------------------------------------------ topics

create table public.topics (
  id         uuid primary key default gen_random_uuid(),
  -- `set null`, e nao o `cascade` dos comentarios: decisao do dono. Quem apaga
  -- a conta leva os proprios comentarios, mas a thread que abriu fica no ar,
  -- com a conversa dos outros, e o autor aparece como "conta apagada".
  author_id  uuid references public.profiles(id) on delete set null,
  title      text not null,
  body       text not null default '',
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  constraint topic_title_len check (char_length(title) <= 120),
  constraint topic_body_len  check (char_length(body) <= 2000),
  -- Titulo vazio so na thread apagada. O minimo de 5 na entrada quem garante
  -- e create_topic()/edit_topic(), depois do btrim.
  constraint topic_title_vivo check (deleted_at is not null or char_length(title) >= 1)
);

create index topics_author_idx on public.topics (author_id, created_at desc);

alter table public.topics enable row level security;
revoke all on public.topics from anon, authenticated;
grant select on public.topics to anon, authenticated;
-- Leitura publica, como o comentario. A thread apagada tambem e legivel: o
-- titulo e o texto ja foram a vazio, e a pagina precisa saber que ela existiu
-- para dizer "apagada" em vez de "nao encontrada".
create policy topics_read on public.topics for select using (true);

-- --------------------------------------------- tipo novo e aviso novo

alter table public.threads drop constraint threads_subject_kind_check;
alter table public.threads add constraint threads_subject_kind_check
  check (subject_kind in ('match', 'event', 'article', 'player', 'team', 'card', 'topic'));

alter table public.threads add constraint threads_topic_subject_format
  check (subject_kind <> 'topic'
         or subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('mention', 'reply', 'topic_reply'));

-- ------------------------------------------------------------ limpa_titulo
-- O btrim padrao so tira o espaco ASCII. Tab, quebra de linha, espaco sem
-- quebra (U+00A0) e os de largura zero (U+200B-U+200D, U+2060, U+FEFF) passavam
-- pelo minimo de 5 e viravam uma linha em branco no painel da home. Aqui eles
-- saem das pontas, e o que sobra precisa ter ao menos um caractere visivel.
-- O front nao apara por conta propria: depois de editar ele rele o titulo
-- salvo (community-core.js, editarTopico). O Supabase falso dos testes usa a
-- mesma regra (scripts/fake_supabase.js, limpaTitulo).

create or replace function public.limpa_titulo(p text)
returns text
language sql immutable set search_path = public as $fn$
  select regexp_replace(coalesce(p, ''),
    '^[[:space:] ​‌‍⁠﻿]+|[[:space:] ​‌‍⁠﻿]+$', '', 'g')
$fn$;

create or replace function public.titulo_valido(p text)
returns boolean
language sql immutable set search_path = public as $fn$
  select char_length(p) between 5 and 120
     and p ~ '[^[:space:] ​‌‍⁠﻿]'
$fn$;

-- ------------------------------------------------------------ create_topic

create or replace function public.create_topic(p_title text, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid := auth.uid();
  v_title text := public.limpa_titulo(p_title);
  v_body  text := btrim(coalesce(p_body, ''));
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;
  if public.is_banned() then
    raise exception 'conta suspensa' using errcode = 'P0001';
  end if;
  if not public.titulo_valido(v_title) then
    raise exception 'titulo precisa ter entre 5 e 120 caracteres' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'texto pode ter no maximo 2000 caracteres' using errcode = 'P0001';
  end if;

  -- Mais apertado que o do comentario: cada thread ocupa uma linha da home.
  -- Conta as apagadas tambem, senao abrir e apagar em seguida furaria o limite.
  if (select count(*) from public.topics
      where author_id = v_uid and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'muitas threads seguidas, espere um pouco' using errcode = 'P0001';
  end if;
  if (select count(*) from public.topics
      where author_id = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'limite diario de threads atingido' using errcode = 'P0001';
  end if;

  insert into public.topics (author_id, title, body)
  values (v_uid, v_title, v_body)
  returning id into v_id;

  -- A conversa nasce junto, e nao no primeiro comentario como nas partidas:
  -- aqui o assunto foi criado agora e certamente vai ser aberto.
  insert into public.threads (subject_kind, subject_id) values ('topic', v_id::text);

  return v_id;
end;
$fn$;

-- -------------------------------------------------------------- edit_topic

create or replace function public.edit_topic(p_topic_id uuid, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid := auth.uid();
  v_title text := public.limpa_titulo(p_title);
  v_body  text := btrim(coalesce(p_body, ''));
  v_ok    boolean;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;
  -- Suspensa nao reescreve a propria thread, mesmo dentro da janela: o titulo
  -- aparece na home, e a suspensao existe justamente para calar a conta.
  if public.is_banned() then
    raise exception 'conta suspensa' using errcode = 'P0001';
  end if;
  if not public.titulo_valido(v_title) then
    raise exception 'titulo precisa ter entre 5 e 120 caracteres' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'texto pode ter no maximo 2000 caracteres' using errcode = 'P0001';
  end if;

  -- A mesma janela do comentario, pelo mesmo motivo: trocar o titulo de uma
  -- thread ja comentada reescreveria a conversa depois do fato.
  select true into v_ok from public.topics
   where id = p_topic_id
     and author_id = v_uid
     and deleted_at is null
     and created_at > now() - interval '15 minutes';

  if v_ok is null then
    raise exception 'so da para editar thread propria, nos primeiros 15 minutos' using errcode = 'P0001';
  end if;

  update public.topics set title = v_title, body = v_body, edited_at = now() where id = p_topic_id;
end;
$fn$;

-- ------------------------------------------------------------ delete_topic

create or replace function public.delete_topic(p_topic_id uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid    uuid := auth.uid();
  v_author uuid;
  v_existe boolean;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;

  select true, author_id into v_existe, v_author from public.topics
   where id = p_topic_id and deleted_at is null;
  if v_existe is null then
    raise exception 'thread nao encontrada' using errcode = 'P0001';
  end if;
  -- `is distinct from`: com a conta do autor apagada, author_id e nulo, e so o
  -- admin consegue apagar.
  if v_author is distinct from v_uid and not public.is_admin() then
    raise exception 'sem permissao' using errcode = 'P0001';
  end if;

  -- Mesmo criterio do delete_comment: a linha fica (a conversa aponta para
  -- ela), o texto vai a vazio de verdade e nao guardamos copia.
  update public.topics
     set title = '', body = '', deleted_at = now()
   where id = p_topic_id;
end;
$fn$;

-- ------------------------------------------------------------ post_comment
-- O corpo e o do 0003, com duas coisas a mais para o tipo `topic`: a thread
-- precisa existir e estar viva, e quem a abriu recebe aviso de comentario.

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

  -- Mencoes @fulano. Exclui quem ja recebeu o aviso de resposta ou de thread,
  -- para a mesma pessoa nao ser notificada duas vezes pelo mesmo comentario.
  for v_mention in
    select distinct m[1] from regexp_matches(v_body, '@([A-Za-z0-9_]{3,20})', 'g') as m
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

-- -------------------------------------------------------------- topic_list
-- A lista do painel da home e da pagina de threads, ja com o autor e a
-- contagem. `respostas` conta os comentarios vivos, respostas encadeadas
-- incluidas, como o selo das outras listas. A ordem fica com o cliente.

create or replace view public.topic_list
with (security_invoker = true) as
select
  t.id,
  t.title,
  t.created_at,
  t.edited_at,
  p.username::text as author_username,
  count(c.id)::int as respostas,
  greatest(t.created_at, max(c.created_at)) as ultima_atividade
from public.topics t
left join public.profiles p on p.id = t.author_id
left join public.threads th on th.subject_kind = 'topic' and th.subject_id = t.id::text
left join public.comments c on c.thread_id = th.id and c.deleted_at is null
where t.deleted_at is null
group by t.id, p.username;

grant select on public.topic_list to anon, authenticated;

-- ------------------------------------------------------------------ grants

revoke execute on function public.create_topic(text, text)        from public;
revoke execute on function public.edit_topic(uuid, text, text)    from public;
revoke execute on function public.delete_topic(uuid)              from public;

grant execute on function public.create_topic(text, text)         to authenticated;
grant execute on function public.edit_topic(uuid, text, text)     to authenticated;
grant execute on function public.delete_topic(uuid)               to authenticated;

revoke execute on function public.limpa_titulo(text)  from public;
revoke execute on function public.titulo_valido(text) from public;
