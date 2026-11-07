# Threads livres - plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** quem tem conta abre uma thread de assunto livre (título e texto), a conversa dentro dela usa os comentários que já existem, e as threads aparecem num painel da home, numa página própria e num item do menu.

**Architecture:** tabela nova `topics` no Supabase, com a conversa numa linha de `threads` do tipo novo `topic` (o `subject_id` é o id do tópico). Escrita só por RPC `security definer` (`create_topic`, `edit_topic`, `delete_topic` e o `post_comment` estendido); leitura por uma view `topic_list`. No front, o núcleo ganha as chamadas em `community-core.js`, e as telas moram num módulo novo `threads.js` (`window.Threads`), no mesmo molde do `news.js`.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql), JavaScript sem framework, testes em Node (`vm`) e Playwright com Chromium contra `scripts/fake_supabase.js`.

**Spec:** `docs/superpowers/specs/2026-11-07-threads-livres-design.md`

## Global Constraints

- Branch de trabalho `previa-2025`. Nada de push, nada na `main` e nenhuma migração no banco de produção sem o dono pedir (Task 7).
- Nunca travessão em texto do site, sempre hífen.
- Toda regra mora no banco. Esconder botão não protege nada.
- Título de 5 a 120 caracteres (depois de `btrim`), texto de 0 a 2.000. Limite de 3 threads por hora e 10 por dia por conta.
- Editar título e texto: só o autor, nos primeiros 15 minutos (a mesma regra do comentário). Apagar: o autor ou admin.
- Conta apagada não leva a thread: `topics.author_id` é `on delete set null`, e o autor aparece como "conta apagada", sem link.
- Ordem das listas: última atividade, a mais recente primeiro (último comentário vivo, ou a abertura se não houver comentário).
- Painel da home: 5 linhas, no fim de `.vp-trilho-esq`, embaixo do ranking. Mockup aprovado em `.superpowers/brainstorm/threads/home-b.png`.
- Nome "Threads" no menu (depois de Ranking, antes de Cartinhas), no painel e nas páginas. Rotas `#/threads`, `#/threads/nova`, `#/threads/<uuid>`.
- Nada escondido: sem rolagem lateral. Título longo leva reticências no painel e na lista, com o título inteiro na dica (`dica.js`, atributo `title`), e quebra linha na página da thread.
- Todo bloco de dado com fundo sólido; troca de conteúdo com o slide de 220ms; vermelho nunca é dado.
- Threads livres não entram na faixa "Atividade recente".
- Sem eventos novos no Umami (o dono decidiu não medir comunidade). O pageview que o `render()` já dispara continua como está.

## Review Focus

1. Thread apagada aberta por link antigo ou por notificação: a página diz que a thread foi apagada e não mostra comentário nem caixa de comentar; `post_comment` recusa no banco. (Task 1 e Task 6)
2. Autor que apagou a conta: painel, lista e página mostram "conta apagada" sem link, e nenhum `null` ou `undefined` vaza para a tela. (Task 2 e Task 6)
3. `p_subject_id` que não é uuid em `post_comment('topic', ...)` pelo console: erro legível, nunca erro de conversão de tipo nem thread criada. (Task 1)
4. Título só com espaços, ou com 4 caracteres depois do `btrim`: recusado no banco com mensagem em português, e o formulário mostra a mensagem sem perder o que foi digitado. (Task 1 e Task 6)
5. Quem abriu a thread responde a si mesmo ou é mencionado no próprio comentário: nenhum aviso. Quem abriu a thread e também é o autor do comentário respondido recebe um aviso só, nunca dois. (Task 1 e Task 2)

---

### Task 1: Banco - tabela, RPCs, view e testes SQL

**Files:**
- Create: `supabase/migrations/0008_threads_livres.sql`
- Modify: `supabase/tests/rls_test.sql` (casos novos antes do `rollback` final)
- Modify: `supabase/tests/positive_test.sql` (casos novos antes do `rollback` final)
- Modify: `supabase/README.md` (linha da migração na tabela de arquivos e consultas de moderação de thread)

