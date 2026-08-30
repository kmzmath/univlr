-- UNIVLR - contas, perfis e comentarios (ciclo 1)
--
-- Modelo de seguranca: LEITURA por RLS, ESCRITA por RPC `security definer`.
--
-- Nao existe servidor nosso - o navegador fala direto com o PostgREST usando a
-- chave `anon`. Entao tudo que vale como regra de negocio precisa morar aqui.
-- Escrita nao vira policy de INSERT/UPDATE porque:
--   1. editar e apagar sao ambos UPDATE, com regras diferentes (janela de 15
--      min para o autor; sem janela para o admin). RLS nao enxerga qual coluna
--      mudou, entao uma policy so nao consegue separar os dois casos.
--   2. o rate limit precisa ser atomico com o insert.
--   3. postar cria a thread sob demanda; duas operacoes, uma transacao.
-- Cada RPC valida e devolve; o cliente nunca escreve em tabela diretamente.

create extension if not exists citext;

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  username            citext not null unique,
  bio                 text,
  created_at          timestamptz not null default now(),
  username_changed_at timestamptz,
  role                text not null default 'user',
  banned_until        timestamptz,
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  constraint bio_len       check (bio is null or char_length(bio) <= 300),
  constraint role_valid    check (role in ('user', 'admin'))
);

-- O e-mail NAO e copiado para ca. Ele fica em auth.users, que nao e legivel
-- pela chave anon. `profiles` e publico por definicao, entao nada sensivel
-- entra - e o que impede vazar o e-mail de todo mundo por uma policy distraida.

-- ------------------------------------------------------------------ helpers
-- `security definer` de proposito: estas funcoes sao chamadas de dentro das
-- policies de `profiles`. Sem isso, ler profiles para decidir se pode ler
-- profiles seria recursao infinita.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_banned() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and banned_until is not null and banned_until > now()
  );
$$;

-- Checagem de username livre ANTES do cadastro. Sem isso o unico retorno seria
-- o signup falhando na trigger, ja com a conta de auth criada pela metade.
create or replace function public.username_available(candidate citext) returns boolean
language sql stable security definer set search_path = public as $$
  select candidate ~ '^[A-Za-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where username = candidate);
$$;

-- O perfil nasce junto com a conta. O username vem no metadata do signup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- threads

-- subject_id aponta para um id que vive no JSON buildado, nao no Postgres.
-- Sem foreign key de proposito: o JSON e a fonte da verdade do esports, o
-- Supabase so guarda o que usuario produz.
create table public.threads (
  id           uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('match', 'event', 'article')),
  subject_id   text not null,
  created_at   timestamptz not null default now(),
  unique (subject_kind, subject_id)
);

-- ---------------------------------------------------------------- comments

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.threads(id) on delete cascade,
  parent_id  uuid references public.comments(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz,
  score      int not null default 0,
  constraint body_len check (char_length(body) <= 2000)
);

-- `body` pode ficar vazio (comentario apagado), por isso o check nao exige >= 1.
-- Quem garante o minimo na entrada e post_comment().

create index comments_thread_idx on public.comments (thread_id, created_at);
create index comments_author_idx on public.comments (author_id, created_at desc);
create index comments_parent_idx on public.comments (parent_id);

-- ------------------------------------------------------------ comment_votes

create table public.comment_votes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- So existe +1. A chave primaria e o que impede votar duas vezes - nao a UI.

create or replace function public.sync_comment_score() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.comments set score = score + 1 where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update public.comments set score = score - 1 where id = old.comment_id;
  end if;
  return null;
end;
$$;

create trigger comment_votes_score
  after insert or delete on public.comment_votes
  for each row execute function public.sync_comment_score();

-- ----------------------------------------------------------------- reports

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references public.comments(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason      text not null check (char_length(reason) <= 500),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (comment_id, reporter_id)
);

create index reports_open_idx on public.reports (created_at desc) where resolved_at is null;

-- ------------------------------------------------------------ notifications

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('mention', 'reply')),
  comment_id uuid not null references public.comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);

create index notifications_unread_idx on public.notifications (user_id, created_at desc)
  where read_at is null;

-- --------------------------------------------------------------- favorites

create table public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind    text not null check (kind in ('team', 'player')),
  ref_id  text not null,
  primary key (user_id, kind, ref_id)
);
