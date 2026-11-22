# rAAting 3.1 pela HLTV

Data: 21/11/2026. A especificação nasce do estudo de 20 e 21/11 (`outputs/estudo-raating-hltv-2026-11-20/RELATORIO.md`) e das decisões que o dono tomou nele. Os scripts do estudo, em `scripts/estudos/`, já calculam tudo o que está aqui; a conta deles é a referência para conferir a implementação.

## Por que

- O dono decidiu que o rating segue a HLTV, que criou o rating, e que toda peça marca a origem: oficial, estimativa, medido ou escolha. Ele quer eliminar número escolhido à mão sem marca.
- Hoje o rAAting 3.0 tem pesos (.25/.33/.15/.15/.08/.04), uma régua (mediana e IQR de cada parte com 1 + 0,28·z), ajustes de abertura, troca e sobrevivência, metade do efeito da economia no dano e 35% no KAST. Nada disso tem fonte.
- O swing dá todo o crédito a quem dá o último tiro, ignora a spike, segue contando depois que o round acabou e dá swing positivo a quem mata um aliado.

## Objetivos

- **A nota nova se chama rAAting 3.1** (decisão do dono em 21/11): é a fórmula estimada da HLTV, com o dano convertido para a vida do Valorant e 1,00 na média do grupo.
- **O swing:**
  - divide o crédito do abate pelo dano;
  - usa uma tabela de chance com a spike, medida nas partidas do site;
  - fecha quando o round acaba;
  - pune o abate em aliado.
- **A economia** perde os ajustes sem fonte.
- **O Regen Shield** entra na tabela de colete com o nome dele.
- **Cada peça** fica com a origem registrada no `docs/raating-3.md`.

## Fora do objetivo

- **O rAAting 1.0** (`raating_1`, `calculateRaating1`, `impactTotalLegacy`, `kastLegacyRounds`) continua como está.
- **O placar** não muda: K/D/A, ADR, ACS e o KAST clássico continuam batendo com o jogo.
- **As faixas de economia, os pontos do multi-kill (1; 2; 3,5; 5) e a janela de troca** não mudam neste trabalho. Ficam registradas como sem fonte.
- **As cartinhas** não mudam: os números delas são congelados.
- **Matérias, MVPs e prêmios** não mudam. O dono é avisado do que fica desatualizado.

## O que não pode acontecer

- Uma nota publicada calculada com uma média do grupo diferente da do banco em que ela está.
- O site recalcular no navegador uma nota diferente da do build para as mesmas linhas.
- O swing de um round deixar de somar zero.
- O rAAting 1.0 mudar.
- Travessão em texto, código ou commit; sempre hífen.

## Fontes

| # | Fonte | O que dá |
|---|---|---|
| 1 | HLTV, "Introducing Rating 3.0", https://www.hltv.org/news/42485/introducing-rating-30 (20/08/2025) | As seis partes; o swing divide o crédito por último tiro, dano, flash e troca; o modelo de chance usa economia, bomba, vivos e mapa; abate, dano e sobrevivência ajustados pelo duelo; KAST e multi-kill pela chance da ação; 1,00 é a média |
| 2 | Reddit r/GlobalOffensive, "HLTV3 formula reversed with 0.03 error" (a mesma fonte 5 do Hub CS2) | A fórmula estimada: 0,4941·eKPR + 0,3795·(1 − eDPR) + 0,4280·eADR/100 + 0,2602·eKAST + 0,03748·Swing% + 0,0241·MK/R |
| 3 | HLTV, páginas de 150 jogadores, 1º/05 a 20/11/2026 (`outputs/estudo-raating-hltv-2026-11-20/hltv_jogadores.csv`) | A fórmula estimada reproduz a nota 3.0 com correlação 0,996; o dano por abate do CS é 108,5 |
| 3b | HLTV, 2.707 jogadores com 10+ mapas e 3.600 mapas (36.004 linhas), 20/08/2025 a 20/11/2026 (`hltv_jogadores_grande.csv` e `hltv_mapas.csv`, na mesma pasta) | Confirma a reprodução (0,996 por jogador, 0,987 por mapa) e o dano por abate (109,0, fator 1,427); a sobrevivência decide 6,6% da ordem no CS |
| 4 | API pública de itens do Valorant, https://valorant-api.com/v1/gear | O id `B1B9086D-41BD-A516-5D29-E3B34A6F1644` é o Regen Shield: 650, 25 de escudo ativo, absorve 100%, reserva de 50 |
| 5 | Partidas do site (2.723) | O dano por abate do Valorant (155,6, com o dano limitado à vida); a tabela de chance com spike; o colete de cada round |

