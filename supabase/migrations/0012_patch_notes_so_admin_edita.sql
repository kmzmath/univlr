-- UNIVLR - patch notes: so admin edita (16/11/2026)
--
-- A 0011 deixou o autor de um patch notes corrigi-lo a qualquer hora, mas so
-- conferia a autoria. Quem publicasse como admin e depois perdesse o papel
-- continuaria podendo reescrever o texto oficial do site, sem prazo. Achado
-- pela revisao de seguranca do commit da 0011.
--
-- Agora a edicao de patch notes exige ser admin no momento da edicao, a mesma
-- regra da publicacao. A thread geral nao muda. Compativel com o site no ar:
-- a assinatura e a mesma.

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
  if v_secao = 'patch' and not public.is_admin() then
    raise exception 'so admin edita patch notes' using errcode = 'P0001';
  end if;

  v_max := case when v_secao = 'patch' then 8000 else 2000 end;
  if char_length(v_body) > v_max then
    raise exception 'texto pode ter no maximo % caracteres', v_max using errcode = 'P0001';
  end if;

  update public.topics set title = v_title, body = v_body, edited_at = now() where id = p_topic_id;
end;
$fn$;
