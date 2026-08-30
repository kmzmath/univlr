-- UNIVLR - RPCs de escrita
--
-- Todo INSERT/UPDATE/DELETE em `comments` passa por aqui. Sao `security
-- definer`, entao rodam como dono da tabela e ignoram os grants de 0002 - e
-- justamente por isso cada uma precisa validar auth.uid() na primeira linha.

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

  -- Mencoes @fulano. Exclui quem ja recebeu o aviso de resposta, para a mesma
  -- pessoa nao ser notificada duas vezes pelo mesmo comentario.
  for v_mention in
    select distinct m[1] from regexp_matches(v_body, '@([A-Za-z0-9_]{3,20})', 'g') as m
  loop
    insert into public.notifications (user_id, kind, comment_id)
    select p.id, 'mention', v_comment
      from public.profiles p
     where p.username = v_mention::citext
       and p.id <> v_uid
       and (v_parent_author is null or p.id <> v_parent_author);
  end loop;

  return v_comment;
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

-- ---------------------------------------------------------- delete_comment

create or replace function public.delete_comment(p_comment_id uuid)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;

  select author_id into v_author from public.comments
   where id = p_comment_id and deleted_at is null;
  if v_author is null then
    raise exception 'comentario nao encontrado' using errcode = 'P0001';
  end if;
  if v_author <> v_uid and not public.is_admin() then
    raise exception 'sem permissao' using errcode = 'P0001';
  end if;

  -- Soft delete que apaga o texto de verdade: a linha fica (as respostas
  -- penduradas nela precisam de um pai), mas `body` vai a vazio e nao volta.
  -- Nao guardamos copia - o admin decide olhando a denuncia, ANTES de apagar.
  -- Guardar o texto apagado criaria um arquivo de conteudo removido que
  -- ninguem pediu e que o direito de exclusao da LGPD teria de alcancar.
  update public.comments
     set body = '', deleted_at = now()
   where id = p_comment_id;
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

-- ----------------------------------------------------------- delete_account
-- LGPD, direito de exclusao. Apaga a conta de auth; o `on delete cascade` de
-- profiles leva junto comentarios, votos, favoritos e notificacoes.

create or replace function public.delete_account()
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = 'P0001';
  end if;
  delete from auth.users where id = v_uid;
end;
$fn$;

-- ------------------------------------------------------------------ grants
-- Funcao em `public` e executavel por todos por padrao. Fecha e reabre.

revoke execute on function public.post_comment(text, text, text, uuid)   from public;
revoke execute on function public.edit_comment(uuid, text)               from public;
revoke execute on function public.delete_comment(uuid)                   from public;
revoke execute on function public.set_username(citext)                   from public;
revoke execute on function public.delete_account()                       from public;
revoke execute on function public.username_available(citext)             from public;
revoke execute on function public.is_admin()                             from public;
revoke execute on function public.is_banned()                            from public;

grant execute on function public.post_comment(text, text, text, uuid)   to authenticated;
grant execute on function public.edit_comment(uuid, text)               to authenticated;
grant execute on function public.delete_comment(uuid)                   to authenticated;
grant execute on function public.set_username(citext)                   to authenticated;
grant execute on function public.delete_account()                       to authenticated;

-- anon tambem: a tela de cadastro precisa checar o username antes de existir
-- sessao. Devolve so booleano, entao nao vaza nada alem de "esse nome existe".
grant execute on function public.username_available(citext) to anon, authenticated;
