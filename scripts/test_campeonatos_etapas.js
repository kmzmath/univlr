// Campeonatos com etapas (docs/superpowers/specs/2026-11-07-campeonatos-com-etapas-design.md).
// Carrega o app.js num contexto vm com o DOM em stub, como o test_visual_placar.js,
// mas com o database.json real: o cadastro tem que bater com os ids de verdade.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), "utf8");
const codec = require(path.join(raiz, "db-codec.js"));

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
  URLSearchParams,
  clearInterval: noop,
  clearTimeout: noop,
  setInterval: () => 0,
  setTimeout: () => 0,
};
context.globalThis = context;
context.window = context;
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
vm.runInContext(ler("raating-core.js"), context);
vm.runInContext(ler("ranking-core.js"), context);
vm.runInContext(ler("app.js"), context);

const bancoCru = () => codec.decode(JSON.parse(ler("database.json")));
context.__banco = bancoCru();
vm.runInContext("state.db = __banco; state.ready = true;", context);
const db = context.__banco;
const ev = (id) => db.tournaments.find((item) => item.id === id);

// ---------------------------------------------------------------- Tarefa 1
const cadastro = vm.runInContext("CAMPEONATOS_COM_ETAPAS", context);
assert.strictEqual(cadastro.length, 10, "dez campeonatos com etapas");
const idsDeEtapa = new Set(db.tournaments.map((item) => item.id));
const vistas = new Set();
for (const camp of cadastro) {
  assert(!idsDeEtapa.has(camp.id), `id de campeonato ${camp.id} nao pode ser id de etapa`);
  assert(camp.etapas.some((etapa) => etapa.id === camp.decide), `${camp.id}: decide esta nas etapas`);
  for (const etapa of camp.etapas) {
    assert(idsDeEtapa.has(etapa.id), `${camp.id}: a etapa ${etapa.id} existe no banco`);
    assert(!vistas.has(etapa.id), `${etapa.id} esta em dois campeonatos`);
    vistas.add(etapa.id);
  }
}

// Controle: o banco gravado nao tem nome composto. Quem compoe e o cliente.
assert(db.tournaments.every((item) => !String(item.name).includes(": ")), "o database.json nao tem nome composto");

context.aplicarCampeonatos(db);
assert.strictEqual(ev("jubs-etapa-presencial").name, "JUBS 2026 - Goiás: Etapa Presencial", "nome composto da etapa");
assert.strictEqual(ev("jubs-etapa-presencial").nomeOriginal, "JUBS Goiás 2026 - Etapa Presencial", "o nome de antes fica guardado");
assert.strictEqual(ev("jubs-etapa-presencial").etapaNome, "Etapa Presencial");
assert.strictEqual(ev("jubs-etapa-presencial").campeonatoId, "jubs-2026");
assert.strictEqual(ev("copa-xv-6-2025").name, "Copa XV - 6ª edição (2025)", "campeonato sozinho fica intacto");
assert.deepStrictEqual([...context.tournamentEtapas(ev("copa-xv-6-2025"))], [], "o hifen da Copa XV nao vira etapa");
context.aplicarCampeonatos(db);
assert.strictEqual(ev("jubs-etapa-presencial").name, "JUBS 2026 - Goiás: Etapa Presencial", "aplicar duas vezes nao recompoe");

const univava = context.campeonatoPorId("univava");
assert(univava?.isCampeonato, "agregado do UNIVAVA");
assert.deepStrictEqual(
  [...univava.etapas.map((etapa) => etapa.id)],
  ["univava-playoffs", "univava-fase-de-grupos", "univava-classificatoria-4", "univava-classificatoria-3", "univava-classificatoria-2", "univava-classificatoria-1"],
  "etapas na ordem do dono",
);
assert.strictEqual(univava.teams.length, 62, "62 equipes inscritas no UNIVAVA");
assert.strictEqual(univava.matches, univava.etapas.reduce((soma, etapa) => soma + Number(etapa.matches || 0), 0), "partidas somadas");
assert.strictEqual(univava.decide.id, "univava-playoffs");
assert.strictEqual(context.campeonatoDaEtapa(ev("univava-classificatoria-2")), univava, "a etapa acha o campeonato");
assert.strictEqual(context.campeonatoDaEtapa(ev("aoc")), null, "campeonato sozinho nao tem agregado");
assert.deepStrictEqual({ ...context.tournamentSerie(ev("univava-playoffs")) }, { nome: "UNIVAVÁ", etapa: "Playoffs" }, "serie pelo cadastro");
const lbeu1 = context.campeonatoPorId("lbeu-2025-1-split");
assert(lbeu1.paralelas.has("lbeu-2025-1-split-off-season") && lbeu1.paralelas.has("lbeu-2025-1-split-practice"), "paralelas do LBEU");
assert(!lbeu1.paralelas.has("lbeu-2025-1-split-championship"), "controle: a que decide nao e paralela");

