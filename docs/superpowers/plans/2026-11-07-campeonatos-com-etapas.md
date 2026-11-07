# Campeonatos com etapas - plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr uma camada "campeonato" por cima das etapas, com página única e um Geral nas 5 abas, uma linha por campeonato em Eventos, na home e na busca, e troféus com o nome do campeonato, sem mudar ranking nem dado gravado.

**Architecture:** Um cadastro explícito no `app.js` (`CAMPEONATOS_COM_ETAPAS`) e uma função de carga (`aplicarCampeonatos`) que marca cada etapa e compõe o nome dela só no cliente. Um "agregado" por campeonato, montado sob demanda a partir de `state.db`, alimenta Eventos, home e busca. O Geral reaproveita as abas que já existem, passando um evento sintético e a união das séries das etapas. A divisão da Aliança 2024 é a única tarefa que mexe em dado, e fica por último.

**Tech Stack:** JavaScript sem framework (`app.js`, SPA por hash), testes em Node com `vm` (molde de `scripts/test_visual_placar.js`), pipeline Python + Node.

**Spec:** `docs/superpowers/specs/2026-11-07-campeonatos-com-etapas-design.md`

## Global Constraints

- O `database.json`, o `ranking-weights.json` e os snapshots de ranking não mudam nas Tarefas 1 a 5. `aplicarCampeonatos` nunca é chamada por `build_database.js` nem por `aggregateEvents`.
- `#/events/<id da etapa>` e `#/tournaments/<id da etapa>` continuam abrindo a etapa, com aba e filtros (`/estatisticas?equipe=...`).
- Travessão nunca, só hífen, em qualquer texto, comentário ou rótulo novo.
- Nada escondido e nada de rolagem lateral: a faixa e as etapas na linha de Eventos quebram linha.
- Animação: toda troca de conteúdo usa o slide de 220ms que já existe (`panelSlideSnapshot`/`playPanelSlide`).
- Gravação de artefato por script usa `scripts/write_with_retry.js`.
- Commit só com ordem do dono. O Codex trabalha na mesma pasta: antes de gravar `app.js`, guarde uma cópia de base e confira se ele mexeu (`~/.codex/sessions`). No commit, entra só o trecho desta tarefa (método `git merge-file` da memória do projeto). A árvore já tem `players.xlsx`, `database.json`, `home.json`, `metadata.json` e `team-profiles.json` modificados por outro trabalho: não os misture no commit sem perguntar.
- Testes do projeto passando ao fim de cada tarefa: `node scripts/test_*.js` (todos) e `python scripts/test_analise_matches_alignment.py`.

## Review Focus

1. **Etapa escondida dentro de um campeonato** (`eventIsVisible` falso): o agregado ignora a etapa, e um campeonato sem etapa visível não aparece em lugar nenhum. Teste na Tarefa 1.
2. **Campeonato em andamento** (UNIVAVÁ, final por jogar, playoffs só com "3-4"): a colocação final mostra o que existe e as vagas TBD do pódio, sem quebrar, e o status é o da etapa ao vivo. Teste na Tarefa 2.
3. **Link antigo com aba e filtro** (`#/events/univava-playoffs/estatisticas?equipe=ufu_saints`): abre a etapa na aba, com o filtro aplicado. Trocar para o Geral mantém a aba. Teste na Tarefa 2.
4. **Home pintada pelo `home.json`:** o agregado montado com etapas faltando daria equipes e partidas erradas. O resumo leva todas as etapas visíveis de cada campeonato listado. Teste na Tarefa 3.
5. **Busca que bate nos dois níveis** ("jubs rn", "pre-jubs", "univava classificatoria 2"): o campeonato aparece quando a busca bate no nome dele, e a etapa sozinha só quando a busca vai além disso. Teste na Tarefa 4.

---

### Task 1: Cadastro, nome composto e agregado

**Files:**
- Modify: `app.js`:
  - perto de `TOURNAMENT_OVERRIDES` (linha ~270): cadastro e separador;
  - `tournamentSerie` e `tournamentEtapas` (~27384);
  - `init` (~20075, ~20086, ~20097): chamar `aplicarCampeonatos(state.db)` depois de cada atribuição de `state.db`.
