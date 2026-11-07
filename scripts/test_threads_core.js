// Threads livres: o nucleo do front (community-core.js) contra o Supabase falso
// (fake_supabase.js), que segue as regras do 0008. Roda no Node, sem navegador:
//   node scripts/test_threads_core.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const raiz = path.join(__dirname, "..");
const ALICE = "11111111-1111-4111-8111-111111111111";
const BRUNO = "22222222-2222-4222-8222-222222222222";
const ORFA = "33333333-3333-4333-8333-333333333333";
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

function novoContexto() {
  const window = {
    location: { href: "http://localhost:8000/", hash: "", search: "" },
    history: { replaceState: () => {} },
    addEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    __FAKE_SUPABASE__: {
      atraso: [0, 0],
      usuarios: [
        { id: ALICE, email: "alice@teste.univlr", senha: "a", username: "alice_teste" },
        { id: BRUNO, email: "bruno@teste.univlr", senha: "b", username: "bruno_teste" },
      ],
      topicos: [{ id: ORFA, autor: null, title: "Thread de conta apagada", body: "", minutosAtras: 600 }],
    },
  };
  const context = { window, console, Date, Map, Set, Promise, URL, URLSearchParams, setTimeout, clearTimeout, JSON, Math };
  window.window = window;
  vm.createContext(context);
  for (const arq of ["scripts/fake_supabase.js", "community-core.js"]) {
    vm.runInContext(fs.readFileSync(path.join(raiz, arq), "utf8"), context, { filename: arq });
  }
  return window;
}

async function entra(C, email, senha) {
  if (C.logado()) await C.sair();
  await C.entrar({ email, password: senha });
  await espera(5);
}

async function rejeita(promessa, trecho) {
  try {
    await promessa;
  } catch (erro) {
    const texto = (erro && erro.message) || String(erro);
    assert.ok(texto.includes(trecho), `esperava erro com "${trecho}", veio "${texto}"`);
    return;
  }
  assert.fail(`esperava erro com "${trecho}", passou`);
}

(async () => {
  const w = novoContexto();
  const C = w.Community;
  await C.init();

  // Abrir e listar.
  await entra(C, "alice@teste.univlr", "a");
  const t1 = await C.criarTopico("Quem leva a Univavá?", "");
  assert.ok(/^[0-9a-f-]{36}$/.test(t1), "criarTopico devolve o id");
  let lista = await C.listarTopicos();
  assert.strictEqual(lista.total, 2, "a nova e a da semente");
  assert.strictEqual(lista.itens[0].id, t1, "a mais nova vem primeiro");
  assert.strictEqual(lista.itens[0].respostas, 0);
  assert.strictEqual(lista.itens[0].author_username, "alice_teste");

  // Validacao e limite, com as mensagens do banco.
  await rejeita(C.criarTopico("  abcd ", ""), "entre 5 e 120");
  await espera(5);
  const t2 = await C.criarTopico("Procurando quinto para a LUCE", "");
  await espera(5);
  await C.criarTopico("Terceira da hora", "");
  await rejeita(C.criarTopico("Quarta da hora", ""), "muitas threads seguidas");

  // Comentario sobe a thread e avisa quem abriu.
  await entra(C, "bruno@teste.univlr", "b");
  await espera(5);
  const c1 = await C.comentar("topic", t2, "eu topo");
  lista = await C.listarTopicos();
  assert.strictEqual(lista.itens[0].id, t2, "a comentada passa a mais nova sem comentario");
  assert.strictEqual(lista.itens[0].respostas, 1);

  await entra(C, "alice@teste.univlr", "a");
  let avisos = await C.listarNotificacoes();
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].kind, "topic_reply");
  assert.strictEqual(avisos[0].comments.threads.subject_kind, "topic");
  assert.strictEqual(avisos[0].comments.threads.subject_id, t2);

  // Resposta a ela, na thread dela: um aviso so.
  const c2 = await C.comentar("topic", t2, "valeu");
  await entra(C, "bruno@teste.univlr", "b");
  await C.comentar("topic", t2, "de nada", c2);
  await entra(C, "alice@teste.univlr", "a");
  avisos = await C.listarNotificacoes();
  assert.strictEqual(avisos.length, 2, "um aviso pela resposta, nao dois");
  assert.strictEqual(avisos.filter((a) => a.kind === "reply").length, 1);

  // A thread aberta e o autor.
  const t = await C.topico(t2);
  assert.strictEqual(t.title, "Procurando quinto para a LUCE");
  assert.strictEqual(t.autor.username, "alice_teste");
  assert.strictEqual(await C.topico("nao-e-uuid"), null);
  assert.strictEqual(await C.topico("00000000-0000-4000-8000-000000000000"), null);

  // Conta apagada.
  const orfa = await C.topico(ORFA);
  assert.strictEqual(orfa.autor, null);
  lista = await C.listarTopicos();
  assert.strictEqual(lista.itens.find((x) => x.id === ORFA).author_username, null);

  // Editar e apagar.
  await C.editarTopico(t1, "Quem leva a Univavá 2026?", "palpites");
  assert.strictEqual((await C.topico(t1)).title, "Quem leva a Univavá 2026?");
  assert.ok((await C.topico(t1)).edited_at);
  await C.apagarTopico(t1);
  lista = await C.listarTopicos();
  assert.ok(!lista.itens.some((x) => x.id === t1), "apagada sai da lista");
  assert.ok((await C.topico(t1)).deleted_at, "apagada continua legivel, como apagada");
  await rejeita(C.comentar("topic", t1, "x"), "thread nao existe");
  await rejeita(C.comentar("topic", "nao-e-uuid", "x"), "thread nao existe");

  // Bruno nao apaga a dos outros.
  await entra(C, "bruno@teste.univlr", "b");
  await rejeita(C.apagarTopico(t2), "sem permissao");

  // Paginacao.
  lista = await C.listarTopicos({ pagina: 2, porPagina: 2 });
  assert.strictEqual(lista.total, 3);
  assert.strictEqual(lista.itens.length, 1);

  // Titulos e recentes.
  await C.titulosDeTopicos([t2, t1, "lixo"]);
  assert.strictEqual(C.tituloDoTopico(t2), "Procurando quinto para a LUCE");
  assert.strictEqual(C.tituloDoTopico(t1), null, "apagada nao tem titulo");
  await C.carregarResumo();
  const recentes = C.topicosRecentes();
  assert.ok(recentes.length >= 1 && recentes.length <= 5);
  assert.strictEqual(recentes[0].id, t2);

  console.log("test_threads_core: ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
