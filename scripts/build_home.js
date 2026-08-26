// Gera home.json: o pedaço do banco que a página inicial precisa para
// desenhar, e só ele.
//
// Uso: node scripts/build_home.js   (rode depois de build_database.js)
//
// Por que existe: a home espera 5,3 MB de database.json mais ~230ms de parse e
// decode antes do primeiro pixel, para mostrar 9 líderes, 10 times, 10 séries
// e 8 campeonatos. Esse recorte dá ~10 KB. O banco completo continua sendo
// carregado, em segundo plano, para as outras rotas.
//
// O script parte do database.json já commitado e roda o MESMO app.js que o
// navegador roda (com stubs de DOM), então os líderes da semana saem da função
// de verdade — nada de reimplementar a regra aqui e ela divergir depois.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "home.json");

// --- Stubs de navegador: app.js referencia DOM/fetch no topo do arquivo ---
const noop = () => {};
const stubElement = {
  innerHTML: "",
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
globalThis.window = globalThis;
globalThis.document = {
  title: "",
  getElementById: () => stubElement,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...stubElement }),
  addEventListener: noop,
  removeEventListener: noop,
  body: stubElement,
  documentElement: stubElement,
};
globalThis.location = { hash: "" };
globalThis.history = { pushState: noop, replaceState: noop };
globalThis.requestAnimationFrame = () => 0;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.fetch = () => new Promise(noop);

// `(0, eval)` roda em escopo global, onde `function` vira propriedade global
// mas `const` NÃO — por isso build_database.js só usa funções. Aqui preciso de
// `state` e de algumas constantes, então um epílogo dentro do mesmo eval as
// entrega para fora. É isso ou reescrever as listas aqui e deixá-las divergir.
function loadScript(relPath, epilogo = "") {
  const source = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  (0, eval)(source + epilogo);
}

loadScript("raating-core.js");
loadScript("ranking-core.js");
loadScript(
  "app.js",
  `
;globalThis.__app = {
  state,
  PLAYER_OF_WEEK_CATEGORIES,
  PLAYER_OF_WEEK_SUPPORT,
  HOME_RANKING_LIMIT,
  HOME_RECENT_MATCH_LIMIT,
  HOME_EVENT_LIMIT,
};
`,
);

const {
  state,
  PLAYER_OF_WEEK_CATEGORIES,
  PLAYER_OF_WEEK_SUPPORT,
  HOME_RANKING_LIMIT,
  HOME_RECENT_MATCH_LIMIT,
  HOME_EVENT_LIMIT,
} = globalThis.__app;

const codec = require(path.join(ROOT, "db-codec.js"));

// Os objetos abaixo saem com a MESMA FORMA dos reais, só sem os campos que a
// home não lê. É de propósito: assim `teamLogo`, `teamShortRankLabel`,
// `rankingPositionChangeBadge`, `sortedEvents`, `eventTimeRange`,
// `matchListScore` e `matchMapStrip` funcionam sem nenhuma alteração — o app
// não precisa saber se está lendo o resumo ou o banco inteiro.
const slimTeam = (team) =>
  team && {
    id: team.id,
    name: team.name,
    tag: team.tag,
    sourceTag: team.sourceTag,
    logo: team.logo || "",
    // teamAccentStyle pinta o fundo do retrato com as cores da equipe
    colors: team.colors || null,
    profile: { logo: team.profile?.logo || team.logo || "" },
    rankingScore: team.rankingScore,
    points: team.points,
    matches: team.matches,
    wins: team.wins,
    losses: team.losses,
    ranking: team.ranking
      ? {
          validRank: team.ranking.validRank,
          overallRank: team.ranking.overallRank,
          rank: team.ranking.rank,
          change: team.ranking.change,
          inactive: team.ranking.inactive,
          provisional: team.ranking.provisional,
        }
      : null,
  };

// Só o par id/score de cada lado: é o que scoreForTeamInMatch lê.
const slimSide = (side) => side && { id: side.id, name: side.name, score: side.score };