- Modify: `scripts/build_home.js` (`main`, depois de `state.db = db`): chamar `aplicarCampeonatos(state.db)`.
- Create: `scripts/test_campeonatos_etapas.js` (molde do `test_visual_placar.js`, mas com o `database.json` real decodificado por `db-codec.js` e posto em `state.db` por `vm.runInContext`).

**Interfaces:**
- Produces:
  - `const SEPARADOR_DE_ETAPA = ": "`. A Tarefa 5 pode trocar.
  - `const CAMPEONATOS_COM_ETAPAS = [{ id, nome, nomesAntigos: string[], decide: idDaEtapa, etapas: [{ id, nome, nivel: number, paralela?: true, artigo?: "da" | "do" }] }]`, com os 9 campeonatos da tabela do spec, na ordem do dono. `nivel`:
    - a etapa que decide é 1, e a seguinte não paralela é 2, e assim por diante;
    - classificatórias de um mesmo campeonato dividem o mesmo `nivel`, e Qualify 1 e 2 também;
    - paralelas levam o `nivel` da etapa que decide e `paralela: true`;
    - `artigo` só nas paralelas: "da" Practice, "da" Off Season, "do" Pré-JUBS SP.
  - Até a Tarefa 6, a Aliança 2024 aponta para os ids atuais: `alianca-2024-grupos-playoffs` (nome "Grupos e Playoffs", `nivel` 1, `decide`) e as classificatórias.
  - `nomesAntigos`:
    - `jubs-2026`: "JUBS Goiás 2026";
    - `jubs-2025`: "JUBS RN 2025";
    - `jubs-2024`: "JUBS 2024";
    - `lbeu-2025-1-split` e `lbeu-2025-2-split`: "LBEU 2025".
  - `aplicarCampeonatos(db): void`. Para cada etapa cadastrada presente em `db.tournaments`, grava:
    - `campeonatoId` e `etapaNome`;
    - `nomeOriginal`, que guarda o `name` de antes;
    - `name = nome + SEPARADOR_DE_ETAPA + etapaNome`.

    É idempotente: se `nomeOriginal` já existe, não recompõe. Também zera o cache do agregado.
  - `campeonatoPorId(id): Agregado | null` e `campeonatoDaEtapa(event): Agregado | null`.
  - O `Agregado` tem:
    - `{ isCampeonato: true, id, nome, nomesAntigos }`;
    - `etapas`: os eventos visíveis, na ordem do cadastro;
    - `decide`: o evento;
    - `paralelas: Set<id>`;
    - `start` e `end`: o menor e o maior das etapas;
    - `status`: o da etapa ao vivo, ou então o da etapa que decide;
    - `tier` e `logo`: os da etapa que decide;
    - `banner`: o da etapa que decide, ou então o da etapa mais recente que tiver;
    - `teams`: ids únicos de todas as etapas;
    - `matches`: a soma.

    Fica em cache por identidade de `state.db`. Sem etapa visível, devolve `null`.
  - `tournamentSerie(event)` passa a devolver `{ nome: campeonato.nome, etapa: event.etapaNome }`, ou `null`. `tournamentEtapas(event)` passa a devolver `campeonatoDaEtapa(event)?.etapas || []`. `tournamentOrigens` continua funcionando sem mudança.

- [ ] **Step 1: Escrever o teste que falha.** Em `scripts/test_campeonatos_etapas.js`, com o banco real:
  - Cadastro:
    - todo `etapas[].id` existe em `state.db.tournaments`;
    - nenhuma etapa aparece em dois campeonatos;
    - `decide` está em `etapas`;
    - nenhum id de campeonato é id de etapa.
  - Antes de `aplicarCampeonatos`, nenhum `name` do `database.json` contém `": "`. É o controle de que o build não compõe nomes.
  - Depois, o nome composto:
    - `jubs-etapa-presencial`: `name === "JUBS 2026 - Goiás: Etapa Presencial"` e `nomeOriginal === "JUBS Goiás 2026 - Etapa Presencial"`;
    - `copa-xv-6-2025` fica intacta e `tournamentEtapas(copaXv)` dá `[]`.
  - Idempotência: chamar `aplicarCampeonatos` duas vezes dá o mesmo `name`.
  - Agregado:
    - `campeonatoPorId("univava").etapas.map(e => e.id)` é `["univava-playoffs","univava-fase-de-grupos","univava-classificatoria-4","univava-classificatoria-3","univava-classificatoria-2","univava-classificatoria-1"]`;
    - `teams.length === 62`;
    - `matches` é a soma de `matches` das 6.
  - `campeonatoPorId("lbeu-2025-1-split").paralelas` tem off-season e practice.
  - Review Focus 1: marcar `univava-classificatoria-1` como `hidden` numa cópia faz `etapas.length === 5`. Marcar as 6 faz `campeonatoPorId("univava") === null`.
