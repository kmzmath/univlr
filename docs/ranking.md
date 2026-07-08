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

- 60% Modelos estatísticos
- 20% Força dos adversários
- 10% Dominância
- 5% Consistência
- 5% Relevância competitiva

Modelos estatísticos:

- 85% média dos modelos principais
- 15% PCA corrigido

Modelos principais implementados: Colley, Massey, Elo final, Elo com margem, TrueSkill aproximado, PageRank de vitórias e Bradley-Terry-Poisson. O PCA usa os modelos normalizados e inverte o sinal quando a correlação com a média dos modelos é negativa.

## Pesos editáveis

Os pesos de campeonatos, fases, séries e pontos por colocação ficam em `ranking-weights.json`.

- `seriesWeights`: MD1 = 1.00, MD3 = 1.10, MD5 = 1.15.
- `tournaments`: peso do campeonato, fase padrão e regras para fases por código de série.
- `achievements.placementPoints`: pontos por colocação.
- `achievements.sizeWeights`: peso por tamanho do campeonato.
- `achievements.manualResults`: resultados manuais opcionais quando a colocação real não deve ser inferida.

## Fallbacks

- Sem conquistas: o bloco de conquistas fica neutro em 50.
- Sem estatísticas de jogadores: rAAting 3.0 dos jogadores fica neutro em 50.
- Sem dados suficientes em um modelo estatístico: o modelo usa um resultado neutro/regularizado e ainda entra normalizado.
- Times com menos de `minimumMatches` partidas são marcados como provisórios. O valor atual em `ranking-weights.json` é 9 partidas.
- A posição canônica é sempre a posição no ranking "Apenas válidos"; a visualização "Todos" recalcula a numeração incluindo equipes provisórias, sem alterar históricos ou snapshots.
- Valores `NaN`, infinito ou ausentes são tratados como neutros e nunca chegam ao resultado final.

## Recência

O decaimento usa:

```text
peso = 0.5 ^ (dias_desde_evento / meia_vida)
```

Meias-vidas:

- Partidas gerais: 150 dias
- Conquistas: 210 dias
- Forma recente: janela de 60 dias e meia-vida de 30 dias
- Rating de jogadores: 90 dias

## Recálculo

O ranking é recalculado no carregamento do app, mas a versão oficial é congelada em snapshots semanais publicados toda terça-feira. Partidas novas só entram no ranking quando chegam ao próximo snapshot de terça. Ao navegar por semanas, notas, amostra de partidas e lineup exibida usam apenas dados disponíveis até aquele snapshot.

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