**Interfaces:**
- Produces (SQL, tudo em `public`):
  - `topics(id uuid pk default gen_random_uuid(), author_id uuid null references profiles(id) on delete set null, title text not null, body text not null default '', created_at timestamptz not null default now(), edited_at timestamptz, deleted_at timestamptz)`. Checks: `char_length(title) <= 120`, `char_length(body) <= 2000`. Título vazio só é permitido com `deleted_at` preenchido.
  - `threads_subject_kind_check` passa a aceitar `'topic'`; check novo `threads_topic_subject_format`: `subject_kind <> 'topic' or subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`.
  - `notifications_kind_check` passa a aceitar `'topic_reply'`.
  - `create_topic(p_title text, p_body text) returns uuid`: devolve o id do tópico e cria na mesma transação a linha `threads ('topic', <id>::text)`.
  - `edit_topic(p_topic_id uuid, p_title text, p_body text) returns void`.
  - `delete_topic(p_topic_id uuid) returns void`: põe `title = ''`, `body = ''` e `deleted_at = now()`. Não apaga linhas.
  - `post_comment(p_kind, p_subject_id, p_body, p_parent_id)`, mesma assinatura, redefinida.
  - View `topic_list` (`security_invoker = true`) com as colunas `id, title, created_at, edited_at, author_username (null se a conta foi apagada), respostas int, ultima_atividade timestamptz`. Só tópicos com `deleted_at is null`. `respostas` conta os comentários vivos da thread do tópico, respostas encadeadas incluídas.
  - RLS: `topics` com leitura liberada para `anon` e `authenticated` e nenhuma escrita direta (só as RPCs). `grant select` na view para `anon` e `authenticated`. `execute` das três RPCs novas só para `authenticated`, com `revoke ... from public` antes, como no `0003`.

- [ ] **Step 1: Escrever os casos que precisam falhar em `rls_test.sql`**

Cada caso grava uma linha em `_r` com `esperado = 'ok'`, no estilo dos casos que já existem:
- `post_comment('topic', 'nao-e-uuid', 'x')` levanta exceção e não cria linha em `threads`.
- `post_comment('topic', <uuid que não existe>, 'x')` levanta `thread nao existe`.
- `post_comment` numa thread apagada por `delete_topic` levanta `thread nao existe`.
- Bruno chama `edit_topic` e `delete_topic` na thread da Alice e as duas recusam com `sem permissao`.
- `create_topic` com título `'    '` e com `'abcd'` recusa; com 121 caracteres também recusa.
- A quarta `create_topic` da Alice na mesma hora recusa com `muitas threads seguidas, espere um pouco`.
- `insert into public.topics` direto, como `authenticated`, falha por permissão.
- `edit_topic` com `created_at` recuado 16 minutos (o teste roda o `update` como `postgres` antes) recusa.

- [ ] **Step 2: Escrever os casos que precisam passar em `positive_test.sql`**

- Alice cria uma thread (`create_topic('Quem leva a Univavá?', '')`): a função devolve um id, `topic_list` tem 1 linha com `respostas = 0`, `author_username = 'alice_teste'` e `ultima_atividade = created_at`.
- Bruno comenta: `respostas = 1` e `ultima_atividade` igual à data do comentário. Alice tem 1 notificação `topic_reply`.
- Alice comenta na própria thread: nenhuma notificação nova para ela.
- Bruno responde a um comentário da Alice dentro da thread da Alice e a menciona com `@alice_teste`: Alice recebe exatamente 1 notificação por esse comentário (a de `reply`).
- Alice edita título e texto dentro de 15 minutos: muda, e `edited_at` fica preenchido.
- Alice apaga: some da `topic_list`, e `title` e `body` ficam vazios.
- Em outra thread aberta pela Alice e já comentada pelo Bruno, `delete from auth.users where id = alice` (rodado como `postgres`): a thread continua na `topic_list` com `author_username` nulo, e o comentário do Bruno continua lá.

- [ ] **Step 3: Escrever `0008_threads_livres.sql`**

