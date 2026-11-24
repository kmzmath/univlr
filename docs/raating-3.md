# rAAting 3.1

O rating oficial do site é o `rAAting 3.1` (desde a especificação de 21/11/2026, `docs/superpowers/specs/2026-11-21-raating-hltv-design.md`), salvo no campo `raating_3`, com `rating_version` `raa3.1`. O campo `rating` aponta para o mesmo valor, para manter telas e rankings funcionando. O cálculo antigo fica em `raating_1` (rAAting 1.0), sem mudança.

O rAAting segue a HLTV, que criou o Rating 3.0, e cada peça marca a origem: oficial, estimativa, medido ou escolha. O estudo que levou a esta versão está em `outputs/estudo-raating-hltv-2026-11-20/RELATORIO.md`, e os scripts dele em `scripts/estudos/`.

## A nota

```
nota = 1 + Σ βᵢ · (xᵢ - x̄ᵢ)
```

| Parte | β | xᵢ (por round) | Origem |
|---|---|---|---|
| Abate | 0,4941 | `eKillPoints / rounds` | estimativa |
| Sobrevivência | 0,3795 | `1 - eDeathPoints / rounds` | estimativa |
| Dano | 0,4280 ÷ 1,5 = 0,285333 | `eDamageTotal / rounds / 100` | estimativa; o 1,5 é escolha do dono, apoiada no dano por abate medido (1,43) e na vida com colete pesado (150) |
| KAST | 0,2602 | `eKastPoints / rounds` (fração) | estimativa |
| Swing | 0,03748 | `adjustedRoundSwingTotalPp / rounds` (pontos percentuais) | estimativa |
| Multi-kill | 0,0241 | `multiKillPoints / rounds` | estimativa; os pontos 1; 2; 3,5; 5 são do univlr, sem fonte |

- **Os β** vêm da fórmula estimada da HLTV (r/GlobalOffensive, "HLTV3 formula reversed with 0.03 error"). Ela reproduz a nota oficial com correlação de 0,996 em 2.707 jogadores e 0,987 em 36.004 linhas de mapa.
- **x̄, a média do grupo:** a soma das contagens de todas as linhas jogador x mapa do build, dividida pela soma dos rounds. É refeita a cada build e fica no banco, em `metadata.raatingContext.centro`. O navegador e o `build_home.js` leem a média de lá antes de recalcular qualquer nota (`aplicarContextoDoRaating`). Sem média, a nota não existe (aparece "-"), para nunca sair uma nota com outra média.
- **1,00 é a média**, como na HLTV: a média das notas de todas as linhas, pesada pelos rounds, dá exatamente 1,00.
- **As partes** (`parte_abate`, `parte_sobrevivencia`, `parte_dano`, `parte_kast`, `parte_swing`, `parte_multikill`) são `βᵢ · (xᵢ - x̄ᵢ)`, em pontos, e somam a nota menos 1. São as colunas "Partes do rAAting", a dica da nota e a composição do perfil.
- **Linear:** a nota de várias linhas é a nota da soma das contagens, igual à média das notas pesada pelos rounds. `scripts/test_nota_pela_soma.js` trava isso.
- **Sem limites** (desde 16/11/2026): nada de teto ou piso. Com a média em 1,00 e os amadores variando mais que os profissionais, há mapas com nota negativa e mapas acima de 3.

## Swing

Em `applyRoundSwingStats`, no `app.js`.

- **Tabela de chance:** a chance de o ataque vencer por (vivos do ataque, vivos da defesa, spike plantada), medida a cada build nas partidas do site (`measureSpikeTable`) e guardada em `metadata.raatingContext.spikeTable`.
  - Cada situação conta uma vez por round; nada conta depois do desarme, da explosão ou da eliminação.
  - A defesa sem vivos vale 100% para o ataque; o ataque sem vivos e sem spike vale 0%; o ataque sem vivos com spike usa a tabela.
  - Célula que falta (elenco maior que 5) e round sem o papel do vencedor caem na tabela simétrica do `metadata.json`.
- **Cada morte:** a vítima soma a mudança da chance do time dela. O lado de quem matou soma o contrário, dividido entre os inimigos da vítima que deram dano nela no round, na proporção do dano cru (`damageByVictim`, do round inteiro, porque a Riot não dá a hora do dano). Sem dano registrado, tudo vai para quem matou.
- **Abate em aliado:** quem matou leva a perda inteira, a vítima não perde nada, e os vivos do rival dividem o ganho. **Suicídio ou morte sem autor:** a vítima fica com a perda, e os vivos do rival dividem o ganho.
- **Fora do swing, abate é só o de inimigo** (decisão do dono, 23/11/2026). A morte pela própria ação (spike, habilidade) e o abate em aliado seguem sendo morte de quem morreu, mas não dão abate a ninguém: ficam de fora dos pontos de abate, do "K" do KAST, do multi-kill e do first kill, do jogador e da equipe. São 2.698 e 92 de 388.289 abates. O K do placar vem da Riot e já não contava quase nenhum deles. Antes, a nota contava, e mudou pouco: na carreira, mediana 0,002 e no máximo 0,019; o MVP de 28 mapas mudou, e o ranking de equipes não.
- **Plantio:** o salto da chance do ataque vai para os vivos do ataque em partes iguais e é cobrado dos vivos da defesa.
- **Fim do round**, pelo motivo da Riot (`roundResult`): desarme em `defuseRoundTime`; explosão em `plantRoundTime + 45000`, com 50 ms de folga; eliminação na morte que deixa a defesa sem vivos, ou o ataque sem vivos e sem spike. Nada depois do fim conta. O que falta para 100% vai para os vivos do vencedor naquele momento e é cobrado dos vivos do perdedor (ou do time inteiro, se ninguém sobrou).
- **Soma zero:** o swing de todo round soma zero.
- **O swing legado** (`impactTotalLegacy`, do rAAting 1.0) fica como sempre foi (`applyLegacyRoundSwing`): tabela simétrica, todos os abates do round, inclusive os de depois do fim.

