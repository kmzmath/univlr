// Contrato da pagina /cartas/ e das conversas das cartinhas. Roda so com o
// Node, sem navegador: `node scripts/test_cartinhas.js`. O teste no navegador,
// com o Supabase falso, e o scripts/test_cartinhas_navegador.cjs.
//
// Carrega cartas/app.js e comments.js num contexto vm com o DOM em stub, do
// mesmo jeito que os outros test_*.js, e confere o manifesto publicado.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), "utf8");
const manifesto = JSON.parse(ler("cartas/manifest.json"));
const TEXTO = "É revelado um lote de cartinhas por dia, em ordem do menor para o maior overall. No total são 216 cartinhas, de jogadores com pelo menos 200 rounds e 12 mapas jogados no ano. Última revelação em 24 de novembro.";

// ------------------------------------------------------------- manifesto

const reveladas = manifesto.days.filter((day) => day.cards);
assert.strictEqual(manifesto.total, 216);
assert.strictEqual(manifesto.days.length, 33);
assert.strictEqual(manifesto.days.reduce((soma, day) => soma + day.count, 0), 216);
assert.strictEqual(manifesto.days.at(-1).date, "2026-11-24");
assert(manifesto.days.every((day, i) => !day.cards || i < reveladas.length), "so os primeiros dias tem cartinhas");
assert(reveladas.every((day) => day.cards.length === day.count), "dia revelado traz todas as cartinhas dele");
assert(reveladas.at(-1).date <= manifesto.publishedThrough);

// #1 e a melhor e a ultima: a revelacao desce de 216.
let esperada = manifesto.total;
for (const day of reveladas) {
  const ranks = day.cards.map((card) => card.rank).sort((a, b) => b - a);
  for (const rank of ranks) assert.strictEqual(rank, esperada--, `posicao fora da ordem em ${day.date}`);
}
const primeiro = manifesto.days[0].cards.map((card) => card.rank).sort((a, b) => a - b);
assert.deepStrictEqual(primeiro, [207, 208, 209, 210, 211, 212, 213, 214, 215, 216], "23/10 revelou #216 a #207");

// O formato do assunto e o mesmo que o banco aceita na 0007.
const migracao = ler("supabase/migrations/0007_cartinhas.sql");
assert(/'card'\)\);/.test(migracao), "0007 aceita o tipo card");
const formato = new RegExp(/subject_id ~ '([^']+)'/.exec(migracao)[1]);
const cartas = reveladas.flatMap((day) => day.cards);
for (const card of cartas) {
  assert.strictEqual(card.image, `cards/${String(card.rank).padStart(3, "0")}.webp`);
  assert(fs.existsSync(path.join(raiz, "cartas", card.image)), `imagem ausente: ${card.image}`);
  assert(card.thread.startsWith(`${manifesto.season}:`) && formato.test(card.thread), `assunto fora do formato: ${card.thread}`);
  assert(Number.isFinite(card.opponentStrength), `${card.name} sem forca de adversario`);
  assert(!("adjustedRating" in card), `${card.name} ainda traz o rAAting ajustado`);
}
assert(formato.test(String(manifesto.season)), "a conversa da colecao cabe no formato");
assert(!formato.test("qualquer coisa") && !formato.test("2026:<script>") && !formato.test("2026:"), "o formato recusa assunto inventado");
assert.strictEqual(new Set(cartas.map((card) => card.thread)).size, cartas.length, "uma conversa por cartinha");

// Nenhuma imagem alem das liberadas.
const imagens = fs.readdirSync(path.join(raiz, "cartas/cards")).sort();
assert.deepStrictEqual(imagens, cartas.map((card) => card.image.slice("cards/".length)).sort(), "a pasta cards tem so as cartinhas liberadas");

// ------------------------------------------------------------- pagina