## Abordagens consideradas

Todas foram medidas no estudo, nas 2.723 partidas e nos 59 campeonatos com 10+ jogadores de 50+ rounds.

1. **Pesos.**
   - Opções:
     - os de hoje;
     - os β puros;
     - os β convertidos pelo desvio de cada parte;
     - **os β com só o dano convertido pela vida (escolhida)**.
   - Os β puros dão ao dano 32% da ordem no univlr, contra 20% na HLTV.
   - Os convertidos pelo desvio mudam o valor de um abate conforme a variação dos jogadores, o que a HLTV não faz, e encolhem a escala em 29%.
   - Converter só o dano ficou a até 4,8 pontos da HLTV em cada parte, previu o vencedor igual aos outros (67%) e foi mais estável que os pesos de hoje.
   - O fator 1,5 é decisão do dono: a vida com colete pesado é 150, e o dano por abate medido dá 1,434 (1,427 na amostra grande).
   - **Com a amostra grande (2.707 jogadores), a distância vai a 6,1 pontos (95%: 4,7 a 7,4), acima dos 5 do critério.** A parte é a sobrevivência: decide 6,6% da ordem no CS e 0,6% no univlr. O dano fica a 2,9 pontos.
     - No CS, quem sobrevive mais é melhor no resto (correlação de +0,24 com o restante da nota); no univlr, não (-0,03). É diferença entre os jogos, e o fator do dano não mexe nela (com 1,428, a distância é a mesma).
     - Os convertidos pelo desvio passam (4,0), ao custo da escala e da origem descritos acima.
     - **Decisão do dono (21/11), depois da amostra grande: manter o ÷ 1,5.**
2. **Crédito do abate:** tudo para quem matou; **dividido pelo dano cru (escolhida)**; dividido pelo dano limitado à vida. O limitado deixa quem matou sem crédito nenhum em 1.758 abates.
3. **Plantio na tabela com spike:** sem crédito (o valor do plantio vai para a defesa pelo resíduo); tudo para quem planta; **dividido entre os vivos do ataque (escolhida)**.
4. **Onde fica o 1,00:** **na média do grupo (escolhida, como a HLTV)** ou na mediana dos mapas (decisão de 16/11). A diferença é somar 0,026 a todas as notas; a ordem é a mesma.
5. **Regen Shield:** +25, **+50 (escolhida, o meio)** ou +75. A regeneração não aparece nos dados. Com o meio, o pior erro numa nota de campeonato é 0,016, contra 0,026 nos extremos.

## O desenho

### 1. A nota

```
nota = 1 + Σ βᵢ · (xᵢ − x̄ᵢ)
```

| Parte | β | xᵢ (por round) | Origem |
|---|---|---|---|
| Abate | 0,4941 | `eKillPoints / rounds` | estimativa (fonte 2) |
| Sobrevivência | 0,3795 | `1 − eDeathPoints / rounds` | estimativa |
| Dano | 0,4280 ÷ 1,5 = 0,285333 | `eDamageTotal / rounds / 100` | estimativa; o 1,5 é escolha do dono, apoiada no dano por abate medido (1,434) e na vida com colete pesado (150) |
| KAST | 0,2602 | `eKastPoints / rounds` (fração) | estimativa |
| Swing | 0,03748 | `adjustedRoundSwingTotalPp / rounds` (pontos percentuais) | estimativa |
| Multi-kill | 0,0241 | `multiKillPoints / rounds` | estimativa; os pontos 1; 2; 3,5; 5 são do univlr, sem fonte |