Ordem no arquivo: tabela e checks, RLS e grants, checks de `threads` e de `notifications`, `create_topic`, `edit_topic`, `delete_topic`, `post_comment`, view, grants de `execute`. Comentários no estilo dos arquivos anteriores: o porquê, sem acento.
- `create_topic`: as mesmas guardas do `post_comment` (`nao autenticado`, `conta suspensa`). Título de 5 a 120 caracteres depois do `btrim`, com a mensagem `titulo precisa ter entre 5 e 120 caracteres`. Texto de até 2.000. Limite contando os tópicos do autor, apagados incluídos: no máximo 3 em 1 hora (`muitas threads seguidas, espere um pouco`) e 10 em 1 dia (`limite diario de threads atingido`).
- `edit_topic`: mesmas validações de tamanho. Só o próprio autor, com o tópico vivo e `created_at > now() - interval '15 minutes'`; senão `so da para editar thread propria, nos primeiros 15 minutos`.
- `delete_topic`: autor ou `is_admin()`; senão `sem permissao`. Se o tópico não existe ou já foi apagado: `thread nao encontrada`.
- `post_comment`: o corpo de hoje (de `0003`), mais duas coisas. (a) Logo depois das guardas, quando `p_kind = 'topic'`: confere `p_subject_id` com a regex de uuid **antes** de qualquer `::uuid`, e confere que existe tópico vivo com esse id; senão `thread nao existe`. (b) Depois do aviso de resposta: `topic_reply` para `topics.author_id` quando ele não é nulo, não é o autor do comentário e não é quem já recebeu o `reply`. O laço de menções exclui também esse autor quando ele já foi avisado.
- Cabeçalho do arquivo: esta migração só vai para o banco junto com o front na `main` (Task 7). O site no ar não sabe desenhar `topic`.

- [ ] **Step 4: Verificar sem tocar no banco de produção**

Não há banco de desenvolvimento acessível daqui, e a senha do banco é do dono. A verificação real acontece na Task 7: o dono cola num único bloco `begin; <0008>; <rls_test>; <positive_test>; rollback;`. Nesta task:
- Confira a sintaxe com `npx --yes pgsql-parser` ou, se não houver rede, `node -e` com `require('pg-query-parser')`. Se nenhum dos dois estiver disponível, diga isso no relatório e não invente um verde.
- Releia o `0008` contra `0001`-`0007` atrás de nome de constraint errado. O check de `notifications` se chama `notifications_kind_check`: confirme no arquivo antes de dar `drop`.

- [ ] **Step 5: README**

