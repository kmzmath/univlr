// Contas alternativas: uma pessoa que joga de mais de uma conta Riot precisa
// virar um jogador so, e o caso em que as duas contas dela aparecem na MESMA
// partida (conta emprestada) precisa cair na regra certa ou derrubar o build.
//
// Uso: node scripts/test_shared_accounts.js
//
// As duas partidas com conta emprestada sao montadas a partir de um arquivo
// real com um puuid trocado: nenhuma partida de verdade tem esse conflito
// hoje, e um fixture escrito a mao nao exercitaria parseMatchFile inteiro.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
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

function loadScript(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  (0, eval)(source);
}

loadScript("raating-core.js");
loadScript("ranking-core.js");
loadScript("app.js");

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));

const MNDEUS = "6roTE5p_leyMeyKDKEsnTaA7OwU8-gCdVdIQR9r9T4doBg_2x14whfK6l-ZiiYGxY_gwjoHNKBPt6A";
const JOY = "n4gmlK3PBjD58Em3HdmK3czcYqqtRiehQ5m4fRpjVklg38w7oGz8qmEijZ5holGKPoPSgJoF9hSNJg";
const SUREBETEIRO = "vRYrbB_JkHpUPbVYP3NXOX3sbjjajeINlTRDIMSbEtxXZoIe-dKcU5b2hmwY9KAvIzEZm1KQToc6vw";
const JANNIK = "CQQxU-NPOk9u1OE3eqdnilJuxHjs_vhKmXfxVSS-NpamWZYKIPp3EYRwLawxv2kk_nhN6QsZhitXkA";
const M4DM4X = "cqvTMeVT6Mj3_RCb5rmFRn8AVe0EGNsDq1pdsg1oIjm_nTCYO0KEQi61QM9yduO7FhlLUaByHU27sw";
const NEGO_DOCE = "2pfWv-PCjOl_ukzJdZyQNxW9uK94CEiJmWxycc9MxLTuUURixVs642SIJkhr732N50C7WjrtLdOreg";

const metadata = prepareMetadata(readJson("metadata.json"));

// --- 1. Toda conta alternativa aponta para a pessoa certa ---------------------
const pessoaDaConta = (puuid) => metadata.playersByPuuid.get(puuid)?.name;
assert.strictEqual(pessoaDaConta(MNDEUS), "Mendes", "mndeuS e a conta principal do Mendes");
assert.strictEqual(pessoaDaConta(JOY), "Mendes", "Joy 1955 e conta alternativa do Mendes");
assert.strictEqual(pessoaDaConta(SUREBETEIRO), "Laves", "surebeteiro e a conta principal do Laves");
assert.strictEqual(pessoaDaConta(JANNIK), "Laves", "jannik sinner e conta alternativa do Laves");
assert.strictEqual(pessoaDaConta(NEGO_DOCE), "JayJ", "NEGO DOCE e a conta principal do JayJ");
assert.strictEqual(pessoaDaConta(M4DM4X), "JayJ", "M4DM4X e conta alternativa do JayJ");

// A conta principal nunca perde o posto para uma alternativa de outra pessoa.
assert.strictEqual(metadata.playersByPuuid.get(MNDEUS).puuid, MNDEUS, "id do Mendes continua sendo o puuid da mndeuS");
assert.strictEqual(metadata.playersByPuuid.get(SUREBETEIRO).puuid, SUREBETEIRO, "id do Laves continua sendo o puuid da surebeteiro");

// --- 2. Partida real: cada pessoa aparece uma vez so --------------------------
const FIXTURE = "campeonatos/JUBS/Fase Inicial/JUBS_002a_02-06-26_ufg_gc_eagles_0_x_13_uninassau_griffins_haven.json";
const original = readJson(FIXTURE);
const partidaReal = parseMatchFile({ eventId: "jubs-fase-inicial", path: FIXTURE, raw: original }, metadata);
const uninassauReal = partidaReal.players.filter((player) => player.teamId === "uninassau_griffins");
assert.strictEqual(uninassauReal.length, 5, "a partida real tem 5 jogadores da Uninassau");
assert.strictEqual(new Set(uninassauReal.map((player) => player.id)).size, 5, "os 5 sao pessoas distintas");
assert.deepStrictEqual(
  uninassauReal.map((player) => player.nick).sort(),
  ["JV", "JayJ", "Laves", "Mendes", "Peso"],
  "as contas Joy e jannik sinner aparecem como Mendes e Laves",
);
// O nick vira o da pessoa, mas o handle guarda a conta que ela usou na partida.
const lavesReal = uninassauReal.find((player) => player.nick === "Laves");
assert.strictEqual(lavesReal.puuid, JANNIK, "o puuid da linha continua sendo o da conta usada");
assert.strictEqual(lavesReal.handle, "jannik sinner#ATP", "o handle preserva a conta usada na partida");

// --- 3. Conta emprestada: a regra diz quem estava em cada conta ---------------
// Troca o puuid da jannik sinner pelo da mndeuS: agora mndeuS e Joy estao na
// mesma partida, o cenario que SHARED_ACCOUNT_RULES cobre.
const emprestada = JSON.parse(JSON.stringify(original));
const linhaJannik = emprestada.players.find((player) => player.puuid === JANNIK);
linhaJannik.puuid = MNDEUS;
linhaJannik.gameName = "mndeuS";
linhaJannik.tagLine = "mila";

const partidaEmprestada = parseMatchFile({ eventId: "jubs-fase-inicial", path: FIXTURE, raw: emprestada }, metadata);
const porConta = new Map(partidaEmprestada.players.map((player) => [player.puuid, player]));
assert.strictEqual(porConta.get(MNDEUS).nick, "Laves", "com as duas contas juntas, quem estava na mndeuS era o Laves");
assert.strictEqual(porConta.get(JOY).nick, "Mendes", "com as duas contas juntas, quem estava na Joy era o Mendes");
assert.strictEqual(
  porConta.get(MNDEUS).id,
  SUREBETEIRO,
  "a linha da mndeuS soma para o Laves, cujo id e o puuid da surebeteiro",
);
assert.strictEqual(porConta.get(JOY).id, MNDEUS, "a linha da Joy soma para o Mendes, cujo id e o puuid da mndeuS");
const uninassauEmprestada = partidaEmprestada.players.filter((player) => player.teamId === "uninassau_griffins");
assert.strictEqual(new Set(uninassauEmprestada.map((player) => player.id)).size, 5, "continuam 5 pessoas distintas");

// A regra so vale com as duas contas juntas: sozinha, a mndeuS e do Mendes.
assert.strictEqual(
  sharedAccountOverrides(new Set([MNDEUS])).size,
  0,
  "uma conta so nao dispara a regra - a unificacao normal ja acerta",
);
assert.strictEqual(sharedAccountOverrides(new Set([MNDEUS, JOY])).size, 2, "as duas juntas disparam a regra");

// --- 4. Conflito sem regra derruba o build -----------------------------------
// jannik sinner e surebeteiro sao as duas contas do Laves e nenhuma regra
// descreve esse par: o certo e parar, nao publicar o Laves duas vezes.
const conflito = JSON.parse(JSON.stringify(original));
conflito.players.find((player) => player.puuid === JOY).puuid = SUREBETEIRO;
assert.throws(
  () => parseMatchFile({ eventId: "jubs-fase-inicial", path: FIXTURE, raw: conflito }, metadata),
  /resolvem para a mesma pessoa \(Laves\)/,
  "duas contas do mesmo dono sem regra derrubam o build",
);

console.log("Shared account tests passed");
