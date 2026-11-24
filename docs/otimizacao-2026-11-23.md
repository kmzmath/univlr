# Otimização de 23/11/2026

Plano tirado da auditoria de 23/11 (etapas 1 a 3, aprovadas pelo dono). Cada etapa é um commit local, medido antes e depois. Nada foi publicado: o push e a migração 0014 no Supabase ficam com o dono.

| Commit | Etapa |
|---|---|
| `2144f6a` | 1 - segurança e dado errado |
| `5283769` | 1 - correção do servidor local apontada pela revisão de segurança |
| `2ef7f68` | 2 - carregamento |
| `1f8805e` | 3 - código morto, leitor de arquivo único e comando de testes |

## O que mudou, por quê e o que foi medido

### Etapa 1 - segurança e dado errado

| Mudança | Por quê | Conferido |
|---|---|---|
| PUUID e Riot ID entram na planilha por `grava_texto` (`config_hub.py`), que marca a célula como texto sem mudar o valor | O apóstrofo do `texto_seguro` virava parte do PUUID que começa com "-" (31 de 1.515), e o jogador perdia as partidas. O `texto_seguro` segue no CSV | `test_planilha_texto.py`; com o código antigo o PUUID volta como `'-abc` |
| `build_metadata.py` para quando falta uma das oito planilhas do `dados_excel/`, e lê tudo antes de gravar | Sem `players.xlsx` ele gravava o metadata sem jogadores e terminava com sucesso; as planilhas já sumiram em 18/09 | `test_build_metadata_planilhas.py` remove cada uma numa cópia; o código antigo falha no teste. `metadata.json` sai igual |
| `build_database.js` para com JSON opcional quebrado, arquivo de partida que não abre, nome fora do padrão, arquivo sem Red e Blue, placar do nome diferente do arquivo e falha do `build_home`; o round-trip é conferido antes de gravar | Todos esses casos publicavam dado errado com o build dizendo que deu certo | `test_build_database_entradas.js`; no HEAD os 2.723 arquivos passam e o `database.json` sai byte a byte igual |
| Migração `0014`: trava por conta no `post_comment` e no `create_topic`; suspensão valendo na bio, nos favoritos, no nome e no `edit_comment` | Chamadas em paralelo furavam o limite anti-spam; a conta suspensa ainda escrevia no perfil | PGlite com as migrações 0001-0014: `rls_test` 50 ok, `positive_test` 49 ok; sem a 0014 os 3 casos novos falham pelo motivo certo. **A corrida em si não foi reproduzida** (o PGlite tem uma conexão só) |
| Servidor local só aceita Host local (do cabeçalho), recusa `.git`, `.env`, `trabalho/` e as formas que o Windows confunde (`trabalho `, `TRABAL~1`, `x::$DATA`), e não cai com `%` malformado | Um site aberto no navegador podia ler a chave da Riot por DNS rebinding | `test_servidor_local.js`, 11 caminhos e 2 Hosts recusados; o servidor antigo entregava o `/.git/config` |

### Etapa 2 - carregamento

| Mudança | Antes | Depois |
|---|---|---|
| `database.json` e `home.json` começam a baixar junto com o Supabase | O banco saía 675 ms depois das consultas da comunidade | Sai junto (441 ms contra 444 ms) |
| O resumo da comunidade tem prazo de 3 s | Com o Supabase sem responder, o site ficava preso em "Preparando o site..." | Pronto em 3,7 s; a comunidade que chega depois entra num desenho novo (conferido aos 5.004 ms) |
| A busca registra um ouvinte de clique só | 22 ouvintes novos em 20 navegações | 2 |
| A contagem de comentários vem da mais recente para a mais antiga | Sem ordem, o corte de 1.000 linhas do Supabase tiraria linhas ao acaso | Mesmo resultado hoje (12 threads) |
| A partida no modo série não baixa os arquivos brutos | 3 arquivos de 0,4 a 1,1 MB numa MD3 | 0; a página sai idêntica com e sem eles, e o mapa avulso segue baixando o dele para a linha de rounds |

### Etapa 3 - código que não precisava existir

- **29 funções sem chamador no `app.js`**, achadas em quatro passadas (apagar uma deixava outra órfã), mais o tratador de clique e a chave de estado de um botão que nada desenhava; o `groupBy` do `ranking-core.js`; as regras CSS de três classes que só esse código usava.
- O `test_raating3_ui.js` protegia duas dessas funções: a assertiva da amostra saiu, e a do FK-FD com sinal passou a olhar as tabelas vivas.
- O `build_lineup_history.js` usa o `parseFileName` do `app.js` em vez da cópia própria, que tinha regras diferentes (hoje as duas concordam nos 2.723 arquivos). Os stubs de navegador do build moram em `scripts/carrega_app.js`.
- **`node scripts/testar.js`** roda os 25 testes sem navegador e sai com erro se um falhar.

Tamanho, do início ao fim: `app.js` -14,5 KB (-3,2 KB em gzip), `styles.css` -0,9 KB. É pouco em bytes, e não conta como ganho de desempenho.

Em todas as etapas: `database.json`, `team-profiles.json` e `home.json` (fora o carimbo de hora) iguais ao commit anterior, 25 testes passando, e 107 rotas varridas no navegador sem erro de JavaScript.

## O que o dono precisa fazer

1. **Aplicar a 0014** no SQL Editor do Supabase: `begin; 0014; rls_test; positive_test; rollback;`, tudo `ok`, e então aplicar de verdade (ver `supabase/README.md`).
2. **Push**, quando quiser publicar. Os quatro commits só existem aqui.

## O que ficou de fora

- **Etapa 4** (decisões do dono): abate na própria spike, `database.json` fora do git, `TOURNAMENT_OVERRIDES` num JSON e enxugar os rankings antigos.
- **21 classes CSS** que só o código apagado desenhava seguem no `styles.css`/`placar.css`: a varredura de CSS ficou fora do plano, porque uma classe montada em template escapa da busca.
- **Os stubs de navegador seguem copiados em 11 scripts e testes**; só os dois builds passaram para o `carrega_app.js`.
