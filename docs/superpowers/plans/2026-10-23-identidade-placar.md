# Identidade Placar: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aplicar na branch `claude/visual-placar` o visual "Placar" descrito no documento: sem caixa dentro de caixa, menos altura por página, home em trilhos.

**Architecture:** uma folha nova, `placar.css`, carregada depois do `styles.css`, guarda todo componente novo (classes com prefixo `vp-`) e as poucas sobrescritas do que continua com a marcação de hoje (topo, rodapé). No `app.js`, as funções que desenham cada componente trocam de marcação no lugar, mantendo nome, assinatura e os ganchos de JS (slide, comentários, favoritos, `.nome-rolante`). Regra que vira código morto no `styles.css` sai no fim, com a checagem de prefixo antes de interpolação.

**Tech Stack:** HTML gerado por template string no `app.js`, CSS puro, `node` para os testes de contrato (`vm` carregando o `app.js`, o mesmo padrão de `scripts/test_qualifier_bracket.js`), navegador para medida.

**Spec:** `docs/superpowers/specs/2026-10-23-identidade-placar-design.md`, com os mockups em `docs/superpowers/specs/2026-10-23-identidade-placar/`.

## Global Constraints

- Nenhum travessão em texto, código ou commit. `grep -c "—"` nos arquivos tocados dá 0.
- Tokens do `:root` não mudam. Vermelho (`--brand`) só em: indicador do menu, aba ativa, botão Entrar, ponto de "Em andamento".
- Cor de risco, barra e linha de gráfico: `--team-line` de `teamAccentStyle(team)` (ele vem de `teamChartInk`, 4,5:1 contra o painel). O banho do Placar também usa `--team-line`, misturado com transparente.
- Título de seção: Barlow Condensed 600, 30px (26px abaixo de 760px), primeira letra maiúscula, sem traço vermelho.
- Texto de linha 13px; numeral Condensed só de 16px para cima; piso de 11px.
- Nada de `text-transform: uppercase` em rótulo novo.
- Hover só com `transform`, `opacity`, `color`, `box-shadow` e variável de cor; nada que mude geometria.
- Slide de troca de conteúdo: 220ms `ease` (`PANEL_SLIDE_MS`). Sem guard de `prefers-reduced-motion`.
- Constante de topo nova no `app.js` vai acima da chamada de `init()`.
- Classe nova sempre com prefixo `vp-` e conferida com `grep` antes de usar.
- Toda trilha de grid que precisa encolher: `minmax(0, 1fr)`. Toda lista com subgrade: margens como trilhas vazias nas pontas, nunca padding na linha.
- Breakpoints usados: 1180px e 760px (os de hoje: 560, 760, 940, 1180).
- Nada muda em dados, `scripts/build_*`, rotas ou `database.json`.

## Como medir (vale para toda tarefa de página)

Servidor da worktree: entrada `univlr-placar` no `.claude/launch.json` da worktree, `node local-static-server.cjs` na porta 8020. No navegador, com `localStorage["univlr-convite-conta"] = {"visto": agora, "dispensas": 5}` para o convite de conta não cobrir a página:

- **Altura:** `document.documentElement.scrollHeight` a 1440x900 e a 390x844.
- **Estouro:** todo elemento com `getBoundingClientRect().right > innerWidth + 1` que não tenha ancestral com `overflowX` em auto, scroll, hidden ou clip e `scrollWidth > clientWidth`. Antes de cada medida, o controle negativo: um `div` de 600px inserido a 390px tem que aparecer na lista.
- **Console:** nenhum erro novo em relação à main.
- **Build:** `node scripts/build_database.js` termina com código 0.

Alturas de chegada (dos mockups): home 1086 e 2857; partida 1367 e 2518; equipe 1245 e 1945; jogador 1393 e 2636; campeonato 2423 e 3545. Valem com tolerância de 15%, porque o site real tem coisas que o mockup não tem (selo de comentário, nomes rolantes).

## Review Focus

