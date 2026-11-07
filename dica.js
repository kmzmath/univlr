/* Balao de dica do UNIVLR.

   Substitui o balao nativo do navegador em todo `title` do site, inclusive nos
   que o app.js monta depois: um ouvinte so, no documento, e nenhum elemento
   precisa ser registrado. Le tambem `data-tooltip` (os blocos da nota do
   ranking, que tinham um balao proprio em CSS).

   Como o nativo some: na primeira passada do ponteiro (ou no foco), o texto sai
   do `title` e vai para `data-dica`. O `title` e removido antes do navegador
   chegar a mostrar o dele. Para leitor de tela o texto continua no elemento,
   em `aria-description`, quando ele ainda nao esta no nome acessivel.

   Nome que ja aparece inteiro nao ganha balao: repetir o que esta visivel e
   ruido. So mostra quando o texto do balao e diferente do texto do elemento,
   ou quando o elemento (ou um filho) esta cortado.

   Visual em placar.css (.vp-dica): recorte claro, chapado, com o canto cortado
   na diagonal das fatias de mapa. Toque nao tem passada de ponteiro, entao no
   celular nada muda. */
(function () {
  "use strict";

  const ATRASO_MS = 300; // primeira dica
  const EMENDA_MS = 500; // passando de um item ao vizinho, aparece na hora
  const VAO = 8; // entre o item e o balao
  const MARGEM = 16; // distancia minima da borda da tela

  let balao = null;
  let corpo = null;
  let alvo = null;
  let timer = 0;
  let escondidoEm = 0;
  let pontoX = null;

  function garantirBalao() {
    if (balao) return;
    balao = document.createElement("div");
    balao.className = "vp-dica";
    balao.id = "vp-dica";
    balao.setAttribute("role", "tooltip");
    balao.setAttribute("aria-hidden", "true");
    corpo = document.createElement("span");
    corpo.className = "vp-dica-corpo";
    balao.appendChild(corpo);
    document.body.appendChild(balao);
  }

  const limpar = (texto) => String(texto || "").replace(/\s+/g, " ").trim();

  // Move `title` e `data-tooltip` para `data-dica`. Roda a cada passada porque
  // o app.js pode regravar o `title` (o botao de ordenacao do placar faz isso).
  function adotar(el) {
    const titulo = el.getAttribute("title");
    if (titulo !== null) {
      el.removeAttribute("title");
      if (limpar(titulo)) {
        el.setAttribute("data-dica", titulo);
        const nome = limpar(el.getAttribute("aria-label") || el.textContent);
        if (!el.hasAttribute("aria-labelledby") && nome !== limpar(titulo)) el.setAttribute("aria-description", titulo);
      }
    }
    const tooltip = el.getAttribute("data-tooltip");
    if (tooltip !== null && !el.hasAttribute("data-dica")) el.setAttribute("data-dica", tooltip);
    return el.getAttribute("data-dica");
  }

  function donoDaDica(no) {
    const el = no && no.nodeType === 1 ? no : no && no.parentElement;
    return el ? el.closest("[title], [data-dica], [data-tooltip]") : null;
  }

  function cortado(el) {
    const caixas = [el, ...el.querySelectorAll("*")].slice(0, 8);
    return caixas.some((caixa) => caixa.scrollWidth > caixa.clientWidth + 1 && caixa.clientWidth > 0);
  }

  function valeMostrar(el, texto) {
    if (!limpar(texto)) return false;
    if (limpar(texto) !== limpar(el.textContent)) return true;
    return cortado(el);
  }

  function posicionar() {
    if (!alvo || !balao) return;
    const caixa = alvo.getBoundingClientRect();
    const largura = balao.offsetWidth;
    const altura = balao.offsetHeight;
    const centro = pontoX ?? caixa.left + caixa.width / 2;
    const maxX = window.innerWidth - MARGEM - largura;
    const x = Math.max(MARGEM, Math.min(maxX, centro - largura / 2));
    let y = caixa.top - altura - VAO;
    let lado = "acima";
    if (y < MARGEM) {
      y = caixa.bottom + VAO;
      lado = "abaixo";
    }
    balao.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    balao.dataset.lado = lado;
  }

  function mostrar(el, x) {
    const texto = adotar(el);
    if (!valeMostrar(el, texto)) return;
    garantirBalao();
    clearTimeout(timer);
    const abrir = () => {
      if (!el.isConnected) return;
      alvo = el;
      pontoX = x;
      corpo.textContent = texto;
      balao.classList.remove("visivel");
      balao.style.visibility = "hidden";
      balao.style.display = "block";
      posicionar();
      balao.style.visibility = "";
      // Um quadro depois, para a entrada animar a partir do estado de repouso.
      void balao.offsetWidth;
      balao.classList.add("visivel");
      el.setAttribute("aria-describedby", "vp-dica");
    };
    if (Date.now() - escondidoEm < EMENDA_MS || (alvo && balao.classList.contains("visivel"))) abrir();
    else timer = setTimeout(abrir, ATRASO_MS);
  }

  function esconder() {
    clearTimeout(timer);
    if (!alvo) return;
    if (alvo.getAttribute("aria-describedby") === "vp-dica") alvo.removeAttribute("aria-describedby");
    alvo = null;
    pontoX = null;
    if (balao) {
      balao.classList.remove("visivel");
      balao.style.display = "none";
    }
    escondidoEm = Date.now();
  }

  document.addEventListener("pointerover", (evento) => {
    if (evento.pointerType === "touch") return;
    const el = donoDaDica(evento.target);
    if (el === alvo) return;
    if (!el) {
      esconder();
      return;
    }
    if (alvo) esconder();
    else clearTimeout(timer);
    mostrar(el, evento.clientX);
  });

  document.addEventListener("pointerout", (evento) => {
    const de = donoDaDica(evento.target);
    if (!de) return;
    const para = evento.relatedTarget;
    if (para && de.contains(para)) return;
    if (de === alvo) esconder();
    else clearTimeout(timer);
  });

  document.addEventListener("focusin", (evento) => {
    const el = donoDaDica(evento.target);
    if (!el) return;
    // So o foco de teclado: o clique tambem foca, e ai o balao ficaria preso.
    let teclado = false;
    try {
      teclado = evento.target.matches(":focus-visible");
    } catch (erro) {
      teclado = false;
    }
    adotar(el);
    if (teclado) mostrar(el, null);
  });

  document.addEventListener("focusout", () => esconder());
  document.addEventListener("pointerdown", () => esconder(), true);
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") esconder();
  });
  // So a rolagem que move o item: a home tem trilhos e nomes que rolam sozinhos,
  // e esconder em qualquer rolagem fechava o balao logo depois de abrir.
  window.addEventListener(
    "scroll",
    (evento) => {
      if (!alvo) return;
      const rolou = evento.target;
      if (rolou === document || rolou === document.documentElement || rolou === document.body || (rolou.contains && rolou.contains(alvo))) esconder();
    },
    true,
  );
  window.addEventListener("resize", () => esconder());
  window.addEventListener("hashchange", () => esconder());
})();
