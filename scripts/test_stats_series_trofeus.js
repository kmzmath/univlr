// Recordes numa serie e aba Trofeus de Estatisticas (16/11/2026).
// Desenho em docs/superpowers/specs/2026-11-16-recordes-por-serie-e-trofeus-design.md.
// Carrega o app.js num contexto vm com o DOM em stub, como o test_visual_placar.js.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const noop = () => {};
const stub = {
  innerHTML: "", value: "", style: {}, dataset: {},
  addEventListener: noop, removeEventListener: noop, setAttribute: noop, appendChild: noop, focus: noop,
  querySelector: () => null, querySelectorAll: () => [],
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
};
const context = {
  console, Date, Intl, JSON, Map, Math, Number, Promise, Set, String, URLSearchParams,
  clearInterval: noop, clearTimeout: noop, setInterval: () => 0, setTimeout: () => 0,
};
context.globalThis = context;
context.window = context;
const appElement = { ...stub };
context.document = {
  title: "", body: stub, documentElement: stub,
  getElementById: (id) => (id === "app" ? appElement : stub),
  querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ ...stub }),
  addEventListener: noop, removeEventListener: noop,
};
context.location = { hash: "" };
context.history = { pushState: noop, replaceState: noop };
context.requestAnimationFrame = () => 0;
context.fetch = () => new Promise(noop);
vm.createContext(context);
// A soma dos jogadores fecha o rAAting pelo nucleo, que o index.html carrega antes.
vm.runInContext(fs.readFileSync(path.join(raiz, "raating-core.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(raiz, "app.js"), "utf8"), context);
const rodar = (codigo) => vm.runInContext(codigo, context);
// Array do contexto vm tem outro prototipo: compara pelo valor.
const valor = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- Recordes numa serie
const jogador = (id, kills, rounds = 13) => ({
  id, nick: id.toUpperCase(), teamId: "t1", kills, deaths: 10, assists: 3, rounds,
  score: rounds * 200, damage: rounds * 150, firstKills: 2, firstDeaths: 1, kastRounds: 9,
  impactTotal: 0, headshots: 0, bodyshots: 0, legshots: 0, fourKills: 1, fiveKills: 0,
});
const linha = (serie, numero, player, quando) => ({
  series: { id: serie, eventId: "e1" },
  match: { id: `${serie}-${numero}`, mapName: `Mapa ${numero}` },
  quando,
  player,
});
const linhas = [
  linha("s1", 1, jogador("p1", 40), 1),
  linha("s3", 1, jogador("p1", 20), 2),
  linha("s3", 2, jogador("p1", 25), 3),
  linha("s3", 3, jogador("p1", 30), 4),
  linha("s3", 1, jogador("p2", 10), 2),
  linha("s3", 2, jogador("p2", 12), 3),
];
const series = context.statsSeriesDe(linhas);
assert.strictEqual(series.length, 2, "uma atuacao por jogador em cada serie de 2 mapas ou mais; a MD1 fica fora");
const p1 = series.find((item) => item.player.id === "p1");
assert(p1, "o id do jogador volta depois da soma");
assert.strictEqual(p1.player.kills, 75, "abates somados nos tres mapas");
assert.strictEqual(p1.player.fourKills, 3, "4K somados");
assert.strictEqual(p1.linhas.length, 3, "as linhas dos mapas acompanham a atuacao");
assert.strictEqual(p1.series.id, "s3", "a serie acompanha a atuacao");
assert.strictEqual(p1.quando, 4, "a data e a do ultimo mapa");
assert.strictEqual(series.find((item) => item.player.id === "p2").player.kills, 22, "cada jogador soma so os proprios mapas");

// Modo serie: filtros de um mapa so nao entram.
const filtrosDaSerie = rodar("STATS_FILTROS_DA_PAGINA.series");
["mapa", "agente", "funcao", "patch", "rounds", "mapas"].forEach((chave) => assert(!filtrosDaSerie.includes(chave), `${chave} nao vale numa serie`));
["ano", "de", "ate", "evento", "tier", "formato", "top", "equipe", "atual"].forEach((chave) => assert(filtrosDaSerie.includes(chave), `${chave} vale numa serie`));

// ---------------------------------------------------------------- Medalhas
rodar(`state.db = {
  teams: [{ id: "A", name: "Alfa" }, { id: "B", name: "Beta" }, { id: "C", name: "Gama" }, { id: "D", name: "Delta" }],
  players: [
    { id: "p1", nick: "Um", matches: 10 },
    { id: "p2", nick: "Dois", matches: 10 },
    { id: "p3", nick: "Tres", matches: 10 },
    { id: "p4", nick: "Quatro", matches: 10 },
  ],
  tournaments: [], matches: [], matchSeries: [],
};`);
// Colocacao no formato do banco: `range` "1", "2", "3-4".
const evento = (id, fim, placements, extra = {}) => ({ id, name: `Copa ${id}`, status: "Finalizado", end: fim, tier: "S", placements, ...extra });
const eventos = [
  evento("e1", Date.UTC(2025, 5, 1), [{ id: "A", range: "1" }, { id: "B", range: "2" }, { id: "C", range: "3-4" }, { id: "D", range: "3-4" }, { id: "X", range: "5-8" }]),
  evento("e2", Date.UTC(2026, 5, 1), [{ id: "B", range: "1" }, { id: "Z", range: "2" }], { mvp: "p2" }),
  evento("e3", Date.UTC(2026, 6, 1), [{ id: "A", range: "1" }], { status: "Em andamento" }),
];
const trofeus = context.medalhasDasEquipes(eventos);
assert.strictEqual(trofeus.get("e1|A").placement, 1, "campeao vira ouro");
assert.strictEqual(trofeus.get("e1|C").trophyKey, "third", "3o/4o vira bronze");
assert.strictEqual(trofeus.get("e1|D").trophyKey, "third", "os dois do 3o/4o levam bronze");
assert(!trofeus.has("e2|Z"), "equipe sem cadastro nao da medalha, como no perfil");
assert(!trofeus.has("e3|A"), "campeonato em andamento nao da medalha");

const mapa = (time, jogadores) => ({ teamA: { id: time, color: "Blue" }, teamB: { id: "X", color: "Red" }, players: jogadores.map((id) => ({ id, teamColor: "Blue" })) });
const seriesDoBanco = [
  // p1 joga o e1 por A em duas series e por B em uma: a medalha e so a de A.
  { id: "s1", eventId: "e1", maps: [mapa("A", ["p1", "p2"])] },
  { id: "s2", eventId: "e1", maps: [mapa("A", ["p1", "p2"]), mapa("A", ["p1", "p2"])] },
  { id: "s3", eventId: "e1", maps: [mapa("B", ["p1", "p3"])] },
  { id: "s4", eventId: "e1", maps: [mapa("C", ["p4"])] },
  { id: "s5", eventId: "e2", maps: [mapa("B", ["p3"])] },
];
const porJogador = context.medalhasDosJogadores(seriesDoBanco, trofeus);
assert.deepStrictEqual(valor(porJogador.get("p1").map((t) => `${t.event.id}:${t.placement}:${t.teamId}`)), ["e1:1:A"], "medalha so pela equipe com mais series no campeonato");
assert.deepStrictEqual(valor(porJogador.get("p3").map((t) => `${t.event.id}:${t.placement}`)), ["e2:1", "e1:2"], "mais recente primeiro");
assert(!porJogador.get("p2").some((t) => t.trophyKey === "mvp"), "MVP nao entra no quadro");

const quadro = context.medalhasQuadro(porJogador, {});
assert.deepStrictEqual(valor(quadro.map((l) => [l.player.nick, l.ouro.length, l.prata.length, l.bronze.length, l.total])), [
  ["Tres", 1, 1, 0, 2],
  ["Dois", 1, 0, 0, 1],
  ["Um", 1, 0, 0, 1],
  ["Quatro", 0, 0, 1, 1],
], "ordem olimpica: ouro, depois prata, depois bronze, empate em ordem alfabetica");
assert.deepStrictEqual(valor(quadro.map((_, i) => context.medalhasPosicao(quadro, i))), [1, 2, 2, 4], "empate divide a posicao");
assert.deepStrictEqual(valor(context.medalhasQuadro(porJogador, { ano: "2026" }).map((l) => l.player.nick)), ["Tres"], "o ano e o do fim do campeonato");
assert.deepStrictEqual(valor(context.medalhasQuadro(porJogador, { equipe: "C" }).map((l) => l.player.nick)), ["Quatro"], "a equipe e a da medalha");

// ---------------------------------------------------------------- Aba Trofeus
assert(rodar("STATS_ABAS").includes("trofeus") && rodar("STATS_ABA_ROTULOS.trofeus") === "Troféus", "aba Troféus em Estatísticas > Jogadores");
assert.strictEqual(rodar("STATS_ABAS").indexOf("trofeus"), rodar("STATS_ABAS").indexOf("recordes") + 1, "depois de Recordes");
rodar(`state.db.players[2].teamId = "B"; state.db.players[2].currentTeam = "B";`);
const tres = quadro[0];
const html = context.medalhasLinha(tres, 1);
const logo = html.indexOf("team-logo");
const foto = html.indexOf("player-figure");
const nick = html.indexOf(">Tres<");
assert(logo > -1 && foto > logo && nick > foto, "a foto vem entre a logo da equipe e o nick");
assert(html.includes("is-silhouette"), "sem foto, a silhueta");
["ouro", "prata", "bronze"].forEach((cor) => assert(html.includes(`vp-st-tr-medalha ${cor}`), `coluna ${cor}`));
assert(/data-rotulo="Ouro"[^>]*>[\s\S]*?<b class="vp-st-tr-n">1<\/b>/.test(html), "o numero de ouros na coluna Ouro");
assert(html.includes('href="#/events/e2"') && html.includes('title="Campeão, Copa e2"'), "a taça leva ao campeonato e tem o nome na dica");
assert(html.includes('title="Vice-campeão, Copa e1"'), "a prata tambem");
assert(/class="vp-st-tr-total"[^>]*>2</.test(html), "o total");
assert(!/—/.test(html), "nunca travessao");

console.log("Recordes numa serie e Trofeus: testes passaram");