- **Equipe sem cor ou toda branca** (MackLogic White, `#ffffff`/`#ffffff`): risco e banho em cinza legível, nunca branco puro nem invisível. Teste na Tarefa 3.
- **Série sem arte de mapa** (`mapArtError` cai no PNG ou some): a linha continua legível, sem retângulo preto. Teste na Tarefa 3.
- **Nome muito longo** ("JUBS Goiás 2026 - Etapa Presencial", "CEUB Octopus Vulgaris"): corta com reticências dentro do teto de 210/230px e não empurra a lista. Teste nas Tarefas 3 e 4.
- **Semana sem líderes** (ninguém com 4 mapas): o carrossel não quebra e mostra o estado vazio de hoje. Teste na Tarefa 5.
- **Campeonato sem chave** (suíço, pontos corridos) **e em andamento:** a página não some com a lista de participantes nem com a tabela. Teste na Tarefa 10.

---

### Task 1: Folha nova, servidor da worktree e teste de contrato

**Files:**
- Create: `placar.css`
- Create: `scripts/test_visual_placar.js`
- Modify: `index.html` (link da folha nova logo depois de `styles.css?v=300`)
- Create (fora do git): `.claude/launch.json` da worktree, entrada `univlr-placar` na porta 8020

**Interfaces:**
- Produces: `scripts/test_visual_placar.js` monta um contexto `vm` igual ao de `test_qualifier_bracket.js` e expõe `globalThis.__vp = { ... }` com as funções que as tarefas seguintes acrescentam. Cada tarefa acrescenta suas asserções no mesmo arquivo.

- [ ] **Step 1: teste** `index.html` tem `<link rel="stylesheet" href="placar.css?v=1" />` depois do link do `styles.css`, e `placar.css` existe e começa pelo comentário que explica a camada.
- [ ] **Step 2:** rodar `node scripts/test_visual_placar.js` e ver falhar.
- [ ] **Step 3:** criar `placar.css` (só o comentário de cabeçalho) e o link no `index.html`.
- [ ] **Step 4:** `node scripts/test_visual_placar.js` passa; `node scripts/build_database.js` termina com 0.
- [ ] **Step 5:** commit `placar: folha nova e teste de contrato`.

### Task 2: Base comum: topo, rodapé, título de seção, abas

**Files:**
- Modify: `app.js` `Shell()` (rodapé), `sectionHead()`, `panelTitle()`, `panelFooterLink()`
- Modify: `placar.css` (topo, menu, busca, Entrar, rodapé, `.vp-sec`, abas de equipe, jogador e campeonato)
- Test: `scripts/test_visual_placar.js`

**Interfaces:**
- Produces: `sectionHead(title, desc, routeName, linkLabel)` passa a devolver `<header class="vp-sec"><h2>…</h2><span class="vp-sec-aside">desc</span><a class="vp-sec-more" href="#/route">linkLabel</a></header>`, com `desc` e link opcionais. `panelTitle(title, routeName, linkLabel)` devolve o mesmo `vp-sec`. Todas as tarefas de página usam essas duas.
- Produces: classes `vp-sec`, `vp-sec-aside`, `vp-sec-more`.

- [ ] **Step 1: teste** `sectionHead("Elenco atual", "Texto", "teams/x/roster", "Ver reservas")` contém `class="vp-sec"`, `<h2>Elenco atual</h2>`, `class="vp-sec-aside">Texto<` e `href="#/teams/x/roster"`; sem `desc` não emite `vp-sec-aside`; o HTML do `Shell` contém `Estatísticas do cenário universitário brasileiro de VALORANT.` no rodapé.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** trocar a marcação das três funções e do rodapé. Em `placar.css`: topo com 56px, menu sem caixa alta em 14px 600 e `--muted`, ativo em `--ink` (o `.nav-indicator` vermelho fica), busca com fundo `--surface`, raio 3px, `/` como texto simples; Entrar em `--brand` com texto `--on-brand`; rodapé numa linha só; `.vp-sec` com o título da seção 4.2 do documento; abas (`.team-tabs`, abas do jogador e do campeonato) no desenho do menu, com borda inferior de 1px `--line`.
- [ ] **Step 4:** teste passa; build com 0; no navegador, a home e uma equipe abrem sem erro e o título "Ranking" medido é Barlow Condensed 30px.
- [ ] **Step 5:** commit `placar: topo, rodape, titulos e abas`.

### Task 3: Linha de partida no Placar, com o mapa de fundo

**Files:**
- Modify: `app.js` `matchResultRow()`, `matchMapBanner()` (vira a faixa de fatias da linha), `listaDeResultados()` e os quatro contêineres que recebem linhas (home, aba de partidas da equipe, campeonato, jogador)
- Modify: `placar.css` (`.vp-lista`, `.vp-m`, `.vp-t`, `.vp-mapas`, `.vp-maplist`, `.vp-ev`, `.vp-dia`)
- Test: `scripts/test_visual_placar.js`

