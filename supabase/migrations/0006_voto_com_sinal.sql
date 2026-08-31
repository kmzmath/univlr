-- UNIVLR - voto ganha sinal (para cima e para baixo)
--
-- Ate aqui o voto era so "+1": a existencia da linha em `comment_votes` era o
-- voto, e o score so subia. Agora cada voto carrega um sinal, o score comeca em
-- zero e anda para os dois lados.
--
-- Trocar de voto e UPDATE da coluna, nao apagar e inserir de novo: apagar
-- perderia o `created_at` e, mais importante, deixaria uma janela em que a
-- pessoa nao tem voto nenhum - se a segunda operacao falhasse, o voto sumia.

alter table public.comment_votes
  add column value smallint not null default 1;

alter table public.comment_votes
  add constraint comment_votes_value_check check (value in (-1, 1));

-- O gatilho passa a somar o VALOR, e a cobrir UPDATE: sem o ramo de update,
-- trocar de para-cima para para-baixo nao mexeria no score e a nota do
-- comentario ficaria mentindo ate alguem votar de novo.
create or replace function public.sync_comment_score() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    update public.comments set score = score + new.value where id = new.comment_id;
  elsif tg_op = 'DELETE' then
    update public.comments set score = score - old.value where id = old.comment_id;
  elsif tg_op = 'UPDATE' then
    update public.comments set score = score + (new.value - old.value) where id = new.comment_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists comment_votes_score on public.comment_votes;
create trigger comment_votes_score
  after insert or update or delete on public.comment_votes
  for each row execute function public.sync_comment_score();

-- Trocar o proprio voto. O grant e por COLUNA: `value` e a unica coisa que a
-- pessoa pode mexer, entao nao da para reatribuir o voto a outra conta
-- editando `user_id`.
grant update (value) on public.comment_votes to authenticated;

create policy votes_update_own on public.comment_votes
  for update using (user_id = auth.uid() and not public.is_banned())
  with check (user_id = auth.uid());

-- Os scores existentes foram todos gerados com valor 1, entao o default acima
-- ja os deixa coerentes. Recalcula assim mesmo, porque um score errado no
-- banco e invisivel na tela ate alguem reparar que a conta nao fecha.
update public.comments c
   set score = coalesce((select sum(v.value) from public.comment_votes v where v.comment_id = c.id), 0);
