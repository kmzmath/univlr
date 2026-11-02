// Contrato do visual "Placar" (docs/superpowers/specs/2026-10-23-identidade-placar-design.md).
// Carrega o app.js num contexto vm com o DOM em stub, do mesmo jeito que o
// test_qualifier_bracket.js, e testa o HTML que as funcoes de desenho devolvem.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), "utf8");

const noop = () => {};
const stubElement = {
  innerHTML: "",
  value: "",
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: {},
  dataset: {},
  setAttribute: noop,
  appendChild: noop,
  focus: noop,
};
const context = {
  console,
  Date,
  Intl,
  JSON,
  Map,
  Math,
  Number,
  Promise,
  Set,
  String,
  clearInterval: noop,
  clearTimeout: noop,
  setInterval: () => 0,
  setTimeout: () => 0,
};
context.globalThis = context;
context.window = context;
// O #app tem elemento proprio: com um so stub para tudo, a busca (que tambem
// pega o seu elemento por id) apagava o HTML que o Shell acabou de escrever.
const appElement = { ...stubElement };
context.document = {
  title: "",
  getElementById: (id) => (id === "app" ? appElement : stubElement),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...stubElement }),
  addEventListener: noop,
  removeEventListener: noop,
  body: stubElement,
  documentElement: stubElement,
};
context.location = { hash: "" };
context.history = { pushState: noop, replaceState: noop };
context.requestAnimationFrame = () => 0;
context.fetch = () => new Promise(noop);

vm.createContext(context);
vm.runInContext(`${ler("app.js")}\n;globalThis.__vp = {};`, context);
const vp = context.__vp;

// ---------------------------------------------------------------- Tarefa 1
const html = ler("index.html");
const linkBase = html.indexOf('href="styles.css?v=300"');
// Qualquer versao: o ?v= sobe a cada mudanca para furar o cache do navegador.
const linkPlacar = html.search(/<link rel="stylesheet" href="placar\.css\?v=\d+" \/>/);
assert(linkPlacar > -1, "index.html liga o placar.css");
assert(linkPlacar > linkBase, "o placar.css vem depois do styles.css, para vencer na cascata");
assert(fs.existsSync(path.join(raiz, "placar.css")), "placar.css existe");
assert(/^\/\* Visual "Placar"/.test(ler("placar.css")), "placar.css comeca pelo comentario que explica a camada");

// ---------------------------------------------------------------- Tarefa 2
// Titulo de secao: Condensed grande, sem traco vermelho, contexto e link na
// mesma linha. As duas funcoes de titulo devolvem a mesma peca.
const titulo = context.sectionHead("Elenco atual", "Texto", "teams/x/roster", "Ver reservas");
assert(titulo.includes('class="vp-sec"'), "sectionHead devolve vp-sec");
assert(titulo.includes("<h2>Elenco atual</h2>"), "sectionHead mantem o h2");
assert(titulo.includes('class="vp-sec-aside">Texto<'), "a descricao vira o contexto curto ao lado");
assert(titulo.includes('href="#/teams/x/roster"') && titulo.includes('class="vp-sec-more"'), "o link vai na ponta direita");
assert(!context.sectionHead("Elenco atual").includes("vp-sec-aside"), "sem descricao, sem contexto vazio");
assert(context.panelTitle("Ranking").includes('class="vp-sec"'), "panelTitle devolve a mesma peca");
assert(context.panelTitle("Ranking", "ranking", "Ver tudo").includes('href="#/ranking"'), "panelTitle mantem o link");