- [ ] **Step 2: Rodar e ver falhar.** `node scripts/test_campeonatos_etapas.js` deve dar ReferenceError em `aplicarCampeonatos`.
- [ ] **Step 3: Implementar** o cadastro, `aplicarCampeonatos`, o agregado, as duas funções reescritas e as chamadas no `init` e no `build_home.js`.
- [ ] **Step 4: Rodar e ver passar.** O teste novo e todos os `scripts/test_*.js`.
- [ ] **Step 5: Conferir que o build não mudou.** `node scripts/build_database.js` numa cópia (ou só conferir por grep que `aplicarCampeonatos` não aparece no caminho do build) e comparar com o `database.json` atual: idênticos. Depois `node scripts/build_home.js`: a única diferença no `home.json` são os nomes das etapas.

### Task 2: Página do campeonato, faixa e o Geral nas 5 abas

**Files:**
- Modify: `app.js`:
  - `renderTournamentDetail` (~27147);
  - `tournamentEtapasNav` (~27399);
  - `tournamentHero` (~27360);
  - `tournamentJogos` e vizinhas (~29033);
  - `tournamentTeamStatRows` (~29771);
  - `tournamentStandingsRows` (só o uso).
- Modify: `styles.css` ou `placar.css`: só a faixa (`.vp-camp-etapas`) e a lista de etapas do Geral.
- Test: `scripts/test_campeonatos_etapas.js`.

**Interfaces:**
- Consumes: `campeonatoPorId`, `campeonatoDaEtapa` e `Agregado` da Tarefa 1.
- Produces:
  - `eventoDoGeral(camp): Event`, um evento sintético com:
    - `id`, `name`, `start`, `end`, `status`, `tier`, `logo`, `banner` e `teams` do agregado;
    - `placements = colocacaoFinal(camp)`;
    - `mapPool` unido;
    - `organizer` da etapa que decide;
    - `isGeral: true`.
  - `seriesDoCampeonato(camp): Series[]`: a união de `matchSeriesForEvent` das etapas, por data decrescente.
  - `colocacaoFinal(camp): { range: string, id: teamId, etapaId?: string }[]`:
    1. Primeiro, as linhas de `trophyPlacementRows(decide)`.
    2. Depois, para cada `nivel` seguinte (2, 3, ...), só etapas não paralelas e só equipes ainda não colocadas que tenham pelo menos uma série registrada naquele nível:
       - nível de uma etapa só: as linhas da colocação dela, sem "Classificado";
       - nível com várias etapas: um grupo só, com `range` = `${n+1}-${n+k}` (n = já colocadas, k = do grupo).
    3. Dentro de um mesmo `range`, a ordem é a das Equipes Participantes (ranking na data, provisórias no fim, alfabética pt-BR).
  - `tournamentEtapasNav(event, camp, activeTab)`: "Geral" (`#/events/<camp.id>`) e uma entrada por etapa (`#/events/<etapa.id>`), com `/<aba>` quando a aba não é `overview`. Marca `aria-current` na ativa e uma marca de ao vivo na etapa com status ao vivo.