// Review Focus 1: etapa escondida sai do agregado; sem nenhuma visivel, o campeonato some.
{
  const copia = bancoCru();
  context.aplicarCampeonatos(copia);
  context.__banco = copia;
  vm.runInContext("state.db = __banco;", context);
  copia.tournaments.find((item) => item.id === "univava-classificatoria-1").hidden = true;
  context.aplicarCampeonatos(copia);
  assert.strictEqual(context.campeonatoPorId("univava").etapas.length, 5, "etapa escondida sai");
  copia.tournaments.filter((item) => item.campeonatoId === "univava").forEach((item) => (item.hidden = true));
  context.aplicarCampeonatos(copia);
  assert.strictEqual(context.campeonatoPorId("univava"), null, "sem etapa visivel, sem campeonato");
  context.__banco = db;
  vm.runInContext("state.db = __banco;", context);
  context.aplicarCampeonatos(db);
}

// ---------------------------------------------------------------- Tarefa 2
const ids = (lista) => [...lista].map((item) => item.id || item);
const seriesDe = (id) => context.matchSeriesForEvent(id);
const equipesComSerie = (eventIds) => {
  const conjunto = new Set();
  eventIds.forEach((id) => seriesDe(id).forEach((s) => [s.teamA?.id, s.teamB?.id].forEach((t) => t && conjunto.add(t))));
  return conjunto;
};
{
  const final = context.colocacaoFinal(univava);
  const dosPlayoffs = [...context.trophyPlacementRows(ev("univava-playoffs"))];
  assert.deepStrictEqual([...final.slice(0, dosPlayoffs.length).map((row) => row.id)], dosPlayoffs.map((row) => row.id || row.teamId), "primeiro a colocacao dos playoffs");
  const faixas = [...new Set(final.map((row) => row.range))];
  const depoisDosPlayoffs = faixas.slice(faixas.indexOf(final[dosPlayoffs.length].range));
  assert.deepStrictEqual(depoisDosPlayoffs.slice(0, 3), ["9-11", "12-14", "15-16"], "depois os eliminados na fase de grupos");
  const ultima = depoisDosPlayoffs.at(-1);
  assert.strictEqual(ultima, "17-62", "as classificatorias num grupo so, com a faixa contada");
  assert.strictEqual(final.filter((row) => row.range === ultima).length, 46, "46 equipes caidas nas classificatorias, a UFSCar Fire (so W.O.) inclusive");
  assert.strictEqual(new Set(final.map((row) => row.id)).size, final.length, "cada equipe uma vez");
  // Review Focus 2: com a final por jogar, quem disputa os playoffs sem colocacao fica fora.
  const semColocacao = [...equipesComSerie(["univava-playoffs"])].filter((id) => !dosPlayoffs.some((row) => (row.id || row.teamId) === id));
  const jogaram = equipesComSerie(univava.etapas.map((etapa) => etapa.id));
  assert.strictEqual(jogaram.size, 61, "61 equipes jogaram o UNIVAVA");
  assert.strictEqual(final.length, 62 - semColocacao.length, "todas as inscritas com resultado, menos as que ainda disputam o titulo");
  assert(final.some((row) => row.id === "ufscar_fire" && row.range === "17-62"), "a inscrita so com W.O. aparece, como na pagina da etapa");
  if (context.eventStatusClass(ev("univava-playoffs").status) === "live") assert.strictEqual(univava.status, ev("univava-playoffs").status, "status da etapa ao vivo");
}
{
  const final = context.colocacaoFinal(lbeu1);
  const soPractice = [...equipesComSerie(["lbeu-2025-1-split-practice"])].filter((id) => !equipesComSerie(["lbeu-2025-1-split-championship", "lbeu-2025-1-split-fase-suica"]).has(id));
  assert(!final.some((row) => soPractice.includes(row.id)), "quem so jogou a Practice nao entra na colocacao do LBEU");
}
assert.strictEqual(seriesDe("univava").length, univava.etapas.reduce((soma, etapa) => soma + seriesDe(etapa.id).length, 0), "as series do Geral sao a soma das etapas");
assert(seriesDe("univava").length > 0, "controle: o Geral tem series");

