# rAAting 3.0

O rating oficial do site é `rAAting 3.0`, salvo em runtime no campo `raating_3`. O campo compatível `rating` aponta para o mesmo valor para manter telas e rankings existentes funcionando. O cálculo antigo fica preservado em `raating_1` para auditoria.

## Reprocessamento

O app carrega o banco pré-agregado `database.json`, gerado por `scripts/build_database.js`:

1. Atualize os JSONs em `campeonatos/` e a lista em `data-sources.json`.
2. Rode `node scripts/build_database.js` para regenerar `database.json` (commite o arquivo junto).
3. Recarregue `index.html` pelo servidor local.
4. O build gera a matriz econômica observada a partir dos kill events carregados. Se não houver eventos suficientes, usa multiplicador neutro `1.00`.

Sem `database.json`, o app cai no modo antigo: baixa todos os arquivos brutos e recalcula tudo no navegador (mais lento, útil só para depuração local).

## Campos principais

- `raating_3`: rating oficial, clamp visual `0.30` a `1.80`.
- `raating_1`: rating legado/auditoria.
- `rating`: alias compatível de `raating_3`.
- `sample_status`: `OK` com `rounds >= 60`, senão `LOW`.
- `rating_version`: `raa3`.
- `kill_rating`, `damage_rating`, `multi_kill_rating`, `round_swing_rating`, `survival_rating`, `kast_rating`.
- `ekpr`, `edpr`, `eadr`, `ekast`, `mk_per_r`, `adjusted_swing_percent`.
- `rating_recon_proxy`: proxy de auditoria, não oficial.

## Validação

```bash
node scripts/test_raating3_core.js
node scripts/test_ranking_core.js
```

O ranking oficial de jogadores usa somente `sample_status = "OK"`, ordena por `raating_3` decrescente e desempata por `rounds` decrescente.
