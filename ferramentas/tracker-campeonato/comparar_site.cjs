// Passa arquivos convertidos (converter.py) pelo mesmo pipeline de partidas do
// site (parseMatchFile do app.js, com o contexto econômico do acervo inteiro,
// como o export_site_match_stats.js) e compara com a Riot.
//
// Uso:
//   node ferramentas/tracker-campeonato/comparar_site.cjs controle <controle.json> <dir-convertidos>
//       controle.json: [{ uuid, riot: "campeonatos/.../arquivo.json" }]
//       Compara três versões do mesmo mapa: Riot real, Riot com o colete
//       trocado pelo padrão do conversor, e convertido. Convertido x Riot com
//       colete padrão tem que dar zero: o resto da diferença é o colete.
//   node ferramentas/tracker-campeonato/comparar_site.cjs colete
//       Efeito da suposição de colete no acervo inteiro do site: real x
//       desconhecido (+50) x nenhum (0), por mapa e por jogador somado.
//   node ferramentas/tracker-campeonato/comparar_site.cjs convertidos <dir>...
//       Roda cada convertido pelo pipeline e relata erro ou números absurdos.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

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
globalThis.fetch = () => new Promise(noop);

for (const rel of ["raating-core.js", "ranking-core.js", "app.js"]) {
  (0, eval)(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

const COLETE_DESCONHECIDO = "TRACKER-COLETE-DESCONHECIDO";
const CAMPOS = [
  "rounds", "roundWins", "roundLosses", "kills", "deaths", "assists", "score", "damage", "adr", "acs",
  "kast", "kastRounds", "firstKills", "firstDeaths", "headshots", "bodyshots", "legshots",
  "eKillPoints", "eDeathPoints", "eDamageTotal", "eKastPoints", "adjustedRoundSwingTotalPp",
  "tradedDeaths", "failedTradeDeaths", "tradeKills", "tradeDenials", "savedLossRounds",
  "survivedWinRounds", "multiKillPoints", "twoKills", "threeKills", "fourKills", "fiveKills", "raating_3",
];

const lerJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

function acervo() {
  const manifest = lerJson(path.join(ROOT, "data-sources.json"));
  const unicos = new Map();
  for (const event of manifest.events || []) {
    for (const rel of event.files || []) {
      const raw = lerJson(path.join(ROOT, rel));
      const id = raw.matchInfo?.matchId || rel;
      if (!unicos.has(id)) unicos.set(id, { eventId: event.id, path: rel, raw });
    }
  }
  return [...unicos.values()];
}

function contexto(arquivos) {
  const metadata = prepareMetadata(lerJson(path.join(ROOT, "metadata.json")));
  return { ...metadata, raatingContext: buildRaatingContext(arquivos) };
}

function comColete(raw, armor) {
  const copia = structuredClone(raw);
  for (const r of copia.roundResults || []) for (const ps of r.playerStats || []) if (ps.economy) ps.economy.armor = armor;
  return copia;
}

function jogadores(file, meta) {
  const m = parseMatchFile(file, meta);
  if (!m) throw new Error(`parseMatchFile recusou ${file.path}`);
  return new Map(m.players.map((p) => [p.puuid, p]));
}

function estat(valores) {
  const v = valores.map(Math.abs).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, mediana: +q(0.5).toFixed(4), p95: +q(0.95).toFixed(4), max: +v[v.length - 1].toFixed(4) };
}

function diferencas(a, b) {
  const saida = {};
  for (const [puuid, pa] of a) {
    const pb = b.get(puuid);
    if (!pb) { (saida.__semPar ||= []).push(pa.handle); continue; }
    for (const c of CAMPOS) {
      const d = Number(pb[c] || 0) - Number(pa[c] || 0);
      (saida[c] ||= []).push(d);
    }
  }
  return saida;
}

function modoControle(listaArq, dirConv) {
  const todos = acervo();
  const meta = contexto(todos);
  const evento = new Map(todos.map((f) => [f.path, f.eventId]));
  const conv = [], col = [], semPar = [];
  for (const { uuid, riot } of lerJson(listaArq)) {
    const base = { eventId: evento.get(riot) || "controle", path: riot };
    const real = jogadores({ ...base, raw: lerJson(path.join(ROOT, riot)) }, meta);
    const padrao = jogadores({ ...base, raw: comColete(lerJson(path.join(ROOT, riot)), COLETE_DESCONHECIDO) }, meta);
    const convertido = jogadores({ ...base, raw: lerJson(path.join(dirConv, `${uuid}.json`)) }, meta);
    const d1 = diferencas(padrao, convertido);
    const d2 = diferencas(real, padrao);
    if (d1.__semPar) semPar.push(...d1.__semPar);
    conv.push(d1);
    col.push(d2);
  }
  const juntar = (lista) => Object.fromEntries(CAMPOS.map((c) => [c, estat(lista.flatMap((d) => d[c] || []))]));
  const c1 = juntar(conv);
  const naoZero = Object.entries(c1).filter(([, s]) => s.max > 1e-9);
  console.log(`controle: ${conv.length} mapas, ${c1.kills.n} jogador-mapa pareados por PUUID, ${semPar.length} sem par ${semPar.join(", ")}`);
  console.log("convertido x Riot com colete padrão, campos com diferença:", naoZero.length ? JSON.stringify(Object.fromEntries(naoZero)) : "nenhum");
  console.log("Riot real x Riot com colete padrão (efeito só do colete):", JSON.stringify(juntar(col).raating_3), "eDamageTotal", JSON.stringify(juntar(col).eDamageTotal));
}

function totalPorJogador(partidas) {
  const tot = new Map();
  for (const m of partidas) {
    for (const p of m.values()) {
      const t = tot.get(p.id) || { ...emptyPlayerStatTotals(), nick: p.nick };
      addPlayerMatchTotals(t, p);
      tot.set(p.id, t);
    }
  }
  for (const t of tot.values()) applyRaatingFields(t);
  return tot;
}

function modoColete() {
  const todos = acervo();
  const meta = contexto(todos);
  const versoes = { real: [], pesado: [], nenhum: [] };
  for (const f of todos) {
    versoes.real.push(jogadores(f, meta));
    versoes.pesado.push(jogadores({ ...f, raw: comColete(f.raw, COLETE_DESCONHECIDO) }, meta));
    versoes.nenhum.push(jogadores({ ...f, raw: comColete(f.raw, "") }, meta));
  }
  const porMapa = (alt) => estat(versoes.real.flatMap((m, i) => [...m].map(([pu, p]) => versoes[alt][i].get(pu).raating_3 - p.raating_3)));
  const sinal = (alt) => {
    const d = versoes.real.flatMap((m, i) => [...m].map(([pu, p]) => versoes[alt][i].get(pu).raating_3 - p.raating_3));
    return +(d.reduce((s, x) => s + x, 0) / d.length).toFixed(4);
  };
  console.log(`acervo: ${todos.length} mapas`);
  for (const alt of ["pesado", "nenhum"]) console.log(`por mapa, real x ${alt}: |dif| ${JSON.stringify(porMapa(alt))}, média com sinal ${sinal(alt)}`);

  const real = totalPorJogador(versoes.real);
  for (const alt of ["pesado", "nenhum"]) {
    const outro = totalPorJogador(versoes[alt]);
    const elegiveis = [...real].filter(([, t]) => t.rounds >= 200);
    const dif = elegiveis.map(([id, t]) => outro.get(id).raating_3 - t.raating_3);
    const ordem = (mapa) => elegiveis.map(([id]) => id).sort((a, b) => mapa.get(b).raating_3 - mapa.get(a).raating_3);
    const r1 = ordem(real), r2 = ordem(outro);
    const pos = new Map(r2.map((id, i) => [id, i]));
    const mudou = r1.filter((id, i) => pos.get(id) !== i).length;
    const maiorSalto = Math.max(...r1.map((id, i) => Math.abs(pos.get(id) - i)));
    const top10 = r1.slice(0, 10).filter((id) => r2.slice(0, 10).includes(id)).length;
    console.log(`por jogador (>=200 rounds, ${elegiveis.length}), real x ${alt}: |dif| ${JSON.stringify(estat(dif))}, média com sinal ${+(dif.reduce((s, x) => s + x, 0) / dif.length).toFixed(4)}; posições alteradas ${mudou}, maior salto ${maiorSalto}, top 10 em comum ${top10}/10`);
  }
}

function modoConvertidos(dirs) {
  const todos = acervo();
  const meta = contexto(todos);
  let ok = 0;
  const erros = [], estranhos = [], ratings = [];
  for (const dir of dirs) {
    for (const nome of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const raw = lerJson(path.join(dir, nome));
      const red = raw.teams.find((t) => t.teamId === "Red"), blue = raw.teams.find((t) => t.teamId === "Blue");
      const data = new Date(raw.matchInfo.gameStartMillis).toISOString().slice(2, 10).split("-").reverse().join("-");
      const mapa = raw.matchInfo.mapId.split("/").pop().toLowerCase();
      const caminho = `convertidos/TRK_${ok + erros.length + 1}_${data}_time_red_${red.roundsWon}_x_${blue.roundsWon}_time_blue_${mapa}.json`;
      try {
        const ps = [...jogadores({ eventId: "convertidos", path: caminho, raw }, meta).values()];
        const rounds = red.roundsWon + blue.roundsWon;
        for (const p of ps) {
          ratings.push(p.raating_3);
          if (!Number.isFinite(p.raating_3) || p.rounds !== rounds || p.adr <= 0 || p.adr > 400 || p.kast < 0 || p.kast > 100) estranhos.push(`${nome} ${p.handle}: rounds ${p.rounds}/${rounds}, adr ${p.adr?.toFixed(1)}, kast ${p.kast?.toFixed(1)}, rAAting ${p.raating_3}`);
        }
        if (ps.length !== 10) estranhos.push(`${nome}: ${ps.length} jogadores`);
        ok++;
      } catch (e) {
        erros.push(`${nome}: ${e.message}`);
      }
    }
  }
  console.log(`convertidos: ${ok} passaram, ${erros.length} erro(s), ${estranhos.length} linha(s) estranha(s)`);
  for (const e of erros) console.log("  ERRO", e);
  for (const e of estranhos.slice(0, 20)) console.log("  ESTRANHO", e);
  console.log("rAAting 3.0 dos jogadores convertidos:", JSON.stringify(estat(ratings.map((x) => x))), "média", +(ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(4));
}

const [modo, ...args] = process.argv.slice(2);
if (modo === "controle") modoControle(args[0], args[1]);
else if (modo === "colete") modoColete();
else if (modo === "convertidos") modoConvertidos(args);
else {
  console.error("Uso: comparar_site.cjs controle <controle.json> <dir> | colete | convertidos <dir>...");
  process.exitCode = 1;
}
