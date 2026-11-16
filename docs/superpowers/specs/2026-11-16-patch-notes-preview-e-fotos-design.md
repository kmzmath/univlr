# Patch notes: pré-visualização e fotos

16/11/2026. Pedido do dono: opção de pré-visualizar o patch notes e poder adicionar fotos.

## Abordagens para as fotos
- **A, Storage do Supabase (escolhida por ele):** o admin envia pelo próprio formulário; a foto fica numa pasta pública do Supabase.
- B, fotos no repositório: eu coloco as imagens no projeto a cada patch notes; sem migração, mas não é ele quem adiciona.
- C, link de imagem externa: nada para hospedar, mas a imagem depende de outro site.

## Desenho

### Banco: `supabase/migrations/0013_fotos_do_patch_notes.sql`
- Pasta (bucket) `patch-notes`, pública para leitura, até 5 MB por arquivo, só WebP, PNG e JPEG.
- Regras em `storage.objects`: só admin envia, lê a lista e apaga nessa pasta (`public.is_admin()`); conta comum e anônimo não enviam. Sem regra de alterar: foto não é sobrescrita.
- Testes: `rls_test` (conta comum envia foto: bloqueado; admin envia em outra pasta: bloqueado) e `positive_test` (admin envia foto). No PGlite com um esqueleto do `storage` do Supabase.

### Site
- Formulário do patch notes (publicar e editar) ganha "Adicionar foto" e "Pré-visualizar".
- Foto: reduzida no navegador para até 1600 px de largura em WebP (PNG onde o navegador não gera WebP), enviada para `patch-notes/<ano>/<mes>/<id>.<ext>`, e o texto recebe `[img]endereço[/img]` onde está o cursor. Várias de uma vez, em sequência.
- `Comments.corpo(texto, { imagens: true })` desenha `[img]` só quando o endereço é da pasta `patch-notes` do nosso Supabase; o cartão do patch notes e a pré-visualização ligam isso. Em comentário e em thread comum, `[img]` continua texto.
- Pré-visualização: troca os campos pelo cartão como vai ficar (título, texto formatado, fotos), com "Voltar a editar"; publicar continua no mesmo botão.
- `community-core.js` ganha o envio da foto já reduzida; a redução fica na tela (precisa de canvas). O Supabase falso dos testes ganha o envio, com a mesma regra de admin.

## Ordem de subida
Como a 0011: o dono roda os ensaios e aplica a 0013, depois o push. O site novo funciona sem a 0013 (só o envio de foto falha); a ordem é para o botão não aparecer quebrado.

## Fora do escopo
- Pré-visualização e fotos em thread comum e em comentários.
- Apagar foto pela tela (o admin apaga pelo painel do Supabase).
