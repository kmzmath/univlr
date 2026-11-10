# Auditoria de identidades de jogadores — 09/11/2026

Unificações aplicadas no cadastro de origem e na base do site. O nome atual e o identificador principal de cada jogador foram preservados; as contas e os nomes anteriores passaram para seu histórico. Os links antigos dos dois perfis unificados continuam abrindo o perfil correspondente.

## Aplicação parcial autorizada no JUBS 2024

Após a revisão das evidências, o responsável autorizou: **"então vamos aplicar os 4 , 4 e 10 mapas coerentes."** Foram aplicadas exatamente 18 atribuições pessoais em 14 mapas distintos: os quatro mapas de vrnx são os mesmos quatro de yakult, além dos dez de Harry Kane 9.

| Conta | Novas atribuições no JUBS 2024 | Pendentes no JUBS 2024 | Total atual do jogador |
| --- | --- | --- | --- |
| vrnx#vlr | 4 mapas para Peso | 2 mapas | Peso: 102 mapas, 2.081 rodadas |
| yakult#ttt | 4 mapas para Laves | 8 mapas | Laves: 80 mapas, 1.592 rodadas |
| Harry Kane 9#MFMA | 10 mapas para suvas | 0 mapas na base atual | suvas: 41 mapas, 844 rodadas |

As atribuições estão limitadas aos UUIDs abaixo em `SHARED_ACCOUNT_RULES`. Nenhuma das três contas passou a ser alternativa global no cadastro. O link antigo de Harry Kane abre suvas enquanto não existir um perfil com atuações pendentes; se uma partida futura sem confirmação criar esse perfil, ele terá prioridade sobre o redirecionamento.

**Peso e Laves, os mesmos quatro mapas:**

- `4f634d8c-6db6-41b7-ae41-a440e4af4916`
- `499be652-ad00-467b-8482-d4c06f54901c`
- `a23bad20-cc61-4702-9ecc-c88790c822dd`
- `efe69ecd-24ec-4dc3-a263-de67bab0b210`

**suvas, dez mapas:**

- `baaabe1a-d8d5-472d-9c8d-65aa87c8c695`
- `7e1c1793-bc8d-4455-912b-079935393bea`
- `04b4c144-c1c3-47f3-8b75-821ed02cdca8`
- `5d2cc855-b483-4224-875f-e860344cb79e`
- `87933bfa-06ee-4863-92e3-794102e5e20d`
- `b331fdc5-d73c-4af3-a62e-b3f9aea946c2`
- `f06a90f6-a48a-46e7-8dad-991252a44da7`
- `532d1d43-0a60-4d60-a5e4-657c5bfe0671`
- `84be44aa-3a6b-4888-aeec-fa377f1a2b74`
- `99dbf525-1fe1-4fab-96cc-b99d89a4e00d`

Ficam pendentes vrnx e yakult nos dois mapas de 14/07/2024 (`c7e933cd-68c6-4204-b01a-c9c1822d1e7b` e `db1c9eab-f026-486e-bf39-d62682c5928d`), além das seis atuações presenciais de yakult em outubro. As 22.440 participações preservaram suas contas, handles, equipes e estatísticas numéricas. Somente as 18 identidades autorizadas mudaram, e nenhuma posição do ranking atual mudou.

## Correção após revisão da Uninassau

Na primeira passagem desta auditoria, as confirmações de vrnx/Peso, yakult/Laves e Harry Kane 9/suvas na Copa Aliança foram indevidamente estendidas ao JUBS 2024. Essa extensão foi retirada após recuperar a decisão expressa do responsável: **"Nao necessariamente, eu já falei sobe isso anteriormente, para o jubs 24 vamos deixar pendente por enquanto"**.

A resposta está na conversa **Coletar dados do JUBs 2024**, na revisão de 01/11/2026, e registrada em `outputs/revisao-2024-identidades/decisoes.json`. Mesmo PUUID identifica a conta; não confirma quem jogou nela em todo campeonato. As regras por UUID da Copa e das contas compartilhadas da Uninassau foram preservadas integralmente.

Situação após a retirada da extensão global, antes da autorização parcial acima:

| Conta | Atribuição confirmada na Copa Aliança 2024 | Participações então pendentes no JUBS 2024 |
| --- | --- | --- |
| vrnx#vlr | Peso em 10 mapas | 6 mapas permanecem no perfil vrnx |
| yakult#ttt | Laves em 30 mapas | 12 mapas permanecem no perfil yakult |
| Harry Kane 9#MFMA | suvas em 22 mapas | 10 mapas permanecem no perfil Harry Kane 9 |

Foram desfeitas 28 atribuições pessoais da primeira passagem, sem alterar conta, equipe, placar ou estatísticas de qualquer atuação. Peso voltou a 98 mapas, Laves a 76 e suvas a 31. Os redirecionamentos globais desses três perfis também foram retirados, pois ocultavam as identidades ainda pendentes.