- **x̄, a média do grupo:**
  - é a soma das contagens de todas as linhas jogador x mapa do build, dividida pela soma dos rounds;
  - é refeita a cada build (decisão do dono);
  - o 1,00 fica na média, e não na mediana (decisão do dono em 21/11, seguindo a HLTV). Com isso, o mapa típico fica em 0,974 e a carreira típica (50+ rounds) em 0,910;
  - fica guardada no banco e é usada pelo navegador ao recalcular;
  - origem: medido.
- **O 0,1358 da fórmula some:** com a nota centrada, ele não muda nada.
- **Saem da nota:** os pesos, a régua (mediana, IQR, 0,28) e os ajustes de abertura (0,025), negação de troca (0,015) e sobrevivência (0,04, 0,04, 0,03, 0,02, 0,015).
  - As contagens continuam sendo feitas, porque outras telas podem usá-las; só deixam de entrar na nota.
- **Continua linear:** a nota de várias linhas é a nota da soma das contagens, igual à média das notas pesada pelos rounds. A média pesada de todas as linhas do build dá exatamente 1,00.
- **Sem limites,** como desde 16/11.
- **Amostra mínima:** continua em 50 rounds (`SAMPLE_MIN_ROUNDS`).
- **As partes da nota:** são `βᵢ · (xᵢ − x̄ᵢ)`, em pontos, e somam a nota menos 1. Elas tomam o lugar dos seis componentes de hoje (`KillRating`, `DamageRating`, `RoundSwingRating`, `SurvivalRating`, `KASTRating`, `MultiKillRating` e as versões em minúsculas).
- **`rating_recon_proxy` sai:** virou a própria nota.

### 2. Swing (`applyRoundSwingStats` no `app.js`)

- **A tabela de chance:**
  - é a chance de o ataque vencer por (vivos do ataque, vivos da defesa, spike plantada), medida a cada build nas partidas do site, como o modelo de economia;
  - a regra de medição é a de `scripts/estudos/medir_chance_spike.js`: cada situação conta uma vez por round, e nada conta depois do desarme, da explosão ou da eliminação;
  - a defesa sem vivos vale 100% para o ataque; o ataque sem vivos e sem spike vale 0%; o ataque sem vivos com spike usa a tabela, porque a defesa ainda tem de desarmar;
  - a chance da defesa é 1 menos a do ataque;
  - célula que faltar (elenco maior que 5, banco pequeno de teste) cai na tabela simétrica de hoje (`stateWinratesByKey`);
  - fica guardada no banco;
  - origem: medido. A HLTV diz que o modelo usa a bomba (oficial).
- **Cada morte, enquanto o round está vivo:**
  - Δ é a mudança na chance do time da vítima;
  - a vítima soma Δ;
  - o lado de quem matou soma −Δ, dividido entre os inimigos da vítima que deram dano nela no round, na proporção desse dano;
    - o dano é o cru, de `damageByVictim`, do round inteiro (a Riot não dá a hora do dano);
    - sem dano registrado, tudo vai para quem matou;
    - origem: oficial (só a parte do dano da divisão da HLTV);
  - **abate em aliado** (decisão do dono): quem matou soma Δ, a vítima não perde nada (a perda dela sai), e os vivos do time rival dividem −Δ em partes iguais;
  - **suicídio, ou morte sem autor:** a vítima fica com Δ, e os vivos do rival dividem −Δ.
