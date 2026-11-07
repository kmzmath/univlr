# Campeonatos com etapas - desenho

Data: 07/11/2026. Branch de trabalho: `previa-2025`.

## Por que

Hoje cada etapa é um campeonato no site. São 33 dos 50 campeonatos visíveis. Isso:

- enche a lista de Eventos, a busca e a home com o que na verdade é um campeonato só;
- faz o troféu dizer "Campeão, JUBS Goiás 2026 - Etapa Presencial" em vez de "Campeão, JUBS 2026 - Goiás";
- dá ao campeão da Practice e da Off Season do LBEU um troféu "Campeão" igual ao do campeão de verdade (Wolf Gaming, UFPR BBN, Azure Bears Black, Mauá Blue);
- não deixa ver a história inteira de um campeonato (estatísticas, mapas e agentes de todas as etapas juntas).

A separação por etapa continua certa para pontuação, ranking e estatística de cada fase, e não muda.

## Metas

1. Uma camada **campeonato** por cima das etapas, declarada à mão.
2. A página do campeonato com um seletor de etapa, em que **Geral** mostra o campeonato inteiro nas 5 abas.
3. Eventos, busca e home com uma linha por campeonato.
4. Troféus com o nome do campeonato, e o nome da divisão quando a etapa é paralela.
5. Copa Aliança 2024.1 e 2024.2 com Fase de Grupos e Playoffs como etapas separadas, como a 2025.

## Fora do escopo

- Campanhas agrupadas por campeonato nos perfis de equipe e jogador (fica para depois).
- Página de edições (JUBS 2024, 2025 e 2026 juntos, campeões por ano). É outra camada.
- Rush Series: são edições diferentes, não etapas. Ficam como estão.

## O que não pode acontecer

- **O ranking não pode mudar** por causa do cadastro de campeonatos. Pesos, pontos, conquistas e `phaseRules` continuam por etapa em `ranking-weights.json`, e o `database.json` sai igual byte a byte do build quando só o cadastro entra. A única mudança permitida no ranking é a da divisão da Aliança 2024 (ver "Divisão da Copa Aliança 2024"), e ela é medida e mostrada ao dono antes do commit.
- **Nenhum link antigo pode quebrar.** `#/events/<id da etapa>` e `#/tournaments/<id da etapa>` continuam abrindo a etapa (notícias, comentários do Supabase, troféus e campanhas apontam para ids de etapa).
- **Nada escondido** ([[univlr-nada-escondido]]): as etapas aparecem escritas na linha de Eventos, sem abrir e fechar; nada de rolagem lateral na faixa de etapas.
- **Travessão nunca**, só hífen, em qualquer texto novo.

## Os campeonatos (decisão do dono, 07/11/2026)

A ordem é a dele: a etapa mais recente primeiro. A faixa de etapas segue essa ordem.

| Campeonato | id | Etapas (ordem da faixa) | Decide o título | Paralelas |
|---|---|---|---|---|
| UNIVAVÁ | `univava` | Playoffs, Fase de Grupos, Classificatória 4, 3, 2, 1 | Playoffs | - |
| JUBS 2026 - Goiás | `jubs-2026` | Etapa Presencial, Fase Inicial, Pré-JUBS SP | Etapa Presencial | Pré-JUBS SP |
| LBEU 2025 - 2º Split | `lbeu-2025-2-split` | Championship, Off Season, Practice, Fase Suíça | Championship | Off Season, Practice |
| LBEU 2025 - 1º Split | `lbeu-2025-1-split` | Championship, Off Season, Practice, Fase Suíça | Championship | Off Season, Practice |
| JUBS 2025 - Natal | `jubs-2025` | Etapa Presencial, Fase Inicial | Etapa Presencial | - |
| Copa Aliança 2025 | `copa-alianca-2025` | Playoffs, Fase de Grupos, Classificatória 4, 3, 2, 1 | Playoffs | - |
| JUBS 2024 - Brasília | `jubs-2024` | Etapa Presencial, Playoffs Online, Qualify 2, Qualify 1 | Etapa Presencial | - |
| Copa Aliança 2024.2 | `alianca-2024-2` | Playoffs, Fase de Grupos, Classificatória | Playoffs | - |
| Copa Aliança 2024.1 | `alianca-2024-1` | Playoffs, Grupos, Classificatória 2, 1 | Playoffs | - |

