# Patch notes no Fórum

16/11/2026. Pedido do dono: estrear o Fórum com um patch notes das mudanças do dia e separar, dentro do Fórum, um painel para "patch notes". Em 07/11 ele tinha recusado seções no Fórum; este pedido abre uma exceção só para os patch notes.

## Abordagens

- **A, seção no banco (escolhida por ele):** thread de verdade, numa seção que só admin publica; regra no banco, comentários e avisos normais.
- B, arquivo no repositório: vai com o push e não precisa de migração, mas não é thread (sem autor de conta, fora da contagem do Fórum).
- C, thread comum destacada pelo título: sem migração, mas a regra é um combinado de título e o texto fica preso em 2.000 caracteres.

## Desenho

### Banco: `supabase/migrations/0011_patch_notes.sql`
- `topics.secao text not null default 'geral'`, só `geral` ou `patch`.
- Texto até 8.000 caracteres em `patch` e 2.000 nas outras (troca a `topic_body_len`).
- `create_topic(p_title, p_body, p_secao default 'geral')` no lugar da de dois argumentos (a antiga sai, senão o PostgREST não escolhe entre as duas). Em `patch`, só admin (`is_admin()`); seção desconhecida é recusada. Mesmos limites de frequência.
- `edit_topic`: o limite de texto segue a seção. Patch notes do próprio admin pode ser editado depois dos 15 minutos (regra minha: corrigir um erro no texto sem apagar a conversa).
- `topic_list` ganha a coluna `secao` no fim.
- Compatível com o site de hoje: a chamada antiga de dois argumentos cai na nova com `geral`. Ordem de subida: o dono aplica a 0011 no SQL Editor, depois vem o push.
- Testes: casos novos no `rls_test.sql` (conta comum não publica patch notes, texto de 2.001 em `geral` recusado) e no `positive_test.sql` (admin publica com 8.000, comentário e aviso normais). Rodados no PGlite com 0001 a 0011.

### Site
- `#/forum`: painel "Patch notes" acima da tabela, com os 3 mais recentes (data, título, respostas) e "Ver todos" quando houver mais; a tabela de threads mostra só a seção geral. "+ Patch notes" no painel, só para admin.
- `#/forum/patch-notes`: a lista inteira, paginada como a do Fórum.
- `#/forum/nova?secao=patch`: o mesmo formulário, com limite de 8.000.
- A thread de patch notes leva "Patch notes" acima do título. Painel da home e "Outras threads" seguem mostrando tudo.
- `scripts/fake_supabase.js` acompanha a regra para os testes do front.

### O texto de 16/11
Escrito por mim, revisado por ele, publicado por ele logado como kmyzth. Fica guardado em `docs/patch-notes/2026-11-16.txt`.

## Fora do escopo
- Outras seções no Fórum.
- Publicar no lugar do dono (exigiria a senha dele).