const renderiza = (hash) => {
  context.location.hash = hash;
  appElement.innerHTML = "";
  const id = hash.replace(/^#\/events\//, "").split(/[/?]/)[0];
  context.renderTournamentDetail(id);
  return appElement.innerHTML;
};
{
  const geral = renderiza("#/events/univava");
  assert(geral.includes("<h1>UNIVAVÁ</h1>"), "o Geral tem o nome do campeonato");
  const faixa = geral.split('class="vp-camp-etapas vp-camp-etapas-b vp-camp-etapas-setas"')[1].split("</nav>")[0];
  assert.strictEqual((faixa.match(/<a /g) || []).length, 7, "Geral e 6 etapas na faixa");
  assert(/href="#\/events\/univava" aria-current="page"><strong>Geral<\/strong><small>6 etapas<\/small>/.test(faixa), "Geral marcado, com a contagem de etapas");
  assert(/href="#\/events\/univava-classificatoria-1"><strong>Classificatória 1<\/strong><small>27 - 28 de jun<\/small>/.test(faixa), "cada bloco com as datas da etapa");
  // Setas (08/11/2026): a sequencia vai da primeira etapa a ultima.
  const ordem = [...faixa.matchAll(/<strong>([^<]+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(ordem, ["Geral", "Classificatória 1", "Classificatória 2", "Classificatória 3", "Classificatória 4", "Fase de Grupos", "Playoffs"], "faixa em ordem cronologica");
  assert(geral.includes("vp-s-etapas"), "lista de etapas no Geral");
  const etapa = renderiza("#/events/univava-playoffs");
  assert(etapa.includes("<h1>UNIVAVÁ</h1>"), "a etapa mostra o nome do campeonato no topo");
  assert(/href="#\/events\/univava-playoffs" aria-current="page"><strong>Playoffs/.test(etapa), "a etapa marcada na faixa");
  // Review Focus 3: link antigo com aba e filtro.
  const comFiltro = renderiza("#/events/univava-playoffs/estatisticas?equipe=ufu_saints");
  assert(comFiltro.includes('href="#/events/univava/estatisticas"'), "o Geral da faixa mantem a aba");
  assert(/class="active" href="#\/events\/univava-playoffs\/estatisticas"/.test(comFiltro), "a aba Estatisticas aberta");
  assert(comFiltro.includes('value="ufu_saints" selected'), "o filtro de equipe do link antigo vale");
  assert(comFiltro.includes("#/teams/ufu_saints"), "controle: a UFU aparece");
  const jogosGeral = renderiza("#/events/univava/jogos");
  assert.strictEqual((jogosGeral.match(/class="vp-jogos-etapa"/g) || []).length, 6, "os jogos do Geral andam por etapa");
  renderiza("#/events/univava/estatisticas");
  renderiza("#/events/univava/mapas");
  renderiza("#/events/univava/agentes");
  const lbeu = renderiza("#/events/lbeu-2025-1-split").split("vp-camp-etapas-setas")[1].split("</nav>")[0];
  const ordemLbeu = [...lbeu.matchAll(/class="vp-etapa-bloco([^"]*)"[^>]*><strong>([^<]+)/g)].map((m) => `${m[2]}${m[1].includes("paralela") ? " (paralela)" : ""}`);
  assert.deepStrictEqual(ordemLbeu, ["Geral", "Fase Suíça", "Championship", "Practice (paralela)", "Off Season (paralela)"], "paralelas retas no fim da faixa");
  const sozinho = renderiza("#/events/aoc");
  assert(!sozinho.includes("vp-camp-etapas"), "campeonato sozinho nao tem faixa");
}

// ---------------------------------------------------------------- Tarefa 3
{
  const lista = context.listaDeCampeonatos(context.sortedEvents("end"));
  assert.strictEqual(lista.length, 30, "30 linhas em Eventos");
  context.location.hash = "#/events";
  vm.runInContext("state.eventFilters = {}; state.eventTableSort = {};", context);
  appElement.innerHTML = "";
  context.renderEventsPage();
  const pagina = appElement.innerHTML;
  assert((pagina.match(/class="event-row event-row-rich/g) || []).length === 30, "30 linhas desenhadas");
  assert(pagina.includes("30 campeonatos"), "a contagem diz 30 campeonatos");
  const linhaUnivava = pagina.split('href="#/events/univava"')[1].split("</div>")[0];
  assert.strictEqual((linhaUnivava.match(/href="#\/events\/univava-/g) || []).length, 6, "as 6 etapas escritas na linha do UNIVAVA");
  assert(linhaUnivava.includes('class="event-cell event-cell-etapas" data-rotulo="Etapas"'), "as etapas ficam na coluna do formato");
  vm.runInContext('state.eventFilters = { tier: ["S"] };', context);
  assert(context.eventsFiltrados().some((item) => item.id === "univava"), "filtro de tier S mantem o UNIVAVA");
  assert(!context.eventsFiltrados().some((item) => item.id === "aoc"), "controle: o filtro tira o AOC, que e tier A");
  vm.runInContext("state.eventFilters = {};", context);

  // Review Focus 4: a home montada pelo home.json acha os mesmos campeonatos do banco inteiro.
  const resumo = JSON.parse(ler("home.json"));
  const primeiros = context.listaDeCampeonatos(context.sortedEvents("recent")).slice(0, vm.runInContext("HOME_EVENT_LIMIT", context));
  const daHome = context.homeSummaryDb(resumo);
  context.aplicarCampeonatos(daHome);
  context.__home = daHome;
  vm.runInContext("const __completo = state.db; state.db = __home;", context);
  const naHome = context.listaDeCampeonatos(context.sortedEvents("recent"));
  vm.runInContext("state.db = __completo;", context);
  assert.deepStrictEqual(naHome.map((item) => item.id), primeiros.map((item) => item.id), "home.json com os mesmos campeonatos (rode node scripts/build_home.js)");
  primeiros.filter((item) => item.isCampeonato).forEach((camp) => {
    const daHomeCamp = naHome.find((item) => item.id === camp.id);
    assert.strictEqual(daHomeCamp.teams.length, camp.teams.length, `${camp.id}: equipes iguais na home`);
    assert.strictEqual(daHomeCamp.matches, camp.matches, `${camp.id}: partidas iguais na home`);
  });
  assert(primeiros.some((item) => item.isCampeonato), "controle: a home tem campeonato com etapas");
}

// ---------------------------------------------------------------- Tarefa 4
{
  const busca = (texto) => [...context.filtrarBusca(context.normalize(texto))].filter((item) => item.type === "tournament");
  const so = (texto) => busca(texto).map((item) => item.label);
  assert.deepStrictEqual(so("univava"), ["UNIVAVÁ"], "univava acha so o campeonato");
  const classif2 = busca("classificatoria 2");
  assert(classif2.length && classif2.every((item) => item.entity.etapaNome === "Classificatória 2"), "classificatoria 2 acha etapas");
  assert.deepStrictEqual(classif2.map((item) => item.entity.campeonatoId).sort(), ["alianca-2024-1", "copa-alianca-2025", "univava"], "as tres Classificatorias 2");
  assert.deepStrictEqual(so("jubs rn"), ["JUBS 2025 - Natal"], "nome antigo acha o campeonato");
  assert.deepStrictEqual(busca("practice").map((item) => item.entity.id).sort(), ["lbeu-2025-1-split-practice", "lbeu-2025-2-split-practice"], "as duas Practice");
  assert.deepStrictEqual(so("copa xv"), ["Copa XV - 6ª edição (2025)"], "a Copa XV sozinha");
  // Review Focus 5
  assert.deepStrictEqual(busca("pre-jubs").map((item) => item.entity.id), ["jubs-pre-jubs-sp"], "pre-jubs acha a etapa");
  assert.deepStrictEqual(busca("univava classificatoria 2").map((item) => item.entity.id), ["univava-classificatoria-2"], "campeonato + etapa acha so a etapa");
  assert(busca("univava").every((item) => item.path === "tournaments/univava"), "o resultado do campeonato leva ao Geral");

  const trofeu = (teamId, eventId, extra = {}) => {
    const lista = [...context.teamTrophyAchievements(context.teamById(teamId), { includeInherited: false })];
    const achado = lista.find((item) => item.event.id === eventId);
    assert(achado, `trofeu de ${teamId} em ${eventId} existe`);
    return context.rotuloDoTrofeuEmTexto({ ...achado, ...extra });
  };
  assert.strictEqual(trofeu("ceub_octopus", "jubs-etapa-presencial"), "Campeão, JUBS 2026 - Goiás");
  assert.strictEqual(trofeu("wolf_gaming", "lbeu-2025-1-split-off-season"), "Campeão da Off Season, LBEU 2025 - 1º Split");
  assert.strictEqual(trofeu("pucc_cardinals", "jubs-pre-jubs-sp"), "Campeão do Pré-JUBS SP, JUBS 2026 - Goiás");
  assert.strictEqual(trofeu("ceub_octopus", "aoc"), "Campeão, AOC");
  assert.strictEqual(context.rotuloDoTrofeuEmTexto({ event: ev("jubs-etapa-presencial"), placementLabel: "MVP", trophyKey: "mvp" }), "MVP, JUBS 2026 - Goiás");
  const capa = context.teamCapaTrofeus([...context.teamTrophyAchievements(context.teamById("ceub_octopus"), { includeInherited: false })]);
  assert(capa.includes('title="Campeão, JUBS 2026 - Goiás"') && capa.includes('href="#/tournaments/jubs-etapa-presencial"'), "a capa usa o rotulo novo e o link da etapa");
  const lista = context.trofeusLista([...context.teamTrophyAchievements(context.teamById("wolf_gaming"), { includeInherited: false })]);
  assert(lista.includes("<strong>Campeão da Off Season</strong><small>LBEU 2025 - 1º Split"), "a lista de trofeus usa o rotulo novo");
}

// ---------------------------------------------------------------- Tarefa 6
{
  const a241 = context.campeonatoPorId("alianca-2024-1");
  assert.deepStrictEqual([...a241.etapas.map((etapa) => etapa.id)], ["alianca-2024-playoffs", "alianca-2024-grupos", "alianca-2024-classificatoria-2", "alianca-2024-classificatoria-1"], "Aliança 2024.1: Playoffs, Grupos e as classificatórias");
  const final = context.colocacaoFinal(a241);
  assert.deepStrictEqual([...new Set(final.slice(0, 8).map((row) => row.range))], ["1", "2", "3-4", "5-8"], "1 a 8 dos playoffs");
  assert.deepStrictEqual([...new Set(final.slice(8, 16).map((row) => row.range))], ["9-11", "12-14", "15-16"], "9 a 16 do suíço");
  assert(final.slice(0, 8).every((row) => row.etapaId === "alianca-2024-playoffs") && final.slice(8, 16).every((row) => row.etapaId === "alianca-2024-grupos"), "cada faixa vem da sua etapa");
  const a242 = context.campeonatoPorId("alianca-2024-2");
  assert.deepStrictEqual([...a242.etapas.map((etapa) => etapa.id)], ["alianca-2024-2-playoffs", "alianca-2024-2-fase-de-grupos", "alianca-2024-2-classificatoria"], "Aliança 2024.2 em três etapas");
  const a232 = context.campeonatoPorId("alianca-2023-2");
  assert.deepStrictEqual([...a232.etapas.map((etapa) => etapa.id)], ["alianca-2023-2-playoffs", "alianca-2023-2-fase-de-grupos", "alianca-2023-2-classificatoria"], "Aliança 2023.2 em três etapas");
  // Classificatória: 158 séries (77 MD1 e 2 MD3 por grupo). Com arquivo, 71 no Grupo A (boletim)
  // e 66 no B (tracker); o resto é W.O. ou mapa com menos de 10 jogadores.
  assert.strictEqual(seriesDe("alianca-2023-2-classificatoria").length, 137, "137 séries com arquivo na classificatória da 2023.2");
  assert.strictEqual(seriesDe("alianca-2024-playoffs").length, 7, "7 séries nos playoffs da 2024.1");
  assert.strictEqual(seriesDe("alianca-2024-grupos").length, 30, "30 séries no suíço da 2024.1");
  assert.strictEqual(seriesDe("alianca-2024-2-playoffs").length, 9, "9 séries com arquivo nos playoffs da 2024.2");
  assert.strictEqual(seriesDe("alianca-2024-2-fase-de-grupos").length, 31, "31 séries no suíço da 2024.2");
  assert(!db.tournaments.some((item) => /grupos-playoffs/.test(item.id)), "os ids antigos sumiram do banco");
  const pesos = JSON.parse(ler("ranking-weights.json")).tournaments;
  assert.strictEqual(pesos["alianca-2024-grupos"].qualifiesTo, "alianca-2024-playoffs");
  assert.strictEqual(pesos["alianca-2024-grupos"].placementPoints.Classificado, 0, "Classificado no suíço vale 0");
  assert.strictEqual(pesos["alianca-2024-2-playoffs"].teams, 8);
  const playoffs = renderiza("#/events/alianca-2024-2-playoffs");
  assert((playoffs.match(/linked-region/g) || []).length >= 2, "os playoffs da 2024.2 viram chave encadeada");
}

// ---------------------------------------------------------------- Revisao de 07/11
// 1. Colocacao final de todos os campeonatos: faixas numericas, crescentes e
// contiguas. So pode haver vao no topo, para quem ainda disputa a etapa que decide.
for (const camp of cadastro) {
  const agregado = context.campeonatoPorId(camp.id);
  const final = [...context.colocacaoFinal(agregado)];
  const naDecide = new Set();
  seriesDe(agregado.decide.id).forEach((s) => [s.teamA?.id, s.teamB?.id].forEach((t) => t && naDecide.add(t)));
  [...context.trophyPlacementRows(agregado.decide)].forEach((row) => naDecide.add(row.id || row.teamId));
  const grupos = [];
  final.forEach((row) => {
    if (grupos.at(-1)?.range !== row.range) grupos.push({ range: row.range, n: 0, decide: row.etapaId === agregado.decide.id });
    grupos.at(-1).n += 1;
  });
  let fim = 0;
  grupos.forEach((grupo, i) => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(grupo.range);
    assert(m, `${camp.id}: faixa numerica (achei "${grupo.range}")`);
    const inicio = Number(m[1]);
    const ate = Number(m[2] || m[1]);
    assert.strictEqual(ate - inicio + 1, grupo.n, `${camp.id}: a faixa ${grupo.range} tem ${grupo.n} equipes`);
    const primeiroForaDaDecide = !grupo.decide && (i === 0 || grupos[i - 1].decide);
    if (primeiroForaDaDecide) assert.strictEqual(inicio, naDecide.size + 1, `${camp.id}: depois da etapa que decide vem ${naDecide.size + 1} (achei ${grupo.range})`);
    else if (!grupo.decide) assert.strictEqual(inicio, fim + 1, `${camp.id}: ${grupo.range} continua de ${fim}`);
    fim = ate;
  });
  assert.strictEqual(new Set(final.map((row) => row.id)).size, final.length, `${camp.id}: cada equipe uma vez`);
}

// 2. Coluna Series da colocacao no Geral: a campanha do campeonato inteiro.
{
  const campanha = (campId, teamId) => {
    const geral = context.eventoDoGeral(context.campeonatoPorId(campId));
    const linha = context.tournamentCampanhas(geral, seriesDe(campId)).get(teamId);
    return linha ? `${linha[0]}-${linha[1]}` : "";
  };
  assert.strictEqual(campanha("jubs-2026", "ceub_octopus"), "11-0", "CEUB Octopus no JUBS 2026 inteiro");
  // A soma das campanhas das paginas das etapas: W.O. e series sem arquivo contam,
  // como na chave de cada etapa (CAAP 4-0 nos playoffs com duas finais sem arquivo).
  assert.strictEqual(campanha("alianca-2024-2", "caap_hellhounds"), "10-0", "CAAP na Aliança 2024.2 inteira");
  assert.strictEqual(campanha("univava", "ufu_saints"), "12-4", "UFU no UNIVAVÁ inteiro");
  // Aliança 2023.2: 4-1 na classificatória (derrota para a Mauá Blue na R1), 7-0 no Grupo B e
  // 5-0 nos playoffs.
  assert.strictEqual(campanha("alianca-2023-2", "caap_hellhounds"), "16-1", "CAAP na Aliança 2023.2 inteira");
}

// 3. A conversa do Geral tem assunto, para aparecer na atividade e no perfil.
{
  vm.runInContext(ler("comments.js"), context);
  const assunto = context.Comments.assuntoDaThread("event", "univava");
  assert(assunto && assunto.href === "#/tournaments/univava" && assunto.nome === "UNIVAVÁ", "assunto da conversa do Geral");
  assert(context.Comments.assuntoDaThread("event", "univava-playoffs"), "controle: a conversa da etapa continua com assunto");
  // O resto do arquivo desenha paginas sem a comunidade carregada.
  vm.runInContext("window.Comments = undefined;", context);
}

// 4. Nenhum perfil de equipe aponta para campeonato que nao existe.
{
  const ids = new Set(db.tournaments.map((item) => item.id));
  const orfaos = [];
  const varre = (no, onde) => {
    if (Array.isArray(no)) return no.forEach((x, i) => varre(x, `${onde}[${i}]`));
    if (!no || typeof no !== "object") return;
    Object.entries(no).forEach(([chave, valor]) => {
      if (chave === "eventos" && Array.isArray(valor)) valor.forEach((id) => !ids.has(id) && orfaos.push(`${onde}: ${id}`));
      else varre(valor, `${onde}.${chave}`);
    });
  };
  varre(JSON.parse(ler("team-profiles.json")), "team-profiles");
  varre(db.teams.map((team) => team.profile || {}), "database.teams");
  assert.deepStrictEqual(orfaos, [], "eventos orfaos nos perfis de equipe");
}

// 5. Trocar de etapa (ou ir ao Geral) desliza: o escopo do slide e o campeonato.
{
  renderiza("#/events/univava");
  const antes = vm.runInContext('panelSlideViews["tournament-tabs"]', context);
  renderiza("#/events/univava-playoffs");
  const depois = vm.runInContext('panelSlideViews["tournament-tabs"]', context);
  assert.strictEqual(antes.scope, depois.scope, "Geral e etapa no mesmo escopo de slide");
  assert.notStrictEqual(antes.key, depois.key, "chaves diferentes: o slide roda");
}

// 6. Abrir uma etapa nao calcula a colocacao do campeonato inteiro.
{
  const original = context.colocacaoFinal;
  let chamadas = 0;
  context.colocacaoFinal = (...args) => { chamadas += 1; return original(...args); };
  renderiza("#/events/jubs-etapa-presencial");
  context.colocacaoFinal = original;
  assert.strictEqual(chamadas, 0, "a etapa nao calcula a colocacao do Geral");
}

// ---------------------------------------------------------------- Pontos menores da revisao
// Titulo da aba do navegador no Geral: o nome do campeonato.
assert.strictEqual(context.tournamentDocumentTitle("univava"), "UNIVAVÁ", "titulo da aba no Geral");
assert.strictEqual(context.tournamentDocumentTitle("univava-playoffs"), "UNIVAVÁ: Playoffs", "controle: titulo da etapa");

// Linha de campeonato em Eventos: pelo teclado a capa aparece e o foco contorna a linha.
{
  const css = ler("placar.css");
  assert(/\.vp-eventos \.event-row-camp\.tem-capa:focus-within::before/.test(css), "a capa aparece com o foco dentro da linha");
  assert(/\.event-row-camp:has\(\.event-row-link:focus-visible\)/.test(css), "o foco do nome contorna a linha inteira");
}

// Escudo e cores de epoca no Geral: a UFRJ Canis (hoje Minerva Thunders) no JUBS 2025.
{
  const geral = context.eventoDoGeral(context.campeonatoPorId("jubs-2025"));
  const equipe = context.tournamentTeamById(geral, "minerva_thunders");
  assert.strictEqual(equipe.logo, "assets/team-logos/ufrj_canis.png", "escudo da epoca no Geral");
  assert.strictEqual(equipe.name, context.tournamentTeamById(ev("jubs-2025-fase-inicial"), "minerva_thunders").name, "mesmo nome da etapa");
  assert.notStrictEqual(context.teamById("minerva_thunders").logo, equipe.logo, "controle: o escudo de hoje e outro");
  // O escudo pequeno (teamLogo) da colocacao e das listas le a epoca da rota.
  vm.runInContext('state.eventoDaPagina = eventosDaRota("events", "jubs-2025");', context);
  assert(context.teamLogo("minerva_thunders").includes("ufrj_canis.png"), "teamLogo com a epoca no Geral");
  vm.runInContext('state.eventoDaPagina = eventosDaRota("teams", "minerva_thunders");', context);
  assert(!context.teamLogo("minerva_thunders").includes("ufrj_canis.png"), "controle: fora do campeonato, o escudo de hoje");
}

// As 5 abas do Geral desenham em todos os campeonatos, com o conteudo de cada uma.
for (const camp of cadastro) {
  const marcas = { "": "vp-s-colocacao", "/jogos": "vp-jogos-etapa", "/estatisticas": "Estatísticas", "/mapas": "Mapas", "/agentes": "Agentes" };
  for (const [aba, marca] of Object.entries(marcas)) {
    const html = renderiza(`#/events/${camp.id}${aba}`);
    assert(html.includes(marca), `${camp.id}${aba}: desenhou (${marca})`);
  }
  const jogos = renderiza(`#/events/${camp.id}/jogos`);
  const comSerie = context.campeonatoPorId(camp.id).etapas.filter((etapa) => context.tournamentJogos(etapa, seriesDe(etapa.id)).length).length;
  assert.strictEqual((jogos.match(/class="vp-jogos-etapa"/g) || []).length, comSerie, `${camp.id}: um bloco de jogos por etapa com jogos`);
}

// ---------------------------------------------------------------- Edicoes (11/11/2026)
{
  const series = vm.runInContext("SERIES_DE_CAMPEONATOS", context);
  const vistas = new Set();
  for (const serie of series) {
    let antes = 0;
    for (const edicao of serie.edicoes) {
      assert(!vistas.has(edicao.id), `${edicao.id}: em uma serie so`);
      vistas.add(edicao.id);
      const pagina = context.campeonatoPorId(edicao.id) || ev(edicao.id);
      assert(pagina, `${edicao.id}: existe`);
      assert(Number(pagina.start) > antes, `${serie.id}: ${edicao.id} depois da edicao anterior`);
      antes = Number(pagina.start);
    }
  }
  const destino = (de, para) => {
    const etapa = context.campeonatoPorId(de) ? context.eventoDoGeral(context.campeonatoPorId(de)) : ev(de);
    const camp = context.campeonatoPorId(de) || context.campeonatoDaEtapa(etapa);
    return context.edicaoDestino(para, etapa, camp);
  };
  assert.strictEqual(destino("alianca-2024-playoffs", "alianca-2024-2"), "alianca-2024-2-playoffs", "mesmo nome");
  assert.strictEqual(destino("alianca-2024-grupos", "alianca-2024-2"), "alianca-2024-2-fase-de-grupos", "mesmo degrau, uma so");
  assert.strictEqual(destino("alianca-2024-classificatoria-1", "alianca-2024-2"), "alianca-2024-2", "duas no degrau: Geral");
  assert.strictEqual(destino("alianca-2023-2-classificatoria", "alianca-2024-1"), "alianca-2024-1", "uma de la, duas aqui: Geral");
  assert.strictEqual(destino("alianca-2024-1", "copa-alianca-2025"), "copa-alianca-2025", "do Geral, o Geral");
  assert.strictEqual(destino("jubs-2024-presencial", "jubs-2026"), "jubs-etapa-presencial", "JUBS: Etapa Presencial");
  assert.strictEqual(destino("jubs-pre-jubs-sp", "jubs-2025"), "jubs-2025", "paralela sem par: Geral");
  assert.strictEqual(destino("lbeu-2025-1-split-practice", "lbeu-2025-2-split"), "lbeu-2025-2-split-practice", "LBEU por nome");

  const html = renderiza("#/events/alianca-2024-playoffs/mapas");
  const nav = html.match(/<nav class="vp-camp-edicoes"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.strictEqual((nav.match(/<a /g) || []).length, 4, "quatro edicoes da Aliança");
  assert(nav.includes('href="#/events/alianca-2024-2-playoffs/mapas"'), "aba vai junto");
  assert(/aria-current="page">2024\.1</.test(nav), "edicao aberta marcada");
  assert(!renderiza("#/events/cpue-2025").includes("vp-camp-edicoes"), "controle: campeonato sem serie nao tem numeros");

  // Evento sozinho como edicao: o Rush Series, inclusivas junto.
  const rush = renderiza("#/events/rush-series-3/jogos").match(/<nav class="vp-camp-edicoes"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.strictEqual((rush.match(/<a /g) || []).length, 5, "cinco edicoes do Rush Series");
  assert(rush.includes('href="#/events/rush-series-inclusivo-2/jogos"'), "Rush: aba vai junto");
  assert(/aria-current="page">3ª Edição</.test(rush), "Rush: edicao aberta marcada");
}

console.log("campeonatos com etapas: ok");

