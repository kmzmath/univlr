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
const ADM = "44444444-4444-4444-8444-444444444444";
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
        { id: ADM, email: "adm@teste.univlr", senha: "c", username: "adm_teste", role: "admin" },
      ],
      topicos: [{ id: ORFA, autor: null, title: "Thread de conta apagada", body: "", minutosAtras: 600 }],
    },
  };
  const document = { addEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { scrollHeight: 0 } };
  window.document = document;
  window.Blob = Blob;
  const context = { window, document, console, Date, Map, Set, Promise, URL, URLSearchParams, setTimeout, clearTimeout, JSON, Math, Blob };
  window.window = window;
  vm.createContext(context);
  for (const arq of ["scripts/fake_supabase.js", "community-core.js", "comments.js"]) {
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
  // Titulo so de invisiveis nao passa, e as pontas invisiveis saem; a tela
  // mostra o que o banco guardou, nao um trim proprio.
  await rejeita(C.criarTopico("\t ​​​ ", ""), "entre 5 e 120");
  const editado = await C.editarTopico(t1, " ​ Univavá 2026, quem leva? ", "");
  assert.strictEqual(editado.title, "Univavá 2026, quem leva?");
  assert.strictEqual(C.tituloDoTopico(t1), "Univavá 2026, quem leva?");
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

  // Encaixes: a thread livre vira assunto com titulo e link, mas fica fora da
  // faixa de atividade recente (ela tem painel proprio).
  const Cm = w.Comments;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(Cm.assuntoDaThread("topic", t2))), { href: `#/forum/${t2}`, nome: "Procurando quinto para a LUCE" });
  assert.strictEqual(Cm.assuntoDaThread("topic", t1), null, "apagada nao vira assunto");
  await C.carregarContagens();
  assert.ok(!Cm.atividadeFaixa(5).includes("#/forum/"), "thread livre nao entra na atividade recente");

  // Patch notes (0011): so admin publica, ate 8.000 caracteres, e as listas
  // separam as secoes; sem secao, a lista traz tudo (painel da home).
  await entra(C, "bruno@teste.univlr", "b");
  await rejeita(C.criarTopico("Patch notes falso", "x", "patch"), "so admin publica patch notes");
  await entra(C, "adm@teste.univlr", "c");
  await rejeita(C.criarTopico("Thread geral comprida", "a".repeat(2001)), "no maximo 2000");
  const p1 = await C.criarTopico("Patch notes 16/11", "a".repeat(8000), "patch");
  assert.ok(/^[0-9a-f-]{36}$/.test(p1), "admin publica patch notes de 8000");
  const patches = await C.listarTopicos({ secao: "patch" });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(patches.itens.map((x) => [x.id, x.secao]))), [[p1, "patch"]], "a lista de patch notes so tem eles");
  const gerais = await C.listarTopicos({ secao: "geral" });
  assert.ok(!gerais.itens.some((x) => x.id === p1) && gerais.total === 3, "a lista geral nao tem patch notes");
  assert.ok((await C.listarTopicos()).itens.some((x) => x.id === p1), "sem secao, a lista traz tudo");
  assert.strictEqual((await C.topico(p1)).secao, "patch", "a thread sabe que e patch notes");
  assert.strictEqual(C.mensagemDeErro({ message: "so admin publica patch notes" }), "Só admin publica patch notes.");
  assert.strictEqual(C.mensagemDeErro({ message: "so admin edita patch notes" }), "Só admin edita patch notes.");
  // Fotos do patch notes (0013): so admin envia, e o [img] so vira foto quando a
  // opcao esta ligada e o endereco e da pasta patch-notes do nosso Supabase.
  const prefixo = C.prefixoDasFotos();
  assert.ok(/^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/patch-notes\/$/.test(prefixo), "prefixo da pasta publica");
  const foto = await C.enviarFotoDePatch(new w.Blob(["x"], { type: "image/webp" }));
  assert.ok(foto.startsWith(prefixo) && /^[0-9]{4}\/[0-9]{2}\/[A-Za-z0-9-]+\.webp$/.test(foto.slice(prefixo.length)), `admin envia foto: ${foto}`);
  await rejeita(C.enviarFotoDePatch(new w.Blob(["x"], { type: "image/gif" })), "formato de foto nao aceito");
  const Cmt = w.Comments;
  const comFoto = Cmt.corpo(`antes\n[img]${foto}[/img]\ndepois`, { imagens: true });
  assert.ok(comFoto.includes(`<img class="cmt-img" src="${foto}" alt="" loading="lazy">`), "foto da pasta vira imagem");
  assert.ok(!/<br>\s*<img|<img[^>]*>\s*<br>/.test(comFoto), "sem linha vazia em volta da foto");
  assert.ok(!Cmt.corpo(`[img]${foto}[/img]`).includes("<img"), "sem a opcao (comentario, thread comum), [img] fica texto");
  assert.ok(!Cmt.corpo("[img]https://exemplo.com/x.png[/img]", { imagens: true }).includes("<img"), "endereco de fora nao vira imagem");
  const injecao = Cmt.corpo(`[img]${prefixo}a.webp" onerror="alert(1)[/img]`, { imagens: true });
  assert.ok(!injecao.includes("<img") && !/onerror="/.test(injecao), "aspas no endereco nao viram atributo");
  await entra(C, "bruno@teste.univlr", "b");
  await rejeita(C.enviarFotoDePatch(new w.Blob(["x"], { type: "image/webp" })), "row-level security");
  await entra(C, "adm@teste.univlr", "c");

  // Admin corrige o proprio patch notes; o Supabase falso segue a 0012.
  await C.editarTopico(p1, "Patch notes 16/11 corrigido", "b".repeat(8000));
  assert.strictEqual((await C.topico(p1)).title, "Patch notes 16/11 corrigido", "admin edita o proprio patch notes");
  assert.strictEqual(C.mensagemDeErro({ message: "texto pode ter no maximo 8000 caracteres" }), "O texto pode ter no máximo 8.000 caracteres.");

  // A mensagem do banco chega sem acento; a tela mostra escrita direito.
  assert.strictEqual(C.mensagemDeErro({ message: "titulo precisa ter entre 5 e 120 caracteres" }), "O título precisa ter entre 5 e 120 caracteres.");
  assert.strictEqual(C.mensagemDeErro({ message: "thread nao existe" }), "Esta thread não existe mais.");

  console.log("test_threads_core: ok");
})().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