- [ ] **Step 1: Escrever o teste que falha.**
  - `colocacaoFinal(campeonatoPorId("univava"))`:
    - as linhas até a última de `univava-playoffs` são as dos playoffs;
    - depois vêm `9-11`, `12-14` e `15-16`, da fase de grupos;
    - a última faixa é `17-61`, com 45 equipes;
    - 61 ids distintos, cada um uma vez;
    - a equipe inscrita sem série não aparece.
  - Review Focus 2: com os playoffs só com "3-4", a função não lança erro, e o status do agregado é o da etapa ao vivo.
  - `colocacaoFinal(lbeu-2025-1-split)` não contém equipe que só jogou a Practice.
  - `seriesDoCampeonato(univava).length` é a soma das séries das 6 etapas.
  - `renderTournamentDetail`:
    - `"univava"` escreve no `#app` um `h1` "UNIVAVÁ", a faixa com "Geral" marcado e 7 entradas;
    - `"univava-playoffs"` escreve o mesmo `h1` e marca "Playoffs".
  - Review Focus 3: com `location.hash = "#/events/univava-playoffs/estatisticas?equipe=ufu_saints"`, a aba ativa é `estatisticas`, a tabela só tem a UFU, e o link "Geral" da faixa é `#/events/univava/estatisticas`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a rota e o topo.** `renderTournamentDetail(id)`:
  - com `campeonatoPorId(id)`: Geral com `eventoDoGeral` e `seriesDoCampeonato`;
  - com etapa de campeonato: a página atual da etapa, mas com o `tournamentHero` do `eventoDoGeral` (nome sem etapa, datas totais) e a faixa nova;
  - sem campeonato: como hoje.

  Os comentários vão em `Comments.shell("event", id)`, com o id da rota (o Geral tem conversa própria). Trocar de etapa mantém a aba: os filtros vão no `?` e caem sozinhos quando a equipe não existe ali, pelo comportamento atual de cada aba.
- [ ] **Step 4: Implementar a Visão Geral do Geral.** `tournamentGeralVisao(camp, matches)`:
  - a Colocação, no desenho atual, a partir de `colocacaoFinal`;
  - as Equipes Participantes, no desenho atual, com o ranking "Início" na data de início da primeira etapa;
  - a lista "Etapas": uma linha por etapa com datas (`eventTimeRange`), resumo do formato, número de equipes e desfecho (campeão, ou "N classificadas"), com link para a etapa;
  - a coluna Informações, com o resumo do agregado.

  Sem chave e sem tabela suíça.
- [ ] **Step 5: Implementar Jogos, Estatísticas, Mapas e Agentes do Geral.**
  - Jogos: `tournamentJogosPorEtapa(camp, filtro)`. Para cada etapa, um título com o nome dela e, embaixo, os grupos por fase que `tournamentJogos(etapa, matchSeriesForEvent(etapa.id))` já monta, com o mesmo filtro.
  - Estatísticas, Mapas e Agentes: as funções atuais com `(eventoDoGeral(camp), seriesDoCampeonato(camp))`.
  - `tournamentTeamStatRows` recebe a colocação do Geral como `standings`.
- [ ] **Step 6: Rodar e ver passar.** O teste novo e todos os `scripts/test_*.js`.
- [ ] **Step 7: Conferir no navegador** (`preview_start` "univlr-static", rotas `#/events/univava`, `#/events/univava-playoffs`, `#/events/lbeu-2025-1-split/estatisticas`), no desktop e no celular, pelo método da memória de verificação visual:
  - a faixa quebra linha sem rolagem;
  - o slide de 220ms roda ao trocar de etapa;
  - console sem erro.
  - Somar o Geral: os rounds de 3 jogadores que jogaram várias etapas do UNIVAVÁ, no Geral, batem com a soma dos rounds nas etapas.

### Task 3: Eventos e home

**Files:**
- Modify: `app.js`:
  - `eventsFiltrados` (~35882);
  - `eventDirectoryRow` (~35590);
  - `eventListRow` (~35533);
  - `renderEventsPage` (~24345);
  - `renderHomeCompact` (~23579).
- Modify: `scripts/build_home.js` (~211).
- Test: `scripts/test_campeonatos_etapas.js`.

**Interfaces:**
- Consumes: o `Agregado` da Tarefa 1.
- Produces:
  - `listaDeCampeonatos(eventos: Event[]): (Event | Agregado)[]`. Percorre a lista na ordem recebida e troca cada etapa pelo agregado do campeonato dela, na primeira vez que aparece (as outras etapas somem). Eventos sozinhos passam como estão.
  - `etapasNaLinha(camp): string`, com o HTML das etapas como links, na ordem do cadastro.