const html = ler("cartas/index.html");
assert(html.includes(`<p id="regra">${TEXTO}</p>`), "o HTML traz o texto unico");
assert(!html.includes("Os próximos nomes continuam em segredo"), "o texto antigo saiu");
const ordem = ["UNIVLR_RAIZ", "/supabase-js.js", "/community-core.js", "/comments.js", "/auth.js", "app.js?v="].map((trecho) => html.indexOf(trecho));
assert(ordem.every((pos, i) => pos > 0 && (i === 0 || pos > ordem[i - 1])), "scripts da comunidade antes do app.js, com o prefixo antes de todos");
assert(html.includes('class="conta-slot"') && html.includes('id="comentarios"'), "espaco da conta e conversa da colecao");

function elemento() {
  return {
    innerHTML: "",
    textContent: "",
    value: "",
    hidden: false,
    dataset: {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function carregaCartas(agora) {
  const elementos = new Map();
  class DataFalsa extends Date {
    static now() {
      return agora.valor;
    }
  }
  const contexto = {
    console,
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Promise,
    Set,
    String,
    Date: DataFalsa,
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame() {},
    fetch: () => new Promise(() => {}),
    location: { hash: "" },
    document: {
      getElementById: (id) => {
        if (!elementos.has(id)) elementos.set(id, elemento());
        return elementos.get(id);
      },
      querySelector: () => elemento(),
      querySelectorAll: () => [],
      addEventListener() {},
    },
  };
  contexto.window = contexto;
  contexto.addEventListener = () => {};
  vm.createContext(contexto);
  vm.runInContext(ler("cartas/app.js"), contexto, { filename: "cartas/app.js" });
  return { contexto, el: (id) => contexto.document.getElementById(id) };
}

const agora = { valor: Date.parse("2026-10-24T20:00:00-03:00") };
const { contexto: cx, el } = carregaCartas(agora);

assert.strictEqual(cx.horaDaRevelacao("2026-10-24"), Date.parse("2026-10-24T21:30:00-03:00"), "21:30 de Brasilia");
assert.strictEqual(cx.horaDaRevelacao("2026-10-31"), Date.parse("2026-10-31T21:30:00-03:00"), "virada de mes");
assert.strictEqual(cx.tempoQueFalta(90 * 60 * 1000), "1h 30min 00s");
assert.strictEqual(cx.tempoQueFalta(65 * 1000), "1min 05s");
assert.strictEqual(cx.tempoQueFalta(9 * 1000), "9s");
assert.strictEqual(cx.comSinal(-0.14782), "-0,15");
assert.strictEqual(cx.comSinal(0.051), "+0,05");
assert.strictEqual(cx.comSinal(-0.001), "0,00");
assert.strictEqual(cx.comSinal(undefined), "-");

// O comportamento da pagina e conferido num retrato fixo de 23/10 (so o
// primeiro lote revelado): o manifesto publicado cresce um dia por vez, e as
// contas abaixo (10 reveladas, a proxima e a #206) valem para aquele dia.
const de23 = JSON.parse(JSON.stringify(manifesto));
de23.publishedThrough = "2026-10-23";
de23.days.forEach((day, i) => {
  if (i > 0) delete day.cards;
});
cx.aplicar(de23);
assert.strictEqual(el("regra").textContent, TEXTO, "o texto sai igual do manifesto");
assert.match(el("contagem").innerHTML, /<b>10<\/b><span>de 216 reveladas/);
assert(el("contagem").innerHTML.includes(`data-alvo="${Date.parse("2026-10-24T21:30:00-03:00")}"`), "o relogio aponta para 24/10 21:30");
assert.match(el("contagem").innerHTML, /24 de outubro, às 21:30 de Brasília, 10 cartinhas \(#206 a #197\)/);
const lista = el("dias").innerHTML;
assert.deepStrictEqual([...lista.matchAll(/class="r-pos">(#\d+)</g)].map((m) => m[1]), ["#207", "#208", "#209", "#210", "#211", "#212", "#213", "#214", "#215", "#216"]);
assert(lista.includes("Força média de adversário") && !lista.includes("Ajustado"), "forca de adversario no lugar do ajustado");
assert.match(lista, /<span class="r-ovr"><span class="r-cmt" data-thread="2026:[^"]+"><\/span><b aria-label="Overall \d+">/, "o selo vem antes do overall");
assert(!lista.includes("cmt-carta") && el("comentarios").hidden, "sem os scripts da comunidade, a conversa nao aparece");
assert.match(el("calendario").innerHTML, /24 de outubro: 10 cartinhas, #206 a #197/);

// Edicao do dia seguinte que chegou antes da hora: fica fora ate as 21:30.
const comDia24 = JSON.parse(JSON.stringify(de23));
comDia24.days[1].cards = de23.days[0].cards.map((card, i) => ({ ...card, rank: 206 - i, name: `Teste ${206 - i}`, thread: `2026:teste${i}` }));
comDia24.publishedThrough = "2026-10-24";
agora.valor = Date.parse("2026-10-24T21:29:59-03:00");
cx.aplicar(comDia24);
assert(!el("dias").innerHTML.includes("Teste 206"), "antes das 21:30 a edicao nova nao aparece");
assert.match(el("contagem").innerHTML, /<b>10<\/b>/);
agora.valor = Date.parse("2026-10-24T21:30:00-03:00");
cx.aplicar(comDia24);
assert(el("dias").innerHTML.includes("Teste 206"), "as 21:30 a edicao entra");
assert.match(el("contagem").innerHTML, /<b>20<\/b>/);
assert.match(el("contagem").innerHTML, /25 de outubro, às 21:30 de Brasília, 10 cartinhas \(#196 a #187\)/);

// ------------------------------------------------------------- comments.js

function carregaComentarios(raizDoSite) {
  const contexto = {
    console,
    Date,
    Map,
    WeakMap,
    Set,
    String,
    Number,
    Math,
    JSON,
    CustomEvent: class {},
    document: { querySelector: () => null },
  };
  contexto.window = contexto;
  contexto.UNIVLR_RAIZ = raizDoSite;
  contexto.Community = {
    esc: (valor) => String(valor ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]),
    contagem: (kind, id) => (kind === "card" && id === "2026" ? 2 : 0),
  };
  vm.createContext(contexto);
  vm.runInContext(ler("comments.js"), contexto, { filename: "comments.js" });
  return contexto.Comments;
}

const naCartinha = carregaComentarios("/");
const corpo = naCartinha.corpo("oi @bruno_teste, veja [url=#/players/mile]o perfil[/url] e [url]https://x.com/a[/url]");
assert(corpo.includes('href="/#/u/bruno_teste"'), "mencao volta ao site");
assert(corpo.includes('href="/#/players/mile"'), "link interno volta ao site");
assert(corpo.includes('href="https://x.com/a" target="_blank"'), "link externo fica como esta");
assert(!naCartinha.corpo("[url=javascript:alert(1)]x[/url]").includes("javascript:"), "esquema perigoso continua barrado");
assert.match(naCartinha.selo("card", "2026"), /<span>2<\/span>/, "selo pela contagem carregada");
assert.match(naCartinha.selo("card", "2026", 5), /<span>5<\/span>/, "selo pelo total de quem desenhou");
assert.strictEqual(naCartinha.selo("card", "2026:x", 0), "", "sem comentario, sem selo");
assert.deepStrictEqual({ ...naCartinha.assuntoDaThread("card", "2026") }, { href: "/cartas/#comentarios", nome: "Cartinhas 2026" });
assert.strictEqual(naCartinha.assuntoDaThread("card", "2026:abc_1-2").href, "/cartas/#jogador-abc_1-2");

const noSite = carregaComentarios(undefined);
assert(noSite.corpo("oi @bruno_teste").includes('href="#/u/bruno_teste"'), "no site o link continua relativo");

console.log("cartinhas: contrato da pagina, do manifesto e dos comentarios ok");
