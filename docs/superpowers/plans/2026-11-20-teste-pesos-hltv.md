# Teste dos pesos β da HLTV - plano de execução

> Para quem executar: siga as tarefas na ordem, marcando os `- [ ]`. Estudo fora do build; nada de commit sem o dono pedir.

**Objetivo:** responder às perguntas A (os β fazem no Valorant o que fazem no CS?) e B (qual peso mede melhor nas partidas do univlr?) e escrever o veredito recomendado para a mudança 4.

**Arquitetura:**
- a coleta da HLTV roda no Chrome do dono e grava um CSV em `outputs/`;
- dois scripts Node em `scripts/estudos/` fazem as contas, reaproveitando `carregar_univlr.js`, `raating_variantes.js`, `nota_beta.js` e `comparar_variantes.js`.

**Ferramentas:** Node 24, Claude in Chrome (páginas da HLTV) e o pipeline do `app.js` em memória.

**Desenho:** `docs/superpowers/specs/2026-11-20-teste-pesos-hltv-design.md`

## Restrições globais

- Não regenerar `database.json`, `home.json` nem `metadata.json`, e não fazer commit sem o dono pedir.
- **HLTV:**
  - uma página por vez, com pausa de alguns segundos;
  - se aparecer captcha ou bloqueio, parar e avisar;
  - os dados ficam em `outputs/estudo-raating-hltv-2026-11-20/` e não vão para o site.
- **Período:** 2026-05-01 a 2026-11-20, CS2, filtro padrão de eventos. Amostra: 40+ mapas; se passar de 150 jogadores, sorteio de 150 com semente fixa (20261120).
- Textos em pt-BR, sem travessão.

## Pontos de atenção

1. **O ajuste de economia não ligar de verdade.** Controle: os valores com e sem ajuste têm de diferir em pelo menos parte dos jogadores.
2. **Página com dado faltando ou em formato diferente** (jogador sem nota 3.0 no período). Controle: registrar e excluir, contando quantos.
3. **Unidade do multi-kill:** testar as duas leituras previstas no desenho.
4. **Amostra pequena no univlr inflando partes ruidosas:** usar a carreira com 500+ rounds como amostra principal.
5. **Circularidade no B:** a previsão usa só mapas anteriores; controle negativo com nota sorteada, que tem de dar perto de zero.

---

### Tarefa 1: lista e sorteio da HLTV

- [ ] Abrir `https://www.hltv.org/stats/players?startDate=2026-05-01&endDate=2026-11-20&minMapCount=40` no Chrome e extrair id, nome e mapas de cada linha.
- [ ] Gravar `outputs/estudo-raating-hltv-2026-11-20/hltv_lista.csv`. Se houver mais de 150, sortear 150 com a semente 20261120 e gravar `hltv_amostra.csv`.
- [ ] Conferir: o número de linhas bate com o que a página mostra.

### Tarefa 2: coleta por jogador

- [ ] Descobrir como a página liga o "Eco-adjust stats" (parâmetro, cookie ou clique) e ler um jogador com e sem o ajuste.
- [ ] Para cada jogador da amostra, ler: mapas, nota 3.0, swing (%), KPR, DPR, ADR, KAST e multi-kill (%), com e sem ajuste. Gravar `hltv_jogadores.csv`.
- [ ] Conferir:
  - quantos ficaram sem dado;
  - que os valores com ajuste diferem dos sem ajuste;
  - que reler 2 jogadores dá o mesmo resultado.

### Tarefa 3: comparação HLTV x univlr (`scripts/estudos/comparar_hltv.js`)

**Interfaces:**
- usa `BETA` e `notaBeta` de `nota_beta.js` e as linhas de `variantes.json`;
- exporta `betasConvertidos(desvioCs, desvioVal) -> { parte: beta }`, usado na Tarefa 4.

- [ ] **Reprodução:** nota pela fórmula crua (com o 0,1358) contra a 3.0 oficial, com o multi-kill como fração e sem o termo. Saída: erro médio absoluto e correlação.
- [ ] **Participação de cada parte no CS:** com os β, e também contra a nota oficial.
- [ ] **Participação no univlr com os β:** na carreira com 500+ rounds e dentro do campeonato. Usar as contagens de hoje e as de 1 + 2 + 3 (`todas_time`).
- [ ] **Desvio de cada entrada** no CS e no univlr (carreira com 500+ rounds).
- [ ] **β convertidos:** β x desvio no CS / desvio no Valorant.
  - Controle: com desvios iguais, devolve os β.
  - Controle: a participação no univlr com os β convertidos fica perto da do CS.

### Tarefa 4: efeito dos β convertidos

- [ ] Acrescentar a `comparar_variantes.js` as variantes derivadas com os β convertidos, sobre as contagens de hoje e sobre `todas_time`. Elas leem os β de um JSON gravado pela Tarefa 3.
- [ ] Rodar e anotar: Spearman, top 10, líderes, notas que mudam, escala e o JUBS presencial.
- [ ] Rodar o ranking de equipes da variante com os β convertidos sobre `todas_time`.

### Tarefa 5: validade nas partidas (`scripts/estudos/validar_pesos.js`)

- [ ] **Estabilidade:** jogadores com 200+ rounds, mapas alternados pela data em duas metades, correlação entre as notas das metades, para hoje, β e β convertidos, sobre as contagens de hoje e de `todas_time`.
- [ ] **Previsão:**
  - nota de cada jogador só com os mapas anteriores (mínimo de 100 rounds), média da equipe e diferença entre as equipes;
  - saída: acerto do vencedor e Spearman com o saldo de rounds.
- [ ] **Controles:**
  - nota sorteada por jogador (controle negativo, tem de dar perto de zero);
  - KPR puro (referência simples).

### Tarefa 6: relatório

- [ ] Acrescentar ao relatório do estudo uma seção "Teste dos pesos β", com:
  - uma tabela por medida;
  - o critério do desenho aplicado;
  - a recomendação;
  - o que não foi feito.
- [ ] Atualizar a memória do projeto e copiar o relatório para a pasta de notas.
