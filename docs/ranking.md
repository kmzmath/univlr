# Ranking de equipes

O ranking mede força provável das equipes se jogassem hoje. Ele prioriza desempenho coletivo contra adversários fortes, e não uma tabela de títulos nem uma média simples de jogadores.

## Fórmula

Nota final:

- 70% Desempenho
- 15% Conquistas
- 10% Forma recente
- 5% rAAting 3.0 dos jogadores

Todos os blocos ficam em escala 0-100 e a nota final também é travada entre 0 e 100.

Desempenho:

- 66,7% Modelos estatísticos
- 22,2% Força dos adversários
- 11,1% Dominância

São os pesos 6:2:1 do `competitiveWeights`. Consistência e Relevância saíram em 22/09/2026: medida entre as 105 equipes, a Consistência correlacionava -0,39 com a nota final (equipe que perdia todas tirava 100, porque perder era o esperado) e a Relevância correlacionava 0,89 com os Modelos e 0,92 com a Dominância, repetindo o que já estava contado.

Modelos estatísticos:

- 85% média dos modelos principais
- 15% PCA corrigido

Modelos principais implementados: Colley, Massey, Elo final, Elo com margem, TrueSkill aproximado, PageRank de vitórias e Bradley-Terry-Poisson. O PCA usa os modelos normalizados e inverte o sinal quando a correlação com a média dos modelos é negativa.

## Conquistas

Regra em vigor desde 22/09/2026:

- Cada campeonato tem a própria tabela de pontos por colocação, em `ranking-weights.json` → `tournaments.<id do evento>.placementPoints`. A chave é o rótulo que o site mostra (`"1"`, `"5-6"`, `"Classificado"`). O valor da tabela é o valor final da colocação: peso do campeonato e tamanho não multiplicam por cima.
- "Classificado" ocupa as primeiras colocações que as faixas numeradas deixam livres (1-4 numa classificatória de 4 vagas).
- Todo resultado soma inteiro: os pontos de todos os campeonatos se acumulam.
- Cada ponto perde valor em linha reta desde o fim do campeonato e zera em 304 dias (10 meses): `valor × (1 - dias / 304)`.
- A equipe com a maior soma recebe 100 no bloco, e as demais recebem `100 × soma / maior soma`. Sem pontos, a nota do bloco é 0.
- Campeonato com `ignoreAchievements: true` não gera conquista (hoje, a LPE). Campeonato em andamento só conta depois de encerrado e com todas as colocações preenchidas.
- Colocação cujo rótulo não está na tabela cai na regra geral antiga (`achievements.placementPoints` × peso × tamanho). O `build_database.js` avisa quando isso acontece e quando uma chave de `tournaments` não corresponde a nenhum evento.

Tabelas já cadastradas para campeonatos que ainda não terminaram: `univava-fase-de-grupos` e `univava-playoffs` (este último para a pasta `campeonatos/Univavá/Playoffs`, que ainda não existe).

## Peso do mapa

Cada mapa entra no Desempenho e na Forma recente com peso igual a recência × campeonato × fase × série. Desde 22/09/2026 o peso do campeonato e o da fase saem da tabela de pontos das conquistas, e não de um número escrito à mão:

- **Campeonato:** `raiz(pontos do campeão / 100)`. Os 100 pontos do título do JUBS Etapa Presencial são a referência e valem 1. Hoje: JUBS (as duas fases), Univavá fase de grupos e playoffs em 1,00; AOC, Rush Esquenta 1 e 2 e Univavá C1 em 0,59; RivvalsGG, Ascension, Kick-OFF e Rush Inclusivo em 0,55; UniCup, TOTALE e C2 em 0,50; Pré-JUBS SP, C3 e Copa LUCE em 0,45; C4 em 0,39; CIA em 0,22.
- **Classificatória que paga 0 no topo:** `tournaments.<id>.qualifiesTo` aponta para o campeonato onde a vaga vira ponto, e ela usa os pontos de lá. Hoje, `jubs-fase-inicial` aponta para `jubs-etapa-presencial` e `univava-fase-de-grupos` para `univava-playoffs`.
- **Fase:** `(pontos que a fase decide / pontos médios por equipe do campeonato) ^ 0.25`. A final usa a média do 1º e do 2º; playoffs e qualifier usam a média das colocações que pagam acima da média do evento; regular e showmatch ficam na média, ou seja, em 1,00. Hoje as fases vão de 1,13 (CIA) a 1,37 (final do Kick-OFF).
- **Campeonato sem tabela de pontos** usa o `weight` escrito à mão, se houver, ou 1. Hoje é o caso da LPE (0,85) e do Pré-JUBS (0,30).
- **Regras de fase** (`phaseRules`) casam a série por faixa de código (`seriesCodeMin`/`seriesCodeMax`) ou por código exato (`seriesCode`), que é o jeito de tratar série com código de letra, como a `FINAL` do Pré-JUBS SP. Uma regra sem faixa numérica só casa pelo código exato. O `build_database.js` avisa quando um campeonato encerrado tem regra de fase que não casa com nenhuma série.

