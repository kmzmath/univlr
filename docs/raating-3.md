# rAAting 3.0

O rating oficial do site é `rAAting 3.0`, salvo em runtime no campo `raating_3`. O campo compatível `rating` aponta para o mesmo valor para manter telas e rankings existentes funcionando. O cálculo antigo fica preservado em `raating_1` para auditoria.

## Reprocessamento

O app carrega o banco pré-agregado `database.json`, gerado por `scripts/build_database.js`:

1. Atualize os JSONs em `campeonatos/` e as planilhas em `dados_excel/`.
2. Rode `python scripts/build_metadata.py` para regenerar `metadata.json` e `data-sources.json` a partir das planilhas.
3. Rode `node scripts/build_database.js` para regenerar `database.json` (commite o arquivo junto).
4. Rode `node scripts/rewrite_asset_paths.js` e `node scripts/apply_team_colors.js`.
5. Recarregue `index.html` pelo servidor local.
6. O build gera a matriz econômica observada a partir dos kill events carregados. Se não houver eventos suficientes, usa multiplicador neutro `1.00`.

### Por que os passos 4 existem

`database.json` **não reproduz**: rodar o build hoje gera um arquivo diferente do commitado, com os índices de nós deslocados. Isolado em ago/2026 — não é mudança de código; ou o build depende da data, ou o artefato commitado saiu de um estado de fonte diferente.

Enquanto isso não for resolvido, o que muda nas planilhas chega ao `database.json` e ao `home.json` por reescrita no lugar:

- `scripts/rewrite_asset_paths.js` — troca caminhos de asset por uma tabela explícita, nos três artefatos. Aborta se qualquer alvo não existir no disco.
- `scripts/apply_team_colors.js` — leva `colors` e `logo` do `metadata.json` para o `database.json` e o `home.json`, **casando por id de equipe**. Logo não entra na tabela do outro script: a troca lá é por string e é cega, e duas equipes que partilhem o mesmo caminho antes de um rename saem as duas com o escudo errado.

Os dois são idempotentes: rodar de novo não altera um byte.

Sem `database.json`, o app cai no modo antigo: baixa todos os arquivos brutos e recalcula tudo no navegador (mais lento, útil só para depuração local).

## Campos principais

- `raating_3`: rating oficial, clamp visual `0.30` a `1.80`.
- `raating_1`: rating legado/auditoria.
- `rating`: alias compatível de `raating_3`.
- `sample_status`: `OK` com `rounds >= 50`, senão `LOW`. O número vem de `SAMPLE_MIN_ROUNDS` em `raating-core.js:11` e a página `/stats` lê a constante em runtime — o doc dizia 60, que nunca foi o valor do código.
- `rating_version`: `raa3`.
- `kill_rating`, `damage_rating`, `multi_kill_rating`, `round_swing_rating`, `survival_rating`, `kast_rating`.
- `ekpr`, `edpr`, `eadr`, `ekast`, `mk_per_r`, `adjusted_swing_percent`.
- `rating_recon_proxy`: proxy de auditoria, não oficial.

## Validação

```bash
node scripts/test_raating3_core.js
node scripts/test_ranking_core.js
node scripts/test_raating3_ui.js
```

`test_raating3_ui.js` **está vermelho** desde antes de ago/2026: ele exige `function matchAdvancedStatsTable`, que não existe no `app.js`. Verificado contra o commit anterior — a falha não veio de mudança recente. Ou a função foi removida sem atualizar o teste, ou o teste descreve algo que nunca chegou a existir.

O ranking oficial de jogadores usa somente `sample_status = "OK"`, ordena por `raating_3` decrescente e desempata por `rounds` decrescente.
