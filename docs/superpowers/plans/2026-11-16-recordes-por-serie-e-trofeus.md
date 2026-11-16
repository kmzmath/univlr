# Recordes numa série e aba Troféus - plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** seletor "Num mapa | Numa série" na aba Recordes e aba Troféus (quadro olímpico com as taças nas colunas e foto) em `#/stats/jogadores`.

**Architecture:** tudo no bloco de Estatísticas do `app.js` (depois de `statsRecordesAba`) e no bloco `.vp-st-*` do `placar.css`. Funções puras recebem as linhas ou o índice como argumento, para o teste em `vm` rodar sem banco real; as de cima leem `state`.

**Tech Stack:** JS do site sem build, teste em Node `vm` como `scripts/test_visual_placar.js`.

**Spec:** `docs/superpowers/specs/2026-11-16-recordes-por-serie-e-trofeus-design.md`

## Global Constraints
- Nunca travessão, sempre hífen; nenhum texto explicativo na página; nada de moldura em volta de foto, número ou taça.
- Nenhuma rolagem lateral: na tela estreita a linha empilha com rótulo por número (`data-rotulo`).
- Filtro mora na URL; empate divide a posição.
- Tema claro: cores de medalha com contraste (valores de `.vp-colocacao`).

## Review Focus
- URL com `?por=serie` e um filtro de mapa vindo de link antigo: o filtro não pode cortar a série escondido (o modo série lê `STATS_FILTROS_DA_PAGINA.series`).
- Jogador que jogou o campeonato por duas equipes: medalha só pela equipe com mais séries (empate pelo id), igual ao perfil.
- Campeonato com 3º/4º: os dois levam bronze; MVP não entra.
- Equipe sem cadastro no pódio: não dá medalha (o perfil também não dá).
- Linha com 6 ou mais taças numa cor: quebra linha dentro da coluna, a foto continua no chão.

---

### Task 1: Recordes numa série
**Files:** `app.js` (constantes perto de `STATS_FILTROS_DA_PAGINA`, bloco Recordes, `renderStatsJogadores`, `statsFiltroCampos`, `bindStats`), `placar.css` (bloco Recordes), teste novo `scripts/test_stats_series_trofeus.js`.

**Interfaces:**
- Produces: `statsSeriesDe(linhas) -> Array<{ chave, series, player, linhas, quando }>` (só grupos com 2+ mapas; `player` = soma de `aggregateMatchPlayers` com `id` do jogador de volta); `statsRecordeSerieLinha(item, posicao, categoria) -> string`; `STATS_FILTROS_DA_PAGINA.series`.

- [ ] Teste: três linhas de um jogador numa série de 3 mapas e uma linha numa série de 1 mapa -> `statsSeriesDe` devolve 1 item, `player.kills` = soma, `player.id` = id do jogador, `linhas.length` = 3.
- [ ] Rodar `node scripts/test_stats_series_trofeus.js` -> falha (função não existe).
- [ ] Implementar `statsSeriesDe`, a linha, o seletor `data-st-por` e o modo em `renderStatsJogadores` (`?por=serie` -> `statsFiltro("series")`, `statsRecorte(filtro, "series")`; Formato só MD3 e MD5). A troca para série apaga `mapa`, `agente`, `funcao`, `patch` e `formato` md1/decisivo.
- [ ] Rodar o teste -> passa.

### Task 2: índice de medalhas
**Interfaces:**
- Produces: `medalhasDasEquipes(eventos) -> Map<"evento|equipe", trofeu>`; `medalhasDosJogadores(series, trofeus) -> Map<playerId, trofeu[]>` (equipe principal por séries, empate pelo id); `medalhasIndice() -> Map` com cache por `state.db`; `medalhasQuadro(indice, f) -> Array<{ player, ouro, prata, bronze, total }>` ordenado; `medalhasPosicao(lista, i) -> number`.

- [ ] Teste: jogador com 2 séries pela A e 1 pela B no mesmo evento, A campeã e B vice -> 1 ouro, 0 prata; 3º/4º vira bronze; empate de 1-0-0 divide a posição.
- [ ] Rodar -> falha.
- [ ] Implementar.
- [ ] Rodar -> passa. Controle no navegador: contagem por jogador igual a `playerTrophyAchievements` sem MVP nos 1.743 perfis (0 diferenças), e o controle negativo (trocar a regra da equipe principal) tem que dar diferença.

### Task 3: aba Troféus
**Interfaces:**
- Consumes: Task 2.
- Produces: `STATS_ABAS` com `trofeus`; `statsTrofeusAba(filtro) -> string`; facetas que contam medalhas (`medalhasFacetas`).

- [ ] Teste: o HTML da aba tem as colunas Ouro, Prata e Bronze, cada taça é um link `#/events/<id>` com o nome no `title`, a foto vem entre a logo e o nick.
- [ ] Implementar a aba, o CSS (`.vp-st-trofeus`, tokens de medalha no escuro e no claro, empilhamento até 760px).
- [ ] Rodar o teste e `node scripts/test_visual_placar.js`.

### Task 4: medir
- [ ] 1440, 1024, 760 e 380px: nenhuma rolagem lateral (`scrollWidth <= clientWidth`), foto no chão da linha, taças quebrando dentro da coluna.
- [ ] Tema claro: contraste das cores de medalha.
- [ ] Filtros: Tier S dá André e greinzera 2-3-2; série: khianh 101 no topo de abates, MD3 dá Catioro 84.
- [ ] Console sem erro; tempo da aba Troféus no primeiro acesso.