- [ ] **Step 1: Escrever o teste que falha.**
  - `listaDeCampeonatos(sortedEvents("end")).length === 25`.
  - O HTML de `renderEventsPage()` tem 25 linhas, a contagem "25 campeonatos", e a linha do UNIVAVÁ com 6 links de etapa.
  - Filtrar por tier S mantém o UNIVAVÁ (as etapas S são fase de grupos e playoffs).
  - Review Focus 4: rodar a função de resumo do `build_home.js` sobre o banco real. Ela fica exportada ou separada em `resumoDosEventos(db)` para o teste. Para cada campeonato entre os 8 primeiros de `listaDeCampeonatos(sortedEvents("recent"))`, todas as etapas visíveis dele estão no resumo, e `homeSummaryDb(resumo)` dá agregados com os mesmos `teams.length` e `matches` do banco inteiro.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
  - `eventsFiltrados` filtra as etapas e depois aplica `listaDeCampeonatos`: o campeonato entra se qualquer etapa passou.
  - O total do cabeçalho é `listaDeCampeonatos(visibleTournaments()).length`.
  - `eventDirectoryRow` e `eventListRow` aceitam o agregado (nome, datas totais, tier, equipes, partidas, desfecho da que decide, capa no hover via `atributosDaCapa`) e escrevem `etapasNaLinha`. Na home, a linha diz qual etapa está ao vivo.
  - No `build_home.js`, os 8 primeiros de `listaDeCampeonatos(sortedEvents("recent"))`, expandidos para as etapas visíveis de cada agregado, no formato atual de evento do resumo.
- [ ] **Step 4: Rodar e ver passar**, e rodar `node scripts/build_home.js`. A linha "campeonatos: N" passa a contar etapas, o que é esperado.
- [ ] **Step 5: Conferir no navegador** `#/events` e a home (também o primeiro render: recarregar com o cache limpo e ver a home já agrupada antes do banco chegar), no desktop e no celular.

### Task 4: Busca e troféus

**Files:**
- Modify: `app.js`:
  - `searchEntities` (~36137) e `searchTournamentResult` (~36214);
  - o filtro de `bindSearch` (~36037);
  - `teamCapaTrofeus` (~30829) e `trofeusLista` (~31021);
  - os rótulos de MVP de `playerMvpAwards`.
- Test: `scripts/test_campeonatos_etapas.js`.

**Interfaces:**
- Consumes: `Agregado`, `campeonatoDaEtapa`, `event.etapaNome` e `event.nomeOriginal` (Tarefa 1).
- Produces:
  - Item de busca com `mostrarSe?: (query: string) => boolean`. O filtro de `bindSearch` passa a exigir `(!item.mostrarSe || item.mostrarSe(query))` além do `includes`.
  - `resultadosDeCampeonato(): SearchItem[]`:
    - um item por agregado, com `path: "tournaments/<camp.id>"`, `label: camp.nome` e `searchText` = nome + `nomesAntigos`;
    - um item por etapa, com `label: event.name`, `searchText` = nome composto + `nomeOriginal`, e `mostrarSe = (q) => !normalize([camp.nome, ...camp.nomesAntigos].join(" ")).includes(q)`;
    - campeonatos sozinhos como hoje.
  - `rotuloDoTrofeu(trophy): { titulo: string, campeonato: string }`:
    - etapa que decide: `{ titulo: placementLabel, campeonato: camp.nome }`;
    - outra etapa de campeonato: `titulo = `${placementLabel} ${artigo || "da"} ${etapaNome}``;
    - sem campeonato: `{ titulo: placementLabel, campeonato: event.name }`.

    O texto curto é `${titulo}, ${campeonato}`.

