/* gerador.js - interface do gerador de cartinhas.
 *
 * Lê um conjunto de dados (dados/*.json ou uma tabela colada do Excel), acha
 * escudo, cores, foto e ícones pelo metadata.json do site e desenha as cartas
 * com cartinha.js. Exporta PNG de uma carta, um .zip com todas e um post por time.
 *
 * Roda servido pela raiz do Hub Uni (local-static-server.cjs), porque busca
 * /metadata.json e /assets/... - abrir o arquivo direto (file://) não funciona.
 */
(function () {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const RAIZ = "/";
  const PASTA = new URL(".", location.href).pathname; // /ferramentas/cartinhas/
  const ICONES_FUNCAO = {
    duelista: "assets/roles/DuelistClassSymbol.webp",
    iniciador: "assets/roles/InitiatorClassSymbol.webp",
    controlador: "assets/roles/ControllerClassSymbol.webp",
    sentinela: "assets/roles/SentinelClassSymbol.webp",
  };
  const FUNCOES = ["Duelista", "Iniciador", "Controlador", "Sentinela", "Flex"];

  const sinal = (v, casas) => {
    const r = Number(v.toFixed(casas));
    return (r > 0 ? "+" : r < 0 ? "-" : "") + Math.abs(r).toFixed(casas);
  };
  const CATALOGO = {
    acs: { rotulo: "ACS", fmt: (v) => String(Math.round(v)) },
    kast: { rotulo: "KAST", fmt: (v) => `${Math.round(v <= 1.5 ? v * 100 : v)}%` },
    kpr: { rotulo: "KPR", fmt: (v) => v.toFixed(2) },
    mpr: { rotulo: "MPR", fmt: (v) => v.toFixed(2) },
    apr: { rotulo: "APR", fmt: (v) => v.toFixed(2) },
    swing: { rotulo: "SWING", fmt: (v) => sinal(v, 1) },
    adr: { rotulo: "ADR", fmt: (v) => String(Math.round(v)) },
    kd: { rotulo: "K/D", fmt: (v) => v.toFixed(2) },
    hs: { rotulo: "HS", fmt: (v) => `${Math.round(v <= 1.5 ? v * 100 : v)}%` },
    fkfd: { rotulo: "FK-FD", fmt: (v) => sinal(v, 0) },
    rating: { rotulo: "RATING", fmt: (v) => v.toFixed(2) },
  };

  const estado = {
    conjunto: null,
    idConjunto: "",
    meta: null,
    indice: null,
    jogadores: [],
    edicoes: {},
    fotosLocais: {},
    enquadramentos: {}, // dados/enquadramento-fotos.json: enquadramento revisado de cada foto
    opcoes: { escala: 1.5, mostrarAgente: true, mostrarNomeFundo: false, mostrarEvento: false },
    filtro: { busca: "", time: "", ordem: "time", semFoto: false },
    imagens: new Map(),
    miniaturas: new Map(),
    aberto: null,
  };

  /* ------------------------------------------------------------------ */
  /* utilidades                                                           */
  /* ------------------------------------------------------------------ */

  function normal(s) {
    return String(s ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function numero(v) {
    if (typeof v === "number") return v;
    const s = String(v ?? "").trim().replace(/^=/, "").replace("%", "").replace("+", "").replace(",", ".");
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // nomes de arquivo só com ASCII: o Chrome ignora o nome sugerido quando ele tem acento
  function nomeDeArquivo(s) {
    return (
      String(s)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\x20-\x7E]+/g, "-")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .replace(/\s+/g, " ")
        .trim() || "carta"
    );
  }

  function caminho(src) {
    if (!src) return "";
    if (/^(https?:|data:|blob:)/.test(src)) return src;
    return RAIZ + String(src).replace(/^\/+/, "");
  }

  function carregarImagem(src) {
    if (!src) return Promise.resolve(null);
    const url = caminho(src);
    if (!estado.imagens.has(url)) {
      estado.imagens.set(
        url,
        new Promise((ok) => {
          const img = new Image();
          if (/^https?:/.test(url) && !url.startsWith(location.origin)) img.crossOrigin = "anonymous";
          img.decoding = "async";
          img.onload = () => ok(img);
          img.onerror = () => ok(null);
          img.src = url;
        })
      );
    }
    return estado.imagens.get(url);
  }

  async function buscarJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  function baixar(blob, nome) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
  }

  const pausa = () => new Promise((r) => setTimeout(r, 0));

  function aviso(msg, tipo) {
    const el = $("#aviso");
    el.textContent = msg;
    el.dataset.tipo = tipo || "";
    el.hidden = !msg;
  }

  /* ------------------------------------------------------------------ */
  /* fotos trocadas na mão (ficam no IndexedDB deste navegador)          */
  /* ------------------------------------------------------------------ */

  const banco = (() => {
    let db = null;
    const abrir = () =>
      db ||
      (db = new Promise((ok, falha) => {
        const req = indexedDB.open("cartinhas", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("fotos");
        req.onsuccess = () => ok(req.result);
        req.onerror = () => falha(req.error);
      }));
    const op = async (modo, fn) => {
      const d = await abrir();
      return new Promise((ok, falha) => {
        const tx = d.transaction("fotos", modo);
        const req = fn(tx.objectStore("fotos"));
        tx.oncomplete = () => ok(req && req.result);
        tx.onerror = () => falha(tx.error);
      });
    };
    return {
      ler: (k) => op("readonly", (s) => s.get(k)).catch(() => null),
      gravar: (k, v) => op("readwrite", (s) => s.put(v, k)).catch(() => null),
      apagar: (k) => op("readwrite", (s) => s.delete(k)).catch(() => null),
      chaves: () => op("readonly", (s) => s.getAllKeys()).catch(() => []),
    };
  })();

  /* ------------------------------------------------------------------ */
  /* metadata do site                                                     */
  /* ------------------------------------------------------------------ */

  function indexarMetadata(meta) {
    const ix = { times: new Map(), timesPorNome: new Map(), porPuuid: new Map(), porNome: new Map(), agentes: new Map() };
    for (const t of meta.teams || []) {
      ix.times.set(t.id, t);
      for (const k of [t.id, t.slug, t.displayName, t.tag]) if (k && !ix.timesPorNome.has(normal(k))) ix.timesPorNome.set(normal(k), t);
    }
    for (const p of meta.players || []) {
      if (p.puuid) ix.porPuuid.set(p.puuid, p);
      const nomes = new Set([p.name, ...(p.nickHistory || []).map((h) => String(h).split("#")[0])]);
      for (const n of nomes) {
        const k = normal(n);
        if (!k) continue;
        if (!ix.porNome.has(k)) ix.porNome.set(k, []);
        ix.porNome.get(k).push(p);
      }
    }
    for (const a of meta.agents || []) {
      for (const k of [a.slug, a.name]) if (k) ix.agentes.set(normal(k), a.icon);
    }
    return ix;
  }

  function acharTime(valor) {
    const ix = estado.indice;
    if (!ix || !valor) return null;
    const k = normal(valor);
    if (ix.times.has(valor)) return ix.times.get(valor);
    if (ix.timesPorNome.has(k)) return ix.timesPorNome.get(k);
    // "Furia" -> "Furia XV": o começo do nome basta quando só um time casa
    const candidatos = [...new Set([...ix.timesPorNome.entries()].filter(([n]) => n.startsWith(k) || k.startsWith(n)).map(([, t]) => t))];
    return candidatos.length === 1 ? candidatos[0] : null;
  }

  function acharJogador(nick, timeId, puuid) {
    const ix = estado.indice;
    if (!ix) return null;
    if (puuid && ix.porPuuid.has(puuid)) return ix.porPuuid.get(puuid);
    const lista = ix.porNome.get(normal(nick)) || [];
    return lista.find((p) => p.currentTeam === timeId) || lista.find((p) => (p.teamHistory || []).includes(timeId)) || lista[0] || null;
  }

  function iconeAgente(nome) {
    if (!nome) return "";
    const ix = estado.indice;
    return (ix && ix.agentes.get(normal(nome))) || `assets/agent-icons/${normal(nome)}.png`;
  }

  /* ------------------------------------------------------------------ */
  /* conjunto de dados                                                    */
  /* ------------------------------------------------------------------ */

  function estatisticas() {
    const lista = (estado.conjunto && estado.conjunto.estatisticas) || ["acs", "kast", "kpr", "mpr", "apr", "swing"];
    return lista.slice(0, 6).map((e) => {
      const campo = typeof e === "string" ? e : e.campo;
      const base = CATALOGO[campo] || { rotulo: campo.toUpperCase(), fmt: (v) => String(v) };
      return { campo, rotulo: (typeof e === "object" && e.rotulo) || base.rotulo, fmt: base.fmt };
    });
  }

  function timeDe(id) {
    const c = (estado.conjunto && estado.conjunto.times) || {};
    const proprio = c[id] || {};
    const site = (estado.indice && estado.indice.times.get(id)) || {};
    return {
      id,
      nome: proprio.nome || site.displayName || id,
      nomeFundo: proprio.nomeFundo || proprio.nome || site.displayName || id,
      cores: proprio.cores || site.colors || ["#3b3b4f", "#9a9ab0"],
      logo: proprio.logo || site.logo || "",
      paleta: proprio.paleta || null,
    };
  }

  function prepararJogadores() {
    const vistos = new Map();
    estado.jogadores = (estado.conjunto.jogadores || []).map((j, i) => {
      let chave = `${j.time}:${j.puuid || normal(j.nick)}`;
      if (vistos.has(chave)) chave += `:${i}`;
      vistos.set(chave, true);
      return Object.assign({ chave, ordem: i }, j);
    });
  }

  function chaveEdicoes() {
    return `cartinhas:edicoes:${estado.idConjunto}`;
  }

  function carregarEdicoes() {
    try {
      estado.edicoes = JSON.parse(localStorage.getItem(chaveEdicoes()) || "{}") || {};
    } catch (e) {
      estado.edicoes = {};
    }
  }

  function salvarEdicoes() {
    try {
      localStorage.setItem(chaveEdicoes(), JSON.stringify(estado.edicoes));
    } catch (e) {
      /* sem localStorage: as edições valem só nesta aba */
    }
  }

  function valores(j) {
    return Object.assign({}, j, estado.edicoes[j.chave] || {});
  }

  function fotoDe(v) {
    if (estado.fotosLocais[v.chave]) return estado.fotosLocais[v.chave];
    if (v.foto) return v.foto;
    const p = acharJogador(v.nick, v.time, v.puuid);
    return (p && p.photo) || "";
  }

  function montarCarta(j) {
    const v = valores(j);
    const t = timeDe(v.time);
    return {
      nick: v.nick,
      overall: v.overall,
      funcao: v.funcao,
      agente: v.agente,
      partidas: Number(v.mapas) || null,
      stats: estatisticas().map((s) => {
        const n = numero(v[s.campo]);
        return { rotulo: s.rotulo, valor: Number.isFinite(n) ? s.fmt(n) : String(v[s.campo] ?? "-") };
      }),
      time: { nome: t.nome, nomeFundo: t.nomeFundo, cores: t.cores, paleta: t.paleta },
      enquadramento: enquadramentoDe(v),
      ajusteFoto: { zoom: Number(v.zoom) || 1, x: Number(v.fotoX) || 0, y: Number(v.fotoY) || 0 },
    };
  }

  // enquadramento revisado da foto (tamanho e posição); foto trocada neste navegador usa o automático
  function enquadramentoDe(v) {
    if (estado.fotosLocais[v.chave]) return null;
    const foto = String(fotoDe(v) || "").replace(/^\/+/, "");
    return (foto && estado.enquadramentos[foto]) || null;
  }

  async function imagensDe(j) {
    const v = valores(j);
    const t = timeDe(v.time);
    const funcao = String(v.funcao || "").toLowerCase();
    const [foto, logo, agente, iconeFuncao, evento, silhueta] = await Promise.all([
      carregarImagem(fotoDe(v)),
      carregarImagem(t.logo),
      carregarImagem(iconeAgente(v.agente)),
      carregarImagem(ICONES_FUNCAO[funcao] || ""),
      carregarImagem(estado.conjunto.evento && estado.conjunto.evento.icone),
      carregarImagem("assets/user-silhouette.png"),
    ]);
    return { foto, logo, agente, funcao: iconeFuncao, evento, silhueta };
  }

  async function desenhar(j, escala, extra) {
    const opcoes = Object.assign({}, estado.opcoes, { escala }, extra || {});
    return Cartinha.renderizar(montarCarta(j), await imagensDe(j), opcoes);
  }

  /* ------------------------------------------------------------------ */
  /* grade                                                                */
  /* ------------------------------------------------------------------ */

  function visiveis() {
    const f = estado.filtro;
    const busca = normal(f.busca);
    let lista = estado.jogadores.filter((j) => {
      const v = valores(j);
      if (f.time && v.time !== f.time) return false;
      if (busca && !normal(v.nick).includes(busca) && !normal(timeDe(v.time).nome).includes(busca)) return false;
      if (f.semFoto && fotoDe(v)) return false;
      return true;
    });
    const ov = (j) => Number(valores(j).overall) || 0;
    if (f.ordem === "overall") lista = lista.slice().sort((a, b) => ov(b) - ov(a) || a.ordem - b.ordem);
    else if (f.ordem === "nick") lista = lista.slice().sort((a, b) => String(valores(a).nick).localeCompare(String(valores(b).nick), "pt-BR", { sensitivity: "base" }));
    else lista = lista.slice().sort((a, b) => timeDe(a.time).nome.localeCompare(timeDe(b.time).nome, "pt-BR") || ov(b) - ov(a) || a.ordem - b.ordem);
    return lista;
  }

  let geracaoGrade = 0;
  async function desenharGrade() {
    const minha = ++geracaoGrade;
    const grade = $("#grade");
    grade.innerHTML = "";
    const lista = visiveis();
    $("#contagem").textContent = resumo(lista);
    $("#baixar-todas").textContent = `Baixar ${lista.length} ${lista.length === 1 ? "carta" : "cartas"} (.zip)`;
    for (const j of lista) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "carta";
      item.dataset.chave = j.chave;
      item.title = `${valores(j).nick} - clique para editar`;
      const semFoto = !fotoDe(valores(j));
      item.innerHTML = `<span class="lugar"></span>${semFoto ? '<span class="selo">sem foto</span>' : ""}`;
      item.addEventListener("click", () => abrirEditor(j.chave));
      grade.appendChild(item);
    }
    for (const j of lista) {
      if (minha !== geracaoGrade) return;
      await atualizarMiniatura(j);
      await pausa();
    }
  }

  async function atualizarMiniatura(j) {
    const item = $(`.carta[data-chave="${CSS.escape(j.chave)}"]`);
    if (!item) return;
    const tela = await desenhar(j, 0.5, { nitidez: 0 });
    tela.className = "miniatura";
    const lugar = item.querySelector(".lugar, .miniatura");
    lugar.replaceWith(tela);
    const semFoto = !fotoDe(valores(j));
    const selo = item.querySelector(".selo");
    if (semFoto && !selo) item.insertAdjacentHTML("beforeend", '<span class="selo">sem foto</span>');
    if (!semFoto && selo) selo.remove();
  }

  function resumo(lista) {
    const total = estado.jogadores.length;
    const comFoto = estado.jogadores.filter((j) => fotoDe(valores(j))).length;
    const partes = [`${total} jogadores`, `${comFoto} com foto`, `${total - comFoto} sem foto (usam a silhueta)`];
    if (lista.length !== total) partes.unshift(`${lista.length} na tela`);
    return partes.join(" · ");
  }

  function preencherFiltroTimes() {
    const sel = $("#filtro-time");
    const ids = [...new Set(estado.jogadores.map((j) => j.time))].sort((a, b) => timeDe(a).nome.localeCompare(timeDe(b).nome, "pt-BR"));
    sel.innerHTML = '<option value="">Todos os times</option>' + ids.map((id) => `<option value="${id}">${escapar(timeDe(id).nome)}</option>`).join("");
    sel.value = ids.includes(estado.filtro.time) ? estado.filtro.time : "";
    estado.filtro.time = sel.value;
  }

  function escapar(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  /* ------------------------------------------------------------------ */
  /* editor de uma carta                                                  */
  /* ------------------------------------------------------------------ */

  function jogadorPorChave(chave) {
    return estado.jogadores.find((j) => j.chave === chave);
  }

  function abrirEditor(chave) {
    const j = jogadorPorChave(chave);
    if (!j) return;
    estado.aberto = chave;
    const v = valores(j);
    const form = $("#form-carta");
    form.nick.value = v.nick ?? "";
    form.overall.value = v.overall ?? "";
    form.funcao.innerHTML = FUNCOES.map((f) => `<option>${f}</option>`).join("");
    form.funcao.value = FUNCOES.find((f) => normal(f) === normal(v.funcao)) || "Flex";
    form.agente.innerHTML =
      '<option value="">(sem agente)</option>' +
      [...new Set([...(estado.meta.agents || []).map((a) => a.slug), normal(v.agente)].filter(Boolean))]
        .sort()
        .map((a) => `<option value="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</option>`)
        .join("");
    form.agente.value = normal(v.agente);
    const box = $("#campos-stats");
    box.innerHTML = estatisticas()
      .map((s) => `<label>${escapar(s.rotulo)}<input name="st-${s.campo}" value="${escapar(v[s.campo] ?? "")}" inputmode="decimal"></label>`)
      .join("");
    form.zoom.value = Number(v.zoom) || 1;
    form.fotoX.value = Number(v.fotoX) || 0;
    form.fotoY.value = Number(v.fotoY) || 0;
    form.foto.value = estado.fotosLocais[chave] ? "(foto trocada neste navegador)" : v.foto || "";
    $("#editor-titulo").textContent = `${v.nick} · ${timeDe(v.time).nome}`;
    $("#agentes-info").textContent = v.agentes ? `Agentes (mapas): ${v.agentes}` : "";
    $("#editor").showModal();
    desenharPrevia();
  }

  let previaPendente = 0;
  async function desenharPrevia() {
    const minha = ++previaPendente;
    const j = jogadorPorChave(estado.aberto);
    if (!j) return;
    const tela = await desenhar(j, 1);
    if (minha !== previaPendente) return;
    tela.id = "previa";
    $("#previa").replaceWith(tela);
    infoEnquadramento(j);
  }

  async function infoEnquadramento(j) {
    const el = $("#enquadramento-info");
    if (!el) return;
    const e = Cartinha.enquadramentoFoto ? Cartinha.enquadramentoFoto(montarCarta(j), await imagensDe(j), estado.opcoes) : null;
    if (!e) {
      el.textContent = "";
      el.classList.remove("alerta");
      return;
    }
    const num = (v, d) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
    const origem = e.origem === "revisado" ? "revisado" : "automático";
    let detalhe;
    let alerta;
    if (e.cortar) {
      // o que chega perto do escudo/+PICK se dissolve; a cabeça é protegida, mas não pode encostar na coluna
      alerta = e.cabecaCortada > 30;
      detalhe = alerta ? "a cabeça está encostando no escudo/+PICK: mova a foto para a direita ou diminua o zoom" : "a foto se dissolve perto do escudo/+PICK";
    } else {
      alerta = e.folga != null && e.folga < 4;
      detalhe = `distância até escudo/+PICK: ${e.folga == null ? "-" : num(e.folga, 0)}${alerta ? " (encostando)" : ""}`;
    }
    el.textContent = `Enquadramento ${origem}: zoom ${num(e.zoom, 2)} · x ${num(e.x, 0)} · y ${num(e.y, 0)} · ${detalhe}`;
    el.classList.toggle("alerta", alerta);
  }

  function editar(campo, valor) {
    const chave = estado.aberto;
    if (!chave) return;
    const j = jogadorPorChave(chave);
    const ed = (estado.edicoes[chave] = estado.edicoes[chave] || {});
    const original = j[campo];
    const igual = String(original ?? "") === String(valor ?? "") || (campo === "zoom" && Number(valor) === 1 && original == null) || ((campo === "fotoX" || campo === "fotoY") && Number(valor) === 0 && original == null);
    if (igual) delete ed[campo];
    else ed[campo] = valor;
    if (!Object.keys(ed).length) delete estado.edicoes[chave];
    salvarEdicoes();
    desenharPrevia();
    clearTimeout(editar.t);
    editar.t = setTimeout(() => atualizarMiniatura(j), 250);
  }

  async function trocarFoto(arquivo) {
    if (!arquivo || !/^image\//.test(arquivo.type)) return;
    const chave = estado.aberto;
    await banco.gravar(chave, arquivo);
    if (estado.fotosLocais[chave]) URL.revokeObjectURL(estado.fotosLocais[chave]);
    estado.fotosLocais[chave] = URL.createObjectURL(arquivo);
    $("#form-carta").foto.value = "(foto trocada neste navegador)";
    desenharPrevia();
    atualizarMiniatura(jogadorPorChave(chave));
    $("#contagem").textContent = resumo(visiveis());
  }

  async function restaurarCarta() {
    const chave = estado.aberto;
    delete estado.edicoes[chave];
    salvarEdicoes();
    if (estado.fotosLocais[chave]) {
      URL.revokeObjectURL(estado.fotosLocais[chave]);
      delete estado.fotosLocais[chave];
      await banco.apagar(chave);
    }
    abrirEditor(chave);
    atualizarMiniatura(jogadorPorChave(chave));
  }

  async function carregarFotosLocais() {
    const prefixo = `${estado.idConjunto}|`;
    for (const k of Object.values(estado.fotosLocais)) URL.revokeObjectURL(k);
    estado.fotosLocais = {};
    const chaves = (await banco.chaves()) || [];
    for (const k of chaves) {
      if (!String(k).startsWith(prefixo)) continue;
      const blob = await banco.ler(k);
      if (blob) estado.fotosLocais[String(k).slice(prefixo.length)] = URL.createObjectURL(blob);
    }
  }

  /* As fotos do IndexedDB são guardadas com o id do conjunto na frente, para
   * duas fases do mesmo campeonato não misturarem fotos trocadas. */
  const bancoOriginal = { gravar: banco.gravar, apagar: banco.apagar };
  banco.gravar = (k, v) => bancoOriginal.gravar(`${estado.idConjunto}|${k}`, v);
  banco.apagar = (k) => bancoOriginal.apagar(`${estado.idConjunto}|${k}`);

  /* ------------------------------------------------------------------ */
  /* exportação                                                           */
  /* ------------------------------------------------------------------ */

  const paraBlob = (tela, tipo, qualidade) => new Promise((ok) => tela.toBlob(ok, tipo || "image/png", qualidade));

  function nomeDaCarta(j) {
    const v = valores(j);
    return `${nomeDeArquivo(v.nick)}.png`;
  }

  async function baixarUma() {
    const j = jogadorPorChave(estado.aberto);
    const tela = await desenhar(j, estado.opcoes.escala);
    baixar(await paraBlob(tela), nomeDaCarta(j));
  }

  function progresso(feito, total, rotulo) {
    const el = $("#progresso");
    el.hidden = feito >= total;
    el.querySelector("span").textContent = `${rotulo} ${feito}/${total}`;
    el.querySelector("progress").max = total;
    el.querySelector("progress").value = feito;
  }

  function nomeDoPacote(sufixo) {
    const ev = estado.conjunto.evento || {};
    return nomeDeArquivo(`Cartinhas ${ev.nome || ""} ${ev.fase || ""} ${sufixo || ""}`.replace(/\s+/g, " ")).replace(/ /g, "_") + ".zip";
  }

  async function baixarTodas() {
    const lista = visiveis();
    if (!lista.length) return;
    const zip = new Zip();
    const usados = new Set();
    for (let i = 0; i < lista.length; i++) {
      progresso(i, lista.length, "Gerando cartas");
      const j = lista[i];
      const tela = await desenhar(j, estado.opcoes.escala);
      const blob = await paraBlob(tela);
      let nome = `${nomeDeArquivo(timeDe(valores(j).time).nome)}/${nomeDaCarta(j)}`;
      while (usados.has(nome)) nome = nome.replace(/\.png$/, "_2.png");
      usados.add(nome);
      zip.adicionar(nome, new Uint8Array(await blob.arrayBuffer()));
      await pausa();
    }
    progresso(lista.length, lista.length, "");
    baixar(zip.gerar(), nomeDoPacote());
  }

  /* Post de um time: 1080 x 1350 (retrato do Instagram), nome do time e as
   * cartas em fileiras, da maior nota para a menor. */
  async function desenharPost(timeId, jogadores) {
    const PW = 1080;
    const PH = 1350;
    const tela = document.createElement("canvas");
    tela.width = PW;
    tela.height = PH;
    const ctx = tela.getContext("2d");
    const t = timeDe(timeId);
    const ouro = Cartinha.PADRAO.ouro;
    const fonte = Cartinha.PADRAO.fonte;

    // fundo escuro com a mesma linguagem das cartas (degradê, facetas, feixes)
    Cartinha.fundo(ctx, t.cores, PW, PH, t.nome);

    // escudo do time no canto, nítido
    const logo = await carregarImagem(t.logo);
    const tamLogo = 150;
    if (logo) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.drawImage(logo, PW - 60 - tamLogo, 52, tamLogo, tamLogo);
      ctx.restore();
    }

    // título: filete dourado + nome do time + evento
    const titulo = t.nome.toUpperCase();
    ctx.font = `700 92px ${fonte}`;
    const larguraMax = PW - 92 - 60 - (logo ? tamLogo + 30 : 0);
    const palavras = titulo.split(/\s+/);
    const linhas = [];
    let atual = "";
    for (const p of palavras) {
      const teste = atual ? `${atual} ${p}` : p;
      if (ctx.measureText(teste).width > larguraMax && atual) {
        linhas.push(atual);
        atual = p;
      } else atual = teste;
    }
    if (atual) linhas.push(atual);
    const yTitulo = 64;
    const alturaLinha = 100;
    const g = ctx.createLinearGradient(0, yTitulo, 0, yTitulo + linhas.length * alturaLinha + 50);
    g.addColorStop(0, "#F7E6B0");
    g.addColorStop(1, "#B98A3A");
    ctx.fillStyle = g;
    ctx.fillRect(58, yTitulo + 10, 6, linhas.length * alturaLinha + 40);
    ctx.fillStyle = "#FFF6E6";
    ctx.textBaseline = "top";
    linhas.forEach((l, i) => ctx.fillText(l, 88, yTitulo - 4 + i * alturaLinha));
    const ev = estado.conjunto.evento || {};
    ctx.font = `500 32px ${fonte}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
    ctx.fillStyle = ouro;
    ctx.fillText(`${ev.nome || ""}${ev.fase ? " · " + ev.fase : ""}`.toUpperCase(), 90, yTitulo + linhas.length * alturaLinha + 8);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.textBaseline = "alphabetic";

    // fileiras de cartas: testa de 1 a n fileiras e fica com a que deixa a carta maior
    const n = jogadores.length;
    const topo = yTitulo + linhas.length * alturaLinha + 80;
    const areaH = PH - topo - 40;
    const areaW = PW - 80;
    const gap = 22;
    let melhor = null;
    for (let r = 1; r <= n; r++) {
      const c = Math.ceil(n / r);
      const w = Math.min((areaW - gap * (c - 1)) / c, ((areaH - gap * (r - 1)) / r) * (500 / 800));
      if (!melhor || w > melhor.w + 0.5) melhor = { r, w };
    }
    const base = Math.floor(n / melhor.r);
    const sobra = n % melhor.r;
    const fileiras = Array.from({ length: melhor.r }, (_, i) => base + (i < sobra ? 1 : 0));
    const porFileira = Math.max(...fileiras);
    const cartaW = Math.min((areaW - gap * (porFileira - 1)) / porFileira, ((areaH - gap * (fileiras.length - 1)) / fileiras.length) * (500 / 800));
    const cartaH = (cartaW * 800) / 500;
    const blocoH = fileiras.length * cartaH + (fileiras.length - 1) * gap;
    let y = topo + (areaH - blocoH) / 2;
    let k = 0;
    for (const qtd of fileiras) {
      const largura = qtd * cartaW + (qtd - 1) * gap;
      let x = (PW - largura) / 2;
      for (let i = 0; i < qtd; i++, k++) {
        const carta = await desenhar(jogadores[k], cartaW / 500);
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 8;
        ctx.drawImage(carta, x, y, cartaW, cartaH);
        ctx.restore();
        x += cartaW + gap;
      }
      y += cartaH + gap;
    }
    return tela;
  }

  async function baixarPosts() {
    const lista = visiveis();
    const porTime = new Map();
    for (const j of lista) {
      const id = valores(j).time;
      if (!porTime.has(id)) porTime.set(id, []);
      porTime.get(id).push(j);
    }
    if (!porTime.size) return;
    const zip = new Zip();
    let i = 0;
    for (const [id, js] of porTime) {
      progresso(i++, porTime.size, "Montando posts");
      const ordenados = js.slice().sort((a, b) => (Number(valores(b).overall) || 0) - (Number(valores(a).overall) || 0));
      const tela = await desenharPost(id, ordenados);
      const blob = await paraBlob(tela, "image/jpeg", 0.93);
      zip.adicionar(`${nomeDeArquivo(timeDe(id).nome)}.jpg`, new Uint8Array(await blob.arrayBuffer()));
      await pausa();
    }
    progresso(porTime.size, porTime.size, "");
    baixar(zip.gerar(), nomeDoPacote("posts"));
  }

  function exportarDados() {
    const c = JSON.parse(JSON.stringify(estado.conjunto));
    c.jogadores = estado.jogadores.map((j) => {
      const v = valores(j);
      const limpo = {};
      for (const [k, val] of Object.entries(v)) if (!["chave", "ordem"].includes(k)) limpo[k] = val;
      return limpo;
    });
    const nome = (estado.idConjunto.replace(/^(arquivo|colado|hub|arquivo-local):/, "") || "cartinhas").replace(/\.json$/, "");
    baixar(new Blob([JSON.stringify(c, null, 1)], { type: "application/json" }), `${nomeDeArquivo(nome)}.json`);
  }

  /* ------------------------------------------------------------------ */
  /* importar tabela colada do Excel                                      */
  /* ------------------------------------------------------------------ */

  const CABECALHOS = {
    nick: ["nome", "nick", "jogador", "player"],
    time: ["time", "equipe", "team"],
    overall: ["overall", "ovr", "nota"],
    funcao: ["funcao", "função", "role", "classe"],
    agente: ["agente", "agent", "agentemaisjogado", "pick"],
    agentes: ["agentesmapas", "agentes"],
    mapas: ["mapas", "partidas", "maps", "matches"],
    puuid: ["puuid"],
    foto: ["foto", "photo"],
    acs: ["acs"],
    kast: ["kast"],
    kpr: ["kpr"],
    mpr: ["mpr", "dpr"],
    apr: ["apr"],
    swing: ["swing", "swingr"],
    adr: ["adr"],
    kd: ["kd"],
    hs: ["hs", "hsp"],
    fkfd: ["fkfd"],
    rating: ["rating", "raating", "raating30", "rating30"],
  };

  function importarTabela(texto, nomeEvento, fase) {
    const linhas = texto.replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (linhas.length < 2) throw new Error("Cole a tabela com a linha de cabeçalho (Nome, Time, Overall, ...).");
    const sep = linhas[0].includes("\t") ? "\t" : linhas[0].includes(";") ? ";" : ",";
    const cab = linhas[0].split(sep).map((c) => normal(c));
    const coluna = {};
    for (const [campo, nomes] of Object.entries(CABECALHOS)) {
      const i = cab.findIndex((c) => nomes.map(normal).includes(c));
      if (i >= 0 && !(campo in coluna)) coluna[campo] = i;
    }
    for (const obrig of ["nick", "time", "overall"]) if (!(obrig in coluna)) throw new Error(`Não achei a coluna "${obrig}" no cabeçalho.`);
    const desconhecidos = new Set();
    const times = {};
    const jogadores = [];
    for (const l of linhas.slice(1)) {
      const cel = l.split(sep);
      const pega = (campo) => (campo in coluna ? String(cel[coluna[campo]] ?? "").trim() : "");
      const nick = pega("nick");
      if (!nick) continue;
      const nomeTime = pega("time");
      const t = acharTime(nomeTime);
      const id = t ? t.id : normal(nomeTime) || "sem_time";
      if (!t) desconhecidos.add(nomeTime);
      if (!times[id]) times[id] = { nome: nomeTime || (t && t.displayName) || id };
      const j = { nick, time: id, overall: Math.round(numero(pega("overall"))) || pega("overall") };
      const funcao = pega("funcao");
      j.funcao = FUNCOES.find((f) => normal(f) === normal(funcao)) || FUNCOES.find((f) => normal(funcao).startsWith(normal(f).slice(0, 4))) || "Flex";
      for (const campo of ["acs", "kast", "kpr", "mpr", "apr", "swing", "adr", "kd", "hs", "fkfd", "rating"]) {
        if (!(campo in coluna)) continue;
        const n = numero(pega(campo));
        j[campo] = Number.isFinite(n) ? n : pega(campo);
      }
      if ("mapas" in coluna) {
        const n = numero(pega("mapas"));
        if (Number.isFinite(n)) j.mapas = n;
      }
      const agentes = pega("agentes");
      if (agentes) j.agentes = agentes;
      j.agente = pega("agente") || (agentes ? agentes.split(",")[0].replace(/\s*\d+\s*$/, "").trim() : "");
      if (pega("puuid")) j.puuid = pega("puuid");
      if (pega("foto")) j.foto = pega("foto");
      const p = acharJogador(nick, id, j.puuid);
      if (p && !j.puuid) j.puuid = p.puuid;
      jogadores.push(j);
    }
    const stats = ["acs", "kast", "kpr", "mpr", "apr", "swing", "adr", "kd", "hs", "fkfd", "rating"].filter((c) => c in coluna).slice(0, 6);
    return {
      conjunto: { evento: { nome: nomeEvento || "Cartinhas", fase: fase || "", icone: "" }, estatisticas: stats, times, jogadores },
      desconhecidos: [...desconhecidos],
    };
  }

  /* ------------------------------------------------------------------ */
  /* carregar um conjunto                                                 */
  /* ------------------------------------------------------------------ */

  async function usarConjunto(conjunto, id) {
    estado.conjunto = conjunto;
    estado.idConjunto = id;
    prepararJogadores();
    carregarEdicoes();
    await carregarFotosLocais();
    const ev = conjunto.evento || {};
    $("#evento").textContent = [ev.nome, ev.fase].filter(Boolean).join(" · ") || "Cartinhas";
    document.title = `Cartinhas · ${$("#evento").textContent}`;
    preencherFiltroTimes();
    aviso("");
    await desenharGrade();
  }

  /* Conjunto "ao vivo": monta as cartas direto do database.json do site, com os
   * números que o próprio Hub Uni já calculou para cada jogador (todos os jogos
   * de todos os campeonatos). Rodou o build_database.js, as cartas acompanham. */
  function carregarScript(src) {
    return new Promise((ok, falha) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = () => falha(new Error(`não carregou ${src}`));
      document.head.appendChild(s);
    });
  }

  const FUNCAO_DA_CLASSE = { duelista: "Duelista", iniciador: "Iniciador", controlador: "Controlador", sentinela: "Sentinela" };

  function funcaoEAgente(agentes) {
    const porFuncao = {};
    for (const a of agentes || []) {
      const f = FUNCAO_DA_CLASSE[String(a.role || "").trim().toLowerCase()];
      if (f) porFuncao[f] = (porFuncao[f] || 0) + (Number(a.picks) || 0);
    }
    const maior = Math.max(0, ...Object.values(porFuncao));
    const empatadas = Object.keys(porFuncao).filter((f) => porFuncao[f] === maior);
    const funcao = empatadas.length === 1 ? empatadas[0] : "Flex"; // empate em mapas = Flex
    const ordenados = (agentes || []).slice().sort((a, b) => (Number(b.picks) || 0) - (Number(a.picks) || 0) || (Number(b.rounds) || 0) - (Number(a.rounds) || 0));
    return {
      funcao,
      agente: ordenados.length ? ordenados[0].name : "",
      agentes: ordenados.filter((a) => Number(a.picks) > 0).map((a) => `${a.name} ${a.picks}`).join(", "),
    };
  }

  async function conjuntoDoHub(cfg) {
    aviso("Lendo o database.json do Hub Uni…");
    if (!window.DbCodec) await carregarScript(`${RAIZ}db-codec.js`);
    const db = window.DbCodec.decode(await buscarJson(`${RAIZ}database.json`));
    let nomes = {};
    try {
      nomes = await buscarJson(`${PASTA}dados/${cfg.nomes || "nomes.json"}`);
    } catch (e) {
      nomes = {};
    }
    const minimo = Number(cfg.minRounds ?? 50);
    const minimoPartidas = Number(cfg.minMatches ?? 0);
    const base = Number(cfg.overall?.base ?? 65.399);
    const inclinacao = Number(cfg.overall?.inclinacao ?? 18.182);

    // overall ajustado (amostra + força dos adversários), quando o índice pede
    const aj = cfg.ajuste && cfg.ajuste.ativo !== false ? cfg.ajuste : null;
    let modelo = null;
    let media = null;
    if (aj) {
      aviso("Calculando a força dos adversários…");
      if (!window.AjusteOverall) await carregarScript(`${PASTA}ajuste-overall.js`);
      if (!window.RaaRatingCore) await carregarScript(`${RAIZ}raating-core.js`).catch(() => null);
      modelo = window.AjusteOverall.calcular(db, { kJogador: Number(aj.kJogador ?? 39.244), kAdversario: Number(aj.kAdversario ?? 52.034), core: window.RaaRatingCore });
      media = Number.isFinite(Number(aj.media)) ? Number(aj.media) : Math.round(modelo.media * 1000) / 1000;
    }

    const times = {};
    const jogadores = [];
    for (const p of db.players || []) {
      const rating = Number(p.raating_3 ?? p.rating);
      if (!(Number(p.rounds) >= minimo) || !(Number(p.matches) >= minimoPartidas) || !Number.isFinite(rating)) continue;
      const time = p.currentTeam || p.teamId || p.observedTeamId || "sem_time";
      const site = estado.indice.times.get(time) || {};
      if (!times[time]) times[time] = { nome: site.displayName || time };
      const { funcao, agente, agentes } = funcaoEAgente(p.agentStats);
      const nivel = modelo ? modelo.nivel.get(p.puuid) || 0 : 0;
      const ratingFinal = modelo ? window.AjusteOverall.ajustar(rating, Number(p.rounds), nivel, { k: aj.k ?? 40, intensidade: aj.intensidade ?? 1, media }) : rating;
      jogadores.push({
        nick: nomes[p.puuid] || p.nick,
        time,
        overall: Math.floor(base + inclinacao * ratingFinal + 0.5),
        funcao,
        acs: Math.round(Number(p.acs)),
        kast: Number(p.kast) / 100,
        kpr: Number(p.kpr),
        mpr: Number(p.dpr),
        apr: Number(p.apr),
        swing: Number(p.impactRound),
        agente,
        agentes,
        rating,
        ratingFinal: Math.round(ratingFinal * 10000) / 10000,
        nivelAdversarios: Math.round(nivel * 10000) / 10000,
        rounds: Number(p.rounds),
        mapas: Number(p.matches),
        puuid: p.puuid,
        foto: p.photo || "",
      });
    }
    jogadores.sort((a, b) => String(a.time).localeCompare(String(b.time)) || b.overall - a.overall || b.ratingFinal - a.ratingFinal);
    const regra = modelo
      ? `overall = arredonda(${base} + ${inclinacao} × rAAting final), rAAting final = ${media} + rounds/(rounds + ${aj.k ?? 40}) × (rAAting 3.0 + nível dos adversários − ${media})`
      : `overall = arredonda(${base} + ${inclinacao} × rAAting 3.0)`;
    return {
      evento: cfg.evento || { nome: "Temporada", fase: "Todos os campeonatos", icone: "" },
      estatisticas: cfg.estatisticas || ["acs", "kast", "kpr", "mpr", "apr", "swing"],
      criterio: `No mínimo ${minimo} rounds e ${minimoPartidas} partidas (mapas) somando todos os campeonatos do database.json; ${regra}`,
      times,
      jogadores,
    };
  }

  async function carregarListaDeConjuntos() {
    let lista = [];
    try {
      lista = await buscarJson(`${PASTA}dados/indice.json`);
    } catch (e) {
      lista = [];
    }
    estado.listaConjuntos = lista;
    const valorDe = (c) => (c.fonte === "hub" ? `hub:${c.id}` : `arquivo:${c.arquivo}`);
    const sel = $("#conjunto");
    sel.innerHTML =
      lista.map((c) => `<option value="${escapar(valorDe(c))}">${escapar(c.nome || c.arquivo || c.id)}</option>`).join("") +
      '<option value="__colar">Colar tabela do Excel…</option><option value="__abrir">Abrir arquivo .json…</option>';
    return lista.map(valorDe);
  }

  async function abrirConjunto(valor) {
    let c = null;
    if (valor.startsWith("arquivo:")) {
      c = await buscarJson(`${PASTA}dados/${valor.slice("arquivo:".length)}`);
    } else if (valor.startsWith("hub:")) {
      const cfg = (estado.listaConjuntos || []).find((x) => x.fonte === "hub" && x.id === valor.slice(4));
      if (!cfg) throw new Error(`conjunto ${valor} não está em dados/indice.json`);
      c = await conjuntoDoHub(cfg);
    }
    if (!c) return;
    await usarConjunto(c, valor);
    try {
      localStorage.setItem("cartinhas:ultimo", valor);
    } catch (e) {
      /* ok */
    }
  }

  /* ------------------------------------------------------------------ */
  /* início                                                               */
  /* ------------------------------------------------------------------ */

  function ligarControles() {
    $("#busca").addEventListener("input", (e) => {
      estado.filtro.busca = e.target.value;
      clearTimeout(ligarControles.t);
      ligarControles.t = setTimeout(desenharGrade, 200);
    });
    $("#filtro-time").addEventListener("change", (e) => {
      estado.filtro.time = e.target.value;
      desenharGrade();
    });
    $("#ordem").addEventListener("change", (e) => {
      estado.filtro.ordem = e.target.value;
      desenharGrade();
    });
    $("#so-sem-foto").addEventListener("change", (e) => {
      estado.filtro.semFoto = e.target.checked;
      desenharGrade();
    });
    $("#escala").addEventListener("change", (e) => {
      estado.opcoes.escala = Number(e.target.value) || 1.5;
    });
    for (const [id, chave] of [["op-agente", "mostrarAgente"], ["op-nome-fundo", "mostrarNomeFundo"], ["op-evento", "mostrarEvento"]]) {
      $(`#${id}`).addEventListener("change", (e) => {
        estado.opcoes[chave] = e.target.checked;
        desenharGrade();
      });
    }
    $("#baixar-todas").addEventListener("click", () => baixarTodas().catch((e) => aviso(`Falhou: ${e.message}`, "erro")));
    $("#baixar-posts").addEventListener("click", () => baixarPosts().catch((e) => aviso(`Falhou: ${e.message}`, "erro")));
    $("#exportar-dados").addEventListener("click", exportarDados);

    $("#conjunto").addEventListener("change", async (e) => {
      const v = e.target.value;
      const voltar = () => {
        const existe = [...e.target.options].some((o) => o.value === estado.idConjunto);
        e.target.value = existe ? estado.idConjunto : e.target.options[0].value;
      };
      if (v === "__colar") {
        $("#colar").showModal();
        voltar();
        return;
      }
      if (v === "__abrir") {
        $("#arquivo-json").click();
        voltar();
        return;
      }
      abrirConjunto(v).catch((err) => aviso(`Não consegui abrir: ${err.message}`, "erro"));
    });
    $("#arquivo-json").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const c = JSON.parse(await f.text());
        await usarConjunto(c, `arquivo-local:${f.name}`);
      } catch (err) {
        aviso(`Arquivo inválido: ${err.message}`, "erro");
      }
      e.target.value = "";
    });

    // colar tabela
    $("#form-colar").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const { conjunto, desconhecidos } = importarTabela(f.tabela.value, f.eventoNome.value, f.eventoFase.value);
        $("#colar").close();
        await usarConjunto(conjunto, `colado:${normal(f.eventoNome.value + f.eventoFase.value) || "tabela"}`);
        if (desconhecidos.length) aviso(`Times sem escudo/cores no metadata.json: ${desconhecidos.join(", ")}. Ajuste o nome ou use "Baixar dados" e complete o JSON.`, "atencao");
      } catch (err) {
        $("#colar-erro").textContent = err.message;
      }
    });
    $("#colar-cancelar").addEventListener("click", () => $("#colar").close());

    // editor
    const form = $("#form-carta");
    form.addEventListener("input", (e) => {
      const el = e.target;
      if (!el.name) return;
      if (el.name.startsWith("st-")) editar(el.name.slice(3), el.value);
      else if (el.name === "overall") editar("overall", el.value === "" ? "" : Number(el.value));
      else if (["zoom", "fotoX", "fotoY"].includes(el.name)) editar(el.name, Number(el.value));
      else if (el.name === "foto") {
        if (!el.value.startsWith("(")) editar("foto", el.value.trim());
      } else editar(el.name, el.value);
    });
    form.addEventListener("submit", (e) => e.preventDefault());
    $("#foto-arquivo").addEventListener("change", (e) => trocarFoto(e.target.files[0]));
    const alvo = $("#area-previa");
    alvo.addEventListener("dragover", (e) => {
      e.preventDefault();
      alvo.classList.add("soltando");
    });
    alvo.addEventListener("dragleave", () => alvo.classList.remove("soltando"));
    alvo.addEventListener("drop", (e) => {
      e.preventDefault();
      alvo.classList.remove("soltando");
      trocarFoto(e.dataTransfer.files[0]);
    });
    $("#baixar-uma").addEventListener("click", () => baixarUma());
    $("#restaurar").addEventListener("click", () => restaurarCarta());
    $("#fechar").addEventListener("click", () => $("#editor").close());
    $("#editor").addEventListener("close", () => {
      estado.aberto = null;
    });
    // navegação com as setas dentro do editor
    $("#editor").addEventListener("keydown", (e) => {
      if (!["PageDown", "PageUp"].includes(e.key)) return;
      const lista = visiveis();
      const i = lista.findIndex((j) => j.chave === estado.aberto);
      const prox = lista[(i + (e.key === "PageDown" ? 1 : -1) + lista.length) % lista.length];
      if (prox) abrirEditor(prox.chave);
    });
  }

  async function iniciar() {
    ligarControles();
    if (location.protocol === "file:") {
      aviso("Abra pelo atalho abrir-gerador.bat (ou http://localhost:8000/ferramentas/cartinhas/). Direto do arquivo o navegador bloqueia as imagens.", "erro");
      return;
    }
    aviso("Carregando…");
    await Cartinha.carregarFontes();
    try {
      estado.meta = await buscarJson(`${RAIZ}metadata.json`);
    } catch (e) {
      estado.meta = { teams: [], players: [], agents: [] };
      aviso("Não achei o metadata.json na raiz do Hub Uni: escudos, cores e fotos só aparecem se estiverem no arquivo de dados.", "atencao");
    }
    estado.indice = indexarMetadata(estado.meta);
    try {
      const t = await buscarJson(`${PASTA}dados/enquadramento-fotos.json`);
      estado.enquadramentos = (t && t.fotos) || {};
    } catch (e) {
      estado.enquadramentos = {}; // sem a tabela: todas as fotos usam o enquadramento automático
    }
    const opcoes = await carregarListaDeConjuntos();
    const pedido = new URLSearchParams(location.search).get("dados");
    let ultimo = "";
    try {
      ultimo = localStorage.getItem("cartinhas:ultimo") || "";
    } catch (e) {
      /* ok */
    }
    // ?dados= aceita o id de um conjunto do índice (ex.: hub-temporada-2026) ou o nome de um arquivo em dados/
    const doPedido = pedido ? opcoes.find((o) => o === `hub:${pedido}` || o === `arquivo:${pedido}`) || `arquivo:${pedido}` : "";
    const escolha = doPedido || (opcoes.includes(ultimo) ? ultimo : opcoes[0]);
    if (!escolha) {
      aviso("Nenhum conjunto em dados/indice.json. Use \"Colar tabela do Excel…\".", "atencao");
      return;
    }
    $("#conjunto").value = escolha;
    await abrirConjunto(escolha);
  }

  // usado pelo script de exportação em lote (sem interface)
  window.Gerador = {
    estado,
    pronto: null,
    desenhar,
    desenharPost,
    visiveis,
    valores,
    timeDe,
    fotoDe,
    nomeDaCarta,
    importarTabela,
    usarConjunto,
  };
  window.Gerador.pronto = iniciar().catch((e) => {
    console.error(e);
    aviso(`Erro ao iniciar: ${e.message}`, "erro");
  });
})();