**Interfaces:**
- Consumes: `teamAccentStyle(team)` para `--team-line`; `normalizeMatchItem`, `matchListScore`, `teamLogo`, `eventLogo`, `matchSeriesHref`, `window.Comments.selo`.
- Produces: `matchResultRow(item, options)` devolve `<a class="vp-m" …>` com duas `vp-t` (uma `vp-ganhou`), a faixa `vp-mapas` e a coluna `vp-ev`. `options.kd = [k, d]` acrescenta a coluna `vp-kd`. Toda lista de linhas fica dentro de `<div class="vp-lista">` (ou `vp-lista vp-lista-kd`), e o dia vira `<p class="vp-dia">` acima da lista.

- [ ] **Step 1: teste** com uma série sintética MD3 (A 1 x 2 B, mapas Bind 13-8, Abyss 13-15, Ascent 7-13) e uma MD1 (Lotus 6-13):
  - MD3: exatamente uma `vp-t vp-ganhou` e ela é a do B; `vp-maplist` contém `Bind <small>13-8</small>`.
  - MD1: placar mostrado é `6` e `13`; `vp-maplist` contém `Lotus` sem `<small>`.
  - Cada `vp-t` traz `--team-line:` no `style`. Para uma equipe `#ffffff`/`#ffffff`, `--team-line` não é `#ffffff`.
  - Com `{ kd: [71, 41] }` aparece `71 / 41`.
  - Uma arte que falha cai no PNG de reserva (`data-fallback`) e, se também faltar, a fatia some: a linha não ganha fundo preto.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** nova marcação e CSS do componente "Placar" e "Mapa de fundo" da seção 4.1 do documento: linhas de 26px, 4px entre partidas; colunas `fit-content(230px) 30px minmax(0, 1fr) 128px` (210px nos trilhos); subgrade por partida; banho 26% para quem venceu e 11% para quem perdeu, 36% e 17% no hover; arte a 0,36 e 0,52 no hover.
- [ ] **Step 4:** teste passa; build com 0; no navegador, `#/matches` e a home mostram as linhas novas, uma partida mede 56px, e os placares de uma lista estão alinhados (mesmo `left`).
- [ ] **Step 5:** commit `placar: linha de partida com o mapa de fundo`.

### Task 4: Placa para ranking e campeonatos da home

**Files:**
- Modify: `app.js` `compactRankingRow()`, `eventListRow()`, `bindHomeEventCovers()` (o seletor muda com a classe)
- Modify: `placar.css` (`.vp-placa`, `.vp-rk`, `.vp-evrow`)
- Test: `scripts/test_visual_placar.js`

**Interfaces:**
- Produces: `compactRankingRow(team)` devolve `<a class="vp-rk pintura-de-equipe" …>` com posição, variação, escudo, nome, `N partidas` e nota, para viver dentro de `<div class="vp-placa vp-placa-rk">`. `eventListRow(event)` devolve `<a class="vp-evrow">` com logo, nome, linha de situação e datas, letra de tier e tamanho, dentro de `<div class="vp-placa vp-placa-ev">`.

- [ ] **Step 1: teste:**
  - a linha do ranking contém `pintura-de-equipe`, `data-trama=` e `48 partidas` logo antes da nota;
  - a linha de campeonato em andamento contém `vp-ao-vivo` e "Em andamento até";
  - a de campeonato finalizado não contém "Finalizado";
  - a letra de tier sai com a classe `vp-tier-a`.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** marcação e CSS da Placa (seção 4.1): grade única, linhas em subgrade, nota a 8px das partidas, linha de 38px no ranking e de 54px no campeonato. A capa do campeonato no hover continua via `bindHomeEventCovers`, agora sobre `.vp-evrow`.
- [ ] **Step 3b:** a data de campeonato em andamento vira "até 7 de nov", e a de finalizado "17 - 18 de out", sem ano. Sai de uma função `eventDatesShort(event)`.
- [ ] **Step 4:** teste passa; no navegador, o quadro do ranking termina na nota (largura menor que 360px) e a pintura acende no hover.
- [ ] **Step 5:** commit `placar: ranking e campeonatos em placa`.