- **Plantio:** o salto da chance do ataque vai para os vivos do ataque em partes iguais e é cobrado dos vivos da defesa em partes iguais. Origem: escolha, a mesma regra do resíduo.
- **Fim do round** (decisão do dono):
  - o round acaba pelo motivo da Riot (`roundResult`):
    - `Bomb defused`: em `defuseRoundTime`;
    - `Bomb detonated`: em `plantRoundTime + 45000`, com 50 ms de folga, porque as mortes pela explosão caem de 0 a 1,6 s depois;
    - `Eliminated`: na morte que deixa a defesa sem vivos, ou o ataque sem vivos e sem spike;
  - os vivos se contam entre os participantes do round;
  - nada depois do fim conta;
  - no tempo esgotado e nos outros motivos não há corte;
  - o que falta para 100% vai para os vivos do vencedor naquele momento e é cobrado dos vivos do perdedor (ou do time inteiro, se ninguém sobrou), como hoje, com a chance da tabela com spike.
- **Soma zero:** a correção final do round continua como hoje.
- **O swing legado** (`impactTotalLegacy`, do rAAting 1.0) continua exatamente como hoje: tabela simétrica, todos os abates do round (inclusive os de depois do fim) e nenhuma dessas mudanças. O script do estudo pulava esses abates também no legado; isso não afeta o rAAting 3.0, mas a implementação não pode copiar esse detalhe.

### 3. Economia (`raating-core.js` e `app.js`)

- **`createEcoModel`:** o multiplicador é `2,095 − 2,074·p`, sem dividir pela média e sem o limite de 0,35 a 1,75.
  - p continua sendo a chance de quem matou vencer o duelo, medida nas partidas por faixa.
  - Origem: a reta é estimativa (passa pelos dois exemplos oficiais) e o p é medido.
- **Abate e morte:** somam o multiplicador inteiro, como hoje.
- **Dano** (`applyEffectiveDamage`): usa o multiplicador inteiro (`reducedEcoMultiplier(m, 0.5)` sai). Origem: oficial, a HLTV ajusta o dano pelo duelo.
- **KAST da nota** (`applyKastStats`): sem ajuste de economia. Cada round que conta no KAST da nota vale 1 (`reducedEcoMultiplier(m, 0.35)` sai). Origem: lacuna; a HLTV ajusta pela chance da ação, sem números.

### 4. Colete (`ARMOR_EXTRA_HP` no `app.js`)

- **Regen Shield** (`B1B9086D-41BD-A516-5D29-E3B34A6F1644`): entra com +50 e um comentário.
  - Ele absorve entre 125 e 175 no round, e a regeneração não aparece nos dados: a Riot dá o dano somado por round, sem hora, e conta o tiro cheio.
  - O meio minimiza o pior erro.
  - Origem: escolha.
  - O número é o mesmo de hoje, que caía no +50 padrão.
- **Leve (+25) e pesado (+50):** continuam. Origem: oficial (Riot).
- **Colete do tracker** (`TRACKER-COLETE-DESCONHECIDO`): continua como +50. Origem: escolha já existente.
- **A cura** não entra: a Riot não registra cura (lacuna).

### 5. O site

- **O nome:** o site passa a mostrar "rAAting 3.1" onde hoje mostra "rAAting 3.0", e `rating_version` passa de `raa3` para `raa3.1`. O campo técnico `raating_3` pode ficar com esse nome, para não quebrar quem o lê; a decisão fica com o construtor.

- **Onde a nota aparece:** os números mudam, e o layout e as telas não.
- **Os componentes viram as seis partes, em pontos com sinal, nas três telas de hoje:**
  - as colunas "Componentes do rAAting" das tabelas (`app.js:32326`);
  - a dica da nota (`ratingBreakdownTooltip` e `ratingFormulaText`);
  - a lista do perfil (`ratingComponentDefinitions`).
- **Os nomes das partes:** Abate, Sobrevivência, Dano, KAST, Swing e Multi-kill.
- **A dica da fórmula:** troca os percentuais de hoje pela soma das partes. As palavras ficam com o construtor, com as regras do site: pt-BR, hífen, sem parágrafo de regra na página.
- **O navegador recalcula a nota com a média do banco:** os pontos que recalculam (`finalizePlayerStatRow`, `finalizeAggregatePlayer`, `tournamentFinalizeAgentRow`, `tournamentFinalizeCompositionRow`, `playerFinalizeMapRow`, `weeklyPlayerRows`) passam pelo mesmo `applyRaatingFields`, que tem de receber a média do grupo vinda do banco.
- **O gráfico de evolução do perfil** mantém o eixo de 0,6 a 1,6, como o dono decidiu antes. Mais pontos vão ficar fora.

