// Medicao de audiencia (Umami). Tres regras governam este arquivo:
//
// 1. O tracker e script de terceiro e pode nao carregar - adblock derruba boa
//    parte dele. Por isso toda funcao daqui comeca conferindo `window.umami` e
//    volta em silencio quando ele falta. Nenhuma linha do site depende do
//    retorno destas funcoes.
// 2. A rota do UNIVLR mora depois do `#`, que nunca chega ao servidor. O
//    tracker automatico contaria uma visita por sessao inteira, entao o
//    pageview automatico esta desligado no index.html: quem conta e o
//    render(), mais um disparo na entrada para nao perder quem desiste antes
//    do banco chegar.
// 3. Desenvolvimento local nao entra no painel. Quem barra e o
//    umamiBeforeSend, la embaixo.

// O painel agrupa por URL. Sem esta traducao o site inteiro apareceria numa
// linha unica chamada "/", porque e isso que o navegador manda: `#/teams/x/
// roster` vira `/teams/x/roster`. A query fica de fora de proposito - trocar
// um filtro nao e mudar de pagina, e o filtro viaja como evento proprio.
function analyticsPath() {
  const hash = String(window.location.hash || "").replace(/^#\/?/, "");
  const [caminho] = hash.split("?");
  // A home tem dois enderecos: a raiz sem hash, por onde todo mundo entra, e
  // #/home, por onde se volta pela navegacao. Sao a mesma pagina, e sem esta
  // juncao a pagina mais visitada do site sairia partida em duas linhas.
  if (caminho === "" || caminho === "home") return "/";
  return "/" + caminho;
}

// O ultimo caminho contado. Existe porque duas coisas disparam o pageview de
// entrada: o DOMContentLoaded e o primeiro render(). Sem esta memoria a
// primeira visita de toda sessao contaria em dobro.
let analyticsUltimoCaminho = null;

function trackPageview() {
  if (!window.umami) return;
  const caminho = analyticsPath();
  if (caminho === analyticsUltimoCaminho) return;
  analyticsUltimoCaminho = caminho;
  window.umami.track((props) => ({ ...props, url: caminho, title: document.title }));
}

// O Umami corta string de evento em 500 caracteres. O filtro de partidas
// serializa lista de mapas e de equipes e passa disso com facilidade, e um
// valor cortado no meio de um id vira lixo no painel. Corto antes, no limite,
// e marco o corte para o numero nao ser lido como se fosse a lista inteira.
const ANALYTICS_MAX_VALOR = 500;

function analyticsValor(valor) {
  const texto = String(valor);
  if (texto.length <= ANALYTICS_MAX_VALOR) return texto;
  return texto.slice(0, ANALYTICS_MAX_VALOR - 1) + "+";
}

// O que a pessoa digita nao sobe. `q` e o campo livre da busca de jogadores; o
// resto dos filtros e escolha de uma lista fechada e pode ir inteiro.
const ANALYTICS_CAMPOS_LIVRES = new Set(["q"]);

function trackFiltro(secao, params) {
  if (!window.umami) return;
  const dados = { secao };
  params.forEach((valor, chave) => {
    if (ANALYTICS_CAMPOS_LIVRES.has(chave)) return;
    dados[chave] = analyticsValor(valor);
  });
  // A forma de funcao, e nao `track("filtro", dados)`: a forma curta deixa o
  // `url` no padrao, que num site em hash e sempre a raiz - o evento chegaria
  // ao painel desgarrado da pagina onde o filtro foi mexido.
  window.umami.track((props) => ({ ...props, name: "filtro", data: dados, url: analyticsPath() }));
}

// O Umami chama isto antes de cada envio e cancela quando a volta e falsa. E o
// que mantem a maquina de desenvolvimento fora do painel sem depender de
// `data-domains`, que morreria em silencio no dia que o site trocar de
// endereco. Aqui o payload aparece no console e nao sai da maquina.
const ANALYTICS_HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "[::1]", ""]);

function umamiBeforeSend(type, payload) {
  if (!ANALYTICS_HOSTS_LOCAIS.has(window.location.hostname)) return payload;
  console.log("[analytics] cancelado (local):", type, payload);
  return false;
}

// O pageview de entrada. O render() so roda depois que o database.json de 30MB
// chega, e quem desistir antes disso nao seria contado - o tempo de pagina
// sairia inflado.
//
// A espera existe porque o `window.umami` nao esta pronto no DOMContentLoaded:
// o script vem de cloud.umami.is e se instala depois deste arquivo, entao
// medido sem espera o pageview de entrada simplesmente nao saia. Vinte
// tentativas de 100ms cobrem uma rede ruim e desistem em silencio se o script
// tiver sido bloqueado - nao adianta esperar por quem nao vem.
const ANALYTICS_TENTATIVAS = 20;
const ANALYTICS_ESPERA_MS = 100;

function trackPageviewQuandoPronto(restam = ANALYTICS_TENTATIVAS) {
  if (window.umami) return trackPageview();
  if (restam <= 0) return;
  window.setTimeout(() => trackPageviewQuandoPronto(restam - 1), ANALYTICS_ESPERA_MS);
}

document.addEventListener("DOMContentLoaded", () => trackPageviewQuandoPronto());