Ids das etapas que já existem: os de `data-sources.json` (`univava-playoffs`, `jubs-etapa-presencial`, `jubs-pre-jubs-sp`, `lbeu-2025-1-split-practice` etc.). Os das quatro etapas novas da Aliança 2024 saem da divisão. Nenhum id de campeonato pode coincidir com um id de etapa (conferido: hoje não coincide).

O "Pré-JUBS" escondido (`jubs-pre-jubs`) continua fora e escondido. Os outros 16 campeonatos visíveis ficam sozinhos e não mudam.

Com isso a lista de Eventos tem 25 linhas (9 campeonatos com etapas + 16 sozinhos), e as etapas passam de 50 para 52.

## Cadastro

Um objeto `CAMPEONATOS_COM_ETAPAS` no `app.js`, ao lado de `TOURNAMENT_OVERRIDES`, porque o `build_home.js` e o `build_database.js` já leem o `app.js`. Ele substitui a regra do hífen (`tournamentSerie` e `tournamentEtapas`, [app.js:27384](../../../app.js)), que erra com "Copa XV - 6ª edição (2025)" e não separa o split da divisão no LBEU.

Cada campeonato declara:

- `id` e `nome` (o nome da tabela acima);
- `etapas`: lista ordenada de `{ id, nome, nivel, paralela }`, em que:
  - `nome` é o curto ("Classificatória 2", "Practice");
  - `nivel` agrupa etapas do mesmo degrau: as quatro classificatórias têm o mesmo `nivel`, e Qualify 1 e 2 também;
  - `paralela: true` marca Off Season, Practice e Pré-JUBS SP;
- `decide`: o id da etapa que dá o título.

Na carga, cada etapa ganha `campeonato` (referência), `etapaNome` e um nome composto para exibição: nome do campeonato + nome curto da etapa. **O separador não pode ser um segundo " - "**: "JUBS 2025 - Natal - Etapa Presencial" fica ruim. Proponho dois-pontos ("JUBS 2025 - Natal: Etapa Presencial") e mostro nos modelos. Esse nome entra nos lugares que hoje usam `event.name` cru (39 usos: linha de partida, busca, gráfico de ranking, linha do tempo de elenco, campanha). Isso é só exibição: a troca acontece no cliente depois da carga, nunca em `aggregateEvents` ou em qualquer coisa que o build grave.

Uma etapa sem campeonato funciona exatamente como hoje.

Atenção: o ranking grava o nome do evento no próprio resultado (`eventName`, [ranking-core.js:893](../../../ranking-core.js)), e o bloco Conquistas mostra esse texto. Lá, o nome tem que sair do id da etapa pelo cadastro, e não do `eventName` gravado. Senão a Conquista continua dizendo "JUBS Goiás 2026 - Etapa Presencial".

## Página do campeonato

### Rotas

- `#/events/<id do campeonato>` abre o **Geral**.
- `#/events/<id da etapa>` abre a mesma página com aquela etapa selecionada. Sem redirecionar: a URL continua a da etapa.
- `#/tournaments/...` se comporta igual.
- As abas seguem o esquema atual (`route().tab`), por exemplo `#/events/univava/estatisticas` e `#/events/univava-playoffs/estatisticas`. Os filtros de cada aba continuam no `?`.
- Trocar de etapa mantém a aba aberta. Os filtros que não existem na etapa nova (uma equipe que não jogou ali) caem.

### Topo

- O nome do campeonato, sem etapa, numa etapa ou no Geral.
- As datas vão do início da primeira etapa ao fim da última, pela regra de [[univlr-tournament-display-rules]].
- Status "ao vivo" se qualquer etapa estiver ao vivo.
- A capa é a da etapa que decide o título. Se ela não tiver capa, usa a da etapa mais recente que tiver.
- Logo abaixo, a faixa de etapas, no lugar da `vp-camp-etapas` atual: **Geral** primeiro, depois as etapas na ordem da tabela. A etapa ao vivo ganha marca. As paralelas aparecem na faixa como as outras, na posição que o dono deu.
- A faixa quebra linha quando não cabe, sem rolagem lateral. No celular também.

### Numa etapa

Tudo como hoje, nas 5 abas. O que muda é só o topo.

