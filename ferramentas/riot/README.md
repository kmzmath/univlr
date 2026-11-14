# ferramentas/riot

Scripts que falam com a API da Riot e auditam o cadastro. Tudo mora dentro do
repositório, mas nem tudo é versionado - a divisão é de propósito.

## Onde mora o quê

| | Onde | Por quê |
|---|---|---|
| Código (estes scripts) | `ferramentas/riot/` | precisa de histórico |
| Fonte (`players.xlsx`, `teams.xlsx`, ...) | `dados_excel/` | é o cadastro que o site consome |
| Acervo bruto (`Finalizados/`, `out_tournament/`) | `trabalho/`, no `.gitignore` | ~450 MB, e o `campeonatos/` já é a exportação publicável dele |
| Saídas de análise | `trabalho/` | relatório se regera |
| Chave da Riot | `trabalho/.env` | **este repositório é público** |

`config_hub.py` amarra as três pontas, e **não há caminho absoluto em lugar
nenhum**: o repo é deduzido do próprio caminho do arquivo e a pasta de trabalho
pendura nele. Clonar em outra máquina já deixa tudo no lugar - só falta o
`trabalho/`, que se cria sozinho ao rodar, e o `.env`. Quem quiser o acervo em
outro disco usa a variável `UNIVLR_TRABALHO`.

**Não há fallback para cópia local das planilhas, de propósito.** Uma cópia velha
funcionando em silêncio foi o que fez a A2E UFF sair como `unknown` no nome de
arquivo do JUBS presencial, com o script lendo um cadastro de 12 dias atrás. Sem
planilha, os scripts param com o caminho na mensagem.

## Antes de rodar

A chave da Riot vem da variável de ambiente `RIOT_API_KEY` ou de `trabalho/.env`:

```
RIOT_API_KEY=RGAPI-...
```

Chave de desenvolvimento da Riot expira em 24 h. Sem ela, os scripts de análise
continuam funcionando - só os que baixam partida é que param.

## Os scripts

| Script | O que faz | Escreve |
|---|---|---|
| `PegaCustomMatch.py` | baixa as partidas custom de todos os cadastrados | `out_tournament/`, e o PUUID resolvido de volta no `players.xlsx` |
| `PegaTeamMatch.py` | o mesmo, mirando 1 ou 2 equipes | `out_tournament/` |
| `PegaPlayerMatch.py` | o mesmo, mirando jogadores | `out_tournament/` |
| `PegaTournamentMatch.py` | partidas do **servidor de torneio** da Riot (últimas 12 h), que os três acima não enxergam | `out_torneio_esports/`, e com `--vincular` as contas de torneio no `players.xlsx` |
| `AuditaNicksPartidas.py` | acha quem jogou e não bate com o cadastro | `out_auditoria_nicks/` |
| `AtualizaNicks.py` | pergunta à Riot o Riot ID de hoje de toda conta conhecida (as da planilha e as que só aparecem em `campeonatos/`) e acha pelo nick o PUUID de quem não tem | `dados_excel/riot_ids_atuais.json` (o perfil mostra esse nome como nick atual), e no `players.xlsx` o nick novo numa coluna `nick N` e o PUUID achado; a coluna `Jogador` não muda |
| `analiseMatches.py` | relatório por partida e por equipe, com identidade, KAST, ACS e rAAting iguais aos do site | `analiseMatches_<pasta>.xlsx` |
| `analiseAgentes.py` | relatório de agentes com as métricas oficiais do site | `analiseAgentes_<pasta>.xlsx` |
| `analiseMapas.py` | relatório de mapas | `analiseMapas.xlsx` |
| `analiseWinSituations.py` | winrate por situação de round | `dados_excel/round_state_winrates.xlsx` |

O `analiseWinSituations` e o `AtualizaNicks` são os únicos que escrevem dentro do repo, e é porque a saída
deles é **fonte**: do `analiseMatches` e do `analiseAgentes` no primeiro caso, do build do site no segundo.

O `analiseMatches.py` e o `analiseAgentes.py` requerem Node.js porque reutilizam
`app.js` e `raating-core.js` por meio de `export_site_match_stats.js`. Assim, os
relatórios não recalculam identidade e métricas por uma implementação paralela.
O contexto econômico do rAAting 3.0 continua sendo calculado sobre todo o
manifesto de partidas, mesmo quando a análise seleciona apenas uma pasta.

As quatro análises usam por padrão `trabalho/Finalizados/Válidos` e descartam
repetições pelo `matchInfo.matchId`. Depois de regenerar os winrates de situação,
rode `scripts/build_metadata.py` e `scripts/build_database.js`: o rAAting 3.0 do
site e dos relatórios depende dessa mesma distribuição de estados.

## Partida no servidor de torneio

Quando a organização roda a partida no servidor de torneio da Riot (rota
`esports`, `region: "tournament"` no JSON), cada jogador entra com uma conta de
torneio, com a sigla da equipe e a tag `#epval` (ex.: `AZR greiN#epval`), e
**PUUID próprio**. Essas contas não têm matchlist, então o `PegaTeamMatch` volta
com zero partidas. O `PegaTournamentMatch.py` vai pela lista de partidas
recentes da fila de torneio, que só guarda **as últimas 12 horas**: rode no dia.

```
python PegaTournamentMatch.py                         # só lista o que houve no servidor
python PegaTournamentMatch.py golden ceub --vincular  # baixa o confronto e cadastra as contas
python ../../scripts/build_metadata.py                # para o site reconhecer as contas novas
```

A conta de torneio desconhecida é ligada ao jogador pelo nick sem a sigla
(`AZR greiN` -> `greiN`), procurando só nos elencos das equipes pedidas e só
quando casa com um jogador. O `--vincular` grava o PUUID numa coluna `puuid N`
livre (cria a próxima se a linha estiver cheia) e o Riot ID numa `nick N`, com
backup da planilha antes. Mapa reiniciado ou abortado sai como rejeitado, com o
motivo, pelas mesmas regras do `PegaCustomMatch` (vencedor com 13 rounds etc.).

## Duas armadilhas que já custaram caro

**O nome do arquivo manda na equipe de cada lado.** Ele registra por quem a
pessoa jogava *na data*; o `current_team` é o estado de hoje, e num circuito
universitário trocar de equipe é a regra. A ordem em `combine_side_detection` é:
nome do arquivo, depois voto por `current_team`, depois voto por histórico,
depois o par do nome compacto.

**O mapa vai no nome com o nome amigável, não com o codinome da Riot.** `Bonsai`
é Split, `Jam` é Lotus, `Juliett` é Sunset, `Plummet` é Summit. A tabela completa
é `MAP_API_SLUGS` no `app.js`. E o nome precisa terminar no mapa: `parseFileName`
toma o último token como mapa e tudo entre o placar e ele como equipe B, então um
arquivo sem mapa vira equipe truncada, em silêncio.
