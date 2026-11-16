// Ordenacao por clique (16/11/2026, pedido do dono):
// 1) Agentes por mapa (campeonato, equipe e jogador): clicar no mapa ordena os
//    agentes pela taxa daquele mapa; clicar no agente ordena os mapas pela taxa
//    daquele agente. Clicar de novo no ativo, ou em "Todos", volta a popularidade.
// 2) Tabela Equipes da aba Carreira do jogador: o cabecalho ordena como as tabelas
//    de estatistica; sem clique, a ordem de antes (atual primeiro, mais recente).
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
context.document = {
  title: "", body: stub, documentElement: stub,
  getElementById: () => ({ ...stub }), querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ ...stub }),
  addEventListener: noop, removeEventListener: noop,
};
context.location = { hash: "" };
context.history = { pushState: noop, replaceState: noop };
context.requestAnimationFrame = () => 0;
context.fetch = () => new Promise(noop);
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(raiz, "raating-core.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(raiz, "app.js"), "utf8"), context);
const rodar = (codigo) => vm.runInContext(codigo, context);
const valor = (x) => JSON.parse(JSON.stringify(x));
rodar(`state.db = { teams: [{ id: "A", name: "Alfa" }, { id: "B", name: "Beta" }, { id: "C", name: "Gama" }], players: [], tournaments: [], matches: [], matchSeries: [], maps: [] };`);

// ---------------------------------------------------------------- Agentes por mapa
const taxas = (pares) => new Map(Object.entries(pares).map(([key, rate]) => [key, { key, slug: key, name: key.toUpperCase(), rate, picks: rate }]));
const linha = (id, pares) => ({ id, name: id[0].toUpperCase() + id.slice(1), matches: 4, sideRounds: 0, attackWins: 0, defenseWins: 0, totalPicks: 0, pickOpportunities: 4, agents: taxas(pares), agentRates: taxas(pares), mapa: { id, name: id } });
const linhas = [linha("bind", { a: 10, b: 50, c: 0 }), linha("ascent", { a: 60, b: 5, c: 30 })];
const colunas = [{ key: "a", name: "A" }, { key: "b", name: "B" }, { key: "c", name: "C" }];
const ordena = (ordem) => {
  const r = context.mapaAgenteOrdena(linhas, colunas, ordem);
  return valor({ mapas: r.rows.map((row) => row.id), agentes: r.agentColumns.map((agent) => agent.key) });
};
assert.deepStrictEqual(ordena({}), { mapas: ["bind", "ascent"], agentes: ["a", "b", "c"] }, "sem clique, a ordem de antes");
assert.deepStrictEqual(ordena({ mapa: "bind" }).agentes, ["b", "a", "c"], "clicar no mapa ordena os agentes pela taxa nele");
assert.deepStrictEqual(ordena({ mapa: "ascent" }).agentes, ["a", "c", "b"], "outro mapa, outra ordem");
assert.deepStrictEqual(ordena({ agente: "c" }).mapas, ["ascent", "bind"], "clicar no agente ordena os mapas pela taxa dele");
assert.deepStrictEqual(ordena({ agente: "b" }).mapas, ["bind", "ascent"], "outro agente, outra ordem");
assert.deepStrictEqual(ordena({ mapa: "bind", agente: "c" }), { mapas: ["ascent", "bind"], agentes: ["b", "a", "c"] }, "os dois sentidos ao mesmo tempo");
assert.deepStrictEqual(ordena({ mapa: "split", agente: "z" }), { mapas: ["bind", "ascent"], agentes: ["a", "b", "c"] }, "mapa ou agente que nao esta na tabela nao muda nada");

rodar(`state.mapaAgenteOrdem = { mapa: "bind", agente: "" };`);
const tabela = context.tournamentMapAgentPickrateTable(linhas, colunas);
assert(/data-ma-mapa="bind"[^>]*aria-pressed="true"/.test(tabela), "o mapa escolhido fica marcado");
assert(/data-ma-mapa="ascent"[^>]*aria-pressed="false"/.test(tabela), "os outros nao");
["a", "b", "c"].forEach((key) => assert(tabela.includes(`data-ma-agente="${key}"`), `o agente ${key} e um botao`));
assert(tabela.includes('data-ma-mapa=""'), "Todos volta a ordem de popularidade");
assert(!tabela.includes('href="#/maps/'), "o mapa ordena em vez de abrir a pagina do mapa");
const cabecalho = tabela.split("</thead>")[0];
assert(cabecalho.indexOf('data-ma-agente="b"') < cabecalho.indexOf('data-ma-agente="a"'), "a tabela sai na ordem do mapa escolhido");
// Ate 1180px o cabecalho some: a taxa na celula tambem ordena os mapas pelo agente.
const corpo = tabela.split("</thead>")[1];
assert(/<td class="vp-ma-taxa[^"]*"[^>]*><button type="button" class="vp-ma-celula" data-ma-agente="b"/.test(corpo), "a celula do agente e um botao que ordena os mapas");
rodar(`state.mapaAgenteOrdem = { mapa: "", agente: "c" };`);
const porAgente = context.tournamentMapAgentPickrateTable(linhas, colunas);
assert(/data-ma-agente="c"[^>]*aria-pressed="true"/.test(porAgente.split("</thead>")[0]), "o agente escolhido fica marcado no cabecalho");
assert(/class="vp-ma-taxa[^"]*vp-ma-sel[^"]*"[^>]*><button type="button" class="vp-ma-celula" data-ma-agente="c"/.test(porAgente), "e nas celulas dele");
rodar(`state.mapaAgenteOrdem = { mapa: "", agente: "" };`);

// ---------------------------------------------------------------- Equipes da Carreira
const jogador = { id: "p1", nick: "Um", matches: 0 };
const passagem = (teamId, nome, mapas, series, trofeus, inicio, current = false) => ({
  teamId, team: { id: teamId, name: nome }, maps: mapas, series, trophies: Array(trofeus).fill({}), current,
  start: Date.UTC(2025, inicio, 1), end: Date.UTC(2025, inicio + 2, 1),
  elenco: [{ inicio: Date.UTC(2025, inicio, 1), fim: Date.UTC(2025, inicio + 2 + mapas, 1) }], resumo: null,
});
const passagens = [passagem("A", "Alfa", 3, 1, 0, 8, true), passagem("B", "Beta", 9, 4, 2, 4), passagem("C", "Gama", 5, 6, 1, 0)];
const ordem = (sort) => {
  rodar(`state.tournamentStatsSort = ${JSON.stringify(sort ? { carreira: sort } : {})};`);
  const html = context.playerPassagensTabela(jogador, passagens);
  return ["Alfa", "Beta", "Gama"].map((nome) => [nome, html.lastIndexOf(`<b>${nome}</b>`)]).sort((x, y) => x[1] - y[1]).map(([nome]) => nome);
};
assert.deepStrictEqual(ordem(null), ["Alfa", "Beta", "Gama"], "sem clique, a ordem de antes");
assert.deepStrictEqual(ordem({ key: "mapas", direction: "desc" }), ["Beta", "Gama", "Alfa"], "por mapas");
assert.deepStrictEqual(ordem({ key: "mapas", direction: "asc" }), ["Alfa", "Gama", "Beta"], "segundo clique inverte");
assert.deepStrictEqual(ordem({ key: "series", direction: "desc" }), ["Gama", "Beta", "Alfa"], "por séries");
assert.deepStrictEqual(ordem({ key: "trofeus", direction: "desc" }), ["Beta", "Gama", "Alfa"], "por troféus");
assert.deepStrictEqual(ordem({ key: "equipe", direction: "asc" }), ["Alfa", "Beta", "Gama"], "por nome");
assert.deepStrictEqual(ordem({ key: "periodo", direction: "desc" }), ["Alfa", "Beta", "Gama"], "período mais recente primeiro");
assert.deepStrictEqual(ordem({ key: "periodo", direction: "asc" }), ["Gama", "Beta", "Alfa"], "período mais antigo primeiro");
assert.deepStrictEqual(ordem({ key: "tempo", direction: "desc" }), ["Beta", "Gama", "Alfa"], "por tempo na equipe");
rodar(`state.tournamentStatsSort = { carreira: { key: "mapas", direction: "desc" } };`);
const cab = context.playerPassagensTabela(jogador, passagens).split("vp-et-cab")[1].split("</div>")[0];
["equipe", "periodo", "tempo", "mapas", "series", "rating", "acs", "kd", "trofeus"].forEach((key) => assert(cab.includes(`data-tournament-stat-sort="carreira:${key}"`), `cabeçalho ordena por ${key}`));
assert(/carreira:mapas"[^>]*aria-pressed="true"/.test(cab) && cab.includes("▼"), "a coluna ativa com a seta");
assert.deepStrictEqual(valor(context.playerCarreiraColunas(jogador).map((c) => c.key)), ["equipe", "periodo", "tempo", "mapas", "series", "rating", "acs", "kd", "trofeus"], "as colunas da tabela");
rodar("state.tournamentStatsSort = {};");
const semClique = context.playerPassagensTabela(jogador, passagens).split("vp-et-cab")[1].split("</div>")[0];
assert(!semClique.includes('aria-pressed="true"'), "sem clique, nenhuma coluna acesa");

console.log("Ordenar tabelas: testes passaram");