### No Geral

**Visão Geral**

- **Colocação final do campeonato:**
  - Primeiro, a colocação da etapa que decide, como ela é hoje.
  - Depois, quem não chegou lá, agrupado pelo degrau em que caiu, do mais alto para o mais baixo. Dentro de um degrau de etapa única (Fase de Grupos), vale a colocação daquela etapa (9-11, 12-14, 15-16). Num degrau com várias etapas (classificatórias), as equipes formam um grupo só, com a faixa calculada pela contagem ("17-61"). Cada equipe aparece uma vez, no degrau mais alto que alcançou.
  - Etapas paralelas não entram.
  - Campeonato em andamento: segue a regra do pódio com vagas TBD.
- **Equipes participantes:** todas as equipes de todas as etapas (paralelas incluídas), no desenho atual (Camisas em pé, ordem de ranking). O ranking "Início" do canto direito é o da data em que começou a primeira etapa. O UNIVAVÁ tem 62 inscritas; 61 jogaram.
- **Etapas:** uma linha por etapa, na ordem da faixa, com datas, formato, número de equipes e o desfecho (campeão, ou quantas se classificaram). Cada linha leva para a etapa.
- **Coluna direita (Informações):**
  - datas totais e organizador;
  - tier da etapa que decide;
  - equipes únicas;
  - partidas somadas;
  - map pool unido.
- A chave e a tabela suíça **não** aparecem no Geral: ficam na etapa, para não repetir dado.

**Jogos:** as séries de todas as etapas, agrupadas por etapa (na ordem da faixa) e, dentro de cada etapa, por fase, como hoje (`tournamentJogos`). Os filtros de equipe, mapa e dia valem para o conjunto.

**Estatísticas, Mapas e Agentes:** as mesmas abas, recebendo a união das séries de todas as etapas, com as paralelas incluídas. Os cálculos já são feitos no navegador a partir da lista de séries (`tournamentEstDados` usa `aggregateMatchPlayers` sobre os mapas), então não precisa de dado novo.
- O rAAting segue a convenção atual da aba, a soma dos rounds ([[univlr-raating-de-campeonato]]).
- A tabela de equipes usa a colocação final do Geral onde hoje usa `standings`.

**Comentários:** o Geral tem a própria conversa, com o id do campeonato. Cada etapa continua com a sua.

## Eventos

- Uma linha por campeonato, no desenho atual da lista (`eventDirectoryRow`), com:
  - nome do campeonato;
  - datas totais;
  - tier da etapa que decide;
  - equipes únicas;
  - partidas somadas;
  - desfecho da etapa que decide;
  - capa no hover pela regra do topo.
- Na própria linha, as etapas escritas como atalhos, na ordem da faixa, cada uma levando à etapa. No celular elas quebram linha.
- Filtros: o campeonato entra se qualquer etapa passar no filtro. A contagem diz "campeonatos" e conta 25.
- Ordenação pelas datas totais.

## Home

- O painel "Campeonatos" (`renderHomeCompact`, `sortedEvents("recent")`) mostra uma linha por campeonato. Se uma etapa estiver ao vivo, a linha diz qual.
- O `home.json` sai do `build_home.js`, que precisa agrupar do mesmo jeito. Senão a home pinta a lista velha até o banco completo chegar.

## Busca

- Um resultado por campeonato (`searchTournamentResult`). O texto pesquisável inclui:
  - o nome do campeonato;
  - os nomes das etapas;
  - os nomes antigos ("JUBS Goiás 2026", "JUBS RN 2025"), para quem ainda busca assim.
- Uma etapa aparece como resultado próprio só quando a busca acerta palavras do nome da etapa que não estão no nome do campeonato.
- Casos que precisam funcionar:
  - "univava": só o UNIVAVÁ;
  - "classificatoria 2": as Classificatórias 2 de UNIVAVÁ, Copa Aliança 2025 e Copa Aliança 2024.1;
  - "jubs rn": o JUBS 2025 - Natal;
  - "practice": as duas Practice do LBEU;
  - "copa xv": a Copa XV sozinha, como hoje.
- A linha de partida na busca usa o nome composto da etapa.

## Troféus

Só 1º a 3º gera troféu, como hoje (`trophyPlacementInfo`). Muda só o texto:

