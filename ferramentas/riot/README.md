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
| `AuditaNicksPartidas.py` | acha quem jogou e não bate com o cadastro | `out_auditoria_nicks/` |
| `analiseMatches.py` | relatório por partida e por equipe | `analiseMatches_<pasta>.xlsx` |
| `analiseAgentes.py` | relatório de agentes | `analiseAgentes_<pasta>.xlsx` |
| `analiseMapas.py` | relatório de mapas | `analiseMapas.xlsx` |
| `analiseWinSituations.py` | winrate por situação de round | `dados_excel/round_state_winrates.xlsx` |

O `analiseWinSituations` é o único que escreve dentro do repo, e é porque a saída
dele é **fonte** para o `analiseMatches` e o `analiseAgentes`.

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
