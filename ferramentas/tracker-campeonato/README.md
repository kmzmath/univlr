# Campeonato antigo pelo tracker.gg

Ferramentas para trazer partidas de VALORANT anteriores a 2026 para o formato que o site usa.

## Por que o tracker

- **A API da Riot não tem o passado.** `val/match/v1/matches/{id}` guarda poucos meses. Em 25/10/2026 ela deu 404 para partidas de 05/2025, 01/2026 e 07/2026, e 200 só para a de 24/10/2026.
- **O tracker.gg tem partidas completas desde 2020,** com round a round, abates, dano e economia.
- **O detalhe do tracker é o mesmo dado da Riot com outro esquema.** No controle com 10 mapas de 2026, depois da conversão, os 34 campos que entram no rAAting ficaram idênticos ao JSON da Riot.

## Requisitos

- **Máquina e programas:** esta máquina, com Windows. Node 20 ou superior e Python 3.10 ou superior, com `openpyxl` e `requests`.
- **Chrome dedicado com CDP** em `127.0.0.1:9222`, perfil `C:\tracker-chrome-profile`.
  - Abra com `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\mmora\Downloads\tracker-collector-cdp\cdp\start-chrome.ps1"`.
  - As requisições saem de dentro da página, com os cookies e o TLS do Chrome real.
  - Se o tracker pedir verificação, uma pessoa passa por ela no próprio Chrome. Nenhum script contorna isso.
- **Playwright:** vem do coletor pessoal (`C:/Users/mmora/Downloads/tracker-collector-cdp/cdp/node_modules/playwright`), então não há `npm install` no projeto. `PLAYWRIGHT_PATH` troca o caminho.
- **Chave da Riot:** `ferramentas/riot/config_hub.py` lê de `RIOT_API_KEY` ou de `trabalho/.env`.
- **Saída no console:** `$env:PYTHONIOENCODING = "utf-8"` antes do Python, porque há nomes com caracteres fora do cp1252.

## Fluxo de um campeonato

Tudo fica em `outputs/<slug>/`. A pasta `outputs/` está no `.gitignore`.

| Passo | Comando | Gera |
|---|---|---|
| 1. Challengermode | `node ferramentas/tracker-campeonato/extrair_cm.cjs outputs/<slug> <url do torneio>` | `cm.json` |
| 2. PUUID | `python ferramentas/tracker-campeonato/resolver_puuid.py outputs/<slug>` | `puuids.json` |
| 3. Coleta | `node ferramentas/tracker-campeonato/coletar.cjs outputs/<slug> [--reaproveitar <outra>/lote/indices]...` | `tracker/`, `lote/` |
| 4. PUUID do tracker | `python ferramentas/tracker-campeonato/resolver_puuid.py outputs/<slug> outputs/<slug>/lote/ids_tracker.txt`, depois `node ferramentas/tracker-campeonato/coletar.cjs outputs/<slug> --max 0` | `puuids.json`, relatório refeito |
| 5. Identidades | `python ferramentas/tracker-campeonato/conferir_identidades.py outputs/<slug>` | `lote/identidades.md` |
| 6. Conversão | `python ferramentas/tracker-campeonato/converter.py outputs/<slug>/puuids.json outputs/<slug>/riot outputs/<slug>/lote/relatorio.json` | `riot/<uuid>.json` |
| 7. Pipeline do site | `node --max-old-space-size=8192 ferramentas/tracker-campeonato/comparar_site.cjs convertidos outputs/<slug>/riot` | erros e números absurdos |

O passo 4 se repete até o `ids_tracker.txt` não trazer conta nova. Ele existe porque o Challengermode guarda o Riot ID antigo de parte das contas: 21 de 264 na C2 2025. O tracker mostra o nome atual.

O passo 3 é o único que faz requisições ao tracker e pode levar uma hora. Ele grava o estado a cada requisição e retoma de onde parou se rodar de novo. Nunca rode duas instâncias ao mesmo tempo, nem em pastas diferentes.

## Como a coleta decide

1. **Alvos.** Cada jogo do store com placar real (o maior lado com 13 ou mais) vira um alvo. Ele leva a janela `DateCreated`-`StopTime` (UTC), o placar e os competidores. Jogo resolvido pelo admin com 1x0 e lobby refeito sem placar vão para "Jogos sem placar real" no relatório.
2. **Candidato.** Uma partida do índice de uma conta casa com um alvo quando o início cai na janela (com 15 min de folga antes e 5 depois) e o placar bate. O candidato casado é baixado uma vez.
3. **Confirmação pelos dois elencos.** Os 10 jogadores do arquivo são comparados com os competidores do jogo, por PUUID ou, sem PUUID, pelo Riot ID. São necessários pelo menos 3 de cada lado. Com 5 de cada lado é "10 de 10"; abaixo disso é parcial.
4. **Escolha da conta.** Enquanto houver alvo sem arquivo, o coletor escolhe a conta que jogou (papel 0, não coach) o maior número deles. Ele percorre o índice só na janela, com busca exponencial e binária da página e depois sequencial. Depois de 3 contas sem achar, desiste daquele jogo.
5. **Reaproveitamento.** `--reaproveitar` lê índices já baixados de outra coleta como fonte de candidatos. Uma página tem 20 partidas e, para quem joga pouca custom, cobre semanas ou meses. Na C2 2025, os índices da C1 deram 35 candidatos sem nenhuma requisição.