### Task 5: Carrossel dos melhores da semana

**Files:**
- Modify: `app.js` `weekHighlights()`, novo `weekSlide(leader, clone)`, novo `bindWeekCarousel()`, chamada no fim de `renderHomeCompact()`
- Modify: `placar.css` (`.vp-semana`, `.vp-slide`, `.vp-passos`)
- Test: `scripts/test_visual_placar.js`

**Interfaces:**
- Consumes: `playerOfWeekLeaders()` ou `homeSummaryLeaders()`, como hoje; `PLAYER_OF_WEEK_INTERVAL_MS` (4500); `playerFigure`.
- Produces: `weekHighlights()` devolve `<section class="vp-semana">` com N `vp-slide` + 1 clone (`aria-hidden="true"`), e N botões em `.vp-passos`. `bindWeekCarousel()` liga avanço por `animationend`, clique nos passos, setas do teclado e arrasto; não faz nada se não houver `.vp-semana`.

- [ ] **Step 1: teste** com 9 líderes sintéticos: 10 `vp-slide`, o último com `aria-hidden="true"`, 9 botões com `aria-label` igual ao rótulo da categoria; com 0 líderes, o HTML contém o texto de estado vazio de hoje ("Nenhum jogador atingiu o mínimo") e nenhum `vp-slide`.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** cartão e passos como na seção 4.6 do documento: 206px de altura, foto sangrando, fundo pela `--team-line` do líder, número em 56px, tracinhos de 3px com 22px de clique, pausa em `:hover` e em `:has(:focus-visible)`, clone no fim, `transitionend` volta ao primeiro sem animação. A duração do tracinho vem de `PLAYER_OF_WEEK_INTERVAL_MS`, passada como `--vp-passo` no `style`.
- [ ] **Step 4:** teste passa; no navegador:
  - depois de 5s o trilho está em `translateX(-100%)`;
  - clicando no 9º passo, ele volta ao 1º seguindo para a frente;
  - com o ponteiro em cima, nada muda em 5s;
  - com o foco por Tab, para; com o clique, continua.
- [ ] **Step 5:** commit `placar: carrossel dos melhores da semana`.

### Task 6: Home em trilhos

**Files:**
- Modify: `app.js` `renderHomeCompact()`, `HOME_RANKING_LIMIT` (14 para 12), `HOME_RECENT_MATCH_LIMIT` (8 para 12)
- Modify: `news.js` nova `blocoTrilho()` (principal com imagem 2,3:1 e as outras duas como lista com miniatura), exportada ao lado de `blocoHome`
- Modify: `placar.css` (`.vp-home`, `.vp-trilho`, `.vp-noticias`, faixa de atividade)
- Test: `scripts/test_visual_placar.js`

**Interfaces:**
- Consumes: Tarefas 2 a 5; `window.Comments.atividadeFaixa(5)`.
- Produces: `.vp-home` com três `.vp-trilho` (esquerdo, centro, direito) e a ordem de celular da seção 5 do documento.

- [ ] **Step 1: teste:**
  - o HTML da home contém, nesta ordem: `vp-semana`, `vp-placa-rk`, as partidas, `vp-noticias` e `vp-placa-ev`;
  - as constantes valem 12 e 12;
  - `News.blocoTrilho()` sem matéria devolve `""`.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** grade `340px minmax(0, 1fr) 340px` e gap de 32px. Abaixo de 1180px, duas colunas, com notícias e campeonatos descendo lado a lado. Abaixo de 760px, uma coluna (`display: contents` nos trilhos e `order` nas seções). Partidas agrupadas por dia com `agruparPorDia`.
- [ ] **Step 4:** medir a home: no máximo 1250px a 1440 e 3300px a 390; primeira partida a no máximo 200px do topo da `.main` a 1440; sem estouro a 390 (com controle negativo); console limpo; build com 0.
- [ ] **Step 5:** commit `placar: home em trilhos`.

### Task 7: Página de partida

**Files:**
- Modify: `app.js` `renderMatchDetail()`, `matchHeroBanners()`, `matchHeroMeta()`, `matchMapTabs()`, `matchMapOverview()` (sai), `teamCompareBars()` (vira faixa espelhada), `matchMvpCard()`, `valorantScoreboard()` (as duas equipes numa tabela), `matchLineupComparison()` (lineups e histórico separados)
- Modify: `placar.css` (`.vp-hero-partida`, `.vp-abas-mapa`, `.vp-comparativo`, `.vp-espelho`, `.vp-sb`, `.vp-mvp`, `.vp-lineups`, `.vp-historico`)
- Test: `scripts/test_visual_placar.js`

