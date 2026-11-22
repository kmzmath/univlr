// Coletor da amostra grande da HLTV (estudo de 21/11/2026, versão 4, fora do build). Colar na aba da HLTV
// (página de estatísticas, depois de ela carregar e passar pela verificação).
// - lê a cópia do IndexedDB 'univlr_estudo' (loja 'copia', chave 'C'); se não houver,
//   da cópia antiga em localStorage '__univlr_estudo_hltv' (que tem só ~5 milhões de
//   caracteres e não cabe a coleta inteira); segue de onde parou;
// - a pausa roda num worker (o Chrome não segura timer de worker com a janela escondida);
// - window.__parar = true para parar sem baixar nada (fase 'parado');
// - a liberação da Cloudflare dura 1 hora a partir do carregamento da página: antes de
//   vencer, rodar `window.__parar = true; await window.__guardar()`,
//   recarregar a página e colar este arquivo de novo;
// - no fim (ou se for bloqueada de vez) salva hltv_coleta_grande.json em Downloads.
{
  const CHAVE = '__univlr_estudo_hltv';
  const PERIODO = 'startDate=2025-08-20&endDate=2026-11-20';
  const banco = await new Promise((res, rej) => { const r = indexedDB.open('univlr_estudo', 1); r.onupgradeneeded = () => r.result.createObjectStore('copia'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const lerBanco = () => new Promise((res, rej) => { const q = banco.transaction('copia').objectStore('copia').get('C'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  const gravarBanco = (obj) => new Promise((res, rej) => { const tx = banco.transaction('copia', 'readwrite'); tx.objectStore('copia').put(obj, 'C'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
  const doBanco = await lerBanco();
  const salvo = doBanco || JSON.parse(localStorage.getItem(CHAVE));
  window.__col = salvo;
  const C = window.__col;
  C.retomadaEm = (C.retomadaEm || []).concat(new Date().toISOString() + (doBanco ? ' indexeddb' : ' localStorage'));
  window.__parar = false;
  const relogio = new Worker(URL.createObjectURL(new Blob(['onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms)'], { type: 'text/javascript' })));
  const pendentes = new Map(); let seq = 0;
  relogio.onmessage = (e) => { const r = pendentes.get(e.data); pendentes.delete(e.data); if (r) r(); };
  const espera = (ms) => new Promise((r) => { const id = ++seq; pendentes.set(id, r); relogio.postMessage({ id, ms }); });
  const pegar = window.__fetchOriginal || window.fetch.bind(window);
  const numero = (s) => { const m = String(s || '').replace(',', '.').match(/[-+]?\d+(\.\d+)?/); return m ? Number(m[0]) : ''; };
  const guardar = () => { const em = new Date().toISOString(); return gravarBanco(C).then(() => { C.ultimaCopia = em; }).catch((e) => { C.log.push('salvar: ' + e); }); };
  window.__guardar = guardar;
  window.__lerCopia = lerBanco;
  const PARADO = 'parado a pedido';
  // bloqueio (a liberação da Cloudflare vence 1 hora depois de passar pela verificação):
  // não desiste; tenta de novo a cada minuto até alguém recarregar a página.
  async function buscar(url) {
    for (let t = 0; t < 180; t++) {
      if (window.__parar) throw new Error(PARADO);
      try {
        const r = await pegar(url);
        const h = await r.text();
        if (r.status === 200 && !/Just a moment|challenge-platform|cf-chl/i.test(h.slice(0, 8000))) { window.__bloqueadoDesde = null; return h; }
        C.log.push(`${new Date().toISOString()} ${r.status} ${url}`);
        window.__bloqueadoDesde = window.__bloqueadoDesde || new Date().toISOString();
        if (t === 0) guardar();
      } catch (e) { C.log.push(`${new Date().toISOString()} erro ${url} ${e}`); if (t === 0) guardar(); }
      await espera(60000);
    }
    throw new Error('bloqueado ' + url);
  }
  function lerJogador(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const o = {};
    for (const w of doc.querySelectorAll('.player-summary-stat-box-data-wrapper')) {
      const trad = w.querySelector('.player-summary-stat-box-data.traditionalData') || w.querySelector('.player-summary-stat-box-data');
      const eco = w.querySelector('.player-summary-stat-box-data.ecoAdjustedData');
      const lab = (w.querySelector('.player-summary-stat-box-data-text')?.textContent || '').trim();
      const k = lab.startsWith('Round swing') ? 'swing' : lab.startsWith('DPR') ? 'dpr' : lab.startsWith('KAST') ? 'kast' : lab.startsWith('Multi-kill') ? 'mk' : lab.startsWith('ADR') ? 'adr' : lab.startsWith('KPR') ? 'kpr' : null;
      if (!k) continue;
      o[k] = numero(trad?.textContent);
      if (eco) o['e' + k] = numero(eco.textContent);
    }
    o.rating = numero(doc.querySelector('.player-summary-stat-box-rating-data-text')?.textContent);
    o.mapas = numero(doc.querySelector('.player-summary-stat-box-right-map-count')?.textContent);
    return o;
  }
  function lerMapa(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const linhas = [];
    for (const t of doc.querySelectorAll('table.stats-table.totalstats')) {
      const equipe = (t.querySelector('thead th')?.textContent || '').trim();
      for (const tr of t.querySelectorAll('tbody tr')) {
        const a = tr.querySelector('td.st-player a');
        const p = a ? new URL(a.href).pathname.split('/') : [];
        const v = (sel) => numero(tr.querySelector(sel)?.textContent);
        linhas.push([equipe.replace(/,/g, ' '), p[3] || '', v('.st-rating'), v('.st-roundSwing'), v('.st-kills.traditional-data'), v('.st-kills.eco-adjusted-data'), v('.st-deaths.traditional-data'), v('.st-deaths.eco-adjusted-data'), v('.st-adr.traditional-data'), v('.st-adr.eco-adjusted-data'), v('.st-kast.traditional-data'), v('.st-kast.eco-adjusted-data'), v('.st-mks')]);
      }
    }
    return linhas;
  }
  function sorteador(semente) { let s = semente >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  async function lerListaDeMapas(off, destino) {
    const doc = new DOMParser().parseFromString(await buscar(`/stats/matches?${PERIODO}&offset=${off}`), 'text/html');
    for (const tr of doc.querySelectorAll('table.stats-table tbody tr')) {
      const a = tr.querySelector('a[href*="/stats/matches/mapstatsid/"]');
      if (!a) continue;
      const td = [...tr.querySelectorAll('td')].map((x) => x.textContent.trim());
      const s1 = numero((td[1].match(/\((\d+)\)/) || [])[1]);
      const s2 = numero((td[2].match(/\((\d+)\)/) || [])[1]);
      destino.push({ caminho: new URL(a.href).pathname, data: td[0], mapa: td[3], rounds: (s1 || 0) + (s2 || 0) });
    }
  }
  async function lerMapas(lista) {
    for (const m of lista) {
      if (C.feitosM[m.caminho]) continue;
      const id = m.caminho.split('/')[4];
      for (const l of lerMapa(await buscar(m.caminho))) C.mapas.push([id, m.data, m.mapa.replace(/,/g, ' '), m.rounds, ...l].join(','));
      C.feitosM[m.caminho] = 1;
      if (Object.keys(C.feitosM).length % 10 === 0) guardar();
      await espera(2500);
    }
  }
  window.__baixar = (motivo) => {
    const conteudo = JSON.stringify({ geradoEm: new Date().toISOString(), motivo, periodo: PERIODO, colunasJogadores: 'id,slug,mapasLista,roundsLista,notaLista,mapas,rating,swing,kpr,dpr,adr,kast,mk,ekpr,edpr,eadr,ekast,emk', colunasMapas: 'mapa,data,nomeDoMapa,rounds,equipe,jogador,rating,swing,k,ek,d,ed,adr,eadr,kast,ekast,mks', jogadores: C.jogadores, mapas: C.mapas, paginasDeMapas: (C.listaM ? C.listaM.paginas : []).concat(C.extraM ? C.extraM.paginas : []), log: C.log, retomadas: C.retomadaEm });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
    a.download = motivo === 'fim com extras' ? 'hltv_coleta_grande.json' : 'hltv_coleta_parcial.json';
    document.body.appendChild(a);
    a.click();
    C.baixadoEm = new Date().toISOString();
    return conteudo.length;
  };
  window.__rodar3 = async () => {
    try {
      C.fase = 'jogadores';
      const feitos = new Set(C.jogadores.map((l) => l.split(',')[0]));
      for (const j of C.listaJ) {
        if (feitos.has(j.id)) continue;
        const o = lerJogador(await buscar(`/stats/players/${j.id}/${j.slug}?${PERIODO}`));
        C.jogadores.push([j.id, j.slug, j.mapas, j.rounds, j.nota, o.mapas, o.rating, o.swing, o.kpr, o.dpr, o.adr, o.kast, o.mk, o.ekpr, o.edpr, o.eadr, o.ekast, o.emk].join(','));
        feitos.add(j.id);
        if (C.jogadores.length % 10 === 0) guardar();
        await espera(2500);
      }
      guardar();
      C.fase = 'lista de mapas';
      if (!C.listaM) {
        const sorteio = sorteador(20261121);
        const paginas = new Set();
        while (paginas.size < 56) paginas.add(Math.floor(sorteio() * 663) * 50);
        C.listaM = { paginas: [...paginas].sort((a, b) => a - b), mapas: [], feitas: {} };
      }
      for (const off of C.listaM.paginas) {
        if (C.listaM.feitas[off]) continue;
        await lerListaDeMapas(off, C.listaM.mapas);
        C.listaM.feitas[off] = 1;
        guardar();
        await espera(2500);
      }
      C.fase = 'mapas';
      await lerMapas(C.listaM.mapas);
      guardar();
      C.fase = 'mapas extras';
      if (!C.extraM) {
        const sorteio = sorteador(20261122);
        const usadas = new Set(C.listaM.paginas);
        const paginas = new Set();
        while (paginas.size < 16) { const off = Math.floor(sorteio() * 663) * 50; if (!usadas.has(off)) paginas.add(off); }
        C.extraM = { paginas: [...paginas].sort((a, b) => a - b), mapas: [], feitas: {} };
      }
      for (const off of C.extraM.paginas) {
        if (C.extraM.feitas[off]) continue;
        await lerListaDeMapas(off, C.extraM.mapas);
        C.extraM.feitas[off] = 1;
        guardar();
        await espera(2500);
      }
      await lerMapas(C.extraM.mapas);
      C.fase = 'fim com extras';
      guardar();
    } catch (e) {
      if (String(e).includes(PARADO)) { C.fase = 'parado'; guardar(); return; }
      C.fase = 'parou: ' + e; C.log.push(String(e)); guardar();
    }
    window.__baixar(C.fase);
  };
  await guardar();
  window.__inicio = { em: Date.now(), jogadores: C.jogadores.length, mapas: Object.keys(C.feitosM).length };
  window.__rodar3();
}
'iniciado'