- [ ] **Step 1: Escrever o teste que falha.** Usando o mesmo filtro de `bindSearch`, extraído para `filtrarBusca(query): SearchItem[]`, que é o que o `bindSearch` passa a chamar:
  - `"univava"`: um só resultado do tipo campeonato, `label` "UNIVAVÁ";
  - `"classificatoria 2"`: os campeonatos dos resultados de etapa são exatamente UNIVAVÁ, Copa Aliança 2025 e Copa Aliança 2024.1;
  - `"jubs rn"`: só o campeonato "JUBS 2025 - Natal";
  - `"practice"`: as duas Practice do LBEU;
  - `"copa xv"`: a Copa XV;
  - Review Focus 5: `"pre-jubs"` dá a etapa Pré-JUBS SP, e `"univava classificatoria 2"` dá só a etapa.
  - Troféus:
    - o troféu de campeão da `ceub_octopus` em `jubs-etapa-presencial` dá `"Campeão, JUBS 2026 - Goiás"`;
    - o da `wolf_gaming` em `lbeu-2025-1-split-off-season` dá `"Campeão da Off Season, LBEU 2025 - 1º Split"`;
    - o da `pucc_cardinals` em `jubs-pre-jubs-sp` dá `"Campeão do Pré-JUBS SP, JUBS 2026 - Goiás"`;
    - o de `aoc` dá `"Campeão, AOC"`;
    - o link do troféu continua `#/tournaments/<id da etapa>`;
    - o MVP de `jubs-etapa-presencial` dá `"MVP, JUBS 2026 - Goiás"`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Busca, os dois desenhos de troféu (`title`/`aria-label` da capa e o `strong`/`small` da lista) e o MVP.
- [ ] **Step 4: Rodar e ver passar**, e todos os `scripts/test_*.js`.
- [ ] **Step 5: Conferir no navegador** a busca com os 7 casos e a capa da CEUB Octopus e da Wolf Gaming (o balão de dica mostra o texto novo).

### Task 5: Modelos para o dono escolher

**Files:**
- Modify: `app.js` e o CSS da Tarefa 2.

**Interfaces:**
- Consumes: `tournamentEtapasNav` (Tarefa 2), `eventDirectoryRow` e `etapasNaLinha` (Tarefa 3), e `SEPARADOR_DE_ETAPA` (Tarefa 1).

- [ ] **Step 1: Pôr um seletor provisório na própria página** (o padrão das outras páginas: `?modelo=` lido só por estas três peças):
  - Faixa: A, abas de texto como hoje, com "Geral" destacado; B, blocos com as datas de cada etapa.
  - Linha de Eventos: A, etapas em texto corrido embaixo do nome; B, etapas como rótulos na coluna da direita.
  - Separador: `": "` ou `" · "`.
- [ ] **Step 2: Conferir os dois modelos** no desktop e no celular, com UNIVAVÁ, LBEU 1º Split e JUBS 2026, e mandar os prints ao dono.
- [ ] **Step 3: Parar e esperar a escolha dele.**
- [ ] **Step 4: Apagar os modelos que perderam** e o seletor, e fixar o separador escolhido. Os testes das Tarefas 1 a 4 que citam `": "` passam a usar o separador escolhido.

### Task 6: Divisão da Copa Aliança 2024 e medição do ranking

**Files:**
- Move: `campeonatos/Copa Aliança 2024.1/Grupos e playoffs/*` para `.../Grupos/` e `.../Playoffs/`, e `campeonatos/Copa Aliança 2024.2/Grupos e playoffs/*` para `.../Fase de Grupos/` e `.../Playoffs/`, cada pasta com o próprio `campeonato.json`.
- Modify:
  - `app.js`: `TOURNAMENT_OVERRIDES` dos dois eventos e `CAMPEONATOS_COM_ETAPAS`;
  - `ranking-weights.json`.
- Regenerate: `metadata.json`, `data-sources.json`, `team-profiles.json`, `database.json`, `home.json`.
- Create: script de comparação de snapshots no scratchpad, que não entra no repositório.

**Interfaces:**
- Ids novos:
  - `alianca-2024-grupos` e `alianca-2024-playoffs`;
  - `alianca-2024-2-fase-de-grupos` e `alianca-2024-2-playoffs`.
- O `campeonatos/.../Grupos e playoffs` deixa de existir.

