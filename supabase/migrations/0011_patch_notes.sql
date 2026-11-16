-- UNIVLR - patch notes no Forum (16/11/2026)
--
-- O Forum ganha uma secao, `patch`, so para os patch notes do site. Em 07/11 o
-- dono tinha recusado secoes; esta e a excecao que ele pediu em 16/11. Quem
-- publica nela e so admin, e a regra mora aqui, como todo o resto: esconder o
-- botao na tela nao protege nada, qualquer conta pode chamar a API na mao.
--
-- Patch notes e uma thread como as outras (conversa, voto, aviso, denuncia);
-- so muda quem abre e o tamanho do texto, que vai a 8.000 caracteres.
--
-- Compativel com o site de hoje: a chamada antiga, create_topic(p_title,
-- p_body), cai na nova com secao `geral`, e a topic_list so ganha uma coluna no
-- fim. Por isso a ordem e: aplicar esta migracao, depois subir o front.

-- ------------------------------------------------------------------ secao

alter table public.topics
  add column secao text not null default 'geral',
  add constraint topics_secao_check check (secao in ('geral', 'patch'));

alter table public.topics drop constraint topic_body_len;
alter table public.topics add constraint topic_body_len
  check (char_length(body) <= case when secao = 'patch' then 8000 else 2000 end);

-- ------------------------------------------------------------ create_topic
-- A de dois argumentos sai: com as duas no banco, uma chamada so com p_title e
-- p_body serviria nas duas e o PostgREST nao saberia qual escolher.

drop function public.create_topic(text, text);

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

-- -------------------------------------------------------------- edit_topic
-- O limite de texto segue a secao. O patch notes do proprio autor se corrige a
-- qualquer hora (um erro no texto nao pode exigir apagar a conversa); a thread
-- geral segue com a janela de 15 minutos do 0008.

create or replace function public.edit_topic(p_topic_id uuid, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_uid   uuid := auth.uid();
  v_title text := public.limpa_titulo(p_title);
  v_body  text := btrim(coalesce(p_body, ''));
  v_secao text;
  v_max   int;
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

  select secao into v_secao from public.topics
   where id = p_topic_id
     and author_id = v_uid
     and deleted_at is null
     and (secao = 'patch' or created_at > now() - interval '15 minutes');

  if v_secao is null then
    raise exception 'so da para editar thread propria, nos primeiros 15 minutos' using errcode = 'P0001';
  end if;

  v_max := case when v_secao = 'patch' then 8000 else 2000 end;
  if char_length(v_body) > v_max then
    raise exception 'texto pode ter no maximo % caracteres', v_max using errcode = 'P0001';
  end if;

  update public.topics set title = v_title, body = v_body, edited_at = now() where id = p_topic_id;
end;
$fn$;

-- -------------------------------------------------------------- topic_list
-- A mesma do 0008, com a secao no fim (create or replace view so aceita coluna
-- nova depois das que ja existem).

create or replace view public.topic_list
with (security_invoker = true) as
select
  t.id,
  t.title,
  t.created_at,
  t.edited_at,
  p.username::text as author_username,
  count(c.id)::int as respostas,
  greatest(t.created_at, max(c.created_at)) as ultima_atividade,
  t.secao
from public.topics t
left join public.profiles p on p.id = t.author_id
left join public.threads th on th.subject_kind = 'topic' and th.subject_id = t.id::text
left join public.comments c on c.thread_id = th.id and c.deleted_at is null
where t.deleted_at is null
group by t.id, p.username;

grant select on public.topic_list to anon, authenticated;

-- ------------------------------------------------------------------ grants

revoke execute on function public.create_topic(text, text, text) from public;
grant execute on function public.create_topic(text, text, text) to authenticated;