### 6. Build e dados

- **O contexto do rAAting** (`buildRaatingContext`) passa a montar também a tabela com spike.
- **A ordem no build:**
  1. contexto;
  2. contagens de todas as partidas;
  3. média do grupo;
  4. notas de todas as linhas;
  5. agregados (jogadores, equipes, campeonatos, ranking).
  - Uma conta que só ordena dentro de uma partida pode vir antes da média, porque a média só desloca todas as notas. Mas todo número de nota guardado tem de usar a média do build.
- **No banco:** `metadata.raatingContext` guarda a média do grupo (`centro`, com as seis taxas) e a tabela com spike, como objetos simples (o `ecoModel` de hoje sai vazio porque é `Map`).
  - O `home.json` sai do mesmo build.
- **`build_database.js`:** a lista `DEAD_PLAYER_FIELDS` perde os campos que deixam de existir.
  - As partes que as telas mostram vêm do banco ou são recalculadas no navegador com a média do grupo do banco. As duas formas servem, desde que a parte mostrada seja `βᵢ · (xᵢ − x̄ᵢ)` com essa média.
- **A cópia em Python** (`ferramentas/riot/analiseMatches.py`): passa a usar a mesma fórmula e a mesma média do grupo. As contagens ela já pega do `app.js`, por `export_site_match_stats.js`. O teste `scripts/test_analise_matches_alignment.py` continua comparando as duas.
  - O caminho antigo do Python, com swing próprio (`build_records_for_match`), só muda se ainda for usado pelo relatório; conferir antes.
- **`docs/raating-3.md`:** reescrito com a fórmula, a tabela de origens abaixo e as lacunas.
- **O pipeline completo** de sempre (metadata, lineups, banco), com o banco e o home commitados juntos.

### 7. Como verificar

- **A implementação tem de reproduzir o estudo.**
  - O `raating_3` de cada linha jogador x mapa do banco tem de bater com a variante `vida_final` de `scripts/estudos/raating_variantes.js` mais a nota de `nota_beta.js` (β com o dano ÷ 1,5), com diferença de no máximo 1e-9.
  - A tabela com spike do banco tem de bater com `medir_chance_spike.js`.
  - Controle negativo: o banco publicado hoje tem de falhar nessa comparação.
- **Testes de unidade** (no estilo dos `scripts/test_*.js`):
  - **média do grupo:** a média das notas de todas as linhas, pesada pelos rounds, dá 1,00; uma linha igual à média dá 1,00; as partes somam a nota menos 1;
  - **linearidade:** a nota da soma de duas linhas é a média das duas pesada pelos rounds (o `test_nota_pela_soma.js` continua valendo);
  - **crédito pelo dano:** dois atacantes com 60 e 40 de dano na vítima ficam com 0,6 e 0,4 do crédito; sem dano registrado, tudo para quem matou; se só outros deram dano, quem matou fica com 0;
  - **spike:** depois do plantio, a mesma morte muda a chance pela célula com spike; o salto do plantio vai para os vivos do ataque e é cobrado dos vivos da defesa;
  - **fim do round:** abate depois do desarme e morte pela explosão não mudam o swing; o resíduo usa os vivos do momento do fim; numa eliminação, a morte que fecha o round conta e a seguinte não; com o ataque todo morto e a spike plantada, o round continua;
  - **aliado e suicídio:** quem matou o aliado fica com Δ negativo, a vítima com 0, e os vivos do rival somam −Δ; no suicídio, a vítima fica com Δ;
  - **soma zero:** em todo round, o swing soma zero;
  - **economia:** com p = 0,1 o multiplicador vale 1,888 (hoje pararia em 1,75), e com p = 0,9 vale 0,228 (hoje pararia em 0,35); o dano usa o multiplicador inteiro; o KAST da nota conta 1 por round;
  - **colete:** o Regen Shield vale +50 pelo id;
  - **rAAting 1.0:** igual ao de hoje em todas as linhas do banco;
  - **testes de hoje:** `scripts/test_raating3_core.js` passa a conferir a fórmula nova, e `test_nota_pela_soma.js` e `test_analise_matches_alignment.py` continuam passando.
