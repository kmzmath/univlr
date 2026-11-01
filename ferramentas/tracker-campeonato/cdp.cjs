// Conexão com o Chrome dedicado do coletor pessoal (start-chrome.ps1, perfil
// C:\tracker-chrome-profile, CDP em 127.0.0.1:9222). As requisições saem de
// dentro da página, com os cookies e o TLS do Chrome real; o Node só conecta.
//
// O Playwright vem da instalação do coletor pessoal, para não haver npm install
// no projeto. PLAYWRIGHT_PATH troca o caminho.

const PLAYWRIGHT =
  process.env.PLAYWRIGHT_PATH ||
  "C:/Users/mmora/Downloads/tracker-collector-cdp/cdp/node_modules/playwright";
const { chromium } = require(PLAYWRIGHT);

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

async function conectar() {
  const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 30_000 });
  const context = browser.contexts()[0];
  if (!context) throw new Error("Chrome conectado, mas sem BrowserContext.");
  return { browser, context };
}

function mesmoHost(url, host) {
  try {
    const h = new URL(url).hostname;
    return h === host || h.endsWith("." + host);
  } catch {
    return false;
  }
}

// Reaproveita uma aba do host se houver; senão abre uma nova em `url`.
async function abaDo(context, host, url) {
  let page = context.pages().find((p) => !p.isClosed() && mesmoHost(p.url(), host));
  if (!page) {
    page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  }
  return page;
}

module.exports = { conectar, abaDo, mesmoHost };
