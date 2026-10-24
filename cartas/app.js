// Pagina de revelacao das cartinhas. O manifest.json traz o calendario inteiro
// (data e quantidade de cada dia) e o perfil completo so dos dias ja revelados;
// nada do que ainda esta em segredo chega ao navegador.
const dias = document.getElementById("dias");
const regra = document.getElementById("regra");
const contagem = document.getElementById("contagem");
const calendario = document.getElementById("calendario");
const busca = document.getElementById("busca-jogador");
const buscaResultados = document.getElementById("busca-resultados");
const conversa = document.getElementById("comentarios");
const conversaTotal = document.getElementById("conversa-total");
let manifest;
let cartas = [];

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// Numero no formato brasileiro; sem valor, um hifen.
function num(value, digits = 0) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pos(rank) {
  return `#${String(rank).padStart(3, "0")}`;
}

// Com sinal na frente quando positivo; perto de zero, zero sem sinal.
function comSinal(value, digits = 2) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "-";
  const n = Number(value);
  if (Math.abs(n) < 0.5 / 10 ** digits) return num(0, digits);
  return `${n > 0 ? "+" : ""}${num(n, digits)}`;
}

function partes(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return { ano, mes, dia };
}

function dataLonga(iso) {
  const { mes, dia } = partes(iso);
  return `${dia} de ${MESES[mes - 1]}`;
}

function dataCurta(iso) {
  const { mes, dia } = partes(iso);
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

function dataDoJogo(value) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value));
}

// Um dia so conta como revelado depois das 21:30 dele. O push da edicao sai
// um pouco antes da hora: ate la as cartinhas ja estao no manifesto, mas ficam
// fora da pagina, e entram quando o relogio zera.
function liberado(day, agora = Date.now()) {
  return Boolean(day.cards?.length) && agora >= horaDaRevelacao(day.date);
}

// A posicao na colecao e o contrario da ordem de revelacao: o calendario vai
// do menor para o maior overall, entao o primeiro dia revela a #216 e o ultimo
// termina na #1, a melhor de todas. Cada dia comeca onde o anterior parou.
function diasComFaixa() {
  let inicio = manifest.total;
  return manifest.days.map((day) => {
    const faixa = { ...day, primeira: inicio, ultima: inicio - day.count + 1, revelado: liberado(day) };
    inicio -= day.count;
    return faixa;
  });
}

// O texto do topo sai do manifesto, para o total e a ultima data nao ficarem
// velhos se o calendario mudar. O HTML traz o mesmo texto para quem chega
// antes do manifesto.
function renderRegra() {
  const ultimo = manifest.days[manifest.days.length - 1];
  regra.textContent = `É revelado um lote de cartinhas por dia, em ordem do menor para o maior overall. No total são ${num(manifest.total)} cartinhas, de jogadores com pelo menos 200 rounds e 12 mapas jogados no ano. Última revelação em ${dataLonga(ultimo.date)}.`;
}

// ---------------------------------------------------------------- contagem

// A revelacao e as 21:30 de Brasilia, que e UTC-3 o ano todo (o horario de
// verao acabou em 2019): 00:30 UTC do dia seguinte. Date.UTC aceita a hora 24
// e vira o dia sozinho.
function horaDaRevelacao(iso) {
  const { ano, mes, dia } = partes(iso);
  return Date.UTC(ano, mes - 1, dia, 24, 30);
}

function renderContagem(faixas) {
  const reveladas = cartas.length;
  const proximo = faixas.find((day) => !day.revelado);
  const fracao = manifest.total ? (reveladas / manifest.total) * 100 : 0;
  contagem.innerHTML = `
    <p class="contagem-numero"><b>${num(reveladas)}</b><span>de ${num(manifest.total)} reveladas</span></p>
    <span class="contagem-barra" aria-hidden="true"><i style="--p:${fracao.toFixed(2)}%"></i></span>
    ${
      proximo
        ? `<p class="contagem-timer">Próxima revelação <b id="relogio" data-alvo="${horaDaRevelacao(proximo.date)}"></b></p>
           <p class="contagem-proxima">${esc(dataLonga(proximo.date))}, às 21:30 de Brasília, ${proximo.count} ${proximo.count === 1 ? "cartinha" : "cartinhas"} (${pos(proximo.primeira)} a ${pos(proximo.ultima)})</p>`
        : `<p class="contagem-proxima">Todas as cartinhas foram reveladas.</p>`
    }
  `;
  pulsaRelogio();
}