Linha `migrations/0008_threads_livres.sql | Threads livres (tópicos), notificação topic_reply` na tabela. Seção de moderação com três consultas: listar as últimas 50 threads com autor, apagar uma thread como admin (`delete_topic` não serve para o SQL Editor sem `auth.uid()`, então um `update topics set title='', body='', deleted_at=now() where id = ...`) e listar comentários de uma thread.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0008_threads_livres.sql supabase/tests/rls_test.sql supabase/tests/positive_test.sql supabase/README.md
git commit -m "threads: tabela de topicos, RPCs, view e testes SQL (nao aplicado no banco)"
```

---

### Task 2: Supabase falso e núcleo do front

**Files:**
- Modify: `scripts/fake_supabase.js`
- Modify: `community-core.js`
- Create: `scripts/test_threads_core.js`

**Interfaces:**
- Consumes: as RPCs e a view da Task 1, com os mesmos nomes, argumentos e mensagens de erro.
- Produces, em `window.Community`:
  - `listarTopicos({ pagina = 1, porPagina = 50 }) -> Promise<{ itens: TopicoResumo[], total: number }>`, onde `TopicoResumo = { id, title, created_at, edited_at, author_username: string|null, respostas: number, ultima_atividade: string }`. Ordem: `ultima_atividade` decrescente. Usa `.range()` e `count: "exact"`.
  - `topicosRecentes() -> TopicoResumo[]`, síncrono, a partir do cache. `carregarResumo()` passa a preenchê-lo com as 5 primeiras, em paralelo com o que já busca.
  - `topico(id) -> Promise<Topico|null>`, onde `Topico = { id, title, body, created_at, edited_at, deleted_at, author_id, autor: { username, role, fav_team, fav_player } | null }`. Devolve `null` quando o id não é uuid ou não existe; com `deleted_at` preenchido, devolve o tópico assim mesmo.
  - `criarTopico(titulo, texto) -> Promise<string>` (o id), `editarTopico(id, titulo, texto) -> Promise<void>`, `apagarTopico(id) -> Promise<void>`. As três atualizam o cache de recentes e chamam `invalidarContagens()`.
  - `titulosDeTopicos(ids: string[]) -> Promise<void>` preenche o cache de títulos (só de tópicos vivos). `tituloDoTopico(id) -> string|null` é síncrono.
  - `listarNotificacoes()` passa a trazer `comments(thread_id, threads(subject_kind, subject_id))` embutido em cada item.
- Produces, em `scripts/fake_supabase.js`: tabela `topics`, view `topic_list`, RPCs `create_topic`, `edit_topic` e `delete_topic`, `post_comment` com as regras de `topic` e o aviso `topic_reply`, `.range(de, ate)` e `select(..., { count: "exact" })` devolvendo `count`, embed de `comments -> threads` em `notifications`, e uma semente opcional `cfg.topicos: [{ id, autor, title, body, minutosAtras, apagado }]`.

- [ ] **Step 1: Escrever `scripts/test_threads_core.js` (falhando)**

Roda `fake_supabase.js` e `community-core.js` num contexto `vm`, com `window`, `localStorage` falso e `setTimeout`, e o `atraso` do falso em `[0, 0]`. Asserções:
- Alice entra, `criarTopico("Quem leva a Univavá?", "")` devolve id; `listarTopicos()` devolve `total === 1` e `itens[0].respostas === 0`.
- `criarTopico("abcd", "")` rejeita com mensagem contendo `entre 5 e 120`.
- A quarta `criarTopico` na mesma hora rejeita com `muitas threads seguidas`.
- Bruno comenta em `("topic", id)`. Depois disso `listarTopicos().itens[0].respostas === 1`, e a thread comentada fica à frente de uma thread mais nova sem comentário.
- Alice: `listarNotificacoes()` tem 1 item com `kind === "topic_reply"` e `comments.threads.subject_id === id`.
- Bruno responde a um comentário da Alice dentro da thread da Alice: Alice recebe 1 aviso novo, não 2.
- `apagarTopico(id)` faz o tópico sumir de `listarTopicos()`, e `comentar("topic", id, "x")` rejeita com `thread nao existe`.
- Com a semente de um tópico de `autor: null`: `topico(id).autor === null` e `listarTopicos().itens[0].author_username === null`.
- Depois de `carregarResumo()`, `topicosRecentes().length <= 5`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/test_threads_core.js`
Expected: FAIL (`criarTopico is not a function`).

- [ ] **Step 3: Implementar no falso e no núcleo**

No falso, as regras e as mensagens são as mesmas da Task 1, porque o falso é o banco dos testes de tela. No núcleo, siga o estilo de `comentar` e `apagarComentario`: `if (error) throw error`, e `await invalidarContagens()` depois de escrever.

- [ ] **Step 4: Rodar e ver passar, junto com os testes que já existem**

Run: `node scripts/test_threads_core.js && node scripts/test_comentarios_memoria.js && node scripts/test_cartinhas.js`
Expected: os três terminam sem erro.

- [ ] **Step 5: Commit**

```bash
git add scripts/fake_supabase.js community-core.js scripts/test_threads_core.js
git commit -m "threads: nucleo do front e Supabase falso com topicos"
```

---

### Task 3: Mockups da lista, da thread e do formulário (PARA AQUI)

**Files:**
- Create: `.superpowers/brainstorm/threads/injeta-paginas.js` (fora do git)
- Create: capturas `.superpowers/brainstorm/threads/<tela>-<a|b|c>.png`

O painel da home já foi aprovado. As outras três telas passam por escolha do dono antes de virar código, como foi feito com Partidas, Eventos, Notícias e Equipes.

