# Identidade visual "Placar": versão alternativa do UNIVLR

Data: 23/10/2026. Branch: `claude/visual-placar`, criada a partir de `a696ecc`
(o retrato do site local com o trabalho ainda não commitado da main, o mesmo
ponto de partida da `codex/visual-editorial`).

Referência visual: os três mockups aprovados ao lado deste arquivo, na pasta
`2026-10-23-identidade-placar/`. Eles leem as imagens do próprio site, então
abrem servidos pelo `local-static-server.cjs` na raiz desta worktree
(`/docs/superpowers/specs/2026-10-23-identidade-placar/mockup-home-trilhos.html`).
São protótipo: o código deles não é para copiar, só o desenho e as medidas.

- `mockup-home-trilhos.html`: a home.
- `mockup-partida.html`: a página de uma série (Azure Bears Black 1 x 2 CEUB
  Octopus Vulgaris, Rush Series 3ª Edição).
- `mockup-paginas.html`: equipe (Azure Bears Black), jogador (Aldeath) e
  campeonato (Rush Series 3ª Edição), com um seletor no topo.

Todos têm um botão para ver a 390px.

## 1. Por que existe

O dono do site está incomodado com duas coisas: o site é feito de caixas
dentro de caixas, e as páginas ocupam espaço demais. Medido no site atual:

| Página | 1440px | 390px |
|---|---|---|
| Home | 2169px | 4849px |
| Partida (série 062 da Rush Series) | 3404px | 7300px |
| Equipe (Azure Bears Black) | 2645px | 5077px |
| Jogador (Aldeath) | 2106px | 4558px |
| Campeonato (Rush Series 3ª Edição) | 6720px | 12780px |

Nas páginas de partida, equipe e campeonato as caixas chegam a quatro níveis
(painel, cabeçalho da equipe, cartão do jogador, moldura da foto). Todo título
tem o mesmo traço vermelho na frente, então nada se destaca de nada.

As referências que ele deu são HLTV, Liquipedia e vlr.gg. O que as três têm
em comum, e o UNIVLR não tem: um nível só de superfície (a lista é a caixa,
o item é uma linha), densidade (uma partida da vlr.gg ocupa 58px, a do UNIVLR
106px), hierarquia por peso e cor em vez de tamanho, e cor como código.

## 2. Objetivos, não objetivos e anti-objetivos

**Objetivos**
- Nenhuma caixa dentro de caixa. No máximo um nível de superfície por bloco.
- Menos altura por página, sem apertar: a medida de chegada são os mockups.
- Uma identidade que só faz sentido no UNIVLR: o placar do VALORANT e a cor
  das atléticas como forma de organizar a página.
- Viver como versão alternativa numa branch, comparável com a atual e com a
  do Codex.

**Não objetivos**
- Mudar dados, cálculo de nota, ranking, pipeline de build ou rotas.
- Trocar fonte ou paleta. Barlow e Barlow Condensed continuam, hospedadas em
  `assets/fonts/`. Os tokens de cor do `:root` continuam.
- Fundo claro. O dono decidiu: o escuro é parte do UNIVLR.

**Anti-objetivos (se acontecer, falhou mesmo funcionando)**
- Moldura em volta de foto, letra ou número. O dono reprovou isso duas vezes
  ("muito IA-Slop", "odiei"). Foto fica solta, sangrando na base.
- Vermelho como dado. Vermelho é marca: indicador de navegação, aba ativa,
  botão Entrar, ponto de "em andamento". Barra, derrota e gráfico nunca são
  vermelhos de marca.
- Vão vazio entre coisas relacionadas. Placar longe do nome, nota longe das
  partidas: o dono pediu explicitamente para aproximar.
- Cara de jornal (fios finos, canto reto, colunas densas). É o caminho da
  versão do Codex; esta tem que ser outra coisa.
- Travessão em qualquer texto, interface ou código. Sempre hífen.

## 3. Restrições que já valem no repo

- `init()` roda no meio do `app.js`: constante de topo usada no render tem
  que ser declarada antes da chamada. `node scripts/build_database.js`
  executa o `app.js` e pega esse erro.
- Classe montada em template (`score-col-${name}`) não aparece inteira no
  código. Não apagar CSS "morto" sem tratar prefixo antes de interpolação.
