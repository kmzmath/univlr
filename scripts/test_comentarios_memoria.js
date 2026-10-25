// Comentarios buscados uma vez por visita (pedido do dono em 24/10): trocar o
// jogador da comparacao, ordenar o scoreboard ou trocar a aba de mapa da mesma
// serie redesenha a pagina, e o redesenho nao deve ir ao Supabase de novo.
// Sair da pagina e voltar, ou abrir outra partida, busca de novo.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let buscas = 0;
// O que estiver escrito na caixa de comentario do DOM atual. O redesenho troca
// o DOM, entao a caixa nova nasce vazia e o rascunho precisa sobreviver.
let caixaAtual = null;
const noop = () => {};
const raiz = (caixa = () => caixaAtual) => ({
  innerHTML: "",
  dataset: {},
  addEventListener: noop,
  dispatchEvent: noop,
  querySelector: (sel) => (sel === "textarea[name=corpo]" ? caixa() : null),
});
let raizAtual = null;
const context = {
  console,
  Date,
  Set,
  Map,
  Promise,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: noop,
  CustomEvent: class {
    constructor(tipo, opcoes) {
      Object.assign(this, { tipo, ...opcoes });
    }
  },
  window: {
    addEventListener: noop,
    Community: {
      esc: (v) => String(v ?? ""),
      listarComentarios: async () => {
        buscas += 1;
        return { comentarios: [], meusVotos: new Map() };
      },
      logado: () => true,
      banido: () => false,
      mensagemDeErro: (e) => String(e),
    },
  },
  document: {
    querySelector: (sel) => (sel.includes("data-comentarios") ? raizAtual : null),
    getElementById: () => null,
    body: { scrollHeight: 0 },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "comments.js"), "utf8"), context);
const C = context.window.Comments;

// Uma render da pagina: o roteador avisa (quando e navegacao), o HTML com a
// casca sai, o DOM e trocado e a conversa e montada.
async function pagina(kind, id, { navegacao = true } = {}) {
  if (navegacao) C.novaRender();
  if (kind) C.shell(kind, id);
  raizAtual = raiz();
  caixaAtual = null;
  if (kind) await C.montar(kind, id);
}

(async () => {
  await pagina("match", "serie-1");
  assert.strictEqual(buscas, 1, "abrir a partida busca a conversa");

  await pagina("match", "serie-1", { navegacao: false });
  assert.strictEqual(buscas, 1, "trocar o jogador da comparacao nao busca de novo");

  await pagina("match", "serie-1");
  assert.strictEqual(buscas, 1, "trocar a aba de mapa da mesma serie nao busca de novo");

  await pagina(null);
  await pagina("match", "serie-1");
  assert.strictEqual(buscas, 2, "sair para outra pagina e voltar busca de novo");

  await pagina("match", "serie-2");
  assert.strictEqual(buscas, 3, "outra partida busca a conversa dela");

  // O rascunho: escrito antes do redesenho, continua na caixa nova.
  caixaAtual = { value: "boa serie" };
  C.shell("match", "serie-2");
  const caixaNova = { value: "" };
  raizAtual = raiz(() => caixaNova);
  await C.montar("match", "serie-2");
  assert.strictEqual(buscas, 3, "o redesenho com rascunho tambem nao busca");
  assert.strictEqual(caixaNova.value, "boa serie", "o texto que a pessoa estava escrevendo sobrevive ao redesenho");

  console.log("Comentarios memory tests passed");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