## Economia

- `createEcoModel` (`raating-core.js`): o multiplicador é `2,095 - 2,074·p`, sem dividir pela média e sem limite. p é a chance de quem matou vencer o duelo, medida nas partidas por faixa de economia.
- Abate, morte e dano usam o multiplicador inteiro.
- O KAST da nota não tem ajuste de economia: cada round que conta vale 1.

## Colete

`ARMOR_EXTRA_HP`, no `app.js`: leve +25, pesado +50, Regen Shield (`B1B9086D-41BD-A516-5D29-E3B34A6F1644`) +50 e o colete das partidas do tracker (`TRACKER-COLETE-DESCONHECIDO`) +50. O dano em cada vítima é cortado na vida (100 + colete), com o excesso tirado primeiro de quem matou.

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
| Abate em aliado e suicídio | escolha do dono (no swing e, desde 23/11/2026, fora dele) |
| Reta da economia 2,095 - 2,074·p | estimativa; p medido |
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
- **Continuam sem fonte:** as faixas de economia (as do CS2 aplicadas aos créditos do Valorant), os pontos do multi-kill, a janela de troca e a amostra mínima.
- **O dano das partidas do tracker:** é cortado em 150 para todos, porque o colete não vem no arquivo.
- **A sobrevivência pesa menos na ordem que na HLTV** (0,6% contra 6,6% na carreira; igual num mapa só). Os β por unidade são os da HLTV; a diferença vem de como a sobrevivência anda com o resto entre amadores, e não é corrigida.

## Reprocessamento

O app carrega o banco pré-agregado `database.json`, gerado por `scripts/build_database.js`:

1. Atualize os JSONs em `campeonatos/` e as planilhas em `dados_excel/`.
2. Rode `python scripts/build_metadata.py` para regenerar `metadata.json` e `data-sources.json` a partir das planilhas.
3. Rode `node scripts/build_lineup_history.js` e depois `node scripts/build_database.js`, que regenera `database.json` e `home.json` com as cores de `metadata.json` (commite os dois arquivos juntos).
4. Rode `node scripts/rewrite_asset_paths.js` se houver caminhos de assets para atualizar. `node scripts/apply_team_colors.js` serve apenas para corrigir artefatos antigos sem reprocessar partidas.
5. Recarregue `index.html` pelo servidor local.
6. O build gera, a partir das partidas carregadas, a matriz econômica, a tabela de chance com spike e a média do grupo. Sem abates com economia, usa multiplicador neutro `1.00`.

### Ferramentas auxiliares

O build normal já inclui as cores oficiais. Para corrigir caminhos ou cores em artefatos existentes sem reprocessar partidas, há dois scripts:

- `scripts/rewrite_asset_paths.js`: troca caminhos de asset por uma tabela explícita, nos três artefatos. Aborta se qualquer alvo não existir no disco.
- `scripts/apply_team_colors.js`: ferramenta de recuperação para levar `colors` e `logo` do `metadata.json` a um banco antigo, **casando por id de equipe**. O build atual já copia as cores oficiais. Logo não entra na tabela do outro script: a troca lá é por string e é cega, e duas equipes que partilhem o mesmo caminho antes de um rename saem as duas com o escudo errado.

Os dois são idempotentes: rodar de novo não altera um byte.

Sem `database.json`, o app cai no modo antigo: baixa todos os arquivos brutos e recalcula tudo no navegador (mais lento, útil só para depuração local).

## Campos principais

- `raating_3`: o rAAting 3.1, sem limites.
- `rating_version`: `raa3.1`. Uma linha de outra versão (banco antigo em cache) não aparece com o nome da 3.1.
- `rating`: alias compatível de `raating_3`.
- `raating_1`: rating legado, para auditoria.
- `parte_abate`, `parte_sobrevivencia`, `parte_dano`, `parte_kast`, `parte_swing`, `parte_multikill`: as seis partes, em pontos. O banco não as guarda; a tela recalcula com a média do grupo do banco.
- `ekpr`, `edpr`, `eadr`, `ekast`, `mk_per_r`, `adjusted_swing_percent`: as métricas da ficha do perfil, também recalculadas na tela.
- `sample_status`: `OK` com `rounds >= 50`, senão `LOW`. O número vem de `SAMPLE_MIN_ROUNDS` em `raating-core.js`.

## Validação

```bash
node scripts/test_raating3_core.js
node scripts/test_raating31_rodada.js
node scripts/test_nota_pela_soma.js
node scripts/test_raating3_ui.js
node scripts/test_ranking_core.js
python scripts/test_analise_matches_alignment.py
```

A conferência do banco inteiro contra o estudo: `node --max-old-space-size=12000 scripts/estudos/conferir_raating31.js <oraculo.json> database.json`, com o oráculo gerado por `scripts/estudos/oraculo_raating31.js` num commit em que o `app.js` ainda era o do rAAting 3.0 (o de 22/11/2026 é o `2a5cbce`). O `raating_3` de cada linha tem de bater até 1e-9, o `raating_1` tem de ficar igual, e a média do grupo e a tabela com spike do banco têm de ser as do estudo.

O ranking oficial de jogadores usa somente `sample_status = "OK"`, ordena por `raating_3` decrescente e desempata por `rounds` decrescente.