- `body`/`html` têm `overflow-x: clip`: medir estouro com
  `scrollWidth > innerWidth` não funciona. Ver a seção 8.
- Item de grid nasce com `min-width: auto`. Trilha que precisa encolher pede
  `minmax(0, 1fr)` ou `min-width: 0` explícito. Isso estourou o carrossel e o
  scoreboard nos mockups.
- Hover não mexe em layout: só `transform`, `opacity`, `color`,
  `box-shadow`.
- O site não respeita `prefers-reduced-motion`, por decisão do dono. Não
  colocar o guard só numa peça.
- Toda troca de conteúdo usa o slide de 220ms `ease` (`PANEL_SLIDE_MS`).
- Estado de filtro na URL, listas de 50 com "ver mais", busca por teclado:
  as convenções de interação ficam como estão.
- Breakpoints do site: 560, 760, 940 e 1180px. Os mockups usam 760 e 1180.
- Nome de classe novo não pode colidir com classe existente. No mockup a
  classe `.top` (maior valor) herdou a grade da barra do topo e deixou cada
  número com 56px de altura. No site, procurar o nome antes de criar.

## 4. O sistema

### 4.1 Três jeitos de separar, cada um com o seu uso

**Placa**: um fundo só (`--surface`) para a lista inteira, sem borda, raio de
2px. O título fica fora do fundo. Cada item é uma linha separada da outra por
um fio de 1px (`--line`). Serve para lista de coisas com valor: ranking,
elenco, campeonatos, desempenho por mapa, classificação final, scoreboard.

**Placar**: sem fundo e sem fio. Cada equipe é uma linha com a cor dela: um
risco de 3px na ponta e um banho que sai da ponta e some até o fim da coluna
do nome. Quem venceu fica com nome e placar em `--ink` e peso 600; quem perdeu
recua para `--loss-ink` e o banho cai pela metade. Serve para partida e série
em lista, e para o cabeçalho de equipe, jogador e partida.

**Mapa de fundo**: atrás de toda partida em lista vai a arte dos mapas da
série, uma fatia por mapa, com o recorte diagonal que a home de hoje já usa
(paralelogramo por `clip-path`, a arte em pé). A faixa começa no placar e vai
até o fim da linha, entra e sai em degradê (máscara), com opacidade 0,36, e
sobe para 0,52 no hover. Os nomes dos mapas ficam por cima, centralizados,
com o placar de rounds de cada um quando a série tem mais de um mapa.

**Pintura de equipe no hover**: a mesma de hoje (`.pintura-de-equipe`, as
tramas do `teamPatternFor()`), sem mudança. Vale para linha de ranking, de
elenco e de destaque da semana.

### 4.2 Títulos

- Título de seção em Barlow Condensed 600, 30px (26px no celular), só a
  primeira letra maiúscula, sem traço vermelho na frente.