- **Etapa que decide:** "Campeão, JUBS 2026 - Goiás".
- **Etapa paralela:** "Campeão da Practice, LBEU 2025 - 1º Split", e "Vice da Off Season" e "3º lugar do Pré-JUBS SP" pela mesma regra.
- **Outra etapa com 1º a 3º:** "Campeão da <etapa>, <campeonato>". Hoje não existe caso, porque as classificatórias dão "Classificado".
- **Campeonato sozinho:** como hoje.
- **MVP:** "MVP, JUBS 2026 - Goiás" quando o prêmio está na etapa que decide (hoje só `jubs-etapa-presencial` tem `mvp`). O MVP continua sendo um por campeonato ([[univlr-premio-mvp]]).

A imagem do troféu continua procurada pelo id da etapa (`assets/trofeus-campeonatos/<id>-campeao.png`), e o link continua indo para a etapa. Isso vale para os dois desenhos: `teamCapaTrofeus` e `trofeusLista`.

## Divisão da Copa Aliança 2024

Hoje `alianca-2024-grupos-playoffs` e `alianca-2024-2-grupos-playoffs` são suíço e playoffs num evento só, com a numeração intercalada. Cada um vira duas etapas, no molde da `copa-alianca-2025-fase-de-grupos` e da `copa-alianca-2025-playoffs`:

1. **Arquivos.** As partidas vão para duas pastas, `Fase de Grupos` (na 2024.1, `Grupos`, pelo nome que o dono deu) e `Playoffs`, cada uma com o seu `campeonato.json`. Os ids saem do `campeonato.json`; conferir no `data-sources.json` depois do build (pegadinha do id órfão, [[univlr-update-workflow]]). Que série é de que fase sai das `swiss.rounds` do override:
   - **2024.1:** playoffs = Partidas 2, 4, 6, 8, 10, 12 e 14; o resto é o suíço.
   - **2024.2:** playoffs = Partida 2 (final), 4 a 16 pares (chave superior) e 18 a 28 pares (chave inferior); o resto é o suíço.
2. **Override.** As rodadas do suíço vão para a etapa de grupos. Os playoffs viram chave encadeada (`layout: "linked"`), como as outras etapas de playoffs, com os `code` batendo com o número do arquivo.
3. **Colocação:**
   - Grupos: "Classificado" para as 8 que avançaram, e 9-11, 12-14, 15-16.
   - Playoffs: 2024.1 com 1, 2, 3-4 e 5-8; 2024.2 com 1, 2, 3, 4, 5-6 e 7-8.
   - O MVP, se houver, vai para os playoffs.
4. **`ranking-weights.json`:**
   - Grupos: `placementPoints` com Classificado 0 e as faixas de 9 a 16 com os valores atuais, `defaultPhase: "regular"` e `qualifiesTo` apontando para os playoffs.
   - Playoffs: as faixas de 1 a 8 com os valores atuais, `defaultPhase: "playoffs"` e a regra `final` na série da final (Partida 14 na 2024.1; Partida 2 na 2024.2).
   - Somando as duas etapas, cada equipe fica com os mesmos pontos de antes.
5. **Medição antes do commit:**
   - Ranking de todos os cortes, antes e depois.
   - O esperado é que a parte das partidas saia idêntica. A conquista das equipes de 9º a 16º passa a vencer a partir do fim do suíço, e não mais do fim dos playoffs, então muda um pouco nos cortes de 2024 e 2025.
   - Mostrar ao dono a lista do que mudou (equipe, corte, nota, posição) e só commitar com o ok dele.
6. Rodar o pipeline inteiro (metadata, lineup history, database, cores), porque `team-profiles.json` e lineup history leem os eventos.

O 2024 só existe na `previa-2025`. Nada no ar é afetado, e no Supabase não há comentários com esses ids.

## Como saber que deu certo

- Com só o cadastro, `database.json`, `ranking-weights.json` e os snapshots de ranking saem iguais aos de antes.
- Os 52 ids de etapa abrem a etapa certa, com o seletor marcando a etapa.
- Os 9 ids de campeonato abrem o Geral.
- Somar o Geral bate com a soma das etapas:
  - número de séries e mapas do Geral = soma das etapas;
  - rounds de um jogador no Geral = soma dos rounds dele nas etapas, conferido em dois ou três jogadores que jogaram várias etapas (controle de [[univlr-armadilhas-de-medicao]]).
