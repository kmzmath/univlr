# Threads livres

Data: 07/11/2026. Branch de trabalho: `previa-2025`.

## Por que

Hoje toda conversa do UNIVLR fica presa a um assunto do site: partida, campeonato, equipe, jogador, notícia ou cartinha. Quando alguém quer falar de outra coisa (quem leva um campeonato, procurar quinto jogador, palpite, ideia para o site), não tem onde, e a conversa vai parar num grupo de WhatsApp e se perde lá.

A ideia é que qualquer pessoa com conta possa abrir uma thread sobre o que quiser, com título e texto, e os outros comentem nela. O sucesso é a conversa livre da comunidade acontecer no site e não no WhatsApp.

A referência é o fórum da HLTV, que já é a referência declarada de toda a parte de comunidade do site.

## Objetivos

- Quem tem conta abre uma thread com título e texto.
- Dentro da thread, a conversa usa o sistema de comentários que já existe: respostas encadeadas, votos +1/-1, denúncia, notificação de resposta e menção, conta suspensa e o limite anti-spam.
- Um painel **Threads** na home, no trilho da esquerda, embaixo do ranking (opção B, escolhida pelo dono sobre a home real). Cada linha tem título, quem abriu, há quanto tempo e número de respostas. "Ver todas" no cabeçalho, como em Últimas partidas, e um botão "+ Nova thread" embaixo da lista. Mockup aprovado: `.superpowers/brainstorm/threads/home-b.png` (fora do git).
- Uma página com a lista completa no formato da HLTV: colunas Tópico, Respostas, Autor, Atividade, paginada como as outras listas do site.
- Uma página para cada thread.
- Um item **Threads** no menu do topo (pedido do dono).

## Não objetivos

- **Sem seções ou categorias.** A HLTV divide o fórum em seis seções; o dono recusou isso: quem abre a thread não escolhe assunto, tudo cai numa lista única.
- Thread ligada a uma partida, equipe ou campeonato. Isso já existe nos comentários das próprias páginas.
- Threads fixadas, enquetes, imagens, anexos, tags.
- Busca de threads na busca global (pode vir depois).
- Medir threads no Umami. O dono decidiu não medir comunidade.
- Tela de moderação. A moderação continua por SQL, por decisão do dono (`supabase/README.md`).

## O que seria fracasso mesmo funcionando

- Abrir thread ser um caminho mais difícil que mandar mensagem no WhatsApp: formulário com campo demais, escolha obrigatória, confirmação a mais.
- Um segundo sistema de comentários, com voto, denúncia ou notificação diferentes dos que já existem.
- Regra só na interface. O site não tem servidor: o navegador fala direto com o Postgres pela chave publicável, então toda regra (quem pode abrir, limites, edição) mora no banco, em RLS para leitura e RPC `security definer` para escrita, como no resto da comunidade.
- Mexer na composição da home além de acrescentar o painel no trilho da esquerda.

## Como é hoje (para quem vai construir)

- Banco: `supabase/migrations/0001` a `0007`. `threads` tem `subject_kind` e `subject_id`, com um `check` que lista os tipos aceitos (hoje `match`, `event`, `article`, `player`, `team`, `card`) e `unique (subject_kind, subject_id)`. `comments` tem `thread_id`, `parent_id`, corpo de até 2.000 caracteres e apagamento suave (`deleted_at`). A thread nasce sozinha dentro de `post_comment()` no primeiro comentário.
- `post_comment()` (`0003_functions.sql`) já faz: exige login, barra conta suspensa, limita a 5 comentários por minuto e 50 por dia, notifica resposta e menção `@fulano`.
- `thread_counts` (`0005_contagens.sql`) devolve todas as contagens e o `ultimo_em` de uma vez; o front guarda em memória (`community-core.js`). A atividade recente da home é montada daí.
- Front: `comments.js` expõe `window.Comments` (`montar`, `assuntoDaThread`, `atividadeFaixa` etc.). `assuntoDaThread(kind, id)` diz o nome e o link de cada assunto, e é usado pela atividade recente e pelo perfil do usuário.
- Home: `renderHomeCompact()` em `app.js`, em três trilhos (`vp-trilho-esq`, `-meio`, `-dir`). O painel novo entra no fim de `vp-trilho-esq`.
- Menu do topo: `app.js`, perto do link de Cartinhas.

## Decisões do dono

- Assunto livre, sem categoria nenhuma.
- Painel na home: opção B (trilho da esquerda, embaixo do ranking), com título, autor, tempo e respostas por linha, "Ver todas" e "+ Nova thread".
- Lista completa no formato da HLTV, paginada.
- Conversa dentro da thread reaproveita os comentários existentes.
- Aba própria no menu do topo.
- **Conta apagada não leva a thread junto.** Quando quem abriu apaga a conta, a thread fica no ar com título, texto e toda a conversa dos outros, e o autor aparece como "conta apagada", sem link. No banco isso pede que o autor da thread seja anulável (`on delete set null`, e não o `cascade` dos comentários), um ajuste no `delete_account()` se preciso, e o estado "conta apagada" no painel, na lista e na página da thread. Os comentários da pessoa continuam sumindo como hoje.

