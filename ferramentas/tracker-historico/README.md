# Coletor histórico do Tracker — VALORANT

Recebe inscrições, elencos e confrontos de um campeonato. Descobre os UUIDs nos índices de customizadas dos jogadores, baixa cada detalhe uma vez e confere os dois elencos e o placar. Não publica dados no Hub Uni.

## Executar

Requer Node.js 20 ou superior, sem dependências adicionais. A pasta do campeonato deve conter `plano-coleta-lote.json`, `manifesto.json`, `elencos-normalizados.json` e a pasta `tracker-bruto/`.

O planejador local gera a fila a partir dos confrontos e elencos já levantados (Python 3.10 ou superior). Ele escolhe equipes que aparecem em todos os confrontos ainda sem arquivo e separa duas contas por equipe; o executor usa a segunda apenas quando necessário.

```powershell
python ferramentas/tracker-historico/planejar.py outputs/classificatoria-1-2025 --players-per-team 2
```

Execute o planejamento ao preparar o campeonato. Acompanhe a execução pelo relatório do lote; ele é atualizado a cada arquivo sem precisar reescrever o plano durante a coleta.

```powershell
node ferramentas/tracker-historico/coletor.cjs status outputs/classificatoria-1-2025
node ferramentas/tracker-historico/coletor.cjs run outputs/classificatoria-1-2025 100
```

O último argumento é o máximo de **requisições** desta execução, não de partidas. Repetir o comando retoma o trabalho salvo. A consulta HTTP direta pode receber uma verificação de acesso do Tracker; nesse caso, o coletor para. Ele não copia cookies, não resolve CAPTCHA e não tenta contornar o bloqueio. Durante o trabalho no Codex, o mesmo processamento pode receber as respostas JSON visíveis no navegador por meio das ferramentas de navegação autorizadas.

### Navegador já configurado, como no projeto de exemplo

`coletor-cdp.cjs` usa a mesma fila com um navegador que **já esteja** oferecendo o endpoint CDP local. Não inicia nem configura o navegador. É possível reutilizar a instalação de Playwright do exemplo pessoal sem editar aquele projeto:

```powershell
node ferramentas/tracker-historico/coletor-cdp.cjs outputs/classificatoria-1-2025 --limit 100 --playwright-path 'C:/Users/mmora/Downloads/tracker-collector-cdp/cdp/node_modules/playwright'
```

O endpoint padrão é `http://127.0.0.1:9222`. `--cdp-url` permite informar outro endpoint local já configurado. O adaptador abre sua própria aba, usa o contexto existente e desconecta ao terminar. Uma verificação de acesso interrompe a coleta e conserva a aba para inspeção humana. Não execute dois coletores ao mesmo tempo para a mesma pasta.

A execução real deste piloto foi feita pelo navegador autorizado do Codex. O adaptador CDP teve sua sintaxe e seus argumentos verificados; a conexão CDP não foi executada neste ambiente, onde não havia navegador ouvindo na porta 9222.

### Integração com outro transporte

```powershell
node ferramentas/tracker-historico/coletor.cjs next outputs/classificatoria-1-2025
node ferramentas/tracker-historico/coletor.cjs ingest outputs/classificatoria-1-2025 tarefa.json resposta.json
```

`next` descreve a próxima tarefa; `ingest` aceita uma tarefa previamente salva e sua resposta original. Essa separação permite reutilizar a lógica com outro transporte. Uma integração deve chamar `begin(task)` antes da requisição e respeitar `task.waitMs`. `ingest` por si só importa um arquivo, sem simular uma chamada externa.

## Método

1. Começa com uma conta por equipe escolhida pelo planejador. Prioriza equipes presentes em mais confrontos faltantes.
2. Para cada conta, busca a primeira página que toca a janela por busca exponencial/binária. Segue os cursores só dentro do período.
3. Cruza data, modo e placar do índice com os confrontos daquela inscrição. Registra todas as fontes de um UUID. Nos resultados 0–1, compara o vencedor e o dia do confronto, pois o número pode representar vitórias, e não rounds.
4. Termina o índice dessa conta e baixa os UUIDs candidatos ainda sem arquivo válido.
5. Confere os participantes completos de ambos os lados com titulares e reservas. Exige pelo menos três contas conhecidas de cada lado, placar exato de rounds (ou vencedor nos resultados 0–1) e data dentro da janela. Cinco de cada lado permitem marcar `confirmado`; o restante permanece `correspondencia_parcial` com as identidades pendentes listadas. Preserva o identificador completo do link do Tracker: o texto visível do Challengermode pode colapsar espaços duplicados. Não funde genericamente contas com nomes parecidos.
6. Só consulta a segunda conta, outros titulares, reservas e adversários se ainda houver confrontos sem arquivo associado. Uma conta que revela um jogo já permite conferir os dez participantes, dispensando outra consulta para aquele confronto.

Uma associação parcial permanece pendente de validação de identidade, embora já tenha arquivo e deixe de exigir novo download. Datas isoladas nunca confirmam um jogo. Dois UUIDs associados ao mesmo confronto geram conflito explícito. Os resultados 0–1 têm contagem separada: um JSON pode comprovar um jogo efetivo, mantendo o placar real de rounds. Sem arquivo, o caso continua pendente; o coletor não presume W.O.

O piloto encontrou um exemplo concreto: UFU Saints × Azure Black consta como 1–0 na plataforma, mas o JSON preservado registra 13–4, com os dez jogadores associados. Também encontrou `K  I  R  A#SDM` com espaços duplicados no link, enquanto o texto visível mostrava espaços simples.

### Elenco observado quando os vínculos de conta divergem

