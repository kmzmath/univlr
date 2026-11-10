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

function loadScript(relativePath, epilogue = "") {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  (0, eval)(source + epilogue);
}

loadScript("raating-core.js");
loadScript("ranking-core.js");
loadScript("app.js", ";globalThis.__sharedAccountsAppState = state; globalThis.__historicalPeople = HISTORICAL_PEOPLE_2024;");

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

// --- 5. Perfis antigos continuam unidos no cadastro, nas partidas e nas rotas -
// Alternativas globais exigem confirmacao da pessoa para todo esse historico.
const decoded = require("../db-codec.js").decode(readJson("database.json"));
globalThis.__sharedAccountsAppState.db = decoded;
const unified = [
  { name: "swpz", oldRoute: "sweepzz", handle: "burger burglar#fat" },
  { name: "Balalov3", oldRoute: "balalov3-s2", handle: "balalov3   s2#pas" },
];
for (const { name, oldRoute, handle } of unified) {
  const registered = metadata.players.find((player) => player.name === name);
  const aggregate = decoded.players.find((player) => player.id === registered.puuid);
  const account = aggregate.accounts.find((entry) => entry.handle === handle);
  assert.ok(account, `${name} conserva a conta ${handle}`);
  assert.strictEqual(pessoaDaConta(account.puuid), name, `${handle} aponta para ${name} no cadastro de origem`);
  assert.strictEqual(playerById(oldRoute), aggregate, `a rota antiga ${oldRoute} abre ${name}`);
  assert.strictEqual(playerById(account.puuid), aggregate, `o link pela conta antiga abre ${name}`);
  assert.ok(!decoded.players.some((player) => player.routeSlug === oldRoute), `${oldRoute} nao reaparece como perfil separado`);
  const appearances = decoded.matches.flatMap((match) => match.players.filter((player) => player.puuid === account.puuid));
  assert.ok(appearances.length > 0, `${handle} tem partidas na base`);
  assert.ok(appearances.every((player) => player.id === registered.puuid), `todo o historico de ${handle} soma para ${name}`);
  const matches = decoded.matches.filter((match) => match.players.some((player) => player.id === aggregate.id));
  assert.strictEqual(aggregate.matches, matches.length, `${name} agrega todos os mapas uma unica vez`);
  assert.strictEqual(aggregate.rounds, matches.reduce((total, match) => total + match.players.find((player) => player.id === aggregate.id).rounds, 0), `${name} conserva o total de rounds`);
}

