/* cartinha.js - desenha a cartinha de um jogador num canvas 2D.
 *
 * Todo o desenho acontece num sistema de 500 x 800 unidades (proporção 5:8,
 * a mesma das cartinhas de 2024/2025). Quem chama escolhe a escala final:
 * escala 1.5 gera um PNG de 750 x 1200.
 *
 *   const canvas = Cartinha.renderizar(carta, imagens, { escala: 1.5 });
 *
 * carta: {
 *   nick, overall, funcao,                 // funcao: Duelista | Controlador | Iniciador | Sentinela | Flex
 *   partidas,                              // mapas jogados (opcional): "21 PARTIDAS" na ponta da carta
 *   agente,                                // nome do agente mais jogado (opcional)
 *   stats: [{ rotulo: "ACS", valor: "247" }, ...]   // 6 itens: 3 na coluna da esquerda, 3 na da direita
 *   time: { nome, nomeFundo, cores: ["#prim", "#sec"], paleta: {...} },
 *   enquadramento: { zoom, x, y, assinatura }  // opcional: enquadramento revisado da foto
 *                                          // (sem ele, o automático; ver PADRAO.foto)
 *   ajusteFoto: { zoom: 1, x: 0, y: 0 }    // opcional: ajuste fino por cima (unidades da carta)
 * }
 * imagens: { foto, logo, agente, funcao, evento } - Image/Canvas/ImageBitmap ou null
 *
 * Visual (versão 2): moldura angular com chanfros, fundo em degradê nas cores
 * do time com facetas, feixes de luz, retícula e granulação; overall compacto
 * no canto; foto menor, esmaecendo atrás do nome. Sem brilho (glow) nos textos.
 *
 * Não depende de nada além do navegador. A fonte "Oswald" (400 a 700) precisa
 * estar carregada antes de desenhar - ver Cartinha.carregarFontes().
 */