function main() {
  const startedAt = Date.now();
  const db = codec.decode(JSON.parse(fs.readFileSync(path.join(ROOT, "database.json"), "utf8")));
  state.db = db;
  // Mesma sequência do init() do app.js. Sem isto o snapshot corrente não é
  // criado, latestRankingSnapshot() devolve outro cutoff e a janela da semana
  // sai diferente da que o navegador calcula — foi o que aconteceu na primeira
  // geração (11-18 de ago aqui contra 11-25 no navegador).
  ensureCurrentRankingSnapshot(state.db);
  state.ready = true;

  // Líderes da semana pela função real do app.js.
  const leaders = playerOfWeekLeaders().map(({ category, player, windowLabel }) => ({
    key: category.key,
    label: category.label,
    statLabel: category.statLabel,
    value: category.format(player),
    windowLabel,
    player: {
      id: player.id,
      // playerRouteId le routeSlug antes do id; sem ele o link vira o puuid cru
      routeSlug: playerById(player.id)?.routeSlug || player.routeSlug || "",
      nick: player.nick,
      photo: player.photo || "",
      teamId: player.teamId || "",
      matches: player.matches,
      rounds: player.rounds,
    },
    // os três números de apoio que o hover revela, já formatados
    support: (PLAYER_OF_WEEK_SUPPORT[category.key] || [])
      .map((key) => PLAYER_OF_WEEK_CATEGORIES.find((item) => item.key === key))
      .filter(Boolean)
      .map((item) => ({ statLabel: item.statLabel, value: item.format(player) })),
  }));

  const snapshot = latestRankingSnapshot();
  // Os dez primeiros vem primeiro porque renderHomeCompact faz
  // `state.db.teams.slice(0, HOME_RANKING_LIMIT)`. Depois entram as equipes que
  // so aparecem nas partidas recentes: sem elas teamLogo nao acha o time e
  // desenha o quadrado vazio.
  const rankTeams = db.teams.slice(0, HOME_RANKING_LIMIT);
  const rankIds = new Set(rankTeams.map((t) => t.id));
  const seriesTeamIds = new Set();
  for (const item of allMatchSeries().slice().sort(compareSeriesDateDesc).slice(0, HOME_RECENT_MATCH_LIMIT)) {
    const s = normalizeMatchItem(item);
    if (s.teamA?.id) seriesTeamIds.add(s.teamA.id);
    if (s.teamB?.id) seriesTeamIds.add(s.teamB.id);
  }
  const extras = db.teams.filter((t) => seriesTeamIds.has(t.id) && !rankIds.has(t.id));
  const teams = [...rankTeams, ...extras].map(slimTeam);

  const series = allMatchSeries()
    .slice()
    .sort(compareSeriesDateDesc)
    .slice(0, HOME_RECENT_MATCH_LIMIT)
    .map((item) => {
      const s = normalizeMatchItem(item);
      return {
        seriesKey: s.seriesKey,
        primaryMatchId: s.primaryMatchId,
        mapCount: s.mapCount,
        startedAt: s.startedAt,
        sortAt: s.sortAt,
        eventId: s.eventId,
        label: s.label,
        scoreA: s.scoreA,
        scoreB: s.scoreB,
        mapNames: (s.mapNames || []).filter(Boolean),
        teamA: slimSide(s.teamA),
        teamB: slimSide(s.teamB),
        // `maps` precisa existir: é o que isMatchSeriesItem testa, e o que
        // matchListScore lê numa série de mapa único.
        maps: (s.maps || []).map((m) => ({
          mapId: m.mapId,
          mapName: m.mapName,
          mapIcon: m.mapIcon,
          mapNumber: m.mapNumber,
          winnerId: m.winnerId,
          teamA: slimSide(m.teamA),
          teamB: slimSide(m.teamB),
        })),
      };
    });

  const events = sortedEvents("recent")
    .slice(0, HOME_EVENT_LIMIT)
    .map((event) => ({
      id: event.id,
      name: event.name,
      logo: event.logo || "",
      status: event.status || "",
      tier: event.tier || "",
      start: event.start,
      end: event.end,
      hidden: event.hidden,
      matches: event.matches,
      // só o comprimento importa na home; os ids mantêm a forma de array
      teams: (event.teams || []).map((t) => (typeof t === "string" ? t : t?.id || "")),
    }));

  // Só os mapas que as séries acima citam: é o que a arte de fundo precisa.
  const usados = new Set(series.flatMap((s) => s.mapNames));
  const maps = db.maps
    .filter((map) => usados.has(map.name))
    .map((map) => ({ id: map.id, name: map.name, icon: map.icon || "" }));

  // Dois snapshots, nao um: rankingPositionChange compara com a semana
  // anterior, e sem ela todo time mostra "Sem semana anterior para comparacao".
  const slimSnapshot = (snap) =>
    snap && {
      id: snap.id,
      cutoffAt: snap.cutoffAt,
      byTeamId: Object.fromEntries(
        teams
          .map((t) => [t.id, snap.byTeamId?.[t.id]])
          .filter(([, v]) => v)
          .map(([id, v]) => [id, { validRank: v.validRank, overallRank: v.overallRank, rank: v.rank, inactive: v.inactive, provisional: v.provisional }]),
      ),
    };
  const rankingSnapshots = [slimSnapshot(snapshot), slimSnapshot(previousRankingSnapshot(snapshot))].filter(Boolean);

  const payload = {
    format: "univlr-home@1",
    generatedAt: Date.now(),
    leaders,
    teams,
    series,
    events,
    maps,
    rankingSnapshots,
  };
  const json = JSON.stringify(payload);
  fs.writeFileSync(OUTPUT, json);

  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const falhas = [];
  if (!leaders.length) falhas.push("nenhum líder da semana");
  if (teams.length < HOME_RANKING_LIMIT) falhas.push(`ranking com so ${teams.length} times`);
  if (!series.length) falhas.push("nenhuma série recente");
  if (!events.length) falhas.push("nenhum campeonato");
  if (series.some((s) => !s.teamA || !s.teamB)) falhas.push("série sem equipe");

  console.log(`home.json gerado em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(`  líderes: ${leaders.length} | times: ${teams.length} (10 no ranking + ${teams.length-10} das partidas) | séries: ${series.length} | campeonatos: ${events.length} | mapas: ${maps.length}`);
  console.log(`  janela da semana: ${leaders[0]?.windowLabel || "-"}`);
  console.log(`  tamanho: ${kb(json.length)} bruto | ${kb(zlib.gzipSync(json).length)} gzip`);
  if (falhas.length) {
    console.error("  ATENÇÃO:");
    for (const f of falhas) console.error(`    x ${f}`);
    process.exitCode = 1;
  }
}

main();