**Interfaces:**
- Consumes: `bindScoreboardSort`, `bindLineupCompare` (os `data-*` continuam iguais, para o clique na linha e na foto escolher o duelo); `lineupHistoricalPlayer`, `lineupStatRows`.
- Produces: `espelhoLinha(label, valorA, valorB, fracA, fracB, cores)`, usada no comparativo e no histórico.

- [ ] **Step 1: teste** com a série real 062 (pelo `TOURNAMENT_OVERRIDES` ou um objeto sintético com os mesmos números):
  - o HTML tem um `<table class="vp-sb">` com dois `<tbody>`, cada um com uma linha `vp-sb-equipe`;
  - `espelhoLinha("Rounds", "48%", "52%", "33/69", "36/69", …)` tem duas barras com `--w:48%` e `--w:52%`, e a do B com `vp-maior`;
  - o comparativo não tem nenhuma cor `#f6132a`.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** desenho da seção 5, "Partida", do documento. O modo "Avançado" continua trocando as colunas como hoje, só com o estilo novo. A seção "Fonte" continua como está.
- [ ] **Step 4:** medir a partida 062: no máximo 1600px a 1440 e 2900px a 390, sem estouro; o clique numa linha do scoreboard troca o jogador do histórico; Padrão e Avançado alternam; build com 0.
- [ ] **Step 5:** commit `placar: pagina de partida`.

### Task 8: Página de equipe

**Files:**
- Modify: `app.js` `renderTeamDetail()` (topo), `teamRankHero()`, `teamHeroCover()`, `teamSummaryTrophyPanel()` (vai para o trilho), `teamResumoTab()` (coluna principal e trilho), `teamRosterSections()` (lista em Placa no Resumo)
- Modify: `placar.css` (`.vp-hero-equipe`, `.vp-elenco`, `.vp-trofeus`, gráfico)
- Test: `scripts/test_visual_placar.js`

**Interfaces:**
- Consumes: `teamHeroField()` (o campo animado continua atrás do topo), `teamRankingChart`, `teamSuccessionNote`, `listaDeResultados`.
- Produces: `trofeusLista(trophies)`, usada também na Tarefa 9.

- [ ] **Step 1: teste:** o Resumo de uma equipe tem a coluna principal (histórico do ranking e partidas) e o trilho (elenco e troféus); o elenco sai como `vp-elenco` com uma linha `pintura-de-equipe` por titular; o topo não tem mais o painel de troféus fora do trilho.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** desenho da seção 5, "Equipe". As outras abas (Ranking, Elenco, Partidas, Campeonatos, Stats) ganham `vp-sec` e as listas novas, sem outra mudança de estrutura.
- [ ] **Step 4:** medir `#/teams/azure_bears_black`: no máximo 1450px a 1440 e 2300px a 390, sem estouro; o slide entre abas continua; build com 0.
- [ ] **Step 5:** commit `placar: pagina de equipe`.

### Task 9: Página de jogador

**Files:**
- Modify: `app.js` `renderPlayerDetail()` (topo), o painel de dados do Resumo (uma ficha só no lugar dos quatro quadros), a lista de partidas do Resumo (`matchResultRow` com `kd`), agentes, por mapa, troféus
- Modify: `placar.css` (`.vp-hero-jogador`, `.vp-ficha`, `.vp-agentes`, `.vp-pormapa`)
- Test: `scripts/test_visual_placar.js`

**Interfaces:**
- Consumes: `trofeusLista` (Tarefa 8); `playerRatingCompositionPanel` e o painel de métricas só aparecem se algum valor não for `-`.
- Produces: `fichaJogador(player)`.

- [ ] **Step 1: teste:**
  - `fichaJogador` devolve três `vp-ficha-grupo` (Geral, Por round, Abertura e trades);
  - com todos os componentes de rAAting vazios, o Resumo não contém "Composição da rAAting 3.0";
  - com um valor presente, contém.
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** desenho da seção 5, "Jogador". O K / D da série soma `kills` e `deaths` do jogador em todos os mapas da série.
- [ ] **Step 4:** medir `#/players/aldeath`: no máximo 1600px a 1440 e 3000px a 390, sem estouro; build com 0.
- [ ] **Step 5:** commit `placar: pagina de jogador`.

