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
const linhasDeEquipe = (rowHtml) => rowHtml.split('<span class="vp-t').slice(1).map((pedaco) => pedaco.split('<span class="vp-t')[0].split('class="vp-maplist"')[0]);

const linhaMd3 = context.matchResultRow(md3);
assert(linhaMd3.startsWith('\n    <a class="vp-m"') || linhaMd3.includes('<a class="vp-m"'), "a partida vira uma vp-m");
const equipesMd3 = linhasDeEquipe(linhaMd3);
assert.strictEqual(equipesMd3.length, 2, "duas linhas de equipe por partida");
assert.strictEqual(equipesMd3.filter((l) => l.startsWith(" vp-ganhou")).length, 1, "so uma das duas e a vencedora");
assert(equipesMd3.find((l) => l.startsWith(" vp-ganhou")).includes("CEUB Octopus Vulgaris"), "a vencedora da MD3 e a CEUB");
assert(linhaMd3.includes("Bind <small>13-8</small>"), "em serie de varios mapas, cada mapa mostra o proprio placar");
assert(linhaMd3.includes('data-fallback="assets/maps/bind.png"') && linhaMd3.includes('onerror="mapArtError(this)"'), "a arte cai no PNG de reserva e depois some");
for (const linha of equipesMd3) assert(/--team-line:#[0-9a-f]{6}/i.test(linha), "toda linha de equipe leva a --team-line");

const linhaMd1 = context.matchResultRow(md1);
assert(linhaMd1.includes("<b>6</b>") && linhaMd1.includes("<b>13</b>"), "MD1 mostra o placar de rounds");
const listaMd1 = linhaMd1.split('class="vp-maplist"')[1].split("</span>\n")[0];
assert(listaMd1.includes("Lotus") && !listaMd1.includes("<small>"), "MD1 mostra so o nome do mapa");
const corBranca = linhasDeEquipe(linhaMd1)[0].match(/--team-line:(#[0-9a-f]{6})/i)[1].toLowerCase();
assert.notStrictEqual(corBranca, "#ffffff", "equipe toda branca nao vira risco branco puro");
assert(context.matchResultRow(md1, { kd: [71, 41] }).includes("71 / 41"), "a coluna de K/D aparece quando pedida");
assert(!linhaMd1.includes("vp-kd"), "sem K/D pedido, sem a coluna");

const semArte = serie("k-novo", "azr", "Azure Bears Black", "ceub", "CEUB Octopus Vulgaris", 0, 1, [mapaDaSerie("azr", "ceub", "novo", "Mapa Novo", 1, 9, 13)]);
const linhaSemArte = context.matchResultRow(semArte);
assert(!linhaSemArte.includes("vp-mapas"), "sem nenhuma arte, a faixa de mapas nao entra");
assert(linhaSemArte.includes("Mapa Novo"), "o nome do mapa continua por cima");

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

void vp;
console.log("Visual Placar contract tests passed");