- [ ] **Step 1:** Suba `univlr-static` (`.claude/launch.json`). No Playwright, a 1440px, injete sobre a página de Partidas (`#/matches`, que é a base das páginas novas: colunas da home e lista de 922px) de 2 a 3 versões de cada tela, com threads de exemplo inventadas. Há um exemplo de injeção em `.superpowers/brainstorm/threads/injeta.js`.
  - Lista: as colunas Tópico, Respostas, Autor e Atividade da HLTV. "+ Nova thread" no cabeçalho da lista. Paginação `paginacaoDaLista`. Variar o que vai na coluna lateral (nada, ou as threads com mais respostas da semana) e a densidade da linha.
  - Página da thread: título, autor com o selo do comentário, data, texto, e embaixo o bloco de comentários. Variar se o cabeçalho é um cartão sólido ou uma faixa.
  - Formulário: título e texto, botões Publicar e Cancelar. Variar se é página inteira ou o mesmo cartão da página da thread.
  - Cada versão também a 375px.
- [ ] **Step 2:** Mostre as opções no companheiro visual (`skills/brainstorming/visual-companion.md`) e **pare até o dono escolher**. Registre a escolha e o arquivo do mockup no topo da Task 4 antes de seguir.

---

### Task 4: Telas - painel da home, lista, formulário, thread, menu e rota

> **Escolha do dono em 07/11/2026:** lista **A** (tabela da HLTV em 922px, bloco "Nova conversa" com o botão no trilho esquerdo; no celular, linhas compactas), thread **A** (cartão sólido com título, autor, data, texto e Editar/Apagar; outras threads e o botão no trilho esquerdo), formulário **B** (escrever no próprio cartão da thread, com Publicar e Cancelar no pé). Mockups em `.superpowers/brainstorm/threads/` (`lista-a-*`, `thread-a-*`, `form-b-*`) e o injetor em `injeta-paginas.js`.

**Files:**
- Create: `threads.js`
- Modify: `index.html` (`<script src="threads.js?v=1">` depois de `news.js`; subir `?v=` de `app.js`, `community-core.js`, `comments.js`, `auth.js`, `profile.js` e `placar.css` quando mudarem)
- Modify: `app.js`: `navItems` ganha `["threads", "Threads"]` depois de `ranking`. O mapa de rótulos (perto de `news: "Notícias"`) ganha `threads: "Threads"`. `pages` ganha `threads: (id) => window.Threads.renderThreads(id)`. `renderHomeCompact()` acrescenta `${window.Threads ? window.Threads.painelHome() : ""}` no fim de `.vp-trilho-esq`.
- Modify: `placar.css` (estilos com prefixo `th-`)
- Modify: `scripts/build_home.js`, só se o teste da home acusar diferença de estrutura

**Interfaces:**
- Consumes: Task 2 (`listarTopicos`, `topicosRecentes`, `topico`, `criarTopico`, `editarTopico`, `apagarTopico`), `window.Comments.shell/montar/quando/avatar`, `window.Auth.abrir("entrar")`, `paginacaoDaLista`, `routeQuery()`, `Shell()`.
- Produces: `window.Threads = { painelHome(): string, renderThreads(id?: string): void, hrefDaThread(id: string): string }`.

- [ ] **Step 1: Teste da home e do menu (falhando)**

Em `scripts/test_visual_placar.js`, acrescente:
- `navItems` tem `["threads", "Threads"]` logo depois de `["ranking", "Ranking"]`.
- Com `Community.topicosRecentes` devolvendo 7 itens, `Threads.painelHome()` desenha 5 `.th-linha`, um link `#/threads` com o texto "Ver todas" e um botão "+ Nova thread".
- Com 0 itens, desenha o texto de lugar vazio `Nenhuma thread ainda. Comece a primeira.` e o botão.
- Com `author_username: null`, a linha diz `conta apagada` e não tem link para perfil.

Run: `node scripts/test_visual_placar.js`. Expected: FAIL.

- [ ] **Step 2: Implementar `threads.js`**