As exceções reais da Uninassau continuam válidas: jannik foi usada por Laves, JV e Mendes em momentos diferentes; drzera foi usada por Mendes e, na Haven confirmada contra CAAP, por Laves; aham foi usada por Laves e, nessa Haven, por JV. Aham é uma conta emprestada pelo naio da UnB. Os 18 UUIDs e a exceção da Haven continuam com suas atribuições específicas.

## Históricos reunidos

| Perfil preservado | Perfil incorporado | Mapas antes | Mapas depois | Rodadas depois | Evidência |
| --- | --- | --- | --- | --- | --- |
| swpz | SweePzz | 16 + 28 | 44 | 929 | Confirmação do dono do projeto; Minerva Thunders, quatro companheiros em comum, nomes compatíveis e nenhuma aparição simultânea. |
| Balalov3 | balalov3   s2 | 147 + 1 | 148 | 2.916 | Conta `balalov3   s2#pas`: mesmo nome distintivo, mesma tag `pas`, UFMT Turuna, quatro companheiros em comum e nenhuma aparição simultânea. |

O histórico de swpz também conserva `ufrj_canis`, que estava no cadastro de SweePzz. A união de Balalov3 é uma inferência pelos indícios listados, sem confirmação direta do responsável sobre essa conta alternativa.

## Outros possíveis casos

| Par | Indícios encontrados | Resultado |
| --- | --- | --- |
| Lipek / LEK | Cyberkongs, nomes próximos e três companheiros em comum; seis mapas de Lipek e um de LEK, sem aparição simultânea. As contas têm tags distintas (`dash` / `AKALI`). | Pendente de confirmação de identidade. |
| Washin / Maki | O histórico de Washin contém `Maoki ツ#CTB`; Maki usa `Maki Zenin 全員#sopa` / `Veloz 速#sopa`. Ambos têm passagem pela Azure Bears White, mas sem companheiros em comum na base. | Pendente de confirmação de identidade. |

Quatro outros pares encontrados pela busca ampla tinham apenas semelhança fraca: Lopes/Doragon (`porygon`/`Doragon`), zeN/CON (prefixo `AXIS`), SunnyAnão/Gabão e gyukaa/Asuka. Esses indícios não sustentam uma unificação.

## Escopo e critérios

- Foram examinados os 1.492 perfis anteriores, os nomes e handles de suas contas, os nomes históricos, as equipes cadastradas e observadas e as participações nos 2.244 mapas.
- A busca comparou nomes normalizados, variações de letras repetidas, números/letras, abreviações consonantais, pequenas diferenças de grafia e nomes contidos em variantes maiores. O histórico de equipe precisou coincidir para formar os candidatos por nome.
- Os 32 pares encontrados dessa forma foram confrontados com as partidas: 21 aparecem simultaneamente em pelo menos um mapa e foram excluídos da unificação automática. Entre os 11 restantes estão as duas uniões acima, as três contas pendentes por escopo, os dois possíveis casos e os quatro indícios fracos.
- As contas que aparecem em mais de um perfil também foram conferidas. As regras existentes de empréstimo de contas entre Mendes, JV e Laves foram preservadas. O cadastro sem mapas `aham`, de uma conta usada por mais de uma pessoa nessas regras, também foi preservado.
- A semelhança de nome é um sinal de busca, não uma prova de identidade. A auditoria pode não encontrar pessoas que trocaram completamente de nome e de conta sem deixar outro vínculo na base.

## Verificação

- A base foi regenerada: 2.244 mapas, 1.644 séries, 195 equipes e 1.489 perfis; nenhum arquivo com falha ou duplicado.
- As 22.440 participações conservaram a conta usada, o handle da partida, a equipe e todas as estatísticas numéricas. Nenhuma partida passou a ter a mesma identidade duas vezes.
- Os totais dos dois perfis unificados integralmente equivalem à soma dos perfis anteriores. A extensão global de vrnx, yakult e Harry Kane foi desfeita; somente as 18 participações posteriormente autorizadas foram atribuídas a Peso, Laves e suvas. As demais identidades foram preservadas.
- Em relação ao cadastro inicial, a planilha conserva dez células alteradas. A revisão de escopo reverteu sete das 17 edições iniciais, preservando os demais valores, estilos, tabela, dimensões e estado de visualização.
- Os testes de contas alternativas, links antigos, ranking e sucessões de equipes passaram. As verificações cobrem os 4 + 4 + 10 mapas liberados, os demais mapas pendentes, a ausência de vínculos globais e a prioridade de um eventual perfil pendente futuro sobre uma rota histórica.
- O ranking atual foi recalculado e manteve todas as posições.

Arquivos atualizados: `dados_excel/players.xlsx`, `metadata.json`, `database.json`, `home.json`, o mapa de rotas antigas em `app.js` e os testes em `scripts/test_shared_accounts.js`.