- [ ] **Step 1: Guardar o antes.** Copiar `database.json` e `ranking-weights.json` para o scratchpad, e de lá extrair `rankingSnapshots` (equipe, corte, nota, posição) para um JSON.
- [ ] **Step 2: Separar os arquivos por série.** Pelo número do arquivo (`seriesCode`):
  - 2024.1, playoffs: 2, 4, 6, 8, 10, 12 e 14;
  - 2024.2, playoffs: 2 e os pares de 4 a 28;
  - o resto é o suíço.

  Conferir as contagens: 2024.1 tem 37 séries, sendo 7 de playoffs e 30 de suíço; 2024.2 tem 40, sendo 9 de playoffs (4, 6, 8, 10, 12, 18, 20, 22 e 26) e 31 de suíço. As séries 2, 14, 16, 24 e 28 não têm arquivo e vivem só no override, como resultado sem estatística. Os `campeonato.json`:
  - têm o `startAt` e o `endAt` da primeira e da última série de cada um;
  - mantêm organizer, source, sourceId e logo do atual;
  - levam os nomes "Copa Aliança 2024.1 - Grupos", "Copa Aliança 2024.1 - Playoffs", "Copa Aliança 2024.2 - Fase de Grupos" e "Copa Aliança 2024.2 - Playoffs".
- [ ] **Step 3: Dividir o override.**
  - Grupos: as `swiss.rounds` "Suíço - Rodada N", `standings`, e a colocação "Classificado" ×8 e 9-11, 12-14, 15-16.
  - Playoffs: chave encadeada (`layout: "linked"`, `band`, `from`), com os `code` iguais ao número do arquivo.
    - 2024.1: eliminação simples, Rodada 1 (2, 4, 6, 8), Rodada 2 (10, 12) e final (14), com a colocação 1, 2, 3-4, 5-8 atual.
    - 2024.2: chave superior (4 a 16), chave inferior (18 a 28) e final (2), com 1, 2, 3, 4, 5-6, 7-8.
  - O `mvp`, se houver, vai para os playoffs.
- [ ] **Step 4: Dividir os pesos** em `ranking-weights.json`:
  - Grupos: `placementPoints` `{ Classificado: 0, "9-11": 25, "12-14": 20, "15-16": 15 }`, `defaultPhase: "regular"`, `qualifiesTo: <id dos playoffs>`, e `teams: 16`.
  - Playoffs 2024.1: `{ "1": 100, "2": 80, "3-4": 45, "5-8": 35 }`.
  - Playoffs 2024.2: `{ "1": 100, "2": 80, "3": 45, "4": 45, "5-6": 35, "7-8": 35 }`.
  - Os dois playoffs: `defaultPhase: "playoffs"`, uma regra `final` na série da final (14 na 2024.1, 2 na 2024.2), e `teams: 8`.
  - `endAt` de cada um = o do `campeonato.json`.
  - Apagar as duas entradas antigas.
- [ ] **Step 5: Atualizar o cadastro.** Aliança 2024.1 com Playoffs (`decide`, nível 1), Grupos (2) e as classificatórias (3). Aliança 2024.2 com Playoffs (1), Fase de Grupos (2) e Classificatória (3).
- [ ] **Step 6: Rodar o pipeline inteiro:**
  1. `python scripts/build_metadata.py`
  2. `node scripts/build_lineup_history.js`
  3. `node scripts/build_database.js` (encadeia o `build_home`)
  4. `node scripts/apply_team_colors.js`

  Conferir os 4 ids novos no `data-sources.json`, e que nenhum id velho sobrou em `app.js`, `ranking-weights.json` e `data-sources.json` (`grep -rn "grupos-playoffs"`).
- [ ] **Step 7: Medir o ranking.** Comparar os snapshots de antes e depois, corte a corte. O esperado é que só mudem cortes depois de 2024-05 e só para equipes que ficaram de 9º a 16º no suíço de uma das duas edições. Qualquer outra mudança é bug: parar e investigar. Controle de que o comparador funciona: comparar o antes com ele mesmo dá 0 diferenças, e com um snapshot alterado à mão dá 1.
- [ ] **Step 8: Rodar todos os testes**, e o caso novo em `scripts/test_campeonatos_etapas.js`: `campeonatoPorId("alianca-2024-1").etapas` é Playoffs, Grupos, Classificatória 2 e 1, e `colocacaoFinal` dá 1 a 8 dos playoffs e 9-11, 12-14 e 15-16 do suíço.
- [ ] **Step 9: Conferir no navegador** `#/events/alianca-2024-1`, `#/events/alianca-2024-playoffs` (chave desenhada) e `#/events/alianca-2024-2-fase-de-grupos` (tabela suíça).
- [ ] **Step 10: Parar e mostrar ao dono** a lista de mudanças do ranking (equipe, corte, nota antes e depois, posição antes e depois). Só commitar com o ok dele.