- `painelHome()`: síncrono, a partir de `topicosRecentes()`, como o mockup B (`th-painel`, cabeçalho `vp-sec` com "Ver todas", 5 `th-linha` com título, `autor · quando` e o número de respostas, e "+ Nova thread" embaixo). O título leva `title` com o texto inteiro, para a dica.
- `renderThreads(id)`: sem id, a lista (`?pagina=`, 50 por página). `"nova"`, o formulário. Um uuid, a thread. Qualquer outra coisa, "Thread não encontrada". Siga o carregamento assíncrono de `news.js` (casca primeiro e depois o conteúdo), com o visual escolhido na Task 3.
- "+ Nova thread" e a rota `nova` sem login: `window.Auth.abrir("entrar")`. Na rota `nova`, a tela mostra o motivo e o botão de entrar. Conta suspensa (`Community.banido()`): o formulário não aparece, só o aviso.
- Formulário: ao publicar, chama `criarTopico` e vai para `#/threads/<id>`. Com erro, `Community.mensagemDeErro(erro)` aparece no formulário, e título e texto continuam preenchidos.
- Página da thread: autor com `Comments.avatar` e o selo do comentário (ou `conta apagada`). `Comments.corpo(body)` para o texto, que tem a mesma formatação do comentário. "editada" quando há `edited_at`. Editar e Apagar só para o autor, e Editar só nos primeiros 15 minutos. Apagar pede confirmação e volta para `#/threads`. Embaixo, `Comments.shell("topic", id)`, e `Comments.montar("topic", id)` depois do render. Thread apagada: o título vira `Thread apagada`, sem texto e sem bloco de comentários.

- [ ] **Step 3: Rodar e ver passar**

Run: `node scripts/test_visual_placar.js && node scripts/test_threads_core.js`
Expected: os dois terminam sem erro.

- [ ] **Step 4: Commit**

```bash
git add threads.js index.html app.js placar.css scripts/test_visual_placar.js
git commit -m "threads: painel na home, lista, formulario e pagina da thread"
```

---

### Task 5: Encaixes - assunto, atividade, perfil e notificações

**Files:**
- Modify: `comments.js` (`assuntoDaThread`, `linhasDeAtividade`, `ROTULO_TIPO`)
- Modify: `profile.js` (carrega os títulos antes de desenhar)
- Modify: `auth.js` (texto e link da notificação)
- Test: `scripts/test_threads_core.js` (casos novos)

**Interfaces:**
- Consumes: `Community.tituloDoTopico`, `Community.titulosDeTopicos`, `Threads.hrefDaThread`.
- Produces: `assuntoDaThread("topic", id) -> { href: "#/threads/<id>", nome: <título> } | null`. Devolve `null` quando o título não está no cache, que é o caso da thread apagada.

- [ ] **Step 1: Casos (falhando)** em `scripts/test_threads_core.js`, rodando também `comments.js` no contexto:
- Com o título no cache, `Comments.assuntoDaThread("topic", id)` devolve `{ href: "#/threads/" + id, nome: "Quem leva a Univavá?" }`.
- Com uma linha `topic` em `thread_counts` mais nova que todas as outras, `Comments.atividadeFaixa(5)` não a mostra.
- `ROTULO_TIPO.topic === "thread"`.

- [ ] **Step 2: Rodar e ver falhar.** Run: `node scripts/test_threads_core.js`. Expected: FAIL.

- [ ] **Step 3: Implementar**
- `comments.js`: o ramo `topic` em `assuntoDaThread`, que lê `Community.tituloDoTopico(id)`. `linhasDeAtividade` filtra `subject_kind !== "topic"` antes do `slice`: `atividadeRecente` recebe `limite + 20` e o corte final acontece depois do filtro, senão a faixa mostra menos de 5.
- `profile.js`: antes de desenhar a atividade do perfil, `await Community.titulosDeTopicos(ids dos comentários com subject_kind "topic")`. A thread apagada cai no "conteúdo removido" que já existe.
- `auth.js`: o texto passa a seguir o `kind`: `mention` "Mencionaram você", `reply` "Responderam você", `topic_reply` "Comentaram na sua thread". Quando `n.comments.threads.subject_kind === "topic"`, o link é `#/threads/<subject_id>?c=<comment_id>`. Os outros tipos continuam com o link de hoje.