### Task 10: Página de campeonato

**Files:**
- Modify: `app.js` `tournamentHero()`, `tournamentOverviewSection()`, `tournamentCuratedBracketRegion()` e o desenho de partida da chave (bye vira célula vazia, rodada é coluna de células de mesma altura), `tournamentPlacementsSection()` (classificação final com campanha), lista de participantes (só em campeonato não encerrado)
- Modify: `placar.css` (`.vp-hero-camp`, `.vp-fatos`, `.vp-podio`, `.vp-pool`, `.vp-chave`, `.vp-classif`)
- Test: `scripts/test_visual_placar.js` e `scripts/test_qualifier_bracket.js` (tem que continuar passando)

**Interfaces:**
- Produces: `campanhasDoCampeonato(event) -> Map<teamId, [vitorias, derrotas]>`, que conta as séries do campeonato, com W.O. contando e quem passou direto não contando.

- [ ] **Step 1: teste:**
  - `campanhasDoCampeonato` da Rush Series 3 dá `ceub_octopus_vulgaris` 8-1 e `azure_bears_black` 4-1;
  - a região superior da chave tem 16 células na rodada de 32, das quais 11 com `vp-bye` e sem partida dentro;
  - um campeonato `Em andamento` ainda mostra a lista de participantes;
  - um suíço (Copa LUCE Inters) continua mostrando a tabela.
- [ ] **Step 2:** rodar e ver falhar (e `test_qualifier_bracket.js` ainda passando antes da mudança).
- [ ] **Step 3:** desenho da seção 5, "Campeonato", com a chave da seção 4.6. Os cartões de "Classificado" das classificatórias continuam como estão no teste de chave, só com o estilo novo.
- [ ] **Step 4:** medir `#/events/rush-series-3`: no máximo 2800px a 1440 e 4100px a 390, com a chave rolando para o lado e sem estouro fora dela. Abrir também `univava-playoffs`, `copa-luce-inters` e `univava-classificatoria-1` sem erro. Os dois testes passam; build com 0.
- [ ] **Step 5:** commit `placar: pagina de campeonato`.

### Task 11: Páginas sem mockup, limpeza e conferência final

**Files:**
- Modify: `app.js` (listas de partidas, eventos, players e ranking completo; o que ainda usar `hub-panel`/`data-panel` como caixa em volta de caixa)
- Modify: `placar.css`; `styles.css` (remover regras cujas classes nenhum template emite mais, conferindo prefixo antes de interpolação)
- Test: `scripts/test_visual_placar.js`

- [ ] **Step 1: teste:** nenhum template do `app.js` emite `panel-title` com o traço vermelho; `grep -c "—"` em `app.js`, `placar.css`, `news.js` e `index.html` é 0.
- [ ] **Step 2:** rodar e ver falhar onde ainda houver.
- [ ] **Step 3:**
  - listas de partidas, eventos, players e ranking completo com `vp-sec` e um nível de superfície;
  - remover do `styles.css` só as regras de classes que sumiram dos templates, listadas antes de apagar e conferidas com `grep` de prefixo.
- [ ] **Step 4:** medir as nove rotas da seção "Como medir" a 1440 e a 390 e anotar antes e depois numa tabela no fim deste plano. Sem estouro, console limpo, todos os `scripts/test_*.js` passam, build com 0.
- [ ] **Step 5:** commit `placar: paginas restantes e limpeza`.

## Medida final (24/10/2026)

Altura da página (`document.documentElement.scrollHeight`) em px. "Antes" é a main local com o visual atual; "depois" é esta branch. Em todas as 18 medidas da branch, nenhum elemento estoura a tela fora de uma caixa que rola, e o controle negativo (um `div` 600px mais largo que a janela) foi detectado. Console sem erro, todos os `scripts/test_*.js` passam, build com 0.