- Ao lado, em 12px `--muted`, o contexto curto ("13 - 20 de out", "Série
  inteira, 3 mapas"). Na ponta direita, o link "Ver todas".
- Isso muda uma regra de hoje: a Condensed passa a valer também para título,
  não só para numeral de 16px ou mais.
- Rótulo em caixa alta sai do site inteiro (menu, abas, seções, "FINALIZADO").

### 4.3 Tipografia e números

- Texto de linha em Barlow 13px. Nome de equipe ou jogador em 600.
- Numeral de destaque em Barlow Condensed 600, tabular. Piso de 16px para a
  Condensed em número; abaixo disso, Barlow.
- Piso de 11px para texto funcional (Riot ID, fração, rótulo de coluna).

### 4.4 Cor

- Tokens do `:root` sem mudança.
- Cor da equipe nas linhas: nos mockups, a mais saturada das duas cores
  cadastradas, e cinza neutro (`#6b6e78`) quando nenhuma das duas tem cor
  (equipe toda branca ou toda preta). No site, para risco, linha de gráfico e
  barra, usar o `--team-line` que o `teamPatternFor()` já calcula. Ele foi
  feito para ser visível no escuro. O roxo cru da CEUB (`#551d66`) some como
  barra; o `--team-line` dela (`#b050cd`) não. Para o banho, a cor crua da
  equipe misturada com transparente funciona.
- Escala de desempenho como hoje: rAAting de 1.10 para cima em `--win`, abaixo
  de 0.90 em `--danger`. Saldo (+/-, Swing/R, FK-FD) positivo em `--win`,
  negativo em `--danger`.
- Tier de campeonato com a escala própria de hoje (`--tier-s/a/b/c`), letra
  grande e solta.

### 4.5 Densidade

- Placar colado no nome: a lista de partidas é uma grade só e cada partida é
  uma subgrade dela (`grid-template-columns: subgrid`). A coluna do nome tem a
  largura do nome mais longo da lista, limitada a 230px (210px nos trilhos), e
  daí corta com reticências. Todos os placares continuam alinhados.
- Nota colada nas partidas, no ranking: mesma técnica. O quadro do ranking
  termina onde a nota termina.
- Em subgrade, padding na linha come a primeira trilha. As margens viram
  trilhas vazias nas pontas.
- Alturas de chegada: partida 56px (duas linhas de 26 e 4 de respiro),
  posição do ranking 38px, campeonato 54px, linha do scoreboard 38px.

### 4.6 Componentes novos

**Carrossel dos melhores da semana** (home):
- Mostra um líder por vez, das nove categorias que o `playerOfWeekLeaders()`
  já devolve.
- Troca sozinho a cada `PLAYER_OF_WEEK_INTERVAL_MS` (4500ms) e desliza para o
  lado em 220ms. O primeiro cartão vai clonado no fim, para a volta do último
  ao primeiro seguir para a frente.
- Fundo na cor da equipe do líder, foto solta sangrando na base, silhueta
  para quem não tem foto. Nick, sigla da equipe e o número em 56px.
- No pé do cartão, nove tracinhos de 3px com área de clique de 22px de
  altura: o atual enche enquanto conta o tempo (animação CSS, `animationend`
  avança). Eles substituem as setas e as bolinhas que saíram em agosto por
  serem pequenas demais para o dedo.
- Passar o mouse pausa. Foco por teclado (`:focus-visible`) também pausa;
  foco por clique não, senão clicar num tracinho para o carrossel de vez.
  Arrastar troca no celular, e as setas do teclado funcionam.

**Cartão do melhor da partida**: o mesmo cartão, estático, com as quatro
estatísticas de apoio numa linha embaixo.

**Barra espelhada** (comparativo e histórico dos jogadores): duas linhas. Em
cima, o valor de cada lado e o rótulo no meio; embaixo, uma barra que cresce
do centro para cada lado, na cor de cada equipe, com o maior valor em
opacidade cheia e o menor em 0,5.

**Chave de campeonato**:
- Cada rodada é uma coluna de células de mesma altura, então a partida da
  rodada seguinte cai no meio das duas que a alimentam.
- As linhas entre as partidas são pseudo-elementos, com a junta vertical só
  nas rodadas que reduzem pela metade.
- Partida "Sem adversário" vira célula vazia, sem linha, e quem passou direto
  aparece só na rodada seguinte.
- A grande final fica como última coluna da chave superior. W.O. aparece como
  rótulo pequeno.

### 4.7 Topo, abas e rodapé

- Topo com 56px: logo, menu só com a primeira letra maiúscula (o atual com
  traço vermelho de 2px embaixo), busca com o "/" em texto simples, sem
  caixinha, e o botão Entrar em vermelho com texto `--on-brand`.
- Abas de página no mesmo desenho do menu.
- Rodapé numa linha só, com o logo pequeno, uma frase e quatro links. O logo
  de 200px de hoje sai.

## 5. Página por página

As medidas são dos mockups, com os mesmos dados do site atual.

### Home (esqueleto em trilhos, como HLTV e vlr.gg)

Três colunas desde o topo, com trilhos de 340px e o meio fluido:
- **Esquerda**: carrossel dos melhores da semana e ranking com 12 equipes, em
  Placa, com a pintura no hover.
- **Meio**: últimas partidas (12, agrupadas por dia, com o dia como
  cabeçalho) e a faixa de atividade recente embaixo.
- **Direita**: notícias (a principal com imagem 2,3:1, as outras duas como
  lista com miniatura) e campeonatos em Placa, com a letra de tier solta, o
  ponto vermelho só em "Em andamento" e "até 7 de nov" no lugar das duas
  datas.

Larguras:
- Abaixo de 1180px: duas colunas, e notícias e campeonatos descem para uma
  faixa lado a lado.
- Abaixo de 760px: uma coluna, na ordem jogador da semana, partidas, ranking,
  notícias, campeonatos, atividade.

Chegada: 1086px a 1440px (era 2169px), primeira partida a 136px do topo (era
995px). A 390px, 2857px (era 4849px), primeira partida a 460px (era 2588px).

### Partida

- **Topo**: o placar da série. Cada equipe do seu lado, pintada com a cor
  dela, a arte dos mapas atrás do placar, "33 - 36 rounds" embaixo. Em cima,
  numa linha só: campeonato, série e formato, data e patch.
- **Abas de mapa**: uma faixa cortada em diagonal. Cada aba mostra o placar
  do mapa e o escudo de quem venceu. O bloco que repetia "Bind 13-8" sai.
- **Comparativo**: uma faixa de quatro barras espelhadas logo abaixo das
  abas (rounds, ataque, defesa, pistols). Cada equipe fica do mesmo lado em
  que aparece no placar. As barras usam a cor da equipe, não o vermelho.
- **Coluna principal**: scoreboard com as duas equipes numa tabela só e o
  cabeçalho de colunas uma vez. A linha da equipe é pintada e traz os
  totais. Clicar num jogador escolhe quem vai para o histórico. Embaixo, as
  lineups lado a lado, com foto solta e ícone da função. Clicar também
  escolhe.
- **Trilho**: melhor da partida e histórico dos jogadores (oito barras
  espelhadas). Os números do histórico vêm de `lineupHistoricalPlayer()`; a
  barra mostra onde cada um está entre os dez da série.
- **Celular**: melhor da partida, scoreboard (rola para o lado com a coluna
  do jogador presa), lineups (rolam para o lado) e histórico.

Chegada: 1367px (era 3404px). A 390px, 2518px (era 7300px).

### Equipe

- **Topo**: faixa na cor da equipe com o escudo de 112px, sigla, nome em
  46px, estado com bandeira e universidade, "Ser fã" e Instagram, o ranking
  grande e solto (#10 +2) e as cinco fotos do elenco soltas à direita. As
  fotos somem abaixo de 1180px.
- **Coluna principal**: histórico do ranking (quatro números soltos, a nota
  de sucessão, o gráfico de linha na cor da equipe com 170px) e as últimas
  partidas no formato da home.
- **Trilho**: elenco atual em Placa (foto de 34px sangrando, nick, Riot ID,
  rAAting, mapas e ACS), com a pintura no hover e o link de reservas; depois,
  troféus.

Chegada: 1245px (era 2645px). A 390px, 1945px (era 5077px).

### Jogador

- **Topo**: foto grande solta na base, faixa na cor da equipe, função com
  ícone, nick em 64px, Riot ID e o nick anterior, equipe com escudo, "Ser
  fã", e os cinco números principais à direita (rAAting em 64px).
- **Coluna principal**: "Dados do jogador" numa ficha só, em Placa, com três
  linhas (geral, por round, abertura e trades). Ela substitui os quatro
  quadros de hoje. Depois, as últimas partidas no formato da home, com o
  abate e morte do jogador naquela série ("71 / 41") numa coluna a mais.
- **Trilho**: agentes (barra na cor da equipe), desempenho por mapa em Placa
  com a arte do mapa no fundo da linha, troféus.

Chegada: 1393px (era 2106px). A 390px, 2636px (era 4558px).

### Campeonato

- **Topo**: o banner do campeonato escurecido no fundo, logo, situação,
  nome em 48px, datas e patch, e a organização com logo. Embaixo, os dados
  soltos: prêmio, equipes, tier, tipo, formato.
- **Primeira faixa**: pódio (as três primeiras na cor delas, com a
  campanha), resumo (equipes, séries, dias) e map pool (linhas com a arte do
  mapa).
- **Chave**: largura toda, superior com a grande final na ponta, inferior
  embaixo.
- **Classificação final**: todas as equipes, com a campanha de cada uma na
  chave. Em campeonato encerrado, ela substitui a lista de participantes e o
  bloco de resultados. Em campeonato em andamento, a lista de participantes
  continua.

Chegada: 2423px (era 6720px). A 390px, 3545px (era 12780px); a chave rola
para o lado.

## 6. O que o dono decidiu

- Fundo escuro mantido.
- Partidas no Placar, com o mapa como fundo da linha inteira, porque ele
  gosta do fundo de mapa de hoje e quis só que ocupasse menos.
- Ranking em Placa, com a pintura de equipe de hoje no hover.
- Placar colado no nome e nota colada nas partidas.
- Melhores da semana com um jogador por vez, deslizando, no lugar da faixa
  com os nove. Isso volta atrás numa decisão de agosto, quando o carrossel
  saiu.
- Home no esqueleto em trilhos (opção A).
- Aprovou os mockups de home, partida, equipe, jogador e campeonato.

## 7. Decisões minhas, para conferir

- Branch a partir de `a696ecc`, que é o estado local exato com o trabalho não
  commitado da main (papéis do elenco, link das Cartinhas). Partir de
  `77edc7f` deixaria isso de fora.
- Títulos grandes em todas as seções, para a página ter um sistema de título
  só.
- 12 partidas na home (hoje são 8), para a coluna do meio terminar junto com
  os trilhos.
- Notícias em lugar menor, porque a mais recente é de 12 de setembro.
- "Finalizado" some das listas; só "Em andamento" é marcado. Datas sem o ano
  nas listas.
- Na partida, o comparativo saiu do trilho e virou faixa sob as abas.
- No jogador, "Composição" e "Métricas" da rAAting 3.0 somem quando todos os
  valores vêm vazios. Hoje elas aparecem só com traços para o Aldeath e para
  o bada. O motivo de virem vazios não é deste trabalho.
- Em campeonato encerrado, a classificação final substitui participantes e
  resultados. A campanha vem das séries do próprio campeonato (vitórias e
  derrotas, com W.O. contando, e quem passou direto não conta), então vale
  também para suíço e pontos corridos, que não têm chave.
- Na branch, o visual novo substitui o atual. Não existe chave para alternar
  entre os dois: a comparação é uma branch contra a outra.
- A branch fica local. Nada vai para o `origin` sem o dono pedir.
- Ordem de construção: primeiro o que é de todas as páginas (topo, rodapé,
  títulos, abas, Placa, Placar, mapa de fundo), depois home, partida, equipe,
  jogador e campeonato, e por último as páginas sem mockup.

## 8. Como conferir

- Medir a altura de cada página a 1440px e a 390px, com os mesmos dados, e
  comparar com as tabelas acima.
- Estouro horizontal: procurar elemento mais largo que a viewport sem
  ancestral com rolagem horizontal. Rodar antes com um controle negativo (um
  elemento de 600px inserido de propósito) para provar que o teste acusa.
- Nenhum erro no console em home, partida, equipe, jogador, campeonato,
  partidas, eventos, players e ranking.
- `node scripts/build_database.js` termina sem erro (pega o problema do
  `init()`).
- `grep` de travessão nos arquivos tocados dá zero.
- Hover e foco com Tab de verdade, não `element.focus()`.

## 9. O que fica para quem constrói

- A arquitetura do CSS: reescrever as regras afetadas no `styles.css` da
  branch ou criar uma camada nova carregada depois dele. Nos dois casos, uma
  fonte de verdade por componente; nada de outra camada empilhada sem limpar
  a de baixo (o `styles.css` já teve seis redesigns empilhados).
- As páginas que não têm mockup: lista de partidas, lista de eventos, lista
  de players, ranking completo, notícias, perfil de usuário, mapa, as outras
  abas de equipe, jogador e campeonato, e as telas de cada mapa de uma série.
  Elas seguem as regras da seção 4. Onde a regra não decide, a solução mais
  próxima de um componente já desenhado vence.
- O modo "Avançado" do scoreboard.
- Estados vazios e de carregamento no estilo novo.
- O comportamento de cada componente nos breakpoints de 560 e 940px, que os
  mockups não usam.
- Os alvos de toque de 44px no celular onde o desenho permitir.