O arquivo opcional `elencos-por-partida.json` preserva os elencos mostrados na tela oficial de uma partida do mesmo campeonato. Ele complementa os vínculos da inscrição, mantendo a fonte, o número do confronto e os IDs dos usuários do Challengermode. No piloto, a tela da partida 112 mostrou `nan zk#mari` e `PERNILACEBOLADO4#TTK` para os mesmos usuários que apareciam com outros nicks na inscrição. Os elencos originais não são sobrescritos e não se presume que duas contas tenham o mesmo PUUID.

Por padrão, essa fonte oficial é usada antes de recorrer a inferências sobre elencos. A opção `validation.allowCorroboratedLineups` é gerada desativada pelo planejador. Quando explicitamente ativada no plano, permite uma via adicional de associação **parcial**: o mesmo quinteto precisa aparecer contra pelo menos dois adversários diferentes, com dois jogadores da inscrição reconhecidos e pelo menos quatro adversários reconhecidos em cada jogo. Um dos adversários precisa ter os cinco jogadores reconhecidos, e pelo menos um confronto precisa ter placar exato de rounds. O dia deve coincidir; o fim da partida fica a até 90 minutos do resultado informado ou, sem esse horário, o início fica a até três horas do agendamento.

Essa regra associa o elenco observado à equipe. Ela não atribui as três contas restantes a pessoas da inscrição. Os arquivos mantêm `matchedA/B`, `unmatchedA/B`, a regra aplicada e os UUIDs dos jogos que corroboraram o elenco. Repetir um jogo contra o mesmo adversário não satisfaz a regra. O caso da UNIFEI levou à identificação dessa possibilidade; a conferência posterior do elenco oficial forneceu os vínculos diretos, dispensando a inferência nesse caso.

## Retomada e arquivos

- `tracker-bruto/<UUID>.json`: resposta original do Tracker; não é convertida para o formato Riot.
- `lote/indices/`: respostas originais dos índices, com geração e número da página.
- `lote/estado.json`: fila, páginas percorridas, fontes, falhas e controle das requisições.
- `lote/relatorio.json`: cobertura por confronto, associações, jogadores sem vínculo, hashes SHA-256 e pendências.
- `lote/resumo.md`: leitura rápida da cobertura e das identidades pendentes, atualizada automaticamente.

Os arquivos são gravados com substituição atômica e lidos novamente para validar UUID e estrutura antes de reaproveitar um detalhe. Arquivos locais inválidos são registrados como falha; não são apagados silenciosamente. Se um arquivo inválido conflitar com um candidato, é necessário preservá-lo em outra pasta antes de repetir a coleta.

As chamadas seguem intervalo mínimo de 24 segundos, no máximo 68 por 30 minutos e 600 por seis horas, contando as tentativas. São parâmetros conservadores herdados do exemplo pessoal, **não limites oficiais confirmados**. Respostas 429 respeitam `Retry-After`; falhas transitórias têm espera crescente e interrompem após três tentativas. Respostas 403/verificações de acesso interrompem imediatamente. `resume` libera uma interrupção após a causa ter sido resolvida; não elimina o intervalo pendente.

Páginas de uma busca incompleta com mais de seis horas são invalidadas ao reabrir o coletor, pois novas partidas deslocam os números das páginas. Os índices brutos anteriores, UUIDs e detalhes continuam preservados. Para refazer uma conta explicitamente:

```powershell
node ferramentas/tracker-historico/coletor.cjs refresh outputs/classificatoria-1-2025 'Jogador#TAG'
```

Uma resposta `StandardApiV2::NoData` na primeira página torna a conta indisponível para aquela passada; não prova que ela não participou do campeonato. Em uma página posterior, a resposta funciona como limite do histórico, permitindo à busca binária consultar as páginas anteriores. A resposta é preservada em `lote/erros/`. Os adversários e outras contas continuam elegíveis para descobrir os confrontos faltantes.

O estado confere uma assinatura das inscrições, confrontos e janela. Se essas entradas forem corrigidas, arquive `lote/estado.json` e inicie um novo planejamento; os JSONs detalhados serão reaproveitados. Não edite resultados oficiais para forçar uma correspondência.

É possível reprocessar todos os índices locais e refazer as associações depois de atualizar a lógica, sem repetir consultas externas:

```powershell
node ferramentas/tracker-historico/coletor.cjs reprocess outputs/classificatoria-1-2025
```

Para atualizar também os arquivos agregados `manifesto.json` e `progresso.json` ao encerrar uma etapa:

```powershell
node ferramentas/tracker-historico/coletor.cjs export outputs/classificatoria-1-2025
```

O relatório registra a quantidade de segmentos e os indicadores de dados estendidos de cada partida. A correspondência dos dez jogadores confirma os elencos; a disponibilidade de dano, abates por round e outros campos é conferida separadamente nesses indicadores.

A descoberta principal termina quando os confrontos com placar de rounds têm arquivos associados, depois de baixar os candidatos já encontrados para os resultados 0–1. Os resultados 0–1 ainda sem arquivo continuam listados para uma apuração específica; o coletor não esgota centenas de contas para tentar provar um W.O.

## Verificação

```powershell
node --test ferramentas/tracker-historico/coletor.test.cjs
```

Os testes exercitam saltos na paginação, fronteiras inclusiva/exclusiva, índices e partidas reais do piloto, divergência de placar, jogador sem vínculo, retomada, duplicação, respostas sem dados e interrupção por limites de acesso. Há recortes desses dados em `test-fixtures/piloto.json`, com os campos irrelevantes omitidos; os testes independem da pasta de saídas e não fazem chamadas externas.

O Tracker fornece um esquema próprio. Mesmo quando há dano, abates e rounds, campos como PUUID e certos detalhes de economia não estão garantidos. Este coletor preserva a fonte; não preenche campos ausentes nem substitui o importador oficial da Riot.