## Ritmo

`ritmo.cjs` impõe 24 s entre requisições, 68 por 30 min e 600 por 6 h. Esses limites vêm do coletor pessoal, onde 150/h sustentado não deu bloqueio e 200/h deu; não são limites oficiais.

Os instantes ficam em `outputs/tracker-ritmo.json`, comum ao `coletar.cjs` e ao `baixar_detalhes.cjs`, porque o tracker conta por IP.

| Resposta | O que o coletor faz |
|---|---|
| 451 | Perfil privado. A conta fica indisponível e a coleta segue. |
| 404 | Conta desconhecida. Mesmo tratamento do 451. |
| Página vazia (`n: 0`) | Fim do histórico da conta. |
| `StandardApiV2::NoData` | Sem dados. |
| 429 | Pausa de 30 min. No segundo, para. |
| 403 ou HTML | Para na hora: é verificação de acesso. |

## Leitura do relatório

`lote/resumo.md` tem a tabela por jogo.

- **"10 de 10":** os dois elencos foram reconhecidos inteiros.
- **"N de 10":** parcial, com pelo menos 3 de cada lado.
- **"Faltante":** nenhum arquivo. Para concluir que o tracker não tem o jogo, o índice de contas que jogaram tem que cobrir a janela sem mostrar a partida. Na C2 2025, P18 e P99 ficaram assim, com 3 contas cada.
- **Jogos sem placar real:**
  - 1x0 do admin em poucos minutos é a assinatura de W.O.
  - 1x0 do admin depois de 40 a 80 minutos pode ter sido jogado.
  - Quem decide é o dono.

`lote/identidades.md` explica cada jogador do arquivo que não casou:

- **Nome velho no Challengermode:** é a mesma conta, renomeada. É provável, não provado, porque o PUUID do Challengermode é cifrado para a chave deles.
- **Outra conta:** alguém fora da lineup jogou. Pode ser conta emprestada ou substituição, e é decisão do dono.
- **Fora da lista:** sobra no tracker sem competidor faltando.

## Conversão

`converter.py` gera o JSON no formato match-v1 da Riot.

| Campo | Como sai |
|---|---|
| PUUID | Vem do `puuids.json`. Sem ele, a conta sai como `sem-puuid:<riot id>`, listada em `conversao.semPuuid`. |
| Nome | É o Riot ID **atual**, não o da época da partida. |
| Colete | `TRACKER-COLETE-DESCONHECIDO`, que o `app.js` e o Python tratam como +50 (pesado), a escolha do dono. |
| Arma comprada, `gameVersion`, `roundCeremony`, party, card, título | Vazios. Nenhum entra em estatística, e o patch aparece como "-". |
| Coach e observador | Ausentes. |
| Duração | Arredondada para segundos. |

Efeito do colete, medido trocando o colete real pela suposição nos 863 mapas da Riot de 2026:

| Suposição | Por mapa | Por jogador (200 ou mais rounds) | Viés |
|---|---|---|---|
| Pesado | mediana 0,008, máximo 0,054 | mediana 0,010, máximo 0,019 | +0,01 |
| Nenhum | mediana 0,047 | - | -0,047 |

Com pesado, o top 10 fica igual e o maior salto é de 4 posições.

A ordem dos jogadores dentro do round (`playerStats`) muda o rAAting em até 0,017 num jogador-mapa (p95 de 0,0015). O motivo é que o `applyEffectiveDamage` do site desempata pela ordem do arquivo, e a ordem da Riot não é reproduzível a partir do tracker.

O bloco `conversao` no topo de cada arquivo registra a origem e as suposições.

Os convertidos ainda não entram no site sozinhos. Para isso falta:

- dar nome no padrão de `campeonatos/`, com os slugs das equipes;
- criar o `campeonato.json`;
- fazer as decisões de identidade.

## Pôr no site

O `montar_evento.py` monta o campeonato a partir da pasta da coleta. Ele usa:

- `cm.json`;
- `rodadas.json`, que sai do `node ferramentas/tracker-campeonato/extrair_rodadas.cjs outputs/<slug>`;
- `lote/relatorio.json`;
- `riot/`;
- `puuids.json`.