- A colocação final do UNIVAVÁ:
  - tem os 8 dos playoffs, as 8 eliminadas na fase de grupos (9-16), e as eliminadas nas classificatórias num grupo só;
  - cada uma das 61 equipes que jogaram aparece uma vez;
  - a equipe inscrita que não jogou não aparece.
- O troféu da CEUB Octopus diz "Campeão, JUBS 2026 - Goiás". O da Wolf Gaming diz "Campeão da Off Season, LBEU 2025 - 1º Split".
- Eventos com 25 linhas, os casos de busca da seção Busca funcionando, e a home agrupada desde o `home.json`.
- Testes do projeto (`scripts/test_*.js` e `test_*.py`) passando. Teste novo para o cadastro (toda etapa existe, nenhuma etapa em dois campeonatos, `decide` está nas etapas) e para a colocação final derivada.
- Conferência visual pelo método de [[univlr-visual-verification]], no desktop e no celular.

## Como os modelos são escolhidos

Como nas outras páginas ([[univlr-pagina-campeonato]]), o dono escolhe vendo dado real na própria página, com um seletor provisório. O modelo que perder é apagado depois. Antes de construir:

1. **Faixa de etapas no topo:** A, abas de texto como a faixa atual, com "Geral" destacado; ou B, a faixa em blocos com as datas de cada etapa.
2. **Linha de Eventos:** A, as etapas como texto corrido embaixo do nome; ou B, as etapas como pequenos rótulos na coluna da direita.
3. **Separador do nome composto:** dois-pontos ou ponto médio.

## Ordem de construção

1. Cadastro, nome composto e testes do cadastro (sem mudança visível além dos nomes).
2. Página: rotas, topo, faixa e o Geral nas 5 abas.
3. Eventos, home (`build_home.js`) e busca.
4. Troféus.
5. Divisão da Copa Aliança 2024, com a medição do ranking.

As etapas 1 a 4 não mexem em dado. A 5 mexe e pode ir separada.

## Escolhas minhas (o dono pode mudar)

- Ids dos campeonatos (`univava`, `jubs-2026` etc.).
- O cadastro no `app.js`, e não num JSON à parte.
- O Geral é a entrada pelo id do campeonato. Pelo id da etapa, a página abre na etapa.
- As paralelas entram no Geral de Jogos, Estatísticas, Mapas e Agentes e nas Equipes, mas não na colocação final.
- O Geral tem conversa própria.
- As classificatórias formam um grupo só na colocação final, com a faixa contada.
- Os playoffs da Aliança 2024 viram chave encadeada.
- A capa do campeonato é a da etapa que decide.
- O ranking "Início" das Equipes participantes no Geral é o da data em que começou a primeira etapa.
- Um campeonato é visível se qualquer etapa dele for visível.

## O que mudou na construção (07/11/2026)

- **Modelos escolhidos pelo dono:** B na faixa (blocos com as datas de cada etapa; no celular, grade de duas colunas) e B na lista de Eventos (as etapas na coluna Formato). Separador do nome composto: dois-pontos.
- **Colocação final:** conta quem tem série com arquivo ou colocação oficial na etapa. A Uninassau não tem série com arquivo no suíço da Aliança 2024.1, e a UFSCar Fire só tem W.O. na Classificatória 3 do UNIVAVÁ; as duas já aparecem na página da etapa. Com isso, a faixa das classificatórias do UNIVAVÁ é 17-62, e não 17-61.
- **Tabela de pontos dos playoffs da Aliança 2024:** os playoffs ficaram com a tabela inteira da edição (de 1 a 15-16), com `teams: 8`. Divididos como os de 2025, a média da tabela subia de 35,9 para 51,25 pontos, e o peso de fase das partidas de playoffs caía (de 1,171 para 1,151; o da final, de 1,258 para 1,151). Isso mexia no ranking inteiro, com 561 posições trocadas. Com a tabela inteira, só a conquista de quem ficou de 9º a 16º muda.
- **Medição:** dois controles deram 0 diferenças. Com a escolha final, mudam 64 dos 120 cortes, entre 23/07/2024 e 07/10/2025, e o ranking atual não muda.