(function (global) {
  "use strict";

  const W = 500;
  const H = 800;

  const PADRAO = {
    escala: 1.5,
    ouro: "#E2BD6B",          // dourado dos detalhes e da moldura (cor-assinatura das cartinhas)
    nitidez: 0.5,             // reforço de nitidez da foto ampliada (0 desliga)
    // foto (sempre a imagem original - nada é gerado; só muda tamanho e
    // posição): altura do recorte com zoom 1 (unidades da carta), topo da
    // cabeça, centro, onde ela termina de sumir (fim, atrás do nome), até onde
    // o recorte tem que chegar (ancora: o corpo nunca termina antes do nome) e
    // quanto some no fim (esmaecer). Enquadramento automático: a cabeça fica na
    // altura padrão em todas as cartas, com ~"cabeca" unidades de largura
    // ("pesoCabeca": quanto a cabeça, e não os ombros, conta para centralizar);
    // o que chegaria perto do overall, do escudo ou do +PICK vai se dissolvendo,
    // só ali ("corte": margem até a coluna, largura do degradê, desfoque e
    // como a curva sobe e desce). A cabeça nunca é cortada. "cortar: false" desliga
    // o corte: a foto encolhe e desce até ficar a "folga" unidades da coluna
    // (é o que a silhueta faz). Fotos revisadas: dados/enquadramento-fotos.json.
    foto: { altura: 500, topo: 96, centro: 250, fim: 562, ancora: 535, esmaecer: 100, automatico: true, folga: 11, cabeca: 100, pesoCabeca: 0.4, zoomMin: 0.6, zoomMax: 1.15, subirMax: 16, descerMax: 140, cortar: true, corte: { margem: 4, suave: 72, borrao: 10, suaveEnquadramento: 22, raio: 24, subida: 6, descida: 40 } },
    semFoto: "silhueta",        // jogador sem foto: "silhueta" (padrão) ou "escudo"
    mostrarAgente: true,
    mostrarNomeFundo: false,  // nome do time em letras grandes na lateral (opcional)
    mostrarEvento: false,
    maiusculas: true,
    fonte: '"Oswald", "Arial Narrow", sans-serif',
  };

  /* ------------------------------------------------------------------ */
  /* cores                                                                */
  /* ------------------------------------------------------------------ */

  function rgb(hex) {
    let h = String(hex || "#000").trim().replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function hex({ r, g, b }) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
  }

  function misturar(a, b, t) {
    const x = rgb(a);
    const y = rgb(b);
    return hex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
  }

  const escurecer = (c, t) => misturar(c, "#000000", t);
  const clarear = (c, t) => misturar(c, "#ffffff", t);

  function rgba(c, a) {
    const { r, g, b } = rgb(c);
    return `rgba(${r},${g},${b},${a})`;
  }

  function luminancia(c) {
    const lin = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const { r, g, b } = rgb(c);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contraste(a, b) {
    const la = luminancia(a);
    const lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function hsl(c) {
    let { r, g, b } = rgb(c);
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  }

  // mistura com preto ou branco até a cor chegar perto da luminância pedida
  function comLuminancia(c, alvo) {
    const l = luminancia(c);
    if (Math.abs(l - alvo) < 0.004) return c;
    const destino = l > alvo ? "#000000" : "#ffffff";
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const m = (lo + hi) / 2;
      const v = luminancia(misturar(c, destino, m));
      if (l > alvo ? v > alvo : v < alvo) lo = m;
      else hi = m;
    }
    return misturar(c, destino, (lo + hi) / 2);
  }

  // clareia multiplicando os canais (mantém o matiz e a saturação, ao contrário de misturar com branco)
  function realcar(c, alvo) {
    const { r, g, b } = rgb(c);
    if (luminancia(c) >= alvo) return c;
    let lo = 1;
    let hi = 40;
    for (let i = 0; i < 24; i++) {
      const k = (lo + hi) / 2;
      const v = luminancia(hex({ r: Math.min(255, r * k + 1), g: Math.min(255, g * k + 1), b: Math.min(255, b * k + 1) }));
      if (v < alvo) lo = k;
      else hi = k;
    }
    const k = (lo + hi) / 2;
    return hex({ r: Math.min(255, r * k + 1), g: Math.min(255, g * k + 1), b: Math.min(255, b * k + 1) });
  }

  /* Paleta da carta a partir das duas cores do time (as do metadata.json).
   * Quatro temas, escolhidos pela cor principal:
   *  - ouro:   principal dourada/amarela (Furia, USP Stars, Sheriff, Poli) - carta dourada, texto escuro;
   *  - claro:  principal quase branca ou bem clara (UFU, Mauá, Acucarados) - carta perolada, texto escuro;
   *  - prata:  principal cinza médio (Tigre Branco, UEPA, UEG) - carta prateada, texto escuro;
   *  - escuro: o resto - degradê da cor principal até quase preto, texto claro.
   * A segunda cor vira o "acento" (feixes de luz e brilho atrás da foto).
   * Qualquer chave pode ser sobrescrita em time.paleta. */
  function paleta(cores, sobrescrever) {
    const lista = (cores || []).filter(Boolean);
    const principal = lista[0] || "#2c3140";
    const segunda = lista[1] || principal;
    const tp = hsl(principal);
    const lp = luminancia(principal);
    const pareceOuro = tp.h >= 28 && tp.h <= 58 && tp.s > 0.5 && lp > 0.25;

    let tema = "escuro";
    if (pareceOuro) tema = "ouro";
    else if (lp > 0.6) tema = "claro";
    else if (tp.s < 0.2 && lp > 0.3) tema = "prata";

    const p = { tema };
    if (tema === "escuro") {
      const quasePreto = lp < 0.02;
      const neutra = tp.s < 0.25 || Math.max(...Object.values(rgb(principal))) < 6;
      let acento = segunda;
      let base;
      if (quasePreto && neutra) {
        // preto puro fica chapado: vira grafite, com um fio quase imperceptível da segunda cor
        base = misturar("#1c1d22", acento, 0.03);
      } else if (quasePreto) {
        // azul-marinho, roxo ou verde quase pretos: clareia mantendo o matiz
        base = realcar(principal, 0.03);
      } else {
        base = lp > 0.13 ? comLuminancia(principal, 0.13) : principal;
      }
      if (contraste(acento, base) < 1.6) acento = clarear(base, 0.55);
      // grafite com acento muito claro (amarelo, laranja): a luz do acento fica mais
      // contida, senão o preto vira oliva/marrom
      const lavado = quasePreto && neutra && luminancia(acento) > 0.2;
      p.topo = misturar(base, "#ffffff", quasePreto ? 0.1 : 0.16);
      p.meio = base;
      p.fundo = misturar(escurecer(base, 0.72), "#050507", 0.35);
      p.acento = acento;
      p.texto = "#FFF6E6";
      p.rotulo = "#E6C47A";
      p.linha = "rgba(230,196,122,0.55)";
      p.moldura = ["#F7E6B0", "#C99541", "#F3D78F", "#9E722C", "#E8C778"];
      p.luz = "255,255,255";
      p.sombra = "0,0,0";
      p.facetaClara = 0.07;
      p.facetaEscura = 0.16;
      p.feixe = luminancia(acento) > 0.6 ? 0.13 : lavado ? 0.12 : 0.26;
      p.luzAcento = lavado ? 0.16 : 0.34;
      p.faixa = escurecer(p.fundo, 0.15);
      p.faixaForca = 0.9;
    } else if (tema === "claro") {
      let acento = segunda;
      if (contraste(acento, principal) < 1.4) acento = "#8a8f99";
      const tom = lp > 0.9 ? "#ECE9E2" : principal;
      p.topo = misturar(tom, "#ffffff", 0.7);
      p.meio = misturar(tom, "#ffffff", 0.18);
      p.fundo = comLuminancia(misturar(tom, acento, 0.12), 0.42);
      p.acento = acento;
      p.texto = "#1C1B19";
      p.rotulo = "#87631F";
      p.linha = "rgba(135,99,31,0.5)";
      p.moldura = ["#F7E6B0", "#C99541", "#F3D78F", "#9E722C", "#E8C778"];
      p.luz = "255,255,255";
      p.sombra = "40,32,20";
      p.facetaClara = 0.4;
      p.facetaEscura = 0.06;
      p.feixe = 0.2;
      p.faixa = misturar(p.meio, p.fundo, 0.3);
      p.faixaForca = 0.9;
    } else if (tema === "ouro") {
      let acento = segunda;
      if (luminancia(acento) > 0.35) acento = "#5a3d0c";
      p.topo = misturar(principal, "#fff6d8", 0.55);
      p.meio = misturar(principal, "#e9c160", 0.35);
      p.fundo = comLuminancia(misturar(principal, "#9b6a1c", 0.5), 0.2);
      p.acento = acento;
      p.texto = "#2A1D07";
      p.rotulo = "#4E3912";
      p.linha = "rgba(62,42,10,0.45)";
      p.moldura = ["#FFF3CF", "#8C6421", "#EBC872", "#6B4914", "#D9B25D"];
      p.luz = "255,248,225";
      p.sombra = "60,38,6";
      p.facetaClara = 0.3;
      p.facetaEscura = 0.1;
      p.feixe = 0.14;
      p.faixa = misturar(p.meio, p.fundo, 0.4);
      p.faixaForca = 0.9;
    } else {
      let acento = segunda;
      if (contraste(acento, principal) < 1.4) acento = "#4f555f";
      p.topo = "#F6F7F8";
      p.meio = misturar(principal, "#E3E5E8", 0.55);
      p.fundo = comLuminancia(principal, 0.3);
      p.acento = acento;
      p.texto = "#15171B";
      p.rotulo = "#3F444D";
      p.linha = "rgba(40,44,52,0.42)";
      p.moldura = ["#FFFFFF", "#9DA1A8", "#F2F3F5", "#787D86", "#DADDE2"];
      p.luz = "255,255,255";
      p.sombra = "20,22,28";
      p.facetaClara = 0.36;
      p.facetaEscura = 0.08;
      p.feixe = 0.13;
      p.faixa = misturar(p.meio, p.fundo, 0.3);
      p.faixaForca = 0.9;
    }
    return Object.assign(p, sobrescrever || {});
  }

  /* ------------------------------------------------------------------ */
  /* forma                                                                */
  /* ------------------------------------------------------------------ */

  // contorno externo: chanfros nos cantos de cima, um pico baixo no meio e
  // a ponta embaixo com um corte reto
  const CONTORNO = [
    [10, 96], [58, 48], [212, 48], [250, 26], [288, 48], [442, 48], [490, 96],
    [490, 674], [268, 790], [232, 790], [10, 674],
  ];

  function dentroDoPoligono(pts, x, y) {
    let dentro = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }

  // recua o contorno d unidades para dentro (desloca cada lado e cruza os vizinhos)
  function recuar(pts, d) {
    if (!d) return pts.map((p) => p.slice());
    const n = pts.length;
    const linhas = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % n];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      let nx = -(y2 - y1) / len;
      let ny = (x2 - x1) / len;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      if (!dentroDoPoligono(pts, mx + nx * 0.5, my + ny * 0.5)) {
        nx = -nx;
        ny = -ny;
      }
      linhas.push([x1 + nx * d, y1 + ny * d, x2 + nx * d, y2 + ny * d]);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = linhas[(i - 1 + n) % n];
      const b = linhas[i];
      const [x1, y1, x2, y2] = a;
      const [x3, y3, x4, y4] = b;
      const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(den) < 1e-9) {
        out.push([b[0], b[1]]);
        continue;
      }
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      out.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]);
    }
    return out;
  }

  // caminho com cantos levemente arredondados (raio pequeno, só para não serrilhar)
  function caminho(pts, raio) {
    const p = new Path2D();
    const n = pts.length;
    const meio = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const inicio = meio(pts[n - 1], pts[0]);
    p.moveTo(inicio[0], inicio[1]);
    for (let i = 0; i < n; i++) {
      const atual = pts[i];
      const prox = pts[(i + 1) % n];
      const ant = pts[(i - 1 + n) % n];
      const r = Math.min(raio, Math.hypot(atual[0] - ant[0], atual[1] - ant[1]) / 2, Math.hypot(prox[0] - atual[0], prox[1] - atual[1]) / 2);
      p.arcTo(atual[0], atual[1], prox[0], prox[1], r);
    }
    p.closePath();
    return p;
  }

  function escudo(recuo) {
    return caminho(recuar(CONTORNO, recuo || 0), recuo ? 3 : 4);
  }

  /* ------------------------------------------------------------------ */
  /* utilidades de desenho                                                */
  /* ------------------------------------------------------------------ */

  function fonteCss(peso, tamanho, fonte) {
    return `${peso} ${tamanho}px ${fonte}`;
  }

  function texto(ctx, s, x, y, { tamanho, peso = 600, cor, alinhar = "left", sombra = null, fonte, espaco = 0 }) {
    ctx.save();
    ctx.font = fonteCss(peso, tamanho, fonte);
    ctx.textAlign = alinhar;
    ctx.textBaseline = "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${espaco}px`;
    if (sombra) {
      ctx.shadowColor = sombra.cor;
      ctx.shadowBlur = sombra.blur || 0;
      ctx.shadowOffsetX = sombra.x || 0;
      ctx.shadowOffsetY = sombra.y || 0;
    }
    ctx.fillStyle = cor;
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  function larguraTexto(ctx, s, tamanho, peso, fonte, espaco = 0) {
    ctx.save();
    ctx.font = fonteCss(peso, tamanho, fonte);
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${espaco}px`;
    const w = ctx.measureText(s).width;
    ctx.restore();
    return w;
  }

  function ajustarTamanho(ctx, s, { max, min, larguraMax, peso, fonte, espaco = 0 }) {
    let t = max;
    while (t > min && larguraTexto(ctx, s, t, peso, fonte, espaco) > larguraMax) t -= 1;
    return t;
  }

  function linha(ctx, x1, y1, x2, y2, cor, largura) {
    ctx.save();
    ctx.strokeStyle = cor;
    ctx.lineWidth = largura;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function novaTela(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function larguraImagem(img) {
    return img.naturalWidth || img.videoWidth || img.width;
  }

  function alturaImagem(img) {
    return img.naturalHeight || img.videoHeight || img.height;
  }

  // gerador pseudoaleatório com semente (o mesmo time sai sempre igual)
  function semente(s) {
    let h = 2166136261;
    for (const ch of String(s || "")) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0 || 1;
  }

  function sorteio(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      return s / 4294967296;
    };
  }

  /* Reforço de nitidez (unsharp mask) para fotos de 320 px ampliadas.
   * Mexe só no RGB; o alfa do recorte fica intacto. */
  function nitidez(tela, quantidade) {
    if (!quantidade) return tela;
    const ctx = tela.getContext("2d");
    const { width: w, height: h } = tela;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const borrado = new Float32Array(w * h * 3);
    const tmp = new Float32Array(w * h * 3);
    const raio = 2;
    for (let y = 0; y < h; y++) {
      for (let c = 0; c < 3; c++) {
        let soma = 0;
        for (let x = -raio; x <= raio; x++) soma += d[(y * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 3 + c] = soma / (2 * raio + 1);
          const sai = Math.max(0, x - raio);
          const entra = Math.min(w - 1, x + raio + 1);
          soma += d[(y * w + entra) * 4 + c] - d[(y * w + sai) * 4 + c];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let soma = 0;
        for (let y = -raio; y <= raio; y++) soma += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 3 + c];
        for (let y = 0; y < h; y++) {
          borrado[(y * w + x) * 3 + c] = soma / (2 * raio + 1);
          const sai = Math.max(0, y - raio);
          const entra = Math.min(h - 1, y + raio + 1);
          soma += tmp[(entra * w + x) * 3 + c] - tmp[(sai * w + x) * 3 + c];
        }
      }
    }
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      if (d[i + 3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] + quantidade * (d[i + c] - borrado[j + c]);
        d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    ctx.putImageData(img, 0, 0);
    return tela;
  }

  /* Medidas de uma foto recortada (fundo transparente), em frações do tamanho
   * da imagem: topo da cabeça, centro da cabeça, centro dos ombros, largura da
   * cabeça e a borda esquerda da figura em cada linha. null = foto com fundo
   * (não é recorte) ou imagem de outra origem que não pode ser lida. */
  const cachePerfil = new WeakMap();
  function perfilDaFoto(img) {
    if (cachePerfil.has(img)) return cachePerfil.get(img);
    let r = null;
    try {
      r = medirFoto(img);
    } catch (e) {
      r = null;
    }
    cachePerfil.set(img, r);
    return r;
  }

  function mediana(v) {
    const o = v.slice().sort((a, b) => a - b);
    const m = o.length >> 1;
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  }

  function medirFoto(img) {
    const iw = larguraImagem(img);
    const ih = alturaImagem(img);
    const k = Math.min(1, 320 / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k));
    const h = Math.max(1, Math.round(ih * k));
    const tela = novaTela(w, h);
    const c = tela.getContext("2d", { willReadFrequently: true });
    c.drawImage(img, 0, 0, w, h);
    const d = c.getImageData(0, 0, w, h).data;
    const esq = new Float32Array(h).fill(-1);
    const dir = new Float32Array(h).fill(-1);
    let transparentes = 0;
    let topo = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = d[(y * w + x) * 4 + 3];
        if (a < 20) transparentes++;
        if (a > 40 && topo < 0) topo = y;
        if (a > 100) {
          if (esq[y] < 0) esq[y] = x;
          dir[y] = x;
        }
      }
    }
    if (transparentes / (w * h) <= 0.15 || topo < 0) return null;
    const u = h / 320; // as medidas abaixo foram pensadas para uma foto de 320 px
    const linhas = (de, ate) => {
      const r = [];
      for (let y = Math.max(0, Math.round(de)); y < Math.min(h, Math.round(ate)); y++) if (esq[y] >= 0) r.push(y);
      return r;
    };
    // centro da cabeça: média das colunas opacas logo abaixo do topo
    let soma = 0;
    let n = 0;
    for (let y = topo; y < Math.min(h, topo + Math.round(h * 0.18)); y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 40) {
          soma += x;
          n++;
        }
      }
    }
    const cabecaX = n ? soma / n : w / 2;
    // pescoço: a linha mais estreita um pouco abaixo da cabeça
    let pescoco = Math.min(h - 1, topo + Math.round(80 * u));
    let menor = Infinity;
    for (const y of linhas(topo + 40 * u, topo + 140 * u)) {
      if (dir[y] - esq[y] < menor) {
        menor = dir[y] - esq[y];
        pescoco = y;
      }
    }
    // centro dos ombros: mediana dos centros das linhas logo abaixo do pescoço
    const centros = linhas(pescoco + 10 * u, pescoco + 70 * u).map((y) => (esq[y] + dir[y]) / 2);
    const ombrosX = centros.length ? mediana(centros) : cabecaX;
    // largura da cabeça: mediana entre a testa e o queixo
    const larguras = linhas(topo + 15 * u, topo + 50 * u).map((y) => dir[y] - esq[y] + 1);
    const cabeca = larguras.length ? mediana(larguras) : w * 0.2;
    // borda esquerda da figura em cada linha
    const borda = new Float32Array(h);
    for (let y = 0; y < h; y++) borda[y] = esq[y] < 0 ? -1 : esq[y] / w;
    return {
      topo: topo / h,
      pescoco: pescoco / h,
      cabecaX: cabecaX / w,
      ombrosX: ombrosX / w,
      cabeca: cabeca / w,
      esq: borda,
    };
  }

  /* Luminância média de uma imagem (ponderada pelo alfa): serve para saber se
   * um logo some contra o fundo da carta - logo branco numa carta perolada. */
  const cacheLuz = new WeakMap();
  function luzDaImagem(img) {
    if (cacheLuz.has(img)) return cacheLuz.get(img);
    let luz = 0.3;
    try {
      const t = novaTela(48, 48);
      const c = t.getContext("2d", { willReadFrequently: true });
      c.drawImage(img, 0, 0, 48, 48);
      const d = c.getImageData(0, 0, 48, 48).data;
      let soma = 0;
      let peso = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        if (a < 0.05) continue;
        soma += luminancia(hex({ r: d[i], g: d[i + 1], b: d[i + 2] })) * a;
        peso += a;
      }
      if (peso) luz = soma / peso;
    } catch (e) {
      /* imagem de outra origem: fica com o valor neutro */
    }
    cacheLuz.set(img, luz);
    return luz;
  }

  // ícone pintado numa cor só (símbolos de classe são brancos)
  function tingir(img, cor, tamanho) {
    const t = novaTela(tamanho, tamanho);
    const c = t.getContext("2d");
    c.imageSmoothingQuality = "high";
    c.drawImage(img, 0, 0, tamanho, tamanho);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = cor;
    c.fillRect(0, 0, tamanho, tamanho);
    return t;
  }

  function iconeFlex() {
    // ícone próprio para Flex, no mesmo estilo dos símbolos de classe:
    // disco branco com duas setas circulares vazadas
    const t = novaTela(200, 200);
    const c = t.getContext("2d");
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(100, 100, 98, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = "destination-out";
    c.lineWidth = 20;
    c.lineCap = "butt";
    const raio = 50;
    const seta = (ini, fim) => {
      c.beginPath();
      c.arc(100, 100, raio, ini, fim);
      c.stroke();
      const ax = 100 + raio * Math.cos(fim);
      const ay = 100 + raio * Math.sin(fim);
      const tx = -Math.sin(fim);
      const ty = Math.cos(fim);
      const nx = Math.cos(fim);
      const ny = Math.sin(fim);
      c.beginPath();
      c.moveTo(ax + tx * 30, ay + ty * 30);
      c.lineTo(ax + nx * 26, ay + ny * 26);
      c.lineTo(ax - nx * 26, ay - ny * 26);
      c.closePath();
      c.fill();
    };
    seta(Math.PI * 1.05, Math.PI * 1.78);
    seta(Math.PI * 0.05, Math.PI * 0.78);
    return t;
  }

  // granulação fina, gerada uma vez (dá textura de impresso e tira o ar "digital")
  let telaGrao = null;
  function grao() {
    if (telaGrao) return telaGrao;
    const n = 220;
    const t = novaTela(n, n);
    const c = t.getContext("2d");
    const img = c.createImageData(n, n);
    const r = sorteio(20260930);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.round(r() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    telaGrao = t;
    return t;
  }

  /* ------------------------------------------------------------------ */
  /* camadas                                                              */
  /* ------------------------------------------------------------------ */

  function camadaFundo(ctx, pal) {
    // degradê diagonal: do tom claro (alto, à esquerda) ao escuro (baixo, à direita)
    const g = ctx.createLinearGradient(40, 0, 460, H);
    g.addColorStop(0, pal.topo);
    g.addColorStop(0.42, pal.meio);
    g.addColorStop(1, pal.fundo);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // luz da segunda cor atrás da cabeça (alto, à direita)
    const r = ctx.createRadialGradient(360, 150, 10, 360, 150, 300);
    const forca = pal.luzAcento != null ? pal.luzAcento : pal.tema === "escuro" ? 0.34 : 0.22;
    r.addColorStop(0, rgba(pal.acento, forca));
    r.addColorStop(0.55, rgba(pal.acento, forca * 0.35));
    r.addColorStop(1, rgba(pal.acento, 0));
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, W, H);
  }

  // facetas grandes, como um cristal lapidado; o desenho muda um pouco por time
  function camadaFacetas(ctx, pal, chave) {
    const rnd = sorteio(semente(chave));
    const j = (v, a) => v + (rnd() - 0.5) * a;
    const P = {
      a: [0, 0], b: [j(170, 40), 0], c: [j(330, 40), 0], d: [W, 0],
      e: [0, j(190, 40)], f: [j(140, 40), j(150, 40)], g: [j(280, 40), j(120, 30)], h: [W, j(170, 40)],
      i: [0, j(390, 40)], k: [j(210, 50), j(320, 40)], l: [j(380, 40), j(290, 40)], m: [W, j(400, 40)],
      n: [0, 560], o: [j(160, 40), 520], q: [j(340, 40), 540], s: [W, 560],
    };
    const tri = [
      ["a", "b", "f", 0.9], ["a", "f", "e", 0.5], ["b", "c", "g", 0.3], ["b", "g", "f", -0.3],
      ["c", "d", "h", 0.6], ["c", "h", "g", -0.5], ["e", "f", "k", -0.2], ["e", "k", "i", 0.4],
      ["f", "g", "k", 0.7], ["g", "l", "k", -0.6], ["g", "h", "l", 0.2], ["h", "m", "l", -0.8],
      ["i", "k", "o", -0.4], ["i", "o", "n", 0.2], ["k", "l", "q", 0.3], ["k", "q", "o", -0.3],
      ["l", "m", "s", -0.5], ["l", "s", "q", 0.2],
    ];
    ctx.save();
    for (const [x, y, z, tom] of tri) {
      const a = tom > 0 ? pal.facetaClara * tom : pal.facetaEscura * -tom;
      ctx.fillStyle = tom > 0 ? `rgba(${pal.luz},${a})` : `rgba(${pal.sombra},${a})`;
      ctx.beginPath();
      ctx.moveTo(P[x][0], P[x][1]);
      ctx.lineTo(P[y][0], P[y][1]);
      ctx.lineTo(P[z][0], P[z][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // dois feixes diagonais na segunda cor, cruzando atrás do jogador
  function camadaFeixes(ctx, pal) {
    const feixe = (x0, largura, inclinacao, alfa) => {
      const y0 = 600;
      const y1 = -40;
      const dx = (y0 - y1) * inclinacao;
      ctx.save();
      const g = ctx.createLinearGradient(x0, y0, x0 + dx, y1);
      g.addColorStop(0, rgba(pal.acento, 0));
      g.addColorStop(0.45, rgba(pal.acento, alfa));
      g.addColorStop(1, rgba(pal.acento, alfa * 0.35));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + largura, y0);
      ctx.lineTo(x0 + largura + dx, y1);
      ctx.lineTo(x0 + dx, y1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    feixe(-60, 92, 0.62, pal.feixe);
    feixe(70, 30, 0.62, pal.feixe * 0.8);
    feixe(150, 12, 0.62, pal.feixe * 0.6);
  }

  // retícula de pontos nos cantos (como impressão), some em direção ao centro
  function camadaReticula(ctx, pal, cantos, passo = 9, raio = 2.4) {
    const cor = pal.tema === "escuro" ? `rgba(${pal.luz},0.13)` : `rgba(${pal.sombra},0.09)`;
    ctx.save();
    ctx.fillStyle = cor;
    const canto = ([cx, cy, alcance]) => {
      for (let y = cy - alcance; y <= cy + alcance; y += passo) {
        for (let x = cx - alcance; x <= cx + alcance; x += passo) {
          const dist = Math.hypot(x - cx, y - cy);
          const r = raio * (1 - dist / alcance);
          if (r <= raio * 0.1) continue;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    (cantos || [[470, 60, 200], [30, 470, 160]]).forEach(canto);
    ctx.restore();
  }

  function camadaNomeFundo(ctx, nome, pal, o) {
    if (!nome) return;
    const s = o.maiusculas ? nome.toUpperCase() : nome;
    const peso = 700;
    // na vertical, colado na borda direita: não cruza o rosto nem o nome
    const tamanho = ajustarTamanho(ctx, s, { max: 92, min: 46, larguraMax: 400, peso, fonte: o.fonte, espaco: 2 });
    const cor = pal.tema === "escuro" ? `rgba(${pal.luz},0.08)` : `rgba(${pal.sombra},0.07)`;
    ctx.save();
    ctx.translate(486, 268);
    ctx.rotate(Math.PI / 2);
    texto(ctx, s, 0, 0, { tamanho, peso, cor, alinhar: "center", fonte: o.fonte, espaco: 2 });
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* enquadramento da foto                                                */
  /* ------------------------------------------------------------------ */

  /* Borda direita da coluna da esquerda (overall, escudo, agente e +PICK) em
   * cada linha da carta. Devolve:
   *   limite: a borda "engordada" pela folga - a figura tem que ficar à direita
   *           dela quando a foto não é cortada (silhueta);
   *   corte:  onde começa o corte lateral suave da foto (ver mascaraCorte): a
   *           mesma borda, com uma margem, alisada na vertical para virar uma
   *           curva só (sem dentes entre o overall, o escudo e o agente) que
   *           some acima da coluna e, devagar, abaixo dela.
   * null se não der para medir. */
  function perfilColuna(carta, imagens, pal, cfg, o) {
    try {
      const tela = novaTela(W, H);
      const c = tela.getContext("2d", { willReadFrequently: true });
      camadaColunaEsquerda(c, carta, imagens, pal, o);
      const meia = W / 2;
      const d = c.getImageData(0, 0, meia, H).data;
      const borda = new Float32Array(H).fill(-1e9);
      for (let y = 0; y < H; y++) {
        for (let x = meia - 1; x >= 0; x--) {
          if (d[(y * meia + x) * 4 + 3] > 64) {
            borda[y] = x + 1;
            break;
          }
        }
      }
      const folga = cfg.folga;
      const limite = new Float32Array(H).fill(-1e9);
      for (let y = 0; y < H; y++) {
        for (let k = -folga; k <= folga; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= H || borda[yy] < -1e8) continue;
          const v = borda[yy] + Math.sqrt(folga * folga - k * k);
          if (v > limite[y]) limite[y] = v;
        }
      }
      const cc = cfg.corte || {};
      const margem = cc.margem ?? 8;
      const raio = cc.raio ?? 24;
      const corte = new Float32Array(H).fill(-1e9);
      for (let y = 0; y < H; y++) {
        let melhor = -1e9;
        for (let yy = Math.max(0, y - 160); yy < Math.min(H, y + 90); yy++) {
          if (borda[yy] < -1e8) continue;
          const dd = y - yy; // > 0: a linha y está abaixo do elemento
          const fora = Math.max(0, Math.abs(dd) - raio);
          const queda = dd < 0 ? (fora * fora) / (cc.subida ?? 6) : (fora * fora) / (cc.descida ?? 40);
          const v = borda[yy] + margem - queda;
          if (v > melhor) melhor = v;
        }
        corte[y] = melhor;
      }
      // largura: o degradê do desenho; larguraEnquadramento: a que o enquadramento
      // automático usa para medir o corte (a mesma da revisão das fotos)
      return { limite, corte, largura: cc.suave ?? 72, borrao: cc.borrao ?? 10, larguraEnquadramento: cc.suaveEnquadramento ?? 22 };
    } catch (e) {
      return null;
    }
  }

  /* Máscara do corte lateral: a foto vai se dissolvendo perto da coluna da
   * esquerda - transparente na curva "corte" e voltando a aparecer devagar ao
   * longo de "largura" unidades (curva smootherstep, sem quina), com um leve
   * desfoque para a borda não desenhar o contorno do overall, do escudo e do
   * agente. Só existe na altura da coluna; o resto da foto fica intacto. */
  const cacheMascara = new WeakMap();
  function alfaCorte(coluna) {
    if (cacheMascara.has(coluna)) return cacheMascara.get(coluna);
    const a = new Float32Array(W * H).fill(1);
    const w = coluna.largura;
    for (let y = 0; y < H; y++) {
      const b = coluna.corte[y];
      if (b < -1e8) continue;
      for (let x = 0; x < W; x++) {
        const t = (x - b) / w;
        a[y * W + x] = t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (6 * t - 15) + 10);
      }
    }
    const r = Math.round(coluna.borrao || 0);
    if (r > 0) {
      // desfoque de caixa separável, duas passadas (quase gaussiano)
      const tmp = new Float32Array(W * H);
      const caixa = (src, dst, n, passo, linhas, salto) => {
        for (let l = 0; l < linhas; l++) {
          const o = l * salto;
          let soma = 0;
          for (let i = -r; i <= r; i++) soma += src[o + Math.min(n - 1, Math.max(0, i)) * passo];
          for (let i = 0; i < n; i++) {
            dst[o + i * passo] = soma / (2 * r + 1);
            soma += src[o + Math.min(n - 1, i + r + 1) * passo] - src[o + Math.max(0, i - r) * passo];
          }
        }
      };
      for (let k = 0; k < 2; k++) {
        caixa(a, tmp, W, 1, H, W); // horizontal
        caixa(tmp, a, H, W, W, 1); // vertical
      }
    }
    cacheMascara.set(coluna, a);
    return a;
  }

  /* A máscara como imagem, com as áreas protegidas (a cabeça, sempre; mãos e
   * gestos marcados na tabela) opacas: formas em unidades da carta,
   * { ret: [x0, y0, x1, y1] } ou { elipse: [cx, cy, rx, ry] }, borda suave. */
  function mascaraCorte(coluna, protegidas) {
    const base = alfaCorte(coluna);
    const a = Float32Array.from(base);
    const suave = 10;
    const passo = (t) => 1 - t * t * (3 - 2 * t);
    for (const f of protegidas || []) {
      let ax, bx, ay, by, dist;
      if (f.ret) {
        const [x0, y0, x1, y1] = f.ret;
        [ax, bx, ay, by] = [x0 - suave, x1 + suave, y0 - suave, y1 + suave];
        dist = (x, y) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(y0 - y, 0, y - y1));
      } else if (f.elipse) {
        const [cx, cy, rx, ry] = f.elipse;
        [ax, bx, ay, by] = [cx - rx - suave, cx + rx + suave, cy - ry - suave, cy + ry + suave];
        dist = (x, y) => Math.max(0, Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
      } else continue;
      for (let y = Math.max(0, Math.floor(ay)); y <= Math.min(H - 1, Math.ceil(by)); y++) {
        for (let x = Math.max(0, Math.floor(ax)); x <= Math.min(W - 1, Math.ceil(bx)); x++) {
          const v = passo(Math.min(1, dist(x, y) / suave));
          const k = y * W + x;
          if (v > a[k]) a[k] = v;
        }
      }
    }
    const tela = novaTela(W, H);
    const c = tela.getContext("2d");
    const img = c.createImageData(W, H);
    for (let k = 0; k < W * H; k++) img.data[k * 4 + 3] = Math.round(a[k] * 255);
    c.putImageData(img, 0, 0);
    return tela;
  }

  /* Onde a foto termina de sumir: atrás do nome (cfg.fim) ou um pouco antes
   * do fim do recorte, se ele acaba antes - o corte reto nunca aparece. A
   * foto é sempre a original: só mudam o tamanho e a posição. */
  function fimDaFoto(fundo, cfg) {
    return Math.min(cfg.fim, fundo - 5);
  }

  // quanto da foto ainda aparece na altura y (o mesmo degradê de camadaFoto)
  function opacidadeEsmaecer(y, ini, fim) {
    if (y <= ini) return 1;
    const t = (y - ini) / (fim - ini);
    if (t >= 1) return 0;
    return t < 0.55 ? 1 - (0.45 * t) / 0.55 : 0.55 * (1 - (t - 0.55) / 0.45);
  }

  function centroDaFoto(perfil, cfg) {
    const p = Math.max(0, Math.min(1, Number(cfg.pesoCabeca)));
    return p * perfil.cabecaX + (1 - p) * perfil.ombrosX;
  }

  /* "Impressão digital" da foto, guardada junto do enquadramento revisado:
   * se a foto do jogador mudar, o enquadramento antigo deixa de valer. */
  function assinaturaFoto(img, perfil) {
    const r = (v) => Math.round(v * 1000) / 1000;
    return { w: larguraImagem(img), h: alturaImagem(img), topo: r(perfil.topo), cabecaX: r(perfil.cabecaX), cabeca: r(perfil.cabeca) };
  }

  function mesmaFoto(a, b) {
    if (!a || !b) return true; // sem assinatura: vale sempre
    if (Number(a.w) !== Number(b.w) || Number(a.h) !== Number(b.h)) return false;
    return ["topo", "cabecaX", "cabeca"].every((k) => Math.abs(Number(a[k]) - Number(b[k])) <= 0.015);
  }

  /* Enquadramento de base da foto: o revisado (carta.enquadramento, quando é
   * desta foto) ou o automático. { zoom, x, y, origem } */
  function enquadramentoBase(carta, img, perfil, coluna, cfg) {
    const fixo = carta && carta.enquadramento;
    if (fixo && mesmaFoto(fixo.assinatura, assinaturaFoto(img, perfil))) {
      return {
        zoom: Number(fixo.zoom) || 1,
        x: Number(fixo.x) || 0,
        y: Number(fixo.y) || 0,
        cortar: fixo.cortar !== false,
        proteger: Array.isArray(fixo.proteger) ? fixo.proteger : null,
        origem: "revisado",
      };
    }
    if (cfg.automatico === false) return { zoom: 1, x: 0, y: 0, origem: "padrao" };
    const r = enquadrar(perfil, coluna, cfg, larguraImagem(img) / alturaImagem(img), cfg.cortar !== false);
    return { zoom: r.zoom, x: 0, y: r.y, origem: "automatico" };
  }

  /* Quanto a figura entra na folga da coluna (unidades; <= 0 = não encosta)
   * com o zoom z e descendo dy unidades. */
  function invasaoDaColuna(perfil, coluna, cfg, proporcao, z, dy, dx) {
    const A = cfg.altura * z;
    const L = A * proporcao;
    const x0 = cfg.centro - centroDaFoto(perfil, cfg) * L + (dx || 0);
    const y0 = cfg.topo + dy - perfil.topo * A;
    const fim = fimDaFoto(y0 + A, cfg);
    const ini = fim - cfg.esmaecer;
    let pior = -Infinity;
    const testar = (Y, X) => {
      if (Y < 0 || Y > H - 1 || opacidadeEsmaecer(Y, ini, fim) < 0.35) return;
      const lim = coluna.limite[Math.round(Y)];
      if (lim > -1e8 && lim - X > pior) pior = lim - X;
    };
    const n = perfil.esq.length;
    const passo = A / n;
    for (let i = 0; i < n; i++) if (perfil.esq[i] >= 0) testar(y0 + (i + 0.5) * passo, x0 + perfil.esq[i] * L);
    return { invasao: pior, fim };
  }

  /* Quanto da figura o corte lateral esconde (unidades², pesando o que ainda
   * aparece na altura de cada linha) com o zoom z, descendo dy. */
  function corteDaColuna(perfil, coluna, cfg, proporcao, z, dy, dx) {
    const A = cfg.altura * z;
    const L = A * proporcao;
    const x0 = cfg.centro - centroDaFoto(perfil, cfg) * L + (dx || 0);
    const y0 = cfg.topo + dy - perfil.topo * A;
    const fim = fimDaFoto(y0 + A, cfg);
    const ini = fim - cfg.esmaecer;
    const w = coluna.larguraEnquadramento || coluna.largura;
    const n = perfil.esq.length;
    const passo = A / n;
    const linhaPescoco = (perfil.pescoco ?? 0.35) * n;
    let total = 0;
    let cabeca = 0;
    for (let i = 0; i < n; i++) {
      if (perfil.esq[i] < 0) continue;
      const Y = y0 + (i + 0.5) * passo;
      if (Y < 0 || Y > H - 1) continue;
      const b = coluna.corte[Math.round(Y)];
      if (b < -1e8) continue;
      const X = x0 + perfil.esq[i] * L;
      const perda = X < b + w ? (X < b ? b - X + w / 2 : ((b + w - X) * (b + w - X)) / (2 * w)) : 0;
      total += perda * passo * opacidadeEsmaecer(Y, ini, fim);
      // cabeça: só conta o que entraria na faixa totalmente transparente (a
      // cabeça é protegida no desenho, mas não pode encostar na coluna)
      if (i < linhaPescoco) cabeca += Math.max(0, b + 6 - X) * passo;
    }
    return { corte: total, cabeca, fim };
  }

  /* Enquadramento automático. A foto fica sempre ancorada no nome: o fim do
   * recorte chega até atrás do nome (ou passa dele, e o que passa fica
   * escondido), nunca termina antes - o corpo não fica "flutuando". A cabeça
   * fica o mais perto possível da altura padrão (cfg.topo) e com ~cfg.cabeca
   * unidades de largura.
   * comCorte (fotos): o que chegaria perto do overall, do escudo ou do +PICK
   * some no corte lateral suave (mascaraCorte); entre altura padrão e corte,
   * pesa a soma dos dois (cfg.corte.peso). Sem corte (silhueta): a figura
   * encolhe e desce até ficar a cfg.folga unidades da coluna. */
  function enquadrar(perfil, coluna, cfg, proporcao, comCorte) {
    const zMin = Math.min(1, Number(cfg.zoomMin) || 0.6);
    const zMax = Math.max(zMin, Number(cfg.zoomMax) || 1);
    const cabeca1 = perfil.cabeca * cfg.altura * proporcao; // largura da cabeça com zoom 1
    const zPref = Math.max(zMin, Math.min(zMax, cfg.cabeca / Math.max(1, cabeca1)));
        const ancora = (z) => {
      // menor descida que faz o fim do recorte chegar atrás do nome (cfg.ancora)
      const A = cfg.altura * z;
      const fundo = cfg.topo - perfil.topo * A + A;
      return Math.max(-cfg.subirMax, Math.ceil(cfg.ancora + 5 - fundo));
    };
    const p = Object.assign(
      { alturaLivre: 4, altura: 0.04, cabecaMax: 112, cabeca: 0.06, cabecaMin: 85, cabecaPequena: 0.05, corte: 0.004, corteLimite: 6000, corteExcesso: 0.03 },
      (cfg.corte && cfg.corte.pesos) || {}
    );
    let melhor = null;
    const passos = Math.round((zMax - zMin) / 0.01);
    for (let i = 0; i <= passos; i++) {
      const z = zMax - i * 0.01;
      const dyMin = ancora(z);
      for (let dy = dyMin; dy <= Math.max(dyMin, cfg.descerMax); dy += 2) {
        let nota;
        let invasao = 0;
        let corte = 0;
        if (comCorte) {
          // prioridade: a cabeça na altura padrão (todas as cartas parecidas);
          // foto fechada (só rosto e peito) fica maior em vez de descer; o
          // corte lateral perto da coluna pesa, e muito acima do limite
          const cab = cabeca1 * z;
          const desce = Math.max(0, Math.abs(dy) - p.alturaLivre);
          nota = p.altura * desce * desce;
          nota += p.cabeca * Math.max(0, cab - p.cabecaMax) ** 2 + p.cabecaPequena * Math.max(0, p.cabecaMin - cab) ** 2;
          if (coluna) {
            const r = corteDaColuna(perfil, coluna, cfg, proporcao, z, dy);
            corte = r.corte;
            nota += p.corte * corte + p.corteExcesso * Math.max(0, corte - p.corteLimite) + 50 * r.cabeca; // a cabeça nunca é cortada
          }
        } else {
          // sem corte (silhueta): cabeça maior que o padrão pesa mais que
          // menor; descer também pesa; encostar na coluna, muito
          nota = 400 * Math.max(0, z - zPref) + 200 * Math.max(0, zPref - z) + 2 * Math.abs(dy);
          if (coluna) {
            invasao = Math.max(0, invasaoDaColuna(perfil, coluna, cfg, proporcao, z, dy).invasao);
            nota += 1000 * invasao;
          }
        }
        if (!melhor || nota < melhor.nota) melhor = { nota, zoom: z, y: dy, invasao, corte };
        if ((comCorte ? corte : invasao) === 0 && dy >= 0) break; // descer mais só baixaria a cabeça
      }
    }
    return melhor;
  }

  function camadaFoto(ctx, img, pal, carta, escala, o, coluna) {
    const caixa = novaTela(Math.round(W * escala), Math.round(H * escala));
    const c = caixa.getContext("2d");
    c.scale(escala, escala);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";

    const iw = larguraImagem(img);
    const ih = alturaImagem(img);
    const cfg = Object.assign({}, PADRAO.foto, o.foto || {});
    const aj = (carta && carta.ajusteFoto) || {};
    const perfil = perfilDaFoto(img);
    const base = perfil ? enquadramentoBase(carta, img, perfil, coluna, cfg) : { zoom: 1, x: 0, y: 0 };
    // o ajuste da carta (zoom, x, y) vale por cima do enquadramento de base
    const zoom = base.zoom * (Number(aj.zoom) || 1);
    const alturaAlvo = cfg.altura * zoom;
    const largura = (alturaAlvo * iw) / ih;
    let x = cfg.centro - (perfil ? centroDaFoto(perfil, cfg) : 0.5) * largura + base.x;
    let y = perfil ? cfg.topo + base.y - perfil.topo * alturaAlvo : 70;
    x += Number(aj.x) || 0;
    y += Number(aj.y) || 0;

    const px = Math.max(1, Math.round(largura * escala));
    const py = Math.max(1, Math.round(alturaAlvo * escala));
    let foto = novaTela(px, py);
    const fc = foto.getContext("2d", { willReadFrequently: true });
    fc.imageSmoothingEnabled = true;
    fc.imageSmoothingQuality = "high";
    fc.drawImage(img, 0, 0, px, py);
    const ampliacao = px / iw;
    if (o.nitidez && ampliacao > 1.15) {
      try {
        foto = nitidez(foto, o.nitidez);
      } catch (e) {
        /* canvas "sujo" (imagem de outra origem): segue sem nitidez */
      }
    }
    c.drawImage(foto, x, y, largura, alturaAlvo);

    // o fim do recorte some suavemente, atrás do nome sempre que possível
    const fim = fimDaFoto(y + alturaAlvo, cfg);
    const ini = fim - cfg.esmaecer;

    // o corpo ganha a cor do fundo da carta perto do fim, para "entrar" na carta
    c.globalCompositeOperation = "source-atop";
    const tinta = c.createLinearGradient(0, ini - 70, 0, fim);
    tinta.addColorStop(0, rgba(pal.fundo, 0));
    tinta.addColorStop(1, rgba(pal.fundo, pal.tema === "escuro" ? 0.5 : 0.28));
    c.fillStyle = tinta;
    c.fillRect(0, 0, W, H);

    // e some suavemente
    c.globalCompositeOperation = "destination-in";
    const m = c.createLinearGradient(0, ini, 0, fim);
    m.addColorStop(0, "rgba(0,0,0,1)");
    m.addColorStop(0.55, "rgba(0,0,0,0.55)");
    m.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = m;
    c.fillRect(0, 0, W, H);

    // a foto se dissolve perto do overall, do escudo e do +PICK; a cabeça e
    // as áreas marcadas na tabela (mãos, gestos) ficam de fora
    if (perfil && coluna && cfg.cortar !== false && base.cortar !== false) {
      const topoCabeca = y + perfil.topo * alturaAlvo;
      const pescoco = y + (perfil.pescoco ?? perfil.topo + 0.3) * alturaAlvo;
      const cabeca = { elipse: [x + perfil.cabecaX * largura, (topoCabeca + pescoco) / 2, perfil.cabeca * largura * 0.62, (pescoco - topoCabeca) / 2 + 4] };
      const marcadas = (base.proteger || []).map(([a, b, c2, d2]) => ({ ret: [x + a * largura, y + b * alturaAlvo, x + c2 * largura, y + d2 * alturaAlvo] }));
      c.drawImage(mascaraCorte(coluna, [cabeca, ...marcadas]), 0, 0, W, H);
    }

    ctx.save();
    ctx.shadowColor = pal.tema === "escuro" ? "rgba(0,0,0,0.42)" : `rgba(${pal.sombra},0.25)`;
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = -5;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(caixa, 0, 0, W, H);
    ctx.restore();
    return { zoom, x, y, base };
  }

  /* Forma da silhueta (fundo transparente): a imagem do Hub Uni
   * (assets/user-silhouette.png, cabeça e ombros) com o tronco continuando
   * para baixo, para sumir atrás do nome como as fotos. Ela é enquadrada do
   * mesmo jeito que uma foto (tamanho e folga até a coluna da esquerda). */
  const cacheForma = new WeakMap();
  let formaVetorial = null;
  function formaSilhueta(img) {
    if (img && cacheForma.has(img)) return cacheForma.get(img);
    if (!img && formaVetorial) return formaVetorial;
    const w = 320;
    const h = 440;
    const t = novaTela(w, h);
    const c = t.getContext("2d");
    c.fillStyle = "#000";
    if (img) {
      // na imagem de 320 px: cabeça de 124 px começando em y = 33; ombros com 253 px na base (y = 282)
      c.drawImage(img, 0, 0, w, (alturaImagem(img) * w) / larguraImagem(img));
      c.beginPath();
      c.moveTo(35, 282);
      c.lineTo(286, 282);
      c.lineTo(277, h);
      c.lineTo(44, h);
      c.closePath();
      c.fill();
      cacheForma.set(img, t);
    } else {
      // sem a imagem do site: desenho equivalente (cabeça redonda e ombros)
      const k = 124 / 116;
      const cx = w / 2;
      const y0 = 33;
      c.beginPath();
      c.ellipse(cx, y0 + 64 * k, 58 * k, 64 * k, 0, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(cx - 40 * k, y0 + 150 * k);
      c.bezierCurveTo(cx - 110 * k, y0 + 160 * k, cx - 124 * k, y0 + 200 * k, cx - 124 * k, y0 + 250 * k);
      c.lineTo(cx - 114 * k, h);
      c.lineTo(cx + 114 * k, h);
      c.lineTo(cx + 124 * k, y0 + 250 * k);
      c.bezierCurveTo(cx + 124 * k, y0 + 200 * k, cx + 110 * k, y0 + 160 * k, cx + 40 * k, y0 + 150 * k);
      c.closePath();
      c.fill();
      formaVetorial = t;
    }
    return t;
  }

  /* Jogador sem foto: a silhueta na cor da carta, enquadrada como as fotos. */
  function camadaSilhueta(ctx, img, pal, escala, o, coluna) {
    const cfg = Object.assign({}, PADRAO.foto, o.foto || {});
    const forma = formaSilhueta(img);
    const perfil = perfilDaFoto(forma);
    if (!perfil) return;
    const proporcao = forma.width / forma.height;
    const base = cfg.automatico !== false ? enquadrar(perfil, coluna, cfg, proporcao, false) : { zoom: 0.71, y: 0 };
    const A = cfg.altura * base.zoom;
    const largura = A * proporcao;
    const x = cfg.centro - centroDaFoto(perfil, cfg) * largura;
    const y = cfg.topo + base.y - perfil.topo * A;
    const fim = fimDaFoto(y + A, cfg);
    const ini = fim - cfg.esmaecer;

    const caixa = novaTela(Math.round(W * escala), Math.round(H * escala));
    const c = caixa.getContext("2d");
    c.scale(escala, escala);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(forma, x, y, largura, A);
    // cor: um tom mais claro da carta (cartas escuras) ou mais escuro (claras), mais forte em cima
    c.globalCompositeOperation = "source-in";
    const g = c.createLinearGradient(0, cfg.topo, 0, fim);
    if (pal.tema === "escuro") {
      g.addColorStop(0, misturar(pal.meio, "#ffffff", 0.3));
      g.addColorStop(1, misturar(pal.meio, "#ffffff", 0.12));
    } else {
      g.addColorStop(0, misturar(pal.meio, "#000000", 0.26));
      g.addColorStop(1, misturar(pal.meio, "#000000", 0.1));
    }
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // some atrás do nome, como as fotos
    c.globalCompositeOperation = "destination-in";
    const m = c.createLinearGradient(0, ini, 0, fim);
    m.addColorStop(0, "rgba(0,0,0,1)");
    m.addColorStop(0.55, "rgba(0,0,0,0.55)");
    m.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = m;
    c.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.shadowColor = pal.tema === "escuro" ? "rgba(0,0,0,0.35)" : `rgba(${pal.sombra},0.2)`;
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = -4;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(caixa, 0, 0, W, H);
    ctx.restore();
  }

  /* Quanto do logo aparece contra uma cor de fundo: fração dos pixels (pesada
   * pelo alfa) com contraste de pelo menos 2:1. Logos com contorno claro ou
   * escuro passam; logo todo branco numa carta perolada, não. */
  const cacheVisivel = new WeakMap();
  function visibilidade(img, corFundo) {
    let porCor = cacheVisivel.get(img);
    if (!porCor) {
      porCor = new Map();
      cacheVisivel.set(img, porCor);
    }
    if (porCor.has(corFundo)) return porCor.get(corFundo);
    let frac = 1;
    try {
      const n = 64;
      const t = novaTela(n, n);
      const c = t.getContext("2d", { willReadFrequently: true });
      c.drawImage(img, 0, 0, n, n);
      const d = c.getImageData(0, 0, n, n).data;
      const lf = luminancia(corFundo);
      let ok = 0;
      let total = 0;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        if (a < 0.3) continue;
        const lp = luminancia(hex({ r: d[i], g: d[i + 1], b: d[i + 2] }));
        const ctr = (Math.max(lp, lf) + 0.05) / (Math.min(lp, lf) + 0.05);
        total += a;
        if (ctr >= 2) ok += a;
      }
      if (total) frac = ok / total;
    } catch (e) {
      /* imagem de outra origem: considera visível */
    }
    porCor.set(corFundo, frac);
    return frac;
  }

  // desenha um logo; se ele some contra o fundo, ganha um selo redondo atrás
  function desenharLogo(ctx, logo, cx, cy, t, pal, corFundo, grande) {
    const luzLogo = luzDaImagem(logo);
    const luzFundo = luminancia(corFundo);
    if (visibilidade(logo, corFundo) < 0.3) {
      const escuroAtras = luzLogo > 0.12 || luzLogo > luzFundo;
      const r = t * 0.57;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      if (escuroAtras) {
        const base = pal.tema === "escuro" ? escurecer(pal.fundo, 0.3) : "#22242b";
        g.addColorStop(0, misturar(base, "#ffffff", 0.1));
        g.addColorStop(1, escurecer(base, 0.35));
      } else {
        g.addColorStop(0, "#ffffff");
        g.addColorStop(1, "#e4e6ea");
      }
      ctx.fillStyle = g;
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = grande ? 14 : 4;
      ctx.shadowOffsetY = grande ? 6 : 1;
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = grande ? 3 : 1.4;
      ctx.strokeStyle = pal.rotulo;
      ctx.stroke();
      if (grande) {
        ctx.beginPath();
        ctx.arc(cx, cy, r - 8, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.45;
        ctx.stroke();
      }
      ctx.restore();
      t *= 0.8; // o logo cabe dentro do selo
    }
    ctx.save();
    ctx.shadowColor = pal.tema === "escuro" ? "rgba(0,0,0,0.45)" : `rgba(${pal.sombra},0.28)`;
    ctx.shadowBlur = grande ? 18 : 6;
    ctx.shadowOffsetX = grande ? -4 : 0;
    ctx.shadowOffsetY = grande ? 8 : 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logo, cx - t / 2, cy - t / 2, t, t);
    ctx.restore();
  }

  // escudo sem fundo nenhum; se ele some contra a carta, ganha só um contorno
  // fino e nítido (cópias deslocadas do próprio escudo numa cor de contraste)
  function desenharEscudoLivre(ctx, logo, cx, cy, t, pal, corFundo) {
    const x = cx - t / 2;
    const y = cy - t / 2;
    if (visibilidade(logo, corFundo) < 0.3) {
      const claroAtras = luminancia(corFundo) < 0.2 && luzDaImagem(logo) < luminancia(corFundo) + 0.02;
      const cor = claroAtras ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";
      const lado = 128;
      const silhueta = tingir(logo, cor, lado);
      ctx.save();
      const d = 1.6;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ctx.drawImage(silhueta, x + Math.cos(a) * d, y + Math.sin(a) * d, t, t);
      }
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = pal.tema === "escuro" ? "rgba(0,0,0,0.45)" : `rgba(${pal.sombra},0.3)`;
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logo, x, y, t, t);
    ctx.restore();
  }

  function corDoFundoEm(pal, x, y) {
    // posição ao longo do degradê diagonal (mesma direção de camadaFundo)
    const ax = 40, ay = 0, bx = 460, by = H;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    return t <= 0.42 ? misturar(pal.topo, pal.meio, t / 0.42) : misturar(pal.meio, pal.fundo, (t - 0.42) / 0.58);
  }

  function camadaSemFoto(ctx, logo, pal) {
    // sem foto: o escudo do time ocupa o lugar do retrato, em tamanho contido
    if (!logo) return;
    desenharLogo(ctx, logo, 300, 276, 200, pal, corDoFundoEm(pal, 300, 276), true);
  }

  // faixa atrás do nome e das estatísticas: o fim da foto some dentro dela e o
  // nome fica na frente; topo suave (sem linha), para não virar um bloco chapado
  function camadaPainel(ctx, pal) {
    const cor = pal.faixa || pal.fundo;
    const forca = pal.faixaForca != null ? pal.faixaForca : 0.9;
    const g = ctx.createLinearGradient(0, 438, 0, H);
    g.addColorStop(0, rgba(cor, 0));
    g.addColorStop(0.17, rgba(cor, forca * 0.82));
    g.addColorStop(0.3, rgba(cor, forca));
    g.addColorStop(1, rgba(cor, Math.min(1, forca + 0.04)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 438, W, H - 438);
    // duas facetas bem leves por cima da faixa, para ela não ficar lisa
    ctx.save();
    ctx.fillStyle = `rgba(${pal.luz},${pal.tema === "escuro" ? 0.035 : 0.12})`;
    ctx.beginPath();
    ctx.moveTo(0, 560);
    ctx.lineTo(260, 800);
    ctx.lineTo(0, 800);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(${pal.sombra},${pal.tema === "escuro" ? 0.12 : 0.05})`;
    ctx.beginPath();
    ctx.moveTo(W, 520);
    ctx.lineTo(W, 800);
    ctx.lineTo(300, 800);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function camadaGrao(ctx, pal) {
    ctx.save();
    ctx.globalAlpha = pal.tema === "escuro" ? 0.07 : 0.05;
    ctx.globalCompositeOperation = "overlay";
    const t = grao();
    const lado = 220;
    for (let y = 0; y < H; y += lado) for (let x = 0; x < W; x += lado) ctx.drawImage(t, x, y, lado, lado);
    ctx.restore();
  }

  function sombraTexto(pal) {
    // sombra curta e nítida (sem borrão), só nas cartas escuras
    return pal.tema === "escuro" ? { cor: "rgba(0,0,0,0.38)", blur: 0, y: 2 } : null;
  }

  function camadaColunaEsquerda(ctx, carta, imagens, pal, o) {
    const cx = 92;
    const ov = String(carta.overall ?? "");
    const sombra = sombraTexto(pal);
    // a função não é escrita aqui: o ícone dela fica no pé da carta
    texto(ctx, ov, cx, 186, { tamanho: 92, peso: 700, cor: pal.texto, alinhar: "center", fonte: o.fonte, sombra });

    linha(ctx, cx - 28, 206, cx + 28, 206, pal.linha, 1.5);
    let y = 216;
    if (imagens.logo) {
      const t = 90;
      desenharEscudoLivre(ctx, imagens.logo, cx, y + t / 2, t, pal, corDoFundoEm(pal, cx, y + t / 2));
      y += t + 10;
      linha(ctx, cx - 28, y, cx + 28, y, pal.linha, 1.5);
      y += 12;
    }

    if (o.mostrarAgente && imagens.agente) {
      const r = 30;
      const cy = y + r + 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = pal.tema === "escuro" ? rgba(pal.fundo, 0.6) : `rgba(${pal.sombra},0.16)`;
      ctx.fill();
      ctx.clip();
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(imagens.agente, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = pal.rotulo;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.restore();
      texto(ctx, "+PICK", cx, cy + r + 18, { tamanho: 15, peso: 500, cor: pal.rotulo, alinhar: "center", fonte: o.fonte, espaco: 1 });
    }
  }

  function camadaNick(ctx, nick, pal, o) {
    const s = o.maiusculas ? String(nick || "").toUpperCase() : String(nick || "");
    const tamanho = ajustarTamanho(ctx, s, { max: 66, min: 34, larguraMax: 410, peso: 700, fonte: o.fonte, espaco: 0.6 });
    texto(ctx, s, 250, 534, { tamanho, peso: 700, cor: pal.texto, alinhar: "center", fonte: o.fonte, sombra: sombraTexto(pal), espaco: 0.6 });
    linha(ctx, 86, 552, 414, 552, pal.linha, 1.5);
  }

  function camadaStats(ctx, stats, pal, o) {
    const esq = stats.slice(0, 3);
    const dir = stats.slice(3, 6);
    const tv = 33;
    const tr = 29;
    const ys = [596, 639, 682];
    const fonte = o.fonte;
    const sombra = sombraTexto(pal);
    const largValor = (lado) => Math.max(0, ...lado.map((s) => larguraTexto(ctx, s.valor, tv, 600, fonte)));
    const largRotulo = (lado) => Math.max(0, ...lado.map((s) => larguraTexto(ctx, s.rotulo, tr, 400, fonte)));
    const gap = 9;
    // cada coluna fica centrada na sua metade (valor alinhado à direita, rótulo à esquerda)
    const coluna = (lado, centro) => {
      const lv = largValor(lado);
      const lr = largRotulo(lado);
      const total = lv + gap + lr;
      const xValor = centro - total / 2 + lv;
      lado.forEach((s, i) => {
        texto(ctx, s.valor, xValor, ys[i], { tamanho: tv, peso: 600, cor: pal.texto, alinhar: "right", fonte, sombra });
        texto(ctx, s.rotulo, xValor + gap, ys[i], { tamanho: tr, peso: 400, cor: pal.rotulo, alinhar: "left", fonte });
      });
    };
    coluna(esq, 166);
    coluna(dir, 334);
    linha(ctx, 250, 568, 250, 692, pal.linha, 1.5);
  }

  function camadaFuncao(ctx, funcao, imgFuncao, pal) {
    const t = 38;
    const cy = 718;
    const flex = String(funcao || "").toLowerCase() === "flex" || !imgFuncao;
    const base = flex ? iconeFlex() : imgFuncao;
    const icone = tingir(base, pal.rotulo, 128);
    linha(ctx, 202, cy, 226, cy, pal.linha, 1.5);
    linha(ctx, 274, cy, 298, cy, pal.linha, 1.5);
    ctx.save();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(icone, 250 - t / 2, cy - t / 2, t, t);
    ctx.restore();
  }

  // "21 PARTIDAS", bem pequeno, na ponta da carta
  function camadaPartidas(ctx, partidas, pal, o) {
    const n = Number(partidas);
    if (!Number.isFinite(n) || n <= 0) return;
    const s = `${Math.round(n)} ${Math.round(n) === 1 ? "PARTIDA" : "PARTIDAS"}`;
    ctx.save();
    ctx.globalAlpha = 0.85;
    texto(ctx, s, 250, 757, { tamanho: 12, peso: 500, cor: pal.rotulo, alinhar: "center", fonte: o.fonte, espaco: 0.5 });
    ctx.restore();
  }

  function camadaEvento(ctx, img) {
    if (!img) return;
    const t = 44;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 6;
    ctx.drawImage(img, 446 - t, 66, t, t);
    ctx.restore();
  }

  function camadaMoldura(ctx, pal) {
    const fora = escudo(0);
    const dentro = escudo(13);
    const g = ctx.createLinearGradient(0, 0, W, H);
    const m = pal.moldura;
    g.addColorStop(0, m[0]);
    g.addColorStop(0.28, m[1]);
    g.addColorStop(0.5, m[2]);
    g.addColorStop(0.76, m[3]);
    g.addColorStop(1, m[4]);
    ctx.save();
    ctx.clip(fora);
    ctx.strokeStyle = g;
    ctx.lineWidth = 13; // metade fica dentro do recorte
    ctx.lineJoin = "miter";
    ctx.stroke(fora);
    // fio escuro logo depois do metal, dá profundidade
    const fio = escudo(6.5);
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.2;
    ctx.stroke(fio);
    ctx.restore();
    // filete interno
    ctx.save();
    ctx.strokeStyle = g;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.6;
    ctx.stroke(dentro);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* API                                                                  */
  /* ------------------------------------------------------------------ */

  function desenhar(ctx, carta, imagens, opcoes) {
    const o = Object.assign({}, PADRAO, opcoes || {});
    const escala = o.escala;
    const time = carta.time || {};
    const pal = paleta(time.cores || [], time.paleta);
    const forma = escudo(0);
    imagens = imagens || {};

    ctx.save();
    ctx.scale(escala, escala);
    ctx.save();
    ctx.clip(forma);

    camadaFundo(ctx, pal);
    camadaFacetas(ctx, pal, time.nome || time.nomeFundo || "");
    camadaFeixes(ctx, pal);
    camadaReticula(ctx, pal);
    if (o.mostrarNomeFundo) camadaNomeFundo(ctx, time.nomeFundo || time.nome || "", pal, o);
    // borda da coluna da esquerda (overall, escudo, agente): a foto ou a
    // silhueta é enquadrada para ficar longe dela
    const cfgFoto = Object.assign({}, PADRAO.foto, o.foto || {});
    const comFigura = imagens.foto || o.semFoto !== "escudo";
    const coluna = comFigura ? perfilColuna(carta, imagens, pal, cfgFoto, o) : null;
    if (imagens.foto) camadaFoto(ctx, imagens.foto, pal, carta, escala, o, coluna);
    else if (o.semFoto === "escudo") camadaSemFoto(ctx, imagens.logo, pal);
    else camadaSilhueta(ctx, imagens.silhueta, pal, escala, o, coluna);
    camadaPainel(ctx, pal);
    camadaGrao(ctx, pal);
    camadaColunaEsquerda(ctx, carta, imagens, pal, o);
    camadaNick(ctx, carta.nick, pal, o);
    camadaStats(ctx, carta.stats || [], pal, o);
    camadaFuncao(ctx, carta.funcao, imagens.funcao, pal);
    camadaPartidas(ctx, carta.partidas, pal, o);
    if (o.mostrarEvento) camadaEvento(ctx, imagens.evento);

    ctx.restore();
    camadaMoldura(ctx, pal);
    ctx.restore();
    return pal;
  }

  function renderizar(carta, imagens, opcoes) {
    const o = Object.assign({}, PADRAO, opcoes || {});
    const tela = document.createElement("canvas");
    tela.width = Math.round(W * o.escala);
    tela.height = Math.round(H * o.escala);
    desenhar(tela.getContext("2d"), carta, imagens, o);
    return tela;
  }

  /* Fundo dos posts: sempre escuro (as cartas claras e douradas precisam
   * aparecer), com o mesmo degradê, facetas, feixes, retícula e granulação. */
  function paletaPost(cores) {
    const pal = paleta(cores);
    if (pal.tema === "escuro") {
      return Object.assign({}, pal, { topo: pal.meio, meio: misturar(pal.meio, pal.fundo, 0.55), fundo: escurecer(pal.fundo, 0.45), luzAcento: 0.28 });
    }
    const lista = (cores || []).filter(Boolean);
    const escura = lista.find((c) => luminancia(c) < 0.08);
    const base = escura ? realcar(escura, 0.025) : "#1b1c21";
    const destaque = pal.tema === "ouro" || pal.tema === "claro" ? (lista.find((c) => hsl(c).s > 0.35 && luminancia(c) > 0.15) || "#c9a24a") : lista[1] || "#9aa0a8";
    return Object.assign({}, pal, {
      tema: "escuro",
      topo: misturar(base, "#ffffff", 0.08),
      meio: base,
      fundo: escurecer(base, 0.6),
      acento: destaque,
      luz: "255,255,255",
      sombra: "0,0,0",
      facetaClara: 0.05,
      facetaEscura: 0.14,
      feixe: 0.16,
      luzAcento: 0.22,
    });
  }

  function fundo(ctx, cores, largura, altura, chave) {
    const pal = paletaPost(cores);
    ctx.save();
    ctx.scale(largura / W, altura / H);
    camadaFundo(ctx, pal);
    camadaFacetas(ctx, pal, chave || "");
    camadaFeixes(ctx, pal);
    ctx.restore();
    camadaReticula(ctx, pal, [[largura - 40, 40, 420], [40, altura - 60, 360]], 18, 4.6);
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.globalCompositeOperation = "overlay";
    const t = grao();
    for (let y = 0; y < altura; y += 220) for (let x = 0; x < largura; x += 220) ctx.drawImage(t, x, y, 220, 220);
    ctx.restore();
    return pal;
  }

  async function carregarFontes(lista) {
    if (!document.fonts || !document.fonts.load) return;
    const amostra = "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ ÁÉÍÓÚÂÊÔÃÕÇ +-.%";
    const padrao = [400, 500, 600, 700].map((p) => `${p} 40px "Oswald"`);
    const pedidos = (lista || padrao).map((f) => document.fonts.load(f, amostra));
    await Promise.all(pedidos);
  }

  /* Enquadramento da foto desta carta. Devolve a base (revisada, se houver
   * uma para esta foto, ou a automática), o final (com o ajuste da carta por
   * cima), a folga até a coluna da esquerda (unidades; negativa = encosta) e
   * a assinatura da foto. null se não há foto recortada. */
  function enquadramentoFoto(carta, imagens, opcoes) {
    const o = Object.assign({}, PADRAO, opcoes || {});
    const img = imagens && imagens.foto;
    const perfil = img && perfilDaFoto(img);
    if (!perfil) return null;
    const cfg = Object.assign({}, PADRAO.foto, o.foto || {});
    const time = (carta && carta.time) || {};
    const pal = paleta(time.cores || [], time.paleta);
    const coluna = perfilColuna(carta, imagens, pal, cfg, o);
    const proporcao = larguraImagem(img) / alturaImagem(img);
    const base = enquadramentoBase(carta, img, perfil, coluna, cfg);
    const comCorte = cfg.cortar !== false;
    const auto = enquadrar(perfil, coluna, cfg, proporcao, comCorte);
    const aj = (carta && carta.ajusteFoto) || {};
    const zoom = base.zoom * (Number(aj.zoom) || 1);
    const x = base.x + (Number(aj.x) || 0);
    const y = base.y + (Number(aj.y) || 0);
    const r = coluna ? invasaoDaColuna(perfil, coluna, cfg, proporcao, zoom, y, x) : { invasao: -Infinity };
    const rc = coluna && comCorte && base.cortar !== false ? corteDaColuna(perfil, coluna, cfg, proporcao, zoom, y, x) : { corte: 0, cabeca: 0 };
    const corte = rc.corte;
    const arred = (v, k) => Math.round(v * k) / k;
    return {
      origem: base.origem,
      base: { zoom: arred(base.zoom, 1000), x: base.x, y: base.y },
      automatico: { zoom: arred(auto.zoom, 100), y: auto.y },
      zoom: arred(zoom, 1000),
      x,
      y,
      // folga: distância da figura (antes do corte) até a coluna; corte: área escondida pelo corte lateral
      folga: Number.isFinite(r.invasao) ? arred(cfg.folga - r.invasao, 10) : null,
      corte: Math.round(corte),
      cabecaCortada: Math.round(rc.cabeca),
      cortar: base.cortar !== false && comCorte,
      assinatura: assinaturaFoto(img, perfil),
      centro: { cabeca: arred(perfil.cabecaX, 10000), ombros: arred(perfil.ombrosX, 10000), usado: arred(centroDaFoto(perfil, cfg), 10000) },
    };
  }

  global.Cartinha = {
    LARGURA: W,
    ALTURA: H,
    PADRAO,
    paleta,
    desenhar,
    renderizar,
    enquadramentoFoto,
    carregarFontes,
    escudo,
    fundo,
    paletaPost,
    cores: { misturar, escurecer, clarear, luminancia, contraste, rgba, comLuminancia, realcar },
  };
})(typeof window !== "undefined" ? window : globalThis);