// O relogio conta ate as 21:30 do proximo dia. Se a edicao ja chegou com o
// push, a pagina so se refaz quando ele zera. Se ainda nao chegou (o deploy
// leva uns dois minutos), busca o manifesto de novo a cada 30s por ate 20
// minutos e se refaz quando ele vier.
const BUSCA_INTERVALO = 30 * 1000;
const BUSCA_JANELA = 20 * 60 * 1000;
let relogio = null;
let ultimaBusca = 0;

function buscaManifesto() {
  return fetch(`manifest.json?v=${Date.now()}`, { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
}

function tempoQueFalta(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h ? `${h}h ` : ""}${h || m ? `${String(m).padStart(h ? 2 : 1, "0")}min ` : ""}${String(s).padStart(h || m ? 2 : 1, "0")}s`;
}

function pulsaRelogio() {
  clearInterval(relogio);
  const alvo = document.getElementById("relogio");
  if (!alvo) return;
  const quando = Number(alvo.dataset.alvo);
  const bate = () => {
    const agora = Date.now();
    const falta = quando - agora;
    if (falta > 0) {
      alvo.textContent = `em ${tempoQueFalta(falta)}`;
      return;
    }
    if (manifest.days.some((day) => liberado(day, agora) && horaDaRevelacao(day.date) === quando)) {
      aplicar(manifest);
      return;
    }
    const esperando = agora - quando < BUSCA_JANELA;
    alvo.textContent = esperando ? "chegando, a página atualiza sozinha" : "em breve";
    if (esperando && agora - ultimaBusca >= BUSCA_INTERVALO) {
      ultimaBusca = agora;
      buscaManifesto()
        .then((data) => {
          if (data.publishedThrough !== manifest.publishedThrough) aplicar(data);
        })
        .catch(() => {});
    }
  };
  bate();
  relogio = setInterval(bate, 1000);
}

// ---------------------------------------------------------------- lista

function agentesMini(card) {
  return (card.agents || [])
    .slice(0, 3)
    .map((agent) => (agent.icon ? `<img src="${esc(agent.icon)}" alt="${esc(agent.name)}" title="${esc(`${agent.name}, ${num(agent.share * 100)}% dos mapas`)}" loading="lazy" />` : ""))
    .join("");
}

function numero(rotulo, valor, dica = "") {
  return `<span class="numero"${dica ? ` title="${esc(dica)}"` : ""}><small>${esc(rotulo)}</small><b>${esc(valor)}</b></span>`;
}

function jogosRecentes(card) {
  const jogos = (card.recentMatches || []).slice(0, 3);
  if (!jogos.length) return `<p class="aviso">Sem jogos registrados.</p>`;
  return jogos
    .map((jogo) => {
      const venceu = jogo.result === "V";
      return `
        <a class="jogo${venceu ? " venceu" : ""}" href="${esc(jogo.href)}">
          <time>${esc(dataDoJogo(jogo.date))}</time>
          <span class="jogo-contra">${jogo.opponentLogo ? `<img src="${esc(jogo.opponentLogo)}" alt="" loading="lazy" />` : ""}<span><strong>${esc(jogo.opponent)}</strong><small>${esc(jogo.event)}, ${esc(jogo.map)}</small></span></span>
          <span class="jogo-placar"><b>${esc(jogo.result)} ${esc(jogo.score)}</b><small>${num(jogo.kills)}/${num(jogo.deaths)}/${num(jogo.assists)}, ${num(jogo.rating, 2)} rAAting</small></span>
        </a>`;
    })
    .join("");
}

function perfil(card) {
  const stat = card.stats || {};
  const agentes = (card.agents || [])
    .map((agent) => `<span class="agente">${agent.icon ? `<img src="${esc(agent.icon)}" alt="" loading="lazy" />` : ""}<strong>${esc(agent.name)}</strong><small>${num(agent.share * 100)}%</small></span>`)
    .join("");
  return `
    <div class="perfil-dentro">
      <a class="perfil-carta" href="${esc(card.image)}" target="_blank" rel="noopener" aria-label="Abrir a cartinha de ${esc(card.name)} em tamanho original"><img src="${esc(card.image)}" alt="Cartinha de ${esc(card.name)}" loading="lazy" /></a>
      <div class="perfil-dados">
        <p class="amostra">${num(stat.maps)} mapas, ${num(stat.rounds)} rounds, ${num(stat.kills)}/${num(stat.deaths)}/${num(stat.assists)} K/D/A</p>
        <div class="numeros">
          ${numero("rAAting 3.0", num(stat.raating, 2))}
          ${numero("ACS", num(stat.acs))}
          ${numero("K/D", num(stat.kd, 2))}
          ${numero("KAST", `${num(stat.kast)}%`)}
          ${numero("ADR", num(stat.adr))}
          ${numero("HS", `${num(stat.hs)}%`)}
          ${numero("KPR", num(stat.kpr, 2))}
          ${numero("Força média de adversário", comSinal(card.opponentStrength), "Quanto, em rAAting, os times enfrentados costumam tirar de quem joga contra eles, pesado pelos rounds. Zero é o adversário típico; positivo, adversários mais fortes; negativo, mais fracos.")}
        </div>
        ${agentes ? `<div class="agentes"><h3>Agentes</h3><div>${agentes}</div></div>` : ""}
        <div class="jogos"><h3>Últimos jogos</h3>${jogosRecentes(card)}</div>
        <p class="links"><a href="${esc(card.profileHref)}">Perfil completo</a><a href="${esc(card.image)}" target="_blank" rel="noopener">Abrir cartinha</a></p>
        ${comunidade && card.thread ? `<section class="cmt-secao cmt-carta" data-thread="${esc(card.thread)}" aria-label="Comentários sobre a cartinha de ${esc(card.name)}"></section>` : ""}
      </div>
    </div>
  `;
}

// Uma linha por jogador, no estilo do ranking: risco e banho na cor da equipe.
// A linha inteira e um botao que abre o perfil logo abaixo dela.
function linha(card) {
  const stat = card.stats || {};
  return `
    <article class="linha" id="carta-${card.rank}" style="--team-line:${esc(card.teamColor || "#8a8d98")}">
      <button type="button" class="resumo" aria-expanded="false" aria-controls="perfil-${card.rank}">
        <span class="r-pos">${pos(card.rank)}</span>
        <img class="r-mini" src="${esc(card.image)}" alt="" loading="lazy" />
        <span class="r-quem"><strong>${esc(card.name)}</strong><small>${card.teamLogo ? `<img src="${esc(card.teamLogo)}" alt="" loading="lazy" />` : ""}<span>${esc(card.team)}${card.role ? `, ${esc(card.role)}` : ""}</span></small></span>
        <span class="r-ovr"><span class="r-cmt"${card.thread ? ` data-thread="${esc(card.thread)}"` : ""}></span><b aria-label="Overall ${esc(card.overall)}">${esc(card.overall)}</b></span>
        <span class="r-n">${num(stat.raating, 2)}</span>
        <span class="r-n">${num(stat.acs)}</span>
        <span class="r-n">${num(stat.kd, 2)}</span>
        <span class="r-n r-kast">${num(stat.kast)}%</span>
        <span class="r-agentes">${agentesMini(card)}</span>
        <span class="r-seta" aria-hidden="true"></span>
      </button>
      <div class="perfil" id="perfil-${card.rank}" inert>${perfil(card)}</div>
    </article>
  `;
}

function renderDias(faixas) {
  const revelados = faixas.filter((day) => day.revelado).reverse();
  if (!revelados.length) {
    const primeiro = faixas[0];
    dias.innerHTML = `<p class="aviso">A primeira revelação sai em ${esc(dataLonga(primeiro.date))}, com ${primeiro.count} cartinhas.</p>`;
    return;
  }
  dias.innerHTML = revelados
    .map(
      (day) => `
      <section class="dia" id="dia-${day.date}">
        <header class="sec"><h2>${esc(dataLonga(day.date))}</h2><span class="sec-aparte">${day.count} ${day.count === 1 ? "revelada" : "reveladas"}, ${pos(day.primeira)} a ${pos(day.ultima)}</span></header>
        <div class="placa">
          <div class="cab" aria-hidden="true"><span>#</span><span></span><span>Jogador</span><span>Overall</span><span>rAAting</span><span>ACS</span><span>K/D</span><span>KAST</span><span>Agentes</span><span></span></div>
          ${day.cards.slice().sort((a, b) => a.rank - b.rank).map(linha).join("")}
        </div>
      </section>`,
    )
    .join("");
}

// A conversa da cartinha so e buscada na primeira vez que ela abre.
function abrir(article, aberto = !article.classList.contains("aberta")) {
  article.classList.toggle("aberta", aberto);
  article.querySelector(".resumo").setAttribute("aria-expanded", String(aberto));
  article.querySelector(".perfil").inert = !aberto;
  const raiz = article.querySelector(".cmt-carta");
  if (aberto && raiz && !raiz.dataset.montada) montaConversa(raiz);
}

// ---------------------------------------------------------------- calendario

// Dois meses, de domingo a sabado, so com as semanas que tem revelacao. Dia
// revelado leva para a lista dele; dia futuro mostra quantas cartinhas saem e
// a faixa de posicoes; dia sem revelacao fica apagado.
function celulaDoCalendario(iso, dia, day, proximo) {
  if (!day) return `<span class="fora">${dia}</span>`;
  const rotulo = `${dataLonga(iso)}: ${day.count} ${day.count === 1 ? "cartinha" : "cartinhas"}, ${pos(day.primeira)} a ${pos(day.ultima)}${day.revelado ? ", revelada" : ""}`;
  const classe = day.revelado ? "revelado" : day === proximo ? "proximo" : "futuro";
  const miolo = `<b>${dia}</b><small>${day.count}</small>`;
  return day.revelado
    ? `<a class="${classe}" href="#dia-${iso}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}">${miolo}</a>`
    : `<span class="${classe}" title="${esc(rotulo)}" aria-label="${esc(rotulo)}">${miolo}</span>`;
}

function renderCalendario(faixas) {
  const porData = new Map(faixas.map((day) => [day.date, day]));
  const meses = [...new Set(faixas.map((day) => day.date.slice(0, 7)))];
  const proximo = faixas.find((day) => !day.revelado);
  calendario.innerHTML =
    meses
      .map((chave) => {
        const [ano, mes] = chave.split("-").map(Number);
        const primeiroDia = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
        const totalDias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
        const celulas = Array.from({ length: primeiroDia }, () => ({ html: `<span class="vazio"></span>`, conta: false }));
        for (let dia = 1; dia <= totalDias; dia++) {
          const iso = `${chave}-${String(dia).padStart(2, "0")}`;
          const day = porData.get(iso);
          celulas.push({ html: celulaDoCalendario(iso, dia, day, proximo), conta: Boolean(day) });
        }
        const semanas = [];
        for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
        const grade = semanas
          .filter((semana) => semana.some((celula) => celula.conta))
          .flatMap((semana) => semana.map((celula) => celula.html))
          .join("");
        return `
          <div class="mes">
            <h3>${MESES[mes - 1]}</h3>
            <div class="semana" aria-hidden="true"><span>dom</span><span>seg</span><span>ter</span><span>qua</span><span>qui</span><span>sex</span><span>sáb</span></div>
            <div class="grade">${grade}</div>
          </div>`;
      })
      .join("") +
    `<p class="legenda"><span class="l-revelado">revelado</span><span class="l-proximo">próximo</span><span>o número embaixo é quantas cartinhas saem no dia</span></p>`;
}

// ---------------------------------------------------------------- busca

function normalizar(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function mostrarBusca() {
  const termo = normalizar(busca.value);
  if (!termo) {
    buscaResultados.hidden = true;
    buscaResultados.innerHTML = "";
    return;
  }
  const achados = cartas.filter((card) => normalizar(card.name).includes(termo) || normalizar(card.team).includes(termo)).slice(0, 8);
  buscaResultados.innerHTML = achados.length
    ? achados.map((card) => `<a href="#carta-${card.rank}" class="busca-item"><span>${esc(card.name)}</span><small>${pos(card.rank)}, ${esc(card.team)}</small></a>`).join("")
    : `<p class="aviso">Nenhum jogador revelado com esse nome.</p>`;
  buscaResultados.hidden = false;
}

// ---------------------------------------------------------------- endereco

// #carta-12 abre o perfil e leva ate ele; #jogador-<puuid> faz o mesmo pelo
// jogador, que e o que os links de comentario usam (a posicao pode mudar se
// os overalls forem recalculados). #dia-2026-10-23 e #comentarios so levam
// ate o lugar.
function seguirEndereco() {
  const jogador = /^#jogador-([A-Za-z0-9_-]+)$/.exec(location.hash)?.[1];
  const card = jogador && cartas.find((item) => item.thread === `${manifest.season}:${jogador}`);
  const alvo = card ? `carta-${card.rank}` : /^#(carta-\d+|dia-\d{4}-\d{2}-\d{2}|comentarios)$/.exec(location.hash)?.[1];
  if (!alvo) return;
  const el = document.getElementById(alvo);
  if (!el) return;
  if (el.classList.contains("linha")) abrir(el, true);
  requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
}

// Refaz a pagina com um manifesto. Roda na carga e de novo quando uma edicao
// e liberada com a pagina aberta; por isso guarda as cartinhas abertas e nao
// mexe no scroll.
function aplicar(data) {
  manifest = data;
  const faixas = diasComFaixa();
  cartas = faixas.filter((day) => day.revelado).flatMap((day) => day.cards);
  const abertas = [...dias.querySelectorAll(".linha.aberta")].map((el) => el.id);
  renderRegra();
  renderContagem(faixas);
  renderDias(faixas);
  renderCalendario(faixas);
  abertas.forEach((id) => {
    const el = document.getElementById(id);
    if (el) abrir(el, true);
  });
  pintaSelos();
}

// ---------------------------------------------------------------- comentarios

// Duas conversas: a da colecao, no fim da pagina, e a de cada cartinha, que
// aparece quando ela abre na lista. As duas sao do tipo "card": "2026" e a
// colecao e "2026:<puuid>" a cartinha. Sem os scripts da comunidade a pagina
// segue inteira, so sem comentarios.
const comunidade = Boolean(window.Community && window.Comments && window.Auth);

// Quem esta logado, e o que muda o desenho da conversa: admin apaga o que for,
// banido nao comenta.
function chaveDaConta() {
  const C = window.Community;
  const perfilAtual = C.logado() ? C.perfil() : null;
  return perfilAtual ? `${perfilAtual.id}:${perfilAtual.role}:${C.banido()}` : "";
}

let contaAnterior = "";
const contaPronta = comunidade
  ? window.Auth.iniciar()
      .then(() => {
        window.Auth.pintaSlot();
        contaAnterior = chaveDaConta();
      })
      .catch(() => null)
  : Promise.resolve();

function montaConversa(raiz) {
  if (!comunidade) return;
  raiz.dataset.montada = "1";
  contaPronta.then(() => window.Comments.montar("card", raiz.dataset.thread, raiz));
}

// Selo de comentarios a esquerda do overall, so quando a cartinha tem algum.
function pintaSelos() {
  if (!comunidade) return;
  dias.querySelectorAll(".r-cmt[data-thread]").forEach((alvo) => {
    alvo.innerHTML = window.Comments.selo("card", alvo.dataset.thread);
  });
  pintaTotalDaColecao();
}

function pintaTotalDaColecao(total) {
  if (!comunidade || !manifest) return;
  const n = total ?? window.Community.contagem("card", String(manifest.season));
  conversaTotal.textContent = n ? `${num(n)} ${n === 1 ? "comentário" : "comentários"}` : "Comente";
}

// Cada conversa avisa quando se desenha, com o total exato: o selo da linha e
// o atalho da colecao mudam na hora, sem esperar outra consulta.
document.addEventListener("comentarios:desenhados", (event) => {
  const { kind, id, total } = event.detail || {};
  if (kind !== "card" || !manifest) return;
  if (id === String(manifest.season)) return pintaTotalDaColecao(total);
  dias.querySelectorAll(".r-cmt[data-thread]").forEach((alvo) => {
    if (alvo.dataset.thread === id) alvo.innerHTML = window.Comments.selo("card", id, total);
  });
});

// O auth.js chama window.render() quando a conta muda. Aqui so as conversas
// ja montadas precisam refazer (o convite vira formulario e vice-versa), e so
// quando quem esta logado mudou de fato: a renovacao do token tambem dispara
// o aviso, e refazer apagaria o que a pessoa estivesse escrevendo.
window.render = () => {
  if (!comunidade) return;
  const conta = chaveDaConta();
  if (conta === contaAnterior) return;
  contaAnterior = conta;
  document.querySelectorAll(".cmt-secao[data-montada]").forEach((raiz) => window.Comments.montar("card", raiz.dataset.thread, raiz));
};

dias.addEventListener("click", (event) => {
  const botao = event.target.closest(".resumo");
  if (botao) abrir(botao.closest(".linha"));
});
busca.addEventListener("input", mostrarBusca);
busca.addEventListener("focus", mostrarBusca);
busca.addEventListener("keydown", (event) => {
  if (event.key === "Escape") buscaResultados.hidden = true;
  if (event.key === "Enter" && !buscaResultados.hidden) {
    const primeiro = buscaResultados.querySelector("a");
    if (primeiro) {
      event.preventDefault();
      primeiro.click();
    }
  }
});
buscaResultados.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    buscaResultados.hidden = true;
    busca.blur();
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".busca")) buscaResultados.hidden = true;
});
window.addEventListener("hashchange", () => {
  if (manifest) seguirEndereco();
});

if (comunidade) window.Community.carregarContagens().then(pintaSelos);
else {
  conversa.hidden = true;
  document.querySelector(".atalho-conversa").hidden = true;
}

buscaManifesto()
  .then((data) => {
    aplicar(data);
    seguirEndereco();
    conversa.dataset.thread = String(data.season);
    montaConversa(conversa);
  })
  .catch(() => {
    dias.innerHTML = `<p class="aviso">Não foi possível carregar as cartinhas.</p>`;
  });