// Rodape numa linha so, com a frase e os quatro links.
context.Shell("<p>conteudo</p>");
assert(appElement.innerHTML.includes("Estatísticas do cenário universitário brasileiro de VALORANT."), "rodape tem a frase");
assert(/class="vp-rodape-links"[\s\S]*#\/matches[\s\S]*#\/events[\s\S]*#\/ranking[\s\S]*#\/news/.test(appElement.innerHTML), "rodape tem os quatro links");

// ---------------------------------------------------------------- Tarefa 3
// Base sintetica: tres equipes (uma toda branca), um campeonato e quatro mapas
// com arte. `state` e const no app.js, entao so da para alcancar por dentro.
vm.runInContext(
  `state.db = {
    teams: [
      { id: "azr", name: "Azure Bears Black", tag: "AZR B", colors: ["#037aff", "#fefeff"], logo: "assets/team-logos/azure_bears.png" },
      { id: "ceub", name: "CEUB Octopus Vulgaris", tag: "CEUB VLG", colors: ["#551d66", "#020103"], logo: "assets/team-logos/ceub_octopus.png" },
      { id: "mack", name: "MackLogic White", tag: "LOGIC", colors: ["#ffffff", "#ffffff"], logo: "assets/team-logos/macklogic_white.png" },
      { id: "nova", name: "Equipe Nova", tag: "NOVA", colors: [], logo: "" },
    ],
    tournaments: [{ id: "rush", name: "Rush Series 3ª Edição", logo: "assets/tournament-icons/rushSeries.png" }],
    maps: ["Bind", "Abyss", "Ascent", "Lotus"].map((name) => ({ id: name.toLowerCase(), name, icon: "assets/maps/" + name.toLowerCase() + ".png" })),
    matches: [], matchSeries: [], players: [],
  };`,
  context,
);
const mapaDaSerie = (a, b, id, name, n, sa, sb) => ({ id: `${a}-${b}-${n}`, mapId: id, mapName: name, mapNumber: n, teamA: { id: a, score: sa }, teamB: { id: b, score: sb }, winnerId: sa > sb ? a : b });
const serie = (key, a, nomeA, b, nomeB, scoreA, scoreB, mapas) => ({
  id: key, primaryMatchId: mapas[0].id, seriesKey: key, eventId: "rush",
  startedAt: Date.UTC(2026, 9, 18, 22), sortAt: Date.UTC(2026, 9, 18, 23),
  teamA: { id: a, name: nomeA }, teamB: { id: b, name: nomeB },
  scoreA, scoreB, mapCount: mapas.length, maps: mapas, mapNames: mapas.map((m) => m.mapName),
  label: mapas.length > 1 ? `MD${mapas.length}` : mapas[0].mapName, winnerId: scoreA > scoreB ? a : b,
});
const md3 = serie("k-md3", "azr", "Azure Bears Black", "ceub", "CEUB Octopus Vulgaris", 1, 2, [
  mapaDaSerie("azr", "ceub", "bind", "Bind", 1, 13, 8),
  mapaDaSerie("azr", "ceub", "abyss", "Abyss", 2, 13, 15),
  mapaDaSerie("azr", "ceub", "ascent", "Ascent", 3, 7, 13),
]);
const md1 = serie("k-md1", "mack", "MackLogic White", "ceub", "CEUB Octopus Vulgaris", 0, 1, [mapaDaSerie("mack", "ceub", "lotus", "Lotus", 1, 6, 13)]);
// A linha de partida e o modelo antigo, mais baixo (escolha do dono em 24/10):
// escudo grande de cada lado, placar grande no meio com o vencedor em verde, e
// a arte dos mapas de fundo na linha inteira, com os nomes em cima, cada um sobre
// a propria arte.
const placarDa = (linha) => linha.split('class="vp-pl-placar"')[1].split("</span>")[0];
const nomesDosMapas = (linha) => (linha.split('class="vp-pl-mapas"')[1] || "").match(/<span class="vp-pl-mapa">[^<]+</g)?.map((s) => s.split(">")[1].slice(0, -1)) || [];

const linhaMd3 = context.matchResultRow(md3);
assert(linhaMd3.includes('<a class="vp-pl" style="--maps:3"'), "a partida vira uma vp-pl, com a contagem de mapas para o espaco do campeonato");
assert(/<b class="vp-venceu">2<\/b>/.test(placarDa(linhaMd3)) && /<b>1<\/b>/.test(placarDa(linhaMd3)), "so o placar do vencedor ganha a cor de vitoria");
const posicoesMd3 = ["Azure Bears Black", "CEUB Octopus Vulgaris"].map((nome) => linhaMd3.indexOf(nome));
assert(posicoesMd3[0] > -1 && posicoesMd3[1] > posicoesMd3[0], "equipe A a esquerda e B a direita");
assert.deepStrictEqual(nomesDosMapas(linhaMd3), ["Bind", "Abyss", "Ascent"], "os nomes dos mapas vem em cima, na ordem da serie");
assert.strictEqual((linhaMd3.split('class="vp-pl-artes"')[1].split("</span>")[0].match(/<i>/g) || []).length, 3, "uma fatia de arte por nome de mapa");
assert(linhaMd3.includes('data-fallback="assets/maps/bind.png"') && linhaMd3.includes('onerror="mapArtError(this)"'), "a arte cai no PNG de reserva e depois some");
assert(linhaMd3.includes("Rush Series 3ª Edição"), "o campeonato fica na linha de cima");

const linhaMd1 = context.matchResultRow(md1);
assert(/<b>6<\/b>/.test(placarDa(linhaMd1)) && /<b class="vp-venceu">13<\/b>/.test(placarDa(linhaMd1)), "MD1 mostra o placar de rounds");
assert.deepStrictEqual(nomesDosMapas(linhaMd1), ["Lotus"], "MD1 mostra so o nome do mapa");
assert.notStrictEqual(context.teamLineColor("mack"), "#ffffff", "equipe toda branca nao vira risco branco puro");
assert.strictEqual(context.teamLineColor("nova"), "#8a8d98", "equipe sem cor cadastrada fica com o risco cinza");
assert.strictEqual(context.teamLineColor("nao-existe"), "#8a8d98", "equipe fora do cadastro tambem fica cinza");
assert.notStrictEqual(context.teamLineColor("azr"), "#8a8d98", "controle: equipe com cor nao cai no cinza");
assert(context.matchResultRow(md1, { kd: [71, 41] }).includes("71 / 41"), "a coluna de K/D aparece quando pedida");
assert(!linhaMd1.includes("vp-kd"), "sem K/D pedido, sem a coluna");

const semArte = serie("k-novo", "azr", "Azure Bears Black", "ceub", "CEUB Octopus Vulgaris", 0, 1, [mapaDaSerie("azr", "ceub", "novo", "Mapa Novo", 1, 9, 13)]);
const linhaSemArte = context.matchResultRow(semArte);
assert(!linhaSemArte.includes("vp-pl-artes"), "sem nenhuma arte, o fundo de mapas nao entra");
assert.deepStrictEqual(nomesDosMapas(linhaSemArte), ["Mapa Novo"], "o nome do mapa continua em cima");

const listaAgrupada = context.listaDeResultados([md3, md1], 50);
assert(listaAgrupada.includes('class="vp-lista"'), "as linhas de um dia ficam numa vp-lista");

// ---------------------------------------------------------------- Tarefa 4
// Placa: ranking e campeonatos da home. A nota cola nas partidas, o
// campeonato encerrado nao repete "Finalizado" e so o em andamento e marcado.
const equipeRanking = { id: "ceub", name: "CEUB Octopus", tag: "CEUB OCT", colors: ["#551d66", "#020103"], matches: 48, wins: 47, losses: 1, rankingScore: 99.94, rank: 1, validRank: 1, canonicalRank: 1 };
const linhaRanking = context.compactRankingRow(equipeRanking);
assert(linhaRanking.includes('class="vp-rk pintura-de-equipe"'), "a linha do ranking e uma vp-rk com a pintura de equipe");
assert(linhaRanking.includes("data-trama="), "a trama do teamPatternFor continua");
assert(/48 partidas<\/span>\s*<span class="vp-rk-nota">99\.9<\/span>/.test(linhaRanking), "a nota vem logo depois das partidas");

const diaUtc = (mes, dia) => Date.UTC(2026, mes - 1, dia, 15);
const campeonatoVivo = { id: "copa", name: "Copa LUCE Inters", status: "Em andamento", tier: "B", start: diaUtc(9, 6), end: diaUtc(11, 7), matches: 17, teams: Array(8).fill("x"), logo: "assets/tournament-icons/copa_luce.png" };
const campeonatoEncerrado = { id: "rush", name: "Rush Series 3ª Edição", status: "Finalizado", tier: "A", start: diaUtc(10, 17), end: diaUtc(10, 18), matches: 35, teams: Array(21).fill("x"), logo: "assets/tournament-icons/rushSeries.png" };
const linhaViva = context.eventListRow(campeonatoVivo);
assert(linhaViva.includes('class="vp-evrow"'), "a linha de campeonato e uma vp-evrow");
assert(linhaViva.includes('class="vp-ao-vivo"') && /Em andamento<\/span> até 7 de nov/.test(linhaViva), "em andamento mostra ate quando vai");
const linhaEncerrada = context.eventListRow(campeonatoEncerrado);
assert(!linhaEncerrada.includes("Finalizado"), "campeonato encerrado nao repete Finalizado");
assert(linhaEncerrada.includes("17 - 18 de out"), "datas do mesmo mes juntam o mes no fim, sem ano");
assert(linhaEncerrada.includes("vp-tier vp-tier-a"), "a letra do tier ganha a cor do degrau");
assert.strictEqual(context.eventDatesShort({ status: "Finalizado", start: diaUtc(9, 27), end: diaUtc(10, 4) }), "27 de set - 4 de out", "meses diferentes ficam nos dois lados");
assert.strictEqual(context.eventDatesShort({ status: "Finalizado", start: diaUtc(10, 10), end: diaUtc(10, 10) }), "10 de out", "um dia so vira uma data");
assert.strictEqual(context.eventDatesShort({ status: "Em andamento", start: diaUtc(10, 17) }), "desde 17 de out", "em andamento sem fim conta desde o inicio");

// ---------------------------------------------------------------- Tarefa 5
// Carrossel dos melhores da semana: um lider por vez, o primeiro clonado no fim
// e um tracinho por categoria. Sem ninguem com o minimo de mapas, o estado
// vazio de hoje continua.
const categorias = ["Melhor rAAting 3.0", "Melhor ACS", "Melhor ADR", "Melhor KAST", "Melhor Swing/R", "Melhor K/D", "Melhor KPR", "Melhor DPR", "Melhor APR"];
const lideres = categorias.map((label, i) => ({
  key: `k${i}`, label, statLabel: label.replace("Melhor ", ""), value: String(100 + i), windowLabel: "13 de out - 20 de out",
  player: { id: `p${i}`, nick: i % 2 ? "Gutoso" : "bada", teamId: i % 2 ? "azr" : "ceub", matches: 11, rounds: 217, photo: "" },
}));
vm.runInContext(`state.homeSummary = { leaders: ${JSON.stringify(lideres)} };`, context);
const semana = context.weekHighlights();
assert(semana.includes('class="vp-semana"'), "a secao vira o carrossel vp-semana");
const slides = semana.match(/<a class="vp-slide"[^>]*>/g) || [];
assert.strictEqual(slides.length, 10, "nove cartoes e o clone do primeiro no fim");
assert(slides[9].includes('aria-hidden="true"') && !slides[0].includes('aria-hidden="true"'), "so o clone sai da arvore de acessibilidade");
const passos = semana.match(/<button type="button" class="vp-passo"[^>]*>/g) || [];
assert.strictEqual(passos.length, 9, "um tracinho por categoria");
assert(passos[1].includes('aria-label="Melhor ACS"'), "o tracinho diz a categoria");
assert(semana.includes("11 mapas, 217 rounds"), "o contexto fica sem ponto do meio");
assert(semana.includes(`--vp-passo:${vm.runInContext("PLAYER_OF_WEEK_INTERVAL_MS", context)}ms`), "o tempo do tracinho vem do intervalo de sempre");
vm.runInContext("state.homeSummary = { leaders: [] };", context);
const semanaVazia = context.weekHighlights();
assert(semanaVazia.includes("Nenhum jogador atingiu o mínimo") && !semanaVazia.includes("vp-slide"), "semana sem lideres mostra o estado vazio");
assert.strictEqual(typeof context.bindWeekCarousel, "function", "o carrossel tem quem o ligue");
vm.runInContext("state.homeSummary = null;", context);

// O cartao Camisa de #/matches so existe com uma equipe filtrada, e o placar sai
// do que esta filtrado.
const serieDaEquipe = (vencedor, perdedor) => ({ winnerId: vencedor, loserId: perdedor });
vm.runInContext("state.matchTeams = [];", context);
assert.strictEqual(context.cartaoDaEquipe([serieDaEquipe("azr", "ceub")]), "", "sem equipe filtrada nao ha cartao");
vm.runInContext('state.matchTeams = ["azr", "ceub"];', context);
assert.strictEqual(context.cartaoDaEquipe([serieDaEquipe("azr", "ceub")]), "", "com duas equipes nao ha um assunto so");
vm.runInContext('state.matchTeams = ["azr"];', context);
assert.strictEqual(context.cartaoDaEquipe([]), "", "filtro sem partida nao tem cartao");
const cartaoEquipe = context.cartaoDaEquipe([serieDaEquipe("azr", "ceub"), serieDaEquipe("azr", "ceub"), serieDaEquipe("ceub", "azr")]);
assert(cartaoEquipe.includes(">2-1<") && cartaoEquipe.includes("67% de vitórias") && cartaoEquipe.includes("3 partidas"), "o cartao soma vitorias e derrotas do filtro");
assert(!cartaoEquipe.includes("vp-valor-longo"), "placar curto fica no tamanho cheio");
const longa = Array.from({ length: 20 }, () => serieDaEquipe("azr", "ceub")).concat(Array.from({ length: 10 }, () => serieDaEquipe("ceub", "azr")));
assert(context.cartaoDaEquipe(longa).includes("vp-valor-longo"), "placar de 5 caracteres usa o numero menor");
vm.runInContext("state.matchTeams = [];", context);

// Plant, retake e pistol por lado saem dos rounds. O plant da defesa nao existe:
// quem plantou e sempre o atacante, mesmo perdendo o round.
const equipeTesteA = { id: "a", color: "Red" };
const equipeTesteB = { id: "b", color: "Blue" };
const roundsTeste = [
  { roundNum: 0, winningTeam: "Red", winningTeamRole: "Attacker", bombPlanter: "x", plantSite: "A" },
  { roundNum: 1, winningTeam: "Blue", winningTeamRole: "Defender", bombPlanter: "x", plantSite: "b" },
  { roundNum: 2, winningTeam: "Blue", winningTeamRole: "Defender" },
  { roundNum: 12, winningTeam: "Blue", winningTeamRole: "Attacker", bombPlanter: "y", plantSite: "C" },
];
const linhasTeste = JSON.parse(JSON.stringify(context.calculateMatchTeamStats(roundsTeste, equipeTesteA, equipeTesteB, new Map())));
assert.strictEqual(linhasTeste.a.plants, 2, "o atacante leva o plant, ganhando ou perdendo");
assert.strictEqual(linhasTeste.a.plantWins, 1, "so conta como vitoria depois de plantar o round ganho");
assert.strictEqual(linhasTeste.b.retakes, 1, "retake e round plantado que a defesa venceu");
assert.strictEqual(linhasTeste.a.plantA + linhasTeste.a.plantB, 2, "o site vale em maiuscula ou minuscula");
assert.strictEqual(linhasTeste.b.plantC, 1, "o site entra na conta de quem plantou");
assert.strictEqual(linhasTeste.a.pistolAttackRounds + linhasTeste.b.pistolAttackRounds, 2, "cada pistol tem um atacante");
assert.strictEqual(linhasTeste.a.pistolAttackWins + linhasTeste.b.pistolAttackWins, 2, "pistol vencido no ataque");

// O cartao de mapa so existe com um mapa filtrado, e soma as duas equipes ou uma so.
const estatisticaTeste = (ataque, defesa) => ({ ...context.emptyTeamRoundStats(), attackWins: ataque, attackRounds: 12, defenseWins: defesa, defenseRounds: 12, pistolWins: 1, pistolRounds: 2, pistolAttackWins: 1, pistolAttackRounds: 1, plants: 6, plantA: 6, plantWins: 3, plantsAgainst: 6, retakes: 3 });
const mapaNoFiltro = (mapId) => ({ maps: [{ mapId, winnerId: "azr", loserId: "ceub", teamStats: { azr: estatisticaTeste(9, 3), ceub: estatisticaTeste(3, 9) } }] });
vm.runInContext("state.matchMaps = []; state.matchTeams = [];", context);
assert.strictEqual(context.cartaoDoMapa([mapaNoFiltro("lotus")]), "", "sem mapa filtrado nao ha cartao de mapa");
vm.runInContext('state.matchMaps = ["lotus", "bind"];', context);
assert.strictEqual(context.cartaoDoMapa([mapaNoFiltro("lotus")]), "", "com dois mapas nao ha um assunto so");
vm.runInContext('state.matchMaps = ["lotus"];', context);
assert.strictEqual(context.cartaoDoMapa([]), "", "filtro sem partida nao tem cartao de mapa");
const cartaoMapa = context.cartaoDoMapa([mapaNoFiltro("lotus")]);
assert(cartaoMapa.includes(">50%</b><small>Ataque") && cartaoMapa.includes(">50%</b><small>Defesa"), "sozinho, o mapa soma as duas equipes por round");
assert(cartaoMapa.includes("1 mapa, 24 rounds"), "cada round entra uma vez");
assert(cartaoMapa.includes("Retakes") && cartaoMapa.includes("<b>50%</b> dos plants"), "retake sobre os plants");
assert(!cartaoMapa.includes("Depois de plantar"), "sozinho, depois de plantar seria o inverso do retake");
vm.runInContext('state.matchTeams = ["azr"];', context);
const cartaoMapaEquipe = context.cartaoDoMapa([mapaNoFiltro("lotus")]);
assert(cartaoMapaEquipe.includes(">75%</b><small>Ataque") && cartaoMapaEquipe.includes(">25%</b><small>Defesa"), "com equipe, os numeros sao dela");
assert(cartaoMapaEquipe.includes("1-0 em 1 mapa") && cartaoMapaEquipe.includes("Depois de plantar"), "com equipe, entram placar e conversao");
assert(context.resumoDasPartidas([mapaNoFiltro("lotus")]).includes("vp-mapa-camisa") && !context.resumoDasPartidas([mapaNoFiltro("lotus")]).includes("vp-camisa-equipe"), "um cartao Camisa por tela");
vm.runInContext("state.matchMaps = []; state.matchTeams = [];", context);
// O mes clicado no grafico de #/matches vira o filtro de data.
assert.deepStrictEqual(JSON.parse(JSON.stringify(context.diasDoMes(2026 * 12 + 1))), { de: "2026-02-01", ate: "2026-02-28" }, "o mes vai do dia 1 ao ultimo dia");

// ---------------------------------------------------------------- Tarefa 6
// Home em trilhos: esquerda (semana e ranking), meio (partidas), direita
// (noticias e campeonatos). As noticias vem do news.js, que nao roda neste vm,
// entao a ordem aqui e conferida sem elas e o bloco do trilho e testado a parte.
assert.strictEqual(vm.runInContext("HOME_RANKING_LIMIT", context), 12, "a home mostra 12 equipes do ranking");
assert.strictEqual(vm.runInContext("HOME_RECENT_MATCH_LIMIT", context), 12, "a home mostra 12 partidas");
vm.runInContext(
  `Object.assign(state.db.tournaments[0], { status: "Finalizado", tier: "A", start: ${Date.UTC(2026, 9, 17, 15)}, end: ${Date.UTC(2026, 9, 18, 15)}, matches: 35, teams: ["azr", "ceub"] });
   state.ready = true;`,
  context,
);
context.renderHomeCompact();
const home = appElement.innerHTML;
const blocos = ["vp-trilho-esq", "vp-semana", "vp-placa-rk", "vp-trilho-meio", "vp-s-partidas", "vp-trilho-dir", "vp-placa-ev"];
const posicoes = blocos.map((bloco) => home.indexOf(bloco));
posicoes.forEach((pos, i) => assert(pos > -1, `a home tem ${blocos[i]}`));
assert.deepStrictEqual(posicoes, [...posicoes].sort((a, b) => a - b), "os blocos da home vem na ordem dos trilhos");
assert(!home.includes("hub-panel"), "a home nao tem mais o painel em volta de cada lista");

context.Community = { esc: (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;") };
vm.runInContext(ler("news.js"), context);
assert.strictEqual(typeof context.News.blocoTrilho, "function", "o news.js expoe o bloco do trilho");
assert.strictEqual(context.News.blocoTrilho(), "", "sem materia, o trilho nao ganha bloco vazio");

// ---------------------------------------------------------------- Tarefa 7
// Pagina de partida: barra espelhada (comparativo e historico) e o scoreboard
// das duas equipes numa tabela so, com um cabecalho que ordena as duas.
const espelho = context.espelhoLinha({ label: "Rounds", valorA: "48%", valorB: "52%", fracA: "33/69", fracB: "36/69", larguraA: 48, larguraB: 52, maiorA: false, maiorB: true, corA: "#177ae8", corB: "#b050cd" });
assert(espelho.includes('class="vp-espelho"') && espelho.includes(">Rounds<"), "a barra espelhada tem o rotulo no meio");
const barras = espelho.match(/<i[^>]*style="--w:[^"]*"[^>]*>/g) || [];
assert.strictEqual(barras.length, 2, "uma barra para cada lado");
assert(barras[0].includes("--w:48%") && !barras[0].includes("vp-maior"), "a barra de A vai a 48% e nao e a maior");
assert(barras[1].includes("--w:52%") && barras[1].includes("vp-maior"), "a barra de B vai a 52% e e a maior");
assert(espelho.includes("33/69") && espelho.includes("36/69"), "a fracao fica junto do valor");
assert(!/#f6132a/i.test(espelho), "a barra espelhada nao usa o vermelho da marca");

const jogador = (id, nick, teamId, kills) => ({ id, nick, teamId, rounds: 21, kills, deaths: 12, assists: 4, acs: 200 + kills, adr: 120, kast: 70, agentSlug: "jett", agent: "Jett", agentIcon: "assets/agent-icons/jett.png" });
const partidaFake = { id: "m-1", seriesKey: "k-md3", teamA: { id: "azr", name: "Azure Bears Black", score: 13 }, teamB: { id: "ceub", name: "CEUB Octopus Vulgaris", score: 8 } };
const colunas = context.scoreboardColumns("standard");
const sb = context.placarScoreboard(partidaFake, [
  { team: partidaFake.teamA, players: [jogador("p1", "Aldeath", "azr", 20), jogador("p2", "Stockão", "azr", 15)], side: "a" },
  { team: partidaFake.teamB, players: [jogador("p3", "bada", "ceub", 25), jogador("p4", "Dante", "ceub", 10)], side: "b" },
], colunas, { compareKey: "m-1:all", selection: { a: "p1", b: "p3" } });
assert.strictEqual((sb.match(/<table class="vp-sb/g) || []).length, 1, "o scoreboard e uma tabela so");
assert.strictEqual((sb.match(/<thead>/g) || []).length, 1, "o cabecalho de colunas aparece uma vez");
assert.strictEqual((sb.match(/<tbody/g) || []).length, 2, "um tbody por equipe");
assert.strictEqual((sb.match(/class="vp-sb-equipe"/g) || []).length, 2, "cada equipe abre com a linha dela");
assert(/data-board-key="[^"]*:azr\|[^"]*:ceub"/.test(sb), "o cabecalho ordena as duas equipes juntas");
assert(/<tr class="vp-sb-jogador vp-escolhido"[^>]*data-lineup-player="p1"/.test(sb), "a linha do jogador escolhido para o historico fica marcada");
assert(/data-lineup-side="b"[^>]*data-lineup-player="p4"|data-lineup-player="p4"[^>]*data-lineup-side="b"/.test(sb.replace(/\n/g, " ")) || sb.includes('data-lineup-player="p4"'), "toda linha pode escolher o jogador do historico");

// Rodada de 24/10 na partida: o vencedor em verde no topo, nada de rolagem
// lateral (no celular cada jogador vira um bloco com os numeros rotulados), as
// lineups e o historico numa secao so, e nenhuma mencao a arquivo de origem.
const numerosDoTopo = context.placarHeroNumeros(1, 2);
assert(/<b class="vp-perdeu">1<\/b><i>:<\/i><b class="vp-venceu">2<\/b>/.test(numerosDoTopo), "no topo, o numero de quem venceu ganha a cor de vitoria");
assert(!context.placarHeroNumeros(1, 1).includes("vp-venceu"), "empate nao pinta ninguem");

const linhaDoAldeath = sb.split('data-lineup-player="p1"')[1].split("</tr>")[0];
for (const coluna of colunas) {
  assert(linhaDoAldeath.includes(`data-label="${coluna.short || coluna.label}"`), `a celula de ${coluna.label} leva o rotulo para o celular`);
}

// No celular o scoreboard fica numa linha por jogador, como a HLTV: nick, K,
// D, A e rAAting. Cada celula diz de que coluna e, para o CSS escolher as
// quatro, e o celular usa sempre o padrao (os extras do avancado nao cabem).
for (const coluna of colunas) {
  assert(linhaDoAldeath.includes(`data-col="${coluna.key}"`), `a celula de ${coluna.label} diz de que coluna e`);
}
const linhaDaEquipe = sb.split('class="vp-sb-equipe"')[1].split("</tr>")[0];
assert(linhaDaEquipe.includes('data-col="kills"') && linhaDaEquipe.includes('data-col="rating"'), "a linha da equipe tambem marca as colunas, para virar o cabecalho no celular");
vm.runInContext(`state.matchScoreboardMode = "advanced";`, context);
context.matchMedia = (consulta) => ({ matches: consulta === "(max-width: 640px)" });
assert.strictEqual(context.matchScoreboardMode(), "standard", "no celular o scoreboard e sempre o padrao");
context.matchMedia = () => ({ matches: false });
assert.strictEqual(context.matchScoreboardMode(), "advanced", "controle: fora do celular o avancado continua valendo");
delete context.matchMedia;
vm.runInContext(`state.matchScoreboardMode = "standard";`, context);
const estiloDaPartida = ler("placar.css");
assert(/@media \(max-width: 640px\)\s*\{[^@]*\.vp-sb td\.numeric:not\(\[data-col="rating"\], \[data-col="kills"\], \[data-col="deaths"\], \[data-col="assists"\]\)/.test(estiloDaPartida), "no celular so K, D, A e rAAting aparecem");

const avancadas = context.scoreboardColumns("advanced");
const cabecalhoAvancado = context.scoreboardHeader("k-a|k-b", avancadas);
assert(cabecalhoAvancado.includes('class="vp-sb-grupos"'), "o avancado agrupa as colunas numa linha de cima");
assert(/colspan="6"[^>]*>Componentes do rAAting</.test(cabecalhoAvancado), "os seis componentes do rAAting ficam sob um titulo so");
assert(/colspan="4"[^>]*>Ajustado por economia</.test(cabecalhoAvancado), "as quatro medidas por economia ficam sob um titulo so");
assert(cabecalhoAvancado.includes("<span>Kill</span>") && cabecalhoAvancado.includes("Ordenar por KillRating"), "o nome curto vai no cabecalho e o completo no rotulo de acessibilidade");
assert(!/<span>[A-Za-z]+Rating<\/span>/.test(cabecalhoAvancado), "nenhum nome comprido de componente no cabecalho");
assert(!context.scoreboardHeader("k-a|k-b", colunas).includes("vp-sb-grupos"), "o padrao nao tem a linha de grupos");

const secaoLineups = context.matchLineupsSecao("m-1:all", { a: "p1", b: "p3" }, partidaFake.teamA, [jogador("p1", "Aldeath", "azr", 20), jogador("p2", "Stockão", "azr", 15)], partidaFake.teamB, [jogador("p3", "bada", "ceub", 25), jogador("p4", "Dante", "ceub", 10)]);
assert.strictEqual((secaoLineups.match(/<section class="vp-s-lineups"/g) || []).length, 1, "lineups e historico sao uma secao so");
assert.strictEqual((secaoLineups.match(/<h2>/g) || []).length, 1, "com um titulo so");
const posLineups = secaoLineups.indexOf('class="vp-lineups"');
const posHistorico = secaoLineups.indexOf('class="vp-historico"');
assert(posLineups > -1 && posHistorico > posLineups, "o historico vem logo abaixo das fotos");
assert(secaoLineups.includes(">Aldeath<") && secaoLineups.includes(">bada<"), "o historico diz quem esta sendo comparado");

const appFonte = ler("app.js");
// As abas de mapa vem antes da capa (pedido de 24/10): assim o print da capa
// ate o scoreboard sai inteiro, sem as abas no meio.
const corpoDaPartida = appFonte.split("function renderMatchDetail(")[1].split("\nfunction ")[0];
assert(corpoDaPartida.indexOf("${matchMapTabs(match, series, aggregateMode)}") > -1 && corpoDaPartida.indexOf("${matchMapTabs(match, series, aggregateMode)}") < corpoDaPartida.indexOf('<header class="vp-hero-partida">'), "as abas de mapa ficam acima da capa com o placar");
assert(!appFonte.includes('sectionHead("Fonte")'), "a partida nao tem mais a secao Fonte");
assert(!/escapeHtml\(item\.(fileName|sourcePath)\)/.test(appFonte), "nenhum nome ou caminho de arquivo vai para a pagina");

const rodadas = (n) => Array.from({ length: n }, (_, i) => ({ roundNum: i, winningTeam: i % 2 ? "Red" : "Blue", winningTeamRole: "Attacker", roundResultCode: "Elimination" }));
const timeline = context.roundTimeline({ teamA: { id: "azr", color: "Blue", tag: "AZR" }, teamB: { id: "ceub", color: "Red", tag: "CEUB" }, roundResults: rodadas(26) });
const blocosDeRounds = timeline.match(/<div class="vp-rounds-bloco"[^>]*>/g) || [];
assert.strictEqual(blocosDeRounds.length, 3, "26 rounds viram dois tempos e a prorrogacao");
assert(blocosDeRounds.every((bloco, i) => bloco.includes(`--rounds:${[12, 12, 2][i]}`)), "12, 12 e 2 rounds por bloco");
assert.strictEqual((context.roundTimeline({ teamA: { id: "azr", color: "Blue" }, teamB: { id: "ceub", color: "Red" }, roundResults: rodadas(20) }).match(/class="vp-rounds-bloco"/g) || []).length, 2, "sem prorrogacao, dois blocos");

// ---------------------------------------------------------------- Tarefa 8
// Pagina de equipe: o Resumo vira coluna principal (historico do ranking e
// partidas) e trilho (elenco em Placa e trofeus). Os trofeus saem do topo.
const atleta = (id, nick, handle, acs, nota, mapas) => ({ id, nick, handle, teamId: "azr", matches: mapas, teamStats: [{ teamId: "azr", matches: mapas, acs, raating_3: nota, rating: nota, rounds: mapas * 22 }] });
vm.runInContext(
  `state.db.players = ${JSON.stringify([
    atleta("p1", "Aldeath", "zeNith#mond", 208, 1.07, 44),
    atleta("p2", "Lacerdão", "Lacer#Daoo", 179, 0.96, 51),
    atleta("p3", "Skydvjj", "sky444#jesus", 228, 1.14, 47),
    atleta("p4", "Droga é o pedro", "droga é o pedro#GOAT", 189, 1.01, 44),
    atleta("p5", "Stockão", "stockão#BAGRE", 238, 1.16, 51),
    atleta("p6", "Reserva", "reserva#0001", 150, 0.8, 3),
  ])};
   state.db.teams[0].currentLineup = ["p1", "p2", "p3", "p4", "p5"].map((playerId) => ({ playerId, role: "titular" })).concat([{ playerId: "p6", role: "reserva" }]);`,
  context,
);
const azr = context.teamById("azr");
const elenco = context.teamElencoTabela(azr, azr.currentLineup, context.teamPassagens(azr, [md3]));
assert.strictEqual((elenco.match(/class="vp-et vp-et-atual"/g) || []).length, 6, "uma linha por pessoa do elenco, reserva inclusa");
assert(elenco.includes("Titular") && elenco.includes("Reserva"), "a funcao de cada um aparece");
assert(elenco.includes("zeNith#mond") && elenco.includes("1.07") && elenco.includes(">208<"), "a linha traz Riot ID, rAAting e ACS da equipe");

// Stand-in fica fora: a passagem conta com 10 mapas, ou 40% quando a equipe jogou pouco.
const mapaFalso = (dia, ids) => ({ eventId: "e", startedAt: Date.UTC(2026, 0, dia), maps: [{ startedAt: Date.UTC(2026, 0, dia), players: ids.map((id) => ({ id, teamId: "azr" })) }] });
const trintaMapas = Array.from({ length: 30 }, (_, indice) => mapaFalso(indice + 1, ["p1", ...(indice < 12 ? ["ex1"] : []), ...(indice === 20 ? ["subst"] : [])]));
const passagensFalsas = context.teamPassagens(azr, trintaMapas);
assert(passagensFalsas.standins.has("subst"), "quem jogou um mapa de 30 e stand-in");
assert(!passagensFalsas.standins.has("ex1"), "quem jogou 12 de 30 fez parte da equipe");
assert(!context.teamPassagens(azr, trintaMapas.slice(0, 2)).standins.has("subst"), "a regra nao pega quem nao jogou");
const poucosMapas = Array.from({ length: 5 }, (_, indice) => mapaFalso(indice + 1, ["p1", ...(indice < 3 ? ["novo"] : [])]));
assert(!context.teamPassagens(azr, poucosMapas).standins.has("novo"), "em equipe de 5 mapas, 3 mapas ja contam");

// Saida so depois de 60 dias com a equipe jogando sem o jogador.
const comIntervalo = [...Array.from({ length: 12 }, (_, indice) => mapaFalso(indice + 1, ["p1", "volta"])), ...Array.from({ length: 5 }, (_, indice) => mapaFalso(40 + indice * 10, ["p1"])), ...Array.from({ length: 12 }, (_, indice) => mapaFalso(100 + indice, ["p1", "volta"]))];
assert.strictEqual(context.teamPassagens(azr, comIntervalo).jogadores.get("volta").length, 2, "quem saiu e voltou tem duas passagens");
assert.strictEqual(context.teamPassagensDeElenco(context.teamPassagens(azr, comIntervalo).jogadores.get("volta")).length, 1, "88 dias sem jogar tiram a titularidade, nao a vaga no elenco");
const paradaDaEquipe = [...Array.from({ length: 12 }, (_, indice) => mapaFalso(indice + 1, ["p1", "fica"])), ...Array.from({ length: 12 }, (_, indice) => mapaFalso(100 + indice, ["p1", "fica"]))];
assert.strictEqual(context.teamPassagens(azr, paradaDaEquipe).jogadores.get("fica").length, 1, "parada da equipe inteira nao e saida");

const linhaComVao = context.teamRankingChart([...Array.from({ length: 5 }, (_, i) => ({ date: Date.UTC(2025, 0, 1 + i * 7), rank: 3, points: 80, note: "" })), ...Array.from({ length: 5 }, (_, i) => ({ date: Date.UTC(2026, 0, 1 + i * 7), rank: 4, points: 80, note: "" }))]);
assert.strictEqual((linhaComVao.match(/class="ranking-chart-line"/g) || []).length, 2, "a linha interrompe na inatividade");

const trofeus = context.trofeusLista([
  { event: { id: "rush", name: "Rush Series 3ª Edição", logo: "assets/tournament-icons/rushSeries.png" }, placementLabel: "Vice-campeão", trophyKey: "second", podiumClass: "podium-silver", date: Date.UTC(2026, 9, 20) },
]);
assert(trofeus.includes('class="vp-trofeus"') && (trofeus.match(/class="vp-trofeu"/g) || []).length === 1, "um item por trofeu");
assert(trofeus.includes("Vice-campeão") && trofeus.includes("Rush Series 3ª Edição, out de 2026"), "colocacao, campeonato e mes");
assert.strictEqual(context.trofeusLista([]), "", "sem trofeu, sem bloco");

const jogoDaEquipe = { series: md3, vencedor: md3.winnerId, perdedor: md3.loserId, equipes: [md3.teamA.id, md3.teamB.id], quando: md3.startedAt, event: { id: "e", name: "Evento" } };
const resumo = context.teamResumoTab(azr, { matches: [md3], currentLineup: azr.currentLineup, jogos: [jogoDaEquipe], tournaments: [], trophies: [] });
const principal = resumo.indexOf('class="vp-equipe-principal"');
const trilho = resumo.indexOf('class="vp-equipe-trilho"');
assert(principal > -1 && trilho > principal, "a Visao Geral tem a coluna principal e depois o trilho");
assert(resumo.slice(principal, trilho).includes("vp-forma"), "a coluna principal comeca pela fila de ultimas partidas");
assert(resumo.slice(trilho).includes("Informações"), "o trilho tem a ficha da equipe");

context.location.hash = "#/teams/azr";
context.renderTeamDetail("azr");
const paginaEquipe = appElement.innerHTML;
const topoEquipe = paginaEquipe.slice(0, paginaEquipe.indexOf("team-tabs"));
assert(topoEquipe.includes("vp-capa-fotos"), "o topo da equipe e a faixa de fotos");
assert(!paginaEquipe.includes("team-trophy-panel"), "o painel de trofeus sai do topo");
assert(/class="vp-capa-numeros"[\s\S]*Ranking/.test(topoEquipe) && !topoEquipe.includes("Na semana"), "a capa fica so com ranking e nota");
context.location.hash = "";

// ---------------------------------------------------------------- Tarefa 9
// Pagina de jogador: os quatro quadros viram uma ficha em Placa com tres
// grupos, e os paineis da rAAting 3.0 so aparecem quando tem algum valor.
const jogadorFicha = { id: "aldeath", nick: "Aldeath", handle: "zeNith#mond", teamId: "azr", rounds: 1103, matches: 53, kills: 774, deaths: 757, assists: 292, acs: 204, adr: 107, kast: 74, kd: 1.02, kpr: 0.7, dpr: 0.69, apr: 0.26, hs: 23, firstKills: 99, firstDeaths: 101, agentStats: [], mapStats: [] };
const ficha = context.fichaJogador(jogadorFicha);
assert.strictEqual((ficha.match(/class="vp-ficha-grupo"/g) || []).length, 3, "a ficha tem tres grupos");
["Geral", "Por round", "Abertura e trades"].forEach((rotulo) => assert(ficha.includes(`<small>${rotulo}</small>`), `a ficha tem o grupo ${rotulo}`));
assert(ficha.includes("vp-placa vp-ficha"), "a ficha e uma Placa");

const resumoVazio = context.playerSummaryTab(jogadorFicha, [], []);
assert(!resumoVazio.includes("Composição da rAAting 3.0"), "com a composicao toda vazia, o painel nao aparece");
assert(!resumoVazio.includes("Métricas rAAting 3.0"), "com as metricas todas vazias, o painel nao aparece");
const resumoCheio = context.playerSummaryTab({ ...jogadorFicha, kill_rating: 1.12, ekpr: 0.71 }, [], []);
assert(resumoCheio.includes("Composição da rAAting 3.0"), "com um valor de composicao, o painel aparece");
assert(resumoCheio.includes("Métricas rAAting 3.0"), "com uma metrica, o painel aparece");

// O K / D sai das linhas de jogador de cada mapa da serie, que existem mesmo
// antes de carregar o detalhe da partida (o `recent` do jogador so guarda 6).
const comJogador = (serie, linhas) => ({ ...serie, maps: serie.maps.map((mapa, i) => ({ ...mapa, players: linhas[i] ? [{ id: "outro", kills: 30, deaths: 1 }, { id: "aldeath", kills: linhas[i][0], deaths: linhas[i][1] }] : [{ id: "outro", kills: 30, deaths: 1 }] })) });
assert.deepStrictEqual(Array.from(context.kdDoJogadorNaSerie(jogadorFicha, comJogador(md3, [[20, 10], [15, 12], [9, 14]]))), [44, 36], "o K / D da serie soma os tres mapas do jogador");
assert.strictEqual(context.kdDoJogadorNaSerie(jogadorFicha, comJogador(md1, [])), null, "serie em que o jogador nao jogou nao tem K / D");

// ---------------------------------------------------------------- Tarefa 10
// Pagina de campeonato com os dados reais do TOURNAMENT_OVERRIDES: campanha de
// cada equipe na chave (W.O. conta, quem passou direto nao), chave em celulas
// com o bye vazio, participantes so em campeonato em andamento.
const overrides = vm.runInContext("TOURNAMENT_OVERRIDES", context);
const rush = { id: "rush-series-3", name: "Rush Series 3ª Edição", status: "Finalizado", ...overrides["rush-series-3"] };
const campanhas = context.campanhasDoCampeonato(rush);
assert.deepStrictEqual(Array.from(campanhas.get("ceub_octopus_vulgaris")), [8, 1], "a CEUB fez 8-1 na Rush Series 3");
assert.deepStrictEqual(Array.from(campanhas.get("azure_bears_black")), [4, 1], "a Azure Bears Black fez 4-1");
assert.deepStrictEqual(Array.from(campanhas.get("inatel_gray")), [1, 2], "o W.O. sobre a UFRJ conta para a INATEL");

// Suico sem chave curada: a pagina monta uma chave estimada com as ultimas
// series, que ja estao nas rodadas. A campanha contava essas partidas duas
// vezes (UFMT 4-3 num suico em que 3 derrotas eliminam). A chave estimada
// escreve o codigo com zeros ("Partida 045"), como o nome do arquivo.
const fdg = { id: "univava-fase-de-grupos", name: "UNIVAVÁ - Fase de Grupos", ...overrides["univava-fase-de-grupos"] };
const ultimas = fdg.swiss.rounds.flatMap((round) => round.matches).slice(-7)
  .map((match) => ({ ...match, code: `Partida ${String(context.tournamentMatchCodeNumber(match.code)).padStart(3, "0")}` }));
const comEstimada = context.campanhasDoCampeonato({ ...fdg, bracket: { regions: [{ columns: [{ matches: ultimas }] }] } });
const soSuico = context.campanhasDoCampeonato({ ...fdg, bracket: null });
assert.deepStrictEqual(Array.from(comEstimada.get("ufmt_turuna")), [3, 2], "a UFMT fez 3-2 no suico");
for (const [id, campanha] of soSuico) {
  assert.deepStrictEqual(Array.from(comEstimada.get(id)), Array.from(campanha), `a chave estimada nao soma de novo as series do suico (${id})`);
}
// Sem suico, a chave estimada conta inteira, mesmo com series sem numero (LPE).
const semNumero = context.campanhasDoCampeonato({ id: "lpe", bracket: { regions: [{ columns: [{ matches: [
  { code: "Partida LPE", a: "caap_hellhounds", b: "unifacens_fodens", scoreA: 1, scoreB: 0, winner: "caap_hellhounds" },
  { code: "Partida LPE", a: "axis_aura", b: "caap_hellhounds", scoreA: 0, scoreB: 1, winner: "caap_hellhounds" },
] }] }] } });
assert.deepStrictEqual(Array.from(semNumero.get("caap_hellhounds")), [2, 0], "as duas series sem numero contam");

// Serie sem placar com vencedor declarado (inferida pela chave na Off Season da
// LBEU 2): conta na campanha, e o card marca o vencedor e mostra o status.
const off = { id: "lbeu-2025-2-split-off-season", name: "Off Season", ...overrides["lbeu-2025-2-split-off-season"] };
const campOff = context.campanhasDoCampeonato(off);
assert.deepStrictEqual(Array.from(campOff.get("azure_bears_red")), [4, 2], "a Red fez 4-2, contando a serie sem placar contra a Overbite");
assert.deepStrictEqual(Array.from(campOff.get("fei_darkowls")), [2, 2], "a FEI fez 2-2, contando a semifinal sem placar");
const inferida = off.bracket.regions.flatMap((region) => region.columns.flatMap((column) => column.matches)).find((match) => match.code === "Partida 131");
const celulaInferida = context.tournamentChaveCelula(off, inferida, 1, 1);
const [, ladoA, ladoB] = celulaInferida.split('class="vp-bm-lado');
assert(ladoA.startsWith(" vp-ganhou") && !ladoB.startsWith(" vp-ganhou"), "o vencedor declarado aparece como vencedor");
assert(celulaInferida.includes("Placar não registrado"), "o card diz que o placar nao foi registrado");

// O resumo da mesma serie diz quem venceu e nao chama a reconstrucao de oficial.
const regiaoInferida = off.bracket.regions.find((region) => region.columns.some((column) => column.matches.includes(inferida)));
const colunaInferida = regiaoInferida.columns.find((column) => column.matches.includes(inferida));
const resumoInferido = context.tournamentMatchPreviewHtml({ event: off, region: regiaoInferida, column: colunaInferida, match: inferida, series: null });
assert(resumoInferido.includes("Vitória") && resumoInferido.includes("Derrota"), "o resumo marca vencedor e perdedor sem placar");
assert(!resumoInferido.includes("A definir"), "serie com vencedor conhecido nao fica a definir");
assert(/<small>Vencedor<\/small><strong>[^<]/.test(resumoInferido), "o resumo mostra o vencedor");
assert(!/oficial/i.test(resumoInferido), "reconstrucao nao e chamada de oficial");
assert(resumoInferido.includes("Placar não registrado"), "o resumo diz que o placar nao foi registrado");

// Serie sem mapas com estatistica mostra a data do jogo, nao a janela do campeonato.
const jubsInicial = { id: "jubs-fase-inicial", name: "JUBS", ...overrides["jubs-fase-inicial"] };
const serie18 = jubsInicial.swiss.rounds.flatMap((rodada) => rodada.matches).find((match) => match.code === "Partida 18");
const resumo18 = context.tournamentMatchPreviewHtml({ event: jubsInicial, region: { name: "Bracket" }, column: { title: "Rodada 1" }, match: serie18, series: null });
assert(resumo18.includes("06 de jun de 2026"), "o resumo mostra o dia em que a serie foi jogada");

// Quando so se sabe o dia do jogo, o resumo mostra o dia, sem inventar horario.
const finalAlianca = overrides["copa-alianca-2025-playoffs"].bracket.regions.flatMap((region) => region.columns.flatMap((column) => column.matches)).find((match) => match.code === "Partida 7");
const resumoFinal = context.tournamentMatchPreviewHtml({ event: { id: "copa-alianca-2025-playoffs", ...overrides["copa-alianca-2025-playoffs"] }, region: { name: "Playoffs" }, column: { title: "Final" }, match: finalAlianca, series: null });
assert(/<small>Data<\/small><strong>04 de out de 2025<\/strong>/.test(resumoFinal), "a final mostra so o dia em que foi jogada");

// Serie com mapa sem estatistica mostra o placar da chave, nao so os mapas que sobraram.
for (const [eventId, seriesCode, vencedor, perdedor, esperado] of [
  ["jubs-fase-inicial", "045", "milionaria_ufam", "ufcg_pensaopet", [2, 1]],
  ["jubs-fase-inicial", "099", "furia_utfpr", "unisc_ladaiada", [2, 0]],
  ["copa-luce-inters", "006", "sheriff_iff", "minerva_artemis", [2, 0]],
  ["univava-fase-de-grupos", "024", "usp_stars", "furia_utfpr", [2, 0]],
]) {
  const placar = context.seriesMapScore([{ eventId, seriesCode, winnerId: vencedor }], vencedor, perdedor);
  assert.deepStrictEqual([placar.a, placar.b], esperado, `a pagina da serie ${seriesCode} de ${eventId} usa o placar da chave`);
}

// Card sem serie nao pode divergir do arquivo do mapa.
const kickoff = overrides["uni-kickoff-inters"].bracket.regions.flatMap((region) => region.columns.flatMap((column) => column.matches)).find((match) => match.code === "Partida 40");
assert.deepStrictEqual([kickoff.scoreA, kickoff.scoreB], [13, 6], "a Partida 40 do Kick-Off tem o placar do arquivo");

// Gravacao com repeticao: a falha passageira do Windows nao derruba o build.
const { writeFileWithRetry } = require("./write_with_retry.js");
const arquivoTeste = path.join(require("os").tmpdir(), `univlr-gravacao-${process.pid}.txt`);
const gravacaoReal = fs.writeFileSync;
let tentativasGravacao = 0;
fs.writeFileSync = (...args) => {
  tentativasGravacao += 1;
  if (tentativasGravacao < 3) throw Object.assign(new Error("UNKNOWN: unknown error, open"), { code: "UNKNOWN" });
  return gravacaoReal(...args);
};
try {
  writeFileWithRetry(arquivoTeste, "ok");
  assert.strictEqual(tentativasGravacao, 3, "tenta de novo depois da falha passageira");
  fs.writeFileSync = () => {
    throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
  };
  assert.throws(() => writeFileWithRetry(arquivoTeste, "ok"), /ENOSPC/, "erro de verdade nao fica repetindo");
} finally {
  fs.writeFileSync = gravacaoReal;
  fs.rmSync(arquivoTeste, { force: true });
}

// Texto publico nao cita arquivo, fonte ou bastidor (regra do dono, 24/10/2026).
const notasPublicas = [];
(function coletarNotas(valor, chaveDoPai) {
  if (!valor || typeof valor !== "object") return;
  for (const [chave, item] of Object.entries(valor)) {
    if (typeof item === "string" && (["previewNote", "note", "status"].includes(chave) || chaveDoPai === "details")) notasPublicas.push(item);
    else coletarNotas(item, chave);
  }
})(overrides);
assert(notasPublicas.length > 0, "a varredura encontrou notas");
const notasDeBastidor = notasPublicas.filter((nota) => /arquivo|respons[aá]vel|\bfonte\b|mapa\(s\)|excluído\(s\)|excel|planilha|tracker|challengermode|faceit|battlefy/i.test(nota));
assert.deepStrictEqual(notasDeBastidor, [], "as notas falam de partida, nao de bastidor");

const superior = rush.bracket.regions.find((region) => region.className === "upper-bracket");
const chave = context.tournamentCuratedBracketRegion(rush, superior);
const rodada32 = chave.split(/<div class="vp-rodada(?=["\s])/)[1] || "";
const celulas = rodada32.match(/<div class="vp-celula[^"]*"[^>]*>[\s\S]*?<\/div>/g) || [];
assert.strictEqual(celulas.length, 16, "a rodada de 32 tem 16 celulas");
const byes = celulas.filter((celula) => celula.includes("vp-bye"));
assert.strictEqual(byes.length, 11, "11 delas sao bye");
assert(byes.every((celula) => !celula.includes("<button") && !celula.includes("Sem adversário")), "bye e celula vazia, sem partida dentro");
assert(chave.includes('data-tournament-match="0-1-partida-2"'), "a partida da chave continua abrindo a previa pela mesma chave de antes");

// A fase da aba Jogos nao repete o que a coluna ja diz.
assert.strictEqual(context.tournamentJogoFase({ name: "Grupo A" }, { title: "Opening" }, false), "Grupo A - Opening");
assert.strictEqual(context.tournamentJogoFase({ name: "Chave superior" }, { title: "Rodada de 32 superior" }, false), "Rodada de 32 superior");
assert.strictEqual(context.tournamentJogoFase({ name: "Chave superior" }, { title: "Chave superior - Rodada 1" }, false), "Chave superior - Rodada 1");
assert.strictEqual(context.tournamentJogoFase({ name: "Chave principal" }, { title: "Semifinais" }, false), "Semifinais");
assert.strictEqual(context.tournamentJogoFase({ name: "Disputa terceiro lugar" }, { title: "3º lugar" }, false), "3º lugar");
assert.strictEqual(context.tournamentJogoFase({ name: "Final" }, { title: "Final" }, false), "Final");
const fasesEmOrdem = context.tournamentJogosPorFase([
  { fase: "Semifinais", ordem: 0, quando: 10 },
  { fase: "Final", ordem: 1, quando: 0 },
  { fase: "Quartas", ordem: -2, quando: 5 },
]).map((grupo) => grupo.titulo);
assert.deepStrictEqual(JSON.parse(JSON.stringify(fasesEmOrdem)), ["Final", "Semifinais", "Quartas"], "fase sem data fica logo acima da fase anterior da chave");
const rodadasEmOrdem = context.tournamentJogosPorFase([
  { trilha: "rodadas", fase: "Rodada 6", ordem: 5, quando: 14 },
  { trilha: "rodadas", fase: "Rodada 7", ordem: 6, quando: 13 },
]).map((grupo) => grupo.titulo);
assert.deepStrictEqual(JSON.parse(JSON.stringify(rodadasEmOrdem)), ["Rodada 7", "Rodada 6"], "jogo remarcado nao inverte as rodadas");
const finalPorJogar = context.tournamentJogosPorFase([
  { trilha: 0, fase: "Quartas de final", ordem: 0, quando: 5 },
  { trilha: 0, fase: "Semifinais", ordem: 1, quando: 9 },
  { trilha: 1, fase: "Final", ordem: 2, quando: 0 },
]).map((grupo) => grupo.titulo);
assert.deepStrictEqual(JSON.parse(JSON.stringify(finalPorJogar)), ["Final", "Semifinais", "Quartas de final"], "final por jogar, em regiao propria, vai para o topo");
const chaveDupla = context.tournamentJogosPorFase([
  { trilha: 0, fase: "Superior 1", ordem: 0, quando: 1 },
  { trilha: 0, fase: "Superior 2", ordem: 1, quando: 3 },
  { trilha: 1, fase: "Inferior 1", ordem: 2, quando: 2 },
]).map((grupo) => grupo.titulo);
assert.deepStrictEqual(JSON.parse(JSON.stringify(chaveDupla)), ["Superior 2", "Inferior 1", "Superior 1"], "controle: trilhas diferentes intercalam pela data");

const visaoGeral = (evento) => context.tournamentTabContent(evento, [], [], "overview");
const andamento = visaoGeral({ ...rush, status: "Em andamento" });
assert(andamento.includes("Equipes Participantes"), "campeonato em andamento mostra a lista de participantes");
const encerrado = visaoGeral(rush);
assert(encerrado.includes("Equipes Participantes"), "encerrado tambem mostra quem jogou");
assert(encerrado.includes("vp-eq-grade") && encerrado.includes("data-tournament-team="), "as equipes sao quadrados que abrem o menu");
assert(encerrado.includes("Colocação") && encerrado.includes("vp-colocacao"), "a colocacao substitui o podio e a classificacao final");
assert(encerrado.includes('class="vp-col-equipe"'), "cada equipe e uma linha da colocacao");
assert(encerrado.includes(">8-1<"), "a colocacao traz a campanha de cada equipe");
assert(!encerrado.includes("Classificação final"), "a classificacao final nao aparece duas vezes");

// Rodada de 24/10: o Resumo (equipes, series, dias) saiu de todo campeonato.
assert(!encerrado.includes("vp-resumo-camp") && !encerrado.includes(">Resumo<"), "o campeonato nao tem mais o Resumo");
// Campeonato em andamento com as semis jogadas (UNIVAVA, 24/10): os eliminados
// nas semis ja sao 3o-4o, e o 1o e o 2o seguem em aberto ate a final.
const playoffsEmAndamento = { id: "teste-playoffs", name: "Playoffs", status: "Em andamento", placements: [{ range: "3-4", id: "azr", note: "Semifinal" }, { range: "3-4", id: "ceub", note: "Semifinal" }, { range: "5-8", id: "mack", note: "Quartas de final" }] };
// JSON ida e volta: o array nasce no contexto do vm, com outro prototipo.
const doVm = (valor) => JSON.parse(JSON.stringify(valor));
const podioDasSemis = context.tournamentPodiumRows(playoffsEmAndamento, [], []);
assert.deepStrictEqual(doVm(podioDasSemis.map((row) => [row.range, row.team?.id])), [["3-4", "azr"], ["3-4", "ceub"]], "quem caiu na semi entra no podio como 3o-4o");
const podioComVagas = context.tournamentPodiumDisplayRows(playoffsEmAndamento, podioDasSemis);
assert.deepStrictEqual(doVm(podioComVagas.map((row) => [row.range, row.team?.id ?? null])), [["1", null], ["2", null], ["3-4", "azr"], ["3-4", "ceub"]], "1o e 2o ficam em aberto acima dos 3o-4o");
const semNada = context.tournamentPodiumDisplayRows(playoffsEmAndamento, []);
assert.deepStrictEqual(doVm(semNada.map((row) => row.range)), ["1", "2", "3"], "controle: sem colocacao nenhuma, as tres vagas de sempre");
const encerradoComPodio = [{ range: "1", team: { id: "azr" } }, { range: "2", team: { id: "ceub" } }, { range: "3-4", team: { id: "mack" } }];
assert.deepStrictEqual(doVm(context.tournamentPodiumDisplayRows({ status: "Finalizado" }, encerradoComPodio).map((row) => row.range)), ["1", "2", "3-4"], "controle: campeonato encerrado nao ganha vaga em aberto");
assert.strictEqual(context.tournamentPlacementPodiumClass("34th"), "", "o 34o lugar nao e 3o-4o");
assert.strictEqual(context.tournamentPlacementPodiumClass("3-4th"), "place-3", "controle: 3-4th continua sendo o podio");
assert.deepStrictEqual(doVm(context.tournamentColocacaoGrupos(playoffsEmAndamento, [], []).map((grupo) => [grupo.rotulo, grupo.equipes.length])), [["1º", 1], ["2º", 1], ["3º-4º", 2], ["5º-8º", 1]], "quem divide a posicao fica no mesmo grupo, depois das vagas em aberto");

const luce = { id: "copa-luce-inters", name: "Copa LUCE Inters", status: "Finalizado", ...overrides["copa-luce-inters"] };
assert(context.tournamentSwissStandingsSection(luce).includes("vp-tabela-linha"), "o suico continua mostrando a tabela");

// Revisao final: o ajuste que encolhe nome longo de equipe para caber em duas
// linhas tem de mirar o titulo do topo novo, senao o nome passa da faixa de
// 196px e e cortado.
assert(/function ajustaTituloDaEquipe\(\) \{\s*const titulo = document\.querySelector\("[^"]*\.vp-equipe-id h1"\)/.test(ler("app.js")), "o ajuste do titulo da equipe mira o h1 do topo novo");

// ---------------------------------------------------------------- Tarefa 11
// Fechamento: titulo de painel sem o traco vermelho, nenhuma caixa em volta
// das listas, e travessao em lugar nenhum (a regra do projeto e hifen).
const fonteDoApp = ler("app.js");
assert(!/class="panel-title/.test(fonteDoApp), "nenhum template emite panel-title");
assert(!/class="hub-panel/.test(fonteDoApp), "nenhuma lista fica dentro de um hub-panel");
for (const arquivo of ["app.js", "placar.css", "news.js", "index.html"]) {
  assert.strictEqual((ler(arquivo).match(new RegExp(String.fromCharCode(0x2014), "g")) || []).length, 0, `${arquivo} nao tem travessao`);
}

// Ranking, rodada de 24/10: a nota fica um numero solto mesmo com os detalhes
// ligados, e o painel "Detalhes do ranking" segue a Placa: sem anel, sem
// cartoes em caixa, barras na cor da equipe e a nota como soma das partes.
const estiloDoRanking = ler("placar.css");
assert(/\.ranking-accordion\[data-details-visible="true"\] \.ranking-score-cell\s*\{[^}]*background:\s*none/.test(estiloDoRanking), "com os detalhes ligados, a nota continua sem a pilula verde");
const rankingFake = {
  score: 99.9,
  matches: 48,
  blocks: { competitive: 100, achievements: 100, recentForm: 100, rosterStrength: 98.8 },
  components: { statisticalModels: 100, strengthOfSchedule: 100, dominance: 100 },
  sos: { general: 79, wins: 78.8 },
  recent: { matches: 14, adjustedPerformance: 100, dominance: 75.9 },
  roster: { individualRating: 100, coreStability: 100, depth: 88.5 },
  models: { colley: 100, massey: 100 },
  achievements: [],
};
const detalhes = context.rankingExplanationPanel({ id: "azr", name: "Azure Bears Black" }, rankingFake);
assert(detalhes.includes('class="vp-rk-detalhes"'), "o painel e o desenho novo");
assert(/--team-line:#[0-9a-f]{6}/i.test(detalhes), "as barras usam a cor da equipe");
for (const velho of ["ranking-score-ring", "ranking-formula-chips", "ranking-mini-card", "ranking-weight-bar"]) {
  assert(!detalhes.includes(velho), `o painel nao usa mais ${velho}`);
}
assert(!/#f6132a|var\(--brand\)/i.test(detalhes), "nada de vermelho de marca no painel");
const fatias = (detalhes.split('class="vp-rk-soma"')[1] || "").split("</div>")[0].match(/style="--w:[\d.]+%"/g) || [];
assert.strictEqual(fatias.length, 4, "a nota e uma barra so, com a parte de cada bloco");
assert.deepStrictEqual(fatias.map((f) => Number(f.match(/[\d.]+/)[0])), [70, 15, 10, 4.94], "cada parte e valor x peso");
assert(detalhes.includes("100.0 × 70% = 70.0"), "a conta de cada bloco continua escrita");
// O numero grande do painel tem classe propria: em 24/10 ele usou .vp-rk-nota,
// que e a nota do ranking da home, e a home herdou os 56px.
assert(detalhes.includes('<b class="vp-rk-nota-final">99.9</b>'), "a nota do painel tem classe propria");
assert.strictEqual((estiloDoRanking.match(/^\.vp-rk-nota \{/gm) || []).length, 1, "so a nota da home define .vp-rk-nota");
// Com "Detalhes da nota" ligado em tela estreita, os quatro blocos descem para
// uma segunda linha, e cada numero precisa do proprio rotulo.
for (const rotulo of ["Desempenho", "Conquistas", "Forma", "rAAting 3.0"]) {
  assert(ler("app.js").includes(`<span class="numeric optional ranking-detail-cell" data-label="${rotulo}">`), `a celula de ${rotulo} leva o rotulo`);
}
assert(/@media \(max-width: 1180px\)\s*\{[^@]*data-details-visible="true"\][^{]*\.ranking-detail-cell::before/.test(estiloDoRanking), "o rotulo aparece na segunda linha em tela estreita");

// Conta emprestada entra nas contas de quem jogou nela, mas o perfil do dono da
// conta continua dele: o id exato vem antes da busca por conta.
vm.runInContext(
  `state.db.players = ${JSON.stringify([
    { id: "pega-emprestado", puuid: "pega-emprestado", nick: "JV", routeSlug: "jv", accounts: [{ puuid: "pega-emprestado" }, { puuid: "dono-da-conta" }, { puuid: "conta-paralela" }] },
    { id: "dono-da-conta", puuid: "dono-da-conta", nick: "aham", routeSlug: "aham", accounts: [{ puuid: "dono-da-conta" }] },
  ])};`,
  context
);
assert.strictEqual(context.playerById("dono-da-conta").nick, "aham", "o id do dono abre o perfil do dono");
assert.strictEqual(context.playerHref("dono-da-conta"), "#/players/aham", "o link do dono nao vai para quem pegou a conta");
assert.strictEqual(context.playerById("aham").nick, "aham", "a rota pelo nome continua abrindo o perfil");
assert.strictEqual(context.playerById("conta-paralela").nick, "JV", "a conta alternativa continua levando ao jogador");

// Formato compacto do banco: mesmas chaves viram uma forma so, e referencia
// compartilhada, undefined e numero sem JSON voltam iguais. O formato anterior
// continua legivel.
const codec = require("../db-codec.js");
const compartilhado = { nome: "x" };
const grafo = { a: compartilhado, b: compartilhado, lista: [[1], []], vazio: undefined, nan: NaN, data: new Date(5), mapa: new Map([[1, compartilhado]]), conjunto: new Set([2]) };
grafo.ciclo = grafo;
const codificado = JSON.parse(JSON.stringify(codec.encode({ c: [{ x: 1, y: 2 }, { x: 3, y: 4 }], grafo })));
assert.strictEqual(codificado.shapes.filter((chaves) => chaves.join() === "x,y").length, 1, "objetos iguais dividem a mesma forma");
const decodificado = codec.decode(codificado);
assert.deepStrictEqual(decodificado.c, [{ x: 1, y: 2 }, { x: 3, y: 4 }], "os valores voltam nas chaves certas");
assert.strictEqual(decodificado.grafo.a, decodificado.grafo.b, "a referencia compartilhada continua uma so");
assert.strictEqual(decodificado.grafo.ciclo, decodificado.grafo, "ciclo sobrevive");
assert(Number.isNaN(decodificado.grafo.nan) && "vazio" in decodificado.grafo && decodificado.grafo.vazio === undefined, "valores sem JSON voltam");
assert.deepStrictEqual(decodificado.grafo.lista, [[1], []], "array de dado nao vira marcador");
assert.strictEqual(decodificado.grafo.mapa.get(1), decodificado.grafo.a, "Map guarda a referencia");
assert.strictEqual(codec.decode({ format: "univlr-db@1", root: { $: "r", i: 0 }, nodes: [{ $: "o", v: { a: 1 } }] }).a, 1, "formato anterior continua legivel");

// Texto publico sem acento e tabela de estatisticas sem rolagem lateral.
assert(!/["`>]Concluida|Sistema suico|Estado nao informado/.test(fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8")), "texto publico com acento");
assert(/@media \(max-width: 1180px\)[\s\S]*\.tournament-stats-table[\s\S]*attr\(data-label\)/.test(fs.readFileSync(path.join(__dirname, "..", "placar.css"), "utf8")), "tabela de estatisticas vira blocos na tela estreita");

// Ranking, 01/11: a lista nas duas primeiras colunas da home e o trilho na
// terceira, com a nota colada na equipe e a lineup depois dela.
assert(/\.vp-ranking\.com-resumo \{[^}]*minmax\(0, 922px\) 340px/.test(estiloDoRanking), "com o resumo aberto, lista e trilho somam a largura da home");
assert(/\.vp-ranking \{[^}]*minmax\(0, 922px\) 0px/.test(estiloDoRanking), "o resumo nasce fechado, com a lista centralizada");
assert(/\.vp-ranking \.rank-change-cell\.down \{[^}]*var\(--muted\)/.test(estiloDoRanking), "cair nao e vermelho, como na home");
const fonteDoRanking = ler("app.js");
assert(fonteDoRanking.indexOf('class="numeric ranking-score-cell"') < fonteDoRanking.indexOf('class="ranking-lineup-inline optional"'), "a nota vem antes da lineup");
assert.strictEqual(context.alturaNoGrafico(1), 5, "o primeiro lugar fica no topo do grafico");
assert.strictEqual(context.alturaNoGrafico(8), 95, "o oitavo fica no fundo do grafico");
assert(context.alturaNoGrafico(9) > 100, "abaixo do oitavo a linha sai do grafico");
assert.strictEqual(context.curvaDaEquipe([1, 8]), "M0.00 5.00C50.00 5.00 50.00 95.00 100.00 95.00", "a curva sai e chega na horizontal");
assert.strictEqual((context.curvaDaEquipe([1, null, 2]).match(/M/g) || []).length, 2, "semana fora do ranking interrompe a linha");

void vp;
console.log("Visual Placar contract tests passed");