## Decisões minhas (o dono pode trocar)

- **Nome:** "Threads" no menu, no painel e no título das páginas, porque é a palavra que o dono usa. O item do menu entra depois de Ranking e antes de Cartinhas.
- **Rotas:** `#/threads` (lista), `#/threads/nova` (formulário) e `#/threads/<id>` (thread). Formulário em rota própria, para o Voltar do navegador funcionar e o link poder ser compartilhado.
- **Formulário:** título obrigatório (de 5 a 120 caracteres) e texto opcional (até 2.000, o mesmo limite do comentário). Sem mais campos. Texto opcional porque muita conversa de WhatsApp é só uma pergunta, e o título já basta.
- **Quem pode:** ler é público; abrir thread exige conta e conta não suspensa, a mesma regra de comentar. Sem conta, "+ Nova thread" abre o mesmo convite de login que o resto da comunidade usa.
- **Limite de abertura:** 3 threads por hora e 10 por dia por conta, no banco. Mais apertado que o de comentário porque cada thread ocupa uma linha da home.
- **Ordem:** pela última atividade, como na HLTV: a thread que recebeu comentário agora sobe para o topo; sem comentário, vale a data de abertura. Isso vale para o painel e para a lista.
- **Painel da home:** 5 linhas. Sem nenhuma thread, mostra uma frase curta de lugar vazio e o botão "+ Nova thread".
- **Editar e apagar:** o autor edita título e texto e apaga a própria thread, com as mesmas regras de editar e apagar comentário. Thread apagada some das listas; os comentários dela deixam de aparecer junto.
- **Notificação:** quem abriu a thread é notificado a cada comentário novo nela (exceto os próprios). É o aviso que faz alguém voltar para a conversa que começou. Resposta e menção continuam como são hoje, sem aviso duplicado para a mesma pessoa pelo mesmo comentário.
- **Atividade recente:** as threads livres **não** entram na faixa de atividade recente, porque já têm painel próprio logo ao lado. No perfil do usuário, os comentários feitos em threads aparecem como os outros, com o título da thread como assunto.
- **Página da thread:** título, autor com o selo que o comentário já usa, data, texto e, embaixo, o bloco de comentários existente.
- **Telas novas com mockup antes de código.** A lista completa, a página da thread e o formulário seguem a página de Partidas como base (colunas da home, lista de 922px) e passam por mockup sobre o site real para o dono escolher, como foi feito com as outras páginas. O painel da home já foi aprovado.

## Restrições do projeto

- Nunca travessão em texto do site, sempre hífen.
- Nada escondido: sem rolagem lateral e sem informação escondida. Título longo quebra linha na página da thread; no painel e na lista ele pode ser cortado com reticências e aparecer inteiro na dica (`dica.js`), que é o padrão do site.
- Todo bloco de dado com fundo sólido sobre o fundo de escudos.
- Toda troca de conteúdo usa o slide de 220ms do site.
- Abaixo de 760px a home vira uma coluna; o painel vem logo depois do ranking.
- Vermelho é marca e nunca dado: número de respostas e estados usam as cores de dado do site.

## O que fica com quem constrói

- **Modelo de dados.** Pode ser uma tabela nova (`topics` ou parecida, com título, texto, autor, datas e apagamento suave) mais um `subject_kind` novo em `threads` apontando para ela, ou outra forma, desde que comentário, voto, denúncia e notificação continuem sendo os de hoje. O `check` de `subject_kind` e o `assuntoDaThread` precisam aprender o tipo novo; o `fake_supabase.js` dos testes também.
- Se a contagem e a última atividade vêm da `thread_counts` ou de uma view nova.
- Denunciar a thread em si (e não só os comentários): fazer se sair barato reaproveitando `reports`; senão, fica para depois e a moderação por SQL resolve.
- Paginação: seguir o que a página de Jogadores e a de Partidas fazem hoje.
- Ordem de entrega (decisão minha, depois da revisão): a migração vai para o banco de produção assim que é aplicada, e o `post_comment()` não confere se o assunto existe, então ela **só é aplicada junto com o front indo para a `main`**, com a autorização do dono. Até lá o desenvolvimento roda contra o `scripts/fake_supabase.js`. Assim o site no ar nunca recebe thread, notificação ou contagem de um tipo que ele não sabe desenhar. O front segue o caminho das outras páginas: commit na `previa-2025` e depois levado para a `main`, testado com os dados de 2026. Nada vai para o ar nem para o GitHub sem o dono pedir.
- Se abrir thread conta no limite de comentários, se "Respostas" inclui respostas encadeadas (sugestão: inclui, como a contagem de hoje), o nome e o desenho da notificação nova.
- Consultas de moderação novas (apagar thread, listar as últimas) entram no `supabase/README.md`.