- [ ] **Step 4: Rodar e ver passar.** Run: `node scripts/test_threads_core.js && node scripts/test_comentarios_memoria.js`. Expected: os dois terminam sem erro.

- [ ] **Step 5: Commit**

```bash
git add comments.js profile.js auth.js scripts/test_threads_core.js index.html
git commit -m "threads: assunto, perfil e notificacao de comentario na thread"
```

---

### Task 6: Teste no navegador, de ponta a ponta

**Files:**
- Create: `scripts/test_threads_navegador.cjs` (no molde de `scripts/test_cartinhas_navegador.cjs`: Chromium do Playwright, servidor estático próprio e `fake_supabase.js` injetado no lugar de `supabase-js.js`)

- [ ] **Step 1: Escrever o teste.** Sementes: Alice, Bruno, 7 tópicos (um de `autor: null`, um com título de 120 caracteres, um apagado). Passos e asserções, a 1440px:
- Home: o painel está dentro de `.vp-trilho-esq`, depois do ranking, com 5 linhas. A linha da conta apagada diz "conta apagada". O título longo tem reticências e `title` com o texto inteiro. `document.documentElement.scrollWidth <= innerWidth`.
- O menu tem "Threads" entre Ranking e Cartinhas e fica ativo em `#/threads`.
- Sem login, "+ Nova thread" abre o convite de login.
- Alice entra, abre `#/threads/nova` e publica com o título `"   abcd  "`. Aparece o erro, e o texto digitado continua no campo. Ela corrige, publica e cai em `#/threads/<id>`.
- Bruno comenta. Alice vê 1 notificação "Comentaram na sua thread", clica, e cai na thread com o comentário destacado (`?c=`).
- A thread comentada vai para o topo de `#/threads`. Com 60 tópicos semeados, a página 2 existe e mostra 10.
- Alice apaga a thread. Ela some da lista e do painel. Abrir o link antigo mostra "Thread apagada", sem caixa de comentário.
- Repete home, lista e thread a 375px: sem rolagem lateral, e o painel vem logo depois do ranking.
- Capturas em `process.argv[2]`, se a pasta for passada.

- [ ] **Step 2: Rodar.** Run: `node scripts/test_threads_navegador.cjs .superpowers/brainstorm/threads/capturas`. Expected: termina sem erro. Se o Playwright não estiver instalado para Node, use o Playwright MCP para os mesmos passos e diga no relatório que o arquivo de teste não rodou.

- [ ] **Step 3: Rodar todos os testes de front.**

Run: `for t in scripts/test_*.js; do node "$t" || echo "FALHOU $t"; done`
Expected: nenhuma linha `FALHOU`. Se algum teste já falhava antes desta branch, prove com `git stash` e diga isso.

- [ ] **Step 4: Commit**

```bash
git add scripts/test_threads_navegador.cjs
git commit -m "threads: teste de ponta a ponta no navegador"
```

---

### Task 7: Ir ao ar (só com o dono)

Esta task não roda sozinha: cada passo depende de o dono pedir.

- [ ] **Step 1:** Leve os commits das Tasks 1, 2, 4, 5 e 6 para a `main` (cherry-pick, como as outras páginas). Teste com os dados de 2026, rodando de novo a Task 6 sobre a `main`.
- [ ] **Step 2:** Entregue ao dono um bloco único para o SQL Editor: `begin;` + `0008` + `rls_test.sql` + `positive_test.sql` + `rollback;`. Toda linha precisa estar `ok`. Nada fica no banco.
- [ ] **Step 3:** Com tudo `ok`, o dono aplica o `0008` sozinho e faz o push da `main`. A ordem é migração primeiro e push logo depois: o front novo sem a migração mostra o painel vazio e erra ao publicar, e a migração sem o front novo nunca é usada.
- [ ] **Step 4:** No ar, abra uma thread de verdade com a conta do dono, comente com outra conta, confira a notificação e apague a thread de teste.
- [ ] **Step 5:** Atualize a memória `univlr-comunidade-supabase.md` com o tipo `topic` e as decisões do documento.