## Pesos editáveis

Os pesos de campeonatos, fases, séries e pontos por colocação ficam em `ranking-weights.json`.

- `seriesWeights`: MD1 = 1.00, MD3 = 1.10, MD5 = 1.15.
- `tournaments`: fase padrão e regras de fase por código de série (`defaultPhase` e `phaseRules`).
- `tournaments.<id>.placementPoints`: pontos por colocação daquele campeonato (ver Conquistas). É de onde saem também o peso do campeonato e o das fases (ver Peso do mapa).
- `pointsWeights`: `reference` (100 pontos = peso 1), `tournamentExponent` (0.5) e `phaseExponent` (0.25).
- `achievements.normalization` (`"top"`), `achievements.lifetimeDays` (304) e `achievements.additionalResultMultiplier` (1): a regra de conquistas descrita acima.
- `achievements.placementPoints` e `achievements.sizeWeights`: regra geral antiga, usada só por colocação sem tabela.
- `achievements.manualResults`: resultados manuais opcionais quando a colocação real não deve ser inferida.

## Fallbacks

- Nenhuma conquista em nenhum campeonato: o bloco de conquistas fica neutro em 50 para todos. Havendo pontos, a equipe sem nenhum fica com 0.
- Sem estatísticas de jogadores: rAAting 3.0 dos jogadores fica neutro em 50.
- Sem dados suficientes em um modelo estatístico: o modelo usa um resultado neutro/regularizado e ainda entra normalizado.
- Times com menos de `minimumMatches` partidas são marcados como provisórios. O valor atual em `ranking-weights.json` é 9 partidas.
- Times com elenco atual incompleto (menos de `minimumRosterSize` jogadores cadastrados, hoje 5) são marcados como inativos e ficam fora do ranking válido, independentemente do número de partidas. Sem nenhum jogador cadastrado, a equipe some do ranking (inclusive do escopo "Todos").
- A posição canônica é sempre a posição no ranking "Apenas válidos"; a visualização "Todos" recalcula a numeração incluindo equipes provisórias e inativas, sem alterar históricos ou snapshots.
- A lineup exibida na semana atual é o elenco cadastrado da equipe; com mais de cinco jogadores registrados, aparecem os cinco com mais partidas pela equipe. Semanas anteriores mantêm a lineup observada nas partidas daquela semana.
- Valores `NaN`, infinito ou ausentes são tratados como neutros e nunca chegam ao resultado final.

## Recência

O decaimento usa:

```text
peso = 0.5 ^ (dias_desde_evento / meia_vida)
```

Meias-vidas:

- Partidas gerais: 150 dias
- Forma recente: janela de 60 dias e meia-vida de 30 dias
- Rating de jogadores: 90 dias

As conquistas não usam meia-vida: caem em linha reta até zerar em 304 dias (ver Conquistas).

## Recálculo

O ranking é recalculado no carregamento do app, mas a versão oficial é congelada em snapshots semanais publicados toda terça-feira às 00:00. Uma nova semana é publicada mesmo quando não há partidas desde o corte anterior, pois recência e decay ainda podem alterar as notas. Partidas novas só entram no ranking quando chegam ao próximo snapshot de terça. Ao navegar por semanas, notas, amostra de partidas e lineup exibida usam apenas dados disponíveis até aquele snapshot.

Histórico de lineups:

```bash
node scripts/build_lineup_history.js
```

O script lê os JSONs listados em `data-sources.json`, agrupa mudanças de core automaticamente e atualiza `lineupHistory` em `team-profiles.json`. Os dados vindos de `dados_excel/players.xlsx` entram via `metadata.json` como camada de confiança: `puuid`, `nickHistory`, `currentTeam` e `teamHistory` ajudam a resolver jogadores, desempatar o core e evitar que uma troca pontual quebre a line-up.

Para atualizar dados:

1. Adicione ou remova JSONs em `data-sources.json`.
2. Ajuste pesos em `ranking-weights.json`, se necessário.
3. Abra `index.html` ou recarregue o app. A página Ranking permite navegar pelas semanas publicadas.

Teste básico:

```bash
node scripts/test_ranking_core.js
```