- **No navegador:** para um jogador, a nota recalculada num filtro (por exemplo, a aba de agentes de um campeonato) bate com a soma das linhas do build.

### 8. O que muda para quem lê o site

Medido no estudo, com tudo junto:

- 96% das notas de campeonato encerrado mudam na segunda casa, e as notas ficam 32% mais espalhadas.
- 11 dos 58 líderes de campeonato encerrado mudam. A lista está na seção "Mais decisões do dono em 21/11" do relatório.
- No JUBS Goiás presencial, o Mendes (1,497) passa o kzr (1,481), que é o MVP premiado. O prêmio fica; a matéria de 09/09 fica com números velhos.
- 356 mapas ficam com nota negativa (hoje são 18), e o maior mapa fica em 3,64. A melhor carreira vai a 1,75.
- O ranking de equipes não muda o líder nem o top 10 em nenhuma das 153 semanas; a maior troca numa semana é de 1 posição.
- A cada build, com a média do grupo e a tabela refeitas, as notas antigas mexem um pouco.

## Origem de cada peça

| Peça | Origem |
|---|---|
| As seis partes | oficial |
| β de abate, sobrevivência, KAST, swing e multi-kill | estimativa |
| β do dano ÷ 1,5 | estimativa e escolha (apoiada no dano por abate medido, 1,434 e 1,427) |
| Média do grupo (1,00 na média) | medido; a escala com 1,00 na média é oficial |
| Tabela de chance com spike | medido; o uso da bomba é oficial |
| Crédito do abate pelo dano | oficial (só a parte do dano) |
| Salto do plantio para os vivos do ataque | escolha |
| Resíduo do fim do round para os vivos | escolha (a HLTV descreve algo parecido) |
| Fim do round pelo motivo da Riot | escolha do dono |
| Abate em aliado e suicídio | escolha do dono |
| Reta da economia 2,095 − 2,074·p | estimativa; p medido |
| Dano com o multiplicador inteiro | oficial |
| KAST da nota sem ajuste de economia | lacuna |
| Colete leve e pesado | oficial |
| Regen Shield +50 | escolha (meio de 125 a 175) |
| Colete do tracker +50 | escolha |
| Amostra mínima de 50 rounds | escolha |

## Lacunas registradas

- **Cura:** a Riot não registra cura.
- **Regeneração do Regen Shield:** não é observável.
- **Divisão do crédito:** último tiro, flash e troca ficam de fora; a HLTV não dá peso.
- **Tabela de chance:** a HLTV diz que entram mapa e economia. Não estão aqui.
- **Ajuste do KAST e do multi-kill** pela chance da ação.
- **Continuam sem fonte, fora deste trabalho:**
  - as faixas de economia, que são as do CS2 aplicadas aos créditos do Valorant;
  - os pontos do multi-kill;
  - a janela de troca;
  - a amostra mínima.
- **O dano das partidas do tracker:** é cortado em 150 para todos, porque o colete não vem no arquivo.
- **A sobrevivência pesa menos na ordem que na HLTV** (0,6% contra 6,6% na carreira; igual num mapa só). Os β por unidade são os da HLTV; a diferença vem de como a sobrevivência anda com o resto entre amadores, e não é corrigida.

## Deixado para o construtor

- Os nomes de funções e campos (as partes, a média do grupo, a tabela) e como o núcleo recebe a média do grupo, no build e no navegador.
- As palavras da dica e das colunas, com as regras do site.
- A ordem das etapas e os commits, um por etapa conferida. Nada vai para o origin sem o dono pedir.
