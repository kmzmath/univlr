# SDD ledger — plan: docs/superpowers/plans/2026-10-23-identidade-placar.md
Spec: docs/superpowers/specs/2026-10-23-identidade-placar-design.md
Pre-flight T2->T3..T10: sectionHead/panelTitle devolvem vp-sec; consumidores so chamam as funcoes. ok.
Pre-flight T3->T6,T8,T9: matchResultRow(item, options) com options.kd; listas dentro de vp-lista. ok.
Pre-flight T4->T6: compactRankingRow/eventListRow dentro de vp-placa-rk/ev. ok.
Pre-flight T5->T6: weekHighlights + bindWeekCarousel chamada no fim de renderHomeCompact. ok.
Pre-flight T8->T9: trofeusLista(trophies) produzida em T8, consumida em T9. ok.
Task 1: complete (commits fb8dc5c..e91455d, tests: node scripts/test_visual_placar.js → Visual Placar contract tests passed)
Task 2: Ruling: .section-head e .panel-title escritos direto nos templates ganham o desenho do vp-sec por CSS - consistencia ja nesta tarefa, as paginas trocam a marcacao depois - custo se errado: uma regra a mais para remover na Tarefa 11
Task 2: Ruling: ?v= do app.js e do placar.css sobe a cada mudanca, e o teste aceita qualquer numero - o navegador servia a versao em cache - custo se errado: nenhum
Task 2: Ruling: menu numa linha rolando no celular (fora do brief) - o topo preso ocupava 215px a 390 - custo se errado: os links da ponta ficam fora da tela ate rolar
Task 2: complete (commits e91455d..24311e4, tests: node scripts/test_visual_placar.js → Visual Placar contract tests passed)
Task 3: Ruling: teamLineColor(teamId) com cache na propria funcao, e nao teamAccentStyle - o estilo inteiro pesa em 50 linhas e equipe sem cor cairia no vermelho de reserva - custo se errado: uma cor calculada em dois lugares
Task 3: Ruling: a linha mostra campeonato e data (ou hora) na ponta, em duas linhas - as listas fora da home nao tem o dia como cabecalho - custo se errado: nome de campeonato longo corta antes
Task 3: complete (commits 24311e4..b9cd4e6, tests: node scripts/test_visual_placar.js → Visual Placar contract tests passed)
Task 4: iniciada e pausada (limite de uso) - so leitura de compactRankingRow, eventListRow, bindHomeEventCovers e .event-row.tem-capa; nenhum arquivo alterado
Task 4: Ruling: eventTierBadge emite as classes antigas e as vp-tier juntas - outras listas ainda usam o desenho antigo - custo se errado: classe dupla ate a limpeza da Tarefa 11
Task 4: Ruling: posicao do ranking sem o # (como no mockup) - o mockup aprovado mostra o numero solto - custo se errado: um replace
Task 4: complete (commits b9cd4e6..c022b59, tests: node scripts/test_visual_placar.js → Visual Placar contract tests passed)
Task 5: Ruling: weekSupportStats fica sem uso (era da faixa de nove); sai na limpeza da Tarefa 11 junto com o CSS da faixa - custo se errado: uma funcao morta ate la
Task 5: Ruling: nota curta 'Minimo de 4 mapas no periodo.' como no mockup aprovado - custo se errado: uma string
Task 5: complete (commits c022b59..3efb74c, tests: node scripts/test_visual_placar.js → Visual Placar contract tests passed)
Task 6: Ruling: nome longo rola (embrulharTextosCortados, regra 'nunca corte, nunca reticencia' do site) em vez da reticencia do documento - a regra do site e mais recente que a nota de agosto e cobre todo texto sozinha - custo se errado: nomes em movimento em vez de cortados
Task 6: Ruling: News.blocoHome fica sem uso (a home usa blocoTrilho); sai na Tarefa 11 com o CSS do topo de noticias - custo se errado: funcao morta ate la
Task 6: complete (commits 3efb74c..ae76b68, tests: node scripts/test_visual_placar.js → Visual Placar contract tests passed)
Task 7: PAUSADA em ccdf065 (usuario priorizou as cartinhas em 23/10). Feito: partida inteira, testes T7 verdes, suite verde, 1594px a 1440 e 2886px a 390, cliques/Enter/ordenar/Avancado conferidos no navegador. Falta: celular - nomes longos sobrepoem colunas no scoreboard (table-layout fixed do styles.css com colgroup em %; trocar para auto ou alargar min-width); conferir abas de mapa no celular depois do fix de especificidade (placar.css v17); build exit 0; task-done.
Task 7: Ruling: Fonte saiu do trilho para a coluna principal - no trilho os nomes de arquivo quebravam em 3 linhas e a pagina passava de 1600px - custo se errado: mover de volta e uma linha.
Task 7: Ruling: link do nick no scoreboard sem min-height de toque no celular - a linha inteira e o alvo de toque (escolhe o historico) - custo se errado: linhas de 60px no celular.
Task 7: Ruling: comentarios sem caixa (cmt-secao) e titulo com aparte na mesma linha, valendo em toda pagina com comentarios - segue o mockup aprovado - custo se errado: reverter um bloco de CSS.
Task 7: complete (commits ae76b68..4793a29, tests: node scripts/test_visual_placar.js → Visual Placar contract tests passed)
Task 7: Ruling: scoreboard com table-layout auto no lugar do fixed + colgroup em % do styles.css - no celular o fixed espremia os ~795px do modo Padrao e o nick sobrepunha os agentes; o auto deixa a caixa rolar - custo se errado: no desktop a largura das colunas acompanha o conteudo (as duas equipes estao na mesma tabela, entao seguem alinhadas).
Task 8: Ruling: topo mostra so as redes que a equipe cadastrou, como texto - os seis icones apagados de nao informado poluiam a faixa e o mockup aprovado mostra so Instagram - custo se errado: voltar a chamar socialButtons().
Task 8: Ruling: o elenco do trilho mostra so os cinco do rankingRosterTopFive, com link para a aba Elenco contando os demais - o spec fala em elenco atual com o link de reservas - custo se errado: listar todos no trilho.
Task 8: Ruling: teamSummaryTrophyPanel e trophyShelfItem ficam sem uso (Task 11 apaga) - o trilho usa trofeusLista().
Task 8: Ruling: abas de equipe e jogador com seletor reforcado (.team-page .team-tabs) e color !important na ativa, porque o styles.css pintava a aba ativa de vermelho com !important - custo se errado: nenhum alem do !important a mais.
Task 8: minor (deferred): na aba Ranking, o balao do ultimo ponto do grafico passa da borda direita (pre-existente).
Task 8: complete (commits 4793a29..22f2801, tests: node scripts/test_visual_placar.js → Visual Placar contract tests passed)
Task 9: PAUSADA em cf68b47 (dono priorizou as cartinhas de novo em 23/10). Feito: topo, ficha, K/D, agentes, por mapa, trofeus; testes T9 verdes. Falta: medir #/players/aldeath (<=1600 a 1440, <=3000 a 390), estouro, build, task-done.
Task 9: Ruling: K/D da serie vem das linhas de jogador de cada mapa da serie, nao do player.recent - o recent so guarda 6 mapas (Aldeath: 47 de 53 fora) - custo se errado: nenhum, as linhas existem mesmo antes do detalhe carregar.
Task 9: Ruling: composicao e metricas da rAAting 3.0 viram grupos da ficha que so aparecem com valor, em vez de paineis separados; Swing/R fica fora do teste das metricas porque ja esta em Geral - custo se errado: voltar aos paineis.
