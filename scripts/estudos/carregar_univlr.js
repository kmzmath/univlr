// Carrega o pipeline do build (raating-core.js, ranking-core.js e app.js) e as
// partidas de data-sources.json do mesmo jeito que scripts/build_database.js,
// sem gravar nada. Serve aos estudos desta pasta, que ficam fora do build.
//
// Devolve { ROOT, files, metadata, readJson }:
// - files: um arquivo por matchId (o primeiro vence, como em buildDatabase),
//   só os que o parseMatchFile aceita (nome de arquivo válido e times Red/Blue);
// - metadata: prepareMetadata(metadata.json), sem raatingContext.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

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

function loadScript(relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  (0, eval)(source);
}

loadScript("raating-core.js");
loadScript("ranking-core.js");
loadScript("app.js");

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), "utf8"));
}

function carregar() {
  const manifest = readJson("data-sources.json");
  const metadata = globalThis.prepareMetadata(readJson("metadata.json"));
  const vistos = new Map();
  let falhas = 0;
  let repetidos = 0;
  let recusados = 0;
  for (const event of manifest.events || []) {
    for (const filePath of event.files || []) {
      let raw;
      try {
        raw = readJson(filePath);
      } catch (error) {
        falhas += 1;
        continue;
      }
      const matchId = raw.matchInfo?.matchId || filePath;
      if (vistos.has(matchId)) {
        repetidos += 1;
        continue;
      }
      const meta = globalThis.parseFileName(filePath);
      const temTimes = (raw.teams || []).some((t) => t.teamId === "Red") && (raw.teams || []).some((t) => t.teamId === "Blue");
      if (!meta || !temTimes) {
        recusados += 1;
        vistos.set(matchId, null);
        continue;
      }
      vistos.set(matchId, { eventId: event.id, path: filePath, raw });
    }
  }
  const files = [...vistos.values()].filter(Boolean);
  return { ROOT, files, metadata, manifest, readJson, resumo: { arquivos: files.length, falhas, repetidos, recusados } };
}

module.exports = { carregar, ROOT };