// --- 6. Identificacoes confirmadas por mapa nao viram alternativas globais ---
// Em 09/11/2026 o responsavel liberou somente quatro mapas de vrnx/yakult
// e dez de Harry Kane no JUBS. A pendencia anterior continua fora dessa lista.
// Mesma conta, equipe e companheiros nao autorizam estender essa confirmacao.
const confirmedNassauJubs = new Set([
  "4f634d8c-6db6-41b7-ae41-a440e4af4916",
  "499be652-ad00-467b-8482-d4c06f54901c",
  "a23bad20-cc61-4702-9ecc-c88790c822dd",
  "efe69ecd-24ec-4dc3-a263-de67bab0b210",
]);
const confirmedHarryJubs = new Set([
  "baaabe1a-d8d5-472d-9c8d-65aa87c8c695",
  "7e1c1793-bc8d-4455-912b-079935393bea",
  "04b4c144-c1c3-47f3-8b75-821ed02cdca8",
  "5d2cc855-b483-4224-875f-e860344cb79e",
  "87933bfa-06ee-4863-92e3-794102e5e20d",
  "b331fdc5-d73c-4af3-a62e-b3f9aea946c2",
  "f06a90f6-a48a-46e7-8dad-991252a44da7",
  "532d1d43-0a60-4d60-a5e4-657c5bfe0671",
  "84be44aa-3a6b-4888-aeec-fa377f1a2b74",
  "99dbf525-1fe1-4fab-96cc-b99d89a4e00d",
]);
const scopedAccounts = [
  { name: "Peso", route: "vrnx", handle: "vrnx#vlr", account: "_lm4wvldJGlh78VM9JgUKkiiYRyBRTumTVFUQJuFfdVsG4VTA90i_xrF5x_ulA95T6enfThFjr5VLQ" },
  { name: "Laves", route: "yakult", handle: "yakult#ttt", account: "tqZorWhqNTDQLNe16COgqKHMml_lrpfb8gpzcVji9IuXngt7pPHqmV8NoZGA3YZED8N09pBbM5uykQ" },
  { name: "suvas", route: "harry-kane-9", handle: "Harry Kane 9#MFMA", account: "Yb3XQ4g2ozd3TnNWq31ZGmy0waIdeh85cSdaLw6kRl3W7oae8O1Y50cLoQLixZYWhU3WZ1CiwFQg8A" },
];
for (const { name, route, handle, account } of scopedAccounts) {
  const approved = name === "suvas" ? confirmedHarryJubs : confirmedNassauJubs;
  const person = metadata.players.find((player) => player.name === name);
  assert.strictEqual(pessoaDaConta(account), undefined, `${handle} nao tem dono global confirmado no cadastro`);
  const jubs = decoded.matches.filter((match) => match.eventId.startsWith("jubs-2024-") && match.players.some((player) => player.puuid === account));
  assert.strictEqual(jubs.filter((match) => approved.has(match.id)).length, approved.size, `${handle} tem todos os mapas aprovados na base`);
  const pending = [];
  for (const match of jubs) {
    const override = sharedAccountOverrides(new Set(match.players.map((player) => player.puuid)), match.id).get(account);
    const player = match.players.find((entry) => entry.puuid === account);
    if (approved.has(match.id)) {
      assert.strictEqual(override, person.puuid, `${match.id}: regra especifica para ${name}`);
      assert.strictEqual(player.id, person.puuid, `${match.id}: mapa aprovado soma para ${name}`);
      continue;
    }
    assert.strictEqual(override, undefined, `${match.id}: mapa fora da lista nao foi liberado`);
    assert.strictEqual(player.id, account, `${match.id}: ${handle} conserva a identidade da conta pendente`);
    assert.strictEqual(player.registered, false, `${match.id}: ${handle} continua sem confirmacao de pessoa`);
    pending.push(player);
  }
  assert.strictEqual(pending.length, jubs.length - approved.size);
  assert.strictEqual(playerById(route)?.id, pending.length ? account : person.puuid, `${route} respeita a existencia de atuacoes pendentes`);
  assert.strictEqual(sharedAccountOverrides(new Set([account]), "mapa-fora-do-escopo-confirmado").size, 0, `${handle} nao recebe atribuicao em mapas futuros sem confirmacao`);
  const confirmed = decoded.matches.filter((match) => match.eventId.startsWith("alianca-2024") && match.players.some((player) => player.puuid === account));
  assert.ok(confirmed.length > 0);
  for (const match of confirmed) assert.strictEqual(match.players.find((player) => player.puuid === account).id, person.puuid, `${match.id}: a confirmacao da Copa para ${name} foi preservada`);
}

// Um novo mapa pendente de Harry Kane deve voltar a abrir seu proprio perfil,
// mesmo com o link antigo redirecionando hoje para as dez atuacoes de suvas.
const futurePendingHarry = { id: scopedAccounts[2].account, routeSlug: "harry-kane-9", accounts: [] };
decoded.players.push(futurePendingHarry);
try {
  assert.strictEqual(playerById("harry-kane-9"), futurePendingHarry, "perfil pendente tem prioridade sobre rota historica");
} finally {
  decoded.players.pop();
}

// Confere tambem as excecoes reais da Uninassau, incluindo as 18 partidas de
// 2025 e a Haven contra CAAP: o titular da conta pode ser outra pessoa no mapa.
let checkedOverrides = 0;
for (const match of decoded.matches) {
  const overrides = sharedAccountOverrides(new Set(match.players.map((player) => player.puuid)), match.id);
  for (const [account, target] of overrides) {
    const person = metadata.playersByPuuid.get(target) || globalThis.__historicalPeople[target];
    assert.ok(person, `${match.id}: pessoa confirmada ${target} existe`);
    const player = match.players.find((entry) => entry.puuid === account);
    assert.strictEqual(player.id, person.puuid || `registered-${slugify(person.name)}`, `${match.id}: atribuicao por partida preservada para ${player.handle}`);
    checkedOverrides += 1;
  }
}
assert.ok(checkedOverrides > 0, "excecoes reais de contas compartilhadas foram conferidas");

console.log("Shared account tests passed");