Comando:

```powershell
python ferramentas/tracker-campeonato/montar_evento.py outputs/<slug> --equipes <equipes.json> `
  --prefixo ALIANCA_C1 --evento copa-alianca-2025-classificatoria-1 --nome "Copa Aliança 2025 - Classificatória 1" `
  --destino "campeonatos/Copa Aliança 2025/Classificatória 1" --copia "trabalho/Finalizados/Válidos/Copa Aliança 2025/Classificatória 1" `
  [--manuais outputs/<slug>/associacoes-manuais.json] [--pontos <placementPoints.json>] [--gravar]
```

**Entradas:**
- `equipes.json` diz, para cada equipe da plataforma, o slug no site: `{"<id da equipe no Challengermode>": "<slug>"}`.
- `associacoes-manuais.json` serve para arquivo que a conferência automática não aceitou mas a evidência sustenta: `{"<série>": {"uuid": "...", "motivo": "..."}}`.

**Sem `--gravar`,** o montador só mostra o plano. Com `--gravar`, ele faz três coisas:

1. **Copia os arquivos convertidos** com o nome do padrão, `<prefixo>_<NNN>_<dd-mm-aa>_<A>_<pa>_x_<pb>_<B>_<mapa>.json`, na ordem da plataforma.
2. **Grava o `campeonato.json`** no destino.
3. **Deixa na pasta da coleta** o `override.js` (bloco do `TOURNAMENT_OVERRIDES`) e o `ranking-weights.json` (entrada de `tournaments`), para colar no `app.js` e no `ranking-weights.json`.

**Regras do bloco de chave:**
- **Molde:** o das classificatórias da Univavá.
- **Na chave de 64:** as rodadas com bye listam só os jogos reais, com `slot`.
- **Na chave de 32:** o bye aparece como "Sem adversário".
- **W.O.:** é a série com 1x0 do admin e sem arquivo.
- **Série com placar real e sem arquivo:** entra com o placar e sem status.
- **Colocações:** as quatro vagas são "Classificado". O resto sai em blocos pela rodada da chave inferior em que a equipe caiu.

**Armadilhas vistas na Copa Aliança 2025 (25/10/2026):**
- **Sem o `campeonato.json`, o evento herda dados de outro.** O `build_metadata.py` procura o evento no `tournaments.xlsx` também pelo nome da pasta. Uma "Classificatória 2" herdou datas, ícone e id da Univavá. Com `logo` e `sourceId` declarados vazios no `campeonato.json`, o build não busca mais.
- **Jogador novo não pode ter o mesmo nome de um cadastrado.** O elenco liga por nome, e o build para com "Elenco … vinculado ao perfil errado". Compare com `normalizeNameKey` do `app.js`, incluindo os nicks.
- **Toda equipe cadastrada precisa de `cor1`/`cor2`.** Sem cor, o build para com "Cores invalidas no metadata.json". Na falta da oficial, use o `colorPair(slug)` do `app.js`.
- **Partida nova exige recalcular a tabela de estados** (`round_state_winrates.xlsx`) antes do build. Use `analyze_all_round_states` de `campeonatos/`.

## Validação

- **`comparar_site.cjs controle <controle.json> <dir>`** compara o convertido com o JSON da Riot do mesmo mapa. O `controle.json` é uma lista de `{uuid, riot}`, e o controle de 25/10/2026 está em `outputs/controle-conversor/`. O esperado é diferença só em `damage`, `adr`, `eDamageTotal`, `adjustedRoundSwingTotalPp` e `raating_3`, com p95 de até 0,0015, que é o ruído de ordem. Diferença em qualquer outro campo é erro do conversor.
- **`comparar_site.cjs colete`** refaz a medição do colete.
- **`baixar_detalhes.cjs <destino> <uuid>...`** baixa detalhes avulsos, por exemplo para um controle novo.

## Arquivos de uma coleta

| Arquivo | Conteúdo |
|---|---|
| `cm.json` | Store do Challengermode: equipes, membros e jogos com janela, placar, resolução e competidores |
| `puuids.json` | Riot ID para PUUID, status da `account-v1` e jogador da planilha |
| `tracker/<uuid>.json` | Resposta original do tracker |
| `lote/indices/` | Páginas de índice originais |
| `lote/erros/` | Respostas que não foram 200 |
| `lote/estado.json` | Requisições, contas percorridas, candidatos e adiados (retomada) |
| `lote/relatorio.json`, `lote/resumo.md` | Cobertura por jogo |
| `lote/identidades.md` | Leitura dos jogadores que não casaram |
| `lote/ids_tracker.txt` | Riot IDs do tracker ainda sem PUUID |
| `riot/<uuid>.json` | Convertidos |