| Página | 1440 antes | 1440 depois | 390 antes | 390 depois |
| --- | ---: | ---: | ---: | ---: |
| Home | 2169 | 1103 | 4858 | 2922 |
| Partida (série 062) | 3404 | 1594 | 7300 | 2886 |
| Equipe (Azure Bears Black) | 2645 | 1328 | 5197 | 2057 |
| Jogador (Aldeath) | 2106 | 1460 | 4558 | 2653 |
| Campeonato (Rush Series 3) | 6720 | 2437 | 12780 | 3521 |
| Partidas | 4870 | 3374 | 12124 | 3994 |
| Eventos | 3007 | 2661 | 5445 | 5162 |
| Players | 3762 | 3618 | 15893 | 15813 |
| Ranking | 4226 | 3595 | 4374 | 3807 |

Players quase não muda: a lista continua sendo a grade de cartões com foto, que não teve mockup. É a próxima candidata a virar Placa.

A limpeza tirou 36 funções do `app.js`, o `blocoHome` e o `heroi` do `news.js`, e 794 seletores do `styles.css` (535 regras e 11 blocos `@media` vazios, de 511 KB para 399 KB). Uma classe só saiu se algum template a emitia no começo da branch e nenhum a emite hoje, com conferência de prefixo para nomes montados por interpolação. A prova foi feita no navegador: as 3.020 regras vivas do CSS antigo estão no novo com as mesmas declarações, e o diff de estilos computados em 22 rotas, nas duas larguras, só mostrou o mesmo ruído de carregamento que aparece comparando o CSS antigo com ele mesmo.

## Rodada de 24/10 (retorno do dono)

O que mudou: a linha de partida voltou ao modelo antigo, mais baixa (106px para 68px); a partida ganhou o vencedor em verde, a arte das abas acesa, o scoreboard na largura toda sem rolagem (no avancado, nomes curtos e uma linha de grupos; abaixo de 1000px, um bloco por jogador com os numeros rotulados), os rounds em blocos por tempo, lineups e historico numa secao so, e a secao Fonte saiu. No ranking, a nota ficou sem a pilula verde, a linha aberta e o painel "Detalhes do ranking" foram para a Placa (sem anel, cartoes ou vermelho), e com "Detalhes da nota" ligado em tela estreita os blocos descem para uma segunda linha (antes ficavam cortados fora da tela, inclusive na main). Abas de equipe e jogador e a faixa de atividade quebram linha em vez de rolar.

Alturas (scrollHeight, main x branch):

| Rota | 1440 | 390 |
| --- | --- | --- |
| Home | 2169 para 1203 | 4858 para 3057 |
| Partida (serie) | 3404 para 1542 | 7300 para 3152 |
| Partidas | 4870 para 4036 | 12124 para 4357 |
| Equipe | 3172 para 1422 | 6024 para 2221 |
| Jogador | 2049 para 1405 | 4376 para 2606 |
| Ranking | 4226 para 3595 | 4374 para 3807 |

/partidas subiu em relacao a rodada anterior (3374 a 1440) porque a linha do modelo antigo tem 68px contra 56px da linha Placar; foi o que o dono pediu. Ainda rolam de lado no celular: o chaveamento do campeonato (dentro da propria caixa) e o menu do topo (escolha da Task 1, para o topo preso nao passar de 215px).

### Retorno de 24/10, segunda rodada

Home aprovada com dois ajustes: a nota do ranking da home tinha herdado 56px de uma classe com o mesmo nome no painel novo de detalhes (`vp-rk-nota`, renomeada para `vp-rk-nota-final`) e a foto do destaque da semana ficou na altura do cartao, com os tracinhos embaixo dele. Ranking aprovado. Na partida, a conversa e buscada uma vez por visita (antes cada clique buscava de novo; medido: abrir 1, quatro cliques 0, aba de mapa 0, sair e voltar 1; na main os mesmos cliques fazem uma busca cada), e o celular (ate 640px) mostra uma linha por jogador com K, D, A e rAAting, sempre no modo padrao. O `comments.js` da branch passou a ser o da main mais a memoria, para nao conflitar na integracao. Partida a 390: 3152 para 2246.

### Retorno de 24/10, terceira rodada

Partida: as abas de mapa subiram para cima da capa, para o print da capa ate o scoreboard sair inteiro. Campeonato: o Resumo saiu de todos, e o podio das classificatorias deixou de por "Classificado" na coluna do numero (o titulo vira "Classificados" e o rotulo vai pequeno junto da campanha). Site: o fundo quadriculado de 44px e o brilho vermelho do topo sairam; fica o fundo liso com uma luz neutra nos primeiros 520px.
