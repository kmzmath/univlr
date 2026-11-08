/* Aparencia do UNIVLR: tema (escuro ou claro) e fundo (animado ou solido).

   Carrega no <head>, sem defer, depois das folhas: o atributo precisa estar no
   <html> antes da primeira pintura, senao quem escolheu o claro ve o site
   piscar em preto a cada carga. O botao so e montado quando o <body> existe.

   O estado mora em dois atributos do <html>, data-tema e data-fundo, e o CSS
   faz o resto (bloco "Tema claro" e "Fundo solido" no fim do placar.css). A
   escolha fica no navegador da pessoa. Sem localStorage (aba anonima, site
   bloqueado), vale o padrao: escuro e animado, a identidade do site.

   O botao fica fora do #app, como o .vp-fundo, porque o Shell recria a pagina
   inteira a cada rota e levaria o painel aberto junto. */
(function () {
  "use strict";

  const GRUPOS = {
    tema: {
      chave: "univlr-tema",
      padrao: "escuro",
      rotulo: "Tema",
      opcoes: [
        ["escuro", "Escuro"],
        ["claro", "Claro"],
      ],
    },
    fundo: {
      chave: "univlr-fundo",
      padrao: "animado",
      rotulo: "Fundo",
      opcoes: [
        ["animado", "Animado"],
        ["solido", "Sólido"],
      ],
    },
  };

  // Cor da barra do navegador no celular, acompanhando o --bg de cada tema.
  const COR_DA_BARRA = { escuro: "#040306", claro: "#f5f1f2" };

  const raiz = document.documentElement;

  function ler(chave) {
    try {
      return localStorage.getItem(chave);
    } catch (erro) {
      return null;
    }
  }

  function gravar(chave, valor) {
    try {
      localStorage.setItem(chave, valor);
    } catch (erro) {
      // sem armazenamento a escolha vale so ate fechar a pagina
    }
  }

  function valido(grupo, valor) {
    return GRUPOS[grupo].opcoes.some(([v]) => v === valor);
  }

  function aplicar(grupo, valor) {
    raiz.dataset[grupo] = valor;
    if (grupo === "tema") {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", COR_DA_BARRA[valor]);
    }
  }

  for (const grupo of Object.keys(GRUPOS)) {
    const salvo = ler(GRUPOS[grupo].chave);
    aplicar(grupo, valido(grupo, salvo) ? salvo : GRUPOS[grupo].padrao);
  }

  // Engrenagem desenhada no proprio arquivo: o site nao tem biblioteca de
  // icones e uma imagem a mais seria um pedido a mais em toda pagina.
  const ICONE =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>' +
    '<circle cx="12" cy="12" r="3"/>' +
    "</svg>";

  function montar() {
    if (document.querySelector(".vp-ajustes")) return;

    const caixa = document.createElement("div");
    caixa.className = "vp-ajustes";

    const grupos = Object.entries(GRUPOS)
      .map(([grupo, def]) => {
        const opcoes = def.opcoes
          .map(
            ([valor, texto]) =>
              `<label class="vp-ajustes-opcao"><input type="radio" name="vp-ajustes-${grupo}" value="${valor}"${
                raiz.dataset[grupo] === valor ? " checked" : ""
              } /><span>${texto}</span></label>`
          )
          .join("");
        return `<fieldset class="vp-ajustes-grupo" data-grupo="${grupo}"><legend>${def.rotulo}</legend><div class="vp-ajustes-opcoes">${opcoes}</div></fieldset>`;
      })
      .join("");

    caixa.innerHTML =
      `<div class="vp-ajustes-painel" id="vp-ajustes-painel" role="dialog" aria-label="Aparência" hidden>${grupos}</div>` +
      `<button class="vp-ajustes-botao" type="button" aria-label="Aparência" title="Aparência" aria-expanded="false" aria-controls="vp-ajustes-painel">${ICONE}</button>`;

    document.body.appendChild(caixa);

    const botao = caixa.querySelector(".vp-ajustes-botao");
    const painel = caixa.querySelector(".vp-ajustes-painel");

    function abrir() {
      painel.hidden = false;
      botao.setAttribute("aria-expanded", "true");
      // Foco na opcao marcada do primeiro grupo: setas trocam, Tab vai ao fundo.
      const marcada = painel.querySelector("input:checked");
      if (marcada) marcada.focus({ preventScroll: true });
    }

    function fechar(devolverFoco) {
      if (painel.hidden) return;
      painel.hidden = true;
      botao.setAttribute("aria-expanded", "false");
      if (devolverFoco) botao.focus({ preventScroll: true });
    }

    botao.addEventListener("click", () => {
      if (painel.hidden) abrir();
      else fechar(false);
    });

    painel.addEventListener("change", (evento) => {
      const campo = evento.target;
      const grupo = campo.closest("[data-grupo]")?.dataset.grupo;
      if (!grupo || !valido(grupo, campo.value)) return;
      aplicar(grupo, campo.value);
      gravar(GRUPOS[grupo].chave, campo.value);
    });

    document.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape" && !painel.hidden) fechar(caixa.contains(document.activeElement));
    });

    // Clique fora fecha. pointerdown, e nao click, para fechar antes de o
    // clique chegar a um link da pagina que troca de rota.
    document.addEventListener("pointerdown", (evento) => {
      if (!painel.hidden && !caixa.contains(evento.target)) fechar(false);
    });

    // Foco que sai da caixa pelo teclado tambem fecha.
    caixa.addEventListener("focusout", (evento) => {
      if (evento.relatedTarget && !caixa.contains(evento.relatedTarget)) fechar(false);
    });

    // Outra aba trocou o tema: acompanha, para as duas nao ficarem diferentes.
    window.addEventListener("storage", (evento) => {
      for (const [grupo, def] of Object.entries(GRUPOS)) {
        if (evento.key !== def.chave) continue;
        const valor = valido(grupo, evento.newValue) ? evento.newValue : def.padrao;
        aplicar(grupo, valor);
        const campo = painel.querySelector(`input[name="vp-ajustes-${grupo}"][value="${valor}"]`);
        if (campo) campo.checked = true;
      }
    });
  }

  if (document.body) montar();
  else document.addEventListener("DOMContentLoaded", montar);
})();
