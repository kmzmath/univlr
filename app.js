const DATABASE_MANIFEST = "database.json";
const HOME_MANIFEST = "home.json";
const SOURCE_MANIFEST = "data-sources.json";
const METADATA_MANIFEST = "metadata.json";
const TEAM_PROFILES_MANIFEST = "team-profiles.json";
const RANKING_WEIGHTS_MANIFEST = "ranking-weights.json";
const SITE_NAME = "UNIVLR";
const SITE_LOGO_SRC = "assets/logo_univlr.png";
const SITE_WORDMARK_SRC = "assets/univlr_logo_longa.png";
// Pesos diferentes de proposito: partidas e o que muda todo dia e leva a
// coluna mais longa; ranking e referencia (tem "Ver completo"); campeonato
// e contexto. Antes eram 15/15/15, o que dava 45 linhas de peso identico.
const HOME_RANKING_LIMIT = 10;
// 10 e nao 15: com a linha de partida crescida (escudo de 52px, nome de 20px,
// placar de 24px) a linha passou de 79px para 115px, e 15 delas davam 1.884px
// de coluna contra 822px da de campeonatos - mil pixels de vazio ao lado. Dez
// partidas ao lado das dez primeiras colocadas fecham as colunas juntas.
const HOME_RECENT_MATCH_LIMIT = 10;
const HOME_EVENT_LIMIT = 8;
const PLAYER_FALLBACK_PHOTO = "assets/user-silhouette.png";

// Os renderizadores de busca por tipo chamam renderSearchButton sem saber a
// posicao; guardar o indice aqui evita mudar a assinatura dos seis. Declarado
// aqui em cima porque init() roda no meio do arquivo (linha ~2709) e uma
// declaracao la embaixo cairia em temporal dead zone na primeira render.
let searchResultIndex = 0;
const TROPHY_ASSET_ROOT = "assets/trofeus-campeonatos";
const TROPHY_GENERIC_ASSETS = {
  champion: `${TROPHY_ASSET_ROOT}/campeao-generico.png`,
  runnerUp: `${TROPHY_ASSET_ROOT}/vice-generico.png`,
  third: `${TROPHY_ASSET_ROOT}/terceiro-generico.png`,
};
// Arte de trofeu POR CAMPEONATO que existe de fato no disco.
// GERADO por scripts/build_trophy_manifest.js - nao edite a mao.
//
// Por que existe: trophyImageCandidates monta ate seis nomes por podio e
// tentava cada um via onerror ate cair no generico. Medido em 28/08/2026: 225
// candidatos entre os 18 campeonatos e os tres podios, 225 falhando - 100%,
// porque nenhuma arte por campeonato existe. Na pratica eram 36 requisicoes
// falhas numa unica pagina de equipe, e 72 erros de console ao andar por duas.
//
// Com o manifesto vazio o codigo vai direto ao generico sem pedir nada. Quando
// alguem largar `jubs-campeao.png` na pasta e rodar o script, o nome entra aqui
// e o candidato volta a ser tentado - uma vez so, e com sucesso.
const TROPHY_ART_FILES = new Set([]);
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const IMAGE_WARM_STORAGE_KEY = "univlr-image-warm-v1";
const IMAGE_WARM_MAX_AGE_MS = 7 * DAY_MS;
const IMAGE_WARM_SPLASH_TIMEOUT_MS = 12000;
const IMAGE_WARM_CONCURRENCY = 6;
const RANKING_UPDATE_DAY = 2;
const PLAYER_OF_WEEK_INTERVAL_MS = 4500;
const PLAYER_OF_WEEK_IDLE_RESUME_MS = 5000;
const PLAYER_OF_WEEK_MIN_MAPS = 4;
const PLAYER_OF_WEEK_CATEGORIES = [
  { key: "rating", label: "Melhor rAAting 3.0", title: "Melhor jogador da semana", statLabel: "rAAting 3.0", value: (player) => officialRatingValue(player), format: (player) => playerRating(player) },
  { key: "acs", label: "Melhor ACS", title: "Melhor média de combate", statLabel: "ACS", value: (player) => player.acs, format: (player) => fmt(player.acs, 0) },
  { key: "adr", label: "Melhor ADR", title: "Mais dano por round", statLabel: "ADR", value: (player) => player.adr, format: (player) => fmt(player.adr, 0) },
  { key: "kast", label: "Melhor KAST", title: "Mais participação em rounds", statLabel: "KAST", value: (player) => player.kast, format: (player) => pct(player.kast) },
  { key: "impactRound", label: "Melhor Swing/R", title: "Maior round swing", statLabel: "Swing/R", value: (player) => playerSwingPerRound(player), format: (player) => signedDecimal(playerSwingPerRound(player)) },
  { key: "kd", label: "Melhor K/D", title: "Melhor média de K/D", statLabel: "K/D", value: (player) => player.kd, format: (player) => fmt(player.kd) },
  { key: "kpr", label: "Melhor KPR", title: "Mais kills por round jogado", statLabel: "KPR", value: (player) => player.kpr, format: (player) => fmt(player.kpr) },
  { key: "dpr", label: "Melhor DPR", title: "Menos mortes por round", statLabel: "DPR", value: (player) => player.dpr, format: (player) => fmt(player.dpr), lowIsBetter: true },
  { key: "apr", label: "Melhor APR", title: "Mais assistências por round", statLabel: "APR", value: (player) => player.apr, format: (player) => fmt(player.apr) },
];

// O que cada celula revela no hover. Nao sao os mesmos tres numeros para todas:
// quem lidera o ACS se explica por ADR e KPR, quem lidera o DPR se explica por
// KAST e K/D. Sao os numeros que respondem "por que ele esta em primeiro nisso".
const PLAYER_OF_WEEK_SUPPORT = {
  rating: ["acs", "kd", "kast"],
  acs: ["adr", "kpr", "kd"],
  adr: ["acs", "kpr", "impactRound"],
  kast: ["impactRound", "dpr", "apr"],
  impactRound: ["kast", "kd", "acs"],
  kd: ["kpr", "dpr", "acs"],
  kpr: ["acs", "kd", "adr"],
  dpr: ["kast", "kd", "impactRound"],
  apr: ["kast", "acs", "kpr"],
};

// aria-hidden porque isto e uma camada visual de hover: o leitor de tela ja
// recebe o nome do jogador e a estatistica principal pelo link, e os mesmos
// numeros estao inteiros na pagina do jogador, a um clique.
function weekSupportStats(category, player, extra = "") {
  // Vindo do home.json os três já chegam formatados; vindo do banco completo
  // são calculados aqui. As duas fontes produzem o mesmo par rótulo/valor.
  const stats =
    category?.support ||
    (PLAYER_OF_WEEK_SUPPORT[category?.key] || [])
      .map((key) => PLAYER_OF_WEEK_CATEGORIES.find((item) => item.key === key))
      .filter(Boolean)
      .map((item) => ({ statLabel: item.statLabel, value: item.format(player) }));
  if (!stats.length) return "";
  return `<span class="week-detail ${escapeHtml(extra)}" aria-hidden="true">${stats
    .map(
      (item) =>
        `<span class="week-detail-stat"><small>${escapeHtml(item.statLabel)}</small><b>${escapeHtml(item.value)}</b></span>`,
    )
    .join("")}</span>`;
}

const MAP_API_SLUGS = {
  "/Game/Maps/Ascent/Ascent": "ascent",
  "/Game/Maps/Jam/Jam": "lotus",
  "/Game/Maps/Triad/Triad": "haven",
  "/Game/Maps/Bonsai/Bonsai": "split",
  "/Game/Maps/Duality/Duality": "bind",
  "/Game/Maps/Canyon/Canyon": "fracture",
  "/Game/Maps/Pitt/Pitt": "pearl",
  "/Game/Maps/Foxtrot/Foxtrot": "breeze",
  "/Game/Maps/Port/Port": "icebox",
  "/Game/Maps/Juliett/Juliett": "sunset",
  "/Game/Maps/Infinity/Infinity": "abyss",
  "/Game/Maps/Rook/Rook": "corrode",
  "/Game/Maps/Plummet/Plummet": "summit",
};

const AGENT_API_SLUGS = {
  "41fb69c1-4189-7b37-f117-bcaf1e96f1bf": "astra",
  "5f8d3a7f-467b-97f3-062c-13acf203c006": "breach",
  "9f0d8ba9-4140-b941-57d3-a7ad57c6b417": "brimstone",
  "22697a3d-45bf-8dd7-4fec-84a9e28c69d7": "chamber",
  "1dbf2edd-4729-0984-3115-daa5eed44993": "clove",
  "117ed9e3-49f3-6512-3ccf-0cada7e3823b": "cypher",
  "cc8b64c8-4b25-4ff9-6e7f-37b4da43d235": "deadlock",
  "dade69b4-4f5a-8528-247b-219e5a1facd6": "fade",
  "e370fa57-4757-3604-3648-499e1f642d3f": "gekko",
  "95b78ed7-4637-86d9-7e41-71ba8c293152": "harbor",
  "0e38b510-41a8-5780-5e8f-568b2a4f2d6c": "iso",
  "add6443a-41bd-e414-f6ad-e58d267f4e95": "jett",
  "601dbbe7-43ce-be57-2a40-4abd24953621": "kayo",
  "1e58de9c-4950-5125-93e9-a0aee9f98746": "killjoy",
  "7c8a4701-4de6-9355-b254-e09bc2a34b72": "miks",
  "bb2a4828-46eb-8cd1-e765-15848195d751": "neon",
  "8e253930-4c05-31dd-1b6c-968525494517": "omen",
  "eb93336a-449b-9c1b-0a54-a891f7921d69": "phoenix",
  "f94c3b30-42be-e959-889c-5aa313dba261": "raze",
  "a3bfb853-43b2-7238-a4f1-ad90e9e46bcc": "reyna",
  "569fdd95-4d10-43ab-ca70-79becc718b46": "sage",
  "6f2a04ca-43e0-be17-7f36-b3908627744d": "skye",
  "320b2a48-4d9b-a075-30f1-1f93a9b638fa": "sova",
  "b444168c-4e35-8076-db47-ef9bf368f384": "tejo",
  "92eeef5d-43b5-1d4a-8d03-b3927a09034b": "veto",
  "707eab51-4836-f488-046a-cda6bf494859": "viper",
  "efba5359-4016-a1e5-7626-b1ae76895940": "vyse",
  "df1cb487-4902-002e-5c17-d28e83e78588": "waylay",
  "7f94d92c-4234-0a36-9646-3a87eb8b5c89": "yoru",
};

const ROLE_ICONS = {
  controlador: { label: "Controlador", icon: "assets/roles/ControllerClassSymbol.webp" },
  duelista: { label: "Duelista", icon: "assets/roles/DuelistClassSymbol.webp" },
  iniciador: { label: "Iniciador", icon: "assets/roles/InitiatorClassSymbol.webp" },
  sentinela: { label: "Sentinela", icon: "assets/roles/SentinelClassSymbol.webp" },
};

const TRADE_WINDOW_MS = 5000;
const ARMOR_EXTRA_HP = {
  "": 0,
  "4DEC83D5-4902-9AB3-BED6-A7A390761157": 25,
  "822BCAB2-40A2-324E-C137-E09195AD7692": 50,
};

const WEAPON_NAMES = {
  "29a0cfab-485b-f5d5-779a-b59f85e204a8": "Classic",
  "42da8ccc-40d5-affc-beec-15aa47b42eda": "Shorty",
  "44d4e95c-4157-0037-81b2-17841bf2e8e3": "Frenzy",
  "1baa85b4-4c70-1284-64bb-6481dfc3bb4e": "Ghost",
  "e336c6b8-418d-9340-d77f-7a9e4cfe0702": "Sheriff",
  "f7e1b454-4ad4-1063-ec0a-159e56b58941": "Stinger",
  "462080d1-4035-2937-7c09-27aa2a5c27a7": "Spectre",
  "910be174-449b-c412-ab22-d0873436b21b": "Bucky",
  "ec845bf4-4f79-ddda-a3da-0db3774b2794": "Judge",
  "ae3de142-4d85-2547-dd26-4e90bed35cf7": "Bulldog",
  "4ade7faa-4cf1-8376-95ef-39884480959b": "Guardian",
  "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a": "Phantom",
  "9c82e19d-4575-0200-1a81-3eacf00cf872": "Vandal",
  "5f0aaf7a-4289-3998-d5ff-eb9a5cf7ef5c": "Outlaw",
  "c4883e50-4494-202c-3ec3-6b8a9284f00b": "Marshal",
  "a03b24d3-4319-996d-0f8c-94bbfba1dfc7": "Operator",
  "55d8a0f4-4274-ca67-fe2c-06ab45efdf58": "Ares",
  "63e6c2b6-4a8e-869c-3d4c-e38355226584": "Odin",
  "2f59173c-4bed-b6c3-2191-dea9b58be9c7": "Melee",
};

const KNOWN_ACRONYMS = new Set([
  "aaeu",
  "a2e",
  "aoc",
  "caap",
  "ceub",
  "cia",
  "fei",
  "fatec",
  "gdu",
  "ibmec",
  "inatel",
  "jubs",
  "lpe",
  "pg",
  "pucgo",
  "pucc",
  "sp",
  "ufg",
  "uff",
  "ufmg",
  "ufpb",
  "unifesp",
  "ufu",
  "ufrj",
  "umc",
  "uni",
  "unirv",
  "xxii",
]);

const FILENAME_TEAM_ALIASES = {
  azr: "azure_bears",
  caap: "caap_hellhounds",
  fei: "fei_darkowls",
  mackred: "macklogic_red",
  pucc: "pucc_cardinals",
  tritons: "unicamp_tritons_red",
  uspstars: "usp_stars",
  axissupernova: "axis_anteaters",
};

const TOURNAMENT_OVERRIDES = {
  aoc: {
    organizerLogo: "assets/organizers-logos/logo_aoc.png",
    prizePool: "5x Monitores AGON CS24A/P",
    tier: "A",
    type: "Online",
    teamCount: 10,
    mapPool: ["Haven", "Ascent", "Pearl", "Lotus", "Split", "Breeze", "Fracture"],
    teams: [
      "dark_ufrj",
      "uninassau_griffins",
      "caap_hellhounds",
      "azure_bears_golden",
      "ufu_saints",
      "macklogic_red",
      "ufmt_turuna",
      "ceub_octopus",
      "azure_bears_black",
      "green_owls_noctua",
    ],
    placements: [
      { range: "1", id: "ceub_octopus" },
      { range: "2", id: "macklogic_red" },
      { range: "3", id: "azure_bears_golden" },
      { range: "4", id: "uninassau_griffins" },
      { range: "5-8", id: "dark_ufrj" },
      { range: "5-8", id: "caap_hellhounds" },
      { range: "5-8", id: "ufu_saints" },
      { range: "5-8", id: "azure_bears_black" },
      { range: "9-10", id: "ufmt_turuna" },
      { range: "9-10", id: "green_owls_noctua" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o simples",
      details: ["Todos os jogos MD3", "Disputa de terceiro lugar"],
      standings: "Coloca\u00e7\u00e3o oficial do campeonato",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o simples",
      regions: [
        {
          name: "Final",
          className: "grand-final",
          columns: [
            {
              title: "Final",
              matches: [
                { code: "Partida 14", bestOf: "MD3", a: "ceub_octopus", scoreA: 2, b: "macklogic_red", scoreB: 0, winner: "ceub_octopus" },
              ],
            },
          ],
        },
        {
          name: "Chave principal",
          className: "upper-bracket single-elimination",
          columns: [
            {
              title: "Oitavas de final",
              matches: [
                { code: "Partida 1", a: "dark_ufrj", scoreA: 1, bLabel: "Bye", scoreB: 0, winner: "dark_ufrj" },
                { code: "Partida 2", a: "uninassau_griffins", scoreA: 1, bLabel: "Bye", scoreB: 0, winner: "uninassau_griffins" },
                { code: "Partida 3", a: "caap_hellhounds", scoreA: 1, bLabel: "Bye", scoreB: 0, winner: "caap_hellhounds" },
                { code: "Partida 4", a: "azure_bears_golden", scoreA: 1, bLabel: "Bye", scoreB: 0, winner: "azure_bears_golden" },
                { code: "Partida 5", a: "ufu_saints", scoreA: 1, bLabel: "Bye", scoreB: 0, winner: "ufu_saints" },
                { code: "Partida 6", a: "macklogic_red", scoreA: 1, bLabel: "Bye", scoreB: 0, winner: "macklogic_red" },
                { code: "Partida 7", bestOf: "MD3", a: "ufmt_turuna", scoreA: 0, b: "ceub_octopus", scoreB: 2, winner: "ceub_octopus" },
                { code: "Partida 8", bestOf: "MD3", a: "azure_bears_black", scoreA: 2, b: "green_owls_noctua", scoreB: 0, winner: "azure_bears_black" },
              ],
            },
            {
              title: "Quartas de final",
              matches: [
                { code: "Partida 9", bestOf: "MD3", a: "dark_ufrj", scoreA: 0, b: "uninassau_griffins", scoreB: 2, winner: "uninassau_griffins" },
                { code: "Partida 10", bestOf: "MD3", a: "caap_hellhounds", scoreA: 0, b: "azure_bears_golden", scoreB: 2, winner: "azure_bears_golden" },
                { code: "Partida 11", bestOf: "MD3", a: "ufu_saints", scoreA: 1, b: "macklogic_red", scoreB: 2, winner: "macklogic_red" },
                { code: "Partida 12", bestOf: "MD3", a: "ceub_octopus", scoreA: 2, b: "azure_bears_black", scoreB: 0, winner: "ceub_octopus" },
              ],
            },
            {
              title: "Semi finais",
              matches: [
                { code: "Partida 15", bestOf: "MD3", a: "macklogic_red", scoreA: 2, b: "uninassau_griffins", scoreB: 0, winner: "macklogic_red" },
                { code: "Partida 16", bestOf: "MD3", a: "azure_bears_golden", scoreA: 0, b: "ceub_octopus", scoreB: 2, winner: "ceub_octopus" },
              ],
            },
          ],
        },
        {
          name: "Disputa terceiro lugar",
          className: "lower-bracket third-place",
          columns: [
            {
              title: "3\u00ba lugar",
              matches: [
                { code: "Partida 13", bestOf: "MD3", a: "azure_bears_golden", scoreA: 2, b: "uninassau_griffins", scoreB: 0, winner: "azure_bears_golden" },
              ],
            },
          ],
        },
      ],
    },
  },
  "cia-2026": {
    organizerLogo: "assets/tournament-icons/cia.png",
    prizePool: "-",
    tier: "C",
    type: "Online - Torneio Local",
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Todos os jogos MD3"],
    },
    teams: ["grifo_ufmg", "ufu_saints", "caap_hellhounds", "unifacens_fodens"],
    placements: [
      { range: "1", id: "caap_hellhounds" },
      { range: "2", id: "ufu_saints" },
      { range: "3", id: "unifacens_fodens" },
      { range: "4", id: "grifo_ufmg" },
    ],
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Finais",
          className: "grand-final",
          columns: [
            {
              title: "Finais",
              matches: [
                { code: "Partida 6", bestOf: "MD3", a: "caap_hellhounds", scoreA: 2, b: "ufu_saints", scoreB: 1, winner: "caap_hellhounds" },
              ],
            },
          ],
        },
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Fase 1",
              matches: [
                { code: "Partida 1", bestOf: "MD3", a: "grifo_ufmg", scoreA: 0, b: "ufu_saints", scoreB: 2, winner: "ufu_saints" },
                { code: "Partida 2", bestOf: "MD3", a: "caap_hellhounds", scoreA: 2, b: "unifacens_fodens", scoreB: 0, winner: "caap_hellhounds" },
              ],
            },
            {
              title: "Semi-finais",
              matches: [
                { code: "Partida 4", bestOf: "MD3", a: "ufu_saints", scoreA: 1, b: "caap_hellhounds", scoreB: 2, winner: "caap_hellhounds" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Perdedores Fase 1",
              matches: [
                { code: "Partida 3", bestOf: "MD3", a: "grifo_ufmg", scoreA: 0, b: "unifacens_fodens", scoreB: 2, winner: "unifacens_fodens" },
              ],
            },
            {
              title: "Perdedores Fase 2",
              matches: [
                { code: "Partida 5", bestOf: "MD3", a: "ufu_saints", scoreA: 2, b: "unifacens_fodens", scoreB: 0, winner: "ufu_saints" },
              ],
            },
          ],
        },
      ],
    },
  },
  lpe: {
    hidden: true,
  },
  "jubs-pre-jubs": {
    hidden: true,
  },
  "jubs-fase-inicial": {
    name: "JUBS Goiás 2026 - Fase inicial",
    organizer: "CBDU",
    organizerLogo: "assets/organizers-logos/logo_CBDU.png",
    banner: "assets/tournament-banners/banner_jubs.png",
    prizePool: "-",
    tier: "A",
    status: "Finalizado",
    teamCount: 40,
    type: "Online",
    mapPool: ["Ascent", "Lotus", "Haven", "Split", "Breeze", "Pearl", "Fracture", "Sunset"],
    format: {
      summary: "Sistema Su\u00ed\u00e7o",
      details: [
        "Todos os jogos MD3",
        "Equipes com 3 derrotas sao eliminadas",
        "M\u00e1ximo de 2 equipes por estado ap\u00f3s a Rodada 6",
        "Rodada 7 decisiva: quem vence classifica, quem perde est\u00e1 eliminado",
      ],
      standings: "Classifica\u00e7\u00e3o su\u00ed\u00e7a atual",
    },
    teams: [
      "ceub_octopus",
      "macklogic_red",
      "green_owls_noctua",
      "azure_bears_golden",
      "uninassau_griffins",
      "fametro_berserkers",
      "axis_anteaters",
      "pucc_cardinals",
      "inatel",
      "wolf_gaming",
      "univasf",
      "caap_hellhounds",
      "ufs_bugados",
      "ufmt_turuna",
      "a2e_uff",
      "ufu_saints",
      "ucb_dogs",
      "furia_utfpr",
      "ufg_eagles",
      "ufpr_bbn",
      "ufrn_carcaras",
      "acucarados",
      "unit_troianos",
      "ufrj_minerva",
      "unirio_krakens",
      "rahnag",
      "undbala",
      "uepa_imperadores",
      "ufpe_virtus",
      "milionaria_ufam",
      "unifor",
      "uema_turbulencia",
      "ueg_hipertensa",
      "ufma_naotemclutch",
      "unisc_ladaiada",
      "ufcg_pensaopet",
      "ufg_gc_eagles",
      "lunatica_ufms",
      "limpezinha",
      "carrascos_fd8j",
    ],
    placements: [
      { range: "Classificado", id: "ceub_octopus", note: "7-0" },
      { range: "Classificado", id: "azure_bears_golden", note: "6-1" },
      { range: "Classificado", id: "uninassau_griffins", note: "6-1" },
      { range: "Classificado", id: "a2e_uff", note: "5-2" },
      { range: "Classificado", id: "ufu_saints", note: "5-2" },
      { range: "Classificado", id: "ufmt_turuna", note: "5-2" },
      { range: "Classificado", id: "macklogic_red", note: "5-2" },
      { range: "Classificado", id: "fametro_berserkers", note: "4-3" },
      { range: "9-16", id: "caap_hellhounds", note: "5-2", reason: "Perdeu a decisiva da Rodada 7" },
      { range: "9-16", id: "ucb_dogs", note: "4-3", reason: "Perdeu a decisiva da Rodada 7" },
      { range: "9-16", id: "inatel", note: "4-3", reason: "Perdeu a decisiva da Rodada 7" },
      { range: "9-16", id: "ufrj_minerva", note: "4-3", reason: "Perdeu a decisiva da Rodada 7" },
      { range: "9-16", id: "furia_utfpr", note: "4-3", reason: "Perdeu a decisiva da Rodada 7" },
      { range: "9-16", id: "ufpe_virtus", note: "3-4", reason: "Perdeu a decisiva da Rodada 7" },
      { range: "9-16", id: "ufs_bugados", note: "3-4", reason: "Perdeu a decisiva da Rodada 7" },
      { range: "9-16", id: "unisc_ladaiada", note: "3-4", reason: "Perdeu a decisiva da Rodada 7" },
      { range: "17-20", id: "axis_anteaters", note: "4-2", reason: "Limite de 2 equipes por estado (SP)" },
      { range: "17-20", id: "pucc_cardinals", note: "4-2", reason: "Limite de 2 equipes por estado (SP)" },
      { range: "17-20", id: "wolf_gaming", note: "3-3", reason: "Limite de 2 equipes por estado (RJ)" },
      { range: "17-20", id: "green_owls_noctua", note: "3-3", reason: "Limite de 2 equipes por estado (DF)" },
      { range: "21-28", id: "univasf", note: "2-3" },
      { range: "21-28", id: "milionaria_ufam", note: "2-3" },
      { range: "21-28", id: "uepa_imperadores", note: "2-3" },
      { range: "21-28", id: "ufg_eagles", note: "2-3" },
      { range: "21-28", id: "rahnag", note: "2-3" },
      { range: "21-28", id: "ufrn_carcaras", note: "2-3" },
      { range: "21-28", id: "acucarados", note: "2-3" },
      { range: "21-28", id: "ufpr_bbn", note: "2-3" },
      { range: "29-35", id: "uema_turbulencia", note: "1-3" },
      { range: "29-35", id: "ufma_naotemclutch", note: "1-3" },
      { range: "29-35", id: "unifor", note: "1-3" },
      { range: "29-35", id: "unirio_krakens", note: "1-3" },
      { range: "29-35", id: "ueg_hipertensa", note: "1-3" },
      { range: "29-35", id: "unit_troianos", note: "1-3" },
      { range: "29-35", id: "undbala", note: "1-3" },
      { range: "36-40", id: "ufcg_pensaopet", note: "0-3" },
      { range: "36-40", id: "ufg_gc_eagles", note: "0-3" },
      { range: "36-40", id: "lunatica_ufms", note: "0-3" },
      { range: "36-40", id: "limpezinha", note: "0-3" },
      { range: "36-40", id: "carrascos_fd8j", note: "0-3" },
    ],
    swiss: {
      seriesCount: 110,
      stateTables: true,
      standingsLabel: "Tabela final - 8 equipes classificadas",
      rounds: [
        {
          title: "Rodada 1",
          status: "Concluida",
          bestOf: "MD3",
          matches: [
            { code: "Partida 1", a: "furia_utfpr", scoreA: 2, b: "limpezinha", scoreB: 0, winner: "furia_utfpr" },
            { code: "Partida 2", a: "uninassau_griffins", scoreA: 2, b: "ufg_gc_eagles", scoreB: 0, winner: "uninassau_griffins" },
            { code: "Partida 3", a: "ufu_saints", scoreA: 0, b: "ceub_octopus", scoreB: 2, winner: "ceub_octopus" },
            { code: "Partida 4", a: "ufcg_pensaopet", scoreA: 0, b: "ufg_eagles", scoreB: 2, winner: "ufg_eagles" },
            { code: "Partida 5", a: "unit_troianos", scoreA: 0, b: "azure_bears_golden", scoreB: 2, winner: "azure_bears_golden" },
            { code: "Partida 6", a: "ufrn_carcaras", scoreA: 2, b: "ufma_naotemclutch", scoreB: 0, winner: "ufrn_carcaras" },
            { code: "Partida 7", a: "ufrj_minerva", scoreA: 0, b: "wolf_gaming", scoreB: 2, winner: "wolf_gaming" },
            { code: "Partida 8", a: "unirio_krakens", scoreA: 2, b: "unifor", scoreB: 0, winner: "unirio_krakens" },
            { code: "Partida 9", a: "pucc_cardinals", scoreA: 2, b: "ufpe_virtus", scoreB: 0, winner: "pucc_cardinals" },
            { code: "Partida 10", a: "caap_hellhounds", scoreA: 2, b: "undbala", scoreB: 0, winner: "caap_hellhounds" },
            { code: "Partida 11", a: "fametro_berserkers", scoreA: 2, b: "ufpr_bbn", scoreB: 0, winner: "fametro_berserkers" },
            { code: "Partida 12", a: "carrascos_fd8j", scoreA: 0, b: "uepa_imperadores", scoreB: 2, winner: "uepa_imperadores" },
            { code: "Partida 13", a: "ufmt_turuna", scoreA: 2, b: "uema_turbulencia", scoreB: 0, winner: "ufmt_turuna" },
            { code: "Partida 14", a: "a2e_uff", scoreA: 0, b: "green_owls_noctua", scoreB: 2, winner: "green_owls_noctua" },
            { code: "Partida 15", a: "ufs_bugados", scoreA: 1, b: "macklogic_red", scoreB: 2, winner: "macklogic_red" },
            { code: "Partida 16", a: "milionaria_ufam", scoreA: 0, b: "univasf", scoreB: 2, winner: "univasf" },
            { code: "Partida 17", a: "lunatica_ufms", scoreA: 0, b: "inatel", scoreB: 2, winner: "inatel" },
            { code: "Partida 18", a: "unisc_ladaiada", scoreA: 1, b: "acucarados", scoreB: 2, winner: "acucarados" },
            { code: "Partida 19", a: "rahnag", scoreA: 2, b: "ueg_hipertensa", scoreB: 0, winner: "rahnag" },
            { code: "Partida 20", a: "axis_anteaters", scoreA: 2, b: "ucb_dogs", scoreB: 0, winner: "axis_anteaters" },
          ],
        },
        {
          title: "Rodada 2",
          status: "Concluida",
          bestOf: "MD3",
          matches: [
            { code: "Partida 21", a: "pucc_cardinals", scoreA: 2, b: "ufg_eagles", scoreB: 0, winner: "pucc_cardinals" },
            { code: "Partida 22", a: "ufmt_turuna", scoreA: 1, b: "uninassau_griffins", scoreB: 2, winner: "uninassau_griffins" },
            { code: "Partida 23", a: "ucb_dogs", scoreA: 2, b: "milionaria_ufam", scoreB: 0, winner: "ucb_dogs" },
            { code: "Partida 24", a: "ufcg_pensaopet", scoreA: 0, b: "ufpr_bbn", scoreB: 2, winner: "ufpr_bbn" },
            { code: "Partida 25", a: "wolf_gaming", scoreA: 2, b: "rahnag", scoreB: 0, winner: "wolf_gaming" },
            { code: "Partida 26", a: "ueg_hipertensa", scoreA: 2, b: "ufg_gc_eagles", scoreB: 1, winner: "ueg_hipertensa" },
            { code: "Partida 27", a: "uema_turbulencia", scoreA: 0, b: "ufrj_minerva", scoreB: 2, winner: "ufrj_minerva" },
            { code: "Partida 28", a: "ufs_bugados", scoreA: 2, b: "unit_troianos", scoreB: 0, winner: "ufs_bugados" },
            { code: "Partida 29", a: "green_owls_noctua", scoreA: 2, b: "ufrn_carcaras", scoreB: 0, winner: "green_owls_noctua" },
            { code: "Partida 30", a: "macklogic_red", scoreA: 2, b: "acucarados", scoreB: 0, winner: "macklogic_red" },
            { code: "Partida 31", a: "a2e_uff", scoreA: 2, b: "limpezinha", scoreB: 0, winner: "a2e_uff" },
            { code: "Partida 32", a: "carrascos_fd8j", scoreA: 0, b: "ufpe_virtus", scoreB: 2, winner: "ufpe_virtus" },
            { code: "Partida 33", a: "unirio_krakens", scoreA: 0, b: "fametro_berserkers", scoreB: 2, winner: "fametro_berserkers" },
            { code: "Partida 34", a: "azure_bears_golden", scoreA: 2, b: "caap_hellhounds", scoreB: 1, winner: "azure_bears_golden" },
            { code: "Partida 35", a: "uepa_imperadores", scoreA: 0, b: "univasf", scoreB: 2, winner: "univasf" },
            { code: "Partida 36", a: "ceub_octopus", scoreA: 2, b: "axis_anteaters", scoreB: 0, winner: "ceub_octopus" },
            { code: "Partida 37", a: "unisc_ladaiada", scoreA: 0, b: "unifor", scoreB: 2, winner: "unifor" },
            { code: "Partida 38", a: "inatel", scoreA: 2, b: "furia_utfpr", scoreB: 1, winner: "inatel" },
            { code: "Partida 39", a: "undbala", scoreA: 2, b: "ufma_naotemclutch", scoreB: 1, winner: "undbala" },
            { code: "Partida 40", a: "ufu_saints", scoreA: 2, b: "lunatica_ufms", scoreB: 0, winner: "ufu_saints" },
          ],
        },
        {
          title: "Rodada 3",
          status: "Concluida",
          bestOf: "MD3",
          matches: [
            { code: "Partida 41", a: "lunatica_ufms", scoreA: 0, b: "unit_troianos", scoreB: 2, winner: "unit_troianos" },
            { code: "Partida 42", a: "ueg_hipertensa", scoreA: 0, b: "ufu_saints", scoreB: 2, winner: "ufu_saints" },
            { code: "Partida 43", a: "ucb_dogs", scoreA: 2, b: "unifor", scoreB: 0, winner: "ucb_dogs" },
            { code: "Partida 44", a: "ufpr_bbn", scoreA: 2, b: "ufpe_virtus", scoreB: 0, winner: "ufpr_bbn" },
            { code: "Partida 45", a: "ufcg_pensaopet", scoreA: 1, b: "milionaria_ufam", scoreB: 2, winner: "milionaria_ufam" },
            { code: "Partida 46", a: "axis_anteaters", scoreA: 2, b: "uepa_imperadores", scoreB: 0, winner: "axis_anteaters" },
            { code: "Partida 47", a: "fametro_berserkers", scoreA: 1, b: "green_owls_noctua", scoreB: 2, winner: "green_owls_noctua" },
            { code: "Partida 48", a: "macklogic_red", scoreA: 2, b: "pucc_cardinals", scoreB: 0, winner: "macklogic_red" },
            { code: "Partida 49", a: "furia_utfpr", scoreA: 2, b: "unirio_krakens", scoreB: 0, winner: "furia_utfpr" },
            { code: "Partida 50", a: "inatel", scoreA: 0, b: "uninassau_griffins", scoreB: 2, winner: "uninassau_griffins" },
            { code: "Partida 51", a: "acucarados", scoreA: 0, b: "ufg_eagles", scoreB: 2, winner: "ufg_eagles" },
            { code: "Partida 52", a: "a2e_uff", scoreA: 2, b: "rahnag", scoreB: 0, winner: "a2e_uff" },
            { code: "Partida 53", a: "caap_hellhounds", scoreA: 2, b: "ufrn_carcaras", scoreB: 0, winner: "caap_hellhounds" },
            { code: "Partida 54", a: "limpezinha", scoreA: 0, b: "ufma_naotemclutch", scoreB: 2, winner: "ufma_naotemclutch" },
            { code: "Partida 55", a: "ceub_octopus", scoreA: 2, b: "univasf", scoreB: 0, winner: "ceub_octopus" },
            { code: "Partida 56", a: "unisc_ladaiada", scoreA: 2, b: "ufg_gc_eagles", scoreB: 0, winner: "unisc_ladaiada" },
            { code: "Partida 57", a: "azure_bears_golden", scoreA: 2, b: "wolf_gaming", scoreB: 1, winner: "azure_bears_golden" },
            { code: "Partida 58", a: "ufs_bugados", scoreA: 2, b: "undbala", scoreB: 0, winner: "ufs_bugados" },
            { code: "Partida 59", a: "ufmt_turuna", scoreA: 2, b: "ufrj_minerva", scoreB: 0, winner: "ufmt_turuna" },
            { code: "Partida 60", a: "carrascos_fd8j", scoreA: 0, b: "uema_turbulencia", scoreB: 2, winner: "uema_turbulencia" },
          ],
        },
        {
          title: "Rodada 4",
          status: "Concluida",
          bestOf: "MD3",
          matches: [
            { code: "Partida 61", a: "ufpe_virtus", scoreA: 1, bLabel: "BYE", scoreB: 0, winner: "ufpe_virtus" },
            { code: "Partida 62", a: "ucb_dogs", scoreA: 2, b: "ufpr_bbn", scoreB: 0, winner: "ucb_dogs" },
            { code: "Partida 63", a: "ufu_saints", scoreA: 1, b: "inatel", scoreB: 2, winner: "inatel" },
            { code: "Partida 64", a: "wolf_gaming", scoreA: 2, b: "furia_utfpr", scoreB: 1, winner: "wolf_gaming" },
            { code: "Partida 65", a: "uninassau_griffins", scoreA: 2, b: "axis_anteaters", scoreB: 1, winner: "uninassau_griffins" },
            { code: "Partida 66", a: "ufg_eagles", scoreA: 1, b: "a2e_uff", scoreB: 2, winner: "a2e_uff" },
            { code: "Partida 67", a: "acucarados", scoreA: 3, b: "uema_turbulencia", scoreB: 0, winner: "acucarados" },
            { code: "Partida 68", a: "green_owls_noctua", scoreA: 0, b: "ceub_octopus", scoreB: 2, winner: "ceub_octopus" },
            { code: "Partida 69", a: "ufma_naotemclutch", scoreA: 0, b: "rahnag", scoreB: 2, winner: "rahnag" },
            { code: "Partida 70", a: "univasf", scoreA: 0, b: "ufs_bugados", scoreB: 2, winner: "ufs_bugados" },
            { code: "Partida 71", a: "uepa_imperadores", scoreA: 2, b: "unifor", scoreB: 0, winner: "uepa_imperadores" },
            { code: "Partida 72", a: "caap_hellhounds", scoreA: 2, b: "fametro_berserkers", scoreB: 0, winner: "caap_hellhounds" },
            { code: "Partida 73", a: "ufrn_carcaras", scoreA: 2, b: "unirio_krakens", scoreB: 1, winner: "ufrn_carcaras" },
            { code: "Partida 74", a: "ueg_hipertensa", scoreA: 0, b: "ufrj_minerva", scoreB: 2, winner: "ufrj_minerva" },
            { code: "Partida 75", a: "macklogic_red", scoreA: 1, b: "azure_bears_golden", scoreB: 2, winner: "azure_bears_golden" },
            { code: "Partida 76", a: "pucc_cardinals", scoreA: 2, b: "ufmt_turuna", scoreB: 1, winner: "pucc_cardinals" },
            { code: "Partida 77", a: "milionaria_ufam", scoreA: 2, b: "unit_troianos", scoreB: 0, winner: "milionaria_ufam" },
            { code: "Partida 78", a: "undbala", scoreA: 0, b: "unisc_ladaiada", scoreB: 2, winner: "unisc_ladaiada" },
          ],
        },
        {
          title: "Rodada 5",
          status: "Concluida",
          bestOf: "MD3",
          matches: [
            { code: "Partida 79", a: "univasf", scoreA: 0, b: "unisc_ladaiada", scoreB: 2, winner: "unisc_ladaiada", status: "W.O." },
            { code: "Partida 80", a: "uninassau_griffins", scoreA: 2, b: "azure_bears_golden", scoreB: 0, winner: "uninassau_griffins", status: "W.O." },
            { code: "Partida 81", a: "macklogic_red", scoreA: 2, b: "a2e_uff", scoreB: 0, winner: "macklogic_red" },
            { code: "Partida 82", a: "milionaria_ufam", scoreA: 0, b: "fametro_berserkers", scoreB: 2, winner: "fametro_berserkers" },
            { code: "Partida 83", a: "ufs_bugados", scoreA: 0, b: "ucb_dogs", scoreB: 2, winner: "ucb_dogs" },
            { code: "Partida 84", a: "pucc_cardinals", scoreA: 2, b: "green_owls_noctua", scoreB: 1, winner: "pucc_cardinals" },
            { code: "Partida 85", a: "ufrj_minerva", scoreA: 2, b: "uepa_imperadores", scoreB: 0, winner: "ufrj_minerva" },
            { code: "Partida 86", a: "ufu_saints", scoreA: 2, b: "ufg_eagles", scoreB: 0, winner: "ufu_saints", status: "W.O." },
            { code: "Partida 87", a: "furia_utfpr", scoreA: 2, b: "rahnag", scoreB: 1, winner: "furia_utfpr" },
            { code: "Partida 88", a: "ufrn_carcaras", scoreA: 0, b: "ufpe_virtus", scoreB: 2, winner: "ufpe_virtus" },
            { code: "Partida 89", a: "axis_anteaters", scoreA: 2, b: "acucarados", scoreB: 0, winner: "axis_anteaters" },
            { code: "Partida 90", a: "ufpr_bbn", scoreA: 0, b: "ufmt_turuna", scoreB: 2, winner: "ufmt_turuna" },
            { code: "Partida 91", a: "caap_hellhounds", scoreA: 2, b: "inatel", scoreB: 1, winner: "caap_hellhounds" },
            { code: "Partida 92", a: "ceub_octopus", scoreA: 2, b: "wolf_gaming", scoreB: 0, winner: "ceub_octopus" },
          ],
        },
        {
          title: "Rodada 6",
          status: "Concluida",
          bestOf: "MD3",
          matches: [
            { code: "Partida 93", a: "axis_anteaters", scoreA: 2, b: "wolf_gaming", scoreB: 0, winner: "axis_anteaters" },
            { code: "Partida 94", a: "ufmt_turuna", scoreA: 2, b: "green_owls_noctua", scoreB: 0, winner: "ufmt_turuna" },
            { code: "Partida 95", a: "ufpe_virtus", scoreA: 0, b: "ufrj_minerva", scoreB: 2, winner: "ufrj_minerva", status: "W.O." },
            { code: "Partida 96", a: "ucb_dogs", scoreA: 0, b: "azure_bears_golden", scoreB: 2, winner: "azure_bears_golden" },
            { code: "Partida 97", a: "uninassau_griffins", scoreA: 0, b: "ceub_octopus", scoreB: 2, winner: "ceub_octopus" },
            { code: "Partida 98", a: "pucc_cardinals", scoreA: 0, b: "a2e_uff", scoreB: 2, winner: "a2e_uff" },
            { code: "Partida 99", a: "unisc_ladaiada", scoreA: 0, b: "furia_utfpr", scoreB: 2, winner: "furia_utfpr" },
            { code: "Partida 100", a: "ufs_bugados", scoreA: 0, b: "ufu_saints", scoreB: 2, winner: "ufu_saints" },
            { code: "Partida 101", a: "caap_hellhounds", scoreA: 2, b: "macklogic_red", scoreB: 0, winner: "caap_hellhounds" },
            { code: "Partida 102", a: "inatel", scoreA: 2, b: "fametro_berserkers", scoreB: 0, winner: "inatel" },
          ],
        },
        {
          title: "Rodada 7",
          status: "Concluida",
          bestOf: "MD3",
          matches: [
            { code: "Partida 103", a: "ceub_octopus", scoreA: 2, b: "ucb_dogs", scoreB: 0, winner: "ceub_octopus" },
            { code: "Partida 104", a: "fametro_berserkers", scoreA: 2, b: "ufs_bugados", scoreB: 0, winner: "fametro_berserkers" },
            { code: "Partida 105", a: "caap_hellhounds", scoreA: 1, b: "macklogic_red", scoreB: 2, winner: "macklogic_red" },
            { code: "Partida 106", a: "ufu_saints", scoreA: 2, b: "inatel", scoreB: 0, winner: "ufu_saints" },
            { code: "Partida 107", a: "uninassau_griffins", scoreA: 2, b: "ufpe_virtus", scoreB: 0, winner: "uninassau_griffins", status: "W.O." },
            { code: "Partida 108", a: "a2e_uff", scoreA: 2, b: "ufrj_minerva", scoreB: 0, winner: "a2e_uff" },
            { code: "Partida 109", a: "azure_bears_golden", scoreA: 2, b: "furia_utfpr", scoreB: 0, winner: "azure_bears_golden" },
            { code: "Partida 110", a: "ufmt_turuna", scoreA: 2, b: "unisc_ladaiada", scoreB: 0, winner: "ufmt_turuna", status: "W.O." },
          ],
        },
      ],
      standings: [
        { id: "ceub_octopus", wins: 7, losses: 0, points: 21, status: "Classificado" },
        { id: "azure_bears_golden", wins: 6, losses: 1, points: 18, status: "Classificado" },
        { id: "uninassau_griffins", wins: 6, losses: 1, points: 18, status: "Classificado" },
        { id: "a2e_uff", wins: 5, losses: 2, points: 15, status: "Classificado" },
        { id: "ufu_saints", wins: 5, losses: 2, points: 15, status: "Classificado" },
        { id: "ufmt_turuna", wins: 5, losses: 2, points: 15, status: "Classificado" },
        { id: "macklogic_red", wins: 5, losses: 2, points: 15, status: "Classificado" },
        { id: "fametro_berserkers", wins: 4, losses: 3, points: 12, status: "Classificado" },
      ],
      eliminated: [
        { id: "caap_hellhounds", wins: 5, losses: 2, points: 15, range: "9º - 16º lugar", note: "Perdeu a decisiva da Rodada 7" },
        { id: "ucb_dogs", wins: 4, losses: 3, points: 12, range: "9º - 16º lugar", note: "Perdeu a decisiva da Rodada 7" },
        { id: "inatel", wins: 4, losses: 3, points: 12, range: "9º - 16º lugar", note: "Perdeu a decisiva da Rodada 7" },
        { id: "ufrj_minerva", wins: 4, losses: 3, points: 12, range: "9º - 16º lugar", note: "Perdeu a decisiva da Rodada 7" },
        { id: "furia_utfpr", wins: 4, losses: 3, points: 12, range: "9º - 16º lugar", note: "Perdeu a decisiva da Rodada 7" },
        { id: "ufpe_virtus", wins: 3, losses: 4, points: 9, range: "9º - 16º lugar", note: "Perdeu a decisiva da Rodada 7" },
        { id: "ufs_bugados", wins: 3, losses: 4, points: 9, range: "9º - 16º lugar", note: "Perdeu a decisiva da Rodada 7" },
        { id: "unisc_ladaiada", wins: 3, losses: 4, points: 9, range: "9º - 16º lugar", note: "Perdeu a decisiva da Rodada 7" },
        { id: "axis_anteaters", wins: 4, losses: 2, points: 12, range: "17º - 20º lugar", note: "Limite de 2 equipes por estado (SP)" },
        { id: "pucc_cardinals", wins: 4, losses: 2, points: 12, range: "17º - 20º lugar", note: "Limite de 2 equipes por estado (SP)" },
        { id: "wolf_gaming", wins: 3, losses: 3, points: 9, range: "17º - 20º lugar", note: "Limite de 2 equipes por estado (RJ)" },
        { id: "green_owls_noctua", wins: 3, losses: 3, points: 9, range: "17º - 20º lugar", note: "Limite de 2 equipes por estado (DF)" },
        { id: "univasf", wins: 2, losses: 3, points: 6, range: "21\u00ba - 28\u00ba lugar" },
        { id: "milionaria_ufam", wins: 2, losses: 3, points: 6, range: "21\u00ba - 28\u00ba lugar" },
        { id: "uepa_imperadores", wins: 2, losses: 3, points: 6, range: "21\u00ba - 28\u00ba lugar" },
        { id: "ufg_eagles", wins: 2, losses: 3, points: 6, range: "21\u00ba - 28\u00ba lugar" },
        { id: "rahnag", wins: 2, losses: 3, points: 6, range: "21\u00ba - 28\u00ba lugar" },
        { id: "ufrn_carcaras", wins: 2, losses: 3, points: 6, range: "21\u00ba - 28\u00ba lugar" },
        { id: "acucarados", wins: 2, losses: 3, points: 6, range: "21\u00ba - 28\u00ba lugar" },
        { id: "ufpr_bbn", wins: 2, losses: 3, points: 6, range: "21\u00ba - 28\u00ba lugar" },
        { id: "uema_turbulencia", wins: 1, losses: 3, points: 3, range: "29\u00ba - 35\u00ba lugar" },
        { id: "ufma_naotemclutch", wins: 1, losses: 3, points: 3, range: "29\u00ba - 35\u00ba lugar" },
        { id: "unifor", wins: 1, losses: 3, points: 3, range: "29\u00ba - 35\u00ba lugar" },
        { id: "unirio_krakens", wins: 1, losses: 3, points: 3, range: "29\u00ba - 35\u00ba lugar" },
        { id: "ueg_hipertensa", wins: 1, losses: 3, points: 3, range: "29\u00ba - 35\u00ba lugar" },
        { id: "unit_troianos", wins: 1, losses: 3, points: 3, range: "29\u00ba - 35\u00ba lugar" },
        { id: "undbala", wins: 1, losses: 3, points: 3, range: "29\u00ba - 35\u00ba lugar" },
        { id: "ufcg_pensaopet", wins: 0, losses: 3, points: 0, range: "36\u00ba - 40\u00ba lugar" },
        { id: "ufg_gc_eagles", wins: 0, losses: 3, points: 0, range: "36\u00ba - 40\u00ba lugar" },
        { id: "lunatica_ufms", wins: 0, losses: 3, points: 0, range: "36\u00ba - 40\u00ba lugar" },
        { id: "limpezinha", wins: 0, losses: 3, points: 0, range: "36\u00ba - 40\u00ba lugar" },
        { id: "carrascos_fd8j", wins: 0, losses: 3, points: 0, range: "36\u00ba - 40\u00ba lugar" },
      ],
    },
  },
  "jubs-etapa-presencial": {
    name: "JUBS Goiás 2026 - Etapa Presencial",
    organizer: "CBDU",
    organizerLogo: "assets/organizers-logos/logo_CBDU.png",
    banner: "assets/tournament-banners/banner_jubs.png",
    prizePool: "-",
    tier: "S",
    status: "Agendado",
    type: "Presencial",
    startAt: "2026-08-30T00:00:00",
    endAt: "2026-09-05T23:00:00",
    teamCount: 8,
    format: {
      summary: "Grupos + Playoffs",
      details: [
        "2 grupos de 4 equipes em eliminação dupla (GSL)",
        "Opening e Winner's Match em MD1; Elimination e Decider em MD3",
        "Top 2 de cada grupo avança aos playoffs",
        "Playoffs em eliminação dupla, todos os jogos MD3",
        "Disputa de terceiro lugar em MD3",
      ],
      standings: "Chaveamento da fase de grupos",
    },
    teams: [
      "ceub_octopus",
      "fametro_berserkers",
      "macklogic_red",
      "ufmt_turuna",
      "uninassau_griffins",
      "azure_bears_golden",
      "a2e_uff",
      "ufu_saints",
    ],
    bracket: {
      title: "Grupos + Playoffs",
      regions: [
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 11", bestOf: "MD3", aLabel: "1º Grupo A", bLabel: "2º Grupo B" },
                { code: "Partida 12", bestOf: "MD3", aLabel: "1º Grupo B", bLabel: "2º Grupo A" },
              ],
            },
            {
              title: "Final superior",
              matches: [
                { code: "Partida 14", bestOf: "MD3", aLabel: "TBD", bLabel: "TBD" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada 1 inferior",
              matches: [
                { code: "Partida 13", bestOf: "MD3", aLabel: "TBD", bLabel: "TBD" },
              ],
            },
            {
              title: "Final inferior",
              matches: [
                { code: "Partida 15", bestOf: "MD3", aLabel: "TBD", bLabel: "TBD" },
              ],
            },
          ],
        },
        {
          name: "Grande final",
          className: "grand-final",
          columns: [
            {
              title: "Grande final",
              matches: [
                { code: "Partida 17", bestOf: "MD3", aLabel: "TBD", bLabel: "TBD" },
              ],
            },
          ],
        },
        {
          name: "Disputa de 3º lugar",
          className: "third-place",
          columns: [
            {
              title: "Disputa de 3º lugar",
              matches: [
                { code: "Partida 16", bestOf: "MD3", aLabel: "TBD", bLabel: "TBD" },
              ],
            },
          ],
        },
        {
          name: "Grupo A",
          className: "group-stage gsl-group",
          columns: [
            {
              title: "Opening (MD1)",
              matches: [
                { code: "Partida 1", bestOf: "MD1", status: "Agendada", slot: 0, a: "ceub_octopus", b: "fametro_berserkers" },
                { code: "Partida 2", bestOf: "MD1", status: "Agendada", slot: 1, a: "macklogic_red", b: "ufmt_turuna" },
              ],
            },
            {
              title: "Winner's (MD1)",
              matches: [
                { code: "Partida 5", bestOf: "MD1", slot: 0, aLabel: "TBD", bLabel: "TBD" },
              ],
            },
            {
              title: "Elimination (MD3)",
              matches: [
                { code: "Partida 7", bestOf: "MD3", slot: 1, aLabel: "TBD", bLabel: "TBD" },
              ],
            },
            {
              title: "Decider (MD3)",
              matches: [
                { code: "Partida 9", bestOf: "MD3", slot: 1, aLabel: "TBD", bLabel: "TBD" },
              ],
            },
          ],
          terminalColumn: {
            title: "Classificado",
            cards: [
              { label: "TBD", slot: 0 },
              { label: "TBD", slot: 1 },
            ],
          },
        },
        {
          name: "Grupo B",
          className: "group-stage gsl-group",
          columns: [
            {
              title: "Opening (MD1)",
              matches: [
                { code: "Partida 3", bestOf: "MD1", status: "Agendada", slot: 0, a: "uninassau_griffins", b: "a2e_uff" },
                { code: "Partida 4", bestOf: "MD1", status: "Agendada", slot: 1, a: "azure_bears_golden", b: "ufu_saints" },
              ],
            },
            {
              title: "Winner's (MD1)",
              matches: [
                { code: "Partida 6", bestOf: "MD1", slot: 0, aLabel: "TBD", bLabel: "TBD" },
              ],
            },
            {
              title: "Elimination (MD3)",
              matches: [
                { code: "Partida 8", bestOf: "MD3", slot: 1, aLabel: "TBD", bLabel: "TBD" },
              ],
            },
            {
              title: "Decider (MD3)",
              matches: [
                { code: "Partida 10", bestOf: "MD3", slot: 1, aLabel: "TBD", bLabel: "TBD" },
              ],
            },
          ],
          terminalColumn: {
            title: "Classificado",
            cards: [
              { label: "TBD", slot: 0 },
              { label: "TBD", slot: 1 },
            ],
          },
        },
      ],
    },
  },
  "jubs-pre-jubs-sp": {
    organizer: "CBDU",
    organizerLogo: "assets/organizers-logos/logo_CBDU.png",
    banner: "assets/tournament-banners/banner_jubs.png",
    prizePool: "-",
    tier: "B",
    type: "Online - Classificat\u00f3ria",
    startAt: "2026-05-16T13:00:00",
    endAt: "2026-05-17T20:00:00",
    teamCount: 6,
    mapPool: ["Ascent", "Breeze", "Fracture", "Haven", "Lotus", "Pearl", "Split"],
    teamNames: {
      unicamp_tritons_black: "Unicamp Tritons",
    },
    teams: ["axis_ego", "poli_plague", "totale_umc", "unicamp_tritons_black", "caap_hellhounds", "pucc_cardinals"],
    placements: [
      { range: "1", id: "pucc_cardinals", note: "Campe\u00e3o" },
      { range: "2", id: "caap_hellhounds", note: "Vice" },
      { range: "3", id: "axis_ego", note: "3\u00ba lugar" },
      { range: "4", id: "unicamp_tritons_black", note: "4\u00ba lugar" },
      { range: "5-6", id: "totale_umc", note: "5-6" },
      { range: "5-6", id: "poli_plague", note: "5-6" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Todos os jogos MD3", "Partidas com BYE avan\u00e7am automaticamente"],
      standings: "Classifica\u00e7\u00e3o oficial do campeonato",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Grande final",
          className: "grand-final",
          columns: [
            {
              title: "Grande final",
              matches: [
                { code: "Partida Final", bestOf: "MD3", a: "caap_hellhounds", scoreA: 0, b: "pucc_cardinals", scoreB: 2, winner: "pucc_cardinals" },
              ],
            },
          ],
        },
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Partidas UB 1-4",
              matches: [
                { code: "Partida UB 1", a: "axis_ego", scoreA: 1, bLabel: "Bye", scoreB: 0, winner: "axis_ego" },
                { code: "Partida UB 2", bestOf: "MD3", a: "poli_plague", scoreA: 0, b: "totale_umc", scoreB: 2, winner: "totale_umc" },
                { code: "Partida UB 3", a: "unicamp_tritons_black", scoreA: 1, bLabel: "Bye", scoreB: 0, winner: "unicamp_tritons_black" },
                { code: "Partida UB 4", bestOf: "MD3", a: "caap_hellhounds", scoreA: 1, b: "pucc_cardinals", scoreB: 2, winner: "pucc_cardinals" },
              ],
            },
            {
              title: "Partidas UB 5-6",
              matches: [
                { code: "Partida UB 5", bestOf: "MD3", a: "axis_ego", scoreA: 2, b: "totale_umc", scoreB: 0, winner: "axis_ego" },
                { code: "Partida UB 6", bestOf: "MD3", a: "unicamp_tritons_black", scoreA: 0, b: "pucc_cardinals", scoreB: 2, winner: "pucc_cardinals" },
              ],
            },
            {
              title: "Final superior",
              matches: [
                { code: "Partida UB 7", bestOf: "MD3", a: "axis_ego", scoreA: 1, b: "pucc_cardinals", scoreB: 2, winner: "pucc_cardinals" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Jogos LB 1-2",
              matches: [
                { code: "Jogo LB 1", aLabel: "Bye", scoreA: 0, b: "poli_plague", scoreB: 1, winner: "poli_plague" },
                { code: "Jogo LB 2", aLabel: "Bye", scoreA: 0, b: "caap_hellhounds", scoreB: 1, winner: "caap_hellhounds" },
              ],
            },
            {
              title: "Jogos LB 3-4",
              matches: [
                { code: "Jogo LB 3", bestOf: "MD3", a: "unicamp_tritons_black", scoreA: 2, b: "poli_plague", scoreB: 0, winner: "unicamp_tritons_black" },
                { code: "Jogo LB 4", bestOf: "MD3", a: "totale_umc", scoreA: 0, b: "caap_hellhounds", scoreB: 2, winner: "caap_hellhounds" },
              ],
            },
            {
              title: "Jogo LB 5",
              matches: [
                { code: "Jogo LB 5", bestOf: "MD3", a: "unicamp_tritons_black", scoreA: 0, b: "caap_hellhounds", scoreB: 2, winner: "caap_hellhounds" },
              ],
            },
            {
              title: "Jogo LB 6",
              matches: [
                { code: "Jogo LB 6", bestOf: "MD3", a: "axis_ego", scoreA: 0, b: "caap_hellhounds", scoreB: 2, winner: "caap_hellhounds" },
              ],
            },
          ],
        },
      ],
    },
  },
  rivvalsgg: {
    organizerLogo: "assets/organizers-logos/logo_rivvalsGG.jpg",
    banner: "assets/tournament-banners/banner_rivalsGG.jpg",
    prizePool: "-",
    tier: "B",
    type: "Online + Final presencial",
    format: {
      summary: "Elimina\u00e7\u00e3o simples",
      details: ["Todos os jogos MD3"],
    },
  },
  "rush-series-esquenta": {
    organizer: "AcadArena",
    organizerLogo: "assets/organizers-logos/logo_AcadArena.png",
    banner: "assets/tournament-banners/banner_rushseries.webp",
    prizePool: "R$1.000",
    tier: "A",
    type: "Online",
    teamCount: 16,
    mapPool: ["Ascent", "Pearl", "Haven", "Lotus", "Split"],
    teams: [
      "ufpr_bbn",
      "fei_darkowls",
      "azure_bears_black",
      "ufmt_turuna",
      "ufu_saints_auryn",
      "a2e_uff",
      "azure_bears_golden",
      "inatel_legacy",
      "unicamp_tritons_black",
      "uscs_hawks",
      "ime_wolves_red",
      "fei_whiteowls",
      "octacore_javascript",
      "ceub_octopus_vulgaris",
      "caap_auroras",
      "tigre_branco",
    ],
    placements: [
      { range: "1", id: "azure_bears_golden" },
      { range: "2", id: "ceub_octopus_vulgaris" },
      { range: "3", id: "ufmt_turuna" },
      { range: "4", id: "fei_darkowls" },
      { range: "5-6", id: "ufpr_bbn" },
      { range: "5-6", id: "uscs_hawks" },
      { range: "7-8", id: "fei_whiteowls" },
      { range: "7-8", id: "a2e_uff" },
      { range: "9-12", id: "tigre_branco" },
      { range: "9-12", id: "inatel_legacy" },
      { range: "9-12", id: "unicamp_tritons_black" },
      { range: "9-12", id: "octacore_javascript" },
      { range: "13-16", id: "azure_bears_black" },
      { range: "13-16", id: "ufu_saints_auryn" },
      { range: "13-16", id: "ime_wolves_red" },
      { range: "13-16", id: "caap_auroras" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Todos os jogos MD1", "Grande final MD3"],
      standings: "Coloca\u00e7\u00e3o oficial do campeonato",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Grande final",
          className: "grand-final",
          columns: [
            {
              title: "Grande final",
              matches: [
                { code: "Partida 30", bestOf: "MD3", a: "azure_bears_golden", scoreA: 2, b: "ceub_octopus_vulgaris", scoreB: 0, winner: "azure_bears_golden" },
              ],
            },
          ],
        },
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Rodada de 16 superior",
              matches: [
                { code: "Partida 1", a: "ufpr_bbn", scoreA: 0, b: "fei_darkowls", scoreB: 1, winner: "fei_darkowls" },
                { code: "Partida 2", a: "azure_bears_black", scoreA: 6, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
                { code: "Partida 3", a: "ufu_saints_auryn", scoreA: 0, b: "a2e_uff", scoreB: 13, winner: "a2e_uff" },
                { code: "Partida 4", a: "azure_bears_golden", scoreA: 13, b: "inatel_legacy", scoreB: 0, winner: "azure_bears_golden" },
                { code: "Partida 5", a: "unicamp_tritons_black", scoreA: 7, b: "uscs_hawks", scoreB: 13, winner: "uscs_hawks" },
                { code: "Partida 6", a: "ime_wolves_red", scoreA: 2, b: "fei_whiteowls", scoreB: 13, winner: "fei_whiteowls" },
                { code: "Partida 7", a: "octacore_javascript", scoreA: 7, b: "ceub_octopus_vulgaris", scoreB: 13, winner: "ceub_octopus_vulgaris" },
                { code: "Partida 8", a: "caap_auroras", scoreA: 14, b: "tigre_branco", scoreB: 16, winner: "tigre_branco" },
              ],
            },
            {
              title: "Quartas de final superior",
              matches: [
                { code: "Partida 9", a: "fei_darkowls", scoreA: 5, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
                { code: "Partida 10", a: "a2e_uff", scoreA: 8, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 11", a: "uscs_hawks", scoreA: 13, b: "fei_whiteowls", scoreB: 6, winner: "uscs_hawks" },
                { code: "Partida 12", a: "ceub_octopus_vulgaris", scoreA: 13, b: "tigre_branco", scoreB: 7, winner: "ceub_octopus_vulgaris" },
              ],
            },
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 13", a: "ufmt_turuna", scoreA: 6, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 14", a: "uscs_hawks", scoreA: 9, b: "ceub_octopus_vulgaris", scoreB: 13, winner: "ceub_octopus_vulgaris" },
              ],
            },
            {
              title: "Final superior",
              matches: [
                { code: "Partida 15", a: "azure_bears_golden", scoreA: 13, b: "ceub_octopus_vulgaris", scoreB: 4, winner: "azure_bears_golden" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 16", a: "ufpr_bbn", scoreA: 13, b: "azure_bears_black", scoreB: 9, winner: "ufpr_bbn" },
                { code: "Partida 17", a: "ufu_saints_auryn", scoreA: 0, b: "inatel_legacy", scoreB: 13, winner: "inatel_legacy" },
                { code: "Partida 18", a: "unicamp_tritons_black", scoreA: 13, b: "ime_wolves_red", scoreB: 4, winner: "unicamp_tritons_black" },
                { code: "Partida 19", a: "octacore_javascript", scoreA: 1, b: "caap_auroras", scoreB: 0, winner: "octacore_javascript" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 20", a: "tigre_branco", scoreA: 11, b: "ufpr_bbn", scoreB: 13, winner: "ufpr_bbn" },
                { code: "Partida 21", a: "fei_whiteowls", scoreA: 13, b: "inatel_legacy", scoreB: 6, winner: "fei_whiteowls" },
                { code: "Partida 22", a: "a2e_uff", scoreA: 13, b: "unicamp_tritons_black", scoreB: 8, winner: "a2e_uff" },
                { code: "Partida 23", a: "fei_darkowls", scoreA: 13, b: "octacore_javascript", scoreB: 9, winner: "fei_darkowls" },
              ],
            },
            {
              title: "Rodada de 4 inferior",
              matches: [
                { code: "Partida 24", a: "ufpr_bbn", scoreA: 13, b: "fei_whiteowls", scoreB: 9, winner: "ufpr_bbn" },
                { code: "Partida 25", a: "a2e_uff", scoreA: 6, b: "fei_darkowls", scoreB: 13, winner: "fei_darkowls" },
              ],
            },
            {
              title: "Quartas de final inferior",
              matches: [
                { code: "Partida 26", a: "ufmt_turuna", scoreA: 13, b: "ufpr_bbn", scoreB: 5, winner: "ufmt_turuna" },
                { code: "Partida 27", a: "uscs_hawks", scoreA: 12, b: "fei_darkowls", scoreB: 14, winner: "fei_darkowls" },
              ],
            },
            {
              title: "Semifinal inferior",
              matches: [
                { code: "Partida 28", a: "fei_darkowls", scoreA: 5, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
              ],
            },
            {
              title: "Final inferior",
              matches: [
                { code: "Partida 29", a: "ceub_octopus_vulgaris", scoreA: 13, b: "ufmt_turuna", scoreB: 5, winner: "ceub_octopus_vulgaris" },
              ],
            },
          ],
        },
      ],
    },
  },
  "rush-series-inclusivo": {
    organizer: "AcadArena",
    organizerLogo: "assets/organizers-logos/logo_AcadArena.png",
    banner: "assets/tournament-banners/banner_rushseries_inclusivo.jpg",
    prizePool: "R$1.000",
    tier: "A",
    type: "Online",
    teamCount: 7,
    mapPool: ["Ascent", "Haven", "Lotus", "Split", "Sunset"],
    teams: [
      "azure_bears_white",
      "inatel_gray",
      "usp_stars_gc",
      "ufu_saints_auryn",
      "macklogic_rainbow",
      "pucc_canaries",
      "caap_auroras",
    ],
    placements: [
      { range: "1", id: "macklogic_rainbow" },
      { range: "2", id: "caap_auroras" },
      { range: "3", id: "azure_bears_white" },
      { range: "4", id: "ufu_saints_auryn" },
      { range: "5-6", id: "usp_stars_gc" },
      { range: "5-6", id: "inatel_gray" },
      { range: "7", id: "pucc_canaries" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Todos os jogos MD1", "Grande final MD3"],
      standings: "Coloca\u00e7\u00e3o oficial do campeonato",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Grande final",
          className: "grand-final",
          columns: [
            {
              title: "Grande final",
              matches: [
                { code: "Partida 14", bestOf: "MD3", a: "macklogic_rainbow", scoreA: 2, b: "caap_auroras", scoreB: 0, winner: "macklogic_rainbow" },
              ],
            },
          ],
        },
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Quartas de final superior",
              matches: [
                { code: "Partida 1", a: "azure_bears_white", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "azure_bears_white" },
                { code: "Partida 2", a: "inatel_gray", scoreA: 5, b: "usp_stars_gc", scoreB: 13, winner: "usp_stars_gc" },
                { code: "Partida 3", a: "ufu_saints_auryn", scoreA: 6, b: "macklogic_rainbow", scoreB: 13, winner: "macklogic_rainbow" },
                { code: "Partida 4", a: "pucc_canaries", scoreA: 8, b: "caap_auroras", scoreB: 13, winner: "caap_auroras" },
              ],
            },
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 5", a: "azure_bears_white", scoreA: 13, b: "usp_stars_gc", scoreB: 7, winner: "azure_bears_white" },
                { code: "Partida 6", a: "macklogic_rainbow", scoreA: 13, b: "caap_auroras", scoreB: 5, winner: "macklogic_rainbow" },
              ],
            },
            {
              title: "Final superior",
              matches: [
                { code: "Partida 7", a: "azure_bears_white", scoreA: 2, b: "macklogic_rainbow", scoreB: 13, winner: "macklogic_rainbow" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada de 4 inferior",
              matches: [
                { code: "Partida 8", a: "ufu_saints_auryn", scoreA: 13, b: "pucc_canaries", scoreB: 9, winner: "ufu_saints_auryn" },
                { code: "Partida 9", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "inatel_gray", scoreB: 1, winner: "inatel_gray" },
              ],
            },
            {
              title: "Quartas de final inferior",
              matches: [
                { code: "Partida 10", a: "usp_stars_gc", scoreA: 4, b: "ufu_saints_auryn", scoreB: 13, winner: "ufu_saints_auryn" },
                { code: "Partida 11", a: "caap_auroras", scoreA: 13, b: "inatel_gray", scoreB: 4, winner: "caap_auroras" },
              ],
            },
            {
              title: "Semifinal inferior",
              matches: [
                { code: "Partida 12", a: "ufu_saints_auryn", scoreA: 6, b: "caap_auroras", scoreB: 13, winner: "caap_auroras" },
              ],
            },
            {
              title: "Final inferior",
              matches: [
                { code: "Partida 13", a: "azure_bears_white", scoreA: 5, b: "caap_auroras", scoreB: 13, winner: "caap_auroras" },
              ],
            },
          ],
        },
      ],
    },
  },
  "rush-series-esquenta-2": {
    organizer: "AcadArena",
    organizerLogo: "assets/organizers-logos/logo_AcadArena.png",
    banner: "assets/tournament-banners/banner_rushseries.webp",
    logo: "assets/tournament-icons/rushSeries.png",
    prizePool: "R$1.000",
    tier: "A",
    type: "Online",
    teamCount: 14,
    mapPool: ["Ascent", "Split", "Breeze", "Haven", "Fracture", "Lotus"],
    teams: [
      "ufmt_turuna",
      "panterao_gaming",
      "fatec_pg",
      "macklogic_rainbow",
      "octacore_python",
      "inatel",
      "azure_bears_golden",
      "inatel_gray",
      "totale_umc",
      "uscs_hawks",
      "ibmec_sharks",
      "unicamp_tritons_red",
      "azure_bears_black",
      "octacore_javascript",
    ],
    placements: [
      { range: "1", id: "azure_bears_golden" },
      { range: "2", id: "ufmt_turuna" },
      { range: "3", id: "totale_umc" },
      { range: "4", id: "azure_bears_black" },
      { range: "5-6", id: "inatel" },
      { range: "5-6", id: "uscs_hawks" },
      { range: "7-8", id: "ibmec_sharks" },
      { range: "7-8", id: "unicamp_tritons_red" },
      { range: "9-12", id: "fatec_pg" },
      { range: "9-12", id: "inatel_gray" },
      { range: "9-12", id: "octacore_python" },
      { range: "9-12", id: "panterao_gaming" },
      { range: "13-14", id: "macklogic_rainbow" },
      { range: "13-14", id: "octacore_javascript" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Todos os jogos MD1", "Grande final MD3"],
      standings: "Coloca\u00e7\u00e3o oficial do campeonato",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Grande final",
          className: "grand-final",
          columns: [
            {
              title: "Grande final",
              matches: [
                { code: "Partida 30", bestOf: "MD3", a: "ufmt_turuna", scoreA: 0, b: "azure_bears_golden", scoreB: 2, winner: "azure_bears_golden" },
              ],
            },
          ],
        },
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Rodada de 16 superior",
              matches: [
                { code: "Partida 1", a: "ufmt_turuna", scoreA: 1, bLabel: "Sem adversario", scoreB: 0, winner: "ufmt_turuna" },
                { code: "Partida 2", a: "panterao_gaming", scoreA: 13, b: "fatec_pg", scoreB: 10, winner: "panterao_gaming" },
                { code: "Partida 3", a: "macklogic_rainbow", scoreA: 5, b: "octacore_python", scoreB: 13, winner: "octacore_python" },
                { code: "Partida 4", a: "inatel", scoreA: 13, b: "azure_bears_golden", scoreB: 9, winner: "inatel" },
                { code: "Partida 5", a: "inatel_gray", scoreA: 1, bLabel: "Sem adversario", scoreB: 0, winner: "inatel_gray" },
                { code: "Partida 6", a: "totale_umc", scoreA: 13, b: "uscs_hawks", scoreB: 7, winner: "totale_umc" },
                { code: "Partida 7", a: "ibmec_sharks", scoreA: 13, b: "unicamp_tritons_red", scoreB: 5, winner: "ibmec_sharks" },
                { code: "Partida 8", a: "azure_bears_black", scoreA: 13, b: "octacore_javascript", scoreB: 6, winner: "azure_bears_black" },
              ],
            },
            {
              title: "Quartas de final superior",
              matches: [
                { code: "Partida 9", a: "ufmt_turuna", scoreA: 13, b: "panterao_gaming", scoreB: 5, winner: "ufmt_turuna" },
                { code: "Partida 10", a: "octacore_python", scoreA: 6, b: "inatel", scoreB: 13, winner: "inatel" },
                { code: "Partida 11", a: "inatel_gray", scoreA: 1, b: "totale_umc", scoreB: 13, winner: "totale_umc" },
                { code: "Partida 12", a: "ibmec_sharks", scoreA: 9, b: "azure_bears_black", scoreB: 13, winner: "azure_bears_black" },
              ],
            },
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 13", a: "ufmt_turuna", scoreA: 13, b: "inatel", scoreB: 7, winner: "ufmt_turuna" },
                { code: "Partida 14", a: "totale_umc", scoreA: 13, b: "azure_bears_black", scoreB: 7, winner: "totale_umc" },
              ],
            },
            {
              title: "Final superior",
              matches: [
                { code: "Partida 15", a: "ufmt_turuna", scoreA: 14, b: "totale_umc", scoreB: 12, winner: "ufmt_turuna" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 16", aLabel: "Sem adversario", scoreA: 0, b: "fatec_pg", scoreB: 1, winner: "fatec_pg" },
                { code: "Partida 17", a: "macklogic_rainbow", scoreA: 2, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 18", aLabel: "Sem adversario", scoreA: 0, b: "uscs_hawks", scoreB: 1, winner: "uscs_hawks" },
                { code: "Partida 19", a: "unicamp_tritons_red", scoreA: 13, b: "octacore_javascript", scoreB: 9, winner: "unicamp_tritons_red" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 20", a: "ibmec_sharks", scoreA: 13, b: "fatec_pg", scoreB: 4, winner: "ibmec_sharks" },
                { code: "Partida 21", a: "inatel_gray", scoreA: 1, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 22", a: "octacore_python", scoreA: 3, b: "uscs_hawks", scoreB: 13, winner: "uscs_hawks" },
                { code: "Partida 23", a: "panterao_gaming", scoreA: 0, b: "unicamp_tritons_red", scoreB: 1, winner: "unicamp_tritons_red" },
              ],
            },
            {
              title: "Rodada de 4 inferior",
              matches: [
                { code: "Partida 24", a: "ibmec_sharks", scoreA: 6, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 25", a: "uscs_hawks", scoreA: 14, b: "unicamp_tritons_red", scoreB: 12, winner: "uscs_hawks" },
              ],
            },
            {
              title: "Quartas de final inferior",
              matches: [
                { code: "Partida 26", a: "inatel", scoreA: 3, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 27", a: "azure_bears_black", scoreA: 13, b: "uscs_hawks", scoreB: 8, winner: "azure_bears_black" },
              ],
            },
            {
              title: "Semifinal inferior",
              matches: [
                { code: "Partida 28", a: "azure_bears_golden", scoreA: 13, b: "azure_bears_black", scoreB: 5, winner: "azure_bears_golden" },
              ],
            },
            {
              title: "Final inferior",
              matches: [
                { code: "Partida 29", a: "totale_umc", scoreA: 5, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
              ],
            },
          ],
        },
      ],
    },
  },
  "totale-inters": {
    name: "TOTALE Inters",
    organizer: "TOTALE",
    organizerLogo: "assets/team-logos/totale_umc.png",
    logo: "assets/team-logos/totale_umc.png",
    prizePool: "-",
    tier: "B",
    type: "Online - Inters",
    status: "Finalizado",
    startAt: "2026-06-29T00:00:00",
    endAt: "2026-07-18T23:00:00",
    teamCount: 10,
    format: {
      summary: "Grupos + Playoffs",
      details: [
        "2 grupos de 5 equipes em turno único, jogos MD1",
        "Top 2 de cada grupo avança aos playoffs",
        "Playoffs em eliminação dupla MD1",
        "Grande final MD3",
      ],
      standings: "Classificação da fase de grupos",
    },
    teams: [
      "fei_darkowls",
      "caap_momentum",
      "fei_whiteowls",
      "pucc_cardinals",
      "totale_umc",
      "ufu_saints",
      "caap_hellhounds",
      "macklogic_red",
      "axis_anteaters",
      "wolf_gaming",
    ],
    placements: [
      { range: "1", id: "caap_momentum" },
      { range: "2", id: "axis_anteaters" },
      { range: "3", id: "caap_hellhounds" },
      { range: "4", id: "fei_darkowls" },
      { range: "5-6", id: "fei_whiteowls", note: "1-3", reason: "3º do Grupo A" },
      { range: "5-6", id: "ufu_saints", note: "2-2", reason: "3º do Grupo B" },
      { range: "7-8", id: "totale_umc", note: "1-3", reason: "4º do Grupo A" },
      { range: "7-8", id: "macklogic_red", note: "2-2", reason: "4º do Grupo B" },
      { range: "9-10", id: "pucc_cardinals", note: "1-3", reason: "5º do Grupo A" },
      { range: "9-10", id: "wolf_gaming", note: "0-4", reason: "5º do Grupo B" },
    ],
    bracket: {
      title: "Grupos + Playoffs",
      regions: [
        {
          name: "Grande final",
          className: "grand-final",
          columns: [
            {
              title: "Grande final",
              matches: [
                { code: "Partida 26", bestOf: "MD3", a: "axis_anteaters", scoreA: 1, b: "caap_momentum", scoreB: 2, winner: "caap_momentum" },
              ],
            },
          ],
        },
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 21", a: "axis_anteaters", scoreA: 16, b: "fei_darkowls", scoreB: 14, winner: "axis_anteaters" },
                { code: "Partida 22", a: "caap_hellhounds", scoreA: 9, b: "caap_momentum", scoreB: 13, winner: "caap_momentum" },
              ],
            },
            {
              title: "Final superior",
              matches: [
                { code: "Partida 23", a: "axis_anteaters", scoreA: 7, b: "caap_momentum", scoreB: 13, winner: "caap_momentum" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada 1 inferior",
              matches: [
                { code: "Partida 24", a: "caap_hellhounds", scoreA: 13, b: "fei_darkowls", scoreB: 5, winner: "caap_hellhounds" },
              ],
            },
            {
              title: "Final inferior",
              matches: [
                { code: "Partida 25", a: "axis_anteaters", scoreA: 13, b: "caap_hellhounds", scoreB: 9, winner: "axis_anteaters" },
              ],
            },
          ],
        },
        {
          name: "Grupo A",
          className: "group-stage",
          columns: [
            {
              title: "Confrontos",
              matches: [
                { code: "Partida 1", a: "totale_umc", scoreA: 1, b: "fei_whiteowls", scoreB: 0, winner: "totale_umc", status: "W.O." },
                { code: "Partida 3", a: "caap_momentum", scoreA: 13, b: "pucc_cardinals", scoreB: 7, winner: "caap_momentum" },
                { code: "Partida 5", a: "fei_whiteowls", scoreA: 13, b: "pucc_cardinals", scoreB: 11, winner: "fei_whiteowls" },
                { code: "Partida 7", a: "fei_darkowls", scoreA: 14, b: "caap_momentum", scoreB: 12, winner: "fei_darkowls" },
                { code: "Partida 9", a: "fei_darkowls", scoreA: 1, b: "pucc_cardinals", scoreB: 0, winner: "fei_darkowls", status: "W.O." },
                { code: "Partida 11", a: "caap_momentum", scoreA: 13, b: "totale_umc", scoreB: 11, winner: "caap_momentum" },
                { code: "Partida 13", a: "fei_darkowls", scoreA: 1, b: "fei_whiteowls", scoreB: 0, winner: "fei_darkowls", status: "W.O." },
                { code: "Partida 15", a: "pucc_cardinals", scoreA: 14, b: "totale_umc", scoreB: 12, winner: "pucc_cardinals" },
                { code: "Partida 17", a: "caap_momentum", scoreA: 1, b: "fei_whiteowls", scoreB: 0, winner: "caap_momentum", status: "W.O." },
                { code: "Partida 19", a: "fei_darkowls", scoreA: 13, b: "totale_umc", scoreB: 6, winner: "fei_darkowls" },
              ],
            },
          ],
        },
        {
          name: "Grupo B",
          className: "group-stage",
          columns: [
            {
              title: "Confrontos",
              matches: [
                { code: "Partida 2", a: "axis_anteaters", scoreA: 13, b: "macklogic_red", scoreB: 11, winner: "axis_anteaters" },
                { code: "Partida 4", a: "ufu_saints", scoreA: 13, b: "wolf_gaming", scoreB: 7, winner: "ufu_saints" },
                { code: "Partida 6", a: "wolf_gaming", scoreA: 0, b: "macklogic_red", scoreB: 1, winner: "macklogic_red", status: "W.O." },
                { code: "Partida 8", a: "ufu_saints", scoreA: 13, b: "caap_hellhounds", scoreB: 8, winner: "ufu_saints" },
                { code: "Partida 10", a: "caap_hellhounds", scoreA: 13, b: "wolf_gaming", scoreB: 7, winner: "caap_hellhounds" },
                { code: "Partida 12", a: "ufu_saints", scoreA: 0, b: "axis_anteaters", scoreB: 1, winner: "axis_anteaters", status: "W.O." },
                { code: "Partida 14", a: "caap_hellhounds", scoreA: 1, b: "macklogic_red", scoreB: 0, winner: "caap_hellhounds", status: "W.O." },
                { code: "Partida 16", a: "axis_anteaters", scoreA: 1, b: "wolf_gaming", scoreB: 0, winner: "axis_anteaters", status: "W.O." },
                { code: "Partida 18", a: "macklogic_red", scoreA: 13, b: "ufu_saints", scoreB: 7, winner: "macklogic_red" },
                { code: "Partida 20", a: "caap_hellhounds", scoreA: 13, b: "axis_anteaters", scoreB: 7, winner: "caap_hellhounds" },
              ],
            },
          ],
        },
      ],
    },
    swiss: {
      seriesCount: 26,
      standingsLabel: "Classificação final da fase de grupos",
      groups: [
        {
          title: "Grupo A",
          standings: [
            { id: "fei_darkowls", wins: 4, losses: 0 },
            { id: "caap_momentum", wins: 3, losses: 1 },
            { id: "fei_whiteowls", wins: 1, losses: 3 },
            { id: "totale_umc", wins: 1, losses: 3 },
            { id: "pucc_cardinals", wins: 1, losses: 3 },
          ],
        },
        {
          title: "Grupo B",
          standings: [
            { id: "caap_hellhounds", wins: 3, losses: 1 },
            { id: "axis_anteaters", wins: 3, losses: 1 },
            { id: "ufu_saints", wins: 2, losses: 2 },
            { id: "macklogic_red", wins: 2, losses: 2 },
            { id: "wolf_gaming", wins: 0, losses: 4 },
          ],
        },
      ],
    },
  },
  "univava-classificatoria-3": {
    name: "UNIVAV\u00c1 - Classificat\u00f3ria 3",
    organizer: "AcadArena",
    organizerLogo: "assets/organizers-logos/logo_AcadArena.png",
    banner: "assets/tournament-banners/banner_univava_c3.jpg",
    logo: "assets/tournament-icons/UNIVAVA.png",
    prizePool: "-",
    tier: "A",
    type: "Online - Classificat\u00f3ria",
    status: "Finalizado",
    teamCount: 26,
    mapPool: ["Ascent", "Haven", "Lotus", "Split", "Summit", "Sunset"],
    teams: [
      "pucgo_sistematica_academy",
      "liga_vulkanica",
      "poli_plague",
      "inatel_dois",
      "a2e_uff",
      "green_owls_noctua",
      "unifesp_erex",
      "ufscar_fire",
      "inatel",
      "ufpr_bbn",
      "inatel_legacy",
      "pucgo_sistematica",
      "totale_umc",
      "ufmg_fenix_b",
      "azure_bears_silver",
      "caap_malditos",
      "ceub_octopus_vulgaris",
      "unicamp_tritons_black",
      "ufg_eagles_blue",
      "furia_utfpr",
      "minerva_thunders",
      "uscs_hawks",
      "azure_bears_black",
      "fei_darkowls",
      "maua_blue",
      "fei_whiteowls",
    ],
    placements: [
      { range: "Classificado", id: "minerva_thunders", note: "Chave superior" },
      { range: "Classificado", id: "green_owls_noctua", note: "Chave superior" },
      { range: "Classificado", id: "totale_umc", note: "Chave inferior" },
      { range: "Classificado", id: "furia_utfpr", note: "Chave inferior" },
      { range: "5-6", id: "inatel_legacy", note: "Decis\u00e3o de vaga inferior" },
      { range: "5-6", id: "caap_malditos", note: "Decis\u00e3o de vaga inferior" },
      { range: "7-8", id: "maua_blue", note: "Rodada de 4 inferior" },
      { range: "7-8", id: "fei_darkowls", note: "Rodada de 4 inferior" },
      { range: "9-12", id: "uscs_hawks", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "ceub_octopus_vulgaris", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "inatel", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "poli_plague", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "pucgo_sistematica_academy", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "unicamp_tritons_black", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "pucgo_sistematica", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "azure_bears_black", note: "Rodada de 8 inferior" },
      { range: "17-24", id: "fei_whiteowls", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "inatel_dois", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "ufscar_fire", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "azure_bears_silver", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "ufmg_fenix_b", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "ufpr_bbn", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "a2e_uff", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "liga_vulkanica", note: "Rodada de 16 inferior" },
      { range: "25-26", id: "ufg_eagles_blue", note: "Primeira rodada inferior" },
      { range: "25-26", id: "unifesp_erex", note: "Primeira rodada inferior" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Classificat\u00f3ria com 4 vagas", "2 vagas pela chave superior", "2 vagas pela chave inferior", "Jogos MD1"],
      standings: "Classificados oficiais",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Rodada de 32 superior",
              matches: [
                { code: "Partida 1", a: "pucgo_sistematica_academy", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "pucgo_sistematica_academy" },
                { code: "Partida 2", a: "liga_vulkanica", scoreA: 8, b: "poli_plague", scoreB: 13, winner: "poli_plague" },
                { code: "Partida 3", a: "inatel_dois", scoreA: 13, b: "a2e_uff", scoreB: 2, winner: "inatel_dois" },
                { code: "Partida 4", a: "green_owls_noctua", scoreA: 13, b: "unifesp_erex", scoreB: 6, winner: "green_owls_noctua" },
                { code: "Partida 5", a: "ufscar_fire", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "ufscar_fire" },
                { code: "Partida 6", a: "inatel", scoreA: 13, b: "ufpr_bbn", scoreB: 6, winner: "inatel" },
                { code: "Partida 7", a: "inatel_legacy", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "inatel_legacy" },
                { code: "Partida 8", a: "pucgo_sistematica", scoreA: 5, b: "totale_umc", scoreB: 13, winner: "totale_umc" },
                { code: "Partida 9", a: "ufmg_fenix_b", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "ufmg_fenix_b" },
                { code: "Partida 10", a: "azure_bears_silver", scoreA: 11, b: "caap_malditos", scoreB: 13, winner: "caap_malditos" },
                { code: "Partida 11", a: "ceub_octopus_vulgaris", scoreA: 13, b: "unicamp_tritons_black", scoreB: 7, winner: "ceub_octopus_vulgaris" },
                { code: "Partida 12", a: "ufg_eagles_blue", scoreA: 7, b: "furia_utfpr", scoreB: 13, winner: "furia_utfpr" },
                { code: "Partida 13", a: "minerva_thunders", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "minerva_thunders" },
                { code: "Partida 14", a: "uscs_hawks", scoreA: 6, b: "azure_bears_black", scoreB: 13, winner: "azure_bears_black" },
                { code: "Partida 15", a: "fei_darkowls", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "fei_darkowls" },
                { code: "Partida 16", a: "maua_blue", scoreA: 13, b: "fei_whiteowls", scoreB: 1, winner: "maua_blue" },
              ],
            },
            {
              title: "Rodada de 16 superior",
              matches: [
                { code: "Partida 17", a: "pucgo_sistematica_academy", scoreA: 11, b: "poli_plague", scoreB: 13, winner: "poli_plague" },
                { code: "Partida 18", a: "inatel_dois", scoreA: 4, b: "green_owls_noctua", scoreB: 13, winner: "green_owls_noctua" },
                { code: "Partida 19", a: "ufscar_fire", scoreA: 0, b: "inatel", scoreB: 1, winner: "inatel", status: "W.O." },
                { code: "Partida 20", a: "inatel_legacy", scoreA: 7, b: "totale_umc", scoreB: 13, winner: "totale_umc" },
                { code: "Partida 21", a: "ufmg_fenix_b", scoreA: 6, b: "caap_malditos", scoreB: 13, winner: "caap_malditos" },
                { code: "Partida 22", a: "ceub_octopus_vulgaris", scoreA: 13, b: "furia_utfpr", scoreB: 5, winner: "ceub_octopus_vulgaris" },
                { code: "Partida 23", a: "minerva_thunders", scoreA: 13, b: "azure_bears_black", scoreB: 6, winner: "minerva_thunders" },
                { code: "Partida 24", a: "fei_darkowls", scoreA: 10, b: "maua_blue", scoreB: 13, winner: "maua_blue" },
              ],
            },
            {
              title: "Quartas de final superior",
              matches: [
                { code: "Partida 25", a: "poli_plague", scoreA: 6, b: "green_owls_noctua", scoreB: 13, winner: "green_owls_noctua" },
                { code: "Partida 26", a: "inatel", scoreA: 11, b: "totale_umc", scoreB: 13, winner: "totale_umc" },
                { code: "Partida 27", a: "caap_malditos", scoreA: 13, b: "ceub_octopus_vulgaris", scoreB: 11, winner: "caap_malditos" },
                { code: "Partida 28", a: "minerva_thunders", scoreA: 13, b: "maua_blue", scoreB: 5, winner: "minerva_thunders" },
              ],
            },
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 29", a: "green_owls_noctua", scoreA: 13, b: "totale_umc", scoreB: 11, winner: "green_owls_noctua" },
                { code: "Partida 30", a: "caap_malditos", scoreA: 6, b: "minerva_thunders", scoreB: 13, winner: "minerva_thunders" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada de 16 inferior",
              matches: [
                { code: "Partida 32", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "fei_whiteowls", scoreB: 1, winner: "fei_whiteowls" },
                { code: "Partida 33", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "uscs_hawks", scoreB: 1, winner: "uscs_hawks" },
                { code: "Partida 34", a: "unicamp_tritons_black", scoreA: 13, b: "ufg_eagles_blue", scoreB: 3, winner: "unicamp_tritons_black" },
                { code: "Partida 35", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "azure_bears_silver", scoreB: 1, winner: "azure_bears_silver" },
                { code: "Partida 36", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "pucgo_sistematica", scoreB: 1, winner: "pucgo_sistematica" },
                { code: "Partida 37", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "ufpr_bbn", scoreB: 1, winner: "ufpr_bbn" },
                { code: "Partida 38", a: "a2e_uff", scoreA: 14, b: "unifesp_erex", scoreB: 12, winner: "a2e_uff" },
                { code: "Partida 39", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "liga_vulkanica", scoreB: 1, winner: "liga_vulkanica" },
              ],
            },
            {
              title: "Rodada de 16 inferior",
              matches: [
                { code: "Partida 40", a: "pucgo_sistematica_academy", scoreA: 13, b: "fei_whiteowls", scoreB: 9, winner: "pucgo_sistematica_academy" },
                { code: "Partida 41", a: "inatel_dois", scoreA: 15, b: "uscs_hawks", scoreB: 17, winner: "uscs_hawks" },
                { code: "Partida 42", a: "ufscar_fire", scoreA: 0, b: "unicamp_tritons_black", scoreB: 1, winner: "unicamp_tritons_black", status: "W.O." },
                { code: "Partida 43", a: "inatel_legacy", scoreA: 13, b: "azure_bears_silver", scoreB: 7, winner: "inatel_legacy" },
                { code: "Partida 44", a: "ufmg_fenix_b", scoreA: 7, b: "pucgo_sistematica", scoreB: 13, winner: "pucgo_sistematica" },
                { code: "Partida 45", a: "furia_utfpr", scoreA: 13, b: "ufpr_bbn", scoreB: 8, winner: "furia_utfpr" },
                { code: "Partida 46", a: "azure_bears_black", scoreA: 13, b: "a2e_uff", scoreB: 8, winner: "azure_bears_black" },
                { code: "Partida 47", a: "fei_darkowls", scoreA: 13, b: "liga_vulkanica", scoreB: 5, winner: "fei_darkowls" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 48", a: "pucgo_sistematica_academy", scoreA: 10, b: "uscs_hawks", scoreB: 13, winner: "uscs_hawks" },
                { code: "Partida 49", a: "unicamp_tritons_black", scoreA: 5, b: "inatel_legacy", scoreB: 13, winner: "inatel_legacy" },
                { code: "Partida 50", a: "pucgo_sistematica", scoreA: 11, b: "furia_utfpr", scoreB: 13, winner: "furia_utfpr" },
                { code: "Partida 51", a: "azure_bears_black", scoreA: 5, b: "fei_darkowls", scoreB: 13, winner: "fei_darkowls" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 52", a: "maua_blue", scoreA: 13, b: "uscs_hawks", scoreB: 11, winner: "maua_blue" },
                { code: "Partida 53", a: "ceub_octopus_vulgaris", scoreA: 3, b: "inatel_legacy", scoreB: 13, winner: "inatel_legacy" },
                { code: "Partida 54", a: "inatel", scoreA: 11, b: "furia_utfpr", scoreB: 13, winner: "furia_utfpr" },
                { code: "Partida 55", a: "poli_plague", scoreA: 0, b: "fei_darkowls", scoreB: 1, winner: "fei_darkowls", status: "W.O." },
              ],
            },
            {
              title: "Rodada de 4 inferior",
              matches: [
                { code: "Partida 56", a: "maua_blue", scoreA: 10, b: "inatel_legacy", scoreB: 13, winner: "inatel_legacy" },
                { code: "Partida 57", a: "furia_utfpr", scoreA: 13, b: "fei_darkowls", scoreB: 11, winner: "furia_utfpr" },
              ],
            },
            {
              title: "Quartas de final inferior",
              matches: [
                { code: "Partida 58", a: "totale_umc", scoreA: 14, b: "inatel_legacy", scoreB: 12, winner: "totale_umc" },
                { code: "Partida 59", a: "caap_malditos", scoreA: 9, b: "furia_utfpr", scoreB: 13, winner: "furia_utfpr" },
              ],
            },
          ],
        },
      ],
    },
  },
  "univava-classificatoria-2": {
    name: "UNIVAV\u00c1 - Classificat\u00f3ria 2",
    organizer: "AcadArena",
    organizerLogo: "assets/organizers-logos/logo_AcadArena.png",
    banner: "assets/tournament-banners/banner_univava_c2.webp",
    logo: "assets/tournament-icons/UNIVAVA.png",
    prizePool: "-",
    tier: "A",
    type: "Online - Classificat\u00f3ria",
    status: "Finalizado",
    teamCount: 25,
    mapPool: ["Ascent", "Breeze", "Haven", "Lotus", "Split", "Sunset"],
    teams: [
      "inatel_dois",
      "poli_plague",
      "caap_momentum",
      "pucc_cardinals",
      "caap_auroras",
      "octacore_python",
      "inatel_gray",
      "fei_darkowls",
      "caap_hellhounds",
      "liga_vulkanica",
      "inatel",
      "uscs_hawks",
      "ime_wolves_red",
      "ceub_octopus_vulgaris",
      "inatel_legacy",
      "axis_anteaters",
      "maua_blue",
      "unicamp_tritons_black",
      "ufmt_turuna",
      "green_owls_noctua",
      "rahnag",
      "ufu_saints",
      "ufpr_bbn",
      "a2e_uff",
      "azure_bears_black",
    ],
    placements: [
      { range: "Classificado", id: "caap_hellhounds", note: "Chave superior" },
      { range: "Classificado", id: "ufu_saints", note: "Chave superior" },
      { range: "Classificado", id: "ufmt_turuna", note: "Chave inferior" },
      { range: "Classificado", id: "axis_anteaters", note: "Chave inferior" },
      { range: "5-6", id: "pucc_cardinals", note: "Decis\u00e3o de vaga inferior" },
      { range: "5-6", id: "uscs_hawks", note: "Decis\u00e3o de vaga inferior" },
      { range: "7-8", id: "octacore_python", note: "Rodada de 4 inferior" },
      { range: "7-8", id: "ufpr_bbn", note: "Rodada de 4 inferior" },
      { range: "9-12", id: "a2e_uff", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "inatel_legacy", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "maua_blue", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "caap_momentum", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "azure_bears_black", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "fei_darkowls", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "ceub_octopus_vulgaris", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "green_owls_noctua", note: "Rodada de 8 inferior" },
      { range: "17-24", id: "inatel_dois", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "rahnag", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "unicamp_tritons_black", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "inatel", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "ime_wolves_red", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "liga_vulkanica", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "caap_auroras", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "poli_plague", note: "Rodada de 16 inferior" },
      { range: "25", id: "inatel_gray", note: "Primeira rodada inferior" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Classificat\u00f3ria com 4 vagas", "2 vagas pela chave superior", "2 vagas pela chave inferior", "Jogos MD1"],
      standings: "Classificados oficiais",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Rodada de 32 superior",
              matches: [
                { code: "Partida 1", a: "inatel_dois", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "inatel_dois" },
                { code: "Partida 2", a: "poli_plague", scoreA: 2, b: "caap_momentum", scoreB: 13, winner: "caap_momentum" },
                { code: "Partida 3", a: "pucc_cardinals", scoreA: 13, b: "caap_auroras", scoreB: 4, winner: "pucc_cardinals" },
                { code: "Partida 4", a: "octacore_python", scoreA: 13, b: "inatel_gray", scoreB: 2, winner: "octacore_python" },
                { code: "Partida 5", a: "fei_darkowls", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "fei_darkowls" },
                { code: "Partida 6", a: "caap_hellhounds", scoreA: 13, b: "liga_vulkanica", scoreB: 0, winner: "caap_hellhounds" },
                { code: "Partida 7", a: "inatel", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "inatel" },
                { code: "Partida 8", a: "uscs_hawks", scoreA: 13, b: "ime_wolves_red", scoreB: 3, winner: "uscs_hawks" },
                { code: "Partida 9", a: "ceub_octopus_vulgaris", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "ceub_octopus_vulgaris" },
                { code: "Partida 10", a: "inatel_legacy", scoreA: 6, b: "axis_anteaters", scoreB: 13, winner: "axis_anteaters" },
                { code: "Partida 11", a: "maua_blue", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "maua_blue" },
                { code: "Partida 12", a: "unicamp_tritons_black", scoreA: 8, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
                { code: "Partida 13", a: "green_owls_noctua", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "green_owls_noctua" },
                { code: "Partida 14", a: "rahnag", scoreA: 3, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
                { code: "Partida 15", a: "ufpr_bbn", scoreA: 1, bLabel: "Sem advers\u00e1rio", scoreB: 0, winner: "ufpr_bbn" },
                { code: "Partida 16", a: "a2e_uff", scoreA: 13, b: "azure_bears_black", scoreB: 6, winner: "a2e_uff" },
              ],
            },
            {
              title: "Rodada de 16 superior",
              matches: [
                { code: "Partida 17", a: "inatel_dois", scoreA: 1, b: "caap_momentum", scoreB: 13, winner: "caap_momentum" },
                { code: "Partida 18", a: "pucc_cardinals", scoreA: 13, b: "octacore_python", scoreB: 9, winner: "pucc_cardinals" },
                { code: "Partida 19", a: "fei_darkowls", scoreA: 5, b: "caap_hellhounds", scoreB: 13, winner: "caap_hellhounds" },
                { code: "Partida 20", a: "inatel", scoreA: 0, b: "uscs_hawks", scoreB: 1, winner: "uscs_hawks", status: "W.O." },
                { code: "Partida 21", a: "ceub_octopus_vulgaris", scoreA: 8, b: "axis_anteaters", scoreB: 13, winner: "axis_anteaters" },
                { code: "Partida 22", a: "maua_blue", scoreA: 5, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
                { code: "Partida 23", a: "green_owls_noctua", scoreA: 8, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
                { code: "Partida 24", a: "ufpr_bbn", scoreA: 10, b: "a2e_uff", scoreB: 13, winner: "a2e_uff" },
              ],
            },
            {
              title: "Quartas de final superior",
              matches: [
                { code: "Partida 25", a: "caap_momentum", scoreA: 6, b: "pucc_cardinals", scoreB: 13, winner: "pucc_cardinals" },
                { code: "Partida 26", a: "caap_hellhounds", scoreA: 13, b: "uscs_hawks", scoreB: 6, winner: "caap_hellhounds" },
                { code: "Partida 27", a: "axis_anteaters", scoreA: 13, b: "ufmt_turuna", scoreB: 0, winner: "axis_anteaters" },
                { code: "Partida 28", a: "ufu_saints", scoreA: 13, b: "a2e_uff", scoreB: 6, winner: "ufu_saints" },
              ],
            },
            {
              title: "Semifinais superiores",
              matches: [
                { code: "Partida 29", a: "pucc_cardinals", scoreA: 7, b: "caap_hellhounds", scoreB: 13, winner: "caap_hellhounds" },
                { code: "Partida 30", a: "axis_anteaters", scoreA: 2, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada de 16 inferior",
              matches: [
                { code: "Partida 32", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "azure_bears_black", scoreB: 1, winner: "azure_bears_black" },
                { code: "Partida 33", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "rahnag", scoreB: 1, winner: "rahnag" },
                { code: "Partida 34", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "unicamp_tritons_black", scoreB: 1, winner: "unicamp_tritons_black" },
                { code: "Partida 35", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "inatel_legacy", scoreB: 1, winner: "inatel_legacy" },
                { code: "Partida 36", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "ime_wolves_red", scoreB: 1, winner: "ime_wolves_red" },
                { code: "Partida 37", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "liga_vulkanica", scoreB: 1, winner: "liga_vulkanica" },
                { code: "Partida 38", a: "caap_auroras", scoreA: 13, b: "inatel_gray", scoreB: 7, winner: "caap_auroras" },
                { code: "Partida 39", aLabel: "Sem advers\u00e1rio", scoreA: 0, b: "poli_plague", scoreB: 1, winner: "poli_plague" },
              ],
            },
            {
              title: "Rodada de 16 inferior",
              matches: [
                { code: "Partida 40", a: "inatel_dois", scoreA: 3, b: "azure_bears_black", scoreB: 13, winner: "azure_bears_black" },
                { code: "Partida 41", a: "octacore_python", scoreA: 1, b: "rahnag", scoreB: 0, winner: "octacore_python", status: "W.O." },
                { code: "Partida 42", a: "fei_darkowls", scoreA: 13, b: "unicamp_tritons_black", scoreB: 9, winner: "fei_darkowls" },
                { code: "Partida 43", a: "inatel", scoreA: 0, b: "inatel_legacy", scoreB: 1, winner: "inatel_legacy", status: "W.O." },
                { code: "Partida 44", a: "ceub_octopus_vulgaris", scoreA: 13, b: "ime_wolves_red", scoreB: 3, winner: "ceub_octopus_vulgaris" },
                { code: "Partida 45", a: "maua_blue", scoreA: 13, b: "liga_vulkanica", scoreB: 4, winner: "maua_blue" },
                { code: "Partida 46", a: "green_owls_noctua", scoreA: 13, b: "caap_auroras", scoreB: 8, winner: "green_owls_noctua" },
                { code: "Partida 47", a: "ufpr_bbn", scoreA: 13, b: "poli_plague", scoreB: 5, winner: "ufpr_bbn" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 48", a: "azure_bears_black", scoreA: 11, b: "octacore_python", scoreB: 13, winner: "octacore_python" },
                { code: "Partida 49", a: "fei_darkowls", scoreA: 10, b: "inatel_legacy", scoreB: 13, winner: "inatel_legacy" },
                { code: "Partida 50", a: "ceub_octopus_vulgaris", scoreA: 9, b: "maua_blue", scoreB: 13, winner: "maua_blue" },
                { code: "Partida 51", a: "green_owls_noctua", scoreA: 0, b: "ufpr_bbn", scoreB: 1, winner: "ufpr_bbn", status: "W.O." },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 52", a: "a2e_uff", scoreA: 10, b: "octacore_python", scoreB: 13, winner: "octacore_python" },
                { code: "Partida 53", a: "ufmt_turuna", scoreA: 13, b: "inatel_legacy", scoreB: 4, winner: "ufmt_turuna" },
                { code: "Partida 54", a: "uscs_hawks", scoreA: 1, b: "maua_blue", scoreB: 0, winner: "uscs_hawks", status: "W.O." },
                { code: "Partida 55", a: "caap_momentum", scoreA: 9, b: "ufpr_bbn", scoreB: 13, winner: "ufpr_bbn" },
              ],
            },
            {
              title: "Rodada de 4 inferior",
              matches: [
                { code: "Partida 56", a: "octacore_python", scoreA: 2, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
                { code: "Partida 57", a: "uscs_hawks", scoreA: 13, b: "ufpr_bbn", scoreB: 5, winner: "uscs_hawks" },
              ],
            },
            {
              title: "Quartas de final inferior",
              matches: [
                { code: "Partida 58", a: "pucc_cardinals", scoreA: 4, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
                { code: "Partida 59", a: "axis_anteaters", scoreA: 14, b: "uscs_hawks", scoreB: 12, winner: "axis_anteaters" },
              ],
            },
          ],
        },
      ],
    },
  },
  "univava-classificatoria-1": {
    name: "UNIVAV\u00c1 - Classificat\u00f3rias 1",
    organizer: "AcadArena",
    organizerLogo: "assets/organizers-logos/logo_AcadArena.png",
    banner: "assets/tournament-banners/banner_univava_c1.webp",
    logo: "assets/tournament-icons/UNIVAVA.png",
    prizePool: "-",
    tier: "A",
    type: "Online - Classificat\u00f3ria",
    teamCount: 36,
    mapPool: ["Ascent", "Haven", "Pearl", "Lotus", "Split", "Breeze"],
    teams: [
      "poli_plague",
      "unicamp_tritons_red",
      "wolf_gaming",
      "axis_anteaters",
      "axis_aura",
      "ufg_eagles",
      "homem_passaro",
      "ufg_eagles_blue",
      "ufmt_turuna",
      "caap_momentum",
      "a2e_uff",
      "ufpr_bbn",
      "caap_hellhounds",
      "macklogic_red",
      "octacore_javascript",
      "macklogic_white",
      "azure_bears_black",
      "ufg_gc_eagles",
      "ceub_octopus_vulgaris",
      "ufu_saints",
      "azure_bears_golden",
      "fei_darkowls",
      "uscs_hawks",
      "azure_bears_silver",
      "unifesp_erex",
      "unicamp_tritons_black",
      "pucgo_sistematica_academy",
      "gdu_ufpb",
      "octacore_python",
      "inatel_legacy",
      "pucc_cardinals",
      "totale_umc",
      "fei_whiteowls",
      "ufmg_fenix_b",
      "ufrj_minerva",
      "ceub_octopus",
    ],
    placements: [
      { range: "Classificado", id: "azure_bears_golden", note: "Chave superior" },
      { range: "Classificado", id: "ceub_octopus", note: "Chave superior" },
      { range: "Classificado", id: "macklogic_red", note: "Chave inferior" },
      { range: "Classificado", id: "wolf_gaming", note: "Chave inferior" },
      { range: "5-6", id: "caap_hellhounds", note: "Decis\u00e3o de vaga inferior" },
      { range: "5-6", id: "uscs_hawks", note: "Decis\u00e3o de vaga inferior" },
      { range: "7-8", id: "ufu_saints", note: "Rodada de 4 inferior" },
      { range: "7-8", id: "ufmt_turuna", note: "Rodada de 4 inferior" },
      { range: "9-12", id: "totale_umc", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "octacore_python", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "azure_bears_black", note: "Rodada de 8 inferior" },
      { range: "9-12", id: "caap_momentum", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "poli_plague", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "macklogic_white", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "ceub_octopus_vulgaris", note: "Rodada de 8 inferior" },
      { range: "13-16", id: "fei_whiteowls", note: "Rodada de 8 inferior" },
      { range: "17-24", id: "ufpr_bbn", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "pucc_cardinals", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "gdu_ufpb", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "ufg_eagles", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "unifesp_erex", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "pucgo_sistematica_academy", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "axis_aura", note: "Rodada de 16 inferior" },
      { range: "17-24", id: "unicamp_tritons_red", note: "Rodada de 16 inferior" },
      { range: "25-32", id: "ufmg_fenix_b", note: "Rodada de 16 inferior" },
      { range: "25-32", id: "inatel_legacy", note: "Rodada de 16 inferior" },
      { range: "25-32", id: "unicamp_tritons_black", note: "Rodada de 16 inferior" },
      { range: "25-32", id: "azure_bears_silver", note: "Rodada de 16 inferior" },
      { range: "25-32", id: "fei_darkowls", note: "Rodada de 16 inferior" },
      { range: "25-32", id: "ufg_gc_eagles", note: "Rodada de 16 inferior" },
      { range: "25-32", id: "ufg_eagles_blue", note: "Rodada de 16 inferior" },
      { range: "25-32", id: "a2e_uff", note: "Rodada de 16 inferior" },
      { range: "33-36", id: "ufrj_minerva", note: "Rodada de 32 inferior" },
      { range: "33-36", id: "axis_anteaters", note: "Rodada de 32 inferior" },
      { range: "33-36", id: "homem_passaro", note: "Rodada de 32 inferior" },
      { range: "33-36", id: "octacore_javascript", note: "Rodada de 32 inferior" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Classificat\u00f3ria com 4 vagas", "2 vagas pela chave superior", "2 vagas pela chave inferior", "Jogos MD1"],
      standings: "Classificados oficiais",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Rodada de 64 superior",
              matches: [
                { code: "Partida 2", slot: 0, a: "poli_plague", scoreA: 10, b: "unicamp_tritons_red", scoreB: 13, winner: "unicamp_tritons_red" },
                { code: "Partida 10", slot: 4, a: "wolf_gaming", scoreA: 1, b: "axis_anteaters", scoreB: 0, winner: "wolf_gaming" },
                { code: "Partida 18", slot: 8, a: "ufg_eagles", scoreA: 13, b: "homem_passaro", scoreB: 0, winner: "ufg_eagles" },
                { code: "Partida 26", slot: 12, a: "ufg_eagles_blue", scoreA: 2, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
              ],
            },
            {
              title: "Rodada de 32 superior",
              matches: [
                { code: "Partida 33", a: "caap_momentum", scoreA: 13, b: "unicamp_tritons_red", scoreB: 8, winner: "caap_momentum" },
                { code: "Partida 34", a: "a2e_uff", scoreA: 10, b: "ufpr_bbn", scoreB: 13, winner: "ufpr_bbn" },
                { code: "Partida 35", a: "caap_hellhounds", scoreA: 13, b: "axis_aura", scoreB: 3, winner: "caap_hellhounds" },
                { code: "Partida 36", a: "octacore_javascript", scoreA: 5, b: "macklogic_red", scoreB: 13, winner: "macklogic_red" },
                { code: "Partida 37", a: "macklogic_white", scoreA: 13, b: "wolf_gaming", scoreB: 11, winner: "macklogic_white" },
                { code: "Partida 38", a: "ufg_gc_eagles", scoreA: 0, b: "azure_bears_black", scoreB: 13, winner: "azure_bears_black" },
                { code: "Partida 39", a: "ceub_octopus_vulgaris", scoreA: 10, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
                { code: "Partida 40", a: "fei_darkowls", scoreA: 0, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 41", a: "uscs_hawks", scoreA: 13, b: "ufg_eagles", scoreB: 8, winner: "uscs_hawks" },
                { code: "Partida 42", a: "azure_bears_silver", scoreA: 10, b: "unifesp_erex", scoreB: 13, winner: "unifesp_erex" },
                { code: "Partida 43", a: "unicamp_tritons_black", scoreA: 0, b: "pucgo_sistematica_academy", scoreB: 1, winner: "pucgo_sistematica_academy" },
                { code: "Partida 44", a: "gdu_ufpb", scoreA: 4, b: "octacore_python", scoreB: 13, winner: "octacore_python" },
                { code: "Partida 45", a: "inatel_legacy", scoreA: 8, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
                { code: "Partida 46", a: "totale_umc", scoreA: 13, b: "pucc_cardinals", scoreB: 2, winner: "totale_umc" },
                { code: "Partida 47", a: "fei_whiteowls", scoreA: 13, b: "ufmg_fenix_b", scoreB: 7, winner: "fei_whiteowls" },
                { code: "Partida 48", a: "ufrj_minerva", scoreA: 0, b: "ceub_octopus", scoreB: 1, winner: "ceub_octopus" },
              ],
            },
            {
              title: "Rodada de 16 superior",
              matches: [
                { code: "Partida 49", a: "caap_momentum", scoreA: 13, b: "ufpr_bbn", scoreB: 3, winner: "caap_momentum" },
                { code: "Partida 50", a: "caap_hellhounds", scoreA: 13, b: "macklogic_red", scoreB: 7, winner: "caap_hellhounds" },
                { code: "Partida 51", a: "macklogic_white", scoreA: 8, b: "azure_bears_black", scoreB: 13, winner: "azure_bears_black" },
                { code: "Partida 52", a: "ufu_saints", scoreA: 9, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 53", a: "uscs_hawks", scoreA: 13, b: "unifesp_erex", scoreB: 1, winner: "uscs_hawks" },
                { code: "Partida 54", a: "pucgo_sistematica_academy", scoreA: 3, b: "octacore_python", scoreB: 13, winner: "octacore_python" },
                { code: "Partida 55", a: "ufmt_turuna", scoreA: 6, b: "totale_umc", scoreB: 13, winner: "totale_umc" },
                { code: "Partida 56", a: "fei_whiteowls", scoreA: 1, b: "ceub_octopus", scoreB: 13, winner: "ceub_octopus" },
              ],
            },
            {
              title: "Quartas de final superior",
              matches: [
                { code: "Partida 57", a: "caap_momentum", scoreA: 3, b: "caap_hellhounds", scoreB: 13, winner: "caap_hellhounds" },
                { code: "Partida 58", a: "azure_bears_black", scoreA: 3, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 59", a: "uscs_hawks", scoreA: 13, b: "octacore_python", scoreB: 5, winner: "uscs_hawks" },
                { code: "Partida 60", a: "totale_umc", scoreA: 0, b: "ceub_octopus", scoreB: 13, winner: "ceub_octopus" },
              ],
            },
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 61", a: "caap_hellhounds", scoreA: 4, b: "azure_bears_golden", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 62", a: "uscs_hawks", scoreA: 0, b: "ceub_octopus", scoreB: 13, winner: "ceub_octopus" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada de 32 inferior",
              matches: [
                { code: "Partida 80", slot: 0, a: "ufrj_minerva", scoreA: 0, b: "poli_plague", scoreB: 1, winner: "poli_plague" },
                { code: "Partida 84", slot: 2, a: "gdu_ufpb", scoreA: 1, b: "axis_anteaters", scoreB: 0, winner: "gdu_ufpb" },
                { code: "Partida 88", slot: 4, a: "fei_darkowls", scoreA: 13, b: "homem_passaro", scoreB: 7, winner: "fei_darkowls" },
                { code: "Partida 92", slot: 6, a: "octacore_javascript", scoreA: 3, b: "ufg_eagles_blue", scoreB: 13, winner: "ufg_eagles_blue" },
              ],
            },
            {
              title: "Rodada de 16 inferior",
              matches: [
                { code: "Partida 96", a: "poli_plague", scoreA: 13, b: "ufmg_fenix_b", scoreB: 11, winner: "poli_plague" },
                { code: "Partida 97", a: "pucc_cardinals", scoreA: 13, b: "inatel_legacy", scoreB: 7, winner: "pucc_cardinals" },
                { code: "Partida 98", a: "gdu_ufpb", scoreA: 1, b: "unicamp_tritons_black", scoreB: 0, winner: "gdu_ufpb" },
                { code: "Partida 99", a: "azure_bears_silver", scoreA: 0, b: "ufg_eagles", scoreB: 13, winner: "ufg_eagles" },
                { code: "Partida 100", a: "fei_darkowls", scoreA: 7, b: "ceub_octopus_vulgaris", scoreB: 13, winner: "ceub_octopus_vulgaris" },
                { code: "Partida 101", a: "ufg_gc_eagles", scoreA: 0, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
                { code: "Partida 102", a: "ufg_eagles_blue", scoreA: 10, b: "axis_aura", scoreB: 13, winner: "axis_aura" },
                { code: "Partida 103", a: "a2e_uff", scoreA: 0, b: "unicamp_tritons_red", scoreB: 1, winner: "unicamp_tritons_red" },
              ],
            },
            {
              title: "Rodada de 16 inferior",
              matches: [
                { code: "Partida 104", a: "ufpr_bbn", scoreA: 11, b: "poli_plague", scoreB: 13, winner: "poli_plague" },
                { code: "Partida 105", a: "macklogic_red", scoreA: 13, b: "pucc_cardinals", scoreB: 10, winner: "macklogic_red" },
                { code: "Partida 106", a: "macklogic_white", scoreA: 13, b: "gdu_ufpb", scoreB: 3, winner: "macklogic_white" },
                { code: "Partida 107", a: "ufg_eagles", scoreA: 11, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
                { code: "Partida 108", a: "unifesp_erex", scoreA: 4, b: "ceub_octopus_vulgaris", scoreB: 13, winner: "ceub_octopus_vulgaris" },
                { code: "Partida 109", a: "pucgo_sistematica_academy", scoreA: 0, b: "wolf_gaming", scoreB: 1, winner: "wolf_gaming" },
                { code: "Partida 110", a: "ufmt_turuna", scoreA: 13, b: "axis_aura", scoreB: 6, winner: "ufmt_turuna" },
                { code: "Partida 111", a: "fei_whiteowls", scoreA: 13, b: "unicamp_tritons_red", scoreB: 10, winner: "fei_whiteowls" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 112", a: "poli_plague", scoreA: 2, b: "macklogic_red", scoreB: 13, winner: "macklogic_red" },
                { code: "Partida 113", a: "macklogic_white", scoreA: 3, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
                { code: "Partida 114", a: "ceub_octopus_vulgaris", scoreA: 8, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
                { code: "Partida 115", a: "ufmt_turuna", scoreA: 13, b: "fei_whiteowls", scoreB: 2, winner: "ufmt_turuna" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 116", a: "totale_umc", scoreA: 4, b: "macklogic_red", scoreB: 13, winner: "macklogic_red" },
                { code: "Partida 117", a: "octacore_python", scoreA: 7, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
                { code: "Partida 118", a: "azure_bears_black", scoreA: 11, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
                { code: "Partida 119", a: "caap_momentum", scoreA: 8, b: "ufmt_turuna", scoreB: 13, winner: "ufmt_turuna" },
              ],
            },
            {
              title: "Rodada de 4 inferior",
              matches: [
                { code: "Partida 120", a: "macklogic_red", scoreA: 13, b: "ufu_saints", scoreB: 4, winner: "macklogic_red" },
                { code: "Partida 121", a: "wolf_gaming", scoreA: 13, b: "ufmt_turuna", scoreB: 6, winner: "wolf_gaming" },
              ],
            },
            {
              title: "Quartas de final inferior",
              matches: [
                { code: "Partida 122", a: "caap_hellhounds", scoreA: 9, b: "macklogic_red", scoreB: 13, winner: "macklogic_red" },
                { code: "Partida 123", a: "uscs_hawks", scoreA: 15, b: "wolf_gaming", scoreB: 17, winner: "wolf_gaming" },
              ],
            },
          ],
        },
      ],
    },
  },
  "uni-ascension": {
    name: "VAL | UNI Ascension | Inters",
    organizer: "AcadArena",
    organizerLogo: "assets/organizers-logos/logo_AcadArena.png",
    banner: "assets/tournament-banners/acadarena_banner_generic.jpeg",
    prizePool: "-",
    tier: "B",
    type: "Online - Inters",
    teamCount: 12,
    mapPool: ["Ascent", "Haven", "Lotus", "Split", "Breeze"],
    teams: [
      "octacore_python",
      "octacore_javascript",
      "azure_bears_black",
      "azure_bears_silver",
      "wolf_gaming",
      "cyberkongs",
      "brutal_esports",
      "unirv_rushone",
      "macklogic_white",
      "ufu_saints",
      "ufpr_bbn",
      "a2e_uff",
    ],
    placements: [
      { range: "1", id: "ufu_saints" },
      { range: "2", id: "wolf_gaming" },
      { range: "3", id: "azure_bears_black" },
      { range: "4", id: "azure_bears_silver" },
      { range: "5-6", id: "octacore_python" },
      { range: "5-6", id: "brutal_esports" },
      { range: "7-8", id: "macklogic_white" },
      { range: "7-8", id: "unirv_rushone" },
      { range: "9-12", id: "octacore_javascript" },
      { range: "9-12", id: "cyberkongs" },
      { range: "9-12", id: "a2e_uff" },
      { range: "9-12", id: "ufpr_bbn" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o dupla",
      details: ["Todos os jogos MD1", "Partidas com BYE avan\u00e7am automaticamente"],
      standings: "Coloca\u00e7\u00e3o oficial do campeonato",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o dupla",
      regions: [
        {
          name: "Grande final",
          className: "grand-final",
          columns: [
            {
              title: "Grande final",
              matches: [
                { code: "Partida 30", a: "ufu_saints", scoreA: 13, b: "wolf_gaming", scoreB: 5, winner: "ufu_saints" },
              ],
            },
          ],
        },
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Rodada de 16 superior",
              matches: [
                { code: "Partida 1", a: "octacore_python", scoreA: 1, bLabel: "Sem adversario", scoreB: 0, winner: "octacore_python" },
                { code: "Partida 2", a: "octacore_javascript", scoreA: 5, b: "azure_bears_silver", scoreB: 13, winner: "azure_bears_silver" },
                { code: "Partida 3", a: "azure_bears_black", scoreA: 1, bLabel: "Sem adversario", scoreB: 0, winner: "azure_bears_black" },
                { code: "Partida 4", a: "a2e_uff", scoreA: 13, b: "wolf_gaming", scoreB: 10, winner: "a2e_uff" },
                { code: "Partida 5", a: "cyberkongs", scoreA: 1, bLabel: "Sem adversario", scoreB: 0, winner: "cyberkongs" },
                { code: "Partida 6", a: "brutal_esports", scoreA: 13, b: "unirv_rushone", scoreB: 11, winner: "brutal_esports" },
                { code: "Partida 7", a: "macklogic_white", scoreA: 1, bLabel: "Sem adversario", scoreB: 0, winner: "macklogic_white" },
                { code: "Partida 8", a: "ufu_saints", scoreA: 14, b: "ufpr_bbn", scoreB: 12, winner: "ufu_saints" },
              ],
            },
            {
              title: "Quartas de final superior",
              matches: [
                { code: "Partida 9", a: "octacore_python", scoreA: 13, b: "azure_bears_silver", scoreB: 11, winner: "octacore_python" },
                { code: "Partida 10", a: "azure_bears_black", scoreA: 13, b: "a2e_uff", scoreB: 6, winner: "azure_bears_black" },
                { code: "Partida 11", a: "cyberkongs", scoreA: 10, b: "brutal_esports", scoreB: 13, winner: "brutal_esports" },
                { code: "Partida 12", a: "macklogic_white", scoreA: 14, b: "ufu_saints", scoreB: 16, winner: "ufu_saints" },
              ],
            },
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 13", a: "octacore_python", scoreA: 4, b: "azure_bears_black", scoreB: 13, winner: "azure_bears_black" },
                { code: "Partida 14", a: "brutal_esports", scoreA: 2, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
              ],
            },
            {
              title: "Final superior",
              matches: [
                { code: "Partida 15", a: "azure_bears_black", scoreA: 7, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 16", aLabel: "Sem adversario", scoreA: 0, b: "octacore_javascript", scoreB: 1, winner: "octacore_javascript" },
                { code: "Partida 17", aLabel: "Sem adversario", scoreA: 0, b: "wolf_gaming", scoreB: 1, winner: "wolf_gaming" },
                { code: "Partida 18", aLabel: "Sem adversario", scoreA: 0, b: "unirv_rushone", scoreB: 1, winner: "unirv_rushone" },
                { code: "Partida 19", aLabel: "Sem adversario", scoreA: 0, b: "ufpr_bbn", scoreB: 1, winner: "ufpr_bbn" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 20", a: "macklogic_white", scoreA: 13, b: "octacore_javascript", scoreB: 7, winner: "macklogic_white" },
                { code: "Partida 21", a: "cyberkongs", scoreA: 8, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
                { code: "Partida 22", a: "a2e_uff", scoreA: 11, b: "unirv_rushone", scoreB: 13, winner: "unirv_rushone" },
                { code: "Partida 23", a: "azure_bears_silver", scoreA: 13, b: "ufpr_bbn", scoreB: 11, winner: "azure_bears_silver" },
              ],
            },
            {
              title: "Rodada de 4 inferior",
              matches: [
                { code: "Partida 24", a: "macklogic_white", scoreA: 4, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
                { code: "Partida 25", a: "unirv_rushone", scoreA: 11, b: "azure_bears_silver", scoreB: 13, winner: "azure_bears_silver" },
              ],
            },
            {
              title: "Quartas de final inferior",
              matches: [
                { code: "Partida 26", a: "octacore_python", scoreA: 9, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
                { code: "Partida 27", a: "brutal_esports", scoreA: 10, b: "azure_bears_silver", scoreB: 13, winner: "azure_bears_silver" },
              ],
            },
            {
              title: "Semifinal inferior",
              matches: [
                { code: "Partida 28", a: "wolf_gaming", scoreA: 13, b: "azure_bears_silver", scoreB: 7, winner: "wolf_gaming" },
              ],
            },
            {
              title: "Final inferior",
              matches: [
                { code: "Partida 29", a: "azure_bears_black", scoreA: 11, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
              ],
            },
          ],
        },
      ],
    },
  },
  "unicup-rj": {
    organizer: "FERJEE",
    organizerLogo: "assets/organizers-logos/logo_ferjee.webp",
    banner: "assets/tournament-banners/acadarena_banner_generic.jpeg",
    prizePool: "R$2.000",
    tier: "A",
    type: "Online/Presencial",
    teamCount: 8,
    mapPool: ["Ascent", "Haven", "Lotus", "Split", "Sunset"],
    teams: [
      "baroes_da_uff",
      "ufrj_minerva",
      "unirio_krakens",
      "wolf_gaming",
      "a2e_uff",
      "made_in_cefet_rj",
      "minerva_thunders",
      "ufrj_canis",
    ],
    placements: [
      { range: "1", id: "wolf_gaming" },
      { range: "2", id: "a2e_uff" },
      { range: "3-4", id: "ufrj_minerva" },
      { range: "3-4", id: "minerva_thunders" },
      { range: "5-8", id: "baroes_da_uff" },
      { range: "5-8", id: "unirio_krakens" },
      { range: "5-8", id: "made_in_cefet_rj" },
      { range: "5-8", id: "ufrj_canis" },
    ],
    format: {
      summary: "Elimina\u00e7\u00e3o simples",
      details: ["Quartas e semifinais MD1", "Final MD3"],
      standings: "Coloca\u00e7\u00e3o oficial do campeonato",
    },
    bracket: {
      title: "Elimina\u00e7\u00e3o simples",
      regions: [
        {
          name: "Final",
          className: "grand-final",
          columns: [
            {
              title: "Final",
              matches: [
                { code: "Partida 7", bestOf: "MD3", a: "wolf_gaming", scoreA: 2, b: "a2e_uff", scoreB: 1, winner: "wolf_gaming" },
              ],
            },
          ],
        },
        {
          name: "Chave principal",
          className: "upper-bracket single-elimination",
          columns: [
            {
              title: "Quartas de final",
              matches: [
                { code: "Partida 1", a: "baroes_da_uff", scoreA: 3, b: "ufrj_minerva", scoreB: 13, winner: "ufrj_minerva" },
                { code: "Partida 2", a: "unirio_krakens", scoreA: 6, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
                { code: "Partida 3", a: "a2e_uff", scoreA: 13, b: "made_in_cefet_rj", scoreB: 4, winner: "a2e_uff" },
                { code: "Partida 4", a: "minerva_thunders", scoreA: 13, b: "ufrj_canis", scoreB: 8, winner: "minerva_thunders" },
              ],
            },
            {
              title: "Semifinais",
              matches: [
                { code: "Partida 5", a: "ufrj_minerva", scoreA: 2, b: "wolf_gaming", scoreB: 13, winner: "wolf_gaming" },
                { code: "Partida 6", a: "a2e_uff", scoreA: 13, b: "minerva_thunders", scoreB: 10, winner: "a2e_uff" },
              ],
            },
          ],
        },
      ],
    },
  },
  "uni-kickoff-inters": {
    name: "VAL | Uni Kick-OFF | Inters",
    organizer: "AcadArena",
    organizerLogo: "assets/organizers-logos/logo_AcadArena.png",
    banner: "assets/tournament-banners/banner_uni_kickoff.jpg",
    prizePool: "-",
    tier: "B",
    type: "Online - Inters",
    startAt: "2026-04-04T13:00:00",
    endAt: "2026-04-05T23:00:00",
    teamCount: 24,
    mapPool: ["Bind", "Haven", "Pearl", "Split", "Breeze", "Lotus", "Fracture"],
    format: {
      summary: "Eliminação dupla",
      details: ["Todos os jogos MD1", "Finais MD3"],
      standings: "Colocação oficial do campeonato",
    },
    teamNames: {
      sixa_eaters: "sixA Eaters",
    },
    teams: [
      "pucgo_sistematica",
      "aaeu_cerberus",
      "a2e_uff",
      "xxii_setembro_fatec",
      "axis_ego",
      "azure_bears_black",
      "azure_bears_golden",
      "caap_hellhounds",
      "ceub_octopus",
      "ceub_octopus_vulgaris",
      "dark_ufrj",
      "fei_darkowls",
      "fei_whiteowls",
      "unifacens_fodens",
      "gambiarra_ufg",
      "green_owls_noctua",
      "octacore_python",
      "green_owls_pulsatrix",
      "pucc_cardinals",
      "sixa_eaters",
      "totale_umc",
      "ufu_saints",
      "unicamp_tritons_black",
      "unirv_rushone",
    ],
    placements: [
      { range: "1", id: "ceub_octopus" },
      { range: "2", id: "azure_bears_golden" },
      { range: "3", id: "caap_hellhounds" },
      { range: "4", id: "ufu_saints" },
      { range: "5-6", id: "dark_ufrj" },
      { range: "5-6", id: "axis_ego" },
      { range: "7-8", id: "unicamp_tritons_black" },
      { range: "7-8", id: "fei_darkowls" },
      { range: "9-12", id: "octacore_python" },
      { range: "9-12", id: "a2e_uff" },
      { range: "9-12", id: "pucc_cardinals" },
      { range: "9-12", id: "unirv_rushone" },
      { range: "13-16", id: "azure_bears_black" },
      { range: "13-16", id: "pucgo_sistematica" },
      { range: "13-16", id: "fei_whiteowls" },
      { range: "13-16", id: "green_owls_noctua" },
      { range: "17-24", id: "totale_umc" },
      { range: "17-24", id: "aaeu_cerberus" },
      { range: "17-24", id: "gambiarra_ufg" },
      { range: "17-24", id: "ceub_octopus_vulgaris" },
      { range: "17-24", id: "sixa_eaters" },
      { range: "17-24", id: "xxii_setembro_fatec" },
      { range: "17-24", id: "unifacens_fodens" },
      { range: "17-24", id: "green_owls_pulsatrix" },
    ],
    bracket: {
      title: "Eliminação dupla",
      regions: [
        {
          name: "Grande final",
          className: "grand-final",
          columns: [
            {
              title: "Grande final",
              matches: [
                { code: "Partida 62", bestOf: "MD3", a: "azure_bears_golden", scoreA: 0, b: "ceub_octopus", scoreB: 2, winner: "ceub_octopus" },
              ],
            },
          ],
        },
        {
          name: "Chave superior",
          className: "upper-bracket",
          columns: [
            {
              title: "Rodada de 32 superior",
              matches: [
                { code: "Partida 1", a: "azure_bears_golden", scoreA: 1, bLabel: "Sem adversário", scoreB: 0, winner: "azure_bears_golden" },
                { code: "Partida 2", a: "octacore_python", scoreA: 13, b: "green_owls_pulsatrix", scoreB: 9, winner: "octacore_python" },
                { code: "Partida 3", a: "axis_ego", scoreA: 1, bLabel: "Sem adversário", scoreB: 0, winner: "axis_ego" },
                { code: "Partida 4", a: "azure_bears_black", scoreA: 13, b: "unirv_rushone", scoreB: 10, winner: "azure_bears_black" },
                { code: "Partida 5", a: "a2e_uff", scoreA: 1, bLabel: "Sem adversário", scoreB: 0, winner: "a2e_uff" },
                { code: "Partida 6", a: "fei_darkowls", scoreA: 13, b: "xxii_setembro_fatec", scoreB: 1, winner: "fei_darkowls" },
                { code: "Partida 7", a: "ufu_saints", scoreA: 1, bLabel: "Sem adversário", scoreB: 0, winner: "ufu_saints" },
                { code: "Partida 8", a: "ceub_octopus_vulgaris", scoreA: 13, b: "sixa_eaters", scoreB: 7, winner: "ceub_octopus_vulgaris" },
                { code: "Partida 9", a: "ceub_octopus", scoreA: 1, bLabel: "Sem adversário", scoreB: 0, winner: "ceub_octopus" },
                { code: "Partida 10", a: "pucc_cardinals", scoreA: 13, b: "pucgo_sistematica", scoreB: 5, winner: "pucc_cardinals" },
                { code: "Partida 11", a: "unicamp_tritons_black", scoreA: 1, bLabel: "Sem adversário", scoreB: 0, winner: "unicamp_tritons_black" },
                { code: "Partida 12", a: "fei_whiteowls", scoreA: 13, b: "gambiarra_ufg", scoreB: 8, winner: "fei_whiteowls" },
                { code: "Partida 13", a: "dark_ufrj", scoreA: 1, bLabel: "Sem adversário", scoreB: 0, winner: "dark_ufrj" },
                { code: "Partida 14", a: "unifacens_fodens", scoreA: 13, b: "aaeu_cerberus", scoreB: 2, winner: "unifacens_fodens" },
                { code: "Partida 15", a: "caap_hellhounds", scoreA: 1, bLabel: "Sem adversário", scoreB: 0, winner: "caap_hellhounds" },
                { code: "Partida 16", a: "green_owls_noctua", scoreA: 13, b: "totale_umc", scoreB: 11, winner: "green_owls_noctua" },
              ],
            },
            {
              title: "Rodada de 16 superior",
              matches: [
                { code: "Partida 17", a: "azure_bears_golden", scoreA: 15, b: "octacore_python", scoreB: 13, winner: "azure_bears_golden" },
                { code: "Partida 18", a: "axis_ego", scoreA: 16, b: "azure_bears_black", scoreB: 14, winner: "axis_ego" },
                { code: "Partida 19", a: "a2e_uff", scoreA: 10, b: "fei_darkowls", scoreB: 13, winner: "fei_darkowls" },
                { code: "Partida 20", a: "ufu_saints", scoreA: 13, b: "ceub_octopus_vulgaris", scoreB: 10, winner: "ufu_saints" },
                { code: "Partida 21", a: "ceub_octopus", scoreA: 13, b: "pucc_cardinals", scoreB: 9, winner: "ceub_octopus" },
                { code: "Partida 22", a: "unicamp_tritons_black", scoreA: 14, b: "fei_whiteowls", scoreB: 12, winner: "unicamp_tritons_black" },
                { code: "Partida 23", a: "dark_ufrj", scoreA: 13, b: "unifacens_fodens", scoreB: 10, winner: "dark_ufrj" },
                { code: "Partida 24", a: "caap_hellhounds", scoreA: 13, b: "green_owls_noctua", scoreB: 5, winner: "caap_hellhounds" },
              ],
            },
            {
              title: "Quartas de final superior",
              matches: [
                { code: "Partida 25", a: "azure_bears_golden", scoreA: 13, b: "axis_ego", scoreB: 9, winner: "azure_bears_golden" },
                { code: "Partida 26", a: "fei_darkowls", scoreA: 8, b: "ufu_saints", scoreB: 13, winner: "ufu_saints" },
                { code: "Partida 27", a: "ceub_octopus", scoreA: 13, b: "unicamp_tritons_black", scoreB: 2, winner: "ceub_octopus" },
                { code: "Partida 28", a: "dark_ufrj", scoreA: 7, b: "caap_hellhounds", scoreB: 13, winner: "caap_hellhounds" },
              ],
            },
            {
              title: "Semifinais superior",
              matches: [
                { code: "Partida 29", a: "azure_bears_golden", scoreA: 13, b: "ufu_saints", scoreB: 4, winner: "azure_bears_golden" },
                { code: "Partida 30", a: "ceub_octopus", scoreA: 9, b: "caap_hellhounds", scoreB: 13, winner: "caap_hellhounds" },
              ],
            },
            {
              title: "Final superior",
              matches: [
                { code: "Partida 31", bestOf: "MD3", a: "azure_bears_golden", scoreA: 2, b: "caap_hellhounds", scoreB: 1, winner: "azure_bears_golden" },
              ],
            },
          ],
        },
        {
          name: "Chave inferior",
          className: "lower-bracket",
          columns: [
            {
              title: "Rodada de 16 inferior",
              matches: [
                { code: "Partida 40", a: "octacore_python", scoreA: 13, b: "totale_umc", scoreB: 8, winner: "octacore_python" },
                { code: "Partida 41", a: "azure_bears_black", scoreA: 1, b: "aaeu_cerberus", scoreB: 0, winner: "azure_bears_black" },
                { code: "Partida 42", a: "a2e_uff", scoreA: 13, b: "gambiarra_ufg", scoreB: 1, winner: "a2e_uff" },
                { code: "Partida 43", a: "ceub_octopus_vulgaris", scoreA: 9, b: "pucgo_sistematica", scoreB: 13, winner: "pucgo_sistematica" },
                { code: "Partida 44", a: "pucc_cardinals", scoreA: 13, b: "sixa_eaters", scoreB: 10, winner: "pucc_cardinals" },
                { code: "Partida 45", a: "fei_whiteowls", scoreA: 13, b: "xxii_setembro_fatec", scoreB: 1, winner: "fei_whiteowls" },
                { code: "Partida 46", a: "unifacens_fodens", scoreA: 8, b: "unirv_rushone", scoreB: 13, winner: "unirv_rushone" },
                { code: "Partida 47", a: "green_owls_noctua", scoreA: 13, b: "green_owls_pulsatrix", scoreB: 9, winner: "green_owls_noctua" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 48", a: "octacore_python", scoreA: 13, b: "azure_bears_black", scoreB: 3, winner: "octacore_python" },
                { code: "Partida 49", a: "a2e_uff", scoreA: 13, b: "pucgo_sistematica", scoreB: 7, winner: "a2e_uff" },
                { code: "Partida 50", a: "pucc_cardinals", scoreA: 13, b: "fei_whiteowls", scoreB: 11, winner: "pucc_cardinals" },
                { code: "Partida 51", a: "unirv_rushone", scoreA: 1, b: "green_owls_noctua", scoreB: 0, winner: "unirv_rushone" },
              ],
            },
            {
              title: "Rodada de 8 inferior",
              matches: [
                { code: "Partida 52", a: "dark_ufrj", scoreA: 13, b: "octacore_python", scoreB: 4, winner: "dark_ufrj" },
                { code: "Partida 53", a: "unicamp_tritons_black", scoreA: 13, b: "a2e_uff", scoreB: 6, winner: "unicamp_tritons_black" },
                { code: "Partida 54", a: "fei_darkowls", scoreA: 13, b: "pucc_cardinals", scoreB: 8, winner: "fei_darkowls" },
                { code: "Partida 55", a: "axis_ego", scoreA: 13, b: "unirv_rushone", scoreB: 11, winner: "axis_ego" },
              ],
            },
            {
              title: "Rodada de 4 inferior",
              matches: [
                { code: "Partida 56", a: "dark_ufrj", scoreA: 15, b: "unicamp_tritons_black", scoreB: 13, winner: "dark_ufrj" },
                { code: "Partida 57", a: "fei_darkowls", scoreA: 0, b: "axis_ego", scoreB: 1, winner: "axis_ego" },
              ],
            },
            {
              title: "Quartas de final inferior",
              matches: [
                { code: "Partida 58", a: "ufu_saints", scoreA: 13, b: "dark_ufrj", scoreB: 4, winner: "ufu_saints" },
                { code: "Partida 59", a: "ceub_octopus", scoreA: 13, b: "axis_ego", scoreB: 6, winner: "ceub_octopus" },
              ],
            },
            {
              title: "Semifinal inferior",
              matches: [
                { code: "Partida 60", a: "ufu_saints", scoreA: 9, b: "ceub_octopus", scoreB: 13, winner: "ceub_octopus" },
              ],
            },
            {
              title: "Final inferior",
              matches: [
                { code: "Partida 61", bestOf: "MD3", a: "caap_hellhounds", scoreA: 0, b: "ceub_octopus", scoreB: 2, winner: "ceub_octopus" },
              ],
            },
          ],
        },
      ],
    },
  },
};

const navItems = [
  ["home", "Inicial"],
  ["matches", "Partidas"],
  ["events", "Eventos"],
  ["players", "Players"],
  // A rota continua /stats; o rotulo diz o que a pagina de fato entrega hoje.
  ["stats", "Métricas"],
  ["ranking", "Ranking"],
];

// Transicao padrao de troca de conteudo (ver playPanelSlide). Declarada aqui em
// cima porque init() roda antes do bloco das funcoes de slide.
const PANEL_SLIDE_MS = 220;
// Uma "view" por grupo de abas: guarda o que esta na tela para saber o sentido
// do slide na proxima troca.
const panelSlideViews = {};
const NAV_INDICATOR_HEIGHT = 2;
let navIndicatorGeometry = null;

const STATIC_DOCUMENT_TITLES = {
  home: "Home",
  matches: "Partidas",
  events: "Eventos",
  tournaments: "Eventos",
  players: "Players",
  stats: "Métricas",
  ranking: "Ranking",
  rankings: "Ranking",
  teams: "Equipes",
  maps: "Mapas",
};

const state = {
  // Dias recolhidos na lista de partidas, por chave de dia. Fica na memoria e
  // nao na URL: recolher um dia e jeito de ler, nao filtro - nao muda o que a
  // lista contem, e uma URL com dez datas dentro nao ajuda ninguem. Sobrevive
  // a re-render (filtro, paginacao, troca de semana) porque o Set e do state.
  diasFechados: new Set(),
  // Marca que a proxima render do ranking deve animar a volta dos controles.
  rankingAnimarEntrada: false,
  ready: false,
  error: null,
  db: null,
  // Resumo da home enquanto o banco completo nao chegou; volta a null no swap.
  homeSummary: null,
  search: "",
  searchOpen: false,
  matchMap: "all",
  matchMaps: null,
  matchTeam: "all",
  matchTeams: [],
  matchTournament: "all",
  matchTournaments: null,
  matchBestOf: "all",
  matchTeamQuery: "",
  resultFilterOpen: {
    bestOf: false,
    maps: false,
    tournaments: false,
    datas: false,
    teams: false,
  },
  matchDateFrom: "",
  matchDateTo: "",
  matchScoreboardMode: "standard",
  playerSort: "rating",
  playerQuery: "",
  playerTeamQuery: "",
  playerTeam: "all",
  playerInitial: "all",
  eventSort: "end",
  matchScoreboardSort: {},
  matchLineupCompare: {},
  rankingScope: "valid",
  rankingShowDetails: false,
  rankingSort: { key: "", direction: "default" },
  rankingVersionId: "",
  rankingRefreshTimer: 0,
  tournamentStatsSort: {
    players: { key: "rating", direction: "desc" },
    teams: { key: "seriesWins", direction: "desc" },
    agents: { key: "picks", direction: "desc" },
    compositions: { key: "picks", direction: "desc" },
  },
  tournamentStatsExpanded: {},
  tournamentMapFilters: {},
  tournamentRankingCache: new Map(),
  routeKey: "",
};

const app = document.getElementById("app");

init();

// Monta um state.db parcial a partir do resumo. Os objetos vêm do build com a
// mesma forma dos reais, então teamLogo, teamShortRankLabel, sortedEvents,
// matchListScore e companhia funcionam sem saber que estão lendo o resumo.
function homeSummaryDb(summary) {
  return {
    teams: summary.teams || [],
    tournaments: summary.events || [],
    matchSeries: summary.series || [],
    maps: summary.maps || [],
    matches: [],
    players: [],
    weapons: [],
    rankingSnapshots: summary.rankingSnapshots || [],
    ranking: { teams: [], byTeamId: {} },
    metadata: {},
    teamProfiles: {},
  };
}

function routeIsHome() {
  const section = route().section;
  return !section || section === "home";
}

async function init() {
  renderLoading();
  try {
    // Primeiro render pelo resumo: ~8 KB gzip contra 5,3 MB do banco inteiro,
    // sem JSON.parse de 96 mil nós no caminho. Só vale para a home - qualquer
    // outra rota espera o banco completo, que já vem logo atrás.
    if (routeIsHome()) {
      const summary = await loadJsonOptional(HOME_MANIFEST);
      if (summary?.format === "univlr-home@1") {
        state.homeSummary = summary;
        state.db = homeSummaryDb(summary);
        state.ready = true;
        render();
      }
    }

    // Caminho rápido: banco pré-agregado por scripts/build_database.js.
    // Sem database.json (ex.: dados novos ainda não processados), cai no
    // pipeline completo no navegador, que baixa todos os arquivos brutos.
    const packed = window.DbCodec ? await loadJsonOptional(DATABASE_MANIFEST) : null;
    if (packed) {
      state.db = window.DbCodec.decode(packed);
    } else {
      const [manifest, rawMetadata, rawTeamProfiles, rankingWeights] = await Promise.all([
        loadJson(SOURCE_MANIFEST),
        loadJson(METADATA_MANIFEST),
        loadJsonOptional(TEAM_PROFILES_MANIFEST),
        loadJsonOptional(RANKING_WEIGHTS_MANIFEST),
      ]);
      const metadata = prepareMetadata(rawMetadata);
      const teamProfiles = prepareTeamProfiles(rawTeamProfiles);
      const loaded = await loadEventFiles(manifest.events);
      state.db = buildDatabase(manifest.events, loaded, metadata, teamProfiles, rankingWeights);
    }
    // O banco completo chegou: o resumo sai de cena e o que estiver na tela é
    // redesenhado a partir dele. Sem isso a home ficaria presa nos 10 itens do
    // resumo, e uma janela da semana virada durante a sessão nunca corrigiria.
    state.homeSummary = null;
    ensureCurrentRankingSnapshot(state.db);
    state.tournamentRankingCache.clear();
    state.ready = true;
    window.addEventListener("hashchange", render);
    bindFilterDropdownMotion();
    window.addEventListener("resize", () => {
      syncNavIndicator(false);
      syncTopbarHeight();
    });
    // A Barlow entra depois do primeiro render (font-display: swap) e o menu
    // re-layouta quando ela aplica. Sem re-sincronizar, o indicador fica travado
    // na medida feita com a fonte de fallback e aponta para o item errado.
    document.fonts?.ready?.then(() => syncNavIndicator(false));
    if (!connectionBlocksImageWarm() && !imageWarmIsFresh()) {
      await runImageSplash();
    }
    render();
    scheduleRankingWeeklyRefresh();
    if (window.requestIdleCallback) window.requestIdleCallback(() => warmImageCache(), { timeout: 4000 });
    else window.setTimeout(() => warmImageCache(), 2500);
  } catch (error) {
    state.error = error;
    renderLoading();
  }
}

// Aquece o cache de imagens: logos pequenos que aparecem em listas primeiro,
// fotos de jogadores e banners pesados por último. Na primeira visita recente
// roda na frente do usuário como tela de preparação (runImageSplash); nas
// demais, em segundo plano depois do primeiro render.
function collectWarmImageSources() {
  const db = state.db;
  if (!db) return [];
  const seen = new Set();
  const collect = (paths) =>
    (paths || [])
      .map((path) => assetPath(path || ""))
      .filter((src) => src && !seen.has(src) && Boolean(seen.add(src)));

  return [
    ...collect([PLAYER_FALLBACK_PHOTO]),
    ...collect(db.teams.map((team) => team.profile?.logo || team.logo)),
    ...collect(db.tournaments.map((event) => event.logo)),
    ...collect(db.tournaments.map((event) => event.organizerLogo || event.organizerLogoPath)),
    ...collect((db.metadata.agents || []).map((agent) => agent.icon)),
    // O campo e `icon` (scripts/build_metadata.py, read_states). Enquanto isso
    // lia `flag || flagSrc`, o aquecimento devolvia lista vazia e nenhuma
    // bandeira entrava no cache.
    ...collect((db.metadata.states || []).map((item) => item.icon)),
    ...collect(Object.values(TROPHY_GENERIC_ASSETS)),
    ...collect(db.players.map((player) => player.photo)),
    // A mesma fonte que o render usa, e nao o PNG de origem. Aquecer `map.icon`
    // aqui baixava os 12 PNGs (7,05 MB) que nenhuma tela mostra desde que a
    // arte passou a sair do `assets/maps/web`: o cache esquentava justamente os
    // arquivos que viraram fallback.
    ...collect(db.maps.map((map) => mapArtAttrs(map)?.src || "")),
    // Banners de campeonato ficam de fora: são 1,06 MB em 9 arquivos (121 KB de
    // média, o mais pesado da casa) e só aparecem depois que alguém abre a
    // página de um campeonato. Aquecer isso é cobrar de toda visita o preço de
    // uma tela que a maioria não abre; quando abre, o banner carrega ali.
  ];
}

function connectionBlocksImageWarm() {
  const connection = navigator.connection || {};
  return Boolean(connection.saveData) || /(^|-)2g/.test(connection.effectiveType || "");
}

function loadImageQueue(queue, onProgress) {
  return new Promise((resolve) => {
    if (!queue.length) return resolve();
    let index = 0;
    let settled = 0;
    const next = () => {
      if (index >= queue.length) return;
      const image = new Image();
      image.fetchPriority = "low";
      image.onload = image.onerror = () => {
        settled += 1;
        if (onProgress) onProgress(settled, queue.length);
        if (settled >= queue.length) resolve();
        else next();
      };
      image.src = queue[index++];
    };
    for (let i = 0; i < IMAGE_WARM_CONCURRENCY; i += 1) next();
  });
}

function warmImageCache(onProgress) {
  if (warmImageCache.started || !state.db) return Promise.resolve();
  warmImageCache.started = true;
  if (connectionBlocksImageWarm()) return Promise.resolve();
  return loadImageQueue(collectWarmImageSources(), onProgress);
}

function imageWarmIsFresh() {
  try {
    const stamp = Number(localStorage.getItem(IMAGE_WARM_STORAGE_KEY) || 0);
    return stamp > 0 && Date.now() - stamp < IMAGE_WARM_MAX_AGE_MS;
  } catch (error) {
    return true; // sem localStorage não há como lembrar; não bloqueia o usuário
  }
}

function markImageWarmDone() {
  try {
    localStorage.setItem(IMAGE_WARM_STORAGE_KEY, String(Date.now()));
  } catch (error) {
    /* modo privado: segue sem marcar */
  }
}

async function runImageSplash() {
  Shell(
    `
    <section class="image-splash" aria-live="polite">
      <img class="image-splash-logo" src="${SITE_LOGO_SRC}" alt="" />
      <h1>Preparando o site...</h1>
      <p>Baixando logos e fotos para uma navegação instantânea. Isso só acontece na primeira visita.</p>
      <div class="image-splash-track"><div class="image-splash-bar" id="image-splash-bar"></div></div>
      <span class="image-splash-count" id="image-splash-count">0%</span>
    </section>
  `,
    { skipSearch: true },
  );
  const bar = document.getElementById("image-splash-bar");
  const count = document.getElementById("image-splash-count");
  const warm = warmImageCache((done, total) => {
    const pct = Math.round((done / total) * 100);
    if (bar) bar.style.width = `${pct}%`;
    if (count) count.textContent = `${pct}%`;
  });
  // Conexões lentas não ficam presas na tela: libera após o timeout e o
  // restante das imagens continua baixando em segundo plano.
  const timeout = new Promise((resolve) => window.setTimeout(resolve, IMAGE_WARM_SPLASH_TIMEOUT_MS));
  await Promise.race([warm, timeout]);
  markImageWarmDone();
}

function prepareMetadata(rawMetadata = {}) {
  const teams = rawMetadata.teams || [];
  const players = rawMetadata.players || [];
  const agents = rawMetadata.agents || [];
  const maps = rawMetadata.maps || [];
  const states = rawMetadata.states || [];
  const stateWinrates = rawMetadata.stateWinrates || [];
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const playersByPuuid = new Map(players.filter((player) => player.puuid).map((player) => [player.puuid, player]));
  const playersByName = new Map();
  const agentsBySlug = new Map(agents.map((agent) => [agent.slug, agent]));
  const mapsBySlug = new Map(maps.map((map) => [map.slug, map]));
  const mapsByName = new Map(maps.map((map) => [normalizeNameKey(map.name || map.slug), map]));
  const statesBySigla = new Map(states.map((item) => [item.sigla, item]));
  const stateWinratesByKey = new Map(stateWinrates.map((row) => [`${row.allies}v${row.enemies}`, Number(row.winRate)]));

  for (const player of players) {
    const keys = playerMetadataLookupKeys(player);
    for (const key of keys) {
      if (!playersByName.has(key)) playersByName.set(key, player);
    }
  }

  return {
    ...rawMetadata,
    teams,
    players,
    agents,
    maps,
    states,
    stateWinrates,
    teamsById,
    playersByPuuid,
    playersByName,
    agentsBySlug,
    mapsBySlug,
    mapsByName,
    statesBySigla,
    stateWinratesByKey,
  };
}

function prepareTeamProfiles(rawTeamProfiles) {
  const fallback = {
    defaults: {
      state: "",
      stateName: "Estado não informado",
      flag: "",
      logo: "",
      socials: {},
      trophies: [],
      rankingHistory: [],
    },
    teams: {},
    assetFolders: {},
  };
  const source = rawTeamProfiles || fallback;
  return {
    defaults: { ...fallback.defaults, ...(source.defaults || {}) },
    teams: source.teams || {},
    assetFolders: source.assetFolders || {},
  };
}

async function loadJson(path) {
  const response = await fetch(encodeURI(path));
  if (!response.ok) throw new Error(`Falha ao carregar ${path}`);
  return response.json();
}

async function loadJsonOptional(path) {
  try {
    return await loadJson(path);
  } catch (error) {
    return null;
  }
}

async function loadEventFiles(events) {
  const rows = [];
  for (const event of events) {
    const files = await Promise.all(
      event.files.map(async (path) => {
        try {
          return { eventId: event.id, path, raw: await loadJson(path) };
        } catch (error) {
          return { eventId: event.id, path, error };
        }
      }),
    );
    rows.push(...files);
  }
  return rows;
}

function buildDatabase(events, loadedFiles, metadata, teamProfiles, rankingWeights) {
  const uniqueMatches = new Map();
  const duplicateFiles = [];
  const failedFiles = loadedFiles.filter((item) => item.error);

  for (const file of loadedFiles.filter((item) => !item.error)) {
    const matchId = file.raw.matchInfo?.matchId || file.path;
    if (uniqueMatches.has(matchId)) {
      duplicateFiles.push(file.path);
      continue;
    }
    uniqueMatches.set(matchId, file);
  }

  const raatingContext = buildRaatingContext([...uniqueMatches.values()]);
  const ratingMetadata = { ...metadata, raatingContext };
  const matches = [...uniqueMatches.values()].map((file) => parseMatchFile(file, ratingMetadata)).filter(Boolean);
  matches.sort((a, b) => b.startedAt - a.startedAt);
  const matchSeries = aggregateMatchSeries(matches);

  const teams = aggregateTeams(matches, ratingMetadata);
  const players = aggregatePlayers(matches, teams, ratingMetadata);
  applyTeamMetadata(teams, players, ratingMetadata, teamProfiles);
  const maps = aggregateMaps(matches, teams);
  const weapons = aggregateWeapons(matches);
  const tournaments = aggregateEvents(events, matches, matchSeries, loadedFiles, duplicateFiles, failedFiles);
  const ranking = applyTeamRankings(teams, matches, matchSeries, players, tournaments, rankingWeights);

  teams.sort(compareTeamsByCanonicalRank);

  return {
    matches,
    matchSeries,
    teams,
    players,
    maps,
    weapons,
    tournaments,
    ranking,
    rankingSnapshots: ranking.snapshots || [],
    rankingWeights,
    duplicateFiles,
    failedFiles,
    metadata: ratingMetadata,
    teamProfiles,
    sourceFileCount: loadedFiles.length,
    uniqueMatchCount: matches.length,
    uniqueSeriesCount: matchSeries.length,
    rankingMinimumMatches: rankingMinimumMatches(rankingWeights),
  };
}

function buildRaatingContext(matchFiles) {
  const killRows = [];
  for (const file of matchFiles || []) {
    const raw = file.raw || {};
    const sideByPuuid = new Map(
      (raw.players || [])
        .filter((player) => !player.isObserver && ["Blue", "Red"].includes(player.teamId) && player.puuid)
        .map((player) => [player.puuid, player.teamId]),
    );
    for (const round of raw.roundResults || []) {
      const bucketByPuuid = new Map();
      for (const row of round.playerStats || []) {
        if (!row.puuid || !sideByPuuid.has(row.puuid)) continue;
        bucketByPuuid.set(row.puuid, RaaRatingCore.ecoBucket(row.economy?.loadoutValue));
      }
      for (const row of round.playerStats || []) {
        for (const kill of row.kills || []) {
          const killer = String(kill.killer || "");
          const victim = String(kill.victim || "");
          if (!killer || !victim || !sideByPuuid.has(killer) || !sideByPuuid.has(victim)) continue;
          if (sideByPuuid.get(killer) === sideByPuuid.get(victim)) continue;
          killRows.push({
            attackerBucket: bucketByPuuid.get(killer),
            victimBucket: bucketByPuuid.get(victim),
          });
        }
      }
    }
  }
  const ecoModel = RaaRatingCore.createEcoModel(killRows);
  return {
    ratingVersion: "raa3",
    ecoModel,
    ecoFallback: ecoModel.hasObservedEco ? "observed_kill_events" : "neutral_1.00",
    ecoObservedKills: killRows.length,
  };
}

function applyTeamRankings(teams, matches, matchSeries, players, tournaments, rankingWeights) {
  const minimumMatches = rankingMinimumMatches(rankingWeights);
  const minimumRosterSize = rankingMinimumRosterSize(rankingWeights);
  const fallback = () => {
    let validIndex = 0;
    teams
      .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.roundDiff - a.roundDiff)
      .forEach((team, index) => {
        const provisional = team.matches < minimumMatches;
        const rosterSize = teamActiveRoster(team).length;
        const inactive = rosterSize < minimumRosterSize;
        const overallRank = index + 1;
        const validRank = provisional || inactive ? null : ++validIndex;
        team.rank = validRank || overallRank;
        team.validRank = validRank;
        team.canonicalRank = validRank;
        team.overallRank = overallRank;
        team.resultPoints = team.points;
        team.rankingScore = clamp(team.points, 0, 100);
        team.ranking = {
          rank: team.rank,
          validRank,
          canonicalRank: validRank,
          overallRank,
          score: team.rankingScore,
          provisional,
          rosterSize,
          inactive,
          blocks: {
            competitive: team.rankingScore,
            achievements: 50,
            recentForm: team.rankingScore,
            rosterStrength: 50,
          },
          components: {
            statisticalModels: team.rankingScore,
            strengthOfSchedule: 50,
            dominance: team.rankingScore,
            consistency: 50,
            relevance: 50,
          },
          models: {},
          diagnostics: { fallback: true },
        };
      });
    const ranking = { teams: teams.map((team) => team.ranking), byTeamId: Object.fromEntries(teams.map((team) => [team.id, team.ranking])), diagnostics: { fallback: true } };
    return { ...ranking, snapshots: [rankingSnapshotShell(Date.now(), ranking, "Fallback")] };
  };

  if (!window.RankingCore?.calculateTeamRankings) return fallback();

  try {
    const snapshots = buildRankingSnapshots({ teams, matches, matchSeries, players, tournaments, rankingWeights });
    const ranking = snapshots[0]?.ranking || calculateRankingForCutoff({ teams, matches, matchSeries, players, tournaments, rankingWeights, cutoffAt: rankingTuesdayStartOnOrBefore(Date.now()) });
    applyRankingResultToTeams(teams, ranking);
    return { ...ranking, snapshots };
  } catch (error) {
    console.error("Falha ao calcular ranking avancado", error);
    return fallback();
  }
}

function calculateRankingForCutoff({ teams, matches, matchSeries, players, tournaments, rankingWeights, cutoffAt }) {
  const filteredMatches = matches.filter((match) => !match.startedAt || match.startedAt <= cutoffAt);
  const filteredSeries = matchSeries.filter((series) => {
    const date = Number(series.sortAt || series.startedAt || 0);
    return !date || date <= cutoffAt;
  });
  const cutoffTeams = teamsForRankingCutoff(teams, filteredMatches, cutoffAt);
  return window.RankingCore.calculateTeamRankings({
    teams: cutoffTeams,
    matches: filteredMatches,
    matchSeries: filteredSeries,
    players,
    tournaments: tournaments.filter(eventIsVisible),
    weights: rankingWeights || {},
    now: cutoffAt,
  });
}

function teamsForRankingCutoff(teams, matches, cutoffAt) {
  return teams.map((team) => {
    const lineup = rankingLineupEntriesForMatches(team, matches, cutoffAt);
    return {
      ...team,
      // O core usa currentLineup para a forca de elenco (observada na semana) e
      // activeRoster para saber se a equipe esta completa hoje.
      activeRoster: teamActiveRoster(team),
      currentLineup: lineup,
      observedLineup: lineup,
      lineup,
    };
  });
}

function buildRankingSnapshots({ teams, matches, matchSeries, players, tournaments, rankingWeights }) {
  return rankingSnapshotCutoffs(matches, matchSeries)
    .map((cutoffAt) => {
      const ranking = calculateRankingForCutoff({ teams, matches, matchSeries, players, tournaments, rankingWeights, cutoffAt });
      return rankingSnapshotShell(cutoffAt, ranking);
    })
    .sort((a, b) => b.cutoffAt - a.cutoffAt);
}

function rankingSnapshotShell(cutoffAt, ranking, label = "") {
  return {
    id: String(cutoffAt),
    cutoffAt,
    label: label || `Semana de ${formatDate(cutoffAt)}`,
    ranking,
    teams: ranking.teams || [],
    byTeamId: ranking.byTeamId || {},
  };
}

function rankingSnapshotCutoffs(matches, matchSeries) {
  const dates = [
    ...matches.map((match) => Number(match.startedAt || 0)),
    ...matchSeries.map((series) => Number(series.sortAt || series.startedAt || 0)),
  ].filter((value) => Number.isFinite(value) && value > 0);
  const latestActiveCutoff = rankingTuesdayStartOnOrBefore(Date.now());
  if (!dates.length) return [latestActiveCutoff];
  const firstCutoff = rankingTuesdayStartOnOrAfter(Math.min(...dates));
  const lastCutoff = Math.max(firstCutoff, latestActiveCutoff);
  const cutoffs = [];
  for (let cutoff = lastCutoff; cutoff >= firstCutoff; cutoff -= WEEK_MS) {
    cutoffs.push(cutoff);
  }
  return cutoffs;
}

function rankingTuesdayStartOnOrBefore(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  const diff = (date.getDay() - RANKING_UPDATE_DAY + 7) % 7;
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function rankingTuesdayStartOnOrAfter(timestamp) {
  const cutoff = rankingTuesdayStartOnOrBefore(timestamp);
  return cutoff < timestamp ? cutoff + WEEK_MS : cutoff;
}

function ensureCurrentRankingSnapshot(db, now = Date.now()) {
  if (!db || !window.RankingCore?.calculateTeamRankings) return false;
  const cutoffAt = rankingTuesdayStartOnOrBefore(now);
  const snapshots = db.rankingSnapshots || [];
  if (snapshots.some((snapshot) => Number(snapshot.cutoffAt || 0) === cutoffAt)) return false;

  try {
    const ranking = calculateRankingForCutoff({
      teams: db.teams || [],
      matches: db.matches || [],
      matchSeries: db.matchSeries || [],
      players: db.players || [],
      tournaments: db.tournaments || [],
      rankingWeights: db.rankingWeights || {},
      cutoffAt,
    });
    const snapshot = rankingSnapshotShell(cutoffAt, ranking);
    delete snapshot.ranking;
    db.rankingSnapshots = [snapshot, ...snapshots].sort((a, b) => Number(b.cutoffAt || 0) - Number(a.cutoffAt || 0));
    db.ranking = ranking;
    applyRankingResultToTeams(db.teams || [], ranking);
    db.teams?.sort(compareTeamsByCanonicalRank);
    return true;
  } catch (error) {
    console.error("Falha ao publicar o snapshot semanal do ranking", error);
    return false;
  }
}

function scheduleRankingWeeklyRefresh() {
  if (!state.db || typeof window.setTimeout !== "function") return;
  if (state.rankingRefreshTimer) window.clearTimeout(state.rankingRefreshTimer);
  const now = Date.now();
  const nextCutoff = rankingTuesdayStartOnOrBefore(now) + WEEK_MS;
  const delay = Math.max(250, nextCutoff - now + 250);
  state.rankingRefreshTimer = window.setTimeout(() => {
    if (ensureCurrentRankingSnapshot(state.db)) {
      state.tournamentRankingCache.clear();
      render();
    }
    scheduleRankingWeeklyRefresh();
  }, delay);
}

function applyRankingResultToTeams(teams, ranking) {
  for (const team of teams) {
    const row = ranking.byTeamId?.[team.id];
    if (!row) continue;
    team.validRank = row.validRank || null;
    team.canonicalRank = row.canonicalRank || row.validRank || null;
    team.overallRank = row.overallRank || row.rank;
    team.rank = team.validRank || team.overallRank;
    team.resultPoints = team.points;
    team.points = row.score;
    team.rankingScore = row.score;
    team.ranking = row;
  }
}

function rankingMinimumMatches(weights) {
  const value = Number(weights?.minimumMatches);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 9;
}

function rankingMinimumRosterSize(weights) {
  const value = Number(weights?.minimumRosterSize);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5;
}

// Elenco atual cadastrado da equipe (metadata/planilha), sem depender de partidas.
function teamActiveRoster(team) {
  return (team?.currentLineup || []).filter((entry) => entry && (entry.playerId || entry.name || entry.handle));
}

function rankingIsInactive(ranking) {
  return Boolean(ranking?.inactive);
}

function rankingIsValid(ranking) {
  return Boolean(ranking) && !ranking.provisional && !rankingIsInactive(ranking);
}

function teamIsRankingValid(team) {
  return rankingIsValid(team.ranking || {});
}

function teamValidRank(team) {
  const value = Number(team.ranking?.validRank ?? team.validRank);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function teamOverallRank(team) {
  const value = Number(team.ranking?.overallRank ?? team.overallRank ?? team.rank);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function compareTeamsByCanonicalRank(a, b) {
  const aValid = teamIsRankingValid(a);
  const bValid = teamIsRankingValid(b);
  if (aValid !== bValid) return Number(bValid) - Number(aValid);
  const aRank = aValid ? teamValidRank(a) : teamOverallRank(a);
  const bRank = bValid ? teamValidRank(b) : teamOverallRank(b);
  return (aRank || 9999) - (bRank || 9999) || b.rankingScore - a.rankingScore || a.name.localeCompare(b.name);
}

function teamCanonicalRankLabel(team) {
  const rank = teamValidRank(team);
  if (rank) return `#${rank}`;
  return rankingIsInactive(team.ranking) ? "Inativo" : "Provisório";
}

function teamShortRankLabel(team) {
  const rank = teamValidRank(team);
  if (rank) return `#${rank}`;
  return rankingIsInactive(team.ranking) ? "inativo" : "prov";
}

function parseMatchFile(file, metadata) {
  const raw = file.raw;
  const meta = parseFileName(file.path);
  if (!meta) return null;

  const red = raw.teams.find((team) => team.teamId === "Red");
  const blue = raw.teams.find((team) => team.teamId === "Blue");
  if (!red || !blue) return null;

  const inferredColors = meta.inferTeamsFromPlayers ? inferTeamColorsFromPlayers(raw.players || [], meta.teamAId, meta.teamBId, metadata) : null;
  const colorForA =
    inferredColors?.teamA ||
    (meta.scoreA === red.roundsWon && meta.scoreB === blue.roundsWon
      ? "Red"
      : meta.scoreA === blue.roundsWon && meta.scoreB === red.roundsWon
        ? "Blue"
        : red.roundsWon >= blue.roundsWon
          ? "Red"
          : "Blue");
  const colorForB = colorForA === "Red" ? "Blue" : "Red";

  const matchRoundStats = aggregateMatchPlayerRoundStats(raw.players || [], raw.roundResults || [], metadata);
  const players = raw.players
    .filter((player) => !player.isObserver)
    .map((player) => normalizeMatchPlayer(player, matchRoundStats.get(player.puuid) || emptyPlayerRoundStats(), metadata));

  const teamA = buildMatchTeam(meta.teamAId, colorForA, colorForA === "Red" ? red.roundsWon : blue.roundsWon, metadata);
  const teamB = buildMatchTeam(meta.teamBId, colorForB, colorForB === "Red" ? red.roundsWon : blue.roundsWon, metadata);
  players.forEach((player) => {
    player.teamId = player.teamColor === teamA.color ? teamA.id : teamB.id;
    player.teamTag = player.teamColor === teamA.color ? teamA.tag : teamB.tag;
    player.agentList = [{ slug: player.agentSlug, name: player.agent, icon: player.agentIcon, role: player.agentClass, rounds: player.rounds }];
  });

  const playerTeamByPuuid = new Map(players.map((player) => [player.puuid, player.teamColor === teamA.color ? teamA.id : teamB.id]));
  const teamStats = calculateMatchTeamStats(raw.roundResults || [], teamA, teamB, playerTeamByPuuid);
  const mapMeta = resolveMapMeta(raw.matchInfo.mapId, meta.map, metadata);
  const mapName = mapMeta.name;
  const startedAt = Number(raw.matchInfo.gameStartMillis || 0);

  return {
    id: raw.matchInfo.matchId,
    eventId: file.eventId,
    sourcePath: file.path,
    fileName: file.path.split("/").pop(),
    code: meta.code,
    seriesCode: meta.seriesCode,
    mapNumber: meta.mapNumber,
    seriesKey: `${file.eventId}-${meta.seriesCode}-${[meta.teamAId, meta.teamBId].sort().join("-")}`,
    startedAt,
    date: startedAt ? new Date(startedAt) : null,
    durationMillis: raw.matchInfo.gameLengthMillis || 0,
    gameVersion: raw.matchInfo.gameVersion || "",
    region: raw.matchInfo.region || "",
    mapId: mapMeta.slug || slugify(mapName),
    mapName,
    mapIcon: mapMeta.icon || "",
    apiMapId: raw.matchInfo.mapId,
    teamA,
    teamB,
    winnerId: teamA.score > teamB.score ? teamA.id : teamB.id,
    loserId: teamA.score > teamB.score ? teamB.id : teamA.id,
    rounds: raw.teams[0]?.roundsPlayed || teamA.score + teamB.score,
    roundResults: raw.roundResults || [],
    sideSummary: matchSideSummary(raw.roundResults || []),
    players,
    teamStats,
    mvp: players.slice().sort((a, b) => Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0))[0],
  };
}

function matchSideSummary(roundResults) {
  const summary = { attackWins: 0, defenseWins: 0 };
  for (const round of roundResults) {
    if (round.winningTeamRole === "Attacker") summary.attackWins += 1;
    else if (round.winningTeamRole === "Defender") summary.defenseWins += 1;
  }
  return summary;
}

function aggregateMatchSeries(matches) {
  const byKey = new Map();
  for (const match of matches) {
    const key = match.seriesKey || match.id;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(match);
  }
  return [...byKey.values()].map(createMatchSeriesSummary).sort((a, b) => b.sortAt - a.sortAt);
}

function createMatchSeriesSummary(matches) {
  const maps = matches.slice().sort(compareSeriesMaps);
  const primary = maps[0];
  const score = seriesMapScore(maps, primary.teamA.id, primary.teamB.id);
  const roundScore = seriesRoundScore(maps, primary.teamA.id, primary.teamB.id);
  const startedAt = maps.map((item) => item.startedAt).filter(Boolean).sort((a, b) => a - b)[0] || primary.startedAt;
  const sortAt = Math.max(...maps.map((item) => item.startedAt || 0), primary.startedAt || 0);
  const players = aggregateMatchPlayers(maps);
  return {
    id: primary.id,
    primaryMatchId: primary.id,
    eventId: primary.eventId,
    code: primary.code,
    seriesCode: primary.seriesCode,
    seriesKey: primary.seriesKey,
    startedAt,
    sortAt,
    durationMillis: maps.reduce((sum, item) => sum + item.durationMillis, 0),
    rounds: maps.reduce((sum, item) => sum + item.rounds, 0),
    teamA: primary.teamA,
    teamB: primary.teamB,
    scoreA: score.a,
    scoreB: score.b,
    roundScoreA: roundScore.a,
    roundScoreB: roundScore.b,
    winnerId: score.a > score.b ? primary.teamA.id : primary.teamB.id,
    loserId: score.a > score.b ? primary.teamB.id : primary.teamA.id,
    mapCount: maps.length,
    maps,
    mapNames: maps.map((item) => item.mapName),
    label: seriesFormatLabel(maps, score),
    mvp: players.slice().sort((a, b) => Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0) || Number(playerSwingPerRound(b) || 0) - Number(playerSwingPerRound(a) || 0))[0],
  };
}

function compareSeriesMaps(a, b) {
  return (a.mapNumber || 1) - (b.mapNumber || 1) || a.startedAt - b.startedAt;
}

function seriesMapScore(matches, teamAId, teamBId) {
  return {
    a: matches.filter((item) => item.winnerId === teamAId).length,
    b: matches.filter((item) => item.winnerId === teamBId).length,
  };
}

function seriesRoundScore(matches, teamAId, teamBId) {
  return {
    a: matches.reduce((sum, item) => sum + scoreForTeamInMatch(item, teamAId), 0),
    b: matches.reduce((sum, item) => sum + scoreForTeamInMatch(item, teamBId), 0),
  };
}

function seriesFormatLabel(matches, score = null) {
  const resolvedScore = score || seriesMapScore(matches, matches[0]?.teamA.id, matches[0]?.teamB.id);
  const mapCount = matches.length;
  const winningMaps = Math.max(resolvedScore.a, resolvedScore.b);
  if (winningMaps >= 3 || mapCount > 3) return "MD5";
  if (mapCount > 1 || winningMaps === 2) return "MD3";
  return "MD1";
}

function buildMatchTeam(id, color, score, metadata) {
  const registered = metadata.teamsById.get(id);
  return {
    id,
    name: registered?.displayName || displayTeamName(id),
    tag: registered?.tag || id,
    shortTag: teamTag(id),
    registered: Boolean(registered),
    color,
    score,
  };
}

function parseFileName(sourcePath) {
  const filename = sourcePath.split("/").pop();
  const stem = filename.replace(/(?:\.json)+$/i, "");
  const tokens = stem.split("_").filter(Boolean);
  const scoreIndex = tokens.findIndex((token, index) => /^\d+$/.test(token) && tokens[index + 1]?.toLowerCase() === "x" && /^\d+$/.test(tokens[index + 2] || ""));
  if (scoreIndex < 2 || scoreIndex + 4 > tokens.length) return parseCompactRivalsFile(stem);

  const beforeScore = tokens.slice(0, scoreIndex);
  const isDateToken = (token) => /^\d{2}-\d{2}-\d{2,4}$/.test(token || "") || /^\d{4}-\d{2}-\d{2}$/.test(token || "");
  let codeIndex = beforeScore.findIndex((token, index) => index > 0 && fileSeriesCodeToken(token) && isDateToken(beforeScore[index + 1]));
  if (codeIndex < 0) codeIndex = beforeScore.findIndex((token, index) => index > 0 && fileSeriesCodeToken(token));
  if (codeIndex < 0) codeIndex = beforeScore.findIndex((token) => fileSeriesCodeToken(token));
  const code = codeIndex >= 0 ? beforeScore[codeIndex] : beforeScore[0];
  let teamAStart = codeIndex >= 0 ? codeIndex + 1 : 1;
  if (isDateToken(beforeScore[teamAStart])) teamAStart += 1;

  const teamA = beforeScore.slice(teamAStart).join("_");
  const teamB = tokens.slice(scoreIndex + 3, -1).join("_");
  const map = tokens[tokens.length - 1];
  if (!teamA || !teamB || !map) return null;

  const series = parseFileSeriesCode(code);
  const suffix = series.suffix;
  return {
    code,
    seriesCode: series.seriesCode,
    mapNumber: suffix ? suffix.charCodeAt(0) - 96 : 1,
    teamAId: teamA,
    teamBId: teamB,
    scoreA: Number(tokens[scoreIndex]),
    scoreB: Number(tokens[scoreIndex + 2]),
    map,
  };
}

function fileSeriesCodeToken(token) {
  return /^(?:[a-z]+)?\d+[a-z]?$/i.test(token || "") || /^final[a-z]?$/i.test(token || "");
}

function parseFileSeriesCode(code) {
  const text = String(code || "");
  const final = text.match(/^(?<series>final)(?<suffix>[a-z])?$/i);
  if (final?.groups) return { seriesCode: final.groups.series.toUpperCase(), suffix: final.groups.suffix?.toLowerCase() || "" };
  const match = text.match(/^(?<series>(?:[a-z]+)?\d+)(?<suffix>[a-z])?$/i);
  return {
    seriesCode: match?.groups?.series || text,
    suffix: match?.groups?.suffix?.toLowerCase() || "",
  };
}

function parseCompactRivalsFile(stem) {
  const match = stem.match(/^Rivals_(?<series>\d+)_(?<suffix>[a-z])_(?<pair>.+)$/i);
  if (!match?.groups) return null;
  const pair = splitCompactTeamPair(match.groups.pair);
  if (!pair) return null;

  const suffix = match.groups.suffix.toLowerCase();
  const seriesCode = match.groups.series;
  return {
    code: `${seriesCode}${suffix}`,
    seriesCode,
    mapNumber: suffix.charCodeAt(0) - 96,
    teamAId: FILENAME_TEAM_ALIASES[pair[0]] || pair[0],
    teamBId: FILENAME_TEAM_ALIASES[pair[1]] || pair[1],
    scoreA: null,
    scoreB: null,
    map: "",
    inferTeamsFromPlayers: true,
  };
}

function splitCompactTeamPair(pair) {
  const compact = normalizeNameKey(pair);
  const aliases = Object.keys(FILENAME_TEAM_ALIASES).sort((a, b) => b.length - a.length);
  for (const left of aliases) {
    for (const right of aliases) {
      if (compact === `${left}x${right}`) return [left, right];
    }
  }
  return null;
}

function inferTeamColorsFromPlayers(players, teamAId, teamBId, metadata) {
  const scores = {
    Red: { teamA: 0, teamB: 0 },
    Blue: { teamA: 0, teamB: 0 },
  };

  for (const player of players) {
    if (player.isObserver || !scores[player.teamId]) continue;
    const registered = resolveRegisteredPlayer(player, metadata);
    const teamIds = [registered?.currentTeam, ...(registered?.teamHistory || [])].filter(Boolean);
    if (teamIds.some((id) => teamIdMatchesAlias(id, teamAId))) scores[player.teamId].teamA += 1;
    if (teamIds.some((id) => teamIdMatchesAlias(id, teamBId))) scores[player.teamId].teamB += 1;
  }

  const directScore = scores.Red.teamA + scores.Blue.teamB;
  const swappedScore = scores.Red.teamB + scores.Blue.teamA;
  if (!directScore && !swappedScore) return null;
  return directScore >= swappedScore ? { teamA: "Red", teamB: "Blue" } : { teamA: "Blue", teamB: "Red" };
}

function resolveRegisteredPlayer(player, metadata) {
  const handle = [player.gameName, player.tagLine].filter(Boolean).join("#");
  return (
    metadata.playersByPuuid.get(player.puuid) ||
    metadata.playersByName.get(normalizeNameKey(handle)) ||
    metadata.playersByName.get(normalizeNameKey(player.gameName || ""))
  );
}

function playerMetadataLookupKeys(player) {
  return [player?.name, ...(player?.nickHistory || [])]
    .map(normalizeNameKey)
    .filter(Boolean);
}

function teamIdMatchesAlias(registeredId, targetId) {
  if (!registeredId || !targetId) return false;
  return registeredId === targetId || registeredId.startsWith(`${targetId}_`) || targetId.startsWith(`${registeredId}_`);
}

function normalizeMatchPlayer(player, roundAgg, metadata) {
  const registered = resolveRegisteredPlayer(player, metadata);
  const agentMeta = resolveAgentMeta(player.characterId, metadata);
  const rounds = player.stats?.roundsPlayed || roundAgg.rounds || 0;
  const kills = player.stats?.kills || 0;
  const deaths = player.stats?.deaths || 0;
  const assists = player.stats?.assists || 0;
  const score = player.stats?.score || 0;
  const damage = roundAgg.damage;
  const adr = rounds ? damage / rounds : 0;
  const acs = rounds ? score / rounds : 0;
  const kd = deaths ? kills / deaths : kills;
  const kpr = rounds ? kills / rounds : 0;
  const dpr = rounds ? deaths / rounds : 0;
  const apr = rounds ? assists / rounds : 0;
  const kastRounds = roundAgg.kastRounds || 0;
  const kastFrac = rounds ? kastRounds / rounds : 0;
  const kast = kastFrac * 100;
  const kastLegacyRounds = roundAgg.kastLegacyRounds ?? kastRounds;
  const kastLegacyFrac = rounds ? kastLegacyRounds / rounds : 0;
  const kastLegacy = kastLegacyFrac * 100;
  const impactTotal = roundAgg.impactTotal || 0;
  const impactRound = rounds ? impactTotal / rounds : 0;
  const impactTotalLegacy = roundAgg.impactTotalLegacy ?? impactTotal;
  const impactRoundLegacy = rounds ? impactTotalLegacy / rounds : 0;
  const headshotTotal = roundAgg.headshots + roundAgg.bodyshots + roundAgg.legshots;

  const output = {
    // id = identidade da pessoa (une contas alternativas via metadata);
    // puuid = conta Riot usada nesta partida (chave para roundResults brutos).
    id: registered ? registered.puuid || `registered-${slugify(registered.name)}` : player.puuid,
    puuid: player.puuid,
    nick: registered?.name || player.gameName || "Jogador",
    apiNick: player.gameName || "Jogador",
    tagLine: player.tagLine || "",
    handle: `${player.gameName || "Jogador"}#${player.tagLine || ""}`,
    registered: Boolean(registered),
    currentTeam: registered?.currentTeam || "",
    teamHistory: registered?.teamHistory || [],
    nickHistory: registered?.nickHistory || [],
    photo: registered?.photo || "",
    teamColor: player.teamId,
    agentId: player.characterId,
    agentSlug: agentMeta.slug,
    agent: agentMeta.name,
    agentClass: agentMeta.role,
    agentIcon: agentMeta.icon,
    rounds,
    roundWins: roundAgg.roundWins || 0,
    roundLosses: roundAgg.roundLosses || 0,
    kills,
    deaths,
    assists,
    score,
    damage,
    adr,
    acs,
    kd,
    kpr,
    dpr,
    apr,
    kast,
    kastFrac,
    kastRounds,
    kastLegacy,
    kastLegacyFrac,
    kastLegacyRounds,
    impactTotal,
    impactRound,
    impactTotalLegacy,
    impactRoundLegacy,
    adjustedRoundSwingTotalPp: roundAgg.adjustedRoundSwingTotalPp ?? impactTotal,
    eKillPoints: roundAgg.eKillPoints ?? kills,
    eDeathPoints: roundAgg.eDeathPoints ?? deaths,
    eDamageTotal: roundAgg.eDamageTotal ?? damage,
    eKastPoints: roundAgg.eKastPoints ?? kastRounds,
    tradedDeaths: roundAgg.tradedDeaths || 0,
    failedTradeDeaths: roundAgg.failedTradeDeaths || 0,
    tradeKills: roundAgg.tradeKills || 0,
    tradeDenials: roundAgg.tradeDenials || 0,
    savedLossRounds: roundAgg.savedLossRounds || 0,
    survivedWinRounds: roundAgg.survivedWinRounds || 0,
    multiKillPoints: roundAgg.multiKillPoints || 0,
    firstKills: roundAgg.firstKills,
    firstDeaths: roundAgg.firstDeaths,
    oneKills: roundAgg.oneKills || 0,
    twoKills: roundAgg.twoKills || 0,
    threeKills: roundAgg.threeKills || 0,
    fourKills: roundAgg.fourKills || 0,
    fiveKills: roundAgg.fiveKills || 0,
    headshots: roundAgg.headshots,
    bodyshots: roundAgg.bodyshots,
    legshots: roundAgg.legshots,
    hs: headshotTotal ? (roundAgg.headshots / headshotTotal) * 100 : 0,
    abilityCasts: player.stats?.abilityCasts || {},
  };
  return applyRaatingFields(output);
}

function aggregateMatchPlayerRoundStats(players, roundResults, metadata) {
  const sideByPuuid = new Map();
  const rosters = { Blue: new Set(), Red: new Set() };
  const stats = new Map();

  for (const player of players) {
    if (player.isObserver || !["Blue", "Red"].includes(player.teamId) || !player.puuid) continue;
    sideByPuuid.set(player.puuid, player.teamId);
    rosters[player.teamId].add(player.puuid);
    stats.set(player.puuid, emptyPlayerRoundStats());
  }

  for (const round of roundResults) {
    const playerStats = round.playerStats || [];
    const armorExtraByPuuid = new Map();
    const ecoBucketByPuuid = new Map();
    const damageByVictim = new Map();
    const damageByReceiver = new Map();
    const participants = new Set();
    const killsCountRound = new Map();
    const assistantSet = new Set();
    const victimsSet = new Set();
    const events = [];
    const eventsSeen = new Set();

    for (const row of playerStats) {
      const puuid = row.puuid;
      if (!puuid || !sideByPuuid.has(puuid)) continue;
      participants.add(puuid);
      armorExtraByPuuid.set(puuid, armorExtraHp(row.economy?.armor));
      ecoBucketByPuuid.set(puuid, RaaRatingCore.ecoBucket(row.economy?.loadoutValue));

      for (const damage of row.damage || []) {
        const receiver = damage.receiver;
        const amount = Number(damage.damage || 0);
        if (!receiver || amount <= 0 || !sideByPuuid.has(receiver)) continue;
        if (receiver === puuid || sideByPuuid.get(receiver) === sideByPuuid.get(puuid)) continue;

        incrementNestedNumber(damageByVictim, receiver, puuid, amount);
        addNestedSetValue(damageByReceiver, receiver, puuid);

        const agg = stats.get(puuid);
        agg.headshots += Number(damage.headshots || 0);
        agg.bodyshots += Number(damage.bodyshots || 0);
        agg.legshots += Number(damage.legshots || 0);
      }

      const kills = row.kills || [];
      killsCountRound.set(puuid, (killsCountRound.get(puuid) || 0) + kills.length);
      for (const kill of kills) {
        const time = kill.timeSinceRoundStartMillis;
        if (time === null || time === undefined) continue;
        const victim = String(kill.victim || "");
        let killer = String(kill.killer || "");
        if (!victim || !sideByPuuid.has(victim)) continue;
        if (!killer || !sideByPuuid.has(killer)) killer = "";
        const key = `${Number(time)}|${killer}|${victim}`;
        if (eventsSeen.has(key)) continue;
        eventsSeen.add(key);
        const assistants = (kill.assistants || []).map(String).filter((item) => sideByPuuid.has(item));
        events.push({ time: Number(time), killer, victim, assistants });
        victimsSet.add(victim);
        assistants.forEach((assistant) => assistantSet.add(assistant));
      }
    }

    for (const puuid of participants) {
      const agg = stats.get(puuid);
      agg.rounds += 1;
      if (round.winningTeam === sideByPuuid.get(puuid)) agg.roundWins += 1;
      else if (["Blue", "Red"].includes(round.winningTeam)) agg.roundLosses += 1;
    }

    events.sort((a, b) => a.time - b.time);
    for (const event of events) {
      event.ecoMultiplier = RaaRatingCore.ecoMultiplier(
        metadata.raatingContext?.ecoModel,
        ecoBucketByPuuid.get(event.killer),
        ecoBucketByPuuid.get(event.victim),
      );
    }
    applyFirstDuelStats(events, stats, sideByPuuid);
    applyEffectiveDamage(damageByVictim, armorExtraByPuuid, events, stats, ecoBucketByPuuid, metadata.raatingContext?.ecoModel);
    applyEcoKillDeathStats(events, stats);
    applyRoundSwingStats(events, participants, round, stats, sideByPuuid, rosters, metadata);
    applyKastStats(events, participants, killsCountRound, assistantSet, victimsSet, damageByReceiver, stats, sideByPuuid, round.winningTeam);
    applyMultiKillStats(participants, killsCountRound, stats);
  }

  return stats;
}

function emptyPlayerRoundStats() {
  return {
    rounds: 0,
    roundWins: 0,
    roundLosses: 0,
    damage: 0,
    eDamageTotal: 0,
    eKillPoints: 0,
    eDeathPoints: 0,
    eKastPoints: 0,
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
    firstKills: 0,
    firstDeaths: 0,
    kastRounds: 0,
    kastLegacyRounds: 0,
    impactTotal: 0,
    impactTotalLegacy: 0,
    adjustedRoundSwingTotalPp: 0,
    tradedDeaths: 0,
    failedTradeDeaths: 0,
    tradeKills: 0,
    tradeDenials: 0,
    savedLossRounds: 0,
    survivedWinRounds: 0,
    multiKillPoints: 0,
    oneKills: 0,
    twoKills: 0,
    threeKills: 0,
    fourKills: 0,
    fiveKills: 0,
  };
}

function armorExtraHp(armorId) {
  const key = String(armorId || "").trim().toUpperCase();
  if (Object.hasOwn(ARMOR_EXTRA_HP, key)) return ARMOR_EXTRA_HP[key];
  return key ? 50 : 0;
}

function incrementNestedNumber(map, key, nestedKey, amount) {
  if (!map.has(key)) map.set(key, new Map());
  const nested = map.get(key);
  nested.set(nestedKey, (nested.get(nestedKey) || 0) + amount);
}

function addNestedSetValue(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function applyFirstDuelStats(events, stats, sideByPuuid) {
  if (!events.length) return;
  const firstTime = events[0].time;
  for (const event of events) {
    if (event.time !== firstTime) break;
    if (event.killer && stats.has(event.killer)) stats.get(event.killer).firstKills += 1;
    if (event.victim && sideByPuuid.has(event.victim) && stats.has(event.victim)) stats.get(event.victim).firstDeaths += 1;
  }
}

function applyEffectiveDamage(damageByVictim, armorExtraByPuuid, events, stats, ecoBucketByPuuid, ecoModel) {
  const killerOfVictim = new Map();
  const killerTime = new Map();
  for (const event of events) {
    if (!event.victim || !event.killer) continue;
    const previous = killerTime.get(event.victim);
    if (previous === undefined || event.time > previous) {
      killerTime.set(event.victim, event.time);
      killerOfVictim.set(event.victim, event.killer);
    }
  }

  for (const [victim, byAttacker] of damageByVictim.entries()) {
    const rawTotal = [...byAttacker.values()].reduce((sum, value) => sum + value, 0);
    if (rawTotal <= 0) continue;
    const cap = 100 + (armorExtraByPuuid.get(victim) ?? 50);
    let over = rawTotal - cap;
    const effective = new Map(byAttacker);

    if (over > 0) {
      let last = killerOfVictim.get(victim);
      if (!last || !effective.has(last)) {
        last = [...effective.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      }
      if (last) {
        const take = Math.min(over, effective.get(last) || 0);
        effective.set(last, Math.max(0, (effective.get(last) || 0) - take));
        over -= take;
      }
      if (over > 0) {
        for (const [attacker, value] of [...effective.entries()].sort((a, b) => b[1] - a[1])) {
          if (attacker === last || over <= 0) continue;
          const take = Math.min(over, value);
          effective.set(attacker, Math.max(0, value - take));
          over -= take;
        }
      }
    }

    for (const [attacker, damage] of effective.entries()) {
      if (damage > 0 && stats.has(attacker)) {
        const ecoMultiplier = RaaRatingCore.ecoMultiplier(ecoModel, ecoBucketByPuuid?.get(attacker), ecoBucketByPuuid?.get(victim));
        const adjustedDamage = damage * RaaRatingCore.reducedEcoMultiplier(ecoMultiplier, 0.5);
        stats.get(attacker).damage += damage;
        stats.get(attacker).eDamageTotal += adjustedDamage;
      }
    }
  }
}

function applyEcoKillDeathStats(events, stats) {
  for (const event of events) {
    const multiplier = RaaRatingCore.finiteNumber(event.ecoMultiplier, 1);
    if (event.killer && stats.has(event.killer)) stats.get(event.killer).eKillPoints += multiplier;
    if (event.victim && stats.has(event.victim)) stats.get(event.victim).eDeathPoints += multiplier;
  }
}

function applyRoundSwingStats(events, participants, round, stats, sideByPuuid, rosters, metadata) {
  const alive = {
    Blue: new Set(rosters.Blue),
    Red: new Set(rosters.Red),
  };
  const roundSwing = new Map([...participants].map((puuid) => [puuid, 0]));
  const legacySwing = new Map([...participants].map((puuid) => [puuid, 0]));
  const addSwing = (map, puuid, amount) => {
    if (!puuid || !map.has(puuid)) return;
    map.set(puuid, map.get(puuid) + amount);
  };

  for (const event of events) {
    const victim = event.victim;
    if (!victim || !sideByPuuid.has(victim)) continue;

    const victimSide = alive.Blue.has(victim) ? "Blue" : alive.Red.has(victim) ? "Red" : "";
    if (!victimSide) continue;
    const enemySide = victimSide === "Blue" ? "Red" : "Blue";
    const deathSwing = deltaDeathPp(metadata, alive[victimSide].size, alive[enemySide].size);
    addSwing(roundSwing, victim, deathSwing);
    addSwing(legacySwing, victim, deathSwing);

    const killer = event.killer;
    if (killer && sideByPuuid.has(killer) && stats.has(killer)) {
      const killerSide = sideByPuuid.get(killer);
      const killerEnemySide = killerSide === "Blue" ? "Red" : "Blue";
      const killSwing = deltaKillPp(metadata, alive[killerSide].size, alive[killerEnemySide].size);
      addSwing(roundSwing, killer, killSwing);
      addSwing(legacySwing, killer, killSwing);
    }

    alive[victimSide].delete(victim);
  }

  const winningTeam = ["Blue", "Red"].includes(round.winningTeam) ? round.winningTeam : "";
  if (winningTeam) {
    const losingTeam = winningTeam === "Blue" ? "Red" : "Blue";
    const winnerAlive = alive[winningTeam];
    const loserAlive = alive[losingTeam];
    const winnerParticipants = [...participants].filter((puuid) => sideByPuuid.get(puuid) === winningTeam);
    const loserParticipants = [...participants].filter((puuid) => sideByPuuid.get(puuid) === losingTeam);
    const winnerCreditTargets = (winnerAlive.size ? [...winnerAlive] : winnerParticipants).filter((puuid) => roundSwing.has(puuid));
    const loserDebitTargets = (loserAlive.size ? [...loserAlive] : loserParticipants).filter((puuid) => roundSwing.has(puuid));
    const residual = Math.max(0, (1 - stateWinRate(metadata, winnerAlive.size, loserAlive.size)) * 100);
    if (residual > 0 && winnerCreditTargets.length && loserDebitTargets.length) {
      const credit = residual / winnerCreditTargets.length;
      const debit = residual / loserDebitTargets.length;
      winnerCreditTargets.forEach((puuid) => addSwing(roundSwing, puuid, credit));
      loserDebitTargets.forEach((puuid) => addSwing(roundSwing, puuid, -debit));
    }
  }

  const total = [...roundSwing.values()].reduce((sum, value) => sum + value, 0);
  if (Math.abs(total) > 1e-6 && roundSwing.size) {
    const correction = total / roundSwing.size;
    for (const puuid of roundSwing.keys()) addSwing(roundSwing, puuid, -correction);
  }

  for (const [puuid, value] of roundSwing.entries()) {
    if (!stats.has(puuid)) continue;
    stats.get(puuid).impactTotal += value;
    stats.get(puuid).adjustedRoundSwingTotalPp += value;
  }
  for (const [puuid, value] of legacySwing.entries()) {
    if (stats.has(puuid)) stats.get(puuid).impactTotalLegacy += value;
  }
}

function applyKastStats(events, participants, killsCountRound, assistantSet, victimsSet, damageByReceiver, stats, sideByPuuid, winningTeam) {
  const deathsByVictim = new Map();
  const deathTimeByVictim = new Map();
  const tradeKillEvents = new Set();
  const tradedDeaths = new Set();
  const failedTradeDeaths = new Set();
  const kastEcoMultipliers = new Map();
  const addKastMultiplier = (puuid, multiplier) => {
    if (!puuid || !stats.has(puuid)) return;
    if (!kastEcoMultipliers.has(puuid)) kastEcoMultipliers.set(puuid, []);
    kastEcoMultipliers.get(puuid).push(RaaRatingCore.reducedEcoMultiplier(multiplier, 0.35));
  };

  for (const event of events) {
    if (!event.victim) continue;
    if (!deathsByVictim.has(event.victim)) deathsByVictim.set(event.victim, []);
    deathsByVictim.get(event.victim).push(event);
    const current = deathTimeByVictim.get(event.victim);
    if (current === undefined || event.time < current) deathTimeByVictim.set(event.victim, event.time);
    if (event.killer) addKastMultiplier(event.killer, event.ecoMultiplier);
    for (const assistant of event.assistants || []) addKastMultiplier(assistant, event.ecoMultiplier);
  }

  for (const [victim, deaths] of deathsByVictim.entries()) {
    const victimSide = sideByPuuid.get(victim);
    for (const death of deaths) {
      const involved = new Set();
      if (death.killer) involved.add(death.killer);
      for (const assistant of death.assistants || []) involved.add(assistant);
      (damageByReceiver.get(victim) || new Set()).forEach((attacker) => involved.add(attacker));

      const validInvolved = [...involved].filter((item) => sideByPuuid.has(item) && sideByPuuid.get(item) !== victimSide);
      if (!validInvolved.length) continue;

      const tradeLimit = death.time + TRADE_WINDOW_MS;
      let tradedBy = "";
      for (const event of events) {
        if (event.time <= death.time) continue;
        if (event.time > tradeLimit) break;
        if (sideByPuuid.get(event.killer) === victimSide && validInvolved.includes(event.victim)) {
          tradedBy = event.killer;
          tradeKillEvents.add(event);
          break;
        }
      }

      if (tradedBy) {
        tradedDeaths.add(victim);
        addKastMultiplier(victim, death.ecoMultiplier);
        if (stats.has(victim)) stats.get(victim).tradedDeaths += 1;
        if (stats.has(tradedBy)) stats.get(tradedBy).tradeKills += 1;
      } else if (teamHasAliveMateAfter(victim, victimSide, death.time, participants, sideByPuuid, deathTimeByVictim)) {
        failedTradeDeaths.add(victim);
        if (stats.has(victim)) stats.get(victim).failedTradeDeaths += 1;
      }
    }
  }

  for (const event of events) {
    if (!event.killer || !event.victim || !stats.has(event.killer)) continue;
    const killerSide = sideByPuuid.get(event.killer);
    const victimSide = sideByPuuid.get(event.victim);
    if (!killerSide || !victimSide || killerSide === victimSide) continue;
    const tradeLimit = event.time + TRADE_WINDOW_MS;
    const victimTeamCanTrade = [...participants].some((puuid) => {
      if (puuid === event.victim || sideByPuuid.get(puuid) !== victimSide) return false;
      const deathTime = deathTimeByVictim.get(puuid);
      return deathTime === undefined || deathTime > event.time;
    });
    if (!victimTeamCanTrade) continue;
    const killerWasTraded = events.some((candidate) => {
      if (candidate.time <= event.time || candidate.time > tradeLimit) return false;
      return candidate.victim === event.killer && sideByPuuid.get(candidate.killer) === victimSide;
    });
    if (!killerWasTraded && !tradeKillEvents.has(event)) stats.get(event.killer).tradeDenials += 1;
  }

  for (const puuid of participants) {
    const side = sideByPuuid.get(puuid);
    const killCond = (killsCountRound.get(puuid) || 0) > 0;
    const assistCond = assistantSet.has(puuid);
    const survivedCond = !victimsSet.has(puuid);
    const survivedWinCond = survivedCond && side === winningTeam;
    const savedLossCond = survivedCond && ["Blue", "Red"].includes(winningTeam) && side !== winningTeam;
    const tradedCond = tradedDeaths.has(puuid);
    if (survivedWinCond) {
      stats.get(puuid).survivedWinRounds += 1;
      addKastMultiplier(puuid, 1);
    }
    if (savedLossCond) stats.get(puuid).savedLossRounds += 1;
    if (killCond || assistCond || survivedCond || tradedCond) stats.get(puuid).kastLegacyRounds += 1;
    if (killCond || assistCond || survivedWinCond || tradedCond) {
      stats.get(puuid).kastRounds += 1;
      const multipliers = kastEcoMultipliers.get(puuid) || [];
      stats.get(puuid).eKastPoints += multipliers.length ? Math.max(...multipliers) : 1;
    }
  }
}

function teamHasAliveMateAfter(victim, victimSide, time, participants, sideByPuuid, deathTimeByVictim) {
  return [...participants].some((puuid) => {
    if (puuid === victim || sideByPuuid.get(puuid) !== victimSide) return false;
    const deathTime = deathTimeByVictim.get(puuid);
    return deathTime === undefined || deathTime > time;
  });
}

function applyMultiKillStats(participants, killsCountRound, stats) {
  for (const puuid of participants) {
    const kills = killsCountRound.get(puuid) || 0;
    if (kills === 1) stats.get(puuid).oneKills += 1;
    if (kills === 2) stats.get(puuid).twoKills += 1;
    if (kills === 3) stats.get(puuid).threeKills += 1;
    if (kills === 4) stats.get(puuid).fourKills += 1;
    if (kills >= 5) stats.get(puuid).fiveKills += 1;
    stats.get(puuid).multiKillPoints += RaaRatingCore.multiKillPointsForKills(kills);
  }
}

function stateWinRate(metadata, allies, enemies) {
  if (allies <= 0) return 0;
  if (enemies <= 0) return 1;
  return Number(metadata.stateWinratesByKey?.get(`${allies}v${enemies}`) ?? 0.5);
}

function deltaKillPp(metadata, allies, enemies) {
  return (stateWinRate(metadata, allies, enemies - 1) - stateWinRate(metadata, allies, enemies)) * 100;
}

function deltaDeathPp(metadata, allies, enemies) {
  return (stateWinRate(metadata, allies - 1, enemies) - stateWinRate(metadata, allies, enemies)) * 100;
}

function applyRaatingFields(row) {
  const applied = RaaRatingCore.applyRatingFields(row);
  return applyRaatingAliases(applied);
}

function applyRaatingAliases(row) {
  row.opening_kills = Number(row.firstKills ?? row.opening_kills ?? 0);
  row.opening_deaths = Number(row.firstDeaths ?? row.opening_deaths ?? 0);
  row.fk_fd_diff = row.opening_kills - row.opening_deaths;
  row.multi_kill_rounds = Number(row.twoKills || 0) + Number(row.threeKills || 0) + Number(row.fourKills || 0) + Number(row.fiveKills || 0);
  return row;
}

function calculateMatchTeamStats(roundResults, teamA, teamB, playerTeamByPuuid) {
  const teamByColor = {
    [teamA.color]: teamA.id,
    [teamB.color]: teamB.id,
  };
  const rows = {
    [teamA.id]: emptyTeamRoundStats(),
    [teamB.id]: emptyTeamRoundStats(),
  };

  for (const round of roundResults) {
    const winnerId = teamByColor[round.winningTeam];
    const loserColor = round.winningTeam === "Red" ? "Blue" : "Red";
    const loserId = teamByColor[loserColor];
    const winnerRole = round.winningTeamRole;
    const loserRole = winnerRole === "Attacker" ? "Defender" : "Attacker";
    if (winnerId) {
      rows[winnerId].roundWins += 1;
      rows[winnerId][winnerRole === "Attacker" ? "attackWins" : "defenseWins"] += 1;
      rows[winnerId][winnerRole === "Attacker" ? "attackRounds" : "defenseRounds"] += 1;
    }
    if (loserId) {
      rows[loserId][loserRole === "Attacker" ? "attackRounds" : "defenseRounds"] += 1;
    }
    if (round.roundNum === 0 || round.roundNum === 12) {
      if (winnerId) rows[winnerId].pistolWins += 1;
      if (teamA.id) rows[teamA.id].pistolRounds += 1;
      if (teamB.id) rows[teamB.id].pistolRounds += 1;
    }

    const kills = (round.playerStats || []).flatMap((item) => item.kills || []);
    if (kills.length) {
      const firstKill = kills.slice().sort((a, b) => a.timeSinceRoundStartMillis - b.timeSinceRoundStartMillis)[0];
      const killerTeamId = playerTeamByPuuid.get(firstKill.killer);
      if (killerTeamId) rows[killerTeamId].firstKills += 1;
    }
  }

  return rows;
}

function emptyTeamRoundStats() {
  return {
    roundWins: 0,
    attackWins: 0,
    attackRounds: 0,
    defenseWins: 0,
    defenseRounds: 0,
    pistolWins: 0,
    pistolRounds: 0,
    firstKills: 0,
  };
}

function aggregateTeams(matches, metadata) {
  const byId = new Map();
  for (const match of matches) {
    const sides = [
      { team: match.teamA, opponent: match.teamB },
      { team: match.teamB, opponent: match.teamA },
    ];
    for (const side of sides) {
      const row = ensureTeam(byId, side.team);
      const won = match.winnerId === row.id;
      row.matches += 1;
      row.wins += won ? 1 : 0;
      row.losses += won ? 0 : 1;
      row.roundsWon += side.team.score;
      row.roundsLost += side.opponent.score;
      row.roundDiff += side.team.score - side.opponent.score;
      row.maps.set(match.mapName, updateCount(row.maps.get(match.mapName), won));
      row.opponents.set(side.opponent.id, updateCount(row.opponents.get(side.opponent.id), won));

      const observedPlayers = match.players.filter((player) => player.teamColor === side.team.color);
      for (const player of observedPlayers) {
        if (!row.players.has(player.id)) row.players.set(player.id, player.handle);
      }

      const roundStats = match.teamStats[row.id] || emptyTeamRoundStats();
      row.attackWins += roundStats.attackWins;
      row.attackRounds += roundStats.attackRounds;
      row.defenseWins += roundStats.defenseWins;
      row.defenseRounds += roundStats.defenseRounds;
      row.pistolWins += roundStats.pistolWins;
      row.pistolRounds += roundStats.pistolRounds;
      row.firstKills += roundStats.firstKills;
    }
  }

  for (const registeredTeam of metadata.teams) {
    ensureTeam(byId, {
      id: registeredTeam.id,
      name: registeredTeam.displayName,
      tag: registeredTeam.tag,
      shortTag: teamTag(registeredTeam.id),
      registered: true,
    });
  }

  return [...byId.values()]
    .map((team) => {
      team.winRate = pctValue(team.wins, team.matches);
      team.points = team.wins * 3 + team.roundDiff / 10;
      team.mapStats = [...team.maps.entries()]
        .map(([name, row]) => ({ name, wins: row.wins, matches: row.matches, winRate: pctValue(row.wins, row.matches) }))
        .sort((a, b) => b.winRate - a.winRate || b.matches - a.matches);
      team.opponentStats = [...team.opponents.entries()]
        .map(([id, row]) => ({ id, wins: row.wins, matches: row.matches, losses: row.matches - row.wins, winRate: pctValue(row.wins, row.matches) }))
        .sort((a, b) => b.matches - a.matches || b.winRate - a.winRate);
      team.lineup = [...team.players.entries()].map(([id, handle]) => ({ id, handle }));
      team.attackWinRate = pctValue(team.attackWins, team.attackRounds);
      team.defenseWinRate = pctValue(team.defenseWins, team.defenseRounds);
      team.pistolWinRate = pctValue(team.pistolWins, team.pistolRounds);
      return team;
    })
    .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.roundDiff - a.roundDiff);
}

function ensureTeam(map, side) {
  if (!map.has(side.id)) {
    map.set(side.id, {
      id: side.id,
      name: side.name,
      tag: side.tag,
      sourceTag: side.tag || side.id,
      shortTag: side.shortTag || teamTag(side.id),
      registered: Boolean(side.registered),
      colors: teamColors(side.id),
      matches: 0,
      wins: 0,
      losses: 0,
      roundsWon: 0,
      roundsLost: 0,
      roundDiff: 0,
      points: 0,
      players: new Map(),
      maps: new Map(),
      opponents: new Map(),
      attackWins: 0,
      attackRounds: 0,
      defenseWins: 0,
      defenseRounds: 0,
      pistolWins: 0,
      pistolRounds: 0,
      firstKills: 0,
    });
  }
  return map.get(side.id);
}

function updateCount(row = { wins: 0, matches: 0 }, won) {
  return {
    wins: row.wins + (won ? 1 : 0),
    matches: row.matches + 1,
  };
}

const RAATING_AGGREGATE_FIELDS = [
  "roundWins",
  "roundLosses",
  "eKillPoints",
  "eDeathPoints",
  "eDamageTotal",
  "eKastPoints",
  "kastLegacyRounds",
  "impactTotalLegacy",
  "adjustedRoundSwingTotalPp",
  "tradedDeaths",
  "failedTradeDeaths",
  "tradeKills",
  "tradeDenials",
  "savedLossRounds",
  "survivedWinRounds",
  "multiKillPoints",
  "oneKills",
  "twoKills",
  "threeKills",
  "fourKills",
  "fiveKills",
];

function emptyRaatingAggregateFields() {
  return Object.fromEntries(RAATING_AGGREGATE_FIELDS.map((field) => [field, 0]));
}

function addRaatingAggregateFields(row, player) {
  for (const field of RAATING_AGGREGATE_FIELDS) {
    row[field] = Number(row[field] || 0) + Number(player?.[field] || 0);
  }
}

function emptyPlayerStatTotals() {
  return {
    matches: 0,
    rounds: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    score: 0,
    damage: 0,
    firstKills: 0,
    firstDeaths: 0,
    kastRounds: 0,
    impactTotal: 0,
    ...emptyRaatingAggregateFields(),
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
  };
}

function addPlayerMatchTotals(row, player) {
  row.matches += 1;
  row.rounds += player.rounds;
  row.kills += player.kills;
  row.deaths += player.deaths;
  row.assists += player.assists;
  row.score += player.score;
  row.damage += player.damage;
  row.firstKills += player.firstKills;
  row.firstDeaths += player.firstDeaths;
  row.kastRounds += player.kastRounds;
  row.impactTotal += player.impactTotal;
  addRaatingAggregateFields(row, player);
  row.headshots += player.headshots;
  row.bodyshots += player.bodyshots;
  row.legshots += player.legshots;
}

function finalizePlayerStatRow(row) {
  row.acs = row.rounds ? row.score / row.rounds : 0;
  row.adr = row.rounds ? row.damage / row.rounds : 0;
  row.kpr = row.rounds ? row.kills / row.rounds : 0;
  row.dpr = row.rounds ? row.deaths / row.rounds : 0;
  row.apr = row.rounds ? row.assists / row.rounds : 0;
  row.kd = row.deaths ? row.kills / row.deaths : row.kills;
  row.kastFrac = row.rounds ? row.kastRounds / row.rounds : 0;
  row.kast = row.kastFrac * 100;
  row.impactRound = row.rounds ? row.impactTotal / row.rounds : 0;
  row.impactRoundLegacy = row.rounds ? Number(row.impactTotalLegacy || 0) / row.rounds : 0;
  row.kastLegacyFrac = row.rounds ? Number(row.kastLegacyRounds || 0) / row.rounds : row.kastFrac;
  row.kastLegacy = row.kastLegacyFrac * 100;
  applyRaatingFields(row);
  const shots = row.headshots + row.bodyshots + row.legshots;
  row.hs = shots ? (row.headshots / shots) * 100 : 0;
  return row;
}

// Stats do jogador restritas aos mapas jogados por uma equipe específica
// (perfil da equipe). Sem passagem registrada, retorna uma linha zerada.
function playerStatsForTeam(player, teamId) {
  const stint = (player?.teamStats || []).find((row) => row.teamId === teamId);
  return stint || finalizePlayerStatRow({ teamId, ...emptyPlayerStatTotals() });
}

function aggregatePlayers(matches, teams, metadata) {
  const teamByObservedPlayer = new Map();
  teams.forEach((team) => team.lineup.forEach((player) => teamByObservedPlayer.set(player.id, team.id)));

  const byId = new Map();
  const teamTotalsByRow = new Map();
  for (const match of matches) {
    for (const player of match.players) {
      const teamId = match.teamA.color === player.teamColor ? match.teamA.id : match.teamB.id;
      const row = ensurePlayer(byId, player, teamId);
      addPlayerMatchTotals(row, player);
      let rowTeamTotals = teamTotalsByRow.get(row);
      if (!rowTeamTotals) teamTotalsByRow.set(row, (rowTeamTotals = new Map()));
      let stint = rowTeamTotals.get(teamId);
      if (!stint) rowTeamTotals.set(teamId, (stint = emptyPlayerStatTotals()));
      addPlayerMatchTotals(stint, player);
      row.teams.set(teamId, (row.teams.get(teamId) || 0) + 1);
      row.agents.set(player.agentSlug || player.agent, updateAgentBucket(row.agents.get(player.agentSlug || player.agent), player));
      row.maps.set(match.mapName, updateStatBucket(row.maps.get(match.mapName), player.rating, player.acs, player.rounds));
      row.events.set(match.eventId, updateStatBucket(row.events.get(match.eventId), player.rating, player.acs, player.rounds));
      row.recent.push({ matchId: match.id, rating: player.rating, acs: player.acs, kills: player.kills, deaths: player.deaths, assists: player.assists });
    }
  }

  for (const registeredPlayer of metadata.players) {
    const existingPlayer = findAggregatedPlayerForMetadata(byId, registeredPlayer);
    if (existingPlayer) {
      mergeRegisteredPlayerMetadata(existingPlayer, registeredPlayer);
      continue;
    }
    ensurePlayer(byId, playerFromMetadata(registeredPlayer), registeredPlayer.currentTeam);
  }

  const players = [...byId.values()]
    .map((player) => {
      const observedTeamId = [...player.teams.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || teamByObservedPlayer.get(player.id);
      player.observedTeamId = observedTeamId || "";
      player.teamId = player.currentTeam || observedTeamId || "";
      finalizePlayerStatRow(player);
      player.teamStats = [...(teamTotalsByRow.get(player)?.entries() || [])]
        .map(([teamId, stint]) => finalizePlayerStatRow({ teamId, ...stint }))
        .sort((a, b) => b.matches - a.matches || b.rounds - a.rounds);
      player.agentStats = [...player.agents.values()]
        .map((agent) => ({ ...agent, rate: pctValue(agent.rounds, player.rounds) }))
        .sort((a, b) => b.rounds - a.rounds);
      player.mapStats = [...player.maps.entries()]
        .map(([name, bucket]) => ({ name, rating: bucket.rounds ? bucket.rating / bucket.rounds : bucket.rating / bucket.matches, acs: bucket.rounds ? bucket.acs / bucket.rounds : bucket.acs / bucket.matches, matches: bucket.matches }))
        .sort((a, b) => b.rating - a.rating);
      player.eventStats = [...player.events.entries()]
        .map(([eventId, bucket]) => ({ eventId, rating: bucket.rounds ? bucket.rating / bucket.rounds : bucket.rating / bucket.matches, acs: bucket.rounds ? bucket.acs / bucket.rounds : bucket.acs / bucket.matches, matches: bucket.matches }))
        .sort((a, b) => b.matches - a.matches);
      player.recent = player.recent.slice(-6).reverse();
      return player;
    })
    .sort((a, b) => Number(b.matches > 0) - Number(a.matches > 0) || Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0) || b.kills - a.kills || a.nick.localeCompare(b.nick));
  assignPlayerRouteSlugs(players);
  return players;
}

function findAggregatedPlayerForMetadata(playersById, registeredPlayer) {
  if (registeredPlayer.puuid && playersById.has(registeredPlayer.puuid)) return playersById.get(registeredPlayer.puuid);
  const metadataKeys = new Set(playerMetadataLookupKeys(registeredPlayer));
  if (!metadataKeys.size) return null;
  return [...playersById.values()].find((player) => playerLookupKeys(player).some((key) => metadataKeys.has(key))) || null;
}

function mergeRegisteredPlayerMetadata(player, registeredPlayer) {
  player.registered = true;
  player.nick = registeredPlayer.name || player.nick;
  player.currentTeam = registeredPlayer.currentTeam || player.currentTeam || "";
  player.teamHistory = uniqueValues([...(player.teamHistory || []), ...(registeredPlayer.teamHistory || [])]);
  player.nickHistory = uniqueValues([...(player.nickHistory || []), ...(registeredPlayer.nickHistory || [])]);
  player.photo = player.photo || registeredPlayer.photo || "";
}

function playerLookupKeys(player) {
  return [player?.nick, player?.apiNick, player?.handle, ...(player?.nickHistory || [])]
    .map(normalizeNameKey)
    .filter(Boolean);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function assignPlayerRouteSlugs(players) {
  const used = new Set();
  for (const player of players) {
    const base = playerRouteSlugBase(player);
    let routeSlug = base;
    let suffix = 2;
    while (used.has(routeSlug)) {
      routeSlug = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(routeSlug);
    player.routeSlug = routeSlug;
  }
}

function playerRouteSlugBase(player) {
  return slugify(player?.nick || String(player?.handle || "").split("#")[0] || player?.apiNick || player?.id || "player") || "player";
}

function playerFromMetadata(player) {
  return {
    id: player.puuid || `registered-${slugify(player.name)}`,
    puuid: player.puuid || "",
    nick: player.name,
    apiNick: "",
    tagLine: "",
    handle: player.nickHistory?.[0] || player.name,
    registered: true,
    currentTeam: player.currentTeam || "",
    teamHistory: player.teamHistory || [],
    nickHistory: player.nickHistory || [],
    photo: player.photo || "",
    teamColor: "",
    agentId: "",
    agentSlug: "",
    agent: "",
    agentClass: "",
    agentIcon: "",
    rounds: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    score: 0,
    damage: 0,
    adr: 0,
    acs: 0,
    kpr: 0,
    dpr: 0,
    apr: 0,
    kd: 0,
    kast: 0,
    kastFrac: 0,
    kastRounds: 0,
    kastLegacy: 0,
    kastLegacyFrac: 0,
    kastLegacyRounds: 0,
    impactTotal: 0,
    impactRound: 0,
    impactTotalLegacy: 0,
    impactRoundLegacy: 0,
    rating: 0,
    raating_1: 0,
    raating_3: 0,
    rating_version: "raa3",
    sample_status: "LOW",
    ...emptyRaatingAggregateFields(),
    firstKills: 0,
    firstDeaths: 0,
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
    hs: 0,
    abilityCasts: {},
  };
}

function ensurePlayer(map, player, teamId) {
  if (!map.has(player.id)) {
    map.set(player.id, {
      id: player.id,
      puuid: player.puuid,
      nick: player.nick,
      apiNick: player.apiNick || "",
      tagLine: player.tagLine,
      handle: player.handle,
      registered: Boolean(player.registered),
      currentTeam: player.currentTeam || "",
      teamHistory: player.teamHistory || [],
      nickHistory: player.nickHistory || [],
      photo: player.photo || "",
      teamId,
      accounts: [],
      teams: new Map(),
      agents: new Map(),
      maps: new Map(),
      events: new Map(),
      recent: [],
      ...emptyPlayerStatTotals(),
    });
  } else if (player.registered) {
    const row = map.get(player.id);
    // Não sobrescreve handle/tagLine: as partidas iteram da mais recente para a
    // mais antiga, então o handle registrado na criação já é o "nick atual".
    row.nick = player.nick || row.nick;
    row.registered = true;
    row.currentTeam = player.currentTeam || row.currentTeam;
    row.teamHistory = player.teamHistory || row.teamHistory;
    row.nickHistory = player.nickHistory || row.nickHistory;
    row.photo = player.photo || row.photo;
  }
  const row = map.get(player.id);
  if (player.puuid && !row.accounts.some((account) => account.puuid === player.puuid)) {
    row.accounts.push({ puuid: player.puuid, handle: player.handle || "" });
  }
  return row;
}

function applyTeamMetadata(teams, players, metadata, teamProfiles) {
  const playersByName = new Map();
  for (const player of players) {
    const keys = [player.nick, player.handle, ...(player.nickHistory || [])].map(normalizeNameKey).filter(Boolean);
    for (const key of keys) {
      if (!playersByName.has(key)) playersByName.set(key, player);
    }
  }

  for (const team of teams) {
    const registered = metadata.teamsById.get(team.id);
    const manualProfile = compactProfileOverride(teamProfiles.teams[team.id] || {});
    const metadataProfile = {
      state: registered?.state || "",
      stateName: registered?.stateName || "",
      flag: registered?.stateFlag || "",
      logo: registered?.logo || "",
      org: registered?.org || "",
      orgTag: registered?.orgTag || "",
      stateRegion: registered?.stateRegion || "",
      socials: registered?.socials || {},
    };
    const profile = {
      ...teamProfiles.defaults,
      ...metadataProfile,
      ...manualProfile,
      socials: {
        ...(teamProfiles.defaults.socials || {}),
        ...(metadataProfile.socials || {}),
        ...(manualProfile.socials || {}),
      },
      trophies: manualProfile.trophies || metadataProfile.trophies || teamProfiles.defaults.trophies || [],
      rankingHistory: manualProfile.rankingHistory || metadataProfile.rankingHistory || teamProfiles.defaults.rankingHistory || [],
      lineupHistory: manualProfile.lineupHistory || metadataProfile.lineupHistory || teamProfiles.defaults.lineupHistory || [],
    };
    team.registered = Boolean(registered);
    team.name = registered?.displayName || team.name;
    team.sourceTag = registered?.tag || team.sourceTag || team.id;
    team.shortTag = team.shortTag || teamTag(team.id);
    team.org = registered?.org || "";
    team.orgTag = registered?.orgTag || "";
    team.logo = profile.logo;
    team.profile = profile;
    team.observedLineup = team.lineup;
    team.currentLineup = (registered?.lineup || []).map((slot) => {
      const player = playersByName.get(normalizeNameKey(slot.name));
      return {
        slot: slot.slot,
        name: slot.name,
        playerId: player?.id || "",
      };
    });
  }
}

function compactProfileOverride(value) {
  if (Array.isArray(value)) return value.length ? value : undefined;
  if (!value || typeof value !== "object") return isEmptyProfileOverride(value) ? undefined : value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const resolved = compactProfileOverride(item);
    if (resolved !== undefined && resolved !== "") output[key] = resolved;
  }
  return Object.keys(output).length ? output : {};
}

function isEmptyProfileOverride(value) {
  const text = String(value || "").trim();
  return !text || text === "Estado não informado";
}

function updateStatBucket(bucket = { matches: 0, rounds: 0, rating: 0, acs: 0 }, rating, acs, rounds = 1) {
  const weight = Math.max(0, Number(rounds || 0)) || 1;
  return {
    matches: bucket.matches + 1,
    rounds: Number(bucket.rounds || 0) + weight,
    rating: bucket.rating + Number(rating || 0) * weight,
    acs: bucket.acs + Number(acs || 0) * weight,
  };
}

function updateAgentBucket(bucket, player) {
  return {
    slug: player.agentSlug || player.agent,
    name: player.agent,
    icon: player.agentIcon || "",
    role: player.agentClass || "",
    picks: (bucket?.picks || 0) + 1,
    rounds: (bucket?.rounds || 0) + player.rounds,
  };
}

function aggregateMaps(matches, teams) {
  const byName = new Map();
  for (const match of matches) {
    if (!byName.has(match.mapName)) {
      byName.set(match.mapName, {
        id: match.mapId,
        name: match.mapName,
        icon: match.mapIcon || "",
        apiMapId: match.apiMapId || "",
        matches: 0,
        rounds: 0,
        teams: new Map(),
        agents: new Map(),
      });
    }
    const row = byName.get(match.mapName);
    row.matches += 1;
    row.rounds += match.rounds;
    for (const side of [match.teamA, match.teamB]) {
      row.teams.set(side.id, updateCount(row.teams.get(side.id), match.winnerId === side.id));
    }
    for (const player of match.players) {
      row.agents.set(player.agentSlug || player.agent, updateAgentBucket(row.agents.get(player.agentSlug || player.agent), player));
    }
  }

  return [...byName.values()]
    .map((map) => {
      map.teamStats = [...map.teams.entries()]
        .map(([teamId, row]) => ({ teamId, wins: row.wins, matches: row.matches, winRate: pctValue(row.wins, row.matches) }))
        .sort((a, b) => b.winRate - a.winRate || b.matches - a.matches);
      map.agentStats = [...map.agents.values()]
        .map((agent) => ({ ...agent, rate: pctValue(agent.picks, map.matches * 2) }))
        .sort((a, b) => b.picks - a.picks || b.rounds - a.rounds);
      map.colors = mapColors(map.name);
      return map;
    })
    .sort((a, b) => b.matches - a.matches);
}

function aggregateWeapons(matches) {
  const byId = new Map();
  for (const match of matches) {
    const playersByPuuid = new Map(match.players.map((player) => [player.puuid, player]));
    for (const round of match.roundResults || []) {
      for (const row of round.playerStats || []) {
        for (const kill of row.kills || []) {
          const damage = kill.finishingDamage || {};
          const weaponId = String(damage.damageItem || "").toLowerCase();
          if (damage.damageType !== "Weapon" || !weaponId) continue;
          const weapon = ensureWeaponBucket(byId, weaponId);
          const killer = playersByPuuid.get(String(kill.killer || ""));
          weapon.kills += 1;
          weapon.secondaryKills += damage.isSecondaryFireMode ? 1 : 0;
          weapon.matchIds.add(match.id);
          weapon.maps.add(match.mapName);
          if (killer) {
            const playerBucket = weapon.players.get(killer.id) || { id: killer.id, name: killer.nick, kills: 0 };
            playerBucket.kills += 1;
            weapon.players.set(killer.id, playerBucket);
          }
        }
      }
    }
  }

  const totalKills = [...byId.values()].reduce((sum, weapon) => sum + weapon.kills, 0);
  return [...byId.values()]
    .map((weapon) => {
      const topPlayer = [...weapon.players.values()].sort((a, b) => b.kills - a.kills || a.name.localeCompare(b.name))[0] || null;
      return {
        id: weapon.id,
        name: weapon.name,
        kills: weapon.kills,
        killShare: pctValue(weapon.kills, totalKills),
        matches: weapon.matchIds.size,
        maps: weapon.maps.size,
        secondaryKills: weapon.secondaryKills,
        topPlayer,
      };
    })
    .sort((a, b) => b.kills - a.kills || a.name.localeCompare(b.name));
}

function ensureWeaponBucket(map, id) {
  if (!map.has(id)) {
    map.set(id, {
      id,
      name: weaponName(id),
      kills: 0,
      secondaryKills: 0,
      matchIds: new Set(),
      maps: new Set(),
      players: new Map(),
    });
  }
  return map.get(id);
}

function weaponName(id) {
  return WEAPON_NAMES[String(id || "").toLowerCase()] || `Arma ${String(id || "").slice(0, 8)}`;
}

function aggregateEvents(events, matches, matchSeries, loadedFiles, duplicateFiles, failedFiles) {
  return events.map((event) => {
    const override = TOURNAMENT_OVERRIDES[event.id] || {};
    const rawEvent = { ...event, ...override };
    const eventMatches = matches.filter((match) => match.eventId === event.id);
    const eventSeries = matchSeries.filter((series) => series.eventId === event.id);
    const teams = new Set(eventMatches.flatMap((match) => [match.teamA.id, match.teamB.id]));
    const players = new Set(eventMatches.flatMap((match) => match.players.map((player) => player.id)));
    const dates = eventMatches.map((match) => match.startedAt).filter(Boolean).sort((a, b) => a - b);
    const explicitStart = parseEventTimestamp(rawEvent.startsAt ?? rawEvent.startAt ?? rawEvent.startTime ?? rawEvent.startDate);
    const explicitEnd = parseEventTimestamp(rawEvent.endsAt ?? rawEvent.endAt ?? rawEvent.endTime ?? rawEvent.endDate);
    const start = explicitStart || dates[0] || null;
    const end = explicitEnd || dates[dates.length - 1] || null;
    const colors = eventColorPair(rawEvent);
    return {
      ...rawEvent,
      matches: eventSeries.length,
      mapGames: eventMatches.length,
      teams: override.teams ? [...override.teams] : [...teams],
      players: [...players],
      maps: override.mapPool ? [...override.mapPool] : [...new Set(eventMatches.map((match) => match.mapName))],
      start,
      end,
      logo: rawEvent.logo || rawEvent.logoPath || rawEvent.icon || "",
      mark: rawEvent.mark || eventAcronym(rawEvent.name || rawEvent.id),
      colors,
      sourceFiles: loadedFiles.filter((file) => file.eventId === event.id).length,
      duplicateFiles: duplicateFiles.length,
      failedFiles: failedFiles.length,
      status: rawEvent.status || eventStatus(start, end),
    };
  });
}

function parseEventTimestamp(value) {
  if (!value) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function eventStatus(start, end) {
  const now = Date.now();
  if (end && now > end) return "Finalizado";
  if (start && now < start) return "Em andamento";
  return "Em andamento";
}

function renderLoading() {
  updateDocumentTitle();
  // O database.json tem ~6 MB comprimidos. Numa conexao lenta a espera e longa
  // o bastante para valer dizer o que esta acontecendo, em vez de "Carregando".
  const message = state.error
    ? `
      <div class="boot-state boot-error" role="alert">
        <strong>Não foi possível carregar os dados das partidas.</strong>
        <p>${escapeHtml(state.error.message || "A conexão falhou no meio do download.")}</p>
        <button type="button" class="boot-retry" onclick="window.location.reload()">Tentar de novo</button>
      </div>
    `
    : `
      <div class="boot-state" role="status" aria-live="polite">
        <strong>Carregando o histórico de partidas</strong>
        <p>São alguns megabytes de dados. Na primeira visita costuma demorar mais; depois fica em cache.</p>
      </div>
    `;
  Shell(message, { skipSearch: true });
}

function Shell(content, options = {}) {
  const { section } = route();
  const searchValue = escapeHtml(state.search);
  const sectionSlide = panelSlideSnapshot("site-sections", {
    selector: ".main",
    scope: "site",
    key: section,
    order: navItems.map(([key]) => key),
  });
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar-inner">
          <a class="brand" href="#/home" aria-label="${SITE_NAME}">
            <img class="brand-wordmark" src="${SITE_WORDMARK_SRC}" alt="" loading="eager" decoding="async" />
            <span class="sr-only">${SITE_NAME}</span>
          </a>
          <nav class="nav" aria-label="Navegação principal">
            ${navItems.map(([key, label]) => `<a class="nav-link ${section === key ? "active" : ""}"${section === key ? ` aria-current="page"` : ""} href="#/${key}">${label}</a>`).join("")}
            <span class="nav-indicator" aria-hidden="true"></span>
          </nav>
          <div class="global-search">
            <input id="global-search" type="search" placeholder="Buscar time, jogador, campeonato, partida ou mapa" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="search-results" aria-autocomplete="list" aria-label="Buscar no site" value="${searchValue}" ${options.skipSearch ? "disabled" : ""} />
            <span class="search-token">/</span>
            <div id="search-results" class="search-results ${state.searchOpen ? "open" : ""}" role="listbox" aria-label="Resultados da busca"></div>
            <span id="search-status" class="sr-only" role="status" aria-live="polite"></span>
          </div>
        </div>
      </header>
      <main class="main">${content}</main>
      <footer class="footer">
        <div class="footer-inner">
          <a class="footer-logo-link" href="#/home" aria-label="${SITE_NAME}">
            <img class="footer-logo" src="${SITE_LOGO_SRC}" alt="" loading="lazy" decoding="async" />
          </a>
        </div>
      </footer>
    </div>
  `;
  if (!options.skipSearch) bindSearch();
  syncNavIndicator();
  playPanelSlide(sectionSlide);
}

// A linha do header e um elemento so, que anda da aba anterior para a atual no
// mesmo tempo do slide do conteudo. Sem posicao anterior (primeiro render, F5,
// volta de uma pagina fora do menu) ela so aparece no lugar certo, sem viajar.
function syncNavIndicator(animate = true) {
  const nav = document.querySelector(".nav");
  const indicator = nav?.querySelector(".nav-indicator");
  if (!nav || !indicator) return;
  const active = nav.querySelector(".nav-link.active");
  if (!active) {
    indicator.style.opacity = "0";
    navIndicatorGeometry = null;
    return;
  }
  const navBox = nav.getBoundingClientRect();
  const activeBox = active.getBoundingClientRect();
  const next = {
    x: Math.round(activeBox.left - navBox.left),
    y: Math.round(activeBox.bottom - navBox.top - NAV_INDICATOR_HEIGHT),
    width: Math.round(activeBox.width),
  };
  const from = (animate && navIndicatorGeometry) || next;
  navIndicatorGeometry = next;
  indicator.style.transition = "none";
  indicator.style.opacity = "1";
  indicator.style.width = `${from.width}px`;
  indicator.style.transform = `translate3d(${from.x}px, ${from.y}px, 0)`;
  if (from === next) return;

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    indicator.style.transition = "";
    indicator.style.width = `${next.width}px`;
    indicator.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
  };
  requestAnimationFrame(start);
  setTimeout(start, 32);
}

function render() {
  if (!state.ready) return renderLoading();
  normalizeCanonicalRoute();
  updateDocumentTitle();
  const { section, id } = route();
  const routeKey = currentRouteKey();
  const routeChanged = routeKey !== state.routeKey;
  state.routeKey = routeKey;
  const pages = {
    home: renderHomeCompact,
    matches: renderMatchesCompact,
    events: renderEventsPage,
    tournaments: renderEventsPage,
    players: renderPlayersCompact,
    stats: renderStatsPage,
    ranking: renderRankingPage,
    rankings: renderRankingPage,
    teams: renderTeamsCompact,
    maps: renderMapsCompact,
  };
  (pages[section] || renderHomeCompact)(id);
  syncTopbarHeight();
  scrollToRouteTop(routeChanged);
  restoreFilterFocus();
}

function normalizeCanonicalRoute() {
  const canonicalHash = canonicalHashForRoute(route());
  if (!canonicalHash || canonicalHash === currentRouteKey()) return;
  if (window.history?.replaceState) window.history.replaceState(null, "", canonicalHash);
  else window.location.replace(canonicalHash);
}

function canonicalHashForRoute(currentRoute) {
  // A lista de equipes E o ranking. Sem esta linha, #/teams sem id caia num 404
  // com o titulo "Equipes": STATIC_DOCUMENT_TITLES conhecia a secao e o render
  // nao tinha ramo de lista. Entra aqui, e nao no mapa de paginas, porque
  // normalizeCanonicalRoute() roda antes de route() em render() - a URL vira
  // #/ranking e titulo e corpo passam a concordar de uma vez.
  if (currentRoute.section === "teams" && !currentRoute.id) return "#/ranking";
  if (currentRoute.section !== "players" || !currentRoute.id) return "";
  const player = playerById(currentRoute.id);
  if (!player?.routeSlug) return "";
  const canonicalHash = playerHref(player, currentRoute.tab);
  return canonicalHash === currentRouteKey() ? "" : canonicalHash;
}

function renderHomeCompact() {
  const db = state.db;
  const events = sortedEvents("recent").slice(0, 5);
  const topPlayers = db.players.filter(isOfficialRatingSample).sort((a, b) => Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0) || b.rounds - a.rounds).slice(0, 8);
  const topTeams = db.teams.slice(0, 6);
  const recentMatches = allMatchSeries().slice(0, 6);
  Shell(`
    <header class="home-header">
      <div>
        <span class="eyebrow">${SITE_NAME}</span>
        <h1>Centro competitivo universitário.</h1>
      </div>
      <div class="home-kpis">
        ${metric(db.uniqueSeriesCount, "partidas")}
        ${metric(db.teams.length, "equipes")}
        ${metric(db.players.length, "jogadores")}
        ${metric(db.maps.length, "mapas")}
      </div>
    </header>
    <div class="layout-grid">
      <div class="stack">
        <section class="section-band">
          ${sectionHead("Últimos resultados", "", "matches", "Ver partidas")}
          <div class="match-list">${recentMatches.map(matchCard).join("")}</div>
        </section>
        <section class="section-band">
          ${sectionHead("Ranking", "", "rankings", "Ver ranking")}
          <div class="card-grid">${topTeams.map(teamCard).join("")}</div>
        </section>
        <section class="section-band">
          ${sectionHead("Destaques individuais", "", "players", "Ver jogadores")}
          ${playerTable(topPlayers)}
        </section>
      </div>
      <aside class="side-rail">
        <section class="data-panel dark">
          <div class="section-head"><h2>Base competitiva</h2><a class="subtle-link" href="#/tournaments">Campeonatos</a></div>
          <div class="stats-grid">
            ${stat(db.uniqueSeriesCount, "Partidas")}
            ${stat(visibleTournaments().length, "Campeonatos")}
            ${stat(db.teams.length, "Equipes")}
            ${stat(db.players.length, "Jogadores")}
          </div>
        </section>
        <section class="data-panel">
          <div class="section-head"><h2>Campeonatos</h2><a class="subtle-link" href="#/tournaments">Ver todos</a></div>
          <div class="simple-list">${events.map(tournamentRow).join("")}</div>
        </section>
        <section class="data-panel">
          <div class="section-head"><h2>Mapas</h2><a class="subtle-link" href="#/maps">Ver mapas</a></div>
          <div class="simple-list">${db.maps.slice(0, 5).map(mapRow).join("")}</div>
        </section>
      </aside>
    </div>
  `);
}

function renderTeamsCompact(id) {
  if (id) return renderTeamDetail(id);
  return renderNotFound("Recurso");
}

function renderMapsCompact(id) {
  if (id) return renderMapDetail(id);
  Shell(`
    <header class="page-header">
      <div class="page-title">
        <h1>Map pool</h1>
      </div>
    </header>
    <div class="card-grid three">${state.db.maps.map(mapCard).join("")}</div>
  `);
}

function renderHomeCompact() {
  const events = sortedEvents("recent").slice(0, HOME_EVENT_LIMIT);
  const topTeams = state.db.teams.slice(0, HOME_RANKING_LIMIT);
  const recentMatches = allMatchSeries().slice().sort(compareSeriesDateDesc).slice(0, HOME_RECENT_MATCH_LIMIT);
  Shell(`
    <h1 class="sr-only">${SITE_NAME}</h1>
    ${weekHighlights()}
    <div class="home-board univlr-home">
      <section class="hub-panel ranking-panel">
        ${panelTitle("Ranking")}
        <div class="ranking-list">${topTeams.map(compactRankingRow).join("")}</div>
        ${panelFooterLink("ranking", "Ver completo")}
      </section>
      <section class="hub-panel matches-panel">
        ${panelTitle("Últimas partidas")}
        <div class="result-list">${recentMatches.map((series) => matchResultRow(series, { art: true })).join("")}</div>
        ${panelFooterLink("matches", "Ver todas as partidas")}
      </section>
      <section class="hub-panel events-panel">
        ${panelTitle("Campeonatos")}
        <div class="event-list">${events.map(eventListRow).join("")}</div>
        ${panelFooterLink("events", "Ver todos os campeonatos")}
      </section>
    </div>
  `);
  bindHomeRankingPanel();
  bindHomeEventCovers();
}

function renderMatchesCompact(id) {
  if (id) return renderMatchDetail(id);
  // a URL e a fonte da verdade do filtro: query ausente significa sem filtro
  applyMatchFiltersFromQuery(routeQuery());
  ensureResultFilterDefaults();
  const filtered = filteredMatches();
  const limite = limiteDaLista(routeQuery());
  Shell(`
    <header class="page-header slim-header">
      <div class="page-title">
        <h1>Resultados</h1>
      </div>
    </header>
    <div class="results-layout">
      ${matchFilterSidebar()}
      <section class="hub-panel full-list-panel results-panel">
        ${contagemDaLista(Math.min(limite, filtered.length), filtered.length, "partidas")}
        <div class="result-list">${listaDeResultados(filtered, limite)}</div>
        ${verMaisBotao("matches", Math.min(limite, filtered.length), filtered.length, matchFiltersToQuery())}
      </section>
    </div>
  `);
  bindMatchFilters();
  bindResultDayToggles();
}

const LISTA_PAGINA = 50;

function limiteDaLista(p, padrao = LISTA_PAGINA) {
  const bruto = Number.parseInt(p.get("limite") || "", 10);
  if (!Number.isFinite(bruto) || bruto <= 0) return padrao;
  return Math.min(bruto, 5000);
}

// Agrupa por dia para a data sair de dentro de cada linha e virar marco de
// rolagem. Sem isso, "16 de ago de 2026" aparecia 419 vezes.
function agruparPorDia(series) {
  const grupos = [];
  let atual = null;
  series.forEach((item) => {
    const chave = dayKey(item.sortAt || item.startedAt);
    if (!atual || atual.chave !== chave) {
      atual = { chave, rotulo: formatDate(item.sortAt || item.startedAt, "date"), itens: [] };
      grupos.push(atual);
    }
    atual.itens.push(item);
  });
  return grupos;
}

function chevronIcon() {
  return `<svg class="result-day-mark" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 4.5 6 8l3-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Os campeonatos que aconteceram no dia, sem repetir. Medido no banco: o dia
// mais cheio tem 3 e a mediana e 1, entao cabem todos - nao precisa de "+2".
function eventosDoDia(itens) {
  const vistos = new Set();
  const eventos = [];
  for (const item of itens) {
    const id = item.eventId;
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    const evento = state.db.tournaments.find((row) => row.id === id);
    if (evento) eventos.push(evento);
  }
  return eventos;
}

function listaDeResultados(filtered, limite) {
  if (!filtered.length) return `<div class="empty-state">Nenhuma partida encontrada com esses filtros.</div>`;
  return agruparPorDia(filtered.slice(0, limite))
    .map((grupo) => {
      const aberto = !state.diasFechados.has(grupo.chave);
      const painelId = `dia-${safeDomId(grupo.chave)}`;
      const quantas = `${grupo.itens.length} ${grupo.itens.length === 1 ? "partida" : "partidas"}`;
      return `
        <section class="result-day-group" data-result-day="${escapeHtml(grupo.chave)}">
          <h2 class="result-day">
            <button class="result-day-toggle" type="button" data-result-day-toggle aria-expanded="${aberto}" aria-controls="${painelId}">
              <span class="result-day-name">
                <span class="result-day-label">${escapeHtml(grupo.rotulo)}</span>
                ${chevronIcon()}
              </span>
              <span class="result-day-events">${eventosDoDia(grupo.itens).map((evento) => eventLogo(evento, "tiny")).join("")}</span>
              <span class="result-day-count">${escapeHtml(quantas)}</span>
            </button>
          </h2>
          <div class="result-day-rows" id="${painelId}" ${aberto ? "" : "inert"}>
            <div class="result-day-rows-inner">
              ${grupo.itens.map((item) => matchResultRow(item, { when: "hour" })).join("")}
            </div>
          </div>
        </section>
      `;
    })
    .join("");
}

// Alterna sem re-renderizar: o estado vira classe e atributo no lugar. Assim o
// foco fica no botao que a pessoa acabou de apertar, o que uma re-render
// perderia - e a lista de /partidas tem 50 linhas para reconstruir a toa.
function bindResultDayToggles() {
  document.querySelectorAll("[data-result-day-toggle]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const grupo = botao.closest(".result-day-group");
      const painel = grupo?.querySelector(".result-day-rows");
      const chave = grupo?.dataset.resultDay || "";
      if (!grupo || !painel || !chave) return;
      const fechando = botao.getAttribute("aria-expanded") === "true";
      botao.setAttribute("aria-expanded", String(!fechando));
      painel.toggleAttribute("inert", fechando);
      if (fechando) state.diasFechados.add(chave);
      else state.diasFechados.delete(chave);
    });
  });
}

function verMaisBotao(section, mostrando, total, params) {
  if (mostrando >= total) return "";
  const proximo = new URLSearchParams(params);
  proximo.set("limite", String(mostrando + LISTA_PAGINA));
  const restante = total - mostrando;
  const passo = Math.min(LISTA_PAGINA, restante);
  return `<a class="lista-ver-mais" href="#/${section}?${proximo.toString()}">Ver mais ${passo} de ${restante} restantes</a>`;
}

function contagemDaLista(mostrando, total, rotulo) {
  return `<p class="lista-contagem" role="status" aria-live="polite">Mostrando ${mostrando} de ${total} ${rotulo}.</p>`;
}

function matchFilterSidebar() {
  return `
    <aside class="match-filter-sidebar" aria-label="Filtros de resultados">
      <button type="button" class="filter-reset-button" data-match-filter="reset">${resetIcon()}<span>Reset</span></button>
      <details class="filter-dropdown" data-filter-group="bestOf"${resultFilterOpenAttr("bestOf")}>
        <summary>${filterIcon()}<span>Melhor de</span><strong>${matchBestOfLabel()}</strong></summary>
        <div class="filter-dropdown-body">
          <div class="filter-button-grid best-of-grid">
            ${[1, 3, 5].map((value) => filterPill("bestOf", String(value), String(value), state.matchBestOf === String(value))).join("")}
          </div>
        </div>
      </details>
      <details class="filter-dropdown" data-filter-group="maps"${resultFilterOpenAttr("maps")}>
        <summary>${filterIcon()}<span>Mapa</span><strong>${mapFilterSummary()}</strong></summary>
        <div class="filter-dropdown-body">
          <div class="filter-option-stack map-filter-options">
            ${state.db.maps.map(mapFilterButton).join("")}
          </div>
        </div>
      </details>
      <details class="filter-dropdown" data-filter-group="tournaments"${resultFilterOpenAttr("tournaments")}>
        <summary>${filterIcon()}<span>Campeonato</span><strong>${tournamentFilterSummary()}</strong></summary>
        <div class="filter-dropdown-body">
          <div class="filter-option-stack event-filter-options">
            ${visibleTournaments().map(eventFilterButton).join("")}
          </div>
        </div>
      </details>
      <details class="filter-dropdown" data-filter-group="datas"${resultFilterOpenAttr("datas")}>
        <summary>${filterIcon()}<span>Data</span><strong>${escapeHtml(dateFilterSummary())}</strong></summary>
        <div class="filter-dropdown-body">
          <label class="filter-date-field">
            <span>De</span>
            <input class="filter-control" type="date" data-match-date="from" value="${escapeHtml(state.matchDateFrom)}" max="${escapeHtml(state.matchDateTo || "")}" />
          </label>
          <label class="filter-date-field">
            <span>Até</span>
            <input class="filter-control" type="date" data-match-date="to" value="${escapeHtml(state.matchDateTo)}" min="${escapeHtml(state.matchDateFrom || "")}" />
          </label>
        </div>
      </details>
      <details class="filter-dropdown" data-filter-group="teams"${resultFilterOpenAttr("teams")}>
        <summary>${filterIcon()}<span>Equipe</span><strong>${teamFilterSummary()}</strong></summary>
        <div class="filter-dropdown-body">
          <input id="match-team-query" class="filter-control team-filter-search" type="search" placeholder="Buscar equipe" value="${escapeHtml(state.matchTeamQuery)}" autocomplete="off" />
          <div class="team-filter-options" data-team-options>
            ${matchTeamOptionsHtml()}
          </div>
        </div>
      </details>
    </aside>
  `;
}

const LISTA_SEP = ",";

function mesmaLista(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const x = [...a].sort();
  const y = [...b].sort();
  return x.every((v, i) => v === y[i]);
}

// So entra na URL o que difere do padrao: link curto para o caso comum.
function matchFiltersToQuery() {
  const p = new URLSearchParams();
  const todosMapas = state.db.maps.map((m) => m.id);
  const todosEventos = visibleTournaments().map((e) => e.id);
  if (state.matchBestOf && state.matchBestOf !== "all") p.set("md", state.matchBestOf);
  // Serializa o lado mais curto. Desmarcar 1 de 12 mapas vira "sem-mapas=lotus"
  // em vez de listar os outros 11.
  escreverSelecao(p, "mapas", state.matchMaps, todosMapas);
  escreverSelecao(p, "eventos", state.matchTournaments, todosEventos);
  if (Array.isArray(state.matchTeams) && state.matchTeams.length) p.set("equipes", state.matchTeams.join(LISTA_SEP));
  if (state.matchDateFrom) p.set("de", state.matchDateFrom);
  if (state.matchDateTo) p.set("ate", state.matchDateTo);
  return p;
}

function escreverSelecao(p, chave, selecionados, todos) {
  if (!Array.isArray(selecionados) || mesmaLista(selecionados, todos)) return;
  const fora = todos.filter((id) => !selecionados.includes(id));
  if (fora.length && fora.length < selecionados.length) p.set("sem-" + chave, fora.join(LISTA_SEP));
  else p.set(chave, selecionados.join(LISTA_SEP));
}

function lerSelecao(p, chave, todos) {
  const validos = new Set(todos);
  const lista = (v) => (v || "").split(LISTA_SEP).filter((id) => validos.has(id));
  if (p.has("sem-" + chave)) {
    const fora = new Set(lista(p.get("sem-" + chave)));
    return todos.filter((id) => !fora.has(id));
  }
  if (p.has(chave)) return lista(p.get(chave));
  return null;
}

function applyMatchFiltersFromQuery(p) {
  // resetResultFilters tambem fecha os <details> e limpa a busca de equipe;
  // preservar as duas aqui, senao a cada clique o dropdown se fecha e o botao
  // clicado some da tela, e a lista filtrada volta para as 98 equipes - medido:
  // buscar "caap" mostra 4 opcoes, e o clique devolvia 98 e esticava a pagina
  // em 893px debaixo do ponteiro.
  //
  // A busca fica fora da URL de proposito, como o estado de aberto/fechado: ela
  // e ajuda para achar a equipe, nao filtro do resultado - quem filtra e a
  // selecao, e essa ja viaja em `equipes`.
  const aberto = state.resultFilterOpen;
  const buscaDeEquipe = state.matchTeamQuery;
  resetResultFilters();
  if (aberto) state.resultFilterOpen = aberto;
  state.matchTeamQuery = buscaDeEquipe;
  const lista = (chave) => (p.get(chave) || "").split(LISTA_SEP).filter(Boolean);
  if (p.get("md")) state.matchBestOf = p.get("md");
  const mapas = lerSelecao(p, "mapas", state.db.maps.map((m) => m.id));
  if (mapas) state.matchMaps = mapas;
  const eventos = lerSelecao(p, "eventos", visibleTournaments().map((e) => e.id));
  if (eventos) state.matchTournaments = eventos;
  if (p.has("equipes")) {
    const validos = new Set(state.db.teams.map((t) => t.id));
    state.matchTeams = lista("equipes").filter((id) => validos.has(id));
  }
  if (p.get("de")) state.matchDateFrom = p.get("de");
  if (p.get("ate")) state.matchDateTo = p.get("ate");
}

function playerFiltersToQuery() {
  const p = new URLSearchParams();
  if (state.playerQuery) p.set("q", state.playerQuery);
  if (state.playerTeam && state.playerTeam !== "all") p.set("equipe", state.playerTeam);
  if (state.playerInitial && state.playerInitial !== "all") p.set("letra", state.playerInitial);
  return p;
}

function applyPlayerFiltersFromQuery(p) {
  state.playerQuery = p.get("q") || "";
  state.playerTeam = p.get("equipe") || "all";
  state.playerInitial = p.get("letra") || "all";
  state.playerTeamQuery = "";
}

// Escreve o filtro no hash. O hashchange existente re-renderiza, entao Back
// desfaz um filtro por vez em vez de sair da pagina.
function pushFilterState(section, params, focoSeletor) {
  state.filterFocus = focoSeletor || null;
  const q = params.toString();
  const alvo = "#/" + section + (q ? "?" + q : "");
  if (window.location.hash === alvo) {
    render();
    return;
  }
  window.location.hash = alvo;
}

// Depois de re-renderizar, o foco voltava para <body> e a segunda desmarcacao
// exigia re-tabular desde o logo.
// A topbar e sticky e tem altura variavel (211px no celular, onde a navegacao
// quebra em duas linhas). Publicar a altura real permite que o cabecalho de dia
// gruda logo abaixo dela em vez de sumir por tras.
function syncTopbarHeight() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const altura = Math.round(topbar.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--topbar-h", altura + "px");
}

function restoreFilterFocus() {
  const sel = state.filterFocus;
  if (!sel) return;
  state.filterFocus = null;
  const alvo = document.querySelector(sel);
  if (alvo) alvo.focus({ preventScroll: true });
}

function ensureResultFilterDefaults() {
  if (!Array.isArray(state.matchMaps)) {
    state.matchMaps = state.matchMap && state.matchMap !== "all" ? [state.matchMap] : state.db.maps.map((map) => map.id);
  }
  if (!Array.isArray(state.matchTournaments)) {
    state.matchTournaments = state.matchTournament && state.matchTournament !== "all" ? [state.matchTournament] : visibleTournaments().map((event) => event.id);
  } else {
    const visibleIds = new Set(visibleTournaments().map((event) => event.id));
    state.matchTournaments = state.matchTournaments.filter((eventId) => visibleIds.has(eventId));
  }
  if (!Array.isArray(state.matchTeams)) {
    state.matchTeams = state.matchTeam && state.matchTeam !== "all" ? [state.matchTeam] : [];
  }
}

function resultFilterOpenAttr(key) {
  return state.resultFilterOpen?.[key] ? " open" : "";
}

function filterIcon() {
  return `<span class="filter-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M4 5h16l-6 7v5l-4 2v-7L4 5z"></path></svg></span>`;
}

function resetIcon() {
  return `<span class="filter-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path></svg></span>`;
}

// Mesmo padrao dos outros resumos: fechado, a gaveta diz o que esta valendo.
function dateFilterSummary() {
  const de = formatShortDate(dateInputToStart(state.matchDateFrom));
  const ate = formatShortDate(dateInputToEnd(state.matchDateTo));
  if (de && ate) return `${de} - ${ate}`;
  if (de) return `A partir de ${de}`;
  if (ate) return `Até ${ate}`;
  return "Todas";
}

function matchBestOfLabel() {
  return state.matchBestOf === "all" ? "Todos" : `MD${state.matchBestOf}`;
}

function mapFilterSummary() {
  return selectedFilterSummary(state.matchMaps, state.db.maps, "mapa", "mapas", "Nenhum mapa", "Todos selecionados");
}

function tournamentFilterSummary() {
  return selectedFilterSummary(state.matchTournaments, visibleTournaments(), "campeonato", "campeonatos", "Nenhum campeonato", "Todos selecionados");
}

function teamFilterSummary() {
  return selectedFilterSummary(state.matchTeams, state.db.teams, "equipe", "equipes", "Nenhuma equipe", "Nenhuma equipe");
}

function selectedFilterSummary(selectedIds, items, singular, plural, emptyLabel, allLabel) {
  const selected = Array.isArray(selectedIds) ? selectedIds : [];
  if (!selected.length) return emptyLabel;
  if (selected.length === items.length) return allLabel;
  if (selected.length === 1) {
    const item = items.find((row) => row.id === selected[0]);
    return escapeHtml(item?.name || item?.tag || singular);
  }
  return `${selected.length} ${plural}`;
}

function filterPill(filter, value, label, active) {
  return `<button type="button" class="filter-pill ${active ? "active" : ""}" data-match-filter="${escapeHtml(filter)}" data-value="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(label)}</button>`;
}

function mapFilterButton(map) {
  const art = mapArtAttrs(map);
  const active = state.matchMaps.includes(map.id);
  return `
    <button type="button" class="filter-banner map-filter-button ${active ? "active" : ""}" data-match-filter="map" data-value="${escapeHtml(map.id)}" aria-pressed="${active ? "true" : "false"}">
      ${art ? `<img src="${escapeHtml(art.src)}" data-fallback="${escapeHtml(art.fallback)}" alt="" loading="lazy" onerror="mapArtError(this)" />` : ""}
      <span class="filter-check" aria-hidden="true"></span>
      <span class="filter-banner-label">${escapeHtml(map.name)}</span>
    </button>
  `;
}

function eventFilterButton(event) {
  const active = state.matchTournaments.includes(event.id);
  return `
    <button type="button" class="filter-event-button ${active ? "active" : ""}" data-match-filter="tournament" data-value="${escapeHtml(event.id)}" aria-pressed="${active ? "true" : "false"}">
      <span class="filter-check" aria-hidden="true"></span>${eventLogo(event, "tiny")}<span>${escapeHtml(event.name)}</span>
    </button>
  `;
}

function matchTeamOptionsHtml() {
  const query = normalize(state.matchTeamQuery);
  const teams = state.db.teams
    .filter((team) => !query || normalize(`${team.name} ${team.sourceTag || team.tag} ${team.org || ""}`).includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
  return `
    ${
      teams.length
        ? teams.map(teamFilterButton).join("")
        : `<div class="empty-state compact-empty">Nenhuma equipe encontrada.</div>`
    }
  `;
}

function teamFilterButton(team) {
  const active = state.matchTeams.includes(team.id);
  return `
    <button type="button" class="team-filter-button ${active ? "active" : ""}" data-match-filter="team" data-value="${escapeHtml(team.id)}" aria-pressed="${active ? "true" : "false"}">
      <span class="filter-check" aria-hidden="true"></span>${teamLogo(team.id)}<strong>${escapeHtml(team.name)}</strong>
    </button>
  `;
}

function renderEventsPage(id) {
  if (id) return renderTournamentDetail(id);
  const events = sortedEvents(state.eventSort);
  Shell(`
    <header class="page-header slim-header">
      <div class="page-title">
        <h1>Eventos</h1>
        <p>Chaves, resultados, participantes e contexto competitivo dos eventos cobertos.</p>
      </div>
      <div class="toolbar">
        <select id="event-sort" class="filter-control">
          <option value="end" ${state.eventSort === "end" ? "selected" : ""}>Ordenar por término</option>
          <option value="start" ${state.eventSort === "start" ? "selected" : ""}>Ordenar por início</option>
        </select>
      </div>
    </header>
    <section class="hub-panel full-list-panel">
      <div class="event-list large">${events.map(eventDirectoryRow).join("")}</div>
    </section>
  `);
  document.getElementById("event-sort")?.addEventListener("change", (event) => {
    state.eventSort = event.target.value;
    renderEventsPage();
  });
}

function renderPlayersCompact(id) {
  // Texto digitado vive local ate o campo perder o foco: hidratar a cada tecla
  // apagaria o que a pessoa esta escrevendo, e escrever no hash a cada tecla
  // encheria o historico.
  if (!id && !state.skipFilterHydration) applyPlayerFiltersFromQuery(routeQuery());
  state.skipFilterHydration = false;
  if (id) return renderPlayerDetail(id);
  const players = filteredPlayers();
  const limite = limiteDaLista(routeQuery());
  const visiveis = players.slice(0, limite);
  Shell(`
    <header class="page-header slim-header">
      <div class="page-title">
        <h1>Jogadores</h1>
        <span class="page-count">${players.length}</span>
        <p>Perfis dos jogadores cadastrados na base competitiva.</p>
      </div>
      <div class="toolbar filters-toolbar player-filters">
        <input id="player-query" class="filter-control" type="search" placeholder="Buscar player" value="${escapeHtml(state.playerQuery)}" />
        <input id="player-team-query" class="filter-control" type="search" placeholder="Buscar time" value="${escapeHtml(state.playerTeamQuery || "")}" />
        ${playerTeamDropdown()}
      </div>
    </header>
    <div class="letter-filter">${playerInitialOptions().map((letter) => `<button class="${state.playerInitial === letter ? "active" : ""}" data-letter="${escapeHtml(letter)}">${escapeHtml(letter === "all" ? "Todos" : letter)}</button>`).join("")}</div>
    <section class="hub-panel full-list-panel">
      ${contagemDaLista(visiveis.length, players.length, "jogadores")}
      ${playerDirectoryTable(visiveis)}
      ${verMaisBotao("players", visiveis.length, players.length, playerFiltersToQuery())}
    </section>
  `);
  bindPlayerFilters();
}

function playerTeamDropdown() {
  const teams = sortedTeamsByName(state.db.teams);
  return `
    <details class="filter-dropdown player-team-dropdown">
      <summary>${filterIcon()}<span>Equipe</span><strong>${playerTeamFilterSummary()}</strong></summary>
      <div class="filter-dropdown-body">
        <div class="filter-option-stack player-team-options">
          ${playerTeamOptionButton(null)}
          ${teams.map(playerTeamOptionButton).join("")}
        </div>
      </div>
    </details>
  `;
}

function playerTeamFilterSummary() {
  if (state.playerTeam === "all") return "Todos os times";
  const team = teamById(state.playerTeam);
  return escapeHtml(team?.name || "Equipe");
}

function playerTeamOptionButton(team) {
  const value = team?.id || "all";
  const active = state.playerTeam === value;
  const label = team?.name || "Todos os times";
  const visual = team ? teamLogo(team.id, "tiny") : `<span class="team-logo clean-logo tiny logo-empty" aria-hidden="true"></span>`;
  return `
    <button type="button" class="team-filter-button player-team-option ${active ? "active" : ""}" data-player-team-filter="${escapeHtml(value)}" aria-pressed="${active ? "true" : "false"}">
      <span class="filter-check" aria-hidden="true"></span>${visual}<strong>${escapeHtml(label)}</strong>
    </button>
  `;
}

function sortedTeamsByName(teams) {
  return teams.slice().sort((a, b) => String(a.name || a.tag || a.id || "").localeCompare(String(b.name || b.tag || b.id || ""), "pt-BR", { numeric: true, sensitivity: "base" }));
}


// Glossario unico das metricas. Serve a pagina /stats e as dicas dos
// cabecalhos do placar, para a definicao nao divergir entre os dois lugares.
// Conferido em raating-core.js e no agregador do app.js.
const METRIC_GLOSSARY = [
  {
    key: "rating",
    term: "rAAting 3.0",
    short: "Nota geral do jogador. 1.00 é o desempenho mediano do cenário.",
    long: "Nota geral do jogador no cenário universitário. 1.00 é o desempenho mediano: metade dos jogadores fica acima, metade abaixo. Cada 0,28 acima ou abaixo equivale a um intervalo interquartil de distância dessa mediana, e a escala é travada entre 0,30 e 1,80.",
  },
  { key: "acs", term: "ACS", short: "Pontuação de combate da partida dividida pelos rounds jogados.", long: "Average Combat Score: a pontuação de combate registrada na partida, dividida pelos rounds jogados." },
  { key: "adr", term: "ADR", short: "Dano causado por round jogado.", long: "Average Damage per Round: dano total causado dividido pelos rounds jogados." },
  { key: "kast", term: "KAST", short: "Percentual de rounds com abate, assistência, sobrevivência em round vencido ou morte trocada.", long: "Percentual de rounds em que o jogador teve pelo menos uma destas: abate, assistência, morte trocada pelo time, ou sobreviveu a um round vencido. Sobreviver a um round perdido (o \u0022save\u0022) não conta aqui." },
  { key: "kd", term: "K/D", short: "Abates divididos por mortes.", long: "Abates divididos por mortes." },
  { key: "kpr", term: "KPR", short: "Abates por round jogado.", long: "Abates por round jogado." },
  { key: "dpr", term: "DPR", short: "Mortes por round jogado. Aqui, menor é melhor.", long: "Mortes por round jogado. É a única métrica desta lista em que um número menor é melhor." },
  { key: "apr", term: "APR", short: "Assistências por round jogado.", long: "Assistências por round jogado." },
  { key: "swing", term: "Swing/R", short: "Quanto o jogador move a chance de vitória do round, em pontos percentuais.", long: "Round Swing por round: quanto as ações do jogador movem a probabilidade de o time vencer o round, medido em pontos percentuais. É zero-sum entre os dois times, então o que um ganha o outro perde." },
  { key: "hs", term: "HS%", short: "Percentual de acertos na cabeça.", long: "Percentual dos acertos que foram na cabeça." },
  { key: "fk", term: "FK", short: "First Kill: primeiro abate do round.", long: "First Kill: quantas vezes o jogador abriu o round com o primeiro abate." },
  { key: "fd", term: "FD", short: "First Death: primeira morte do round.", long: "First Death: quantas vezes o jogador foi o primeiro a cair no round." },
  { key: "fkfd", term: "FK-FD", short: "Saldo entre primeiros abates e primeiras mortes.", long: "Saldo de abertura: primeiros abates menos primeiras mortes. Positivo significa que o jogador abriu mais rounds do que perdeu." },
  { key: "fkpr", term: "FKPR", short: "Primeiros abates por round.", long: "First Kills por round jogado." },
  { key: "fdpr", term: "FDPR", short: "Primeiras mortes por round.", long: "First Deaths por round jogado." },
  { key: "mks", term: "MKs", short: "Rounds com mais de um abate.", long: "Quantidade de rounds em que o jogador conseguiu mais de um abate." },
  { key: "plusminus", term: "+/-", short: "Abates menos mortes.", long: "Saldo simples: abates menos mortes." },
  { key: "kdd", term: "K:D", short: "Abates divididos por mortes.", long: "Abates divididos por mortes." },
  { key: "mk", term: "MK/R", short: "Multi-kills por round.", long: "Rounds com mais de um abate, ponderados pelo tamanho do multi-kill e divididos pelos rounds jogados." },
];

const METRIC_GLOSSARY_BY_TERM = new Map(METRIC_GLOSSARY.map((item) => [item.term, item]));

function metricHint(label) {
  return METRIC_GLOSSARY_BY_TERM.get(label)?.short || "";
}

function renderStatsPage() {
  const minRounds = RaaRatingCore?.SAMPLE_MIN_ROUNDS ?? 50;
  const escala = [
    ["0,72", "um intervalo abaixo da mediana"],
    ["1,00", "mediana do cenário"],
    ["1,28", "um intervalo acima"],
    ["1,56", "dois intervalos acima"],
  ];
  const pesos = [
    ["33%", "Round Swing"],
    ["25%", "Abates"],
    ["15%", "Dano"],
    ["15%", "Sobrevivência"],
    ["8%", "KAST"],
    ["4%", "Multi-kills"],
  ];
  Shell(`
    <header class="page-header slim-header">
      <div class="page-title">
        <h1>Métricas</h1>
      </div>
    </header>

    <section class="metric-explainer" aria-labelledby="metric-rating-title">
      <h2 id="metric-rating-title">Como ler o rAAting 3.0</h2>
      <p class="metric-lede">
        É a nota geral de um jogador no cenário universitário. <strong>1.00 é o desempenho mediano</strong>:
        metade dos jogadores fica acima, metade abaixo. Cada 0,28 acima ou abaixo equivale a um
        intervalo interquartil de distância dessa mediana. A escala é travada entre 0,30 e 1,80.
      </p>
      <ul class="metric-scale">
        ${escala.map(([valor, texto]) => `<li><strong>${escapeHtml(valor)}</strong><span>${escapeHtml(texto)}</span></li>`).join("")}
      </ul>

      <h3>Do que ela é feita</h3>
      <ul class="metric-weights">
        ${pesos.map(([peso, nome]) => `<li><strong>${escapeHtml(peso)}</strong><span>${escapeHtml(nome)}</span></li>`).join("")}
      </ul>
      <p class="metric-note">
        Para entrar no ranking oficial de jogadores é preciso ter jogado ao menos
        ${minRounds} rounds. Quem está abaixo disso aparece marcado como baixa amostra.
      </p>
    </section>

    <section class="metric-glossary" aria-labelledby="metric-glossary-title">
      <h2 id="metric-glossary-title">Glossário</h2>
      <dl>
        ${METRIC_GLOSSARY.filter((item) => item.key !== "rating")
          .map((item) => `<dt>${escapeHtml(item.term)}</dt><dd>${escapeHtml(item.long)}</dd>`)
          .join("")}
      </dl>
    </section>

    <section class="metric-where" aria-labelledby="metric-where-title">
      <h2 id="metric-where-title">Onde ver os números</h2>
      <p>A página de estatísticas agregadas ainda está em construção. Enquanto isso, os mesmos dados estão em:</p>
      <ul class="metric-links">
        <li><a href="#/ranking">Ranking</a><span>nota das equipes e histórico por semana</span></li>
        <li><a href="#/players">Players</a><span>rAAting e médias de cada jogador</span></li>
        <li><a href="#/matches">Partidas</a><span>placar completo de cada mapa, com todas as colunas</span></li>
      </ul>
    </section>
  `);
}

function avg(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length : 0;
}

function renderRankingPage(teamId = route().id || "") {
  const routeTeamId = rankingRouteTeamId(teamId);
  if (routeTeamId) ensureRankingScopeIncludesTeam(routeTeamId);
  const scope = state.rankingScope === "all" ? "all" : "valid";
  const rows = rankingRowsForScope(state.db.teams, scope);
  const snapshot = selectedRankingSnapshot();
  const minimumMatches = state.db.rankingMinimumMatches || 9;
  const minimumRosterSize = rankingMinimumRosterSize(state.db?.rankingWeights);
  const aba = rankingRouteTab();
  const semanaMatches = rankingWeekMatches(snapshot);
  Shell(`
    <header class="page-header slim-header">
      <div class="page-title">
        <h1>Ranking</h1>
        <p>Nota final: 70% desempenho, 15% conquistas, 10% forma recente e 5% rAAting 3.0 dos jogadores. Equipes com menos de ${minimumMatches} partidas ficam marcadas como provisórias e equipes com elenco incompleto (menos de ${minimumRosterSize} jogadores) ficam inativas.</p>
      </div>
    </header>
    <section class="hub-panel ranking-full-panel">
      <div class="ranking-page-toolbar">
        <div class="ranking-toolbar-context">
          <span data-ranking-count>${escapeHtml(aba === "partidas" ? rankingWeekMatchesSummary(semanaMatches, snapshot) : rankingScopeSummary(scope))}</span>
          <label class="ranking-version-picker">
            <select data-ranking-version aria-label="Semana do ranking">
              ${rankingVersionOptions(snapshot)}
            </select>
          </label>
        </div>
        ${rankingTabSwitch(aba, semanaMatches.length)}
        ${aba === "partidas" ? "" : `<div class="ranking-toolbar-actions"><div class="ranking-toolbar-actions-inner">
          <label class="ranking-details-toggle">
            <input type="checkbox" data-ranking-score-details ${state.rankingShowDetails ? "checked" : ""} />
            <span>Detalhes da nota</span>
          </label>
          <div class="ranking-scope-switch" data-scope="${scope}" role="group" aria-label="Filtro do ranking">
            <button type="button" data-ranking-scope="valid" aria-pressed="${scope === "valid"}" class="${scope === "valid" ? "active" : ""}">Apenas válidos</button>
            <button type="button" data-ranking-scope="all" aria-pressed="${scope === "all"}" class="${scope === "all" ? "active" : ""}">Todos</button>
          </div>
        </div></div>`}
      </div>
      ${aba === "partidas" ? rankingWeekMatchesSection(semanaMatches) : rankingAccordion(rows, scope, state.rankingShowDetails)}
    </section>
  `);
  bindRankingVersionPicker();
  bindRankingTabSwitch();
  if (aba === "partidas") {
    bindResultDayToggles();
    return;
  }
  animarEntradaDasAcoes();
  bindRankingScopeToggle();
  bindRankingScoreDetailsToggle();
  bindRankingSortHeaders();
  bindRankingAccordion();
  openRankingRouteTeam(routeTeamId);
}

// A aba viaja na query, como todo filtro deste site: trocar de aba nao e mudar
// de pagina, entao o Back desfaz um passo e a rolagem nao pula para o topo.
// Trocar de aba re-renderiza a pagina inteira, entao o grupo da direita nasce
// ja ausente e nao teria como animar a saida - o elemento que deveria encolher
// nem existe mais quando o novo DOM chega. A saida acontece ANTES do
// pushFilterState: anima, espera, e so entao troca a rota. Na volta e o
// contrario - a rota troca na hora e a animacao de entrada roda no elemento
// recem-criado, marcado por rankingAnimarEntrada.
const RANKING_ABA_MS = 220;

function bindRankingTabSwitch() {
  document.querySelectorAll("[data-ranking-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const params = routeQuery();
      if (button.dataset.rankingTab !== "partidas") {
        params.delete("aba");
        state.rankingAnimarEntrada = true;
        pushFilterState("ranking", params);
        return;
      }
      params.set("aba", "partidas");
      const acoes = document.querySelector(".ranking-toolbar-actions");
      if (!acoes) {
        pushFilterState("ranking", params);
        return;
      }
      fecharAcoesDoRanking(acoes);
      // setTimeout e nao transitionend: em aba oculta o compositor nao avanca a
      // transicao e o evento nunca chega - a troca de aba ficaria presa.
      window.setTimeout(() => pushFilterState("ranking", params), RANKING_ABA_MS);
    });
  });
}

// A largura anima em pixel e nao em `fr`. Medido antes de trocar: numa grade de
// uma coluna indo de 1fr a 0fr, metade do caminho do `fr` ja era 5% da largura
// em pixel - o bloco sumia num salto e arrastava um rastro. Em pixel a curva
// vale o que promete, e a largura de partida e medida, nao chutada.
// No desktop a barra e uma linha e o bloco sai encolhendo para a direita; no
// celular ela empilha e o bloco e uma faixa larga - encolher a largura ali
// espremeria os controles em vez de recolhe-los. O eixo sai do proprio layout.
function eixoDasAcoes(acoes) {
  const barra = acoes.closest(".ranking-page-toolbar");
  if (!barra) return "width";
  // Empilhado, o bloco ocupa a barra inteira - encolher a largura ali
  // espremeria os controles em vez de recolhe-los. A comparacao sai do layout
  // e nao de um breakpoint repetido aqui.
  return acoes.offsetWidth >= barra.clientWidth - 1 ? "height" : "width";
}

function fecharAcoesDoRanking(acoes) {
  const eixo = eixoDasAcoes(acoes);
  acoes.style[eixo] = `${eixo === "height" ? acoes.offsetHeight : acoes.offsetWidth}px`;
  void acoes.offsetWidth; // forca o reflow para haver de onde interpolar
  acoes.style[eixo] = "0px";
  acoes.classList.add("oculto");
}

// Anima a volta do grupo da direita. O elemento acaba de nascer com a largura
// natural, entao ela e medida primeiro, o bloco vai a zero e so no quadro
// seguinte volta - sem os dois quadros o navegador nao tem de onde interpolar.
function animarEntradaDasAcoes() {
  if (!state.rankingAnimarEntrada) return;
  state.rankingAnimarEntrada = false;
  const acoes = document.querySelector(".ranking-toolbar-actions");
  if (!acoes) return;
  const eixo = eixoDasAcoes(acoes);
  const medida = eixo === "height" ? acoes.offsetHeight : acoes.offsetWidth;
  acoes.style[eixo] = "0px";
  acoes.classList.add("oculto");
  // Reflow sincrono em vez de requestAnimationFrame: em aba de fundo o rAF nao
  // dispara, e como o estado inicial aqui e "escondido", o callback que nunca
  // roda deixaria os controles invisiveis para sempre. Lendo offsetWidth o
  // navegador ja tem de onde interpolar, e se a transicao nao rodar o bloco
  // simplesmente aparece na hora - falha para o lado visivel.
  void acoes.offsetWidth;
  acoes.style[eixo] = `${medida}px`;
  acoes.classList.remove("oculto");
  // Solta a medida fixa no fim: presa em pixel, o bloco pararia de responder a
  // redimensionamento de janela.
  window.setTimeout(() => {
    acoes.style[eixo] = "";
  }, RANKING_ABA_MS);
}

function rankingRouteTeamId(teamId) {
  const value = String(teamId || "").trim();
  return value && teamById(value) ? value : "";
}

function ensureRankingScopeIncludesTeam(teamId) {
  const ranking = selectedRankingSnapshot()?.byTeamId?.[teamId] || teamById(teamId)?.ranking;
  if (ranking && !rankingIsValid(ranking)) state.rankingScope = "all";
}

function rankingRowsForScope(teams, scope) {
  const snapshot = selectedRankingSnapshot();
  const rows = (snapshot?.teams || [])
    .map((ranking) => ({ team: teamById(ranking.id), ranking, snapshot }))
    .filter((row) => row.team && rankingRowExistsInSnapshot(row.ranking));
  const sorted = scope === "all"
    ? rows.slice().sort((a, b) => (a.ranking.overallRank || 9999) - (b.ranking.overallRank || 9999) || b.ranking.score - a.ranking.score || a.team.name.localeCompare(b.team.name))
    : rows.filter((row) => rankingIsValid(row.ranking)).sort((a, b) => (a.ranking.validRank || 9999) - (b.ranking.validRank || 9999) || b.ranking.score - a.ranking.score || a.team.name.localeCompare(b.team.name));
  return applyRankingSort(sorted.map((row, index) => ({ ...row, displayRank: index + 1, defaultIndex: index })));
}

function rankingRowExistsInSnapshot(ranking) {
  const matches = Number(ranking?.matches || 0);
  if (!Number.isFinite(matches) || matches <= 0) return false;
  // Equipe sem nenhum jogador no elenco atual nao aparece nem no escopo "Todos".
  return Number(ranking?.rosterSize ?? -1) !== 0;
}

function rankingExistingSnapshotTeams(snapshot = selectedRankingSnapshot()) {
  return (snapshot?.teams || []).filter(rankingRowExistsInSnapshot);
}

function latestRankingSnapshot() {
  return state.db?.rankingSnapshots?.[0] || null;
}

function selectedRankingSnapshot() {
  const snapshots = state.db?.rankingSnapshots || [];
  if (!snapshots.length) return null;
  const selected = snapshots.find((snapshot) => snapshot.id === state.rankingVersionId);
  return selected || snapshots[0];
}

function previousRankingSnapshot(snapshot = selectedRankingSnapshot()) {
  const snapshots = state.db?.rankingSnapshots || [];
  const cutoffAt = Number(snapshot?.cutoffAt || 0);
  if (!cutoffAt) return null;
  return snapshots
    .filter((item) => Number(item.cutoffAt || 0) < cutoffAt)
    .sort((a, b) => Number(b.cutoffAt || 0) - Number(a.cutoffAt || 0))[0] || null;
}

function applyRankingSort(rows) {
  const sort = state.rankingSort || {};
  if (!sort.key || sort.direction === "default") return rows;
  const direction = sort.direction === "asc" ? "asc" : "desc";
  return rows.slice().sort((a, b) => {
    const compared = compareRankingSortValues(rankingSortValue(a, sort.key), rankingSortValue(b, sort.key));
    if (compared !== 0) return direction === "desc" ? -compared : compared;
    return a.defaultIndex - b.defaultIndex;
  });
}

function rankingSortValue(row, key) {
  const team = row.team;
  const ranking = row.ranking || team.ranking || {};
  const blocks = ranking.blocks || {};
  const values = {
    rank: row.displayRank,
    team: team.name || team.sourceTag || team.id || "",
    score: ranking.score ?? team.rankingScore ?? team.points,
    competitive: blocks.competitive,
    achievements: blocks.achievements,
    recentForm: blocks.recentForm,
    rosterStrength: blocks.rosterStrength,
    status: rankingStatusLabel(ranking),
  };
  return values[key] ?? "";
}

function compareRankingSortValues(a, b) {
  const numericA = Number(a);
  const numericB = Number(b);
  if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
  return String(a || "").localeCompare(String(b || ""), "pt-BR", { sensitivity: "base", numeric: true });
}

function rankingCanonicalPosition(ranking) {
  const rank = Number(ranking?.canonicalRank ?? ranking?.validRank);
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

function rankingPositionChange(row) {
  const team = row.team || row;
  const snapshot = row.snapshot || latestRankingSnapshot();
  const ranking = row.ranking || snapshot?.byTeamId?.[team.id] || team.ranking || {};
  const currentRank = rankingCanonicalPosition(ranking);
  if (!currentRank) {
    return { label: "-", className: "muted", title: "Equipe ainda não entrou no ranking válido." };
  }

  const previousSnapshot = previousRankingSnapshot(snapshot);
  if (!previousSnapshot) {
    return { label: "-", className: "muted", title: "Sem semana anterior para comparação." };
  }

  const previousRank = rankingCanonicalPosition(previousSnapshot.byTeamId?.[team.id]);
  if (!previousRank) {
    return { label: "NOVO", className: "new", title: "Entrou no ranking válido nesta semana." };
  }

  const delta = previousRank - currentRank;
  if (delta > 0) {
    return { label: `+${delta}`, className: "up", title: `Subiu ${delta} ${delta > 1 ? "posições" : "posição"} desde a semana passada.` };
  }
  if (delta < 0) {
    const amount = Math.abs(delta);
    return { label: String(delta), className: "down", title: `Caiu ${amount} ${amount > 1 ? "posições" : "posição"} desde a semana passada.` };
  }
  return { label: "-", className: "even", title: "Manteve a posição da semana passada." };
}

function rankingPositionChangeLabel(row) {
  return rankingPositionChangeBadge(row, "rank-change-cell");
}

function rankingPositionChangeBadge(row, baseClass = "rank-change-cell") {
  const change = rankingPositionChange(row);
  return `<span class="${escapeHtml(`${baseClass} ${change.className}`)}" title="${escapeHtml(change.title)}">${escapeHtml(change.label)}</span>`;
}

function rankingScopeSummary(scope) {
  const snapshot = selectedRankingSnapshot();
  const snapshotTeams = rankingExistingSnapshotTeams(snapshot);
  const total = snapshotTeams.length || state.db.teams.filter((team) => Number(team.matches || 0) > 0).length;
  const validCount = snapshotTeams.length ? snapshotTeams.filter(rankingIsValid).length : state.db.teams.filter((team) => Number(team.matches || 0) > 0 && teamIsRankingValid(team)).length;
  const minimumMatches = state.db.rankingMinimumMatches || 9;
  // Devolvia "" no escopo "Apenas válidos", que e o padrao da pagina: o slot da
  // esquerda da barra nascia vazio e os 721px de controle ficavam sozinhos
  // contra 617px de vao. O texto e o contrapeso, e ele tem informacao real.
  if (scope === "all") return `${total} equipes exibidas · ${validCount} válidas · mínimo ${minimumMatches} partidas`;
  return `${validCount} equipes válidas · mínimo ${minimumMatches} partidas`;
}

// "25 Agosto 2026" e "25 ago 2026". formatDate() devolveria "25 de agosto de
// 2026" - os dois "de" so alongam. formatToParts monta dia, mes e ano soltos.
function formatShortDate(value, mes = "short") {
  // `new Date(null)` nao e invalido: e a epoca, e voltava "31 dez 1969" para
  // campo de data vazio. NaN sozinho nao cobre isso.
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: mes, year: "numeric" })
    .formatToParts(date)
    .filter((parte) => ["day", "month", "year"].includes(parte.type))
    .map((parte) => parte.value.replace(".", ""));
  if (mes === "long" && partes[1]) partes[1] = partes[1].charAt(0).toUpperCase() + partes[1].slice(1);
  return partes.join(" ");
}

// O `label` que vem no snapshot diz "Semana de 25 de ago de 2026". Sobra a data
// de corte, que e o que identifica a versao do ranking.
function rankingVersionLabel(snapshot) {
  const fim = Number(snapshot?.cutoffAt || 0);
  if (!fim) return snapshot?.label || "";
  return formatShortDate(fim, "long");
}

// A janela que a versao cobre: do corte anterior ate o corte desta. Sem
// anterior (a semana mais antiga da lista), sete dias antes.
function rankingWeekWindow(snapshot = selectedRankingSnapshot()) {
  const fim = Number(snapshot?.cutoffAt || 0);
  if (!fim) return null;
  const anterior = previousRankingSnapshot(snapshot);
  return { inicio: Number(anterior?.cutoffAt || 0) || fim - 7 * DAY_MS, fim };
}

// As partidas que entraram nesta versao do ranking: as que aconteceram dentro
// da janela. E o mesmo recorte que /partidas faria filtrando por data.
function rankingWeekMatches(snapshot = selectedRankingSnapshot()) {
  const janela = rankingWeekWindow(snapshot);
  if (!janela) return [];
  return allMatchSeries()
    .filter((series) => {
      const at = Number(series.startedAt || 0);
      return at > janela.inicio && at <= janela.fim;
    })
    .sort(compareSeriesDateDesc);
}

function rankingRouteTab() {
  return routeQuery().get("aba") === "partidas" ? "partidas" : "ranking";
}

function rankingVersionOptions(selectedSnapshot) {
  const snapshots = state.db?.rankingSnapshots || [];
  return snapshots
    .map((snapshot) => `<option value="${escapeHtml(snapshot.id)}" ${snapshot.id === selectedSnapshot?.id ? "selected" : ""}>${escapeHtml(rankingVersionLabel(snapshot))}</option>`)
    .join("");
}

// O meio da barra e a porta para a segunda aba: as partidas que entraram nesta
// versao do ranking. Sem partidas na janela o botao continua la, desabilitado -
// "nenhuma" tambem e resposta, e sumir com o botao mexeria no equilibrio da
// barra a cada troca de semana.
function rankingTabSwitch(aba, total) {
  if (aba === "partidas") {
    return `<button class="ranking-tab-switch" type="button" data-ranking-tab="ranking">Voltar ao ranking</button>`;
  }
  const rotulo = total ? `${total} ${total > 1 ? "novas partidas contabilizadas" : "nova partida contabilizada"}` : "Nenhuma partida nova nesta semana";
  return `<button class="ranking-tab-switch" type="button" data-ranking-tab="partidas" ${total ? "" : "disabled"}>${escapeHtml(rotulo)}</button>`;
}

// Reusa a lista de /partidas inteira em vez de montar uma parecida:
// listaDeResultados ja agrupa por dia com contagem no cabecalho e passa
// { when: "hour" } para a linha mostrar so o horario. A classe
// `full-list-panel` nao e decoracao - sao 17 regras no styles.css penduradas
// nela que ligam a arte do mapa, a coluna de meta e o logo do campeonato, com
// variantes responsivas. Copiar isso a mao seria manter duas verdades.
function rankingWeekMatchesSection(matches) {
  if (!matches.length) {
    return `<div class="empty-state">Nenhuma partida entrou nesta versão do ranking.</div>`;
  }
  const params = routeQuery();
  params.set("aba", "partidas");
  const limite = limiteDaLista(routeQuery());
  const mostrando = Math.min(limite, matches.length);
  return `
    <div class="full-list-panel ranking-week-matches">
      <div class="result-list">${listaDeResultados(matches, limite)}</div>
      ${verMaisBotao("ranking", mostrando, matches.length, params)}
    </div>
  `;
}

function rankingAccordion(rows, scope = "valid", showDetails = false) {
  return `
    <div class="ranking-accordion" data-ranking-accordion data-status-visible="${scope === "all"}" data-details-visible="${showDetails}">
      <div class="ranking-accordion-head">
        ${rankingSortHeader("rank", "#")}
        <span class="rank-change-head" aria-hidden="true"></span>
        ${rankingSortHeader("team", "Equipe")}
        <span class="ranking-lineup-head optional">Lineup</span>
        ${rankingSortHeader("score", "Nota", "numeric ranking-score-head")}
        ${rankingSortHeader("competitive", "Desempenho", "numeric optional ranking-detail-cell")}
        ${rankingSortHeader("achievements", "Conquistas", "numeric optional ranking-detail-cell")}
        ${rankingSortHeader("recentForm", "Forma", "numeric optional ranking-detail-cell")}
        ${rankingSortHeader("rosterStrength", "rAAting 3.0", "numeric optional ranking-detail-cell")}
        ${rankingSortHeader("status", "Status", "ranking-status-cell")}
        <span></span>
      </div>
      <div class="ranking-accordion-rows" data-ranking-rows>
        ${rankingAccordionRows(rows)}
      </div>
    </div>
  `;
}

function rankingSortHeader(key, label, extraClass = "") {
  const sort = state.rankingSort || {};
  const active = sort.key === key && sort.direction !== "default";
  const direction = active ? sort.direction : "default";
  const title = direction === "desc" ? "Ordenado decrescente" : direction === "asc" ? "Ordenado crescente" : "Ordenação padrão";
  return `
    <button class="ranking-sort-header ${extraClass} ${active ? "active" : ""}" type="button" data-ranking-sort="${escapeHtml(key)}" data-sort-direction="${direction}" aria-label="${escapeHtml(`${label}: ${title}`)}" title="${escapeHtml(title)}">
      <span>${escapeHtml(label)}</span>
      <i aria-hidden="true">${direction === "desc" ? "↓" : direction === "asc" ? "↑" : ""}</i>
    </button>
  `;
}

function rankingAccordionRows(rows) {
  return rows.length ? rows.map(rankingAccordionItem).join("") : `<div class="empty-state">Nenhuma equipe válida ainda. Alterne para "Todos" para ver equipes provisórias.</div>`;
}

function rankingAccordionItem(row) {
  const team = row.team || row;
  const ranking = row.ranking || team.ranking || {};
  const cutoffAt = row.snapshot?.cutoffAt || selectedRankingSnapshot()?.cutoffAt || Date.now();
  const displayRank = row.displayRank || teamValidRank(team) || teamOverallRank(team) || "-";
  const blocks = ranking.blocks || {};
  const matchesCount = Number.isFinite(Number(ranking.matches)) ? Number(ranking.matches) : team.matches;
  const panelId = `ranking-detail-${safeDomId(team.id)}`;
  return `
    <article class="ranking-accordion-item" data-ranking-team-id="${escapeHtml(team.id)}">
      <button class="ranking-accordion-button pintura-de-equipe" type="button" data-ranking-toggle aria-expanded="false" aria-controls="${panelId}" ${teamAccentStyle(team)}>
        <span class="rank-cell">#${displayRank}</span>
        ${rankingPositionChangeLabel(row)}
        <span class="ranking-team-cell">${teamLogo(team.id)}<span><strong>${escapeHtml(team.name)}</strong><small>${escapeHtml(team.sourceTag || team.tag || team.id)} - ${matchesCount} partidas</small></span></span>
        <span class="ranking-lineup-inline optional">${rankingInlineLineup(team, cutoffAt)}</span>
        <span class="numeric ranking-score-cell">${fmt(ranking.score ?? team.rankingScore ?? team.points, 1)}</span>
        <span class="numeric optional ranking-detail-cell">${fmt(blocks.competitive, 1)}</span>
        <span class="numeric optional ranking-detail-cell">${fmt(blocks.achievements, 1)}</span>
        <span class="numeric optional ranking-detail-cell">${fmt(blocks.recentForm, 1)}</span>
        <span class="numeric optional ranking-detail-cell">${fmt(blocks.rosterStrength, 1)}</span>
        <span class="ranking-status-cell">${rankingStatusChip(team, ranking)}</span>
        <span class="ranking-toggle-mark" aria-hidden="true">+</span>
      </button>
      <div id="${panelId}" class="ranking-dropdown" aria-hidden="true" inert>
        <div class="ranking-dropdown-inner">
          ${rankingTeamPreviewPanel(team, cutoffAt)}
          <div class="ranking-detail-dropdown" aria-hidden="true" inert>
            ${rankingExplanationPanel(team, ranking, cutoffAt)}
          </div>
        </div>
      </div>
    </article>
  `;
}

function rankingStatusLabel(ranking) {
  if (rankingIsInactive(ranking)) return "Inativo";
  return ranking?.provisional ? "Provisório" : "Validado";
}

function rankingStatusChip(team, ranking = team.ranking) {
  const label = rankingStatusLabel(ranking);
  return `<span class="${label === "Validado" ? "chip green" : "chip"}">${label}</span>`;
}

function rankingTeamPreviewPanel(team, cutoffAt = null) {
  const lineup = rankingLineupEntries(team, cutoffAt);
  return `
    <div class="ranking-team-preview">
      <div class="ranking-lineup">
        ${lineup.length ? lineup.map(rankingLineupCard).join("") : `<div class="empty-state">Equipe sem lineup atual cadastrada.</div>`}
      </div>
      <div class="ranking-team-actions">
        <a class="ranking-action-button" href="#/teams/${team.id}">Perfil da equipe</a>
        <button class="ranking-action-button" type="button" data-ranking-details aria-expanded="false">Detalhes do ranking</button>
      </div>
    </div>
  `;
}

// Lineup do ranking: na semana atual, apenas quem esta no elenco cadastrado da
// equipe (com mais de cinco registrados, os cinco com mais partidas pela equipe).
// Semanas anteriores mantem a lineup que jogou naquela semana.
function rankingLineupEntries(team, cutoffAt = null) {
  const cutoff = Number(cutoffAt);
  if (Number.isFinite(cutoff) && cutoff < currentRankingCutoff()) return rankingObservedLineupAt(team, cutoff);
  const roster = teamActiveRoster(team);
  if (roster.length) return rankingRosterTopFive(team, roster);
  // Equipe sem elenco cadastrado: mantem o observado nas partidas como fallback.
  if (Number.isFinite(cutoff)) return rankingObservedLineupAt(team, cutoff);
  return (team.observedLineup || team.lineup || []).slice(0, 5);
}

function currentRankingCutoff() {
  return Number(latestRankingSnapshot()?.cutoffAt) || rankingTuesdayStartOnOrBefore(Date.now());
}

function rankingObservedLineupAt(team, cutoffAt) {
  const observed = rankingLineupEntriesForMatches(team, state.db?.matches || [], cutoffAt);
  return observed.length ? observed : rankingProfileLineupAt(team, cutoffAt);
}

function rankingRosterTopFive(team, roster = teamActiveRoster(team)) {
  if (roster.length <= 5) return roster;
  return roster
    .map((entry, index) => ({ entry, index, matches: rosterEntryTeamMatches(entry, team.id) }))
    .sort((a, b) => b.matches - a.matches || a.index - b.index)
    .slice(0, 5)
    .sort((a, b) => a.index - b.index)
    .map((row) => row.entry);
}

function rosterEntryTeamMatches(entry, teamId) {
  const player = entry.playerId ? playerById(entry.playerId) : null;
  if (!player) return 0;
  return Number(playerStatsForTeam(player, teamId)?.matches || 0);
}

function rankingProfileLineupAt(team, cutoffAt) {
  const history = team.profile?.lineupHistory || [];
  const cutoffDay = new Date(cutoffAt).toISOString().slice(0, 10);
  const segment = history
    .filter((row) => String(row.from || "") <= cutoffDay)
    .sort((a, b) => Number(b.lastSeenAt || Date.parse(b.to || b.from || 0)) - Number(a.lastSeenAt || Date.parse(a.to || a.from || 0)))[0];
  if (!segment) return [];
  return (segment.players || [])
    .filter((player) => !player.firstSeenAt || player.firstSeenAt <= cutoffDay)
    .slice(0, 5);
}

function rankingLineupEntriesForMatches(team, matches, cutoffAt) {
  const buckets = new Map();
  for (const match of matches || []) {
    const startedAt = Number(match.startedAt || 0);
    if (startedAt && startedAt > cutoffAt) continue;
    if (match.teamA?.id !== team.id && match.teamB?.id !== team.id) continue;
    for (const player of match.players || []) {
      if (player.teamId !== team.id) continue;
      const id = player.id;
      if (!id) continue;
      const bucket = buckets.get(id) || { id, playerId: id, name: player.nick || player.handle || id, handle: player.handle || player.nick || id, rounds: 0, matches: 0, lastSeen: 0 };
      bucket.name = player.nick || bucket.name;
      bucket.handle = player.handle || bucket.handle;
      bucket.rounds += Number(player.rounds || match.rounds || 0);
      bucket.matches += 1;
      bucket.lastSeen = Math.max(bucket.lastSeen, startedAt || 0);
      buckets.set(id, bucket);
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen || b.rounds - a.rounds || b.matches - a.matches || String(a.name).localeCompare(String(b.name)))
    .slice(0, 5);
}

function rankingInlineLineup(team, cutoffAt = null) {
  const names = rankingLineupEntries(team, cutoffAt)
    .map((entry) => {
      const player = playerById(entry.playerId || entry.id);
      return player?.nick || entry.name || entry.handle || "";
    })
    .filter(Boolean)
    .slice(0, 5);
  return names.length ? escapeHtml(names.join(" · ")) : `<span class="muted">Sem lineup até esta semana</span>`;
}

function rankingLineupCard(entry) {
  const player = playerById(entry.playerId || entry.id);
  const name = player?.nick || entry.name || entry.handle || "Jogador";
  const handle = player?.handle && player.handle !== name ? player.handle : player?.matches ? `${player.matches} partidas` : "";
  const tag = player ? "a" : "span";
  const attrs = player ? `href="${playerHref(player)}"` : "";
  return `
    <${tag} class="ranking-lineup-card" ${attrs}>
      ${player ? playerLogo(player.id, "large") : logo(String(entry.slot || "?").padStart(2, "0"), ["#1a2638", "#334155"], "round")}
      <strong>${escapeHtml(name)}</strong>
      ${handle ? `<small>${escapeHtml(handle)}</small>` : ""}
    </${tag}>
  `;
}

function rankingExplanationPanel(team, rankingOverride = null, cutoffAt = null) {
  const ranking = rankingOverride || team.ranking || {};
  const blocks = ranking.blocks || {};
  const components = ranking.components || {};
  const sos = ranking.sos || {};
  const recent = ranking.recent || {};
  const roster = ranking.roster || {};
  const minimumMatches = state.db?.rankingMinimumMatches || 9;
  const score = rankingSafeScore(ranking.score ?? team.rankingScore ?? team.points);
  const matchesCount = Number.isFinite(Number(ranking.matches)) ? Number(ranking.matches) : team.matches;
  return `
    <div class="ranking-visual-explainer">
      <section class="ranking-score-hero">
        <div class="ranking-score-ring ${rankingTooltipClass()}" tabindex="0" style="--score:${score}" data-tooltip="${rankingTooltipText("A nota final mistura desempenho coletivo, conquistas, momento recente e rAAting 3.0 dos jogadores. Todos os blocos já chegam normalizados em 0-100.")}">
          <strong>${fmt(score, 1)}</strong>
          <span>nota final</span>
        </div>
        <div class="ranking-score-copy">
          <h2>${escapeHtml(team.name)}</h2>
          <p>Passe o mouse nos gráficos para mais detalhes e explicações.</p>
          <div class="ranking-formula-chips">
            <span>70% desempenho</span>
            <span>15% conquistas</span>
            <span>10% forma</span>
            <span>5% rAAting 3.0 jogadores</span>
          </div>
        </div>
      </section>
      <section class="ranking-visual-section">
        <div class="ranking-section-title">
          <h3>Composição da nota</h3>
          <span>valor do bloco x peso</span>
        </div>
        <div class="ranking-weight-bars">
          ${rankingWeightedBar("Desempenho", blocks.competitive, 70, "Mede desempenho coletivo através dos resultados, qualidade dos adversários, dominância, consistência e relevância das partidas.")}
          ${rankingWeightedBar("Conquistas", blocks.achievements, 15, "Valoriza campanhas em campeonatos por colocação, peso do evento, tamanho e recência.")}
          ${rankingWeightedBar("Forma recente", blocks.recentForm, 10, "Desempenho em uma janela de 60 dias, meia-vida de 30 dias.")}
          ${rankingWeightedBar("rAAting 3.0 jogadores", blocks.rosterStrength, 5, "Usa o rAAting 3.0 individual, estabilidade do core e profundidade.")}
        </div>
      </section>
      <section class="ranking-visual-section">
        <div class="ranking-section-title">
          <h3>Por dentro do desempenho</h3>
          <span>o motor do ranking</span>
        </div>
        <div class="ranking-competitive-layout">
          <div class="ranking-weight-bars">
            ${rankingWeightedBar("Modelos estatísticos", components.statisticalModels, 60, "Combina Colley, Massey, Elo final, Elo com margem, TrueSkill, PageRank, Bradley-Terry-Poisson e PCA.")}
            ${rankingWeightedBar("Força dos adversários", components.strengthOfSchedule, 20, "SOS (Strength of Schedule) geral considera todos os adversários; SOS de vitórias destaca quem foi batido.")}
            ${rankingWeightedBar("Dominância", components.dominance, 10, "Mede controle do placar pela margem relativa de rounds.")}
            ${rankingWeightedBar("Consistência", components.consistency, 5, "Penaliza oscilação e derrotas abaixo do esperado, principalmente quando a equipe era favorita.")}
            ${rankingWeightedBar("Relevância", components.relevance, 5, "Aumenta o peso de partidas mais importantes por campeonato, fase, série e recência.")}
          </div>
          <div class="ranking-side-cards">
            ${rankingMiniCard("SOS geral", sos.general, "Strength of Schedule: força média de todos os adversários enfrentados.")}
            ${rankingMiniCard("SOS vitórias", sos.wins, "Força média dos adversários vencidos. Vitórias fortes sobem mais.")}
            ${rankingMiniCard("Amostra", matchesCount, `${ranking.provisional ? `Provisório: menos de ${minimumMatches} partidas.` : "Amostra mínima validada."}`, 0, Math.max(12, minimumMatches))}
          </div>
        </div>
      </section>
      <section class="ranking-visual-section">
        <div class="ranking-section-title">
          <h3>Modelos estatísticos</h3>
          <span>leituras independentes</span>
        </div>
        ${rankingModelGrid(ranking.models || {})}
      </section>
      <section class="ranking-visual-section">
        <div class="ranking-section-title">
          <h3>Momento e rAAting 3.0</h3>
          <span>forma recente + lineup</span>
        </div>
        <div class="ranking-card-grid">
          ${rankingMiniCard("Partidas recentes", recent.matches ?? 0, "Quantidade de jogos na janela de 60 dias.", 0, 8)}
          ${rankingMiniCard("Desempenho ajustado", recent.adjustedPerformance, "Resultado recente ajustado pela força do adversário e margem.")}
          ${rankingMiniCard("Dominância recente", recent.dominance, "Controle de placar na janela recente.")}
          ${rankingMiniCard("rAAting individual", roster.individualRating, "rAAting 3.0 dos jogadores por esta equipe, ajustado pelo nível dos adversários.")}
          ${rankingMiniCard("Estabilidade core", roster.coreStability, "Quanto do core atual aparece nos jogos recentes da equipe.")}
          ${rankingMiniCard("Profundidade", roster.depth, "Quantidade de jogadores com volume suficiente pela equipe.")}
        </div>
      </section>
      <section class="ranking-visual-section">
        <div class="ranking-section-title">
          <h3>Conquistas</h3>
          <span>${ranking.achievements?.length ? "campanhas recentes" : "fallback neutro"}</span>
        </div>
        ${rankingAchievementSummary(ranking.achievements || [])}
      </section>
    </div>
  `;
}

function rankingWeightedBar(label, value, weight, tooltip) {
  const score = rankingSafeScore(value);
  const contribution = (score * weight) / 100;
  return `
    <div class="ranking-weight-bar ${rankingTooltipClass()}" tabindex="0" style="--value:${score}" data-tooltip="${rankingTooltipText(tooltip)}">
      <div class="ranking-weight-meta">
        <strong>${escapeHtml(label)}</strong>
          <span>${fmt(score, 1)} × ${weight}% = ${fmt(contribution, 1)}</span>
      </div>
      <div class="ranking-bar-track"><i></i></div>
    </div>
  `;
}

function rankingMiniCard(label, value, tooltip, digits = 1, max = 100) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0;
  const percent = clamp((numeric / Math.max(1, max)) * 100, 0, 100);
  return `
    <div class="ranking-mini-card ${rankingTooltipClass()}" tabindex="0" style="--value:${percent}" data-tooltip="${rankingTooltipText(tooltip)}">
      <strong>${fmt(numeric, digits)}</strong>
      <span>${escapeHtml(label)}</span>
      <div class="ranking-bar-track"><i></i></div>
    </div>
  `;
}

function rankingModelGrid(models) {
  const order = ["colley", "massey", "eloFinal", "eloMargin", "trueSkill", "pageRankWins", "bradleyTerryPoisson", "pcaCorrigido"];
  const entries = order.filter((key) => Object.hasOwn(models, key)).map((key) => [key, models[key]]);
  if (!entries.length) return `<div class="empty-state">Modelos indisponíveis para esta equipe.</div>`;
  return `
    <div class="ranking-model-grid visual">
      ${entries.map(([key, value]) => rankingMiniCard(rankingModelLabel(key), value, rankingModelTooltip(key))).join("")}
    </div>
  `;
}

function rankingModelLabel(key) {
  const labels = {
    colley: "Colley",
    massey: "Massey",
    eloFinal: "Elo final",
    eloMargin: "Elo margem",
    trueSkill: "TrueSkill",
    pageRankWins: "PageRank",
    bradleyTerryPoisson: "BT-Poisson",
    pcaCorrigido: "PCA corrigido",
  };
  return labels[key] || key;
}

function rankingModelTooltip(key) {
  const labels = {
    colley: "Modelo de vitórias e derrotas.",
    massey: "Modelo linear que olha diferença de rounds e oposição enfrentada.",
    eloFinal: "Elo cronológico usando apenas resultado final.",
    eloMargin: "Elo cronológico com bônus por margem de rounds.",
    trueSkill: "Estimativa bayesiana aproximada de habilidade com incerteza reduzida ao jogar mais.",
    pageRankWins: "Rede de vitórias: bater times fortes transfere mais força.",
    bradleyTerryPoisson: "Modelo probabilístico que mistura chance de vitória e placar em rounds.",
    pcaCorrigido: "Componente principal dos modelos.",
  };
  return labels[key] || "Modelo estatístico normalizado em 0-100.";
}

function rankingAchievementSummary(achievements) {
  if (!achievements.length) return `<div class="ranking-fallback-card ${rankingTooltipClass()}" tabindex="0" data-tooltip="${rankingTooltipText("Quando não há dados de conquistas, o bloco entra neutro em 50 para não quebrar nem punir artificialmente.")}"><strong>50.0</strong><span>fallback neutro por falta de conquistas</span></div>`;
  return `
    <div class="ranking-achievement-list">
      ${achievements
        .slice(0, 4)
        .map((row, index) => rankingAchievementCard(row, index))
        .join("")}
    </div>
  `;
}

function rankingAchievementCard(row, index) {
  const event = rankingTournamentForAchievement(row);
  const tooltip = index < 3 ? "Resultado entra com peso integral pela regra anti-farm." : "Resultado adicional entra com peso reduzido de 50% pela regra anti-farm.";
  return `
    <span class="ranking-achievement-card ${rankingTooltipClass()}" tabindex="0" data-tooltip="${rankingTooltipText(tooltip)}">
      ${eventLogo(event, "small")}
      <span class="ranking-achievement-main">
        <strong>${escapeHtml(event.name || row.eventId || "Campeonato")}</strong>
        <small>${escapeHtml(rankingPlacementLabel(row.placementLabel || row.range || row.placement))} - ${fmt(row.score, 1)} pts</small>
      </span>
    </span>
  `;
}

function rankingTournamentForAchievement(row) {
  const event = state.db?.tournaments.find((item) => item.id === row.eventId);
  if (event) return event;
  return {
    id: row.eventId || "evento",
    name: row.eventName || row.eventId || "Campeonato",
    logo: row.eventLogo || "",
    mark: eventAcronym(row.eventName || row.eventId || "EV"),
  };
}

function rankingPlacementLabel(value) {
  const text = String(value || "").trim();
  const normalized = normalize(text);
  if (["em andamento", "classificado", "classificada", "em disputa"].includes(normalized)) return "Em andamento";
  if (normalized === "eliminado" || normalized === "eliminada") return "Eliminado";
  const range = text.match(/(\d+)\D+(\d+)/);
  if (range) return `${range[1]}º-${range[2]}º lugar`;
  const ordinal = text.match(/^(\d+)(?:st|nd|rd|th)$/i);
  if (ordinal) return `${ordinal[1]}º lugar`;
  const placement = Number(value);
  if (!Number.isFinite(placement)) return "Colocação não informada";
  return `${placement}º lugar`;
}

function placementRangeFromValue(value) {
  const text = String(value || "").trim();
  const range = text.match(/(\d+)\D+(\d+)/);
  if (range) return { start: Number(range[1]), end: Number(range[2]), explicit: true };
  const single = text.match(/\d+/);
  if (single) return { start: Number(single[0]), end: Number(single[0]), explicit: false };
  return { start: 0, end: 0, explicit: false };
}

function placementRawValue(row) {
  return row?.placementLabel || row?.range || row?.placementRange || row?.placement || row?.place || "";
}

function placementIsOngoing(value) {
  const normalized = normalize(value);
  return ["em andamento", "classificado", "classificada", "em disputa"].includes(normalized);
}

function normalizePlacementRowsForDisplay(rows = []) {
  const normalized = rows.map((row, index) => {
    const raw = placementRawValue(row);
    const range = placementRangeFromValue(raw);
    return {
      ...row,
      range: String(row.range || row.placementLabel || raw),
      placementStart: range.start,
      placementEnd: range.end,
      explicitRange: range.explicit,
      originalIndex: index,
    };
  });
  const groups = new Map();
  normalized.forEach((row) => {
    const plainNumeric = row.range === String(row.placement || row.place || row.placementStart);
    if (!row.placementStart || row.explicitRange || !plainNumeric) return;
    const key = String(row.placementStart);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const start = group[0].placementStart;
    const end = start + group.length - 1;
    group.forEach((row) => {
      row.range = `${start}-${end}`;
      row.placementEnd = end;
    });
  }
  return normalized;
}

function tournamentConfiguredPlacementRows(eventId) {
  return normalizePlacementRowsForDisplay(state.db?.rankingWeights?.tournaments?.[eventId]?.placements || []);
}

function tournamentTeamPlacementRow(event, teamId) {
  const rows = event.placements?.length ? normalizePlacementRowsForDisplay(event.placements) : tournamentConfiguredPlacementRows(event.id);
  return rows.find((row) => (row.id || row.teamId) === teamId) || null;
}

function tournamentTeamEliminatedRow(event, teamId) {
  const rows = [...(event.eliminated || []), ...(event.swiss?.eliminated || [])];
  return rows.find((row) => (row.id || row.teamId) === teamId) || null;
}

function placementResultFromRow(row, event, fallback = "") {
  const raw = placementRawValue(row) || fallback;
  if (placementIsOngoing(raw)) {
    return eventIsDone(event)
      ? { placement: 0, placementLabel: "Colocação não informada", placementStatus: "unknown" }
      : { placement: 0, placementLabel: "Em andamento", placementStatus: "ongoing" };
  }
  const range = placementRangeFromValue(raw);
  return {
    placement: range.start || Number(row?.placement || 0) || 0,
    placementLabel: rankingPlacementLabel(raw),
    placementStatus: range.start ? "defined" : "unknown",
  };
}

function teamEventPlacementResult(teamId, event, achievement = null) {
  if (achievement?.placementLabel || achievement?.range || achievement?.placement) {
    return placementResultFromRow(achievement, event);
  }
  const official = tournamentTeamPlacementRow(event, teamId);
  if (official) return placementResultFromRow(official, event);
  const eliminated = tournamentTeamEliminatedRow(event, teamId);
  if (eliminated) return placementResultFromRow(eliminated, event, "Eliminado");
  if (!eventIsDone(event)) return { placement: 0, placementLabel: "Em andamento", placementStatus: "ongoing" };
  return { placement: 0, placementLabel: "Colocação não informada", placementStatus: "unknown" };
}

function rankingSafeScore(value) {
  return clamp(Number.isFinite(Number(value)) ? Number(value) : 50, 0, 100);
}

function rankingTooltipClass() {
  return "has-ranking-tooltip";
}

function rankingTooltipText(value) {
  return escapeHtml(value || "");
}

function bindRankingScopeToggle() {
  document.querySelectorAll("[data-ranking-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      const scope = button.dataset.rankingScope === "all" ? "all" : "valid";
      if (state.rankingScope === scope) return;
      state.rankingScope = scope;
      updateRankingScopeView(scope);
    });
  });
}

function bindRankingVersionPicker() {
  document.querySelector("[data-ranking-version]")?.addEventListener("change", (event) => {
    state.rankingVersionId = event.currentTarget.value || "";
    updateRankingVersionView();
  });
}

function bindRankingScoreDetailsToggle() {
  document.querySelector("[data-ranking-score-details]")?.addEventListener("change", (event) => {
    state.rankingShowDetails = Boolean(event.currentTarget.checked);
    updateRankingDetailsVisibility(state.rankingShowDetails);
  });
}

// Os dois caminhos que trocam as linhas sem re-renderizar a pagina (semana e
// escopo) precisam mexer nos mesmos tres lugares. Quando o resumo de movimento
// entrou, ele ficou de fora dos dois e a barra continuava dizendo "5 subiram"
// depois de trocar para uma semana com 14 quedas. Um helper so, para o proximo
// campo da barra nao repetir o esquecimento.
function updateRankingToolbarSummaries(scope) {
  const count = document.querySelector("[data-ranking-count]");
  if (count) count.textContent = rankingScopeSummary(scope);
  const botao = document.querySelector('[data-ranking-tab="partidas"]');
  if (!botao) return;
  const total = rankingWeekMatches().length;
  botao.textContent = total
    ? `${total} ${total > 1 ? "novas partidas contabilizadas" : "nova partida contabilizada"}`
    : "Nenhuma partida nova nesta semana";
  botao.disabled = !total;
}

// Quantas partidas entraram e de que janela - o contrapeso da esquerda quando a
// aba de partidas esta aberta.
function rankingWeekMatchesSummary(matches, snapshot) {
  const janela = rankingWeekWindow(snapshot);
  const total = matches.length;
  const quantas = `${total} ${total === 1 ? "partida" : "partidas"}`;
  if (!janela) return quantas;
  return `${quantas} · ${formatShortDate(janela.inicio)} a ${formatShortDate(janela.fim)}`;
}

function updateRankingVersionView() {
  const rowsRoot = document.querySelector("[data-ranking-rows]");
  if (!rowsRoot) {
    renderRankingPage();
    return;
  }
  const scope = state.rankingScope === "all" ? "all" : "valid";
  const rows = rankingRowsForScope(state.db.teams, scope);
  rowsRoot.innerHTML = rankingAccordionRows(rows);
  updateRankingToolbarSummaries(scope);
}

function updateRankingDetailsVisibility(showDetails) {
  const accordion = document.querySelector("[data-ranking-accordion]");
  if (!accordion) {
    renderRankingPage();
    return;
  }
  if (!showDetails && ["competitive", "achievements", "recentForm", "rosterStrength"].includes(state.rankingSort?.key)) {
    state.rankingSort = { key: "", direction: "default" };
    updateRankingSortView();
  }
  accordion.dataset.detailsVisible = String(showDetails);
}

function updateRankingScopeView(scope) {
  const switcher = document.querySelector(".ranking-scope-switch");
  const accordion = document.querySelector("[data-ranking-accordion]");
  const rowsRoot = document.querySelector("[data-ranking-rows]");
  if (!switcher || !accordion || !rowsRoot) {
    renderRankingPage();
    return;
  }

  switcher.dataset.scope = scope;
  switcher.querySelectorAll("[data-ranking-scope]").forEach((button) => {
    const active = button.dataset.rankingScope === scope;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (scope !== "all" && state.rankingSort?.key === "status") {
    state.rankingSort = { key: "", direction: "default" };
    updateRankingSortIndicators();
  }
  accordion.dataset.statusVisible = String(scope === "all");
  accordion.dataset.detailsVisible = String(state.rankingShowDetails);
  window.clearTimeout(state.rankingScopeUpdateTimer);
  state.rankingScopeUpdateTimer = window.setTimeout(() => {
    const rows = rankingRowsForScope(state.db.teams, scope);
    rowsRoot.innerHTML = rankingAccordionRows(rows);
    updateRankingToolbarSummaries(scope);
  }, 170);
}

function bindRankingSortHeaders() {
  document.querySelectorAll("[data-ranking-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      cycleRankingSort(button.dataset.rankingSort || "");
      updateRankingSortView();
    });
  });
}

function cycleRankingSort(key) {
  if (!key) return;
  const current = state.rankingSort || { key: "", direction: "default" };
  if (current.key !== key || current.direction === "default") {
    state.rankingSort = { key, direction: "desc" };
  } else if (current.direction === "desc") {
    state.rankingSort = { key, direction: "asc" };
  } else {
    state.rankingSort = { key: "", direction: "default" };
  }
}

function updateRankingSortView() {
  const rowsRoot = document.querySelector("[data-ranking-rows]");
  if (!rowsRoot) {
    renderRankingPage();
    return;
  }
  rowsRoot.innerHTML = rankingAccordionRows(rankingRowsForScope(state.db.teams, state.rankingScope === "all" ? "all" : "valid"));
  updateRankingSortIndicators();
}

function updateRankingSortIndicators() {
  const sort = state.rankingSort || { key: "", direction: "default" };
  document.querySelectorAll("[data-ranking-sort]").forEach((button) => {
    const active = button.dataset.rankingSort === sort.key && sort.direction !== "default";
    const direction = active ? sort.direction : "default";
    const icon = button.querySelector("i");
    const label = button.querySelector("span")?.textContent || "Coluna";
    const title = direction === "desc" ? "Ordenado decrescente" : direction === "asc" ? "Ordenado crescente" : "Ordenação padrão";
    button.classList.toggle("active", active);
    button.dataset.sortDirection = direction;
    button.setAttribute("title", title);
    button.setAttribute("aria-label", `${label}: ${title}`);
    if (icon) icon.textContent = direction === "desc" ? "↓" : direction === "asc" ? "↑" : "";
  });
}

function bindRankingAccordion() {
  const root = document.querySelector("[data-ranking-accordion]");
  root?.addEventListener("click", (event) => {
    const detailsButton = event.target.closest("[data-ranking-details]");
    if (detailsButton) {
      const item = detailsButton.closest(".ranking-accordion-item");
      if (!item) return;
      const open = !item.classList.contains("details-open");
      setRankingDetailsOpen(item, open);
      return;
    }

    const button = event.target.closest("[data-ranking-toggle]");
    if (!button) return;
    const item = button.closest(".ranking-accordion-item");
    if (!item) return;
    const shouldOpen = !item.classList.contains("open");
    root.querySelectorAll(".ranking-accordion-item.open").forEach((openItem) => setRankingAccordionItem(openItem, false));
    setRankingAccordionItem(item, shouldOpen);
  });
}

function openRankingRouteTeam(teamId) {
  if (!teamId) return;
  const root = document.querySelector("[data-ranking-accordion]");
  const item = [...document.querySelectorAll("[data-ranking-team-id]")]
    .find((element) => element.dataset.rankingTeamId === teamId);
  if (!root || !item) return;
  root.querySelectorAll(".ranking-accordion-item.open").forEach((openItem) => setRankingAccordionItem(openItem, false));
  setRankingAccordionItem(item, true);
  window.requestAnimationFrame(() => {
    item.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function setRankingAccordionItem(item, open) {
  item.classList.toggle("open", open);
  item.querySelector("[data-ranking-toggle]")?.setAttribute("aria-expanded", String(open));
  const painel = item.querySelector(".ranking-dropdown");
  painel?.setAttribute("aria-hidden", String(!open));
  // aria-hidden esconde da leitura de tela mas NAO tira do tab order: com 44
  // sanfonas fechadas eram 1609 controles focaveis dentro de caixas de altura
  // zero. inert remove as duas coisas de uma vez.
  if (painel) painel.inert = !open;
  if (!open) setRankingDetailsOpen(item, false);
}

function setRankingDetailsOpen(item, open) {
  item.classList.toggle("details-open", open);
  item.querySelector("[data-ranking-details]")?.setAttribute("aria-expanded", String(open));
  const detalhe = item.querySelector(".ranking-detail-dropdown");
  detalhe?.setAttribute("aria-hidden", String(!open));
  if (detalhe) detalhe.inert = !open;
}

function safeDomId(value) {
  return String(value || "").replace(/[^a-z0-9_-]+/gi, "-");
}

const pendingMatchDetailRequests = new Map();

function ensureMatchDetails(matches) {
  for (const match of matches) {
    if (!match.detailPending || !match.sourcePath || pendingMatchDetailRequests.has(match.id)) continue;
    const request = loadJson(match.sourcePath)
      .then((raw) => {
        match.roundResults = raw.roundResults || [];
      })
      .catch((error) => {
        console.error(`Falha ao carregar detalhes da partida ${match.id}`, error);
      })
      .then(() => {
        match.detailPending = false;
        pendingMatchDetailRequests.delete(match.id);
        render();
      });
    pendingMatchDetailRequests.set(match.id, request);
  }
}

function renderMatchDetail(id) {
  const db = state.db;
  const match = db.matches.find((item) => item.id === id);
  if (!match) return renderNotFound("Partida");
  const series = matchSeries(match);
  const aggregateMode = route().tab === "all" && series.length > 1;
  const selectedMatches = aggregateMode ? series : [match];
  const pendingDetail = selectedMatches.filter((item) => item.detailPending);
  if (pendingDetail.length) {
    ensureMatchDetails(pendingDetail);
    return Shell(`<div class="empty-state">Carregando detalhes da partida...</div>`);
  }
  const viewPlayers = aggregateMode ? aggregateMatchPlayers(selectedMatches) : hydrateMatchPlayers(match.players);
  const teamAViewPlayers = viewPlayers.filter((player) => player.teamId === match.teamA.id);
  const teamBViewPlayers = viewPlayers.filter((player) => player.teamId === match.teamB.id);
  const teamAPlayers = sortedScoreboardPlayers(match, match.teamA, teamAViewPlayers);
  const teamBPlayers = sortedScoreboardPlayers(match, match.teamB, teamBViewPlayers);
  const teamALineupPlayers = defaultScoreboardPlayers(teamAViewPlayers).slice(0, 5);
  const teamBLineupPlayers = defaultScoreboardPlayers(teamBViewPlayers).slice(0, 5);
  const mvp = viewPlayers.slice().sort((a, b) => Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0) || Number(playerSwingPerRound(b) || 0) - Number(playerSwingPerRound(a) || 0))[0];
  const event = db.tournaments.find((item) => item.id === match.eventId);
  const score = matchDisplayScore(match, selectedMatches, aggregateMode);
  const scopeLabel = aggregateMode ? score.label : match.mapName;
  const scoreboardMode = matchScoreboardMode();
  const scoreboardColumnsList = scoreboardColumns(scoreboardMode);
  const mapSlide = panelSlideSnapshot("match-maps", {
    selector: ".match-tab-panel",
    scope: match.seriesKey,
    key: aggregateMode ? "all" : match.id,
    order: ["all", ...series.map((item) => item.id)],
  });
  Shell(`
    <section class="match-page">
      <header class="match-hero ${aggregateMode ? "series-hero" : "map-hero"}">
        ${matchHeroBanners(selectedMatches)}
        <h1 class="sr-only">${escapeHtml(match.teamA.name)} ${score.a} x ${score.b} ${escapeHtml(match.teamB.name)}</h1>
        ${matchHeroMeta(match, event, score, aggregateMode)}
        <div class="match-hero-score">
          <a class="match-team-name" href="#/teams/${match.teamA.id}">
            ${teamLogo(match.teamA.id, "large")}
            <span>${escapeHtml(match.teamA.name)}</span>
          </a>
          <div class="match-score-core">
            <span>FINAL</span>
            <strong><span class="${score.a > score.b ? "score-win" : ""}">${score.a}</span><span>:</span><span class="${score.b > score.a ? "score-win" : ""}">${score.b}</span></strong>
            <em>${escapeHtml(score.label)}</em>
          </div>
          <a class="match-team-name right" href="#/teams/${match.teamB.id}">
            ${teamLogo(match.teamB.id, "large")}
            <span>${escapeHtml(match.teamB.name)}</span>
          </a>
        </div>
      </header>

      ${matchMapTabs(match, series, aggregateMode)}

      <div class="match-tab-panel">
      ${matchMapOverview(match, selectedMatches, aggregateMode)}

      <div class="match-detail-grid">
        <div class="match-main-stack">
          <section class="match-panel">
            <div class="section-head match-scoreboard-head">
              <div class="match-scoreboard-title">
                <h2>Scoreboard · ${escapeHtml(scopeLabel)}</h2>
                <p>${escapeHtml(scoreboardMode === "advanced" ? "Composição da rAAting 3.0 e métricas ajustadas para auditoria." : "rAAting 3.0, ADR efetivo, KAST sem save em derrota e Round Swing zero-sum.")}</p>
              </div>
              <div class="match-scoreboard-mode-switch" data-scoreboard-mode="${escapeHtml(scoreboardMode)}" role="group" aria-label="Modo do scoreboard">
                <button type="button" data-match-scoreboard-mode="standard" aria-pressed="${scoreboardMode === "standard"}" class="${scoreboardMode === "standard" ? "active" : ""}">Padrão</button>
                <button type="button" data-match-scoreboard-mode="advanced" aria-pressed="${scoreboardMode === "advanced"}" class="${scoreboardMode === "advanced" ? "active" : ""}">Avançado</button>
              </div>
            </div>
            ${valorantScoreboard(match, match.teamA, teamAPlayers, scoreboardColumnsList)}
            ${valorantScoreboard(match, match.teamB, teamBPlayers, scoreboardColumnsList)}
          </section>
          <section class="match-panel">
            <div class="section-head"><h2>Lineups</h2><p>Comparativo histórico dos jogadores selecionados.</p></div>
            ${matchLineupComparison(match, match.teamA, teamALineupPlayers, match.teamB, teamBLineupPlayers)}
          </section>
        </div>
        <aside class="match-side-stack">
          ${matchMvpCard(mvp, selectedMatches.length)}
          <section class="match-panel">
            <div class="section-head"><h2>Comparativo</h2></div>
            ${teamCompareBars(match, selectedMatches)}
          </section>
          <section class="match-panel">
            <div class="section-head"><h2>Fonte</h2></div>
            <div class="simple-list">
              ${selectedMatches.map((item) => `<div class="simple-row"><span class="rank-number">API</span><span><strong>${escapeHtml(item.fileName)}</strong><br><span class="tiny">${escapeHtml(item.sourcePath)}</span></span><span></span></div>`).join("")}
            </div>
          </section>
        </aside>
      </div>
      </div>
    </section>
  `);
  bindScoreboardSort();
  bindLineupCompare();
  playPanelSlide(mapSlide);
}

function matchHeroMeta(match, event, score, aggregateMode) {
  return `
    <div class="match-hero-meta match-hero-meta-current">
      <div class="match-series-info">
        ${matchTournamentLink(event)}
        <strong>${escapeHtml(matchSeriesScopeLabel(match, aggregateMode))}</strong>
        <small>${escapeHtml(aggregateMode ? score.label : match.mapName)}</small>
      </div>
      <div class="match-date match-hero-date">
        <strong>${escapeHtml(formatDate(match.startedAt, "time"))}</strong>
        <span>Patch ${escapeHtml(patchLabel(match.gameVersion))}</span>
      </div>
    </div>
  `;
}

function matchSeriesScopeLabel(match, aggregateMode) {
  const series = `Série ${match.seriesCode || match.code || "-"}`;
  return aggregateMode ? series : `${series} · Jogo ${match.mapNumber || 1}`;
}

function matchTournamentLink(event) {
  if (!event) return `<span class="match-event-link"><span>Campeonato</span></span>`;
  return `
    <a class="match-event-link" href="#/tournaments/${event.id}">
      ${eventLogo(event, "small")}
      <span>${escapeHtml(event.name)}</span>
    </a>
  `;
}

function matchSeries(match) {
  return state.db.matches
    .filter((item) => item.seriesKey === match.seriesKey)
    .sort((a, b) => (a.mapNumber || 1) - (b.mapNumber || 1) || a.startedAt - b.startedAt);
}

function matchDisplayScore(match, selectedMatches, aggregateMode) {
  if (!aggregateMode) {
    return { a: match.teamA.score, b: match.teamB.score, label: match.mapName };
  }
  const score = seriesMapScore(selectedMatches, match.teamA.id, match.teamB.id);
  return {
    a: score.a,
    b: score.b,
    label: seriesFormatLabel(selectedMatches, score),
  };
}

function matchMapTabs(match, series, aggregateMode) {
  const showSeriesSummary = series.length > 1;
  return `
    <nav class="match-map-tabs" aria-label="Mapas da série">
      ${
        showSeriesSummary
          ? `<a class="match-map-tab series-tab ${aggregateMode ? "active" : ""}" href="#/matches/${match.id}/all">
              ${matchMapTabBackground(series)}
              <span class="match-map-tab-label">${escapeHtml(`Série ${seriesFormatLabel(series)}`)}</span>
            </a>`
          : ""
      }
      ${series
        .map(
          (item, index) => `
            <a class="match-map-tab ${!aggregateMode && item.id === match.id ? "active" : ""}" href="#/matches/${item.id}">
              ${matchMapTabBackground([item])}
              <span class="match-map-tab-label"><span>${index + 1}</span> ${escapeHtml(item.mapName)}</span>
            </a>
          `,
        )
        .join("")}
    </nav>
  `;
}

function matchHeroBanners(matches) {
  return `
    <div class="match-hero-banners" aria-hidden="true">
      ${matches
        .map((item) => {
          const asset = matchMapAsset(item);
          return `<span class="match-hero-banner">${asset.src ? `<img src="${escapeHtml(asset.src)}" data-fallback="${escapeHtml(asset.fallback)}" alt="" loading="lazy" onerror="mapArtError(this)" />` : ""}</span>`;
        })
        .join("")}
    </div>
  `;
}

function matchMapTabBackground(matches) {
  return `
    <span class="match-map-tab-bg" aria-hidden="true">
      ${matches
        .map((item) => {
          const asset = matchMapAsset(item);
          return `<span>${asset.src ? `<img src="${escapeHtml(asset.src)}" data-fallback="${escapeHtml(asset.fallback)}" alt="" loading="lazy" onerror="mapArtError(this)" />` : ""}</span>`;
        })
        .join("")}
    </span>
  `;
}

function matchMapAsset(match) {
  const map =
    mapById(match.mapId) ||
    mapByName(match.mapName) ||
    state.db?.maps.find((item) => normalizeNameKey(item.name) === normalizeNameKey(match.mapName)) ||
    {};
  const art = mapArtAttrs(map, match.mapIcon);
  return {
    name: map.name || match.mapName || "Mapa",
    src: art ? art.src : "",
    fallback: art ? art.fallback : "",
  };
}

function matchMapOverview(match, selectedMatches, aggregateMode) {
  if (aggregateMode) {
    return `
      <section class="match-map-overview aggregate">
        <div class="map-score-side">
          <strong>${selectedMatches.reduce((sum, item) => sum + (item.teamA.id === match.teamA.id ? item.teamA.score : item.teamB.score), 0)}</strong>
          <span>${escapeHtml(match.teamA.name)}</span>
        </div>
        <div class="map-center">
          <h2>${escapeHtml(seriesFormatLabel(selectedMatches))}</h2>
          <span>${selectedMatches.map((item) => item.mapName).join(" / ")}</span>
          <div class="map-mini-list">${selectedMatches.map((item) => `<a href="#/matches/${item.id}">${escapeHtml(item.mapName)} ${scoreForTeamInMatch(item, match.teamA.id)}-${scoreForTeamInMatch(item, match.teamB.id)}</a>`).join("")}</div>
        </div>
        <div class="map-score-side right">
          <strong>${selectedMatches.reduce((sum, item) => sum + (item.teamA.id === match.teamB.id ? item.teamA.score : item.teamB.score), 0)}</strong>
          <span>${escapeHtml(match.teamB.name)}</span>
        </div>
      </section>
    `;
  }

  return `
    <section class="match-map-overview">
      <div class="map-score-side">
        <strong class="${match.teamA.score > match.teamB.score ? "score-win" : ""}">${match.teamA.score}</strong>
        <span>${escapeHtml(match.teamA.name)}</span>
      </div>
      <div class="map-center">
        <h2>${escapeHtml(match.mapName)}</h2>
        <span>${formatDuration(match.durationMillis)} · Série ${escapeHtml(match.seriesCode || match.code)}</span>
      </div>
      <div class="map-score-side right">
        <strong class="${match.teamB.score > match.teamA.score ? "score-win" : ""}">${match.teamB.score}</strong>
        <span>${escapeHtml(match.teamB.name)}</span>
      </div>
      ${roundTimeline(match)}
    </section>
  `;
}

function scoreForTeamInMatch(match, teamId) {
  if (match.teamA.id === teamId) return match.teamA.score;
  if (match.teamB.id === teamId) return match.teamB.score;
  return 0;
}

function roundTimeline(match) {
  const rounds = match.roundResults || [];
  const grid = `grid-template-columns:128px repeat(${rounds.length}, 27px)`;
  return `
    <div class="round-timeline">
      <div class="round-row numbers" style="${grid}"><span></span>${rounds.map((round) => `<span>${round.roundNum + 1}</span>`).join("")}</div>
      ${roundTimelineTeam(match, match.teamA, grid)}
      ${roundTimelineTeam(match, match.teamB, grid)}
    </div>
  `;
}

function roundTimelineTeam(match, team, grid) {
  return `
    <div class="round-row" style="${grid}">
      <strong class="round-team-label">${teamLogo(team.id, "round-mini")}<span>${escapeHtml(team.sourceTag || team.tag || team.shortTag)}</span></strong>
      ${(match.roundResults || [])
        .map((round) => {
          const won = round.winningTeam === team.color;
          const sideClass = won ? roundSideClass(round) : "";
          return `<span class="round-cell ${won ? `won ${sideClass}` : ""}" title="${escapeHtml(roundRoundTitle(round))}">${won ? roundResultIcon(round) : ""}</span>`;
        })
        .join("")}
    </div>
  `;
}

function roundRoundTitle(round) {
  const side = round.winningTeamRole === "Attacker" ? "Ataque" : round.winningTeamRole === "Defender" ? "Defesa" : round.winningTeamRole || "";
  return [round.roundResult || "", side].filter(Boolean).join(" - ");
}

function roundSideClass(round) {
  return round.winningTeamRole === "Attacker" ? "side-attack" : round.winningTeamRole === "Defender" ? "side-defense" : "";
}

function roundResultIcon(round) {
  const icon = roundResultIconPath(round);
  const label = roundResultLabel(round);
  return icon ? `<img src="${escapeHtml(icon)}" alt="${escapeHtml(label)}" loading="lazy" onerror="this.remove()" />` : `<span>${escapeHtml(label.slice(0, 1))}</span>`;
}

function roundResultIconPath(round) {
  const code = String(round.roundResultCode || round.roundResult || "").toLowerCase();
  if (code.includes("defuse")) return "assets/rounds-icons/defuse.webp";
  if (code.includes("detonate") || code.includes("bomb")) return "assets/rounds-icons/boom.webp";
  if (code.includes("timer")) return "assets/rounds-icons/time.webp";
  return "assets/rounds-icons/elim.webp";
}

function roundResultLabel(round) {
  const code = String(round.roundResultCode || round.roundResult || "").toLowerCase();
  if (code.includes("defuse")) return "Defuse";
  if (code.includes("detonate") || code.includes("bomb")) return "Spike";
  if (code.includes("timer")) return "Tempo";
  return "Eliminação";
}

function hydrateMatchPlayers(players) {
  return players.map((player) => ({
    ...player,
    agentList: player.agentList?.length ? player.agentList : [{ slug: player.agentSlug, name: player.agent, icon: player.agentIcon, role: player.agentClass, rounds: player.rounds }],
  }));
}

function aggregateMatchPlayers(matches) {
  const byId = new Map();
  for (const match of matches) {
    for (const player of match.players) {
      if (!byId.has(player.id)) {
        byId.set(player.id, {
          ...player,
          matches: 0,
          maps: 0,
          score: 0,
          rounds: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
          damage: 0,
          firstKills: 0,
          firstDeaths: 0,
          kastRounds: 0,
          impactTotal: 0,
          ...emptyRaatingAggregateFields(),
          headshots: 0,
          bodyshots: 0,
          legshots: 0,
          agents: new Map(),
        });
      }
      const row = byId.get(player.id);
      row.matches += 1;
      row.maps += 1;
      row.score += player.score;
      row.rounds += player.rounds;
      row.kills += player.kills;
      row.deaths += player.deaths;
      row.assists += player.assists;
      row.damage += player.damage;
      row.firstKills += player.firstKills;
      row.firstDeaths += player.firstDeaths;
      row.kastRounds += player.kastRounds;
      row.impactTotal += player.impactTotal;
      addRaatingAggregateFields(row, player);
      row.headshots += player.headshots;
      row.bodyshots += player.bodyshots;
      row.legshots += player.legshots;
      row.teamId = player.teamId || row.teamId;
      row.teamTag = player.teamTag || row.teamTag;
      const agentKey = player.agentSlug || player.agent;
      const existing = row.agents.get(agentKey) || { slug: player.agentSlug, name: player.agent, icon: player.agentIcon, role: player.agentClass, rounds: 0 };
      existing.rounds += player.rounds;
      row.agents.set(agentKey, existing);
    }
  }

  return [...byId.values()].map(finalizeAggregatePlayer);
}

function finalizeAggregatePlayer(player) {
  player.acs = player.rounds ? player.score / player.rounds : 0;
  player.adr = player.rounds ? player.damage / player.rounds : 0;
  player.kpr = player.rounds ? player.kills / player.rounds : 0;
  player.dpr = player.rounds ? player.deaths / player.rounds : 0;
  player.apr = player.rounds ? player.assists / player.rounds : 0;
  player.kd = player.deaths ? player.kills / player.deaths : player.kills;
  player.kastFrac = player.rounds ? player.kastRounds / player.rounds : 0;
  player.kast = player.kastFrac * 100;
  player.impactRound = player.rounds ? player.impactTotal / player.rounds : 0;
  player.impactRoundLegacy = player.rounds ? Number(player.impactTotalLegacy || 0) / player.rounds : 0;
  player.kastLegacyFrac = player.rounds ? Number(player.kastLegacyRounds || 0) / player.rounds : player.kastFrac;
  player.kastLegacy = player.kastLegacyFrac * 100;
  const shots = player.headshots + player.bodyshots + player.legshots;
  player.hs = shots ? (player.headshots / shots) * 100 : 0;
  applyRaatingFields(player);
  player.agentList = [...player.agents.values()].sort((a, b) => b.rounds - a.rounds);
  const topAgent = player.agentList[0];
  player.agent = topAgent?.name || player.agent;
  player.agentSlug = topAgent?.slug || player.agentSlug;
  player.agentIcon = topAgent?.icon || player.agentIcon;
  player.agentClass = topAgent?.role || player.agentClass;
  return player;
}

const SCOREBOARD_STANDARD_COLUMNS = [
  {
    key: "rating",
    col: "rating",
    label: "rAAting 3.0",
    summaryLabel: "rAAting 3.0",
    summaryTitle: "rAAting média dos jogadores, ponderada por rounds.",
    headingClass: "rating-heading",
    aggregate: "weighted",
    value: (player) => officialRatingValue(player),
    format: (value) => formatScoreboardNumber(value),
    cellFormat: (player) => playerRating(player),
    tone: (value) => ratingTone(value),
    cellTone: (player) => playerRatingTone(player),
    cellClass: "rating-cell",
    title: (player) => ratingBreakdownTooltip(player),
  },
  { key: "acs", col: "acs", label: "ACS", aggregate: "weighted", value: (player) => player.acs, format: (value) => formatScoreboardNumber(value, 0) },
  { key: "kills", col: "k", label: "K", value: (player) => player.kills, format: (value, average) => formatScoreboardNumber(value, average ? 1 : 0) },
  { key: "deaths", col: "d", label: "D", value: (player) => player.deaths, format: (value, average) => formatScoreboardNumber(value, average ? 1 : 0) },
  { key: "assists", col: "a", label: "A", value: (player) => player.assists, format: (value, average) => formatScoreboardNumber(value, average ? 1 : 0) },
  { key: "diff", col: "diff", label: "+/-", aggregate: "total", value: (player) => player.kills - player.deaths, format: (value, average) => (average ? formatScoreboardSignedDecimal(value) : formatScoreboardSigned(value)), tone: (value) => signedTone(value) },
  { key: "kast", col: "kast", label: "KAST", aggregate: "weighted", value: (player) => player.kast, format: (value) => formatScoreboardPercent(value) },
  { key: "adr", col: "adr", label: "ADR", aggregate: "weighted", value: (player) => player.adr, format: (value) => formatScoreboardNumber(value, 0) },
  { key: "swing", col: "swing", label: "Swing/R", headingClass: "case-heading", aggregate: "weighted", value: (player) => playerSwingPerRound(player), format: (value) => formatScoreboardSignedDecimal(value), tone: (value) => directionalTone(value) },
  { key: "multiKills", col: "mks", label: "MKs", value: (player) => playerMultiKillRounds(player), format: (value, average) => formatScoreboardNumber(value, average ? 1 : 0) },
  { key: "firstKills", col: "fk", label: "FK", value: (player) => player.firstKills, format: (value, average) => formatScoreboardNumber(value, average ? 1 : 0) },
  { key: "firstDeaths", col: "fd", label: "FD", value: (player) => player.firstDeaths, format: (value, average) => formatScoreboardNumber(value, average ? 1 : 0) },
  { key: "fkFdDiff", col: "fk-fd", label: "FK-FD", aggregate: "total", value: (player) => player.firstKills - player.firstDeaths, format: (value, average) => (average ? formatScoreboardSignedDecimal(value) : formatScoreboardSigned(value)), tone: (value) => signedTone(value) },
];

const SCOREBOARD_ADVANCED_COLUMNS = [
  SCOREBOARD_STANDARD_COLUMNS[0],
  { key: "kill_rating", col: "kill-rating", label: "KillRating", aggregate: "weighted", value: (player) => metricValue(player, "kill_rating"), format: (value) => formatScoreboardNumber(value) },
  { key: "damage_rating", col: "damage-rating", label: "DamageRating", aggregate: "weighted", value: (player) => metricValue(player, "damage_rating"), format: (value) => formatScoreboardNumber(value) },
  { key: "round_swing_rating", col: "round-swing-rating", label: "RoundSwingRating", aggregate: "weighted", value: (player) => metricValue(player, "round_swing_rating"), format: (value) => formatScoreboardNumber(value) },
  { key: "survival_rating", col: "survival-rating", label: "SurvivalRating", aggregate: "weighted", value: (player) => metricValue(player, "survival_rating"), format: (value) => formatScoreboardNumber(value) },
  { key: "kast_rating", col: "kast-rating", label: "KASTRating", aggregate: "weighted", value: (player) => metricValue(player, "kast_rating"), format: (value) => formatScoreboardNumber(value) },
  { key: "multi_kill_rating", col: "multi-kill-rating", label: "MultiKillRating", aggregate: "weighted", value: (player) => metricValue(player, "multi_kill_rating"), format: (value) => formatScoreboardNumber(value) },
  { key: "ekpr", col: "ekpr", label: "eKPR", aggregate: "weighted", value: (player) => metricValue(player, "ekpr"), format: (value) => formatScoreboardNumber(value) },
  { key: "edpr", col: "edpr", label: "eDPR", aggregate: "weighted", value: (player) => metricValue(player, "edpr"), format: (value) => formatScoreboardNumber(value) },
  { key: "eadr", col: "eadr", label: "eADR", aggregate: "weighted", value: (player) => metricValue(player, "eadr"), format: (value) => formatScoreboardNumber(value, 0) },
  { key: "ekast", col: "ekast", label: "eKAST", aggregate: "weighted", value: (player) => metricValue(player, "ekast"), format: (value) => formatScoreboardPercent(value) },
  { key: "mk_per_r", col: "mk-r", label: "MK/R", aggregate: "weighted", value: (player) => metricValue(player, "mk_per_r"), format: (value) => formatScoreboardNumber(value) },
  { key: "swing", col: "swing", label: "Swing/R", headingClass: "case-heading", aggregate: "weighted", value: (player) => playerSwingPerRound(player), format: (value) => formatScoreboardSignedDecimal(value), tone: (value) => directionalTone(value) },
];

function matchScoreboardMode() {
  return state.matchScoreboardMode === "advanced" ? "advanced" : "standard";
}

function scoreboardColumns(mode = matchScoreboardMode()) {
  return mode === "advanced" ? SCOREBOARD_ADVANCED_COLUMNS : SCOREBOARD_STANDARD_COLUMNS;
}

function valorantScoreboard(match, team, players, columns = scoreboardColumns()) {
  const boardKey = scoreboardBoardKey(match, team);
  const modeClass = columns === SCOREBOARD_ADVANCED_COLUMNS ? "scoreboard-advanced" : "scoreboard-standard";
  return `
    <div class="vlr-board">
      <div class="match-scoreboard-summary-wrap">
        <table class="match-scoreboard match-scoreboard-summary ${escapeHtml(modeClass)}">
          ${scoreboardColgroup(columns)}
          <tbody>
            <tr>
              <td colspan="2" class="vlr-board-identity-cell">
                <span class="vlr-board-identity">${teamLogo(team.id)}<strong>${escapeHtml(team.name)}</strong><small>${escapeHtml(team.sourceTag || team.tag)}</small></span>
              </td>
              ${scoreboardTeamAverages(players, columns)}
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-wrap match-scoreboard-wrap">
        <table class="match-scoreboard ${escapeHtml(modeClass)}">
          ${scoreboardColgroup(columns)}
          <thead>${scoreboardHeader(boardKey, columns)}</thead>
          <tbody>${players.map((player) => scoreboardRow(player, columns)).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function scoreboardColgroup(columns = scoreboardColumns()) {
  const colNames = ["player", "agents", ...columns.map((column) => column.col)];
  return `<colgroup>${colNames.map((name) => `<col class="score-col-${name}" />`).join("")}</colgroup>`;
}

function scoreboardHeader(boardKey, columns = scoreboardColumns()) {
  return `
    <tr>
      <th>Jogador</th>
      <th>Agentes</th>
      ${columns.map((column) => scoreboardHeaderCell(boardKey, column)).join("")}
    </tr>
  `;
}

function scoreboardHeaderCell(boardKey, column) {
  const current = state.matchScoreboardSort?.[boardKey];
  const active = current?.key === column.key;
  const direction = active ? current.direction : "";
  const indicator = direction === "asc" ? "^" : direction === "desc" ? "v" : "";
  const className = ["numeric", column.headingClass || "", active ? "sorted" : ""].filter(Boolean).join(" ");
  const nextLabel = direction === "asc" ? "decrescente" : direction === "desc" ? "padrão" : "crescente";
  return `
    <th class="${escapeHtml(className)}" aria-sort="${direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}">
      <button type="button" class="score-sort-button" data-board-key="${escapeHtml(boardKey)}" data-scoreboard-sort="${escapeHtml(column.key)}" aria-label="Ordenar por ${escapeHtml(column.label)}: ${nextLabel}" title="${escapeHtml(metricHint(column.label))}">
        <span>${escapeHtml(column.label)}</span><i aria-hidden="true">${escapeHtml(indicator)}</i>
      </button>
    </th>
  `;
}

function scoreboardTeamAverages(players, columns = scoreboardColumns()) {
  return columns.map((column) => {
    const value = scoreboardTeamMetricValue(players, column);
    const tone = column.tone?.(value) || "";
    const className = ["vlr-board-metric", tone].filter(Boolean).join(" ");
    const title = column.summaryTitle ? ` title="${escapeHtml(column.summaryTitle)}"` : "";
    return `<td class="${escapeHtml(className)}"${title}><small>${escapeHtml(column.summaryLabel || column.label)}</small><strong>${escapeHtml(formatScoreboardColumnValue(column, value, true))}</strong></td>`;
  }).join("");
}

function scoreboardTeamMetricValue(players, column) {
  if (!players.length) return 0;
  if (column.aggregate === "total") {
    return players.reduce((sum, player) => sum + Number(column.value(player) || 0), 0);
  }
  if (column.aggregate === "weighted") {
    return weightedAverage(players, column.value, (player) => Number(player.rounds || 0));
  }
  return avg(players.map((player) => column.value(player)));
}

function weightedAverage(rows, valueFn, weightFn) {
  const totals = rows.reduce(
    (acc, row) => {
      const value = Number(valueFn(row));
      const weight = Number(weightFn(row));
      if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) return acc;
      acc.value += value * weight;
      acc.weight += weight;
      return acc;
    },
    { value: 0, weight: 0 },
  );
  return totals.weight ? totals.value / totals.weight : 0;
}

function signedDecimal(value, digits = 1) {
  if (value > 0) return `+${fmt(value, digits)}`;
  if (value < 0) return `-${fmt(Math.abs(value), digits)}`;
  return fmt(0, digits);
}

function scoreboardBoardKey(match, team) {
  const tab = route().tab || "map";
  return `${match.id}:${tab}:${matchScoreboardMode()}:${team.id}`;
}

function defaultScoreboardPlayers(players) {
  return players.slice().sort((a, b) => Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0) || Number(playerSwingPerRound(b) || 0) - Number(playerSwingPerRound(a) || 0) || a.nick.localeCompare(b.nick));
}

function sortedScoreboardPlayers(match, team, players) {
  const defaultPlayers = defaultScoreboardPlayers(players);
  const current = state.matchScoreboardSort?.[scoreboardBoardKey(match, team)];
  const column = scoreboardColumns().find((item) => item.key === current?.key);
  if (!column || !current?.direction) return defaultPlayers;
  const direction = current.direction === "asc" ? 1 : -1;
  return defaultPlayers
    .map((player, index) => ({ player, index }))
    .sort((a, b) => {
      const valueA = Number(column.value(a.player) || 0);
      const valueB = Number(column.value(b.player) || 0);
      if (valueA !== valueB) return (valueA - valueB) * direction;
      return a.index - b.index;
    })
    .map((row) => row.player);
}

function cycleScoreboardSort(boardKey, key) {
  const current = state.matchScoreboardSort?.[boardKey];
  if (!state.matchScoreboardSort) state.matchScoreboardSort = {};
  if (!current || current.key !== key) {
    state.matchScoreboardSort[boardKey] = { key, direction: "asc" };
    return;
  }
  if (current.direction === "asc") {
    state.matchScoreboardSort[boardKey] = { key, direction: "desc" };
    return;
  }
  delete state.matchScoreboardSort[boardKey];
}

function bindScoreboardSort() {
  const page = document.querySelector(".match-page");
  page?.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-match-scoreboard-mode]");
    if (modeButton) {
      setMatchScoreboardMode(modeButton.dataset.matchScoreboardMode);
      return;
    }
    const button = event.target.closest("[data-scoreboard-sort]");
    if (!button) return;
    cycleScoreboardSort(button.dataset.boardKey, button.dataset.scoreboardSort);
    renderMatchDetail(route().id);
  });
}

function setMatchScoreboardMode(mode) {
  const next = mode === "advanced" ? "advanced" : "standard";
  if (state.matchScoreboardMode === next) return;
  state.matchScoreboardMode = next;
  renderMatchDetail(route().id);
}

function formatScoreboardColumnValue(column, value, average = false) {
  return column.format ? column.format(value, average) : formatScoreboardNumber(value, average ? 1 : 0);
}

function formatScoreboardNumber(value, digits = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? fmt(numeric, digits) : "-";
}

function formatScoreboardPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? pct(numeric) : "-";
}

function formatScoreboardSigned(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? signed(numeric) : "-";
}

function formatScoreboardSignedDecimal(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? signedDecimal(numeric) : "-";
}

function scoreboardRow(player, columns = scoreboardColumns()) {
  return `
    <tr>
      <td>${entityLink("players", player.id, player.nick)}<br><span class="tiny">${escapeHtml(playerMatchHandle(player))}</span></td>
      <td>${agentStack(player)}</td>
      ${columns.map((column) => scoreboardCell(player, column)).join("")}
    </tr>
  `;
}

function scoreboardCell(player, column) {
  const value = column.value(player);
  const tone = column.cellTone?.(player) || column.tone?.(value, player) || "";
  const className = ["numeric", column.cellClass || "", tone].filter(Boolean).join(" ");
  const title = column.title?.(player);
  const titleAttr = title ? ` title="${escapeHtml(title)}" tabindex="0"` : "";
  const display = column.cellFormat ? column.cellFormat(player, value) : formatScoreboardColumnValue(column, value, false);
  return `<td class="${escapeHtml(className)}"${titleAttr}>${escapeHtml(display)}</td>`;
}

function playerMatchHandle(player) {
  const nick = player.apiNick || player.nick || "Jogador";
  if (player.tagLine) return `${nick}#${player.tagLine}`;
  return player.handle || nick;
}

function agentStack(player) {
  const agents = (player.agentList?.length ? player.agentList : [{ slug: player.agentSlug, name: player.agent, icon: player.agentIcon, role: player.agentClass }]).slice(0, 4);
  return `<span class="agent-stack">${agents.map(agentMiniIcon).join("")}</span>`;
}

function agentMiniIcon(agent) {
  const label = displayAgentName(agent.name, agent.slug).slice(0, 2).toUpperCase();
  const image = agent.icon ? `<img src="${escapeHtml(assetPath(agent.icon))}" alt="${escapeHtml(agent.name || label)}" loading="lazy" onerror="this.remove()" />` : "";
  return `<span class="agent-mini" title="${escapeHtml(agent.name || label)}"><span>${escapeHtml(label)}</span>${image}</span>`;
}

function roleMiniIcon(role) {
  const info = role || { label: "Classe", icon: "", rounds: 0 };
  const title = `${info.label}${info.rounds ? ` - ${info.rounds} rounds` : ""}`;
  const image = info.icon ? `<img src="${escapeHtml(assetPath(info.icon))}" alt="${escapeHtml(info.label)}" loading="lazy" onerror="this.remove()" />` : "";
  const fallback = image ? "" : `<span>${escapeHtml(info.label.slice(0, 2).toUpperCase())}</span>`;
  return `<span class="role-mini" title="${escapeHtml(title)}">${fallback}${image}</span>`;
}

function roleDisplayInfo(role) {
  const key = normalizeRoleKey(role);
  if (key && ROLE_ICONS[key]) return { ...ROLE_ICONS[key], key };
  const label = displayEntityName(role || "Classe");
  return { key: "", label: label || "Classe", icon: "" };
}

function rolePill(role, extra = "") {
  const info = roleDisplayInfo(role);
  return `<span class="role-pill ${escapeHtml(extra)}">${roleMiniIcon(info)}<span>${escapeHtml(info.label)}</span></span>`;
}

function playerDominantRole(player) {
  const agents = player.agentList?.length
    ? player.agentList
    : player.agentStats?.length
      ? player.agentStats
    : [{ role: player.agentClass, rounds: player.rounds, name: player.agent, slug: player.agentSlug }];
  const roles = new Map();
  agents.forEach((agent, index) => {
    const key = normalizeRoleKey(agent.role || agent.agentClass || "");
    if (!key) return;
    const current = roles.get(key) || { ...ROLE_ICONS[key], key, rounds: 0, firstIndex: index };
    current.rounds += Number(agent.rounds || 0);
    roles.set(key, current);
  });
  return [...roles.values()].sort((a, b) => b.rounds - a.rounds || a.firstIndex - b.firstIndex)[0] || null;
}

function normalizeRoleKey(value) {
  const key = slugify(value);
  if (["controller", "controlador", "controladora"].includes(key)) return "controlador";
  if (["duelist", "duelista"].includes(key)) return "duelista";
  if (["initiator", "iniciador", "iniciadora"].includes(key)) return "iniciador";
  if (["sentinel", "sentinela"].includes(key)) return "sentinela";
  return "";
}

function matchLineupComparison(match, teamA, playersA, teamB, playersB) {
  const compareKey = lineupCompareKey(match);
  const selection = ensureLineupCompareSelection(compareKey, playersA, playersB);
  const selectedA = playersA.find((player) => player.id === selection.a) || playersA[0];
  const selectedB = playersB.find((player) => player.id === selection.b) || playersB[0];
  const scalePlayers = lineupScalePlayers(playersA, playersB);
  return `
    <div class="lineup-compare" data-lineup-key="${escapeHtml(compareKey)}">
      ${lineupTeamSelector(compareKey, "a", teamA, playersA, selectedA)}
      ${lineupComparisonStage(teamA, selectedA, teamB, selectedB, scalePlayers)}
      ${lineupTeamSelector(compareKey, "b", teamB, playersB, selectedB)}
    </div>
  `;
}

function lineupScalePlayers(playersA, playersB) {
  const fallbackPlayers = [...playersA.slice(0, 5), ...playersB.slice(0, 5)].map(lineupHistoricalPlayer);
  const historicalPlayers = (state.db?.players || []).filter((player) => Number(player.matches || 0) > 0);
  return [...historicalPlayers, ...fallbackPlayers];
}

function lineupCompareKey(match) {
  return `${match.id}:${route().tab || "map"}`;
}

function ensureLineupCompareSelection(compareKey, playersA, playersB) {
  if (!state.matchLineupCompare) state.matchLineupCompare = {};
  const current = state.matchLineupCompare[compareKey] || {};
  const fallback = {
    a: playersA[0]?.id || "",
    b: playersB[0]?.id || "",
  };
  const selection = {
    a: playersA.some((player) => player.id === current.a) ? current.a : fallback.a,
    b: playersB.some((player) => player.id === current.b) ? current.b : fallback.b,
  };
  state.matchLineupCompare[compareKey] = selection;
  return selection;
}

function lineupTeamSelector(compareKey, side, team, players, selected) {
  return `
    <section class="lineup-team-panel lineup-team-panel-${side}">
      <header>${teamLogo(team.id)}<strong>${escapeHtml(team.name)}</strong><span>Rank ${teamCanonicalRankLabel(teamById(team.id) || team)}</span></header>
      <div class="lineup-photo-grid">${players.slice(0, 5).map((player) => lineupSelectCard(compareKey, side, player, selected?.id === player.id)).join("")}</div>
    </section>
  `;
}

function lineupSelectCard(compareKey, side, player, active) {
  const historical = lineupHistoricalPlayer(player);
  return `
    <button type="button" class="lineup-photo-card lineup-select-card ${active ? "active" : ""}" data-lineup-key="${escapeHtml(compareKey)}" data-lineup-side="${escapeHtml(side)}" data-lineup-player="${escapeHtml(player.id)}" aria-pressed="${active ? "true" : "false"}">
      ${playerPortrait(historical)}
      <span>${roleMiniIcon(playerDominantRole(player))}</span>
      <strong>${escapeHtml(player.nick)}</strong>
    </button>
  `;
}

function lineupComparisonStage(teamA, playerA, teamB, playerB, scalePlayers = []) {
  if (!playerA || !playerB) return `<div class="empty-state">Selecione jogadores dos dois lados para comparar.</div>`;
  const left = lineupHistoricalPlayer(playerA);
  const right = lineupHistoricalPlayer(playerB);
  const scales = lineupStatScales([...scalePlayers, left, right]);
  return `
    <section class="lineup-compare-stage">
      ${lineupSelectedPlayer(teamA, left, playerA, "left")}
      <div class="lineup-stat-center">
        <h3>Histórico dos jogadores</h3>
        <small>Média de todas as partidas do jogador</small>
        <div class="lineup-stat-list">${lineupComparisonStats(left, right, scales)}</div>
      </div>
      ${lineupSelectedPlayer(teamB, right, playerB, "right")}
    </section>
  `;
}

function lineupSelectedPlayer(team, historical, matchPlayer, side) {
  return `
    <div class="lineup-selected-player ${side}">
      ${playerPortrait(historical)}
      <strong>${escapeHtml(historical.nick || matchPlayer.nick)}</strong>
      <span>${teamLogo(team.id, "tiny")}${escapeHtml(team.sourceTag || team.tag || matchPlayer.teamTag || "")}</span>
      <div class="lineup-selected-actions">
        <a href="${playerHref(matchPlayer)}">Player profile</a>
        <span>${escapeHtml(playerMatchHandle(matchPlayer))}</span>
      </div>
    </div>
  `;
}

function lineupComparisonStats(left, right, scales) {
  return lineupStatRows()
    .map((row) => {
      const leftValue = row.value(left);
      const rightValue = row.value(right);
      const scale = scales?.[row.key] || lineupSingleStatScale(row, [left, right]);
      const leftLevel = lineupMetricLevel(leftValue, scale);
      const rightLevel = lineupMetricLevel(rightValue, scale);
      const leftClass = lineupMetricClasses(leftValue, rightValue, scale);
      const rightClass = lineupMetricClasses(rightValue, leftValue, scale);
      return `
        <div class="lineup-stat-row" style="--left-level:${leftLevel}%; --right-level:${rightLevel}%;">
          <strong class="lineup-stat-value lineup-stat-value-left ${leftClass}"><span>${escapeHtml(row.format(leftValue, left))}</span></strong>
          <span class="lineup-stat-label">${escapeHtml(row.label)}</span>
          <strong class="lineup-stat-value lineup-stat-value-right ${rightClass}"><span>${escapeHtml(row.format(rightValue, right))}</span></strong>
        </div>
      `;
    })
    .join("");
}

function lineupStatScales(players) {
  return Object.fromEntries(lineupStatRows().map((row) => [row.key, lineupSingleStatScale(row, players)]));
}

function lineupSingleStatScale(row, players) {
  const values = players.map((player) => Number(row.value(player))).filter((value) => Number.isFinite(value));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return { min, max };
}

function lineupMetricLevel(value, scale) {
  const numeric = Number(value) || 0;
  const min = Number(scale?.min || 0);
  const max = Number(scale?.max || 0);
  if (max <= min) return 64;
  return Math.round(clamp(((numeric - min) / (max - min)) * 100, 8, 100));
}

function lineupMetricClasses(value, compareValue, scale) {
  const numeric = Number(value) || 0;
  const classes = [];
  if (numeric > Number(compareValue || 0)) classes.push("better");
  if (numeric === Number(scale?.max || 0) && Number(scale?.max || 0) > Number(scale?.min || 0)) classes.push("best");
  return classes.join(" ");
}

function lineupStatRows() {
  return [
    { key: "rating", label: "rAAting 3.0", value: (player) => officialRatingValue(player) || 0, format: (value, player) => playerRating(player) },
    { key: "acs", label: "ACS", value: (player) => player.acs || 0, format: (value) => fmt(value, 0) },
    { key: "kd", label: "K/D", value: (player) => player.kd || 0, format: (value) => fmt(value) },
    { key: "kast", label: "KAST", value: (player) => player.kast || 0, format: (value) => pct(value) },
    { key: "adr", label: "ADR", value: (player) => player.adr || 0, format: (value) => fmt(value, 0) },
    { key: "impactRound", label: "Swing/R", value: (player) => playerSwingPerRound(player) || 0, format: (value) => signedDecimal(value) },
    { key: "hs", label: "HS%", value: (player) => player.hs || 0, format: (value) => pct(value) },
    { key: "matches", label: "Partidas", value: (player) => player.matches || 0, format: (value) => fmt(value, 0) },
  ];
}

function lineupHistoricalPlayer(player) {
  const historical = playerById(player.id);
  if (!historical) return { ...player, matches: player.matches ?? 1 };
  return {
    ...historical,
    matchPlayer: player,
    agentList: player.agentList?.length ? player.agentList : historical.agentStats || historical.agentList || [],
    teamTag: player.teamTag || historical.teamTag,
  };
}

function bindLineupCompare() {
  document.querySelector(".lineup-compare")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-lineup-player]");
    if (!button) return;
    const key = button.dataset.lineupKey;
    const side = button.dataset.lineupSide;
    const playerId = button.dataset.lineupPlayer;
    if (!key || !side || !playerId) return;
    if (!state.matchLineupCompare) state.matchLineupCompare = {};
    state.matchLineupCompare[key] = {
      ...(state.matchLineupCompare[key] || {}),
      [side]: playerId,
    };
    renderMatchDetail(route().id);
  });
}

function playerPortrait(player) {
  const src = playerPhotoSrc(player);
  const classes = `player-portrait${player?.photo ? "" : " fallback"}`;
  return `<span class="${escapeHtml(classes)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(player?.nick || "Jogador")}" loading="lazy" onerror="playerPhotoError(this)" /></span>`;
}

function matchMvpCard(player, mapCount) {
  if (!player) return `<section class="match-panel"><div class="empty-state">Sem jogadores para calcular MVP.</div></section>`;
  return `
    <section class="match-panel mvp-card">
      <div class="section-head"><h2>Melhor da partida</h2><p>${mapCount > 1 ? `${mapCount} mapas` : "Mapa atual"}</p></div>
      <a class="mvp-identity" href="${playerHref(player)}">
        ${playerPortrait(player)}
        <span><strong>${escapeHtml(player.nick)}</strong><small>${escapeHtml(player.teamTag || player.currentTeam || "")}</small></span>
      </a>
      <div class="mvp-bars">
        ${mvpBar("rAAting 3.0", officialRatingValue(player), 1.8, playerRating(player))}
        ${mvpBar("ACS", player.acs, 330, fmt(player.acs, 0))}
        ${mvpBar("KAST", player.kast, 100, pct(player.kast))}
        ${mvpBar("ADR", player.adr, 220, fmt(player.adr, 0))}
        ${mvpBar("Swing/R", Math.max(playerSwingPerRound(player) + 12, 0), 24, `${signedDecimal(playerSwingPerRound(player))} pp`)}
      </div>
    </section>
  `;
}

function mvpBar(label, value, max, display) {
  return `<div class="mvp-bar"><span>${escapeHtml(label)}</span><div><i style="width:${clamp((value / max) * 100, 0, 100)}%"></i></div><strong>${escapeHtml(display)}</strong></div>`;
}

function playerRating(player) {
  if (Object.prototype.hasOwnProperty.call(player || {}, "matches") && Number(player.matches || 0) <= 0) return "---";
  const rating = officialRatingValue(player);
  return Number.isFinite(rating) ? fmt(rating) : "-";
}

function playerRatingTone(player) {
  if (Object.prototype.hasOwnProperty.call(player || {}, "matches") && Number(player.matches || 0) <= 0) return "";
  return ratingTone(officialRatingValue(player));
}

function ratingTone(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  if (numeric >= 1.25) return "perf-strong";
  if (numeric >= 1.15) return "perf-good";
  if (numeric >= 1.05) return "perf-positive";
  if (numeric < 0.85) return "perf-danger";
  if (numeric < 0.95) return "perf-bad";
  return "perf-neutral";
}

function signedTone(value) {
  const numeric = Number(value || 0);
  if (numeric >= 10) return "perf-strong";
  if (numeric >= 5) return "perf-good";
  if (numeric > 0) return "perf-positive";
  if (numeric <= -10) return "perf-danger";
  if (numeric <= -5) return "perf-bad";
  if (numeric < 0) return "perf-negative";
  return "perf-neutral";
}

function directionalTone(value) {
  const numeric = Number(value || 0);
  if (numeric > 0) return "perf-positive";
  if (numeric < 0) return "perf-negative";
  return "perf-neutral";
}

function metricValue(row, key, fallbackKey = "") {
  if (Object.prototype.hasOwnProperty.call(row || {}, key)) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value)) return value;
  }
  if (fallbackKey && Object.prototype.hasOwnProperty.call(row || {}, fallbackKey)) {
    const fallback = Number(row?.[fallbackKey]);
    if (Number.isFinite(fallback)) return fallback;
  }
  return NaN;
}

function officialRatingValue(player) {
  const primary = metricValue(player, "raating_3");
  if (Number.isFinite(primary)) return primary;
  if (player?.rating_version && player.rating_version !== "raa3") return NaN;
  return metricValue(player, "rating");
}

function playerSwingPerRound(player) {
  return metricValue(player, "adjusted_swing_percent", "impactRound");
}

function playerMultiKillRounds(player) {
  const roundCount = Number(player?.multi_kill_rounds);
  if (Number.isFinite(roundCount) && roundCount > 0) return roundCount;
  const counted = Number(player?.twoKills || 0) + Number(player?.threeKills || 0) + Number(player?.fourKills || 0) + Number(player?.fiveKills || 0);
  if (counted > 0) return counted;
  const points = Number(player?.multiKillPoints ?? player?.multi_kill_points);
  return Number.isFinite(points) ? points : 0;
}

function formatMaybeMetric(row, key, digits = 2, fallbackKey = "") {
  const value = metricValue(row, key, fallbackKey);
  return Number.isFinite(value) ? fmt(value, digits) : "-";
}

function formatMaybePercent(row, key, fallbackKey = "") {
  const value = metricValue(row, key, fallbackKey);
  return Number.isFinite(value) ? pct(value) : "-";
}

function formatMaybeSwing(row) {
  const value = playerSwingPerRound(row);
  return Number.isFinite(value) ? `${signedDecimal(value)} pp` : "-";
}

function sampleStatusChip(player) {
  if (!player || isOfficialRatingSample(player) || Number(player.matches || 0) <= 0) return "";
  return `<span class="chip low-sample-chip" title="Fora do ranking oficial: menos de ${RaaRatingCore.SAMPLE_MIN_ROUNDS} rounds jogados.">baixa amostra</span>`;
}

function ratingFormulaText(separator = "\n") {
  return [
    "rAAting 3.0 =",
    "25% Kills",
    "+ 15% Dano",
    "+ 4% Multi-kills",
    "+ 33% Round Swing",
    "+ 15% Sobrevivência",
    "+ 8% KAST",
  ].join(separator);
}

function ratingBreakdownTooltip(player) {
  return [
    `rAAting 3.0: ${playerRating(player)}`,
    "",
    "Composição:",
    `KillRating: ${formatMaybeMetric(player, "kill_rating")}`,
    `DamageRating: ${formatMaybeMetric(player, "damage_rating")}`,
    `RoundSwingRating: ${formatMaybeMetric(player, "round_swing_rating")}`,
    `SurvivalRating: ${formatMaybeMetric(player, "survival_rating")}`,
    `KASTRating: ${formatMaybeMetric(player, "kast_rating")}`,
    `MultiKillRating: ${formatMaybeMetric(player, "multi_kill_rating")}`,
    "",
    ratingFormulaText("\n"),
  ].join("\n");
}

function patchLabel(version) {
  const match = String(version || "").match(/release-([0-9.]+)/i);
  return match?.[1] || version || "-";
}

function renderTournamentDetail(id) {
  const event = visibleTournaments().find((item) => item.id === id);
  if (!event) return renderNotFound("Campeonato");
  const matches = matchSeriesForEvent(event.id);
  const standings = tournamentStandingsRows(event, matches);
  const activeTab = tournamentActiveTab();
  const tabTransition = panelSlideSnapshot("tournament-tabs", {
    selector: ".tournament-tab-panel",
    scope: event.id,
    key: activeTab,
    order: TOURNAMENT_TAB_KEYS,
  });
  Shell(`
    <article class="tournament-hub">
      ${tournamentHero(event, matches, standings)}
      ${tournamentTabNav(event, activeTab)}
      <div class="tournament-tab-panel">
        ${tournamentTabContent(event, matches, standings, activeTab)}
      </div>
    </article>
  `);
  if (activeTab === "overview") {
    bindTournamentBracketPreview(event, matches);
    bindTournamentTeamPreview(event, matches, standings);
  } else if (activeTab === "estatisticas" || activeTab === "agentes" || activeTab === "composicoes") {
    bindTournamentStatsControls(event.id);
  }
  playPanelSlide(tabTransition);
  /* Legacy compact tournament layout disabled after hub refresh.
  Shell(`
    <article class="tournament-hub">
      ${tournamentHero(event, matches, standings)}
      ${tournamentNav(event)}
      ${tournamentGroupedEvents(event, matches)}
      <div class="tournament-layout">
        <div class="tournament-main">
        <section class="section-band">
          ${sectionHead("Partidas do evento", "Séries consolidadas por partida e mapa.", null, null)}
          <div class="match-list">${matches.map(matchCard).join("")}</div>
        </section>
        <section class="section-band">
          ${sectionHead("Equipes participantes", "Detectadas pelos nomes dos arquivos importados.", null, null)}
          <div class="card-grid">${event.teams.map((teamId) => teamCard(teamById(teamId))).join("")}</div>
        </section>
        <section class="section-band">
          ${sectionHead("Melhores jogadores", "Ranking individual dentro dos arquivos do evento.", null, null)}
          ${playerTable(eventPlayers)}
        </section>
      </div>
      <aside class="side-rail">
        <section class="data-panel dark">
          <div class="section-head"><h2>Resumo</h2></div>
          <div class="stats-grid">
            ${stat(event.matches, "Partidas")}
            ${stat(event.teams.length, "Equipes")}
            ${stat(event.players.length, "Jogadores")}
            ${stat(event.maps.length, "Mapas")}
          </div>
        </section>
        <section class="data-panel">
          <div class="section-head"><h2>Mapas usados</h2></div>
          <div class="simple-list">${event.maps.map((name) => mapRow(mapByName(name))).join("")}</div>
        </section>
      </aside>
    </div>
  `);
  */
}

const TOURNAMENT_TAB_KEYS = ["overview", "jogos", "estatisticas", "mapas", "agentes", "composicoes"];

function tournamentActiveTab() {
  const tab = route().tab || "overview";
  return TOURNAMENT_TAB_KEYS.includes(tab) ? tab : "overview";
}

// Trocar de aba/secao re-renderiza a pagina inteira, entao o conteudo que esta
// saindo e guardado antes do Shell para o slide ter os dois lados (mesma
// transicao do line-up da equipe, onde os dois paineis vivem juntos no DOM).
// <details> abre e fecha na hora; a animacao roda na altura do corpo do filtro,
// entao o toggle nativo e substituido por um controlado.
function bindFilterDropdownMotion() {
  document.addEventListener("click", (clickEvent) => {
    const summary = clickEvent.target.closest?.(".filter-dropdown > summary");
    const details = summary?.parentElement;
    const body = details?.querySelector(":scope > .filter-dropdown-body");
    if (!summary || !body) return;
    clickEvent.preventDefault();
    if (details.dataset.motion === "running") return;
    details.dataset.motion = "running";
    const opening = !details.open;
    if (opening) details.open = true;
    body.style.overflow = "hidden";
    body.style.height = `${opening ? 0 : body.scrollHeight}px`;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      body.style.height = "";
      body.style.overflow = "";
      body.style.transition = "";
      delete details.dataset.motion;
      if (!opening) details.open = false;
    };
    body.addEventListener("transitionend", (motionEvent) => {
      if (motionEvent.target === body && motionEvent.propertyName === "height") finish();
    });
    setTimeout(finish, PANEL_SLIDE_MS * 3);

    let started = false;
    const start = () => {
      if (started || done) return;
      started = true;
      body.style.transition = `height ${PANEL_SLIDE_MS}ms ease`;
      body.style.height = `${opening ? body.scrollHeight : 0}px`;
    };
    requestAnimationFrame(start);
    setTimeout(start, 32);
  });
}

function panelSlideSnapshot(group, { selector, scope, key, order = [] }) {
  const previous = panelSlideViews[group];
  panelSlideViews[group] = { scope, key };
  if (!previous || previous.scope !== scope || previous.key === key) return null;
  const panel = document.querySelector(selector);
  if (!panel || !panel.firstChild) return null;
  return {
    selector,
    html: panel.innerHTML,
    height: Math.round(panel.getBoundingClientRect().height),
    forward: panelSlideOrderIndex(order, key) > panelSlideOrderIndex(order, previous.key),
  };
}

// Chave fora da ordem conhecida (ex.: pagina de detalhe) conta como "mais para
// dentro": entrar desliza para frente e voltar desliza para tras.
function panelSlideOrderIndex(order, key) {
  const index = order.indexOf(key);
  return index >= 0 ? index : order.length;
}

function playPanelSlide(snapshot) {
  const panel = snapshot ? document.querySelector(snapshot.selector) : null;
  if (!panel || !panel.firstChild) return;
  const incoming = document.createElement("div");
  incoming.className = "panel-slide";
  // Move os nos (em vez de copiar o HTML) para nao perder os listeners ja ligados.
  while (panel.firstChild) incoming.appendChild(panel.firstChild);
  const outgoing = document.createElement("div");
  outgoing.className = "panel-slide";
  outgoing.innerHTML = snapshot.html;
  applyPanelSlideLayout(panel, [outgoing, incoming]);
  const track = document.createElement("div");
  track.className = "panel-slide-track";
  track.append(...(snapshot.forward ? [outgoing, incoming] : [incoming, outgoing]));
  panel.classList.add("panel-sliding");
  panel.style.height = `${snapshot.height}px`;
  panel.appendChild(track);
  track.style.transform = snapshot.forward ? "translateX(0)" : "translateX(-50%)";

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    while (incoming.firstChild) panel.appendChild(incoming.firstChild);
    track.remove();
    panel.classList.remove("panel-sliding");
    panel.style.height = "";
  };
  track.addEventListener("transitionend", (animationEvent) => {
    if (animationEvent.target === track && animationEvent.propertyName === "transform") finish();
  });
  setTimeout(finish, PANEL_SLIDE_MS * 3);

  // rAF da o frame certo para o transform inicial "pegar"; o timeout cobre o caso
  // de a aba do navegador estar em segundo plano, onde o rAF nao roda.
  let started = false;
  const start = () => {
    if (started || done) return;
    started = true;
    track.classList.add("animating");
    track.style.transform = snapshot.forward ? "translateX(-50%)" : "translateX(0)";
    // A altura de origem veio do bounding box (com padding), entao a de destino
    // tambem precisa somar o padding do painel para nao saltar no fim.
    panel.style.height = `${incoming.scrollHeight + panelVerticalPadding(panel)}px`;
  };
  requestAnimationFrame(start);
  setTimeout(start, 32);
}

function panelVerticalPadding(panel) {
  const style = typeof getComputedStyle === "function" ? getComputedStyle(panel) : null;
  if (!style || style.boxSizing !== "border-box") return 0;
  return (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
}

// Cada lado do slide precisa se comportar como o painel original, senao o
// conteudo perde o grid/gap enquanto a animacao roda.
function applyPanelSlideLayout(panel, slides) {
  const style = typeof getComputedStyle === "function" ? getComputedStyle(panel) : null;
  const display = style?.display === "grid" || style?.display === "flex" ? style.display : "block";
  const gap = style?.gap && style.gap !== "normal" ? style.gap : "";
  slides.forEach((slide) => {
    slide.style.display = display;
    if (gap) slide.style.gap = gap;
    if (display === "grid") slide.style.alignContent = "start";
  });
}

function tournamentTabNav(event, activeTab) {
  const tabs = [
    ["overview", "Visão Geral", `#/events/${event.id}`],
    ["jogos", "Jogos", `#/events/${event.id}/jogos`],
    ["estatisticas", "Estatísticas", `#/events/${event.id}/estatisticas`],
    ["mapas", "Mapas", `#/events/${event.id}/mapas`],
    ["agentes", "Agentes", `#/events/${event.id}/agentes`],
    ["composicoes", "Composições", `#/events/${event.id}/composicoes`],
  ];
  return `
    <nav class="tournament-page-tabs" aria-label="Abas do campeonato">
      ${tabs.map(([key, label, href]) => `<a class="${activeTab === key ? "active" : ""}" href="${href}" aria-current="${activeTab === key ? "page" : "false"}">${escapeHtml(label)}</a>`).join("")}
    </nav>
  `;
}

function tournamentTabContent(event, matches, standings, activeTab) {
  if (activeTab === "jogos") return tournamentMatchesSection(matches);
  if (activeTab === "estatisticas") return tournamentStatsSection(event, matches, standings);
  if (activeTab === "mapas") return tournamentMapsSection(event, matches);
  if (activeTab === "agentes") return tournamentAgentsSection(event, matches);
  if (activeTab === "composicoes") return tournamentCompositionsSection(event, matches);
  return `
    ${tournamentOverviewSection(event, matches, standings)}
    <div class="tournament-main">
      ${tournamentTeamsSection(event, standings, matches)}
      ${tournamentBracketSection(event, matches)}
      ${tournamentSwissStandingsSection(event)}
      ${tournamentPlacementsSection(event, standings)}
    </div>
  `;
}

function tournamentHero(event, matches, standings) {
  const [colorA, colorB] = eventColorPair(event);
  const banner = assetPath(event.banner || event.bannerPath || "");
  const patches = tournamentPatchLabels(matches);
  return `
    <section class="tournament-hero" style="--event-a:${escapeHtml(colorA)}; --event-b:${escapeHtml(colorB)}${banner ? `; --event-banner:url('${escapeHtml(banner)}')` : ""}">
      <div class="tournament-hero-copy">
        <span class="tournament-status-flag ${eventStatusClass(event.status)}">${escapeHtml(event.status || "Campeonato")}</span>
        <div class="tournament-title-row">
          ${eventLogo(event, "hero")}
          <div>
            <h1>${escapeHtml(event.name)}</h1>
            <div class="tournament-hero-meta">
              <span>${escapeHtml(eventTimeRange(event))}</span>
              ${patches.length ? `<span>Patch${patches.length > 1 ? "es" : ""} ${escapeHtml(patches.join(" / "))}</span>` : ""}
            </div>
          </div>
        </div>
      </div>
      <div class="tournament-organizer-card">
        <span class="tournament-card-kicker">Organização</span>
        <div class="tournament-organizer-main">
          ${organizerLogo(event, "large")}
          <strong>${escapeHtml(event.organizer || event.source || SITE_NAME)}</strong>
        </div>
        <small>${escapeHtml([event.type, event.tier ? `Tier ${event.tier}` : ""].filter(Boolean).join(" - ") || "Evento oficial")}</small>
      </div>
    </section>
    <section class="tournament-facts">
      ${tournamentFact("Datas", eventTimeRange(event))}
      ${tournamentFact("Prize Pool", event.prizePool || "-")}
      ${tournamentFact("Times", event.teamCount || event.teams.length)}
      ${tournamentFact("Tier", event.tier || "A definir")}
      ${tournamentFact("Tipo", event.type || "Evento")}
      ${tournamentFact("Formato", tournamentFormatLabel(event, matches))}
    </section>
  `;
}

function tournamentFact(label, value) {
  return `<span><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value))}</strong></span>`;
}

function tournamentPatchLabels(matches) {
  const versions = new Set();
  for (const series of matches || []) {
    const maps = Array.isArray(series.maps) ? series.maps : [series];
    maps.forEach((match) => {
      const label = patchLabel(match?.gameVersion || "");
      if (label && label !== "-") versions.add(label);
    });
  }
  return [...versions].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

function tournamentOverviewSection(event, matches, standings) {
  const podium = tournamentPodiumRows(event, standings, matches);
  const maps = event.mapPool || event.maps || [];
  const mapRows = tournamentMapPoolRows(maps, matches);
  const seriesCount = event.swiss?.seriesCount || matches.length;
  return `
    <section class="tournament-overview-grid">
      <article class="tournament-overview-card tournament-summary-card overview-card-featured">
        <span class="tournament-card-kicker">Resumo do torneio</span>
        <div class="tournament-mini-stats">
          <span><strong>${escapeHtml(String(event.teamCount || event.teams.length))}</strong><small>Times</small></span>
          <span><strong>${escapeHtml(String(seriesCount))}</strong><small>Séries</small></span>
          <span><strong>${escapeHtml(tournamentDurationLabel(event))}</strong><small>Duração</small></span>
        </div>
        <div class="tournament-podium-grid">
          ${(podium.length ? podium : tournamentPodiumPlaceholderRows()).map((row) => tournamentPodiumCard(event, row)).join("")}
        </div>
      </article>
      <article class="tournament-overview-card tournament-map-pool-card">
        <span class="tournament-card-kicker">Map pool</span>
        <div class="tournament-map-banner-grid">${mapRows.length ? mapRows.map(tournamentMapPoolBanner).join("") : `<small>A definir</small>`}</div>
      </article>
    </section>
  `;
}

function tournamentMapPoolRows(mapNames, matches) {
  return (mapNames || []).map((name) => {
    const map = mapByName(name) || { id: slugify(name), name, icon: "" };
    const playedMaps = (matches || []).flatMap((series) => series.maps || []).filter((match) => normalize(match.mapName || "") === normalize(name) || match.mapId === map.id);
    return {
      ...map,
      poolName: name,
      played: playedMaps.length,
      rounds: playedMaps.reduce((sum, match) => sum + Number(match.rounds || 0), 0),
    };
  });
}

function tournamentPodiumRows(event, standings, matches = []) {
  if (!eventIsDone(event) && !event.placements?.length) return [];
  const bracketPodium = event.placements?.length ? [] : tournamentPodiumRowsFromBracket(event, matches);
  if (bracketPodium.length) return bracketPodium;
  const source = event.placements?.length ? event.placements : standings;
  const rows = [];
  source.forEach((row, index) => {
    const range = row.range || placementLabel(index);
    if (placementIsOngoing(range) && !eventIsDone(event)) return;
    if (!tournamentPlacementIsFeatured(range, index)) return;
    const id = row.id || row.teamId;
    const team = tournamentTeamById(event, id);
    if (team) rows.push({ range, team });
  });
  return rows;
}

function tournamentPodiumRowsFromBracket(event, matches) {
  const bracket = tournamentBracketDefinition(event, matches);
  const regions = bracket?.regions || [];
  if (regions.length !== 1) return [];
  const columns = regions[0].columns || [];
  const finalMatch = columns.at(-1)?.matches?.at(-1);
  if (!finalMatch?.a || !finalMatch?.b) return [];

  const winnerId = finalMatch.winner || (Number(finalMatch.scoreA) > Number(finalMatch.scoreB) ? finalMatch.a : finalMatch.b);
  const runnerUpId = finalMatch.a === winnerId ? finalMatch.b : finalMatch.a;
  const rows = [
    { range: "1", team: tournamentTeamById(event, winnerId) },
    { range: "2", team: tournamentTeamById(event, runnerUpId) },
  ].filter((row) => row.team);

  const semifinalLosers = (columns.at(-2)?.matches || [])
    .map((match) => {
      const matchWinner = match.winner || (Number(match.scoreA) > Number(match.scoreB) ? match.a : match.b);
      return match.a === matchWinner ? match.b : match.a;
    })
    .filter(Boolean)
    .filter((teamId, index, list) => list.indexOf(teamId) === index && teamId !== winnerId && teamId !== runnerUpId)
    .map((teamId) => tournamentTeamById(event, teamId))
    .filter(Boolean);

  if (semifinalLosers.length >= 2) rows.push(...semifinalLosers.slice(0, 2).map((team) => ({ range: "3-4", team })));
  else if (semifinalLosers.length === 1) rows.push({ range: "3", team: semifinalLosers[0] });

  return rows;
}

// Sem resultado ainda o podio aparece com as vagas em aberto, nao com um aviso.
function tournamentPodiumPlaceholderRows() {
  return ["1", "2", "3"].map((range) => ({ range, team: null }));
}

function tournamentPodiumCard(event, row) {
  const label = tournamentPodiumLabel(row.range);
  const team = row.team;
  return `
    <span class="tournament-podium-card podium-${escapeHtml(slugify(label))}${team ? "" : " podium-pending"}">
      <b>${escapeHtml(label)}</b>
      ${team ? teamLogo(team.id, "tiny") : `<span class="team-logo clean-logo tiny logo-empty"></span>`}
      <strong>${escapeHtml(team ? team.name : "TBD")}</strong>
    </span>
  `;
}

function tournamentPodiumLabel(range) {
  const value = String(range || "").trim();
  const normalizedValue = normalize(value);
  const compactValue = normalizeNameKey(value);
  if (normalizedValue === "1st") return "1\u00ba lugar";
  if (normalizedValue === "2nd") return "2\u00ba lugar";
  if (normalizedValue === "3rd") return "3\u00ba lugar";
  if (compactValue.startsWith("34")) return "3\u00ba/4\u00ba lugar";
  if (value === "1") return "1º lugar";
  if (value === "2") return "2º lugar";
  if (value === "3") return "3º lugar";
  if (value === "3-4" || value === "3/4") return "3º/4º lugar";
  return value;
}

function tournamentMapPoolBanner(map) {
  const art = mapArtAttrs(map);
  return `
    <a class="tournament-map-banner ${art ? "has-image" : ""}" href="#/maps/${escapeHtml(map.id)}">
      ${art ? `<img src="${escapeHtml(art.src)}" data-fallback="${escapeHtml(art.fallback)}" alt="${escapeHtml(map.name)}" loading="lazy" onerror="mapArtError(this)" />` : ""}
      <span><strong>${escapeHtml(map.name || map.poolName)}</strong><small>${escapeHtml(`${map.played} jogos - ${map.rounds} rounds`)}</small></span>
    </a>
  `;
}

function tournamentDurationLabel(event) {
  if (!event.start || !event.end) return "A definir";
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.ceil((Number(event.end) - Number(event.start)) / dayMs));
  return `${days} dia${days > 1 ? "s" : ""}`;
}

function tournamentTeamById(event, teamId) {
  const team = teamById(teamId);
  const overrideName = event.teamNames?.[teamId];
  if (team) return overrideName ? { ...team, name: overrideName } : team;
  if (!teamId) return null;
  return {
    id: teamId,
    name: overrideName || displayTeamName(teamId),
    tag: teamTag(teamId),
    sourceTag: teamTag(teamId),
    colors: teamColors(teamId),
    matches: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    ranking: { provisional: true },
    missing: true,
  };
}

function tournamentNav(event) {
  return `
    <nav class="tournament-tabs" aria-label="Secoes do campeonato">
      <span class="active">Overview</span>
      <a href="#/matches">Matches</a>
      <a href="#/matches">Results</a>
      <a href="#/stats">Stats</a>
      <a href="#/events/${event.id}">Teams</a>
    </nav>
  `;
}

function tournamentGroupedEvents(event, matches) {
  const stages = tournamentStageRows(event, matches);
  return `
    <section class="tournament-section">
      <div class="tournament-section-head">
        <h2>Grouped events</h2>
        <span>${stages.length} etapas</span>
      </div>
      <div class="tournament-stage-track">
        ${stages.map((stage) => tournamentStageCard(event, stage)).join("")}
      </div>
    </section>
  `;
}

function tournamentStageRows(event, matches) {
  if (Array.isArray(event.stages) && event.stages.length) return event.stages;
  const sorted = matches.slice().sort((a, b) => (a.startedAt || a.sortAt || 0) - (b.startedAt || b.sortAt || 0));
  if (sorted.length < 8) {
    return [{ name: "Evento principal", start: event.start, end: event.end, matches: sorted.length }];
  }
  const middle = Math.ceil(sorted.length / 2);
  const first = sorted.slice(0, middle);
  const second = sorted.slice(middle);
  return [
    { name: "Fase inicial", start: first[0]?.startedAt, end: first[first.length - 1]?.startedAt, matches: first.length },
    { name: "Fase final", start: second[0]?.startedAt, end: second[second.length - 1]?.startedAt, matches: second.length },
  ];
}

function tournamentStageCard(event, stage) {
  const current = !eventIsDone(event) && periodEndIsCurrent(stage.end || event.end);
  const range = stage.start || stage.end ? formatDateRange(stage.start, stage.end, { current, autoCurrent: current }) : eventTimeRange(event);
  return `
    <article class="tournament-stage-card">
      ${eventLogo(event)}
      <span>
        <strong>${escapeHtml(stage.name || "Etapa")}</strong>
        <small>${escapeHtml(range)}</small>
      </span>
      <em>${escapeHtml(String(stage.matches || 0))} partidas</em>
    </article>
  `;
}

function tournamentBracketSection(event, matches) {
  if (event.swiss?.rounds?.length) return tournamentSwissBracketSection(event, matches);
  const bracket = tournamentBracketDefinition(event, matches);
  if (bracket?.regions?.length) return tournamentCuratedBracketSection({ ...event, bracket });
  return `
    <section class="tournament-section">
      <div class="tournament-section-head">
        <h2>Brackets</h2>
        <span>Bracket oficial</span>
      </div>
      <div class="empty-state">Bracket aguardando partidas registradas.</div>
    </section>
  `;
}

function tournamentSwissBracketSection(event, matches) {
  const rounds = event.swiss?.rounds || [];
  const activeIndex = Math.max(0, rounds.findIndex((round) => {
    const status = normalize(round.status || "");
    return status.includes("agendada") || status.includes("andamento");
  }));
  const roundTabs = tournamentSwissRoundTabs(event, rounds, activeIndex);
  return `
    <section class="tournament-section tournament-swiss-section">
      <div class="tournament-section-head">
        <h2>Brackets</h2>
        <span>${escapeHtml(event.bracket?.title || event.format?.summary || "Sistema suico")}</span>
      </div>
      <div class="tournament-swiss-bracket" style="--swiss-rounds:${rounds.length}">
        ${rounds
          .map(
            (round, index) => `
              <input type="radio" name="swiss-round-${escapeHtml(event.id)}" id="swiss-round-${escapeHtml(event.id)}-${index}" ${index === activeIndex ? "checked" : ""} />
            `,
          )
          .join("")}
        <input class="swiss-view-mode-input swiss-view-mode-map" type="radio" name="swiss-view-${escapeHtml(event.id)}" id="swiss-view-${escapeHtml(event.id)}-map" checked />
        <input class="swiss-view-mode-input swiss-view-mode-list" type="radio" name="swiss-view-${escapeHtml(event.id)}" id="swiss-view-${escapeHtml(event.id)}-list" />
        <div class="swiss-view-toggle" aria-label="Modo de exibicao da bracket">
          <label class="swiss-view-option map" for="swiss-view-${escapeHtml(event.id)}-map">Mapa</label>
          <label class="swiss-view-option list" for="swiss-view-${escapeHtml(event.id)}-list">Lista</label>
        </div>
        <div class="swiss-view swiss-flow-view">
          ${tournamentSwissOverviewBoard(event)}
        </div>
        <div class="swiss-view swiss-list-view">
          ${roundTabs}
          <div class="swiss-round-panels">
            ${rounds.map((round, roundIndex) => tournamentSwissRoundPanel(event, round, roundIndex, matches, activeIndex)).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function tournamentSwissRoundTabs(event, rounds, activeIndex = 0) {
  return `
    <div class="swiss-round-tabs">
      ${rounds.map((round, index) => `<label class="${index === activeIndex ? "is-active" : ""}" for="swiss-round-${escapeHtml(event.id)}-${index}"><strong>${escapeHtml(round.title || `Rodada ${index + 1}`)}</strong><small>${escapeHtml(round.status || "")}</small></label>`).join("")}
    </div>
  `;
}

function tournamentSwissRoundPanel(event, round, roundIndex, matches, activeIndex = 0) {
  const matchesCount = round.matches?.length || 0;
  const groups = tournamentSwissRoundGroups(event, roundIndex);
  return `
    <section class="swiss-round-panel ${roundIndex === activeIndex ? "is-active" : ""}" style="--round-index:${roundIndex}">
      <header class="swiss-round-header">
        <span><strong>${escapeHtml(round.title || `Rodada ${roundIndex + 1}`)}</strong><small>${escapeHtml([round.bestOf, round.status].filter(Boolean).join(" - "))}</small></span>
        <em>${matchesCount} partidas</em>
      </header>
      <div class="swiss-score-groups">
        ${groups.map((group) => tournamentSwissScoreGroup(event, round, roundIndex, group)).join("")}
      </div>
    </section>
  `;
}

function tournamentSwissOverviewBoard(event) {
  const rounds = event.swiss?.rounds || [];
  if (!rounds.length) return "";
  return `
    <div class="swiss-flow-shell">
      <div class="swiss-flow-toolbar" aria-label="Navegacao do mapa suico">
        <button type="button" class="swiss-flow-nav prev" data-swiss-flow-nav="-1" aria-label="Rodada anterior">&lt;</button>
        <button type="button" class="swiss-flow-nav next" data-swiss-flow-nav="1" aria-label="Proxima rodada">&gt;</button>
      </div>
      <div class="swiss-flow-board" data-swiss-flow aria-label="Mapa do sistema suico">
        <div class="swiss-flow-track" style="--swiss-round-count:${rounds.length}">
          ${rounds.map((round, roundIndex) => tournamentSwissFlowRound(event, round, roundIndex)).join("")}
        </div>
        <button type="button" class="swiss-flow-nav swiss-flow-edge-nav prev" data-swiss-flow-nav="-1" aria-label="Mover mapa para a esquerda">&lt;</button>
        <button type="button" class="swiss-flow-nav swiss-flow-edge-nav next" data-swiss-flow-nav="1" aria-label="Mover mapa para a direita">&gt;</button>
      </div>
    </div>
  `;
}

function tournamentSwissFlowRound(event, round, roundIndex) {
  const groups = tournamentSwissRoundGroups(event, roundIndex);
  const statusClass = normalize(round.status || "").includes("agendada") ? "scheduled" : "played";
  return `
    <section class="swiss-flow-round ${statusClass}" data-swiss-flow-round="${roundIndex}">
      <header class="swiss-flow-round-head">
        <span>
          <strong>${escapeHtml(round.title || `Rodada ${roundIndex + 1}`)}</strong>
          <small>${escapeHtml(round.status || "")}</small>
        </span>
        <em>${escapeHtml(String(round.matches?.length || 0))}</em>
      </header>
      <div class="swiss-flow-groups">
        ${groups.map((group) => tournamentSwissFlowGroup(event, round, roundIndex, group)).join("")}
      </div>
    </section>
  `;
}

function tournamentSwissFlowGroup(event, round, roundIndex, group) {
  const tone = tournamentSwissFlowScoreTone(group.label);
  return `
    <section class="swiss-flow-group tone-${escapeHtml(tone)}">
      <header class="swiss-flow-group-head">
        <strong>${escapeHtml(group.label)}</strong>
        <small>${escapeHtml(String(group.matches.length))}</small>
      </header>
      <div class="swiss-flow-matches">
        ${group.matches.map(({ match, matchIndex }) => tournamentSwissFlowMatch(event, match, round, roundIndex, matchIndex)).join("")}
      </div>
    </section>
  `;
}

function tournamentSwissFlowMatch(event, match, round, roundIndex, matchIndex) {
  const key = tournamentSwissMatchKey(roundIndex, matchIndex, match.code);
  const hasResult = tournamentBracketMatchHasResult(match);
  const winner = hasResult ? match.winner || (Number(match.scoreA) > Number(match.scoreB) ? match.a : match.b) : "";
  const scoreLabel = hasResult ? `${match.scoreA}:${match.scoreB}` : "VS";
  return `
    <button type="button" class="swiss-flow-match ${hasResult ? "played" : "pending"}" data-tournament-match="${escapeHtml(key)}">
      ${tournamentSwissFlowTeam(event, match.a, match.aLabel, winner === match.a)}
      <span class="swiss-flow-score">${escapeHtml(scoreLabel)}</span>
      ${tournamentSwissFlowTeam(event, match.b, match.bLabel, winner === match.b)}
      <small>${escapeHtml(match.code || round.bestOf || "Partida")}</small>
    </button>
  `;
}

function tournamentSwissFlowTeam(event, teamId, label, won) {
  const team = teamId ? tournamentTeamById(event, teamId) : null;
  const name = label || team?.name || "Sem adversario";
  const shortName = label || team?.sourceTag || team?.shortTag || team?.tag || team?.name || "BYE";
  return `
    <span class="swiss-flow-team ${won ? "winner" : ""} ${teamId ? "" : "bye"}" title="${escapeHtml(name)}">
      ${teamId ? teamLogo(teamId, "flow-logo") : `<span class="team-logo clean-logo flow-logo logo-empty"></span>`}
      <strong>${escapeHtml(shortName)}</strong>
    </span>
  `;
}

function tournamentSwissFlowScoreTone(label) {
  const records = tournamentSwissRecordsFromLabel(label);
  if (!records.length) return "neutral";
  const bestWins = Math.max(...records.map((record) => record.wins));
  const worstLosses = Math.max(...records.map((record) => record.losses));
  if (worstLosses >= 3) return "eliminated";
  if (bestWins >= 3 && worstLosses <= 1) return "advanced";
  if (worstLosses >= 2) return "danger";
  if (bestWins >= 2 && worstLosses === 0) return "strong";
  if (bestWins > worstLosses) return "positive";
  if (worstLosses > bestWins) return "warning";
  return "neutral";
}

function tournamentSwissRecordsFromLabel(label) {
  return [...String(label || "").matchAll(/(\d+)-(\d+)/g)].map((match) => ({
    wins: Number(match[1] || 0),
    losses: Number(match[2] || 0),
  }));
}

function tournamentSwissScoreGroup(event, round, roundIndex, group) {
  return `
    <section class="swiss-score-group">
      <header class="swiss-score-group-head">
        <strong>${escapeHtml(group.label)}</strong>
        <small>${escapeHtml(`${group.matches.length} ${group.matches.length === 1 ? "partida" : "partidas"}`)}</small>
      </header>
      <div class="swiss-match-grid">
        ${group.matches.map(({ match, matchIndex }) => tournamentSwissMatchCard(event, match, round, roundIndex, matchIndex)).join("")}
      </div>
    </section>
  `;
}

function tournamentSwissRoundGroups(event, roundIndex) {
  const round = event.swiss?.rounds?.[roundIndex] || {};
  const records = tournamentSwissRecordsBeforeRound(event, roundIndex);
  const grouped = new Map();
  (round.matches || []).forEach((match, matchIndex) => {
    const label = tournamentSwissMatchScoreLabel(match, records);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push({ match, matchIndex });
  });
  return [...grouped.entries()]
    .map(([label, matches]) => ({ label, matches }))
    .sort((a, b) => tournamentSwissScoreSortValue(b.label) - tournamentSwissScoreSortValue(a.label) || a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
}

function tournamentSwissRecordsBeforeRound(event, roundIndex) {
  const records = new Map((event.teams || []).map((teamId) => [teamId, { wins: 0, losses: 0 }]));
  for (const round of (event.swiss?.rounds || []).slice(0, roundIndex)) {
    for (const match of round.matches || []) {
      tournamentSwissApplyMatchRecord(records, match);
    }
  }
  return records;
}

function tournamentSwissApplyMatchRecord(records, match) {
  if (!tournamentBracketMatchHasResult(match)) return;
  const winnerId = match.winner || (Number(match.scoreA) > Number(match.scoreB) ? match.a : match.b);
  const loserId = match.a === winnerId ? match.b : match.a;
  if (winnerId) tournamentSwissRecordForTeam(records, winnerId).wins += 1;
  if (loserId) tournamentSwissRecordForTeam(records, loserId).losses += 1;
}

function tournamentSwissRecordForTeam(records, teamId) {
  if (!records.has(teamId)) records.set(teamId, { wins: 0, losses: 0 });
  return records.get(teamId);
}

function tournamentSwissMatchScoreLabel(match, records) {
  const aRecord = tournamentSwissRecordForTeam(records, match.a);
  if (!match.b) return tournamentSwissRecordLabel(aRecord);
  const bRecord = tournamentSwissRecordForTeam(records, match.b);
  const aLabel = tournamentSwissRecordLabel(aRecord);
  const bLabel = tournamentSwissRecordLabel(bRecord);
  return aLabel === bLabel ? aLabel : `${aLabel} / ${bLabel}`;
}

function tournamentSwissRecordLabel(record) {
  return `${record.wins || 0}-${record.losses || 0}`;
}

function tournamentSwissScoreSortValue(label) {
  const match = String(label || "").match(/(?<wins>\d+)-(?<losses>\d+)/);
  if (!match?.groups) return -999;
  return Number(match.groups.wins) * 100 - Number(match.groups.losses);
}

function tournamentSwissMatchCard(event, match, round, roundIndex, matchIndex) {
  const key = tournamentSwissMatchKey(roundIndex, matchIndex, match.code);
  const status = tournamentBracketMatchStatusLabel(match, round);
  const hasResult = tournamentBracketMatchHasResult(match);
  const winner = hasResult ? match.winner || (Number(match.scoreA) > Number(match.scoreB) ? match.a : match.b) : "";
  return `
    <button type="button" class="swiss-match-card ${hasResult ? "played" : "pending"}" data-tournament-match="${escapeHtml(key)}">
      <span class="tournament-bracket-meta"><span>${escapeHtml(status)}</span><b>${escapeHtml(match.code || "Partida")}</b>${round.bestOf ? `<em>${escapeHtml(round.bestOf)}</em>` : ""}</span>
      ${tournamentCuratedBracketTeam(event, match.a, match.aLabel, match.scoreA, winner === match.a)}
      ${tournamentCuratedBracketTeam(event, match.b, match.bLabel, match.scoreB, winner === match.b)}
    </button>
  `;
}

function tournamentSwissMatchKey(roundIndex, matchIndex, code) {
  return `swiss-${roundIndex}-${matchIndex}-${slugify(code || "partida")}`;
}

function tournamentSwissStandingsSection(event) {
  const groups = (event.swiss?.groups || []).filter((group) => group?.standings?.length);
  if (!groups.length && !event.swiss?.standings?.length) return "";
  return `
    <section class="tournament-section tournament-swiss-table-section">
      <div class="tournament-section-head">
        <h2>Tabela</h2>
        <span>${escapeHtml(event.swiss.standingsLabel || "Classificacao atual")}</span>
      </div>
      ${groups.length ? tournamentSwissGroupTables(event, groups) : tournamentSwissGeneralTables(event)}
    </section>
  `;
}

function tournamentSwissGroupTables(event, groups) {
  return `
    <div class="tournament-swiss-table-wrap swiss-group-tables">
      ${groups.map((group) => tournamentSwissTable(event, tournamentSwissStandingRows(event, group.standings), group.title || "Grupo", { compact: true })).join("")}
    </div>
  `;
}

function tournamentSwissGeneralTables(event) {
  const stateRows = tournamentSwissStandingRows(event, [
    ...(event.swiss.standings || []).map((row) => ({ ...row, status: row.status || "Em disputa" })),
    ...(event.swiss.eliminated || []).map((row) => ({ ...row, status: row.status || "Eliminado" })),
  ]);
  const activeRows = stateRows.filter((row) => !normalize(row.status).includes("eliminado"));
  const eliminatedRows = stateRows.filter((row) => normalize(row.status).includes("eliminado"));
  const generalTables = `
    ${tournamentSwissTable(event, activeRows, "Classificacao atual")}
    ${eliminatedRows.length ? tournamentSwissTable(event, eliminatedRows, "Eliminados") : ""}
  `;
  if (!event.swiss.stateTables) {
    return `<div class="tournament-swiss-table-wrap">${generalTables}</div>`;
  }
  return `
    <div class="tournament-swiss-table-wrap">
      <input class="swiss-table-view-mode-input swiss-table-view-mode-general" type="radio" name="swiss-table-view-${escapeHtml(event.id)}" id="swiss-table-view-${escapeHtml(event.id)}-general" checked />
      <input class="swiss-table-view-mode-input swiss-table-view-mode-states" type="radio" name="swiss-table-view-${escapeHtml(event.id)}" id="swiss-table-view-${escapeHtml(event.id)}-states" />
      <div class="swiss-table-view-toggle" aria-label="Modo de exibicao da tabela">
        <label class="swiss-table-view-option general" for="swiss-table-view-${escapeHtml(event.id)}-general">Geral</label>
        <label class="swiss-table-view-option states" for="swiss-table-view-${escapeHtml(event.id)}-states">Estados</label>
      </div>
      <div class="swiss-table-view swiss-table-view-general-panel">
        ${generalTables}
      </div>
      <div class="swiss-table-view swiss-table-view-states-panel">
        ${tournamentSwissStateTables(event, stateRows)}
      </div>
    </div>
  `;
}

function tournamentSwissStandingRows(event, rows) {
  return (rows || []).map((row, index) => ({
    ...row,
    rank: row.rank || row.range || index + 1,
    status: row.status || "Em disputa",
    team: tournamentTeamById(event, row.id || row.teamId),
  }));
}

function tournamentSwissTable(event, rows, title, options = {}) {
  if (!rows.length) return "";
  return `
    <div class="swiss-standings-block">
      <h3>${escapeHtml(title)}</h3>
      ${tournamentSwissTableMarkup(rows, options)}
    </div>
  `;
}

function tournamentSwissTableMarkup(rows, options = {}) {
  const compact = Boolean(options.compact);
  return `
    <div class="tournament-stats-table-wrap">
      <table class="tournament-swiss-table ${compact ? "compact-state-table" : ""}">
        <thead>
          <tr><th>#</th><th>Equipe</th><th>Estado</th><th class="numeric">V</th><th class="numeric">D</th>${compact ? "" : "<th>Status</th>"}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => (compact ? tournamentSwissStateStandingRow(row) : tournamentSwissStandingRow(row))).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function tournamentSwissStateTables(event, rows) {
  const groups = tournamentSwissStateGroups(rows);
  if (!groups.length) return `<div class="empty-state">Nenhum time encontrado para agrupar por estado.</div>`;
  return `
    <div class="swiss-state-standing-groups">
      ${groups.map((group) => tournamentSwissStateStandingGroup(group)).join("")}
    </div>
  `;
}

function tournamentSwissStateGroups(rows) {
  const grouped = new Map();
  for (const row of rows || []) {
    const state = tournamentSwissStateInfo(row.team);
    const key = `${state.label}|${state.code}|${state.flagSrc}`;
    if (!grouped.has(key)) grouped.set(key, { state, rows: [] });
    grouped.get(key).rows.push(row);
  }
  return [...grouped.values()].sort((a, b) => a.state.label.localeCompare(b.state.label, "pt-BR", { sensitivity: "base" }));
}

function tournamentSwissStateStandingGroup(group) {
  return `
    <div class="swiss-state-standings-block">
      <header class="swiss-state-standings-head">
        ${tournamentSwissStateFlag(group.state)}
        <span><strong>${escapeHtml(group.state.label)}</strong><small>${escapeHtml(`${group.rows.length} ${group.rows.length === 1 ? "equipe" : "equipes"}`)}</small></span>
      </header>
      ${tournamentSwissTableMarkup(group.rows, { compact: true })}
    </div>
  `;
}

function tournamentSwissStateInfo(team) {
  const profile = team?.profile || {};
  const code = profile.state || team?.state || "";
  const label = profile.stateName || team?.stateName || code || "Estado nao informado";
  const flagSrc = profile.flag || team?.flag || team?.stateFlag || "";
  return { code, label, flagSrc };
}

function tournamentSwissStateFlag(state) {
  const fallback = escapeHtml(state.code || "UF");
  return state.flagSrc
    ? `<img class="state-flag" src="${escapeHtml(assetPath(state.flagSrc))}" alt="Bandeira ${escapeHtml(state.label)}" loading="lazy" onerror="this.replaceWith(this.nextElementSibling)" /><span class="state-flag placeholder">${fallback}</span>`
    : `<span class="state-flag placeholder">${fallback}</span>`;
}

function tournamentSwissStateCell(team) {
  if (!team) return `<span class="swiss-state-cell empty">-</span>`;
  const profile = team.profile || {};
  const stateCode = profile.state || team.state || "";
  const stateLabel = profile.stateName || team.stateName || stateCode || "Estado não informado";
  const flagSrc = profile.flag || team.flag || team.stateFlag || "";
  const fallback = escapeHtml(stateCode || "UF");
  const flag = flagSrc
    ? `<img class="state-flag" src="${escapeHtml(assetPath(flagSrc))}" alt="Bandeira ${escapeHtml(stateLabel)}" loading="lazy" onerror="this.replaceWith(this.nextElementSibling)" /><span class="state-flag placeholder">${fallback}</span>`
    : `<span class="state-flag placeholder">${fallback}</span>`;
  return `<span class="swiss-state-cell">${flag}<span>${escapeHtml(stateLabel)}</span></span>`;
}

function tournamentSwissStandingRow(row) {
  return `
    <tr>
      <td class="numeric">${escapeHtml(String(row.rank))}</td>
      <td>${row.team ? `${teamLogo(row.team.id, "tiny")} <strong>${escapeHtml(row.team.name)}</strong>` : escapeHtml(row.id || "-")}</td>
      <td>${tournamentSwissStateCell(row.team)}</td>
      <td class="numeric">${escapeHtml(String(row.wins ?? 0))}</td>
      <td class="numeric">${escapeHtml(String(row.losses ?? 0))}</td>
      <td><span class="swiss-status ${normalize(row.status).includes("eliminado") ? "out" : "live"}">${escapeHtml(row.status)}</span></td>
    </tr>
  `;
}

function tournamentSwissStateStandingRow(row) {
  const isEliminated = normalize(row.status).includes("eliminado");
  return `
    <tr class="${isEliminated ? "eliminated" : ""}">
      <td class="numeric">${escapeHtml(String(row.rank))}</td>
      <td>${row.team ? `${teamLogo(row.team.id, "tiny")} <strong>${escapeHtml(row.team.name)}</strong>` : escapeHtml(row.id || "-")}</td>
      <td>${tournamentSwissStateCell(row.team)}</td>
      <td class="numeric">${escapeHtml(String(row.wins ?? 0))}</td>
      <td class="numeric">${escapeHtml(String(row.losses ?? 0))}</td>
    </tr>
  `;
}

function tournamentBracketDefinition(event, matches) {
  if (event.bracket?.regions?.length) return event.bracket;
  return tournamentEstimatedBracket(matches);
}

function tournamentEstimatedBracket(matches) {
  const columns = tournamentBracketColumns(matches);
  if (!columns.length) return null;
  return {
    title: "Bracket oficial",
    regions: [
      {
        name: "Chave principal",
        className: "upper-bracket single-elimination",
        columns: columns.map((column) => ({
          title: column.title,
          matches: column.matches.map(tournamentSeriesBracketMatch),
        })),
      },
    ],
  };
}

function tournamentSeriesBracketMatch(series) {
  const score = matchListScore(series);
  return {
    code: `Partida ${series.seriesCode || series.code || "-"}`,
    bestOf: series.label || seriesFormatLabel(series.maps || []),
    a: series.teamA.id,
    scoreA: score.a,
    b: series.teamB.id,
    scoreB: score.b,
    winner: series.winnerId,
  };
}

function tournamentCuratedBracketSection(event) {
  const regions = tournamentBracketDisplayRegions(event.bracket.regions);
  const groupRegions = regions.filter((region) => String(region.className || "").includes("group-stage"));
  const layoutClass =
    regions.length > 0 && groupRegions.length === regions.length
      ? "groups-layout"
      : groupRegions.length
        ? "has-groups"
        : regions.length === 1
          ? "single-region"
          : "";
  return `
    <section class="tournament-section">
      <div class="tournament-section-head">
        <h2>Brackets</h2>
        <span>${escapeHtml(event.bracket.title || "Bracket oficial")}</span>
      </div>
      <div class="tournament-curated-bracket ${layoutClass}">
        ${regions.map((region) => tournamentCuratedBracketRegion(event, region)).join("")}
      </div>
    </section>
  `;
}

function tournamentBracketDisplayRegions(regions = []) {
  const priority = { "upper-bracket": 1, "lower-bracket": 2, "grand-final": 3 };
  return regions.slice().sort((a, b) => {
    const priorityA = priority[tournamentBracketRegionKind(a)] || 10;
    const priorityB = priority[tournamentBracketRegionKind(b)] || 10;
    return priorityA - priorityB;
  });
}

function tournamentBracketRegionKind(region = {}) {
  const descriptor = normalize(`${region.className || ""} ${region.name || ""}`);
  if (descriptor.includes("upper bracket") || descriptor.includes("chave superior")) return "upper-bracket";
  if (descriptor.includes("lower bracket") || descriptor.includes("chave inferior")) return "lower-bracket";
  if (descriptor.includes("grand final") || descriptor.includes("grande final")) return "grand-final";
  return "";
}

function tournamentPlacementBracketRegionKind(row = {}) {
  const explicit = normalize(row.bracket || "");
  const description = normalize([row.note, row.reason].filter(Boolean).join(" "));
  const upper = [explicit, description].some((value) =>
    ["upper", "upper bracket", "superior", "chave superior"].includes(value)
      || value.includes("upper bracket")
      || value.includes("chave superior"));
  const lower = [explicit, description].some((value) =>
    ["lower", "lower bracket", "inferior", "chave inferior"].includes(value)
      || value.includes("lower bracket")
      || value.includes("chave inferior"));
  if (upper === lower) return "";
  return upper ? "upper-bracket" : "lower-bracket";
}

function tournamentClassifiedPlacementCards(event = {}, region = {}) {
  const regionKind = tournamentBracketRegionKind(region);
  if (!regionKind || regionKind === "grand-final") return [];

  const seen = new Set();
  const cards = (event.placements || []).flatMap((row) => {
    const placement = normalize(row.range || placementRawValue(row));
    const id = row.id || row.teamId;
    if (!placement.startsWith("classificad") || !id || tournamentPlacementBracketRegionKind(row) !== regionKind || seen.has(id)) return [];
    seen.add(id);
    return [{ id }];
  });

  const lastMatches = [...(region.columns || [])].reverse().find((column) => column.matches?.length)?.matches || [];
  const winnerOrder = new Map(lastMatches.map((match, index) => [match.winner, index]));
  return cards.sort((a, b) => (winnerOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (winnerOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

function tournamentCuratedBracketColumns(event = {}, region = {}) {
  const columns = [...(region.columns || [])];
  if (region.terminalColumn === false) return columns;
  // Configuracao explicita fica reservada para formatos excepcionais;
  // classificatorias comuns derivam os cards das colocacoes oficiais.
  const explicitCards = region.terminalColumn?.cards || [];
  const terminalCards = explicitCards.length ? explicitCards : tournamentClassifiedPlacementCards(event, region);
  if (terminalCards.length) {
    columns.push({ title: "Classificados", ...(region.terminalColumn || {}), terminalCards });
  }
  return columns;
}

function tournamentCuratedBracketColumnEntries(column = {}) {
  return column.terminalCards || column.matches || [];
}

function tournamentCuratedBracketRegion(event, region) {
  const columns = tournamentCuratedBracketColumns(event, region);
  const maxMatches = Math.max(...columns.map((column) => tournamentCuratedBracketColumnEntries(column).length), 1);
  const totalRows = maxMatches * 2;
  return `
    <section class="tournament-bracket-region ${escapeHtml(region.className || "")}">
      <h3>${escapeHtml(region.name || "Chave")}</h3>
      <div class="tournament-bracket curated" style="--max-matches:${maxMatches}; --bracket-rows:${totalRows}; --bracket-columns:${Math.max(columns.length, 1)}">
        ${columns.map((column, columnIndex) => tournamentCuratedBracketColumn(event, column, columns, columnIndex, maxMatches)).join("")}
      </div>
    </section>
  `;
}

function tournamentCuratedBracketColumn(event, column, columns, columnIndex, maxMatches) {
  const entries = tournamentCuratedBracketColumnEntries(column);
  const currentMatches = Math.max(entries.length, 1);
  const nextMatches = tournamentCuratedBracketColumnEntries(columns[columnIndex + 1]).length;
  const connectorMode = tournamentBracketConnectorMode(currentMatches, nextMatches);
  const renderEntry = column.terminalCards ? tournamentCuratedBracketQualifiedCard : tournamentCuratedBracketMatch;
  return `
    <div class="tournament-bracket-col" style="--column-matches:${currentMatches}">
      <h3>${escapeHtml(column.title)}</h3>
      <div class="tournament-bracket-stack">
        ${entries.map((entry, matchIndex) => renderEntry(event, entry, { columnIndex, matchIndex, connectorMode, maxMatches, columnMatches: currentMatches })).join("")}
      </div>
    </div>
  `;
}

function tournamentCuratedBracketQualifiedCard(event, card, context = {}) {
  const team = tournamentTeamById(event, card.id);
  const name = card.label || team?.name || card.id || "Equipe";
  const rowStart = tournamentBracketRowStart(card.slot ?? context.matchIndex, context.maxMatches || 1, card.slot == null ? context.columnMatches || 1 : context.maxMatches || 1);
  return `
    <article class="tournament-bracket-match curated-match qualified-card terminal" aria-label="${escapeHtml(`Classificado: ${name}`)}" style="--match-row:${rowStart}">
      <span class="tournament-bracket-meta"><span>Classificado</span></span>
      <span class="tournament-bracket-team winner tournament-bracket-qualified-team">
        ${card.id ? teamLogo(card.id, "tiny") : `<span class="team-logo clean-logo tiny logo-empty"></span>`}
        <strong>${escapeHtml(name)}</strong>
      </span>
    </article>
  `;
}

function tournamentCuratedBracketMatch(event, match, context = {}) {
  const hasResult = tournamentBracketMatchHasResult(match);
  const winner = hasResult
    ? match.winner || (Number(match.scoreA) === Number(match.scoreB) ? "" : Number(match.scoreA) > Number(match.scoreB) ? match.a : match.b)
    : "";
  const key = tournamentBracketMatchKey(context.columnIndex, context.matchIndex, match.code);
  const connectorMode = context.connectorMode || "terminal";
  const branch = connectorMode === "merge" ? (context.matchIndex % 2 === 0 ? "top" : "bottom") : "straight";
  const rowStart = tournamentBracketRowStart(match.slot ?? context.matchIndex, context.maxMatches || 1, match.slot == null ? context.columnMatches || 1 : context.maxMatches || 1);
  const connectorSpanRows = tournamentBracketConnectorSpanRows(context.maxMatches || 1, context.columnMatches || 1, connectorMode);
  const classes = ["tournament-bracket-match", "curated-match", `connector-${connectorMode}`, connectorMode === "terminal" ? "terminal" : "", `branch-${branch}`].filter(Boolean).join(" ");
  return `
    <button type="button" class="${escapeHtml(classes)}" data-tournament-match="${escapeHtml(key)}" style="--match-row:${rowStart}; --connector-span-rows:${connectorSpanRows}">
      <span class="tournament-bracket-meta"><span>${escapeHtml(tournamentBracketMatchStatusLabel(match))}</span><b>${escapeHtml(match.code || "Partida")}</b>${match.bestOf ? `<em>${escapeHtml(match.bestOf)}</em>` : ""}</span>
      ${tournamentCuratedBracketTeam(event, match.a, match.aLabel, match.scoreA, winner === match.a)}
      ${tournamentCuratedBracketTeam(event, match.b, match.bLabel, match.scoreB, winner === match.b)}
    </button>
  `;
}

function tournamentBracketMatchHasResult(match) {
  return match?.scoreA != null && match?.scoreB != null;
}

function tournamentBracketMatchStatusLabel(match, round = null) {
  if (match?.status) return match.status;
  if (tournamentBracketMatchHasResult(match)) return "Concluida";
  return round?.status || "A jogar";
}

function tournamentBracketConnectorMode(currentMatches, nextMatches) {
  if (!nextMatches) return "terminal";
  if (nextMatches === currentMatches) return "straight";
  if (nextMatches < currentMatches) return "merge";
  return "straight";
}

function tournamentBracketConnectorSpanRows(maxMatches, columnMatches, connectorMode) {
  if (connectorMode !== "merge") return 0;
  const safeMax = Math.max(maxMatches, 1);
  const safeCount = Math.max(columnMatches, 1);
  return Number((safeMax / safeCount).toFixed(3));
}

function tournamentBracketRowStart(matchIndex, maxMatches, columnMatches) {
  const safeMax = Math.max(maxMatches, 1);
  const safeCount = Math.max(columnMatches, 1);
  return Math.max(1, Math.round(((matchIndex + 0.5) * safeMax * 2) / safeCount - 1) + 1);
}

function tournamentCuratedBracketTeam(event, teamId, label, score, won) {
  const team = teamId ? tournamentTeamById(event, teamId) : null;
  const name = label || team?.name || "Sem adversário";
  return `
    <span class="tournament-bracket-team ${won ? "winner" : ""} ${teamId ? "" : "bye"}">
      ${teamId ? teamLogo(teamId, "tiny") : `<span class="team-logo clean-logo tiny logo-empty"></span>`}
      <strong>${escapeHtml(name)}</strong>
      <b>${escapeHtml(String(score ?? "-"))}</b>
    </span>
  `;
}

function tournamentBracketMatchKey(columnIndex, matchIndex, code) {
  return `${columnIndex}-${matchIndex}-${slugify(code || "partida")}`;
}

function tournamentBracketEntries(event, matches) {
  const entries = new Map();
  if (event.swiss?.rounds?.length) {
    event.swiss.rounds.forEach((round, roundIndex) => {
      (round.matches || []).forEach((match, matchIndex) => {
        const key = tournamentSwissMatchKey(roundIndex, matchIndex, match.code);
        entries.set(key, {
          event,
          region: { name: event.bracket?.title || event.format?.summary || "Sistema suico" },
          column: { title: round.title || `Rodada ${roundIndex + 1}` },
          match: { ...match, bestOf: match.bestOf || round.bestOf },
          series: tournamentSeriesForBracketMatch(matches, match),
        });
      });
    });
    return entries;
  }
  if (!event.bracket?.regions?.length) return entries;
  for (const region of event.bracket.regions) {
    region.columns.forEach((column, columnIndex) => {
      column.matches.forEach((match, matchIndex) => {
        const key = tournamentBracketMatchKey(columnIndex, matchIndex, match.code);
        entries.set(key, { event, region, column, match, series: tournamentSeriesForBracketMatch(matches, match) });
      });
    });
  }
  return entries;
}

function tournamentSeriesForBracketMatch(matches, match) {
  const codeNumber = tournamentMatchCodeNumber(match.code);
  const ranked = matches
    .map((series) => ({ series, score: tournamentBracketSeriesFit(series, match, codeNumber) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.series.sortAt || 0) - Number(a.series.sortAt || 0));
  return ranked[0]?.series || null;
}

function tournamentBracketSeriesFit(series, match, codeNumber) {
  const hasBothTeams = Boolean(match.a && match.b);
  const sameOrientation = series.teamA.id === match.a && series.teamB.id === match.b;
  const reverseOrientation = series.teamA.id === match.b && series.teamB.id === match.a;
  const samePair = sameOrientation || reverseOrientation;
  const sameCode = Number.isFinite(codeNumber) && Number(series.seriesCode) === codeNumber;

  if (hasBothTeams && !samePair) return 0;
  if (!hasBothTeams && !sameCode) return 0;

  let score = samePair ? 100 : 0;
  if (sameCode) score += 12;
  if (!tournamentBracketMatchHasResult(match)) return sameCode ? score : 0;

  if (sameOrientation && tournamentBracketScoresMatch(series.roundScoreA, series.roundScoreB, match.scoreA, match.scoreB)) score += 80;
  if (reverseOrientation && tournamentBracketScoresMatch(series.roundScoreB, series.roundScoreA, match.scoreA, match.scoreB)) score += 80;
  if (sameOrientation && tournamentBracketScoresMatch(series.scoreA, series.scoreB, match.scoreA, match.scoreB)) score += 70;
  if (reverseOrientation && tournamentBracketScoresMatch(series.scoreB, series.scoreA, match.scoreA, match.scoreB)) score += 70;

  return score;
}

function tournamentBracketScoresMatch(leftA, leftB, rightA, rightB) {
  const values = [leftA, leftB, rightA, rightB].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return false;
  return values[0] === values[2] && values[1] === values[3];
}

function tournamentMatchCodeNumber(code) {
  const match = String(code || "").match(/\d+/);
  return match ? Number(match[0]) : NaN;
}

function bindTournamentBracketPreview(event, matches) {
  const bracket = document.querySelector(".tournament-curated-bracket, .tournament-swiss-bracket");
  if (!bracket) return;
  bindTournamentSwissFlowSlider(bracket);
  const entries = tournamentBracketEntries({ ...event, bracket: tournamentBracketDefinition(event, matches) }, matches);
  bracket.addEventListener("click", (clickEvent) => {
    const button = clickEvent.target.closest("[data-tournament-match]");
    if (!button) return;
    const entry = entries.get(button.dataset.tournamentMatch);
    if (!entry) return;
    openTournamentMatchPreview(entry);
  });
}

function bindTournamentSwissFlowSlider(bracket) {
  const board = bracket.querySelector("[data-swiss-flow]");
  const track = board?.querySelector(".swiss-flow-track");
  const rounds = [...(track?.querySelectorAll("[data-swiss-flow-round]") || [])];
  const inputs = [...bracket.querySelectorAll('input[type="radio"][name^="swiss-round-"]')];
  const modeInputs = [...bracket.querySelectorAll(".swiss-view-mode-input")];
  const navButtons = [...bracket.querySelectorAll("[data-swiss-flow-nav]")];
  const tabLabels = [...bracket.querySelectorAll(".swiss-round-tabs label")];
  const panels = [...bracket.querySelectorAll(".swiss-round-panel")];
  if (!board || !track || !rounds.length || !inputs.length) return;

  let flowOffset = 0;
  let manuallyScrolled = false;
  const activeIndex = () => Math.max(0, inputs.findIndex((input) => input.checked));
  const maxFlowOffset = () => Math.max(0, track.scrollWidth - board.clientWidth);
  const applyFlowOffset = (offset) => {
    if (!board.clientWidth || !track.scrollWidth) return;
    flowOffset = clamp(offset, 0, maxFlowOffset());
    track.style.setProperty("--swiss-flow-offset", `${Math.round(flowOffset)}px`);
    navButtons.forEach((button) => {
      const direction = Number(button.dataset.swissFlowNav || 0);
      button.disabled = maxFlowOffset() <= 0 || (direction < 0 && flowOffset <= 1) || (direction > 0 && flowOffset >= maxFlowOffset() - 1);
    });
  };
  const activeRoundOffset = (checkedIndex) => {
    const round = rounds[checkedIndex] || rounds[0];
    return round.offsetLeft + round.offsetWidth / 2 - board.clientWidth / 2;
  };
  const sync = () => {
    const checkedIndex = activeIndex();
    tabLabels.forEach((label, index) => label.classList.toggle("is-active", index === checkedIndex));
    panels.forEach((panel, index) => panel.classList.toggle("is-active", index === checkedIndex));
    applyFlowOffset(manuallyScrolled ? flowOffset : activeRoundOffset(checkedIndex));
  };
  const scheduleSync = () => window.requestAnimationFrame(sync);
  navButtons.forEach((button) =>
    button.addEventListener("click", (event) => {
      event.preventDefault();
      manuallyScrolled = true;
      const direction = Number(button.dataset.swissFlowNav || 0);
      const step = Math.max(320, board.clientWidth * 0.55);
      applyFlowOffset(flowOffset + direction * step);
    }),
  );
  inputs.forEach((input) =>
    input.addEventListener("change", () => {
      manuallyScrolled = false;
      scheduleSync();
    }),
  );
  modeInputs.forEach((input) => input.addEventListener("change", scheduleSync));
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(board);
    observer.observe(track);
  }
  scheduleSync();
}

function bindTournamentTeamPreview(event, matches, standings) {
  const root = document.querySelector("[data-tournament-teams]");
  if (!root) return;
  root.addEventListener("click", (clickEvent) => {
    const button = clickEvent.target.closest("[data-tournament-team]");
    if (!button) return;
    openTournamentTeamPreview(event, matches, standings, button.dataset.tournamentTeam);
  });
}

function openTournamentMatchPreview(entry) {
  const root = ensureTournamentPreviewRoot();
  if (!root) return;
  root.innerHTML = tournamentMatchPreviewHtml(entry);
  root.classList.add("open");
  root.querySelector("[data-tournament-preview-close]")?.focus();
}

function ensureTournamentPreviewRoot() {
  if (!document.body || !document.createElement) return null;
  let root = document.getElementById("tournament-match-preview");
  if (!root) {
    root = document.createElement("div");
    root.id = "tournament-match-preview";
    root.className = "tournament-match-preview";
    document.body.appendChild(root);
    root.addEventListener("click", (event) => {
      const openMatchLink = event.target.closest("[data-open-match-tab]");
      if (openMatchLink) {
        closeTournamentMatchPreview();
        return;
      }
      const openTeamLink = event.target.closest("[data-open-team-page]");
      if (openTeamLink) {
        closeTournamentMatchPreview();
        return;
      }
      const openPlayerLink = event.target.closest("[data-open-player-page]");
      if (openPlayerLink) {
        closeTournamentMatchPreview();
        return;
      }
      if (event.target === root || event.target.closest("[data-tournament-preview-close]")) closeTournamentMatchPreview();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeTournamentMatchPreview();
    });
  }
  return root;
}

function closeTournamentMatchPreview() {
  const root = document.getElementById("tournament-match-preview");
  if (!root) return;
  root.classList.remove("open");
  root.innerHTML = "";
}

function openTournamentTeamPreview(event, matches, standings, teamId) {
  const root = ensureTournamentPreviewRoot();
  if (!root) return;
  root.innerHTML = tournamentTeamPreviewHtml(event, matches, standings, teamId);
  root.classList.add("open");
  root.querySelector("[data-tournament-preview-close]")?.focus();
}

function tournamentTeamPreviewHtml(event, matches, standings, teamId) {
  const team = tournamentTeamById(event, teamId);
  const standing = standings.find((row) => row.id === teamId) || {};
  const lineup = tournamentLineupRows(teamId, matches);
  const teamMatches = tournamentTeamSeriesRows(teamId, matches);
  return `
    <div class="tournament-match-preview-card tournament-lineup-preview-card" role="dialog" aria-modal="true" aria-label="Line-up da equipe no torneio">
      <button type="button" class="preview-close" data-tournament-preview-close aria-label="Fechar">x</button>
      <div class="preview-kicker">${escapeHtml(event.name)} - Line-up</div>
      <div class="lineup-preview-header">
        ${teamLogo(teamId, "large")}
        <span>
          <h3>${escapeHtml(team?.name || "Equipe")}</h3>
          <small>${escapeHtml(team?.sourceTag || team?.tag || teamId)}</small>
        </span>
      </div>
      <div class="tournament-lineup-tabs">
        <input type="radio" name="lineup-tab-${escapeHtml(teamId)}" id="lineup-performance-${escapeHtml(teamId)}" checked />
        <input type="radio" name="lineup-tab-${escapeHtml(teamId)}" id="lineup-matches-${escapeHtml(teamId)}" />
        <div class="lineup-tab-labels">
          <label for="lineup-performance-${escapeHtml(teamId)}">Desempenho</label>
          <label for="lineup-matches-${escapeHtml(teamId)}">Partidas</label>
        </div>
        <div class="lineup-tab-window">
          <div class="lineup-tab-track">
            <section class="lineup-tab-panel">
              <div class="preview-summary-grid">
                <span><small>Séries</small><strong>${escapeHtml(`${standing.seriesWins || 0}-${standing.seriesLosses || 0}`)}</strong></span>
                <span><small>Mapas</small><strong>${escapeHtml(`${standing.mapWins || 0}-${standing.mapLosses || 0}`)}</strong></span>
                <span><small>Saldo</small><strong>${escapeHtml(signed(standing.roundDiff || 0))}</strong></span>
              </div>
              <div class="tournament-lineup-grid">
                ${lineup.length ? lineup.map(tournamentLineupPlayerCard).join("") : `<div class="empty-state">Line-up indisponível para este torneio.</div>`}
              </div>
            </section>
            <section class="lineup-tab-panel">
              <div class="lineup-match-list">
                ${teamMatches.length ? teamMatches.map(matchResultRow).join("") : `<div class="empty-state">Nenhuma partida registrada para esta equipe.</div>`}
              </div>
            </section>
          </div>
        </div>
      </div>
      <div class="preview-actions">
        ${team && !team.missing ? `<a class="action-link primary" href="#/teams/${team.id}" data-open-team-page>Abrir página da equipe</a>` : ""}
        <button type="button" class="action-link" data-tournament-preview-close>Fechar</button>
      </div>
    </div>
  `;
}

function tournamentTeamSeriesRows(teamId, matches) {
  return (matches || []).filter((series) => seriesHasTeam(series, teamId)).sort(compareSeriesDateDesc);
}

function tournamentLineupRows(teamId, matches) {
  const rows = new Map();
  for (const series of matches || []) {
    for (const match of series.maps || []) {
      for (const player of match.players || []) {
        if (player.teamId !== teamId) continue;
        if (!rows.has(player.id)) {
          rows.set(player.id, {
            id: player.id,
            nick: player.nick,
            handle: player.handle,
            maps: 0,
            rounds: 0,
            kills: 0,
            deaths: 0,
            assists: 0,
            ratingTotal: 0,
            agents: new Map(),
          });
        }
        const row = rows.get(player.id);
        row.maps += 1;
        row.rounds += Number(player.rounds || 0);
        row.kills += Number(player.kills || 0);
        row.deaths += Number(player.deaths || 0);
        row.assists += Number(player.assists || 0);
        row.ratingTotal += Number(player.rating || 0) * Number(player.rounds || 0);
        const agentKey = player.agentSlug || player.agent || "agent";
        const agent = row.agents.get(agentKey) || { slug: player.agentSlug, name: player.agent, icon: player.agentIcon, maps: 0 };
        agent.maps += 1;
        row.agents.set(agentKey, agent);
      }
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, rating: row.rounds ? row.ratingTotal / row.rounds : 0, agents: [...row.agents.values()].sort((a, b) => b.maps - a.maps || String(a.name).localeCompare(String(b.name))) }))
    .sort((a, b) => b.maps - a.maps || b.rounds - a.rounds || b.rating - a.rating || a.nick.localeCompare(b.nick));
}

function tournamentLineupPlayerCard(row) {
  return `
    <a class="tournament-lineup-player" href="${playerHref(row.id)}" data-open-player-page>
      ${playerLogo(row.id, "lineup-photo")}
      <span class="lineup-player-main">
        <strong>${escapeHtml(row.nick)}</strong>
        <small>${escapeHtml(row.handle || `${row.maps} mapas`)}</small>
      </span>
      <span class="lineup-agent-pile">
        ${row.agents.slice(0, 4).map(tournamentLineupAgent).join("")}
      </span>
      <span class="lineup-player-stat"><b>${escapeHtml(playerRating(row))}</b><small>rAAting 3.0</small></span>
      <span class="lineup-player-stat"><b>${escapeHtml(String(row.maps))}</b><small>Mapas</small></span>
      <span class="lineup-player-stat"><b>${escapeHtml(`${row.kills}/${row.deaths}/${row.assists}`)}</b><small>K/D/A</small></span>
    </a>
  `;
}

function tournamentLineupAgent(agent) {
  const src = assetPath(agent.icon || "");
  const label = agent.name || agent.slug || "Agente";
  return `<span title="${escapeHtml(`${label} - ${agent.maps} mapa(s)`)}">${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" onerror="this.remove()" />` : escapeHtml(String(label).slice(0, 2).toUpperCase())}</span>`;
}

function tournamentMatchPreviewHtml(entry) {
  const { event, region, column, match, series } = entry;
  const hasResult = tournamentBracketMatchHasResult(match);
  const winnerId = hasResult ? match.winner || (Number(match.scoreA) > Number(match.scoreB) ? match.a : match.b) : "";
  const teamA = tournamentTeamById(event, match.a);
  const teamB = tournamentTeamById(event, match.b);
  return `
    <div class="tournament-match-preview-card" role="dialog" aria-modal="true" aria-label="Resumo da partida">
      <button type="button" class="preview-close" data-tournament-preview-close aria-label="Fechar">x</button>
      <div class="preview-kicker">${escapeHtml(region.name || "Bracket")} - ${escapeHtml(column.title || "Rodada")}</div>
      <h3>${escapeHtml(match.code || "Partida")} ${match.bestOf ? `<span>${escapeHtml(match.bestOf)}</span>` : ""}</h3>
      <div class="preview-scoreboard">
        ${tournamentPreviewTeam(event, teamA, match.scoreA, winnerId === match.a)}
        <span class="preview-score">${escapeHtml(String(match.scoreA ?? "-"))}<small>x</small>${escapeHtml(String(match.scoreB ?? "-"))}</span>
        ${tournamentPreviewTeam(event, teamB, match.scoreB, winnerId === match.b)}
      </div>
      <div class="preview-summary-grid">
        <span><small>${hasResult ? "Vencedor" : "Status"}</small><strong>${escapeHtml(hasResult ? tournamentTeamById(event, winnerId)?.name || "Concluida" : "A jogar")}</strong></span>
        <span><small>Formato</small><strong>${escapeHtml(match.bestOf || series?.label || "MD1")}</strong></span>
        <span><small>Data</small><strong>${escapeHtml(series ? formatDate(series.startedAt, "time") : eventTimeRange(event))}</strong></span>
      </div>
      ${series ? tournamentPreviewSeriesDetails(series) : `<div class="empty-state">Resumo oficial da chave. Detalhes não disponíveis para essa partida.</div>`}
      <div class="preview-actions">
        ${series ? `<a class="action-link primary" href="${matchSeriesHref(series)}" target="_blank" rel="noopener" data-open-match-tab>Ver página da partida</a>` : `<span class="action-link disabled">Página da partida indisponível.</span>`}
        <button type="button" class="action-link" data-tournament-preview-close>Fechar</button>
      </div>
      <div class="preview-open-status" data-open-match-status hidden><span aria-hidden="true">&#10003;</span>Partida aberta em uma nova aba</div>
    </div>
  `;
}

function tournamentPreviewTeam(event, team, score, won) {
  if (!team) return `<span class="preview-team"><span class="team-logo clean-logo logo-empty"></span><strong>Sem adversário</strong><small>${escapeHtml(String(score ?? "-"))}</small></span>`;
  return `
    <span class="preview-team ${won ? "winner" : ""}">
      ${teamLogo(team.id)}
      <strong>${escapeHtml(team.name)}</strong>
      <small>${won ? "Vitória" : "Derrota"}</small>
    </span>
  `;
}

function tournamentPreviewSeriesDetails(series) {
  return `
    <div class="preview-series">
      <div class="preview-map-list">
        ${series.maps
          .map((match, index) => {
            const scoreA = scoreForTeamInMatch(match, series.teamA.id);
            const scoreB = scoreForTeamInMatch(match, series.teamB.id);
            return `<span><small>Mapa ${index + 1}</small><strong>${escapeHtml(match.mapName)}</strong><em>${scoreA} - ${scoreB}</em></span>`;
          })
          .join("")}
      </div>
      <div class="preview-summary-grid">
        <span><small>Rounds</small><strong>${series.roundScoreA}-${series.roundScoreB}</strong></span>
        <span><small>Mapas</small><strong>${escapeHtml(series.mapNames.join(" / "))}</strong></span>
        <span><small>MVP</small><strong>${escapeHtml(series.mvp?.nick || "-")}</strong></span>
      </div>
    </div>
  `;
}

function tournamentBracketColumns(matches) {
  const sorted = matches.slice().sort((a, b) => (a.startedAt || a.sortAt || 0) - (b.startedAt || b.sortAt || 0)).slice(-7);
  if (!sorted.length) return [];
  if (sorted.length >= 7) {
    return [
      { title: "Quartas de final", matches: sorted.slice(0, 4) },
      { title: "Semifinais", matches: sorted.slice(4, 6) },
      { title: "Grande final", matches: sorted.slice(6, 7) },
    ];
  }
  if (sorted.length >= 3) {
    return [
      { title: "Semifinais", matches: sorted.slice(0, -1) },
      { title: "Grande final", matches: sorted.slice(-1) },
    ];
  }
  return [{ title: sorted.length > 1 ? "Partidas finais" : "Grande final", matches: sorted }];
}

function tournamentPlacementsSection(event, standings) {
  const rows = tournamentResultRows(event, standings);
  const featuredCount = tournamentFeaturedPlacementCount(event, rows);
  const finished = eventIsDone(event);
  return `
    <section class="tournament-section">
      <div class="tournament-section-head">
        <h2>Resultados</h2>
        <span>${finished ? "Resultado oficial" : "Equipes eliminadas"}</span>
      </div>
      <div class="tournament-placement-grid featured-count-${featuredCount}">
        ${rows.length ? rows.map((row, index) => tournamentPlacementCard(event, row, index)).join("") : `<div class="empty-state">Distribuição aguardando resultados.</div>`}
      </div>
    </section>
  `;
}

function tournamentResultRows(event, standings) {
  if (event.placements?.length) return tournamentOfficialPlacements(event);
  if (!eventIsDone(event)) return tournamentEliminatedRows(event);
  return standings.slice(0, 16);
}

function tournamentEliminatedRows(event) {
  const rows = event.eliminated || event.swiss?.eliminated || [];
  return rows.map((row) => ({
    ...row,
    note: `${row.wins ?? 0}-${row.losses ?? 0}`,
    reason: row.reason || row.note || "",
    range: row.range || "Eliminado",
  }));
}

function tournamentPlacementCard(event, row, index) {
  const team = tournamentTeamById(event, row.id || row.teamId);
  if (!team) return "";
  const rawLabel = row.range || placementLabel(index);
  const label = tournamentPlacementDisplayLabel(event, rawLabel);
  const detail = row.note || (Number.isFinite(row.seriesWins) ? `${row.seriesWins}-${row.seriesLosses}` : "Colocação oficial");
  const isFeatured = tournamentPlacementIsFeatured(label, index);
  const podiumClass = tournamentPlacementPodiumClass(label);
  const tag = team.missing ? "article" : "a";
  const href = team.missing ? "" : ` href="#/teams/${team.id}"`;
  const classes = ["tournament-placement-card", podiumClass, isFeatured ? "featured-placement" : ""].filter(Boolean).join(" ");
  return `
    <${tag} class="${classes}"${href}>
      <span>${escapeHtml(label)}</span>
      ${teamLogo(team.id, "large")}
      <strong>${escapeHtml(team.name)}</strong>
      <small>${escapeHtml(detail)}</small>
      ${row.reason ? `<small class="placement-reason">${escapeHtml(row.reason)}</small>` : ""}
    </${tag}>
  `;
}

function tournamentPlacementIsFeatured(label, index) {
  const normalizedLabel = normalize(String(label || ""));
  if (normalizedLabel.startsWith("classificado")) return true;
  return Boolean(tournamentPlacementPodiumClass(label || placementLabel(index)));
}

function tournamentPlacementPodiumClass(label) {
  const value = String(label || "").trim();
  const normalizedLabel = normalize(value);
  const compactLabel = normalizeNameKey(value);
  if (value === "1" || normalizedLabel === "1st" || compactLabel === "1olugar") return "place-1";
  if (value === "2" || normalizedLabel === "2nd" || compactLabel === "2olugar") return "place-2";
  if (value === "3" || normalizedLabel === "3rd" || compactLabel === "3olugar" || compactLabel.startsWith("3o4") || normalizedLabel.startsWith("3-4") || normalizedLabel.startsWith("3/4")) return "place-3";
  return "";
}

function tournamentFeaturedPlacementCount(event, rows) {
  return rows.filter((row, index) => {
    const rawLabel = row.range || placementLabel(index);
    const label = tournamentPlacementDisplayLabel(event, rawLabel);
    return tournamentPlacementIsFeatured(label, index);
  }).length;
}

// Rotulos como "Classificado" continuam visiveis quando o evento termina;
// "Em andamento" so aparece enquanto a disputa nao acabou.
function tournamentPlacementDisplayLabel(event, rawLabel) {
  if (placementIsOngoing(rawLabel)) return eventIsDone(event) ? String(rawLabel) : "Em andamento";
  return rankingPlacementLabel(rawLabel);
}

function tournamentOfficialPlacements(event) {
  const standingsByTeam = new Map(eventStandings(matchSeriesForEvent(event.id)).map((row) => [row.id, row]));
  return normalizePlacementRowsForDisplay(event.placements).map((row) => ({ ...(standingsByTeam.get(row.id) || {}), ...row }));
}

function placementLabel(index) {
  if (index === 0) return "1st";
  if (index === 1) return "2nd";
  if (index < 4) return "3-4th";
  if (index < 8) return "5-8th";
  if (index < 12) return "9-12th";
  if (index < 16) return "13-16th";
  return `${index + 1}th`;
}

function tournamentRankingSnapshot(event, matches = []) {
  const firstMatchAt = tournamentFirstMatchTimestamp(event, matches);
  if (!firstMatchAt) return latestRankingSnapshot();

  const cutoffAt = Math.max(0, firstMatchAt - 1);
  const cacheKey = `${event.id}:${cutoffAt}`;
  if (state.tournamentRankingCache.has(cacheKey)) return state.tournamentRankingCache.get(cacheKey);

  const snapshot = tournamentCalculatedRankingSnapshot(event, cutoffAt, firstMatchAt) || rankingSnapshotAtTimestamp(cutoffAt);
  state.tournamentRankingCache.set(cacheKey, snapshot);
  return snapshot;
}

function tournamentCalculatedRankingSnapshot(event, cutoffAt, eventDate) {
  if (!state.db || !window.RankingCore?.calculateTeamRankings) return null;
  try {
    const ranking = calculateRankingForCutoff({
      teams: state.db.teams,
      matches: state.db.matches,
      matchSeries: state.db.matchSeries,
      players: state.db.players,
      tournaments: state.db.tournaments,
      rankingWeights: state.db.rankingWeights || {},
      cutoffAt,
    });
    return {
      ...rankingSnapshotShell(cutoffAt, ranking, `Ranking em ${formatDate(eventDate, "date")}`),
      eventDate,
      eventId: event.id,
    };
  } catch (error) {
    console.error("Falha ao calcular ranking historico do campeonato", error);
    return null;
  }
}

function rankingSnapshotAtTimestamp(timestamp) {
  const snapshots = state.db?.rankingSnapshots || [];
  if (!snapshots.length) return null;
  return snapshots
    .filter((snapshot) => Number(snapshot.cutoffAt || 0) <= timestamp)
    .sort((a, b) => Number(b.cutoffAt || 0) - Number(a.cutoffAt || 0))[0] || snapshots.at(-1) || null;
}

function tournamentFirstMatchTimestamp(event, matches = []) {
  const dates = (matches || [])
    .flatMap((series) => [
      Number(series.startedAt || 0),
      Number(series.sortAt || 0),
      ...(series.maps || []).map((match) => Number(match.startedAt || 0)),
    ])
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  return dates[0] || Number(event.start || 0) || null;
}

function tournamentTeamsSection(event, standings, matches = []) {
  const rows = tournamentTeamRows(event, standings, matches);
  const columns = tournamentTeamGridColumns(rows.length);
  return `
    <section class="tournament-section">
      <div class="tournament-section-head">
        <h2>Equipes Participantes</h2>
        <span>${rows.length} times</span>
      </div>
      <div class="tournament-team-grid ${columns ? "balanced-columns" : ""}"${columns ? ` style="--team-columns:${columns}"` : ""} data-tournament-teams>
        ${rows.map((row, index) => tournamentTeamCard(row, index)).join("") || `<div class="empty-state">Nenhum time detectado.</div>`}
      </div>
    </section>
  `;
}

// Escolhe quantos cards por linha para que todas as linhas fiquem com a mesma
// quantidade (ex.: 40 times -> 5x8, 36 -> 4x9, 12 -> 2x6, 10 -> 2x5).
function tournamentTeamGridColumns(count) {
  if (!count) return 0;
  if (count <= 9) return count;
  for (let columns = 9; columns >= 4; columns--) {
    if (count % columns === 0) return columns;
  }
  let best = 9;
  let bestEmpty = Infinity;
  for (let columns = 9; columns >= 4; columns--) {
    const empty = (columns - (count % columns)) % columns;
    if (empty < bestEmpty) {
      best = columns;
      bestEmpty = empty;
    }
  }
  return best;
}

function tournamentTeamRows(event, standings, matches = []) {
  const statsByTeam = new Map(standings.map((row) => [row.id, row]));
  const orderedTeams = event.teams?.length ? event.teams : standings.map((row) => row.id);
  const rankingSnapshot = tournamentRankingSnapshot(event, matches);
  return orderedTeams
    .map((teamId) => ({
      ...(statsByTeam.get(teamId) || { id: teamId, seriesWins: 0, seriesLosses: 0, mapWins: 0, mapLosses: 0, roundDiff: 0 }),
      team: tournamentTeamById(event, teamId),
      eventRanking: rankingSnapshot?.byTeamId?.[teamId] || null,
      eventRankingDate: rankingSnapshot?.eventDate || rankingSnapshot?.cutoffAt || null,
    }))
    .filter((row) => row.team)
    .sort(compareTournamentTeamByRank);
}

// Ranking oficial na frente (do melhor para o pior); quem ainda esta com rank
// provisorio vai para o fim da lista, em ordem alfabetica entre si.
function compareTournamentTeamByRank(a, b) {
  const rankA = Number(a.eventRanking?.validRank || 0);
  const rankB = Number(b.eventRanking?.validRank || 0);
  if (rankA && rankB) return rankA - rankB;
  if (rankA !== rankB) return rankA ? -1 : 1;
  return String(a.team?.name || "").localeCompare(String(b.team?.name || ""), "pt-BR");
}

function tournamentTeamCard(row, index) {
  const team = row.team;
  return `
    <button type="button" class="tournament-team-card" data-tournament-team="${escapeHtml(team.id)}">
      <span class="team-rank" title="${escapeHtml(tournamentTeamRankTitle(row))}">${escapeHtml(tournamentTeamRankLabel(row))}</span>
      ${teamLogo(team.id, "large")}
      <strong>${escapeHtml(team.name)}</strong>
      <small>${escapeHtml(team.sourceTag || team.tag || team.id)}</small>
    </button>
  `;
}

function tournamentTeamRankLabel(row) {
  const rank = Number(row.eventRanking?.validRank || 0);
  return rank > 0 ? `#${rank}` : "prov";
}

function tournamentTeamRankTitle(row) {
  const date = row.eventRankingDate ? formatDate(row.eventRankingDate, "date") : "";
  const suffix = row.eventRanking?.provisional ? " - provisório" : "";
  return date ? `Ranking em ${date}${suffix}` : "Ranking historico indisponivel";
}

function tournamentMatchesSection(matches) {
  const rows = matches.slice().sort(compareSeriesDateDesc);
  return `
    <section class="tournament-section">
      <div class="tournament-section-head">
        <h2>Jogos</h2>
        <span>${rows.length} séries</span>
      </div>
      <div class="result-list tournament-results">${rows.length ? rows.map(matchResultRow).join("") : `<div class="empty-state">Nenhuma partida registrada.</div>`}</div>
    </section>
  `;
}

function tournamentStatsSection(event, matches, standings) {
  const mapMatches = tournamentStatMapMatches(matches);
  const players = aggregateMatchPlayers(mapMatches)
    .filter((player) => Number(player.rounds || 0) > 0)
    .sort(tournamentPlayerStatSort);
  const officialPlayers = players.filter(isOfficialRatingSample);
  const teams = tournamentTeamStatRows(event, matches, standings, players);
  return `
    <section class="tournament-section tournament-stats-section">
      <div class="tournament-section-head">
        <h2>Estatísticas</h2>
        <span>${officialPlayers.length} jogadores no ranking oficial · ${teams.length} equipes</span>
      </div>
      <div class="tournament-stats-shell">
        <div class="tournament-stats-top-grid">
          ${tournamentStatsTopList("Top jogadores", `rAAting 3.0, mínimo ${RaaRatingCore.SAMPLE_MIN_ROUNDS} rounds`, officialPlayers.slice(0, 8).map(tournamentTopPlayerRow), "Nenhum jogador com amostra oficial disponível.")}
          ${tournamentStatsTopList("Top equipes", "Campanha agregada das séries registradas", teams.filter((row) => row.seriesPlayed || row.playerRounds).slice(0, 8).map(tournamentTopTeamRow), "Nenhuma equipe com estatísticas disponíveis.")}
        </div>
        <div class="tournament-stat-tables">
          ${tournamentPlayerStatsTable(event.id, officialPlayers)}
          ${tournamentTeamStatsTable(event.id, teams)}
        </div>
      </div>
    </section>
  `;
}

function tournamentMapsSection(event, matches) {
  const mapMatches = tournamentStatMapMatches(matches);
  const rows = tournamentMapAnalyticsRows(event, mapMatches);
  const agentColumns = tournamentMapAgentColumns(rows);
  const totalMaps = rows.reduce((sum, row) => sum + row.matches, 0);
  const totalRounds = rows.reduce((sum, row) => sum + row.rounds, 0);
  return `
    <section class="tournament-section tournament-maps-section">
      <div class="tournament-section-head">
        <h2>Mapas</h2>
        <span>${escapeHtml(`${totalMaps} mapas · ${totalRounds} rounds`)}</span>
      </div>
      <div class="tournament-stats-shell tournament-maps-shell">
        ${rows.length ? `
          <div class="tournament-map-charts">
            ${tournamentMapDistributionChart(rows)}
            ${tournamentMapSideWinChart(rows)}
          </div>
          ${tournamentMapAgentPickrateTable(rows, agentColumns)}
        ` : `<div class="empty-state">Nenhum mapa registrado para este campeonato.</div>`}
      </div>
    </section>
  `;
}

function tournamentMapAnalyticsRows(event, mapMatches) {
  const rows = new Map();
  const ensure = (match) => {
    const meta = mapById(match.mapId) || mapByName(match.mapName) || {};
    const id = meta.id || match.mapId || normalizeNameKey(match.mapName || "mapa");
    if (!rows.has(id)) {
      rows.set(id, {
        id,
        name: meta.name || match.mapName || displayEntityName(id),
        icon: meta.icon || match.mapIcon || "",
        matches: 0,
        rounds: 0,
        sideRounds: 0,
        attackWins: 0,
        defenseWins: 0,
        totalPicks: 0,
        pickOpportunities: 0,
        agents: new Map(),
        poolIndex: (event.mapPool || event.maps || []).findIndex((name) => normalizeNameKey(name) === normalizeNameKey(meta.name || match.mapName || id)),
      });
    }
    return rows.get(id);
  };

  for (const match of mapMatches || []) {
    const row = ensure(match);
    row.matches += 1;
    row.pickOpportunities += 2;
    row.rounds += Number(match.rounds || match.roundResults?.length || 0);
    if (match.sideSummary && !(match.roundResults || []).length) {
      // roundResults podados do database.json; usa o resumo pré-computado.
      row.attackWins += Number(match.sideSummary.attackWins || 0);
      row.defenseWins += Number(match.sideSummary.defenseWins || 0);
      row.sideRounds += Number(match.sideSummary.attackWins || 0) + Number(match.sideSummary.defenseWins || 0);
    } else {
      for (const round of match.roundResults || []) {
        if (round.winningTeamRole === "Attacker") {
          row.attackWins += 1;
          row.sideRounds += 1;
        } else if (round.winningTeamRole === "Defender") {
          row.defenseWins += 1;
          row.sideRounds += 1;
        }
      }
    }
    for (const player of match.players || []) {
      const key = agentStatsKey(player);
      const agent = row.agents.get(key) || {
        slug: player.agentSlug || key,
        name: displayAgentName(player.agent, player.agentSlug || key),
        role: player.agentClass || "",
        icon: player.agentIcon || "",
        picks: 0,
      };
      agent.picks += 1;
      row.totalPicks += 1;
      row.agents.set(key, agent);
    }
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      attackRate: row.sideRounds ? pctValue(row.attackWins, row.sideRounds) : 0,
      defenseRate: row.sideRounds ? pctValue(row.defenseWins, row.sideRounds) : 0,
      agentRates: new Map([...row.agents.entries()].map(([key, agent]) => [key, { ...agent, rate: pctValue(agent.picks, row.pickOpportunities) }])),
    }))
    .sort((a, b) => b.matches - a.matches || (a.poolIndex < 0 ? 999 : a.poolIndex) - (b.poolIndex < 0 ? 999 : b.poolIndex) || a.name.localeCompare(b.name, "pt-BR"));
}

function tournamentMapAgentColumns(rows) {
  const agents = new Map();
  for (const row of rows || []) {
    for (const [key, agent] of row.agents.entries()) {
      const current = agents.get(key) || { ...agent, picks: 0 };
      current.picks += agent.picks;
      agents.set(key, current);
    }
  }
  return [...agents.entries()]
    .map(([key, agent]) => ({ key, ...agent }))
    .sort((a, b) => b.picks - a.picks || roleSortOrder(a.role) - roleSortOrder(b.role) || String(a.name || a.key).localeCompare(String(b.name || b.key), "pt-BR"));
}

function tournamentMapDistributionChart(rows) {
  const max = Math.max(1, ...rows.map((row) => row.matches));
  return `
    <article class="tournament-stat-card tournament-map-chart-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>Distribuição de mapas jogados</strong>
          <small>Volume de mapas registrados no campeonato</small>
        </span>
      </div>
      <div class="tournament-map-distribution">
        ${rows.map((row, index) => tournamentMapDistributionRow(row, max, index)).join("")}
      </div>
    </article>
  `;
}

function tournamentMapDistributionRow(row, max, index) {
  const width = pctValue(row.matches, max);
  return `
    <div class="tournament-map-bar-row" style="--bar:${clamp(width, 2, 100)}; --tone:${index}">
      <span class="tournament-map-bar-label">${mapLogo(row.id, "tournament-map-mini-logo")}<strong>${escapeHtml(row.name)}</strong></span>
      <div class="tournament-map-bar-track"><i></i></div>
      <span class="numeric">${escapeHtml(String(row.matches))}</span>
    </div>
  `;
}

function tournamentMapSideWinChart(rows) {
  return `
    <article class="tournament-stat-card tournament-map-chart-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>Vitórias por lado</strong>
          <small>Taxa de rounds vencidos por Ataque e Defesa</small>
        </span>
      </div>
      <div class="tournament-map-side-chart">
        ${rows.map(tournamentMapSideWinRow).join("")}
      </div>
      <div class="tournament-map-side-legend">
        <span class="attack">Ataque</span>
        <span class="defense">Defesa</span>
      </div>
    </article>
  `;
}

function tournamentMapSideWinRow(row) {
  return `
    <div class="tournament-map-side-row" style="--atk:${clamp(row.attackRate, 0, 100)}; --def:${clamp(row.defenseRate, 0, 100)}">
      <span class="tournament-map-side-label">${escapeHtml(row.name)}</span>
      <div class="tournament-map-side-bars">
        <span class="attack"><i></i><b>${escapeHtml(pct(row.attackRate))}</b></span>
        <span class="defense"><i></i><b>${escapeHtml(pct(row.defenseRate))}</b></span>
      </div>
    </div>
  `;
}

function tournamentMapAgentPickrateTable(rows, agentColumns) {
  const totalRow = tournamentMapTotalAgentRow(rows, agentColumns);
  return `
    <article class="tournament-stat-card tournament-map-agent-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>Pickrate por agente em cada mapa</strong>
          <small>Picks divididos por 2 seleções possíveis em cada mapa</small>
        </span>
      </div>
      <div class="table-wrap tournament-map-agent-table-wrap">
        <table class="tournament-map-agent-table">
          <thead>
            <tr>
              <th>Mapa</th>
              <th class="numeric">#</th>
              ${agentColumns.map((agent) => `<th title="${escapeHtml(`${agent.name || agent.key}${agent.role ? ` - ${roleDisplayInfo(agent.role).label}` : ""}`)}">${tournamentAgentLogo(agent, "tournament-map-agent-logo")}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${totalRow ? tournamentMapAgentPickrateRow(totalRow, agentColumns, true) : ""}
            ${rows.map((row) => tournamentMapAgentPickrateRow(row, agentColumns)).join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function tournamentMapTotalAgentRow(rows, agentColumns) {
  if (!rows.length) return null;
  const total = {
    id: "all",
    name: "Todos",
    matches: rows.reduce((sum, row) => sum + row.matches, 0),
    sideRounds: rows.reduce((sum, row) => sum + row.sideRounds, 0),
    attackWins: rows.reduce((sum, row) => sum + row.attackWins, 0),
    defenseWins: rows.reduce((sum, row) => sum + row.defenseWins, 0),
    totalPicks: rows.reduce((sum, row) => sum + row.totalPicks, 0),
    pickOpportunities: rows.reduce((sum, row) => sum + row.pickOpportunities, 0),
    agentRates: new Map(),
  };
  total.attackRate = total.sideRounds ? pctValue(total.attackWins, total.sideRounds) : 0;
  total.defenseRate = total.sideRounds ? pctValue(total.defenseWins, total.sideRounds) : 0;
  for (const agent of agentColumns || []) {
    const picks = rows.reduce((sum, row) => sum + Number(row.agents.get(agent.key)?.picks || 0), 0);
    total.agentRates.set(agent.key, { ...agent, picks, rate: pctValue(picks, total.pickOpportunities) });
  }
  return total;
}

function tournamentMapAgentPickrateRow(row, agentColumns, summary = false) {
  return `
    <tr class="${summary ? "summary-row" : ""}">
      <td>${tournamentMapAgentMapCell(row, summary)}</td>
      <td class="numeric">${escapeHtml(String(row.matches || 0))}</td>
      ${agentColumns.map((agent) => tournamentMapAgentPickrateCell(row.agentRates.get(agent.key)?.rate || 0)).join("")}
    </tr>
  `;
}

function tournamentMapAgentMapCell(row, summary = false) {
  if (summary) {
    return `
      <span class="tournament-map-agent-map-cell summary">
        <strong>${escapeHtml(row.name)}</strong>
        <small>${escapeHtml(`${row.matches || 0} mapa${Number(row.matches || 0) === 1 ? "" : "s"}`)}</small>
      </span>
    `;
  }
  const map = mapById(row.id) || {};
  const art = mapArtAttrs(map.id ? map : { id: row.id, icon: row.icon }, row.icon);
  return `
    <a class="tournament-map-agent-banner ${art ? "has-banner" : ""}" href="#/maps/${escapeHtml(row.id)}">
      ${art ? `<img src="${escapeHtml(art.src)}" data-fallback="${escapeHtml(art.fallback)}" alt="${escapeHtml(row.name)}" loading="lazy" onerror="mapArtError(this)" />` : ""}
      <span>
        <strong>${escapeHtml(row.name)}</strong>
        <small>${escapeHtml(`${row.matches || 0} mapa${Number(row.matches || 0) === 1 ? "" : "s"}`)}</small>
      </span>
    </a>
  `;
}

function tournamentMapAgentPickrateCell(rate) {
  const value = clamp(rate, 0, 100);
  const hue = Math.round(value * 1.28);
  const lightness = Math.round(value <= 0 ? 24 : 28 + Math.min(18, value * 0.18));
  const alpha = (value <= 0 ? 0.52 : 0.42 + (value / 100) * 0.34).toFixed(2);
  const tone = value <= 0 ? "zero" : value >= 35 ? "high" : value >= 12 ? "mid" : "low";
  return `<td class="numeric map-agent-rate ${tone}" style="--rate:${value}; --heat-bg:hsl(${hue} 72% ${lightness}% / ${alpha}); --heat-border:hsl(${hue} 82% 62% / 0.42)">${escapeHtml(pct(value))}</td>`;
}

function tournamentStatMapMatches(matches) {
  return (matches || [])
    .flatMap((series) => series.maps || [])
    .filter((match) => Array.isArray(match.players) && match.players.length);
}

function tournamentSelectedMapFilter(eventId, scope) {
  return state.tournamentMapFilters?.[`${eventId}:${scope}`] || "all";
}

function tournamentFilteredMapMatches(matches, mapFilter) {
  const maps = tournamentStatMapMatches(matches);
  if (!mapFilter || mapFilter === "all") return maps;
  return maps.filter((match) => match.mapId === mapFilter || normalizeNameKey(match.mapName) === normalizeNameKey(mapFilter));
}

function tournamentMapFilterControl(eventId, matches, scope) {
  const selected = tournamentSelectedMapFilter(eventId, scope);
  const maps = tournamentFilterMapOptions(matches);
  if (maps.length <= 1) return "";
  return `
    <label class="tournament-stat-filter">
      <span>Mapa</span>
      <select class="filter-control" data-tournament-map-filter="${escapeHtml(scope)}">
        <option value="all"${selected === "all" ? " selected" : ""}>Todos os mapas</option>
        ${maps.map((map) => `<option value="${escapeHtml(map.id)}"${selected === map.id ? " selected" : ""}>${escapeHtml(map.name)} (${map.count})</option>`).join("")}
      </select>
    </label>
  `;
}

function tournamentFilterMapOptions(matches) {
  const rows = new Map();
  for (const match of tournamentStatMapMatches(matches)) {
    const meta = mapById(match.mapId) || mapByName(match.mapName) || { id: match.mapId || normalizeNameKey(match.mapName), name: match.mapName || "Mapa" };
    const id = meta.id || normalizeNameKey(meta.name);
    if (!rows.has(id)) rows.set(id, { id, name: meta.name || match.mapName || id, count: 0 });
    rows.get(id).count += 1;
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
}

function tournamentPlayerStatSort(a, b) {
  return Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0) || Number(b.rounds || 0) - Number(a.rounds || 0) || Number(b.kills || 0) - Number(a.kills || 0) || String(a.nick || "").localeCompare(String(b.nick || ""), "pt-BR");
}

function tournamentStatsTopList(title, subtitle, rows, emptyLabel) {
  return `
    <article class="tournament-stat-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </span>
      </div>
      <div class="tournament-stat-list">
        ${rows.length ? rows.join("") : `<div class="empty-state compact-empty">${escapeHtml(emptyLabel)}</div>`}
      </div>
    </article>
  `;
}

function tournamentTopPlayerRow(player, index) {
  const team = teamById(player.teamId);
  const teamLabel = team?.sourceTag || team?.tag || player.teamTag || player.teamId || "Sem equipe";
  return `
    <a class="tournament-stat-list-row" href="${playerHref(player)}">
      <span class="stat-rank">${index + 1}</span>
      ${playerLogo(player.id, "tournament-stat-avatar")}
      <span class="stat-row-main">
        <strong>${escapeHtml(player.nick || player.handle || "Jogador")}</strong>
        <small>${escapeHtml(teamLabel)}</small>
      </span>
      <span class="stat-row-metric"><strong>${escapeHtml(playerRating(player))}</strong><small>rAAting 3.0</small></span>
      <span class="stat-row-metric"><strong>${escapeHtml(String(player.maps || player.matches || 0))}</strong><small>Mapas</small></span>
    </a>
  `;
}

function tournamentTopTeamRow(row, index) {
  const tag = row.team?.missing ? "article" : "a";
  const href = row.team?.missing ? "" : ` href="#/teams/${escapeHtml(row.id)}"`;
  return `
    <${tag} class="tournament-stat-list-row"${href}>
      <span class="stat-rank">${index + 1}</span>
      ${teamLogo(row.id, "tournament-stat-logo")}
      <span class="stat-row-main">
        <strong>${escapeHtml(row.team?.name || displayTeamName(row.id))}</strong>
        <small>${escapeHtml(`${row.seriesWins}-${row.seriesLosses} séries · ${row.mapWins}-${row.mapLosses} mapas`)}</small>
      </span>
      <span class="stat-row-metric"><strong>${escapeHtml(tournamentTeamRatingLabel(row))}</strong><small>rAAting 3.0</small></span>
      <span class="stat-row-metric"><strong>${escapeHtml(signed(row.roundDiff))}</strong><small>Saldo</small></span>
    </${tag}>
  `;
}

function tournamentTeamStatRows(event, matches, standings, players = []) {
  const rows = new Map();
  const ensure = (teamId) => {
    if (!teamId) return null;
    if (!rows.has(teamId)) {
      rows.set(teamId, {
        id: teamId,
        team: tournamentTeamById(event, teamId),
        placement: "",
        standingIndex: Number.POSITIVE_INFINITY,
        seriesPlayed: 0,
        seriesWins: 0,
        seriesLosses: 0,
        mapWins: 0,
        mapLosses: 0,
        roundsFor: 0,
        roundsAgainst: 0,
        roundDiff: 0,
        playerRounds: 0,
        ratingTotal: 0,
        acsTotal: 0,
        adrTotal: 0,
        kprTotal: 0,
        kastTotal: 0,
      });
    }
    return rows.get(teamId);
  };

  (event.teams || []).forEach(ensure);
  standings.forEach((standing, index) => {
    const teamId = standing.id || standing.teamId;
    const row = ensure(teamId);
    if (!row) return;
    const placement = teamEventPlacementResult(teamId, event);
    row.placement = row.placement || (placement.placementStatus === "unknown" ? "" : placement.placementLabel) || standing.range || "";
    row.standingIndex = Math.min(row.standingIndex, index);
  });

  for (const series of matches || []) {
    [series.teamA?.id, series.teamB?.id].filter(Boolean).forEach((teamId) => tournamentAddSeriesTeamStats(ensure(teamId), series, teamId));
  }

  for (const player of players) {
    const row = ensure(player.teamId);
    if (!row) continue;
    const rounds = Number(player.rounds || 0);
    row.playerRounds += rounds;
    row.ratingTotal += Number(player.rating || 0) * rounds;
    row.acsTotal += Number(player.acs || 0) * rounds;
    row.adrTotal += Number(player.adr || 0) * rounds;
    row.kprTotal += Number(player.kpr || 0) * rounds;
    row.kastTotal += Number(player.kast || 0) * rounds;
  }

  return [...rows.values()]
    .map((row) => {
      const placement = row.placement || teamEventPlacementResult(row.id, event).placementLabel;
      return {
        ...row,
        placement: placement === "Colocação não informada" ? "" : placement,
        mapsPlayed: row.mapWins + row.mapLosses,
        rating: row.playerRounds ? row.ratingTotal / row.playerRounds : 0,
        acs: row.playerRounds ? row.acsTotal / row.playerRounds : 0,
        adr: row.playerRounds ? row.adrTotal / row.playerRounds : 0,
        kpr: row.playerRounds ? row.kprTotal / row.playerRounds : 0,
        kast: row.playerRounds ? row.kastTotal / row.playerRounds : 0,
      };
    })
    .sort(tournamentTeamStatSort);
}

function tournamentAddSeriesTeamStats(row, series, teamId) {
  if (!row) return;
  const score = seriesScoreForTeam(series, teamId);
  const won = series.winnerId === teamId || score.mapsFor > score.mapsAgainst;
  row.seriesPlayed += 1;
  row.seriesWins += won ? 1 : 0;
  row.seriesLosses += won ? 0 : 1;
  row.mapWins += score.mapsFor;
  row.mapLosses += score.mapsAgainst;
  row.roundsFor += score.roundsFor;
  row.roundsAgainst += score.roundsAgainst;
  row.roundDiff += score.roundsFor - score.roundsAgainst;
}

function tournamentTeamStatSort(a, b) {
  return b.seriesWins - a.seriesWins || b.mapWins - a.mapWins || b.roundDiff - a.roundDiff || a.seriesLosses - b.seriesLosses || a.standingIndex - b.standingIndex || String(a.team?.name || a.id).localeCompare(String(b.team?.name || b.id), "pt-BR");
}

function tournamentTeamRatingLabel(row) {
  return row.playerRounds ? fmt(row.rating) : "-";
}

function tournamentPlayerStatColumns() {
  return [
    { key: "player", label: "Player", value: (player) => player.nick || player.handle || "", type: "text", direction: "asc" },
    { key: "agents", label: "Agentes", value: (player) => player.agentList?.[0]?.name || player.agent || "", type: "text", direction: "asc" },
    { key: "rounds", label: "RND", value: (player) => Number(player.rounds || 0) },
    { key: "maps", label: "Mapas", value: (player) => Number(player.matches || player.maps || 0) },
    { key: "rating", label: "rAAting 3.0", value: (player) => Number(officialRatingValue(player) || 0) },
    { key: "acs", label: "ACS", value: (player) => Number(player.acs || 0) },
    { key: "kd", label: "K:D", value: (player) => Number(player.kd || 0) },
    { key: "kast", label: "KAST", value: (player) => Number(player.kast || 0) },
    { key: "adr", label: "ADR", value: (player) => Number(player.adr || 0) },
    { key: "swing", label: "Swing/R", value: (player) => Number(playerSwingPerRound(player) || 0) },
    { key: "fkFdDiff", label: "FK-FD", value: (player) => Number(player.firstKills || 0) - Number(player.firstDeaths || 0) },
    { key: "kpr", label: "KPR", value: (player) => Number(player.kpr || 0) },
    { key: "apr", label: "APR", value: (player) => Number(player.apr || 0) },
    { key: "fkpr", label: "FKPR", value: (player) => (player.rounds ? player.firstKills / player.rounds : 0) },
    { key: "fdpr", label: "FDPR", value: (player) => (player.rounds ? player.firstDeaths / player.rounds : 0) },
    { key: "hs", label: "HS%", value: (player) => Number(player.hs || 0) },
    { key: "kills", label: "K", value: (player) => Number(player.kills || 0) },
    { key: "deaths", label: "D", value: (player) => Number(player.deaths || 0) },
    { key: "assists", label: "A", value: (player) => Number(player.assists || 0) },
    { key: "firstKills", label: "FK", value: (player) => Number(player.firstKills || 0) },
  ];
}

function tournamentTeamStatColumns() {
  return [
    { key: "team", label: "Equipe", value: (row) => row.team?.name || displayTeamName(row.id), type: "text", direction: "asc" },
    { key: "seriesWins", label: "Séries", value: (row) => Number(row.seriesWins || 0) - Number(row.seriesLosses || 0) / 100 },
    { key: "mapWins", label: "Mapas", value: (row) => Number(row.mapWins || 0) - Number(row.mapLosses || 0) / 100 },
    { key: "roundsFor", label: "Rounds", value: (row) => Number(row.roundsFor || 0) - Number(row.roundsAgainst || 0) / 1000 },
    { key: "roundDiff", label: "+/-", value: (row) => Number(row.roundDiff || 0) },
    { key: "winrate", label: "Win%", value: (row) => (row.seriesPlayed ? pctValue(row.seriesWins, row.seriesPlayed) : 0) },
    { key: "rating", label: "rAAting 3.0", value: (row) => Number(row.rating || 0) },
    { key: "acs", label: "ACS", value: (row) => Number(row.acs || 0) },
    { key: "adr", label: "ADR", value: (row) => Number(row.adr || 0) },
  ];
}

function tournamentStatsSortState(table) {
  const fallback = table === "teams" ? { key: "seriesWins", direction: "desc" } : table === "agents" ? { key: "picks", direction: "desc" } : { key: "rating", direction: "desc" };
  return state.tournamentStatsSort?.[table] || fallback;
}

function tournamentSortedStatRows(table, rows, columns, fallbackSort) {
  const current = tournamentStatsSortState(table);
  const column = columns.find((item) => item.key === current.key) || columns[0];
  const direction = current.direction === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const valueA = column.value(a);
    const valueB = column.value(b);
    let comparison = 0;
    if (column.type === "text") comparison = String(valueA || "").localeCompare(String(valueB || ""), "pt-BR", { numeric: true });
    else comparison = Number(valueA || 0) - Number(valueB || 0);
    if (comparison !== 0) return comparison * direction;
    return fallbackSort(a, b);
  });
}

function tournamentStatsHeaderCell(table, column) {
  const current = tournamentStatsSortState(table);
  const active = current.key === column.key;
  const direction = active ? current.direction : "";
  const indicator = direction === "asc" ? "▲" : direction === "desc" ? "▼" : "";
  const className = column.type === "text" ? "" : "numeric";
  return `
    <th class="${escapeHtml(className)}" aria-sort="${direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}">
      <button type="button" class="tournament-stat-sort ${active ? "active" : ""}" data-tournament-stat-sort="${escapeHtml(`${table}:${column.key}`)}">
        <span>${escapeHtml(column.label)}</span><i aria-hidden="true">${escapeHtml(indicator)}</i>
      </button>
    </th>
  `;
}

function tournamentStatsTableExpanded(eventId, table) {
  return Boolean(state.tournamentStatsExpanded?.[`${eventId}:${table}`]);
}

function tournamentStatsExpandButton(table, totalRows, expanded) {
  if (totalRows <= 10) return "";
  return `<button type="button" class="tournament-stat-expand" data-tournament-stat-expand="${escapeHtml(table)}">${expanded ? "Mostrar menos" : `Exibir tudo (${totalRows})`}</button>`;
}

function bindTournamentStatsControls(eventId) {
  const root = document.querySelector(".tournament-stats-section");
  if (!root) return;
  const updateMapFilter = (target) => {
    const mapFilter = target.closest("[data-tournament-map-filter]");
    if (!mapFilter) return false;
    const scope = mapFilter.dataset.tournamentMapFilter;
    state.tournamentMapFilters = { ...state.tournamentMapFilters, [`${eventId}:${scope}`]: mapFilter.value || "all" };
    state.tournamentStatsExpanded = { ...state.tournamentStatsExpanded, [`${eventId}:${scope}`]: false };
    renderTournamentDetail(eventId);
    return true;
  };
  root.addEventListener("click", (event) => {
    const sortButton = event.target.closest("[data-tournament-stat-sort]");
    if (sortButton) {
      const [table, key] = String(sortButton.dataset.tournamentStatSort || "").split(":");
      const columns = table === "teams" ? tournamentTeamStatColumns() : table === "agents" ? tournamentAgentStatColumns() : table === "compositions" ? tournamentCompositionStatColumns() : tournamentPlayerStatColumns();
      const column = columns.find((item) => item.key === key);
      if (!column) return;
      const current = tournamentStatsSortState(table);
      const defaultDirection = column.direction || "desc";
      const direction = current.key === key ? (current.direction === "desc" ? "asc" : "desc") : defaultDirection;
      state.tournamentStatsSort = { ...state.tournamentStatsSort, [table]: { key, direction } };
      renderTournamentDetail(eventId);
      return;
    }

    const expandButton = event.target.closest("[data-tournament-stat-expand]");
    if (expandButton) {
      const table = expandButton.dataset.tournamentStatExpand;
      const key = `${eventId}:${table}`;
      state.tournamentStatsExpanded = { ...state.tournamentStatsExpanded, [key]: !state.tournamentStatsExpanded?.[key] };
      renderTournamentDetail(eventId);
      return;
    }

  });
  root.addEventListener("change", (event) => {
    updateMapFilter(event.target);
  });
}

function tournamentStatValueCell(display) {
  return `<td class="numeric tournament-stat-value">${escapeHtml(display)}</td>`;
}

function tournamentPlayerStatsTable(eventId, players) {
  const columns = tournamentPlayerStatColumns();
  const sortedRows = tournamentSortedStatRows("players", players, columns, tournamentPlayerStatSort);
  const expanded = tournamentStatsTableExpanded(eventId, "players");
  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, 10);
  return `
    <article class="tournament-stat-card tournament-stat-table-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>Tabela de jogadores</strong>
          <small>Ranking oficial por rAAting 3.0, mínimo ${RaaRatingCore.SAMPLE_MIN_ROUNDS} rounds</small>
        </span>
        ${tournamentStatsExpandButton("players", sortedRows.length, expanded)}
      </div>
      <div class="table-wrap tournament-stats-table-wrap">
        <table class="tournament-stats-table">
          <thead>
            <tr>
              ${columns.map((column) => tournamentStatsHeaderCell("players", column)).join("")}
            </tr>
          </thead>
          <tbody>
            ${visibleRows.length ? visibleRows.map(tournamentPlayerStatsRow).join("") : `<tr><td colspan="${columns.length}"><div class="empty-state compact-empty">Nenhuma estatística de jogador disponível.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function tournamentPlayerStatsRow(player) {
  const fkpr = player.rounds ? player.firstKills / player.rounds : 0;
  const fdpr = player.rounds ? player.firstDeaths / player.rounds : 0;
  const fkFdDiff = Number(player.firstKills || 0) - Number(player.firstDeaths || 0);
  return `
    <tr>
      <td>
        <a class="tournament-stats-player-cell" href="${playerHref(player)}">
          <span class="tournament-player-logo-pair">
            ${playerLogo(player.id, "tournament-stat-avatar")}
            ${player.teamId ? teamLogo(player.teamId, "tournament-player-team-logo") : ""}
          </span>
          <span><strong>${escapeHtml(player.nick || player.handle || "Jogador")}</strong><small>${escapeHtml(tournamentPlayerTeamLabel(player))}</small></span>
        </a>
      </td>
      <td>${agentStack(player)}</td>
      <td class="numeric">${escapeHtml(String(player.rounds || 0))}</td>
      <td class="numeric">${escapeHtml(String(player.matches || player.maps || 0))}</td>
      ${tournamentStatValueCell(playerRating(player))}
      ${tournamentStatValueCell(fmt(player.acs, 0))}
      ${tournamentStatValueCell(fmt(player.kd))}
      ${tournamentStatValueCell(pct(player.kast))}
      ${tournamentStatValueCell(fmt(player.adr, 0))}
      <td class="numeric ${escapeHtml(directionalTone(playerSwingPerRound(player)))}">${escapeHtml(formatMaybeSwing(player))}</td>
      <td class="numeric ${escapeHtml(signedTone(fkFdDiff))}">${escapeHtml(signed(fkFdDiff))}</td>
      ${tournamentStatValueCell(fmt(player.kpr))}
      ${tournamentStatValueCell(fmt(player.apr))}
      ${tournamentStatValueCell(fmt(fkpr))}
      ${tournamentStatValueCell(fmt(fdpr))}
      ${tournamentStatValueCell(pct(player.hs))}
      <td class="numeric">${escapeHtml(String(player.kills || 0))}</td>
      <td class="numeric">${escapeHtml(String(player.deaths || 0))}</td>
      <td class="numeric">${escapeHtml(String(player.assists || 0))}</td>
      <td class="numeric">${escapeHtml(String(player.firstKills || 0))}</td>
    </tr>
  `;
}

function tournamentPlayerTeamLabel(player) {
  const team = teamById(player.teamId);
  return team?.sourceTag || team?.tag || player.teamTag || player.teamId || "Sem equipe";
}

function tournamentTeamStatsTable(eventId, teams) {
  const columns = tournamentTeamStatColumns();
  const sortedRows = tournamentSortedStatRows("teams", teams, columns, tournamentTeamStatSort);
  const expanded = tournamentStatsTableExpanded(eventId, "teams");
  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, 10);
  return `
    <article class="tournament-stat-card tournament-stat-table-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>Tabela de equipes</strong>
          <small>Séries, mapas, rounds e médias dos jogadores</small>
        </span>
        ${tournamentStatsExpandButton("teams", sortedRows.length, expanded)}
      </div>
      <div class="table-wrap tournament-stats-table-wrap">
        <table class="tournament-stats-table tournament-team-stats-table">
          <thead>
            <tr>
              ${columns.map((column) => tournamentStatsHeaderCell("teams", column)).join("")}
            </tr>
          </thead>
          <tbody>
            ${visibleRows.length ? visibleRows.map(tournamentTeamStatsRow).join("") : `<tr><td colspan="${columns.length}"><div class="empty-state compact-empty">Nenhuma estatística de equipe disponível.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function tournamentTeamStatsRow(row) {
  const winRate = row.seriesPlayed ? pctValue(row.seriesWins, row.seriesPlayed) : 0;
  const tag = row.team?.missing ? "span" : "a";
  const href = row.team?.missing ? "" : ` href="#/teams/${escapeHtml(row.id)}"`;
  return `
    <tr>
      <td>
        <${tag} class="tournament-stats-team-cell"${href}>
          ${teamLogo(row.id, "tournament-stat-logo")}
          <span><strong>${escapeHtml(row.team?.name || displayTeamName(row.id))}</strong><small>${escapeHtml(row.placement || "Campanha")}</small></span>
        </${tag}>
      </td>
      <td class="numeric">${escapeHtml(`${row.seriesWins}-${row.seriesLosses}`)}</td>
      <td class="numeric">${escapeHtml(`${row.mapWins}-${row.mapLosses}`)}</td>
      <td class="numeric">${escapeHtml(`${row.roundsFor}-${row.roundsAgainst}`)}</td>
      <td class="numeric">${escapeHtml(signed(row.roundDiff))}</td>
      ${tournamentStatValueCell(pct(winRate))}
      ${tournamentStatValueCell(tournamentTeamRatingLabel(row))}
      ${tournamentStatValueCell(row.playerRounds ? fmt(row.acs, 0) : "-")}
      ${tournamentStatValueCell(row.playerRounds ? fmt(row.adr, 0) : "-")}
    </tr>
  `;
}

function tournamentAgentsSection(event, matches) {
  const selectedMap = tournamentSelectedMapFilter(event.id, "agents");
  const mapMatches = tournamentFilteredMapMatches(matches, selectedMap);
  const agents = tournamentAgentRows(mapMatches);
  const sortedTop = agents.slice().sort(tournamentAgentStatSort);
  return `
    <section class="tournament-section tournament-agents-section tournament-stats-section">
      <div class="tournament-section-head">
        <h2>Agentes</h2>
        <span>${agents.length} agentes · ${agents.reduce((sum, row) => sum + row.picks, 0)} picks</span>
      </div>
      <div class="tournament-stats-shell">
        ${tournamentMapFilterControl(event.id, matches, "agents")}
        <div class="tournament-stats-top-grid tournament-agents-top-grid">
          ${tournamentStatsTopList("Mais escolhidos", "Volume, pick rate e aproveitamento sem espelhamentos", sortedTop.slice(0, 8).map((row, index) => tournamentTopAgentRow(row, index, "volume")), "Nenhum agente registrado.")}
          ${tournamentStatsTopList("Melhor rAAting 3.0", "Agentes com maior rAAting 3.0 agregado por round", agents.slice().sort((a, b) => b.rating - a.rating || b.rounds - a.rounds || a.name.localeCompare(b.name, "pt-BR")).slice(0, 8).map((row, index) => tournamentTopAgentRow(row, index, "rating")), "Nenhum agente com estatísticas disponíveis.")}
        </div>
        <div class="tournament-stat-tables">
          ${tournamentAgentStatsTable(event.id, agents)}
        </div>
      </div>
    </section>
  `;
}

function tournamentAgentRows(mapMatches) {
  const rows = new Map();
  const pickOpportunities = (mapMatches || []).length * 2;

  for (const match of mapMatches || []) {
    for (const player of match.players || []) {
      const key = agentStatsKey(player);
      if (!rows.has(key)) rows.set(key, tournamentAgentEmptyRow(key, player));
      updateTournamentAgentRow(rows.get(key), player, match);
    }
  }

  return [...rows.values()].map((row) => tournamentFinalizeAgentRow(row, pickOpportunities)).sort(tournamentAgentStatSort);
}

function agentStatsKey(player = {}) {
  const agentId = String(player.agentId || "");
  return player.agentSlug || AGENT_API_SLUGS[agentId] || slugify(player.agent || agentId || "agent");
}

function agentStatsTeamId(match, player = {}) {
  if (player.teamId) return player.teamId;
  if (player.teamColor && player.teamColor === match?.teamA?.color) return match.teamA.id;
  if (player.teamColor && player.teamColor === match?.teamB?.color) return match.teamB.id;
  return "";
}

function isMirroredAgentPick(match, player) {
  const agentKey = agentStatsKey(player);
  const teamId = agentStatsTeamId(match, player);
  if (!agentKey || !teamId) return false;
  const opponentId = teamId === match?.teamA?.id ? match?.teamB?.id : teamId === match?.teamB?.id ? match?.teamA?.id : "";
  return (match?.players || []).some((other) => {
    if (other === player || agentStatsKey(other) !== agentKey) return false;
    const otherTeamId = agentStatsTeamId(match, other);
    return opponentId ? otherTeamId === opponentId : Boolean(otherTeamId && otherTeamId !== teamId);
  });
}

function agentStatsHasCompleteOpponentLineup(match, player) {
  const teamId = agentStatsTeamId(match, player);
  const opponentId = teamId === match?.teamA?.id ? match?.teamB?.id : teamId === match?.teamB?.id ? match?.teamA?.id : "";
  if (!opponentId) return false;
  return (match?.players || []).filter((other) => {
    const hasAgent = Boolean(other.agentSlug || other.agentId || other.agent);
    return hasAgent && agentStatsTeamId(match, other) === opponentId;
  }).length === 5;
}

function updateTournamentAgentRow(row, player, match) {
  const rounds = Number(player.rounds || match.rounds || 0);
  row.picks += 1;
  row.rounds += rounds;
  row.score += Number(player.score || 0);
  row.kills += Number(player.kills || 0);
  row.deaths += Number(player.deaths || 0);
  row.assists += Number(player.assists || 0);
  row.damage += Number(player.damage || 0);
  row.firstKills += Number(player.firstKills || 0);
  row.firstDeaths += Number(player.firstDeaths || 0);
  row.kastRounds += Number(player.kastRounds || 0);
  row.impactTotal += Number(player.impactTotal || 0);
  addRaatingAggregateFields(row, player);
  row.headshots += Number(player.headshots || 0);
  row.bodyshots += Number(player.bodyshots || 0);
  row.legshots += Number(player.legshots || 0);
  const teamId = agentStatsTeamId(match, player);
  const matchTeamIds = [match?.teamA?.id, match?.teamB?.id];
  const hasResolvedOutcome = Boolean(teamId && match?.winnerId && matchTeamIds.includes(teamId) && matchTeamIds.includes(match.winnerId));
  const won = match.winnerId === teamId;
  row.mapWins += hasResolvedOutcome && won ? 1 : 0;
  row.mapLosses += hasResolvedOutcome && !won ? 1 : 0;
  if (isMirroredAgentPick(match, player)) {
    row.mirroredPicks += 1;
  } else if (!hasResolvedOutcome || !agentStatsHasCompleteOpponentLineup(match, player)) {
    row.unknownMirrorPicks += 1;
  } else {
    row.nonMirroredWins += won ? 1 : 0;
    row.nonMirroredLosses += won ? 0 : 1;
  }
  if (player.id) row.players.add(player.id);
  if (player.teamId) row.teams.add(player.teamId);
  if (match.mapId || match.mapName) row.maps.add(match.mapId || normalizeNameKey(match.mapName));
}

function tournamentAgentEmptyRow(key, player) {
  return {
    id: key,
    slug: player.agentSlug || key,
    name: displayAgentName(player.agent, player.agentSlug || key),
    role: player.agentClass || "Classe",
    icon: player.agentIcon || "",
    picks: 0,
    rounds: 0,
    score: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    firstKills: 0,
    firstDeaths: 0,
    kastRounds: 0,
    impactTotal: 0,
    ...emptyRaatingAggregateFields(),
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
    mapWins: 0,
    mapLosses: 0,
    mirroredPicks: 0,
    unknownMirrorPicks: 0,
    nonMirroredWins: 0,
    nonMirroredLosses: 0,
    players: new Set(),
    teams: new Set(),
    maps: new Set(),
  };
}

function tournamentFinalizeAgentRow(row, pickOpportunities) {
  row.acs = row.rounds ? row.score / row.rounds : 0;
  row.adr = row.rounds ? row.damage / row.rounds : 0;
  row.kpr = row.rounds ? row.kills / row.rounds : 0;
  row.dpr = row.rounds ? row.deaths / row.rounds : 0;
  row.apr = row.rounds ? row.assists / row.rounds : 0;
  row.kd = row.deaths ? row.kills / row.deaths : row.kills;
  row.kastFrac = row.rounds ? row.kastRounds / row.rounds : 0;
  row.kast = row.kastFrac * 100;
  row.impactRound = row.rounds ? row.impactTotal / row.rounds : 0;
  row.impactRoundLegacy = row.rounds ? Number(row.impactTotalLegacy || 0) / row.rounds : 0;
  row.kastLegacyFrac = row.rounds ? Number(row.kastLegacyRounds || 0) / row.rounds : row.kastFrac;
  row.kastLegacy = row.kastLegacyFrac * 100;
  const shots = row.headshots + row.bodyshots + row.legshots;
  row.hs = shots ? (row.headshots / shots) * 100 : 0;
  applyRaatingFields(row);
  row.pickOpportunities = Number(pickOpportunities || 0);
  row.pickRate = pctValue(row.picks, row.pickOpportunities);
  row.nonMirroredPicks = row.nonMirroredWins + row.nonMirroredLosses;
  row.winRateNM = pctValue(row.nonMirroredWins, row.nonMirroredPicks);
  row.winRate = row.winRateNM;
  row.uniquePlayers = row.players.size;
  row.uniqueTeams = row.teams.size;
  row.uniqueMaps = row.maps.size;
  return row;
}

function tournamentAgentStatSort(a, b) {
  return b.picks - a.picks || b.rounds - a.rounds || b.rating - a.rating || a.name.localeCompare(b.name, "pt-BR");
}

function tournamentTopAgentRow(row, index, mode = "volume") {
  const metrics = tournamentTopAgentMetrics(row, mode);
  const detail = mode === "rating"
    ? `${row.picks} pick${row.picks === 1 ? "" : "s"} · ${row.rounds} rounds · ${row.nonMirroredWins}-${row.nonMirroredLosses} mapas NM`
    : `${row.uniqueTeams} equipe${row.uniqueTeams === 1 ? "" : "s"} · ${row.uniquePlayers} jogador${row.uniquePlayers === 1 ? "" : "es"} · ${row.rounds} rounds`;
  return `
    <article class="tournament-stat-list-row tournament-agent-highlight-row">
      <span class="stat-rank">${index + 1}</span>
      <div class="tournament-agent-highlight-main">
        ${tournamentAgentLogo(row, "tournament-stat-logo")}
        <span class="stat-row-main">
          <strong>${escapeHtml(row.name)}</strong>
          ${rolePill(row.role, "compact")}
          <small>${escapeHtml(detail)}</small>
        </span>
      </div>
      <div class="tournament-agent-highlight-metrics">
        ${metrics.map(([label, value]) => `<span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></span>`).join("")}
      </div>
    </article>
  `;
}

function tournamentTopAgentMetrics(row, mode) {
  if (mode === "rating") {
    return [
      ["rAAting 3.0", fmt(row.rating)],
      ["ACS", fmt(row.acs, 0)],
      ["K:D", fmt(row.kd)],
      ["ADR", fmt(row.adr, 0)],
    ];
  }
  return [
    ["Picks", String(row.picks)],
    ["Pick%", pct(row.pickRate)],
    ["Win% (NM)", tournamentAgentNonMirroredWinRate(row)],
    ["Mapas NM", `${row.nonMirroredWins}-${row.nonMirroredLosses}`],
  ];
}

function tournamentAgentNonMirroredWinRate(row) {
  return row.nonMirroredPicks ? pct(row.winRateNM) : "-";
}

function tournamentAgentStatsTable(eventId, agents, columns = tournamentAgentStatColumns()) {
  const sortedRows = tournamentSortedStatRows("agents", agents, columns, tournamentAgentStatSort);
  const expanded = tournamentStatsTableExpanded(eventId, "agents");
  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, 10);
  return `
    <article class="tournament-stat-card tournament-stat-table-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>Tabela de agentes</strong>
          <small>Uso, aproveitamento sem mapas espelhados e desempenho agregado</small>
        </span>
        ${tournamentStatsExpandButton("agents", sortedRows.length, expanded)}
      </div>
      <div class="table-wrap tournament-stats-table-wrap">
        <table class="tournament-stats-table tournament-agent-stats-table">
          <thead>
            <tr>
              ${columns.map((column) => tournamentStatsHeaderCell("agents", column)).join("")}
            </tr>
          </thead>
          <tbody>
            ${visibleRows.length ? visibleRows.map((row) => tournamentAgentStatsRow(row, columns)).join("") : `<tr><td colspan="${columns.length}"><div class="empty-state compact-empty">Nenhum agente com estatísticas disponíveis.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function tournamentAgentStatColumns() {
  return [
    { key: "agent", label: "Agente", value: (row) => row.name || row.slug || "", type: "text", direction: "asc" },
    { key: "picks", label: "Picks", value: (row) => Number(row.picks || 0) },
    { key: "pickRate", label: "Pick%", value: (row) => Number(row.pickRate || 0) },
    { key: "winRate", label: "Win% (NM)", value: (row) => Number(row.winRateNM || 0) },
    { key: "rounds", label: "RND", value: (row) => Number(row.rounds || 0) },
    { key: "uniquePlayers", label: "Jogadores", value: (row) => Number(row.uniquePlayers || 0) },
    { key: "uniqueTeams", label: "Equipes", value: (row) => Number(row.uniqueTeams || 0) },
    { key: "uniqueMaps", label: "Mapas", value: (row) => Number(row.uniqueMaps || 0) },
    { key: "rating", label: "rAAting 3.0", value: (row) => Number(row.rating || 0) },
    { key: "acs", label: "ACS", value: (row) => Number(row.acs || 0) },
    { key: "kd", label: "K:D", value: (row) => Number(row.kd || 0) },
    { key: "kast", label: "KAST", value: (row) => Number(row.kast || 0) },
    { key: "adr", label: "ADR", value: (row) => Number(row.adr || 0) },
    { key: "kpr", label: "KPR", value: (row) => Number(row.kpr || 0) },
    { key: "apr", label: "APR", value: (row) => Number(row.apr || 0) },
    { key: "fkpr", label: "FKPR", value: (row) => (row.rounds ? row.firstKills / row.rounds : 0) },
    { key: "fdpr", label: "FDPR", value: (row) => (row.rounds ? row.firstDeaths / row.rounds : 0) },
    { key: "hs", label: "HS%", value: (row) => Number(row.hs || 0) },
    { key: "kills", label: "K", value: (row) => Number(row.kills || 0) },
    { key: "deaths", label: "D", value: (row) => Number(row.deaths || 0) },
    { key: "assists", label: "A", value: (row) => Number(row.assists || 0) },
    { key: "firstKills", label: "FK", value: (row) => Number(row.firstKills || 0) },
    { key: "firstDeaths", label: "FD", value: (row) => Number(row.firstDeaths || 0) },
  ];
}

function tournamentAgentStatsRow(row, columns = tournamentAgentStatColumns()) {
  return `
    <tr>
      ${columns.map((column) => tournamentAgentStatCell(row, column)).join("")}
    </tr>
  `;
}

function tournamentAgentStatCell(row, column) {
  const key = column.key;
  if (key === "agent") {
    return `
      <td>
        <span class="tournament-agent-cell">
          ${tournamentAgentLogo(row, "tournament-agent-table-logo")}
          <span><strong>${escapeHtml(row.name)}</strong>${rolePill(row.role, "compact")}</span>
        </span>
      </td>
    `;
  }
  if (key === "picks") return `<td class="numeric">${escapeHtml(String(row.picks || 0))}</td>`;
  if (key === "pickRate") return tournamentStatValueCell(pct(row.pickRate));
  if (key === "winRate") return tournamentStatValueCell(tournamentAgentNonMirroredWinRate(row));
  if (key === "rounds") return `<td class="numeric">${escapeHtml(String(row.rounds || 0))}</td>`;
  if (key === "uniquePlayers") return `<td class="numeric">${escapeHtml(String(row.uniquePlayers || 0))}</td>`;
  if (key === "uniqueTeams") return `<td class="numeric">${escapeHtml(String(row.uniqueTeams || 0))}</td>`;
  if (key === "uniqueMaps") return `<td class="numeric">${escapeHtml(String(row.uniqueMaps || 0))}</td>`;
  if (key === "rating") return tournamentStatValueCell(fmt(row.rating));
  if (key === "acs") return tournamentStatValueCell(fmt(row.acs, 0));
  if (key === "kd") return tournamentStatValueCell(fmt(row.kd));
  if (key === "kast") return tournamentStatValueCell(pct(row.kast));
  if (key === "adr") return tournamentStatValueCell(fmt(row.adr, 0));
  if (key === "kpr") return tournamentStatValueCell(fmt(row.kpr));
  if (key === "apr") return tournamentStatValueCell(fmt(row.apr));
  if (key === "fkpr") return tournamentStatValueCell(fmt(row.rounds ? row.firstKills / row.rounds : 0));
  if (key === "fdpr") return tournamentStatValueCell(fmt(row.rounds ? row.firstDeaths / row.rounds : 0));
  if (key === "hs") return tournamentStatValueCell(pct(row.hs));
  if (key === "kills") return `<td class="numeric">${escapeHtml(String(row.kills || 0))}</td>`;
  if (key === "deaths") return `<td class="numeric">${escapeHtml(String(row.deaths || 0))}</td>`;
  if (key === "assists") return `<td class="numeric">${escapeHtml(String(row.assists || 0))}</td>`;
  if (key === "firstKills") return `<td class="numeric">${escapeHtml(String(row.firstKills || 0))}</td>`;
  if (key === "firstDeaths") return `<td class="numeric">${escapeHtml(String(row.firstDeaths || 0))}</td>`;
  const value = column.value ? column.value(row) : "";
  if (column.type === "text") return `<td>${escapeHtml(String(value || ""))}</td>`;
  return tournamentStatValueCell(fmt(Number(value || 0)));
}

function tournamentAgentLogo(row, extra = "") {
  const label = displayAgentName(row.name, row.slug).slice(0, 2).toUpperCase();
  const src = assetPath(row.icon || "");
  return `<span class="tournament-agent-logo ${escapeHtml(extra)}">${src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(row.name || label)}" loading="lazy" onerror="this.remove()" />` : `<span>${escapeHtml(label)}</span>`}</span>`;
}

function tournamentCompositionsSection(event, matches) {
  const selectedMap = tournamentSelectedMapFilter(event.id, "compositions");
  const mapMatches = tournamentFilteredMapMatches(matches, selectedMap);
  const compositions = tournamentCompositionRows(mapMatches);
  const sortedTop = compositions.slice().sort(tournamentCompositionStatSort);
  return `
    <section class="tournament-section tournament-compositions-section tournament-stats-section">
      <div class="tournament-section-head">
        <h2>Composições</h2>
        <span>${compositions.length} comps · ${compositions.reduce((sum, row) => sum + row.picks, 0)} usos</span>
      </div>
      <div class="tournament-stats-shell">
        ${tournamentMapFilterControl(event.id, matches, "compositions")}
        <div class="tournament-stats-top-grid tournament-compositions-top-grid">
          ${tournamentStatsTopList("Mais usadas", "Composições por lado jogado em cada mapa", sortedTop.slice(0, 8).map(tournamentTopCompositionRow), "Nenhuma composição registrada.")}
          ${tournamentStatsTopList("Melhor win rate", "Aproveitamento por uso da composição", compositions.slice().sort((a, b) => b.winRate - a.winRate || b.picks - a.picks || b.roundDiff - a.roundDiff).slice(0, 8).map(tournamentTopCompositionRow), "Nenhuma composição com estatísticas disponíveis.")}
        </div>
        <div class="tournament-stat-tables">
          ${tournamentCompositionStatsTable(event.id, compositions)}
        </div>
      </div>
    </section>
  `;
}

function tournamentCompositionRows(mapMatches) {
  const rows = new Map();
  let totalPicks = 0;
  for (const match of mapMatches || []) {
    for (const side of [match.teamA, match.teamB]) {
      const teamId = side?.id;
      if (!teamId) continue;
      const players = (match.players || []).filter((player) => player.teamId === teamId);
      if (!players.length) continue;
      const agents = players.map(tournamentCompositionAgentFromPlayer).filter(Boolean).sort(tournamentCompositionAgentSort);
      if (!agents.length) continue;
      const key = agents.map((agent) => agent.slug || agent.name).sort().join("|");
      if (!rows.has(key)) rows.set(key, tournamentCompositionEmptyRow(key, agents));
      const row = rows.get(key);
      const roundsFor = scoreForTeamInMatch(match, teamId);
      const roundsAgainst = Number(match.teamA?.id === teamId ? match.teamB?.score : match.teamA?.score) || 0;
      totalPicks += 1;
      row.picks += 1;
      row.mapWins += match.winnerId === teamId ? 1 : 0;
      row.mapLosses += match.winnerId === teamId ? 0 : 1;
      row.rounds += Number(match.rounds || roundsFor + roundsAgainst || 0);
      row.roundsFor += roundsFor;
      row.roundsAgainst += roundsAgainst;
      row.roundDiff += roundsFor - roundsAgainst;
      if (teamId) row.teams.add(teamId);
      if (match.mapId || match.mapName) row.maps.add(match.mapId || normalizeNameKey(match.mapName));

      for (const player of players) tournamentAddPlayerStatsToComposition(row, player);
    }
  }
  return [...rows.values()].map((row) => tournamentFinalizeCompositionRow(row, totalPicks)).sort(tournamentCompositionStatSort);
}

function tournamentCompositionAgentFromPlayer(player) {
  const slug = player.agentSlug || slugify(player.agent || "");
  const name = displayAgentName(player.agent, slug);
  if (!slug && !name) return null;
  return {
    slug: slug || normalizeNameKey(name),
    name,
    role: player.agentClass || "",
    icon: player.agentIcon || "",
  };
}

function tournamentCompositionAgentSort(a, b) {
  return roleSortOrder(a.role) - roleSortOrder(b.role) || String(a.name || a.slug).localeCompare(String(b.name || b.slug), "pt-BR");
}

function roleSortOrder(role) {
  const order = { duelista: 1, iniciador: 2, controlador: 3, sentinela: 4 };
  return order[normalizeRoleKey(role)] || 9;
}

function tournamentCompositionEmptyRow(key, agents) {
  return {
    id: key,
    agents,
    picks: 0,
    rounds: 0,
    roundsFor: 0,
    roundsAgainst: 0,
    roundDiff: 0,
    mapWins: 0,
    mapLosses: 0,
    playerRounds: 0,
    score: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    firstKills: 0,
    firstDeaths: 0,
    kastRounds: 0,
    impactTotal: 0,
    ...emptyRaatingAggregateFields(),
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
    teams: new Set(),
    maps: new Set(),
  };
}

function tournamentAddPlayerStatsToComposition(row, player) {
  const rounds = Number(player.rounds || 0);
  row.playerRounds += rounds;
  row.score += Number(player.score || 0);
  row.kills += Number(player.kills || 0);
  row.deaths += Number(player.deaths || 0);
  row.assists += Number(player.assists || 0);
  row.damage += Number(player.damage || 0);
  row.firstKills += Number(player.firstKills || 0);
  row.firstDeaths += Number(player.firstDeaths || 0);
  row.kastRounds += Number(player.kastRounds || 0);
  row.impactTotal += Number(player.impactTotal || 0);
  addRaatingAggregateFields(row, player);
  row.headshots += Number(player.headshots || 0);
  row.bodyshots += Number(player.bodyshots || 0);
  row.legshots += Number(player.legshots || 0);
}

function tournamentFinalizeCompositionRow(row, totalPicks) {
  row.pickRate = totalPicks ? pctValue(row.picks, totalPicks) : 0;
  row.winRate = row.picks ? pctValue(row.mapWins, row.picks) : 0;
  row.uniqueTeams = row.teams.size;
  row.uniqueMaps = row.maps.size;
  row.acs = row.playerRounds ? row.score / row.playerRounds : 0;
  row.adr = row.playerRounds ? row.damage / row.playerRounds : 0;
  row.kpr = row.playerRounds ? row.kills / row.playerRounds : 0;
  row.dpr = row.playerRounds ? row.deaths / row.playerRounds : 0;
  row.apr = row.playerRounds ? row.assists / row.playerRounds : 0;
  row.kd = row.deaths ? row.kills / row.deaths : row.kills;
  row.kastFrac = row.playerRounds ? row.kastRounds / row.playerRounds : 0;
  row.kast = row.kastFrac * 100;
  row.impactRound = row.playerRounds ? row.impactTotal / row.playerRounds : 0;
  row.impactRoundLegacy = row.playerRounds ? Number(row.impactTotalLegacy || 0) / row.playerRounds : 0;
  row.kastLegacyFrac = row.playerRounds ? Number(row.kastLegacyRounds || 0) / row.playerRounds : row.kastFrac;
  row.kastLegacy = row.kastLegacyFrac * 100;
  const shots = row.headshots + row.bodyshots + row.legshots;
  row.hs = shots ? (row.headshots / shots) * 100 : 0;
  applyRaatingFields(row);
  return row;
}

function tournamentCompositionStatSort(a, b) {
  return b.picks - a.picks || b.winRate - a.winRate || b.roundDiff - a.roundDiff || tournamentCompositionLabel(a).localeCompare(tournamentCompositionLabel(b), "pt-BR");
}

function tournamentCompositionLabel(row) {
  return (row.agents || []).map((agent) => agent.name || agent.slug).join(" / ");
}

function tournamentTopCompositionRow(row, index) {
  return `
    <article class="tournament-stat-list-row tournament-composition-top-row">
      <span class="stat-rank">${index + 1}</span>
      ${tournamentCompositionAgentStack(row.agents)}
      <span class="stat-row-main">
        <strong>${escapeHtml(`${row.picks} uso${row.picks === 1 ? "" : "s"}`)}</strong>
        <small>${escapeHtml(`${row.mapWins}-${row.mapLosses} mapas · ${signed(row.roundDiff)} saldo`)}</small>
      </span>
      <span class="stat-row-metric"><strong>${escapeHtml(pct(row.winRate))}</strong><small>Win%</small></span>
      <span class="stat-row-metric"><strong>${escapeHtml(fmt(row.rating))}</strong><small>rAAting 3.0</small></span>
    </article>
  `;
}

function tournamentCompositionStatsTable(eventId, compositions) {
  const columns = tournamentCompositionStatColumns();
  const sortedRows = tournamentSortedStatRows("compositions", compositions, columns, tournamentCompositionStatSort);
  const expanded = tournamentStatsTableExpanded(eventId, "compositions");
  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, 10);
  return `
    <article class="tournament-stat-card tournament-stat-table-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>Tabela de composições</strong>
          <small>Agentes, uso, aproveitamento e desempenho por composição</small>
        </span>
        ${tournamentStatsExpandButton("compositions", sortedRows.length, expanded)}
      </div>
      <div class="table-wrap tournament-stats-table-wrap">
        <table class="tournament-stats-table tournament-composition-stats-table">
          <thead>
            <tr>
              ${columns.map((column) => tournamentStatsHeaderCell("compositions", column)).join("")}
            </tr>
          </thead>
          <tbody>
            ${visibleRows.length ? visibleRows.map(tournamentCompositionStatsRow).join("") : `<tr><td colspan="${columns.length}"><div class="empty-state compact-empty">Nenhuma composição com estatísticas disponíveis.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function tournamentCompositionStatColumns() {
  return [
    { key: "composition", label: "Composição", value: tournamentCompositionLabel, type: "text", direction: "asc" },
    { key: "picks", label: "Usos", value: (row) => Number(row.picks || 0) },
    { key: "pickRate", label: "Pick%", value: (row) => Number(row.pickRate || 0) },
    { key: "winRate", label: "Win%", value: (row) => Number(row.winRate || 0) },
    { key: "maps", label: "Mapas", value: (row) => Number(row.mapWins || 0) - Number(row.mapLosses || 0) / 100 },
    { key: "rounds", label: "RND", value: (row) => Number(row.rounds || 0) },
    { key: "roundDiff", label: "+/-", value: (row) => Number(row.roundDiff || 0) },
    { key: "uniqueTeams", label: "Equipes", value: (row) => Number(row.uniqueTeams || 0) },
    { key: "uniqueMaps", label: "Mapas únicos", value: (row) => Number(row.uniqueMaps || 0) },
    { key: "rating", label: "rAAting 3.0", value: (row) => Number(row.rating || 0) },
    { key: "acs", label: "ACS", value: (row) => Number(row.acs || 0) },
    { key: "kd", label: "K:D", value: (row) => Number(row.kd || 0) },
    { key: "kast", label: "KAST", value: (row) => Number(row.kast || 0) },
    { key: "adr", label: "ADR", value: (row) => Number(row.adr || 0) },
    { key: "kpr", label: "KPR", value: (row) => Number(row.kpr || 0) },
    { key: "apr", label: "APR", value: (row) => Number(row.apr || 0) },
    { key: "fkpr", label: "FKPR", value: (row) => (row.playerRounds ? row.firstKills / row.playerRounds : 0) },
    { key: "fdpr", label: "FDPR", value: (row) => (row.playerRounds ? row.firstDeaths / row.playerRounds : 0) },
    { key: "hs", label: "HS%", value: (row) => Number(row.hs || 0) },
  ];
}

function tournamentCompositionStatsRow(row) {
  const fkpr = row.playerRounds ? row.firstKills / row.playerRounds : 0;
  const fdpr = row.playerRounds ? row.firstDeaths / row.playerRounds : 0;
  return `
    <tr>
      <td>
        <span class="tournament-composition-cell">
          ${tournamentCompositionAgentStack(row.agents)}
          <small>${escapeHtml(tournamentCompositionLabel(row))}</small>
        </span>
      </td>
      <td class="numeric">${escapeHtml(String(row.picks || 0))}</td>
      ${tournamentStatValueCell(pct(row.pickRate))}
      ${tournamentStatValueCell(pct(row.winRate))}
      <td class="numeric">${escapeHtml(`${row.mapWins}-${row.mapLosses}`)}</td>
      <td class="numeric">${escapeHtml(String(row.rounds || 0))}</td>
      <td class="numeric">${escapeHtml(signed(row.roundDiff))}</td>
      <td class="numeric">${escapeHtml(String(row.uniqueTeams || 0))}</td>
      <td class="numeric">${escapeHtml(String(row.uniqueMaps || 0))}</td>
      ${tournamentStatValueCell(fmt(row.rating))}
      ${tournamentStatValueCell(fmt(row.acs, 0))}
      ${tournamentStatValueCell(fmt(row.kd))}
      ${tournamentStatValueCell(pct(row.kast))}
      ${tournamentStatValueCell(fmt(row.adr, 0))}
      ${tournamentStatValueCell(fmt(row.kpr))}
      ${tournamentStatValueCell(fmt(row.apr))}
      ${tournamentStatValueCell(fmt(fkpr))}
      ${tournamentStatValueCell(fmt(fdpr))}
      ${tournamentStatValueCell(pct(row.hs))}
    </tr>
  `;
}

function tournamentCompositionAgentStack(agents = []) {
  return `<span class="tournament-composition-stack">${agents.map((agent) => tournamentAgentLogo(agent, "tournament-composition-agent")).join("")}</span>`;
}

function tournamentStandingsRows(event, matches) {
  if (event.placements?.length) return tournamentOfficialPlacements(event);
  const rows = eventStandings(matches);
  const seen = new Set(rows.map((row) => row.id));
  for (const teamId of event.teams) {
    if (!seen.has(teamId)) rows.push({ id: teamId, seriesWins: 0, seriesLosses: 0, mapWins: 0, mapLosses: 0, roundDiff: 0 });
  }
  return rows;
}

function tournamentFormatLabel(event, matches) {
  if (typeof event.format === "string") return event.format;
  if (event.format?.summary) return event.format.summary;
  return dominantSeriesFormat(matches);
}

function dominantSeriesFormat(matches) {
  if (!matches.length) return "A definir";
  const counts = matches.reduce((map, series) => {
    const label = series.label || seriesFormatLabel(series.maps);
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map());
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "A definir";
}

function renderTeamDetail(id) {
  const team = teamById(id);
  if (!team) return renderNotFound("Equipe");
  const activeTab = TEAM_TAB_KEYS.includes(route().tab) ? route().tab : "ranking";
  const matches = matchSeriesForTeam(id);
  const currentLineup = team.currentLineup || [];
  const observedPlayers = state.db.players
    .filter((player) => player.observedTeamId === id && player.matches > 0)
    .sort((a, b) => Number(officialRatingValue(playerStatsForTeam(b, id)) || 0) - Number(officialRatingValue(playerStatsForTeam(a, id)) || 0));
  const historicalPlayers = teamHistoricalPlayers(team).filter((player) => !currentLineup.some((entry) => entry.playerId === player.id));
  const tournaments = visibleTournaments().filter((event) => event.teams.includes(team.id));
  const trophies = teamTrophyAchievements(team);
  const tabSlide = panelSlideSnapshot("team-tabs", {
    selector: ".team-tab-panel",
    scope: team.id,
    key: activeTab,
    order: TEAM_TAB_KEYS,
  });
  Shell(`
    <section class="team-page" ${teamAccentStyle(team)}>
      <div class="team-hero">
        <div class="team-hero-main">
          <div class="team-identity">
            ${teamProfileLogo(team)}
            <div class="team-title-block">
              <span class="eyebrow">${escapeHtml(team.sourceTag || team.tag || team.id)}</span>
              <h1>${escapeHtml(team.name)}</h1>
              <div class="team-meta-row">
                ${teamStateBadge(team)}
                <span class="team-meta-text">${escapeHtml(team.profile?.orgTag || team.tag || team.sourceTag || team.id)}</span>
                <span class="team-meta-text">${escapeHtml(teamInstitutionLabel(team))}</span>
              </div>
            </div>
          </div>
        </div>
        ${teamHeroCover(team, currentLineup, observedPlayers)}
        <div class="team-quick-panel">
          ${teamRankHero(team)}
          <div class="team-socials">${socialButtons(team)}</div>
        </div>
      </div>
      ${teamSummaryTrophyPanel(trophies)}
      <nav class="team-tabs" aria-label="Abas da equipe">
        ${teamTabLink(team, "ranking", "Ranking", activeTab)}
        ${teamTabLink(team, "roster", "Elenco", activeTab)}
        ${teamTabLink(team, "matches", "Partidas", activeTab)}
        ${teamTabLink(team, "tournaments", "Campeonatos", activeTab)}
        ${teamTabLink(team, "stats", "Stats", activeTab)}
      </nav>
      <section class="team-tab-panel">
        ${renderTeamTab(activeTab, team, { matches, currentLineup, observedPlayers, historicalPlayers, tournaments })}
      </section>
    </section>
  `);
  playPanelSlide(tabSlide);
}

const TEAM_TAB_KEYS = ["ranking", "roster", "matches", "tournaments", "stats"];

function renderTeamTab(activeTab, team, context) {
  const renderers = {
    ranking: () => teamRankingTab(team),
    roster: () => teamRosterTab(team, context.currentLineup, context.historicalPlayers, context.observedPlayers),
    matches: () => teamMatchesTab(context.matches, team),
    tournaments: () => teamTournamentsTab(context.tournaments, team),
    stats: () => teamStatsTab(team, context.currentLineup, context.observedPlayers),
  };
  return (renderers[activeTab] || renderers.ranking)();
}

function teamRankHero(team) {
  const rank = teamCanonicalRankLabel(team);
  return `
    <div class="team-rank-box">
      <span>Ranking atual</span>
      <strong>${escapeHtml(rank)}</strong>
      <small>Nota ${escapeHtml(fmt(team.rankingScore ?? team.points, 1))}</small>
    </div>
  `;
}

function teamHeroCover(team, currentLineup, observedPlayers = []) {
  const lineupPlayers = currentLineup.map((entry) => ({ entry, player: entry.playerId ? playerById(entry.playerId) : null }));
  const fallbackPlayers = observedPlayers.filter((player) => !lineupPlayers.some((row) => row.player?.id === player.id)).map((player) => ({ entry: { playerId: player.id, name: player.nick }, player }));
  const rows = lineupPlayers.length ? teamHeroCoverSelection(lineupPlayers, team) : fallbackPlayers.slice(0, 5);
  if (!rows.length) return "";
  return `
    <div class="team-hero-cover" aria-label="${escapeHtml(`Elenco ${team.name}`)}">
      ${rows.map(teamHeroCoverPlayer).join("")}
    </div>
  `;
}

function teamHeroCoverSelection(lineupPlayers, team) {
  if (lineupPlayers.length <= 5) return lineupPlayers;
  const teamMatches = (row) => Number((row.player ? playerStatsForTeam(row.player, team.id).matches : 0) || 0);
  const chosen = new Set(
    [...lineupPlayers]
      .sort((a, b) => teamMatches(b) - teamMatches(a) || Number(Boolean(b.player?.photo)) - Number(Boolean(a.player?.photo)))
      .slice(0, 5),
  );
  return lineupPlayers.filter((row) => chosen.has(row));
}

function teamHeroCoverPlayer({ entry, player }) {
  const name = player?.nick || entry?.name || "Jogador";
  const body = `
    ${player ? playerLogo(player.id, "team-hero-cover-photo") : logo((name || "J").slice(0, 2).toUpperCase(), ["#181715", "#6c665d"], "round team-hero-cover-photo")}
    <span>${escapeHtml(name)}</span>
  `;
  return player ? `<a class="team-hero-cover-player" href="${playerHref(player)}">${body}</a>` : `<span class="team-hero-cover-player">${body}</span>`;
}

function teamSummaryTrophyPanel(trophies) {
  const hall = trophyHallFromRows(trophies);
  if (!hall) return "";
  return `
    <section class="team-trophy-panel team-trophy-full">
      <div class="section-head"><h2>Hall de troféus</h2></div>
      ${hall}
    </section>
  `;
}

function teamTabLink(team, tab, label, activeTab) {
  return `<a class="team-tab ${activeTab === tab ? "active" : ""}" href="#/teams/${team.id}/${tab}">${escapeHtml(label)}</a>`;
}

function teamRankingTab(team) {
  const history = teamRankingCanonicalHistory(team);
  return `
    <section class="data-panel team-ranking-main">
      <div class="section-head"><h2>Histórico do ranking</h2><p>Evolução semanal considerando apenas equipes válidas no ranking canônico.</p></div>
      ${history.length ? teamRankingChart(history) : `<div class="empty-state">Sem histórico válido suficiente para calcular ranking.</div>`}
    </section>
    <section class="data-panel team-ranking-explainer">
      ${rankingExplanationPanel(team)}
    </section>
  `;
}

function teamRankingCanonicalHistory(team) {
  return teamRankingHistory(team)
    .filter((row) => Number.isFinite(Number(row.rank)) && Number(row.rank) > 0)
    .sort((a, b) => dateValue(b.date) - dateValue(a.date));
}

function teamRankingChart(history) {
  const rows = history
    .slice()
    .sort((a, b) => dateValue(a.date) - dateValue(b.date))
    .filter((row) => Number.isFinite(Number(row.rank)) && Number(row.rank) > 0);
  if (!rows.length) return "";
  const width = 760;
  const height = 286;
  const pad = { top: 22, right: 22, bottom: 42, left: 46 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const minDate = dateValue(rows[0].date);
  const maxDate = dateValue(rows[rows.length - 1].date);
  const span = Math.max(1, maxDate - minDate);
  const maxRank = Math.max(5, ...rows.map((row) => Number(row.rank)));
  const x = (date) => pad.left + ((dateValue(date) - minDate) / span) * plotWidth;
  const y = (rank) => pad.top + ((Number(rank) - 1) / Math.max(1, maxRank - 1)) * plotHeight;
  const points = rows.map((row) => `${fmt(x(row.date), 2)},${fmt(y(row.rank), 2)}`).join(" ");
  const areaPath = `M ${points.split(" ")[0]} L ${points.replaceAll(" ", " L ")} L ${fmt(x(rows[rows.length - 1].date), 2)},${pad.top + plotHeight} L ${fmt(x(rows[0].date), 2)},${pad.top + plotHeight} Z`;
  const yTicks = [...new Set([1, Math.ceil(maxRank / 2), maxRank])];
  const xTicks = chartDateTicks(rows);
  const latest = rows[rows.length - 1];
  const best = Math.min(...rows.map((row) => Number(row.rank)));
  const pointHotspots = rows
    .map((row) => {
      const left = (x(row.date) / width) * 100;
      const top = (y(row.rank) / height) * 100;
      const detail = [`Nota ${row.points === "" ? "-" : fmt(row.points, 1)}`, row.note || ""].filter(Boolean).join(" - ");
      return `
        <span class="ranking-chart-hotspot" style="--x:${fmt(left, 2)};--y:${fmt(top, 2)}" tabindex="0" aria-label="${escapeHtml(`${formatDate(row.date)} ${rankingHistoryRankLabel(row.rank)}`)}">
          <span class="ranking-chart-tooltip">
            <strong>${escapeHtml(rankingHistoryRankLabel(row.rank))}</strong>
            <span>${escapeHtml(formatDate(row.date))}</span>
            <small>${escapeHtml(detail)}</small>
          </span>
        </span>
      `;
    })
    .join("");
  return `
    <div class="ranking-chart-card">
      <div class="ranking-chart-kpis">
        <span><strong>${rankingHistoryRankLabel(latest.rank)}</strong> atual</span>
        <span><strong>#${best}</strong> melhor</span>
        <span><strong>${rows.length}</strong> semanas válidas</span>
      </div>
      <div class="ranking-chart-stage">
        <svg class="ranking-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Histórico de ranking canônico">
          <g class="ranking-chart-grid">
            ${yTicks.map((tick) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${fmt(y(tick), 2)}" y2="${fmt(y(tick), 2)}"></line><text x="${pad.left - 10}" y="${fmt(y(tick) + 4, 2)}">#${tick}</text>`).join("")}
            ${xTicks.map((row) => `<line x1="${fmt(x(row.date), 2)}" x2="${fmt(x(row.date), 2)}" y1="${pad.top}" y2="${pad.top + plotHeight}"></line><text x="${fmt(x(row.date), 2)}" y="${height - 12}">${escapeHtml(chartDateLabel(row.date))}</text>`).join("")}
          </g>
          <path class="ranking-chart-area" d="${areaPath}"></path>
          <polyline class="ranking-chart-line" points="${points}"></polyline>
          <g class="ranking-chart-points">
            ${rows.map((row) => `<circle cx="${fmt(x(row.date), 2)}" cy="${fmt(y(row.rank), 2)}" r="4"></circle>`).join("")}
          </g>
        </svg>
        <div class="ranking-chart-hotspots">${pointHotspots}</div>
      </div>
    </div>
  `;
}

function chartDateTicks(rows) {
  if (rows.length <= 3) return rows;
  const middle = rows[Math.floor((rows.length - 1) / 2)];
  return [rows[0], middle, rows[rows.length - 1]];
}

function chartDateLabel(value) {
  const date = new Date(value);
  return date.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
}

function dateValue(value) {
  const timestamp = value instanceof Date ? value.getTime() : Number(value) || Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function teamRosterTab(team, currentLineup, historicalPlayers) {
  return `
    <div class="stack team-roster-stack">
      <section class="section-band">
        ${sectionHead("Elenco atual", "Jogadores ativos no perfil público da equipe.", null, null)}
        <div class="roster-grid roster-feature-grid">${currentLineup.length ? currentLineup.map((entry) => lineupEntryCard(entry, team)).join("") : `<div class="empty-state">Equipe sem elenco atual cadastrado.</div>`}</div>
      </section>
      <section class="section-band">
        ${sectionHead("Histórico do elenco", "Linha do tempo das formações registradas em partidas oficiais.", null, null)}
        ${lineupTimelineChart(team)}
      </section>
      <section class="section-band">
        ${sectionHead("Ex-membros", "Jogadores com passagem registrada pela equipe.", null, null)}
        <div class="former-member-list">${historicalPlayers.length ? historicalPlayers.map((player) => formerMemberCard(team, player)).join("") : `<div class="empty-state">Nenhum ex-membro cadastrado para esta equipe.</div>`}</div>
      </section>
    </div>
  `;
}

function teamMatchesTab(matches, team) {
  return `
    <div class="team-results-section">
      <div class="team-results-summary">
        ${stat(matches.length, "Séries")}
        ${stat(`${team.wins}-${team.losses}`, "Campanha")}
        ${stat(pct(team.winRate), "Win rate")}
        ${stat(signed(team.roundDiff), "Saldo de rounds")}
      </div>
      <div class="result-list team-result-list">${matches.length ? matches.map(matchResultRow).join("") : `<div class="empty-state">Nenhuma partida registrada para esta equipe.</div>`}</div>
    </div>
  `;
}

function teamTournamentsTab(tournaments, team) {
  return `
    <section class="team-tournaments-panel">
      <div class="section-head"><h2>Campeonatos</h2><p>Campanhas registradas para a equipe.</p></div>
      <div class="team-tournament-list">${tournaments.length ? tournaments.map((event) => teamTournamentCard(event, team)).join("") : `<div class="empty-state">Nenhum campeonato registrado para esta equipe.</div>`}</div>
    </section>
  `;
}

function teamTournamentCard(event, team) {
  const campaign = teamEventCampaign(team.id, event);
  const placement = campaign.placementLabel || "Colocação indisponível";
  const placementContext = campaign.placementStatus === "ongoing" ? "Resultado" : eventStatusClass(event.status) === "done" ? "Colocação final" : "Colocação atual";
  return `
    <a class="team-tournament-card" href="#/tournaments/${event.id}">
      <span class="team-tournament-event">
        ${eventLogo(event, "team-tournament-logo")}
        <span>
          <strong>${escapeHtml(event.name)}</strong>
          <small>${escapeHtml(eventTimeRange(event))}</small>
        </span>
      </span>
      <span class="team-placement-badge">
        <strong>${escapeHtml(placement)}</strong>
        <small>${escapeHtml(placementContext)}</small>
      </span>
      <span class="team-tournament-stats">
        <span><strong>${campaign.seriesWins}-${campaign.seriesLosses}</strong><small>Séries</small></span>
        <span><strong>${campaign.mapWins}-${campaign.mapLosses}</strong><small>Mapas</small></span>
        <span><strong>${signed(campaign.roundDiff)}</strong><small>Saldo</small></span>
        <span><strong>${campaign.size || event.teams.length}</strong><small>Equipes</small></span>
      </span>
      <span class="team-tournament-status">
        <strong>${escapeHtml(event.status)}</strong>
        <small>${escapeHtml(`${event.matches} partidas`)}</small>
      </span>
    </a>
  `;
}

function teamEventCampaign(teamId, event) {
  const eventSeries = matchSeriesForEvent(event.id);
  const standings = eventStandings(eventSeries);
  const achievement = teamById(teamId)?.ranking?.achievements?.find((row) => row.eventId === event.id);
  const placementResult = teamEventPlacementResult(teamId, event, achievement);
  const teamSeries = eventSeries.filter((series) => seriesHasTeam(series, teamId));
  const campaign = teamSeries.reduce(
    (total, series) => {
      const score = seriesScoreForTeam(series, teamId);
      const won = series.winnerId === teamId || score.mapsFor > score.mapsAgainst;
      total.seriesWins += won ? 1 : 0;
      total.seriesLosses += won ? 0 : 1;
      total.mapWins += score.mapsFor;
      total.mapLosses += score.mapsAgainst;
      total.roundDiff += score.roundsFor - score.roundsAgainst;
      return total;
    },
    { seriesWins: 0, seriesLosses: 0, mapWins: 0, mapLosses: 0, roundDiff: 0 },
  );
  return {
    ...campaign,
    placement: placementResult.placement,
    placementLabel: placementResult.placementLabel,
    placementStatus: placementResult.placementStatus,
    size: achievement?.size || standings.length || event.teams.length,
  };
}

function eventStandings(eventSeries) {
  const rows = new Map();
  const ensure = (team) => {
    if (!rows.has(team.id)) rows.set(team.id, { id: team.id, seriesWins: 0, seriesLosses: 0, mapWins: 0, mapLosses: 0, roundDiff: 0 });
    return rows.get(team.id);
  };
  for (const series of eventSeries) {
    if (!series.teamA?.id || !series.teamB?.id) continue;
    const a = ensure(series.teamA);
    const b = ensure(series.teamB);
    const scoreA = seriesScoreForTeam(series, series.teamA.id);
    const scoreB = seriesScoreForTeam(series, series.teamB.id);
    const aWon = series.winnerId === series.teamA.id || scoreA.mapsFor > scoreA.mapsAgainst;
    a.seriesWins += aWon ? 1 : 0;
    a.seriesLosses += aWon ? 0 : 1;
    b.seriesWins += aWon ? 0 : 1;
    b.seriesLosses += aWon ? 1 : 0;
    a.mapWins += scoreA.mapsFor;
    a.mapLosses += scoreA.mapsAgainst;
    b.mapWins += scoreB.mapsFor;
    b.mapLosses += scoreB.mapsAgainst;
    a.roundDiff += scoreA.roundsFor - scoreA.roundsAgainst;
    b.roundDiff += scoreB.roundsFor - scoreB.roundsAgainst;
  }
  return [...rows.values()].sort((a, b) => b.seriesWins - a.seriesWins || b.mapWins - a.mapWins || b.roundDiff - a.roundDiff || a.seriesLosses - b.seriesLosses || a.id.localeCompare(b.id));
}

function seriesScoreForTeam(series, teamId) {
  const isA = series.teamA.id === teamId;
  const isB = series.teamB.id === teamId;
  if (!isA && !isB) return { mapsFor: 0, mapsAgainst: 0, roundsFor: 0, roundsAgainst: 0 };
  return {
    mapsFor: isA ? Number(series.scoreA || 0) : Number(series.scoreB || 0),
    mapsAgainst: isA ? Number(series.scoreB || 0) : Number(series.scoreA || 0),
    roundsFor: isA ? Number(series.roundScoreA || 0) : Number(series.roundScoreB || 0),
    roundsAgainst: isA ? Number(series.roundScoreB || 0) : Number(series.roundScoreA || 0),
  };
}

function teamStatsTab(team, currentLineup, observedPlayers) {
  const lineupPlayers = currentLineup.map((entry) => playerById(entry.playerId)).filter(Boolean);
  const stintPlayers = state.db.players.filter((player) => (player.teamStats || []).some((row) => row.teamId === team.id && row.matches > 0));
  const tablePlayers = [...new Map([...lineupPlayers, ...stintPlayers, ...observedPlayers].map((player) => [player.id, player])).values()]
    .map((player) => ({ ...player, ...playerStatsForTeam(player, team.id) }))
    .sort((a, b) => Number(b.matches > 0) - Number(a.matches > 0) || Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0) || Number(b.rounds || 0) - Number(a.rounds || 0));
  return `
    <div class="team-tab-grid">
      <section class="data-panel">
        <div class="section-head"><h2>Stats dos jogadores</h2><p>Média e volume considerando apenas os mapas jogados pela equipe.</p></div>
        ${teamPlayerStatsTable(tablePlayers)}
      </section>
      <aside class="stack">
        <section class="data-panel">
          <div class="section-head"><h2>Desempenho por mapa</h2></div>
          ${bars(team.mapStats.map((item) => [item.name, item.winRate, `${item.wins}-${item.matches - item.wins}`])) || `<div class="empty-state">Sem mapas registrados.</div>`}
        </section>
        <section class="data-panel">
          <div class="section-head"><h2>Lados</h2></div>
          ${bars([["Ataque", team.attackWinRate], ["Defesa", team.defenseWinRate], ["Pistol", team.pistolWinRate]])}
        </section>
      </aside>
    </div>
  `;
}

function teamProfileLogo(team) {
  return `<span class="team-logo-frame">${teamLogo(team.id, "large")}</span>`;
}

const TEAM_INK_CLARO = "#f5f1f2";
const TEAM_INK_ESCURO = "#040306";
const TEAM_ROW_SURFACE = [11, 11, 16];
const TEAM_INK_CONTRASTE_MINIMO = 4.5;

// Luminancia relativa (WCAG). Existe porque quando o fundo da linha vira a cor
// da equipe nao da para escolher a tinta do texto no chute: das 97 equipes, as
// mais claras sao branco puro e as mais escuras sao preto puro. A mesma tinta
// nao serve para as duas.
function relativeLuminance(rgb) {
  const canal = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2]);
}

function hexToRgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value).trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function contrastRatio(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// A tinta escura entra so quando a COR PRINCIPAL da equipe e branca ou muito
// clara - a cor2 nao vota. Antes quem decidia era o pior dos dois tons, e uma
// cor2 clara virava o nome inteiro para preto mesmo com a cor1 escura.
//
// 0,45 de luminancia relativa e onde a lista tem a maior folga: de um lado
// unirio_krakens (#53c5f1, 0,481) e tigre_branco (#b9b9b9, 0,485), do outro
// pucc_canaries (#cca900, 0,412). Acima do corte ficam 14 das 97 - os dois
// brancos puros, os dois UFU Saints, os amarelos fortes e os azuis lavados.
//
// Nao e o cruzamento matematico das duas tintas, que fica em 0,171: naquele
// ponto 36 equipes virariam preto, incluindo azul medio como #037aff, que nao
// e "muito claro" por nenhuma leitura razoavel.
const TEAM_INK_LIMIAR = 0.45;

function teamInkFor(cor1) {
  const cor = hexToRgb(cor1);
  if (!cor) return TEAM_INK_CLARO;
  return relativeLuminance(cor) >= TEAM_INK_LIMIAR ? TEAM_INK_ESCURO : TEAM_INK_CLARO;
}

function piorContraste(tinta, ...tons) {
  const alvo = hexToRgb(tinta);
  return Math.min(...tons.filter(Boolean).map((tom) => contrastRatio(alvo, tom)));
}

// A trama alterna dois tons e o texto atravessa os dois. A tinta ja foi
// escolhida pela cor1; aqui os dois tons caminham juntos ate ela fechar 4,5:1
// nos dois - para o branco se a tinta e escura, para a superficie da linha se
// e clara. Vermelho e azul de saturacao media sao os que mais andam: nem
// branco nem preto fecham 4,5:1 contra #e90101 ou #037aff sem ajuda.
const TEAM_WASH_MISTURA = 0.4;
// Piso de separacao entre os dois tons da trama. Sem ele a trama sumia nas
// equipes de cor1 e cor2 parecidas: visto na tela, a `faixa` do Azure Bears
// (#037aff / #67afff, 1,29:1) lia como azul chapado, enquanto o `chevron` do
// UFU Saints (1,86:1) aparecia inteiro. Nao adianta escolher geometria mais
// forte quando nao ha diferenca de cor para a geometria mostrar.
const TEAM_TOM_SEPARACAO_MINIMA = 1.55;

// Afasta o segundo tom do primeiro ate os dois se distinguirem, sem perder os
// 4,5:1 do texto que o passeio anterior garantiu.
//
// Testa as duas direcoes em vez de deduzir uma. Deduzir falhou duas vezes:
// escolhendo pela tinta, o UFU Saints mandava empurrar #fefefe para o branco, e
// branco nao clareia; escolhendo pela cor1, os tons medios com tinta clara
// tinham de clarear e a guarda de contraste barrava no primeiro passo. Os dois
// criterios brigam em cor media - entao mede os dois e fica com o melhor.
function afastaSegundoTom(primeiro, segundo, tinta) {
  const alvoDaTinta = hexToRgb(tinta);
  let melhor = segundo;
  let melhorSeparacao = contrastRatio(primeiro, segundo);
  for (const destino of [[0, 0, 0], [255, 255, 255]]) {
    for (let passo = 2; passo <= 100; passo += 2) {
      const f = passo / 100;
      const tom = segundo.map((c, i) => Math.round(c * (1 - f) + destino[i] * f));
      if (contrastRatio(alvoDaTinta, tom) < TEAM_INK_CONTRASTE_MINIMO) break;
      const separacao = contrastRatio(primeiro, tom);
      if (separacao > melhorSeparacao) {
        melhorSeparacao = separacao;
        melhor = tom;
      }
      if (separacao >= TEAM_TOM_SEPARACAO_MINIMA) break;
    }
    if (melhorSeparacao >= TEAM_TOM_SEPARACAO_MINIMA) break;
  }
  return melhor;
}

function teamWashFor(accent, accent2) {
  const cor = hexToRgb(accent);
  if (!cor) return { fundo: accent, fundo2: accent2, tinta: TEAM_INK_CLARO };
  const segunda = hexToRgb(accent2) || cor;
  // A cor2 nunca entra pura na trama: puxada 40% para dentro da cor1, ela
  // aparece como variacao da mesma familia em vez de listra de outro time.
  const par = segunda.map((c, i) => c * TEAM_WASH_MISTURA + cor[i] * (1 - TEAM_WASH_MISTURA));

  const tinta = teamInkFor(accent);
  const destino = tinta === TEAM_INK_ESCURO ? [255, 255, 255] : TEAM_ROW_SURFACE;
  for (let passo = 0; passo <= 100; passo += 1) {
    const f = passo / 100;
    // Arredonda ANTES de medir: a conta em float garantia 4,50:1 num valor que
    // depois virava #rrggbb e caia para 4,48:1. O que vale e a cor emitida.
    const a = cor.map((c, i) => Math.round(c * (1 - f) + destino[i] * f));
    const b = par.map((c, i) => Math.round(c * (1 - f) + destino[i] * f));
    if (piorContraste(tinta, a, b) >= TEAM_INK_CONTRASTE_MINIMO || passo === 100) {
      // A separacao vem por ultimo: o passeio acima move os dois tons juntos e
      // comprime a diferenca entre eles. Separar antes dele era desperdicio -
      // medido, 19 das 97 voltavam para baixo do piso.
      const segundoTom = contrastRatio(a, b) < TEAM_TOM_SEPARACAO_MINIMA ? afastaSegundoTom(a, b, tinta) : b;
      return { fundo: rgbToHex(a), fundo2: rgbToHex(segundoTom), tinta };
    }
  }
  return { fundo: accent, fundo2: accent2, tinta: TEAM_INK_CLARO };
}

function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

// Cinco tramas, escolhidas pelo jeito que as duas cores da equipe conversam.
// A regra e explicita de proposito: o insumo e a separacao entre os dois tons
// (contraste de um contra o outro) e a distancia de matiz. Quanto mais as duas
// brigam, menos area a segunda ganha - senao a linha vira bandeira listrada.
//
// Catorze degrades, escolhidos pelo jeito que as duas cores da equipe
// conversam. Sao so degrades e fades - nenhuma listra, bolinha, xadrez ou
// malha. O que distingue um do outro e a direcao, a origem e quantas paradas de
// cor tem, nao geometria repetida.
//
// Os insumos sao a separacao entre os dois tons ja ajustados e a distancia de
// matiz das cores ORIGINAIS da planilha - depois da mistura o matiz da cor2 e
// puxado para dentro do da cor1 e a conta perde sentido.
//
// Os cortes sao os septis medidos nas 97 depois que o piso de separacao entrou
// (1,56 / 1,58 / 1,63 / 1,80 / 2,09 / 2,76). Sete faixas x dois matizes dao
// catorze celulas, todas povoadas.
//
// A ordem nao e arbitraria: quanto maior a separacao, MENOS area a cor2 ganha.
// Duas cores que brigam dividindo a linha ao meio viram bandeira de dois
// times; a mesma cor2 so na borda vira acabamento.
const TEAM_PATTERN_TABELA = [
  { limite: 1.56, perto: "horizonte", longe: "diagonal" },
  { limite: 1.58, perto: "bordas", longe: "lateral" },
  { limite: 1.63, perto: "nascente", longe: "canto" },
  { limite: 1.8, perto: "nucleo", longe: "mare" },
  { limite: 2.09, perto: "cinta", longe: "varredura" },
  { limite: 2.76, perto: "aurora", longe: "deriva" },
  { limite: Infinity, perto: "vinheta", longe: "brilho" },
];

function hueOf(rgb) {
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

// tom1/tom2 sao os tons ja ajustados por contraste (o que aparece na tela) e
// definem a separacao; cor1/cor2 sao os da planilha e definem o matiz.
function teamPatternFor(tom1, tom2, cor1, cor2) {
  const a = hexToRgb(tom1);
  const b = hexToRgb(tom2);
  if (!a || !b) return "tecido";
  const separacao = contrastRatio(a, b);
  const origem1 = hexToRgb(cor1) || a;
  const origem2 = hexToRgb(cor2) || b;
  const bruto = Math.abs(hueOf(origem1) - hueOf(origem2));
  const matiz = Math.min(bruto, 360 - bruto);
  const faixa = TEAM_PATTERN_TABELA.find((linha) => separacao < linha.limite);
  return matiz < 40 ? faixa.perto : faixa.longe;
}

function teamAccentStyle(team) {
  const [primary, secondary] = team.colors || [];
  const accent = safeCssColor(primary, "#f6132a");
  const accent2 = safeCssColor(secondary, "#2ad4c1");
  const { fundo, fundo2, tinta } = teamWashFor(accent, accent2);
  const trama = teamPatternFor(fundo, fundo2, accent, accent2);
  return `data-trama="${trama}" style="--team-accent:${accent};--team-accent-2:${accent2};--team-wash:${fundo};--team-wash-2:${fundo2};--team-ink:${tinta};"`;
}

function safeCssColor(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
  if (/^(rgb|hsl)a?\([0-9.,% -]+\)$/i.test(text)) return text;
  return fallback;
}

function teamStateBadge(team) {
  const profile = team.profile || {};
  const stateLabel = profile.state ? `${profile.stateName || profile.state}` : profile.stateName || "Estado não informado";
  const flag = profile.flag
    ? `<img class="state-flag" src="${escapeHtml(assetPath(profile.flag))}" alt="Bandeira ${escapeHtml(stateLabel)}" loading="lazy" onerror="this.replaceWith(this.nextElementSibling)" /><span class="state-flag placeholder">${escapeHtml(profile.state || "UF")}</span>`
    : `<span class="state-flag placeholder">${escapeHtml(profile.state || "UF")}</span>`;
  return `<span class="state-badge">${flag}<span>${escapeHtml(stateLabel)}</span></span>`;
}

function socialButtons(team) {
  const socials = team.profile?.socials || {};
  const rows = [
    ["website", "Site"],
    ["instagram", "Instagram"],
    ["x", "X"],
    ["twitch", "Twitch"],
    ["youtube", "YouTube"],
    ["discord", "Discord"],
  ];
  const configured = rows.filter(([key]) => socials[key]);
  const visible = configured.length ? configured : rows;
  return visible
    .map(([key, label]) => {
      const url = socials[key];
      const attrs = url ? `href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"` : `aria-disabled="true"`;
      return `<a class="social-button ${url ? "" : "disabled"}" ${attrs} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${socialIcon(key)}</a>`;
    })
    .join("");
}

function socialIcon(key) {
  const icons = {
    website: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18"></path></svg>`,
    instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="4"></rect><circle cx="12" cy="12" r="3.2"></circle><circle cx="16.5" cy="7.5" r="0.8"></circle></svg>`,
    x: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5l12 14M18 5L6 19"></path></svg>`,
    twitch: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h13v9l-4 4h-4l-3 3v-3H6z"></path><path d="M10 9v4M15 9v4"></path></svg>`,
    youtube: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="10" rx="3"></rect><path d="M11 10l4 2-4 2z"></path></svg>`,
    discord: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8c3-2 7-2 10 0l1 8c-2 2-4 3-6 3s-4-1-6-3z"></path><path d="M9 14h.1M15 14h.1"></path></svg>`,
  };
  return icons[key] || icons.website;
}

function trophyHallFromRows(trophies) {
  if (!trophies.length) {
    return "";
  }
  return `
    <div class="trophy-list">
      ${trophies.map(trophyHallItem).join("")}
    </div>
  `;
}

function teamTrophyAchievements(team) {
  if (!team?.id) return [];
  const rows = [];
  for (const event of visibleTournaments()) {
    if (!eventIsDone(event)) continue;
    const placements = trophyPlacementRows(event);
    placements.forEach((row, index) => {
      const teamId = row.id || row.teamId;
      if (teamId !== team.id) return;
      const placement = trophyPlacementInfo(row, index);
      if (!placement) return;
      rows.push({
        event,
        placement: placement.value,
        placementLabel: placement.label,
        trophyKey: placement.trophyKey,
        podiumClass: placement.podiumClass,
        date: Number(event.end || event.start || 0),
      });
    });
  }
  return rows.sort((a, b) => b.date - a.date || a.placement - b.placement || String(a.event.name || "").localeCompare(String(b.event.name || ""), "pt-BR"));
}

function trophyPlacementRows(event) {
  if (event.placements?.length) return normalizePlacementRowsForDisplay(event.placements);
  const configured = state.db?.rankingWeights?.tournaments?.[event.id]?.placements || [];
  return normalizePlacementRowsForDisplay(configured);
}

function trophyPlacementInfo(row, index) {
  const raw = placementRawValue(row) || placementLabel(index);
  if (placementIsOngoing(raw)) return null;
  const text = String(raw || "").trim();
  const normalized = normalize(text);
  const compact = normalizeNameKey(text);
  const number = Number(row.placement || text);
  if (number === 1 || text === "1" || compact === "1olugar" || normalized === "1st") {
    return { value: 1, label: "Campeão", trophyKey: "champion", podiumClass: "place-1" };
  }
  if (number === 2 || text === "2" || compact === "2olugar" || normalized === "2nd") {
    return { value: 2, label: "Vice-campeão", trophyKey: "runnerUp", podiumClass: "place-2" };
  }
  if (number === 3 || text === "3" || compact === "3olugar" || normalized === "3rd") {
    return { value: 3, label: "3º lugar", trophyKey: "third", podiumClass: "place-3" };
  }
  if (normalized.startsWith("3-4") || normalized.startsWith("3/4") || compact.startsWith("34")) {
    return { value: 3.5, label: "3º/4º lugar", trophyKey: "third", podiumClass: "place-3" };
  }
  return null;
}

function trophyHallItem(trophy) {
  const label = [trophy.event.name || "Campeonato", trophy.placementLabel, eventTimeRange(trophy.event)].filter(Boolean).join(" - ");
  return `
    <a class="trophy-item ${escapeHtml(trophy.podiumClass)}" href="#/tournaments/${escapeHtml(trophy.event.id)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      ${trophyVisual(trophy)}
    </a>
  `;
}

function trophyVisual(trophy) {
  const candidates = trophyImageCandidates(trophy.event, trophy.trophyKey).map(assetPath).filter(Boolean);
  const src = candidates[0] || assetPath(TROPHY_GENERIC_ASSETS[trophy.trophyKey] || TROPHY_GENERIC_ASSETS.third);
  const fallbacks = candidates.slice(1).join("|");
  return `
    <span class="trophy-visual ${trophyImageIsGeneric(src) ? "generic-trophy" : ""}" aria-hidden="true">
      <img class="trophy-image" src="${escapeHtml(src)}" alt="" loading="lazy" data-trophy-fallbacks="${escapeHtml(fallbacks)}" onload="trophyImageLoaded(this)" onerror="trophyImageFallback(this)" />
      ${eventLogo(trophy.event, "trophy-event-logo")}
    </span>
  `;
}

function trophyImageCandidates(event, trophyKey) {
  const suffix = trophyKey === "champion" ? "campeao" : trophyKey === "runnerUp" ? "vice" : "terceiro";
  const eventKeys = [...new Set([event?.id, slugify(event?.name || ""), normalizeNameKey(event?.name || "")].filter(Boolean))];
  const possiveis = [
    ...eventKeys.flatMap((key) => [`${key}-${suffix}.png`, `${key}_${suffix}.png`]),
    ...eventKeys.map((key) => `${key}.png`),
  ];
  // So entra na fila o arquivo que o manifesto diz existir. Sem este filtro,
  // cada podio disparava de tres a seis requisicoes que davam 404 antes de o
  // onerror chegar no generico.
  return [
    ...possiveis.filter((nome) => TROPHY_ART_FILES.has(nome)).map((nome) => `${TROPHY_ASSET_ROOT}/${nome}`),
    TROPHY_GENERIC_ASSETS[trophyKey] || TROPHY_GENERIC_ASSETS.third,
  ];
}

function trophyImageFallback(image) {
  const fallbacks = String(image?.dataset?.trophyFallbacks || "").split("|").filter(Boolean);
  const next = fallbacks.shift();
  if (!next) {
    image?.remove();
    return;
  }
  image.dataset.trophyFallbacks = fallbacks.join("|");
  image.closest(".trophy-visual")?.classList.toggle("generic-trophy", trophyImageIsGeneric(next));
  image.src = next;
}

function trophyImageLoaded(image) {
  const src = image?.currentSrc || image?.getAttribute("src") || "";
  image?.closest(".trophy-visual")?.classList.toggle("generic-trophy", trophyImageIsGeneric(src));
}

function trophyImageIsGeneric(src) {
  return /(?:^|\/)(?:campeao|vice|terceiro)-generico\.png(?:$|\?)/i.test(String(src || "").replaceAll("\\", "/"));
}

function teamRankingHistory(team) {
  const snapshots = teamRankingSnapshotHistory(team.id);
  if (snapshots.length) return snapshots;
  const manual = team.profile?.rankingHistory || [];
  if (manual.length) {
    return manual.map((row) => ({
      date: row.date || "",
      rank: Number(row.rank || 0),
      points: row.points ?? "",
      note: row.note || "Histórico cadastrado",
    }));
  }
  return derivedTeamRankingHistory(team.id);
}

function teamRankingSnapshotHistory(teamId) {
  return (state.db?.rankingSnapshots || [])
    .map((snapshot) => {
      const row = snapshot.byTeamId?.[teamId];
      if (!row || !row.matches) return null;
      return {
        date: snapshot.cutoffAt,
        rank: row.validRank || null,
        points: row.score,
        note: rankingIsValid(row) ? snapshot.label : `${snapshot.label} - ${rankingStatusLabel(row).toLowerCase()}`,
      };
    })
    .filter(Boolean);
}

function derivedTeamRankingHistory(teamId) {
  const minimumMatches = state.db.rankingMinimumMatches || 9;
  const rows = new Map(state.db.teams.map((team) => [team.id, { id: team.id, wins: 0, losses: 0, matches: 0, roundDiff: 0 }]));
  const history = [];
  const chronological = allMatchSeries().slice().sort((a, b) => a.startedAt - b.startedAt);

  for (const series of chronological) {
    for (const match of series.maps) {
      for (const side of [
        { team: match.teamA, opponent: match.teamB },
        { team: match.teamB, opponent: match.teamA },
      ]) {
        const row = rows.get(side.team.id);
        if (!row) continue;
        const won = match.winnerId === side.team.id;
        row.matches += 1;
        row.wins += won ? 1 : 0;
        row.losses += won ? 0 : 1;
        row.roundDiff += side.team.score - side.opponent.score;
      }
    }
    if (seriesHasTeam(series, teamId)) {
      const ranking = [...rows.values()]
        .map((row) => ({ ...row, points: row.wins * 3 + row.roundDiff / 10, winRate: pctValue(row.wins, row.wins + row.losses) }))
        .filter((row) => row.matches >= minimumMatches)
        .sort((a, b) => b.points - a.points || b.winRate - a.winRate || b.roundDiff - a.roundDiff);
      const index = ranking.findIndex((row) => row.id === teamId);
      const currentStats = rows.get(teamId);
      const current = ranking[index] || {
        points: currentStats ? currentStats.wins * 3 + currentStats.roundDiff / 10 : "",
      };
      const opponent = series.teamA.id === teamId ? series.teamB : series.teamA;
      history.push({
        date: series.startedAt,
        rank: index >= 0 ? index + 1 : null,
        points: current.points,
        note: `${index >= 0 ? "após" : "provisório após"} ${opponent.name}`,
      });
    }
  }
  return history.reverse();
}

function rankingHistoryRankLabel(rank) {
  const value = Number(rank);
  return Number.isFinite(value) && value > 0 ? `#${value}` : "Provisório";
}

function teamHistoricalPlayers(team) {
  const registeredLineup = team.currentLineup || [];
  const lineupIds = new Set(registeredLineup.map((entry) => entry.playerId).filter(Boolean));
  const lineupNameKeys = new Set(registeredLineup.map((entry) => normalizeNameKey(entry.name)).filter(Boolean));
  return state.db.players
    .filter((player) => {
      if (!(player.teamHistory || []).includes(team.id)) return false;
      if (!registeredLineup.length) return player.teamId !== team.id;
      if (lineupIds.has(player.id) || playerLookupKeys(player).some((key) => lineupNameKeys.has(key))) return false;
      return player.currentTeam !== team.id;
    })
    .sort((a, b) => a.nick.localeCompare(b.nick));
}

function lineupTimelineRows(team) {
  const segments = team.profile?.lineupHistory || [];
  const currentIds = new Set((team.currentLineup || []).map((entry) => entry.playerId).filter(Boolean));
  const currentKeys = new Set((team.currentLineup || []).map((entry) => entry.playerId || normalizeNameKey(entry.name || entry.handle)).filter(Boolean));
  const rows = new Map();
  for (const segment of segments) {
    for (const entry of segment.players || []) {
      const key = entry.playerId || normalizeNameKey(entry.name || entry.handle);
      if (!key) continue;
      const current = currentIds.has(entry.playerId) || currentKeys.has(key);
      const start = dateValue(entry.firstSeenAt || segment.from || segment.firstSeenAt);
      const end = dateValue(entry.lastSeenAt || segment.to || segment.lastSeenAt) || start;
      const player = entry.playerId ? playerById(entry.playerId) : null;
      const row = rows.get(key) || {
        key,
        playerId: entry.playerId || "",
        name: player?.nick || entry.name || entry.handle || "Jogador",
        handle: player?.handle || entry.handle || "",
        start: start || end,
        end: end || start,
        matches: 0,
        rounds: 0,
        current: false,
      };
      row.playerId = row.playerId || entry.playerId || "";
      row.name = player?.nick || row.name;
      row.handle = player?.handle || row.handle;
      row.start = Math.min(row.start || start, start || row.start);
      row.end = Math.max(row.end || end, end || row.end);
      row.matches += Number(entry.matches || 0);
      row.rounds += Number(entry.rounds || 0);
      row.current = row.current || current;
      rows.set(key, row);
    }
  }
  return [...rows.values()]
    .filter((row) => row.start && row.end)
    .sort((a, b) => Number(b.current) - Number(a.current) || a.start - b.start || a.name.localeCompare(b.name));
}

function lineupTimelineChart(team) {
  const rows = lineupTimelineRows(team);
  if (!rows.length) return `<div class="empty-state">Sem histórico de elenco suficiente para montar a linha do tempo.</div>`;
  const min = Math.min(...rows.map((row) => row.start));
  const max = Math.max(...rows.map((row) => row.end));
  const span = Math.max(DAY_MS, max - min);
  const ticks = timelineTicks(min, max);
  return `
    <div class="lineup-timeline-chart">
      <div class="lineup-timeline-axis">
        <span></span>
        <div class="lineup-axis-track">
          ${ticks.map((tick) => `<span style="left:${timelinePct(tick, min, max)}%">${escapeHtml(chartDateLabel(tick))}</span>`).join("")}
        </div>
        <span></span>
      </div>
      <div class="lineup-timeline-rows">
        ${rows
          .map((row) => {
            const start = timelinePct(row.start, min, max);
            const width = clamp(((row.end - row.start) / span) * 100, 2, 100 - start);
            const href = row.playerId ? `href="${playerHref(row.playerId)}"` : "";
            const tag = row.playerId ? "a" : "span";
            return `
              <div class="lineup-timeline-row">
                <${tag} class="lineup-timeline-name" ${href}>
                  ${row.playerId ? playerLogo(row.playerId, "timeline-photo") : `<span class="timeline-photo logo round">${escapeHtml(row.name.slice(0, 2).toUpperCase())}</span>`}
                  <span><strong>${escapeHtml(row.name)}</strong>${row.current ? `<small>Atual</small>` : ""}</span>
                </${tag}>
                <div class="lineup-timeline-track">
                  <span class="lineup-timeline-bar ${row.current ? "current" : ""}" style="--start:${fmt(start, 2)};--width:${fmt(width, 2)}" title="${escapeHtml(`${row.name}: ${formatDateRange(row.start, row.end, { current: row.current })}`)}"></span>
                </div>
                <span class="lineup-timeline-meta">${escapeHtml(formatDateRange(row.start, row.end, { current: row.current }))}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function timelineTicks(min, max) {
  const span = Math.max(DAY_MS, max - min);
  return [0, 0.33, 0.66, 1].map((ratio) => min + span * ratio);
}

function timelinePct(value, min, max) {
  return clamp(((value - min) / Math.max(DAY_MS, max - min)) * 100, 0, 100);
}

function formerMemberCard(team, player) {
  const tenure = playerTeamTenure(team, player);
  return `
    <a class="former-member-card" href="${playerHref(player)}">
      ${playerLogo(player.id, "former-photo")}
      <span class="former-member-main">
        <strong>${escapeHtml(player.nick)}</strong>
        <small>${escapeHtml(player.handle)}</small>
      </span>
      <span class="former-member-period">
        <strong>${escapeHtml(tenure.range)}</strong>
        <small>${escapeHtml(tenure.detail)}</small>
      </span>
      <span class="chip red">${playerRating(playerStatsForTeam(player, team.id))} rAAting 3.0</span>
    </a>
  `;
}

function playerTeamTenure(team, player) {
  const rows = lineupTimelineRows(team);
  const key = normalizeNameKey(player.nick || player.handle);
  const row = rows.find((item) => item.playerId === player.id || normalizeNameKey(item.name) === key || normalizeNameKey(item.handle) === key);
  if (!row) return { range: "Passagem registrada", detail: "Período não informado" };
  const duration = formatTenureDuration(row.start, row.end);
  const matches = row.matches ? `${row.matches} partidas` : "participação registrada";
  return { range: formatDateRange(row.start, row.end, { current: row.current }), detail: `${duration} - ${matches}` };
}

function formatDateRange(start, end, options = {}) {
  const startAt = dateValue(start);
  const endAt = dateValue(end);
  const from = startAt || endAt;
  const to = endAt || startAt;
  if (!from && !to) return "Período não informado";
  const endLabel = formatPeriodEndDate(to, options);
  if (endLabel === "Atualmente" && from) return `${formatDate(from)} - ${endLabel}`;
  if (!to || Math.abs(to - from) < DAY_MS) return formatDate(from || to);
  return `${formatDate(from)} - ${endLabel}`;
}

function formatPeriodEndDate(end, options = {}) {
  return periodEndIsCurrent(end, options) ? "Atualmente" : formatDate(end);
}

function periodEndIsCurrent(end, options = {}) {
  if (options.current) return true;
  if (options.autoCurrent === false) return false;
  const endDay = dayKey(end);
  if (!endDay) return false;
  return currentPeriodEndDays().has(endDay);
}

function currentPeriodEndDays() {
  const days = new Set();
  [Date.now(), latestRankingSnapshot()?.cutoffAt, latestKnownDataTimestamp()].forEach((value) => {
    const key = dayKey(value);
    if (key) days.add(key);
  });
  return days;
}

function latestKnownDataTimestamp() {
  const candidates = [
    ...(state.db?.matches || []).map((match) => match.startedAt),
    ...(state.db?.matchSeries || []).flatMap((series) => [series.sortAt, series.startedAt, ...(series.maps || []).map((match) => match.startedAt)]),
  ]
    .map(dateValue)
    .filter(Boolean);
  return candidates.length ? Math.max(...candidates) : 0;
}

function dayKey(value) {
  const timestamp = dateValue(value);
  if (!timestamp) return "";
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return String(date.getTime());
}

function formatTenureDuration(start, end) {
  const days = Math.max(1, Math.round((Math.max(start, end) - Math.min(start, end)) / DAY_MS) + 1);
  if (days < 31) return `${days} ${days === 1 ? "dia" : "dias"}`;
  const months = Math.max(1, Math.round(days / 30));
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}a ${rest}m` : `${years} ${years === 1 ? "ano" : "anos"}`;
}

function teamPlayerStatsTable(players) {
  if (!players.length) return `<div class="empty-state">Nenhum jogador disponível para a tabela de stats.</div>`;
  return `
    <div class="table-wrap team-player-stats-wrap">
      <table class="team-player-stats-table">
        <thead><tr><th>Jogador</th><th class="numeric">rAAting 3.0</th><th class="numeric">Rounds</th><th class="numeric">Mapas</th><th class="numeric">ACS</th><th class="numeric">K/D</th><th class="numeric">ADR</th><th class="numeric">KAST</th><th class="numeric">Swing/R</th><th class="numeric">FK-FD</th></tr></thead>
        <tbody>${players
          .map(
            (player) => {
              const fkFdDiff = Number(player.firstKills || 0) - Number(player.firstDeaths || 0);
              return `
              <tr>
                <td>
                  <a class="team-stats-player" href="${playerHref(player)}">
                    ${playerLogo(player.id, "stats-photo")}
                    <span><strong>${escapeHtml(player.nick)}</strong><small>${escapeHtml(player.handle)}</small>${sampleStatusChip(player)}</span>
                  </a>
                </td>
                <td class="numeric rating-cell ${playerRatingTone(player)}">${playerRating(player)}</td>
                <td class="numeric">${player.rounds}</td>
                <td class="numeric">${player.matches}</td>
                <td class="numeric">${fmt(player.acs, 0)}</td>
                <td class="numeric">${fmt(player.kd)}</td>
                <td class="numeric">${fmt(player.adr, 0)}</td>
                <td class="numeric">${pct(player.kast)}</td>
                <td class="numeric ${directionalTone(playerSwingPerRound(player))}">${formatMaybeSwing(player)}</td>
                <td class="numeric ${signedTone(fkFdDiff)}">${signed(fkFdDiff)}</td>
              </tr>
            `;
            },
          )
          .join("")}</tbody>
      </table>
    </div>
  `;
}

function renderPlayerDetail(id) {
  const player = playerById(id);
  if (!player) return renderNotFound("Jogador");
  const activeTab = normalizePlayerTab(route().tab);
  const matches = matchSeriesForPlayer(player.id);
  const team = playerPrimaryTeam(player);
  const tournamentRows = playerTournamentRows(player, matches);
  const teamRows = playerTeamHistoryRows(player, matches, tournamentRows);
  const trophies = playerTrophyAchievements(player, tournamentRows);
  const tabSlide = panelSlideSnapshot("player-tabs", {
    selector: ".player-tab-panel",
    scope: player.id,
    key: activeTab,
    order: PLAYER_TAB_KEYS,
  });
  Shell(`
    <section class="player-page" ${playerAccentStyle(team)}>
      <div class="player-hero">
        ${team ? `<div class="player-hero-team-bg" aria-hidden="true">${teamLogo(team.id, "player-hero-bg-logo")}</div>` : ""}
        <div class="player-hero-portrait">
          ${playerLogo(player.id, "player-hero-photo")}
        </div>
        <div class="player-hero-copy">
          <div class="player-hero-title-row">
            <h1>${escapeHtml(player.nick)}</h1>
            ${playerHeroRoleBadge(player)}
          </div>
          <p>${escapeHtml(player.handle || player.nick)}</p>
          ${playerNickHistoryChips(player, "hero")}
        </div>
        <aside class="player-quick-panel">
          ${team ? playerCurrentTeamCard(team) : `<div class="player-current-team-card"><small>Equipe atual</small><strong>Sem equipe</strong></div>`}
          ${playerHeroMetrics(player)}
        </aside>
      </div>
      <nav class="team-tabs player-tabs" aria-label="Abas do jogador">
        ${playerTabLink(player, "resumo", "Resumo", activeTab)}
        ${playerTabLink(player, "equipes", "Equipes", activeTab)}
        ${playerTabLink(player, "partidas", "Partidas", activeTab)}
        ${playerTabLink(player, "agentes", "Agentes", activeTab)}
        ${playerTabLink(player, "mapas", "Mapas", activeTab)}
        ${playerTabLink(player, "resultados", "Resultados", activeTab)}
        ${playerTabLink(player, "trofeus", "Troféus", activeTab)}
      </nav>
      <section class="team-tab-panel player-tab-panel">
        ${renderPlayerTab(activeTab, player, { matches, teamRows, tournamentRows, trophies })}
      </section>
    </section>
  `);
  if (activeTab === "agentes") bindPlayerAgentStatsControls(player.id);
  if (activeTab === "mapas") bindPlayerMapStatsControls(player.id);
  playPanelSlide(tabSlide);
}

const PLAYER_TAB_KEYS = ["resumo", "equipes", "partidas", "agentes", "mapas", "resultados", "trofeus"];

function normalizePlayerTab(tab) {
  if (tab === "equipes" || tab === "teams") return "equipes";
  if (tab === "partidas" || tab === "matches") return "partidas";
  if (tab === "agentes" || tab === "agents") return "agentes";
  if (tab === "mapas" || tab === "maps") return "mapas";
  if (tab === "resultados" || tab === "results" || tab === "campeonatos") return "resultados";
  if (tab === "trofeus" || tab === "troféus" || tab === "trophies") return "trofeus";
  return "resumo";
}

function playerTabLink(player, tab, label, activeTab) {
  return `<a class="team-tab ${activeTab === tab ? "active" : ""}" href="${playerHref(player, tab)}">${escapeHtml(label)}</a>`;
}

function renderPlayerTab(activeTab, player, context) {
  const renderers = {
    resumo: () => playerSummaryTab(player, context.matches, context.trophies),
    equipes: () => playerTeamsTab(player, context.teamRows, context.trophies),
    partidas: () => playerMatchesTab(player, context.matches),
    agentes: () => playerAgentsTab(player, context.matches),
    mapas: () => playerMapsTab(player, context.matches),
    resultados: () => playerResultsTab(player, context.tournamentRows),
    trofeus: () => playerTrophiesTab(player, context.trophies),
  };
  return (renderers[activeTab] || renderers.resumo)();
}

function playerPrimaryTeam(player) {
  return teamById(player.teamId) || teamById(player.observedTeamId) || teamById((player.teamHistory || [])[0]);
}

function playerAccentStyle(team) {
  if (team) return teamAccentStyle(team);
  return `style="--team-accent:#d8323c;--team-accent-2:#009a96;"`;
}

function playerCurrentTeamCard(team) {
  return `
    <a class="player-current-team-card" href="#/teams/${team.id}">
      <small>Equipe atual</small>
      ${teamLogo(team.id, "player-current-team-logo")}
      <span class="player-current-team-copy">
        <strong>${escapeHtml(team.name)}</strong>
        <em>${escapeHtml(team.sourceTag || team.tag || team.id)}</em>
      </span>
    </a>
  `;
}

function playerHeroMetrics(player) {
  return playerMetricList(
    [
      [playerRating(player), "rAAting 3.0"],
      [fmt(player.acs, 0), "ACS"],
      [fmt(player.adr, 0), "ADR"],
      [fmt(player.kd), "K/D"],
    ],
    "player-hero-metrics",
  );
}

function playerHeroRoleBadge(player) {
  const role = playerDominantRole(player);
  if (!role) return "";
  const title = role.rounds ? `${role.label} - ${role.rounds} rounds` : role.label;
  return `
    <span class="player-role-badge" title="${escapeHtml(title)}">
      ${roleMiniIcon(role)}
      <strong>${escapeHtml(role.label)}</strong>
    </span>
  `;
}

function playerNickHistoryChips(player, context = "") {
  const nicks = [...new Set((player.nickHistory || []).filter(Boolean))];
  if (!nicks.length) return context === "hero" ? "" : `<div class="empty-state compact-empty">Sem histórico de nicks cadastrado.</div>`;
  return `
    <div class="player-nick-history ${context === "hero" ? "hero-nicks" : ""}">
      ${context === "hero" ? `<span>Histórico de nicks</span>` : ""}
      <div class="chip-row">${nicks.map((nick) => `<span class="chip">${escapeHtml(nick)}</span>`).join("")}</div>
    </div>
  `;
}

function playerSummaryTab(player, matches, trophies) {
  return `
    <div class="player-summary-layout">
      <div class="stack">
        ${playerSummaryTrophyPanel(trophies)}
        <section class="data-panel player-stats-panel">
          <div class="section-head"><h2>Dados do jogador</h2><p>Agregado das partidas registradas.</p></div>
          ${playerStatCards(player)}
        </section>
        ${playerRatingCompositionPanel(player)}
        ${playerRatingMetricsPanel(player)}
        ${playerOpeningTradesPanel(player)}
      </div>
      <aside class="stack">
        <section class="data-panel">
          <div class="section-head"><h2>Agentes mais usados</h2></div>
          ${agentBars((player.agentStats || []).slice(0, 5))}
        </section>
        <section class="data-panel">
          <div class="section-head"><h2>Por mapa</h2></div>
          ${playerMapTable(player)}
        </section>
      </aside>
    </div>
    <section class="section-band player-recent-matches">
      ${sectionHead("Últimas partidas", "Partidas mais recentes associadas ao jogador.", null, null)}
      <div class="match-list">${matches.length ? matches.slice(0, 6).map(matchResultRow).join("") : `<div class="empty-state">Nenhuma partida registrada para este jogador.</div>`}</div>
    </section>
  `;
}

function playerSummaryTrophyPanel(trophies) {
  const hall = trophyHallFromRows(trophies);
  if (!hall) return "";
  return `
    <section class="data-panel player-summary-trophy-panel">
      <div class="section-head"><h2>Hall de troféus</h2></div>
      ${hall}
    </section>
  `;
}

function playerStatCards(player) {
  const fkpr = player.rounds ? player.firstKills / player.rounds : 0;
  const fdpr = player.rounds ? player.firstDeaths / player.rounds : 0;
  return playerMetricList([
    [playerRating(player), "rAAting 3.0"],
    [player.rounds, "Rounds"],
    [player.matches, "Mapas"],
    [fmt(player.acs, 0), "ACS"],
    [fmt(player.kd), "K/D"],
    [signed(player.kills - player.deaths), "K-D"],
    [fmt(player.adr, 0), "ADR"],
    [pct(player.kast), "KAST"],
    [formatMaybeSwing(player), "Swing/R"],
    [player.kills, "Kills"],
    [player.deaths, "Deaths"],
    [player.assists, "Assists"],
    [fmt(player.kpr), "KPR"],
    [fmt(player.dpr), "DPR"],
    [fmt(player.apr), "APR"],
    [fmt(fkpr), "FKPR"],
    [fmt(fdpr), "FDPR"],
    [pct(player.hs), "HS%"],
  ], "player-primary-metrics");
}

function playerRatingCompositionPanel(player) {
  return `
    <section class="data-panel player-rating-panel">
      <div class="section-head"><h2>Composição da rAAting 3.0</h2><p>${escapeHtml(ratingFormulaText(" "))}</p></div>
      ${ratingComponentCards(player)}
    </section>
  `;
}

function ratingComponentCards(player) {
  return playerMetricList(
    ratingComponentDefinitions().map((item) => [formatMaybeMetric(player, item.key), item.label, item.description]),
    "player-rating-metrics-list",
  );
}

function ratingComponentDefinitions() {
  return [
    { key: "kill_rating", label: "KillRating", description: "Produção de kills ajustada por economia e contexto." },
    { key: "damage_rating", label: "DamageRating", description: "Dano efetivo ajustado por economia." },
    { key: "round_swing_rating", label: "RoundSwingRating", description: "Impacto médio do jogador na chance de vitória dos rounds." },
    { key: "survival_rating", label: "SurvivalRating", description: "Qualidade de sobrevivência e mortes, incluindo trades, opening deaths e saves em derrota." },
    { key: "kast_rating", label: "KASTRating", description: "Participação útil em rounds: kill, assistência, sobrevivência em round vencido ou morte tradada." },
    { key: "multi_kill_rating", label: "MultiKillRating", description: "Explosividade em rounds com 2K, 3K, 4K ou 5K." },
  ];
}

function playerRatingMetricsPanel(player) {
  return `
    <section class="data-panel player-rating-metrics-panel">
      <div class="section-head"><h2>Métricas rAAting 3.0</h2><p>Métricas ajustadas usadas na fórmula oficial.</p></div>
      ${playerMetricList([
        [formatMaybeMetric(player, "ekpr"), "eKPR", "Kills por round ajustados por economia."],
        [formatMaybeMetric(player, "edpr"), "eDPR", "Mortes por round ajustadas por economia."],
        [formatMaybeMetric(player, "eadr", 0), "eADR", "Dano por round ajustado por economia."],
        [formatMaybePercent(player, "ekast"), "eKAST", "KAST ajustado por economia."],
        [formatMaybeMetric(player, "mk_per_r"), "MK/R", "Pontos de multi-kill por round."],
        [formatMaybeSwing(player), "Swing/R", "Round Swing médio por round, em pontos percentuais."],
      ], "player-rating-metrics-list")}
    </section>
  `;
}

function playerOpeningTradesPanel(player) {
  const fkFdDiff = Number(player.firstKills || 0) - Number(player.firstDeaths || 0);
  const fkpr = player.rounds ? player.firstKills / player.rounds : 0;
  const fdpr = player.rounds ? player.firstDeaths / player.rounds : 0;
  return `
    <section class="data-panel player-rating-trades-panel">
      <div class="section-head"><h2>Abertura e trades</h2><p>Eventos de abertura, trades e sobrevivência usados na auditoria da rAAting 3.0.</p></div>
      ${playerMetricList([
        [player.firstKills || 0, "First Kills"],
        [player.firstDeaths || 0, "First Deaths"],
        [signed(fkFdDiff), "FK-FD"],
        [fmt(fkpr), "FKPR"],
        [fmt(fdpr), "FDPR"],
        [formatMaybeMetric(player, "tradeKills", 0), "Trade Kills"],
        [formatMaybeMetric(player, "tradedDeaths", 0), "Mortes tradadas"],
        [formatMaybeMetric(player, "failedTradeDeaths", 0), "Mortes sem trade"],
        [formatMaybeMetric(player, "tradeDenials", 0), "Trade denials"],
        [formatMaybeMetric(player, "savedLossRounds", 0), "Saves em derrota"],
        [formatMaybeMetric(player, "survivedWinRounds", 0), "Sobrevivências em vitória"],
      ], "player-rating-metrics-list")}
    </section>
  `;
}

function playerMetricList(items, extra = "") {
  return `
    <dl class="${escapeHtml(`player-metric-list ${extra}`.trim())}">
      ${items
        .map(([value, label, title]) => {
          const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
          return `<div class="player-metric-line"${titleAttr}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
        })
        .join("")}
    </dl>
  `;
}

function playerTeamsTab(player, teamRows, trophies) {
  const current = teamRows.find((row) => row.current) || teamRows[0];
  const totalSeries = teamRows.reduce((sum, row) => sum + Number(row.series || 0), 0);
  return `
    <div class="player-team-kpis">
      ${stat(teamRows.length, "Equipes")}
      ${stat(current ? current.duration : "-", "Tempo na atual")}
      ${stat(totalSeries, "Séries")}
      ${stat(trophies.length, "Troféus")}
    </div>
    <section class="data-panel">
      <div class="section-head"><h2>Gráfico de equipes</h2><p>Linha do tempo estimada pelas partidas e elencos registrados.</p></div>
      ${playerTeamTimelineChart(teamRows)}
    </section>
    <section class="data-panel">
      <div class="section-head"><h2>Histórico de equipes</h2><p>Passagens, duração e conquistas associadas.</p></div>
      ${playerTeamHistoryList(player, teamRows)}
    </section>
  `;
}

function playerMatchesTab(player, matches) {
  const matchSummary = playerMatchSeriesSummary(player.id, matches);
  return `
    <section class="team-results-section player-matches-section">
      <div class="team-results-summary">
        ${stat(matches.length, "Séries")}
        ${stat(player.matches, "Mapas")}
        ${stat(`${player.kills}-${player.deaths}`, "K-D")}
        ${stat(pct(matchSummary.winRate), "Winrate")}
        ${stat(playerRating(player), "rAAting 3.0")}
      </div>
      <div class="result-list team-result-list">${matches.length ? matches.map(matchResultRow).join("") : `<div class="empty-state">Nenhuma partida registrada para este jogador.</div>`}</div>
    </section>
  `;
}

function playerMatchSeriesSummary(playerId, matches) {
  const rows = (matches || [])
    .map((series) => playerSeriesResult(series, playerId))
    .filter(Boolean);
  const wins = rows.filter((row) => row.won).length;
  return { wins, losses: rows.length - wins, total: rows.length, winRate: pctValue(wins, rows.length) };
}

function playerSeriesResult(series, playerId) {
  const teamId = playerSeriesTeamId(series, playerId);
  if (!teamId) return null;
  const score = seriesScoreForTeam(series, teamId);
  return { teamId, won: series.winnerId === teamId || score.mapsFor > score.mapsAgainst };
}

function playerSeriesTeamId(series, playerId) {
  const counts = new Map();
  for (const match of series?.maps || []) {
    const entry = playerInMatchTeam(match, playerId);
    if (!entry?.teamId) continue;
    counts.set(entry.teamId, (counts.get(entry.teamId) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] || "";
}

function playerAgentsTab(player, matches) {
  const scopeId = playerAgentStatsScopeId(player.id);
  const selectedMap = tournamentSelectedMapFilter(scopeId, "agents");
  const agents = playerAgentRows(player.id, matches, selectedMap);
  const totalPicks = agents.reduce((sum, row) => sum + Number(row.picks || 0), 0);
  return `
    <section class="tournament-section tournament-agents-section tournament-stats-section player-agents-section">
      <div class="tournament-section-head">
        <h2>Agentes</h2>
        <span>${agents.length} agentes · ${totalPicks} picks</span>
      </div>
      <div class="tournament-stats-shell">
        ${tournamentMapFilterControl(scopeId, matches, "agents")}
        <div class="tournament-stat-tables">
          ${tournamentAgentStatsTable(scopeId, agents, playerAgentStatColumns())}
        </div>
      </div>
    </section>
  `;
}

function playerAgentStatColumns() {
  return tournamentAgentStatColumns().filter((column) => !["uniquePlayers", "uniqueTeams"].includes(column.key));
}

function playerAgentRows(playerId, matches, mapFilter = "all") {
  const rows = new Map();
  let pickOpportunities = 0;
  for (const match of tournamentFilteredMapMatches(matches, mapFilter)) {
    const player = (match.players || []).find((row) => row.id === playerId);
    if (!player) continue;
    const key = agentStatsKey(player);
    if (!rows.has(key)) rows.set(key, tournamentAgentEmptyRow(key, player));
    updateTournamentAgentRow(rows.get(key), player, match);
    pickOpportunities += 1;
  }
  return [...rows.values()].map((row) => tournamentFinalizeAgentRow(row, pickOpportunities)).sort(tournamentAgentStatSort);
}

function playerAgentStatsScopeId(playerId) {
  return `player:${playerId}`;
}

function bindPlayerAgentStatsControls(playerId) {
  const root = document.querySelector(".player-agents-section");
  if (!root) return;
  const scopeId = playerAgentStatsScopeId(playerId);
  root.addEventListener("click", (event) => {
    const sortButton = event.target.closest("[data-tournament-stat-sort]");
    if (sortButton) {
      const [table, key] = String(sortButton.dataset.tournamentStatSort || "").split(":");
      if (table !== "agents") return;
      const column = playerAgentStatColumns().find((item) => item.key === key);
      if (!column) return;
      const current = tournamentStatsSortState(table);
      const defaultDirection = column.direction || "desc";
      const direction = current.key === key ? (current.direction === "desc" ? "asc" : "desc") : defaultDirection;
      state.tournamentStatsSort = { ...state.tournamentStatsSort, [table]: { key, direction } };
      renderPlayerDetail(playerId);
      return;
    }

    const expandButton = event.target.closest("[data-tournament-stat-expand]");
    if (expandButton) {
      const table = expandButton.dataset.tournamentStatExpand;
      const key = `${scopeId}:${table}`;
      state.tournamentStatsExpanded = { ...state.tournamentStatsExpanded, [key]: !state.tournamentStatsExpanded?.[key] };
      renderPlayerDetail(playerId);
    }
  });
  root.addEventListener("change", (event) => {
    const mapFilter = event.target.closest("[data-tournament-map-filter]");
    if (!mapFilter) return;
    const scope = mapFilter.dataset.tournamentMapFilter;
    state.tournamentMapFilters = { ...state.tournamentMapFilters, [`${scopeId}:${scope}`]: mapFilter.value || "all" };
    state.tournamentStatsExpanded = { ...state.tournamentStatsExpanded, [`${scopeId}:${scope}`]: false };
    renderPlayerDetail(playerId);
  });
}

function playerMapsTab(player, matches) {
  const scopeId = playerMapStatsScopeId(player.id);
  const rows = playerMapRows(player.id, matches);
  const totalMaps = rows.reduce((sum, row) => sum + Number(row.mapsPlayed || 0), 0);
  return `
    <section class="tournament-section tournament-stats-section player-maps-section">
      <div class="tournament-section-head">
        <h2>Mapas</h2>
        <span>${rows.length} mapas · ${totalMaps} partidas</span>
      </div>
      <div class="tournament-stats-shell">
        <div class="tournament-stat-tables">
          ${playerMapStatsTable(scopeId, rows)}
        </div>
      </div>
    </section>
  `;
}

function playerMapRows(playerId, matches) {
  const rows = new Map();
  for (const match of tournamentStatMapMatches(matches)) {
    const player = (match.players || []).find((row) => row.id === playerId);
    if (!player) continue;
    const meta = mapById(match.mapId) || mapByName(match.mapName) || { id: match.mapId || normalizeNameKey(match.mapName), name: match.mapName || "Mapa" };
    const key = meta.id || normalizeNameKey(meta.name);
    if (!rows.has(key)) rows.set(key, playerMapEmptyRow(key, meta));
    updatePlayerMapRow(rows.get(key), player, match);
  }
  return [...rows.values()].map(playerFinalizeMapRow).sort(playerMapStatSort);
}

function playerMapEmptyRow(key, map) {
  return {
    id: key,
    name: map.name || "Mapa",
    icon: map.icon || "",
    banner: mapArtAttrs(map)?.src || "",
    mapsPlayed: 0,
    rounds: 0,
    score: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    damage: 0,
    firstKills: 0,
    firstDeaths: 0,
    kastRounds: 0,
    impactTotal: 0,
    ...emptyRaatingAggregateFields(),
    headshots: 0,
    bodyshots: 0,
    legshots: 0,
    mapWins: 0,
    mapLosses: 0,
  };
}

function updatePlayerMapRow(row, player, match) {
  const rounds = Number(player.rounds || match.rounds || 0);
  if (!row.banner) {
    const asset = matchMapAsset(match);
    row.banner = asset.src || "";
  }
  row.mapsPlayed += 1;
  row.rounds += rounds;
  row.score += Number(player.score || 0);
  row.kills += Number(player.kills || 0);
  row.deaths += Number(player.deaths || 0);
  row.assists += Number(player.assists || 0);
  row.damage += Number(player.damage || 0);
  row.firstKills += Number(player.firstKills || 0);
  row.firstDeaths += Number(player.firstDeaths || 0);
  row.kastRounds += Number(player.kastRounds || 0);
  row.impactTotal += Number(player.impactTotal || 0);
  addRaatingAggregateFields(row, player);
  row.headshots += Number(player.headshots || 0);
  row.bodyshots += Number(player.bodyshots || 0);
  row.legshots += Number(player.legshots || 0);
  row.mapWins += match.winnerId === player.teamId ? 1 : 0;
  row.mapLosses += match.winnerId === player.teamId ? 0 : 1;
}

function playerFinalizeMapRow(row) {
  row.acs = row.rounds ? row.score / row.rounds : 0;
  row.adr = row.rounds ? row.damage / row.rounds : 0;
  row.kpr = row.rounds ? row.kills / row.rounds : 0;
  row.dpr = row.rounds ? row.deaths / row.rounds : 0;
  row.apr = row.rounds ? row.assists / row.rounds : 0;
  row.kd = row.deaths ? row.kills / row.deaths : row.kills;
  row.kastFrac = row.rounds ? row.kastRounds / row.rounds : 0;
  row.kast = row.kastFrac * 100;
  row.impactRound = row.rounds ? row.impactTotal / row.rounds : 0;
  row.impactRoundLegacy = row.rounds ? Number(row.impactTotalLegacy || 0) / row.rounds : 0;
  row.kastLegacyFrac = row.rounds ? Number(row.kastLegacyRounds || 0) / row.rounds : row.kastFrac;
  row.kastLegacy = row.kastLegacyFrac * 100;
  const shots = row.headshots + row.bodyshots + row.legshots;
  row.hs = shots ? (row.headshots / shots) * 100 : 0;
  applyRaatingFields(row);
  row.winRate = row.mapsPlayed ? pctValue(row.mapWins, row.mapsPlayed) : 0;
  return row;
}

function playerMapStatSort(a, b) {
  return b.rating - a.rating || b.mapsPlayed - a.mapsPlayed || b.rounds - a.rounds || a.name.localeCompare(b.name, "pt-BR");
}

function playerMapStatsTable(scopeId, rows) {
  const columns = playerMapStatColumns();
  const sortedRows = tournamentSortedStatRows("maps", rows, columns, playerMapStatSort);
  const expanded = tournamentStatsTableExpanded(scopeId, "maps");
  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, 10);
  return `
    <article class="tournament-stat-card tournament-stat-table-card">
      <div class="tournament-stat-card-head">
        <span>
          <strong>Tabela de mapas</strong>
          <small>Desempenho agregado do jogador por mapa</small>
        </span>
        ${tournamentStatsExpandButton("maps", sortedRows.length, expanded)}
      </div>
      <div class="table-wrap tournament-stats-table-wrap">
        <table class="tournament-stats-table tournament-map-stats-table">
          <thead>
            <tr>
              ${columns.map((column) => tournamentStatsHeaderCell("maps", column)).join("")}
            </tr>
          </thead>
          <tbody>
            ${visibleRows.length ? visibleRows.map((row) => playerMapStatsRow(row, columns)).join("") : `<tr><td colspan="${columns.length}"><div class="empty-state compact-empty">Nenhum mapa com estatísticas disponíveis.</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function playerMapStatColumns() {
  return [
    { key: "map", label: "Mapa", value: (row) => row.name || row.id || "", type: "text", direction: "asc" },
    { key: "mapsPlayed", label: "Mapas", value: (row) => Number(row.mapsPlayed || 0) },
    { key: "winRate", label: "Win%", value: (row) => Number(row.winRate || 0) },
    { key: "rounds", label: "RND", value: (row) => Number(row.rounds || 0) },
    { key: "rating", label: "rAAting 3.0", value: (row) => Number(row.rating || 0) },
    { key: "acs", label: "ACS", value: (row) => Number(row.acs || 0) },
    { key: "kd", label: "K:D", value: (row) => Number(row.kd || 0) },
    { key: "kast", label: "KAST", value: (row) => Number(row.kast || 0) },
    { key: "adr", label: "ADR", value: (row) => Number(row.adr || 0) },
    { key: "kpr", label: "KPR", value: (row) => Number(row.kpr || 0) },
    { key: "apr", label: "APR", value: (row) => Number(row.apr || 0) },
    { key: "fkpr", label: "FKPR", value: (row) => (row.rounds ? row.firstKills / row.rounds : 0) },
    { key: "fdpr", label: "FDPR", value: (row) => (row.rounds ? row.firstDeaths / row.rounds : 0) },
    { key: "hs", label: "HS%", value: (row) => Number(row.hs || 0) },
    { key: "kills", label: "K", value: (row) => Number(row.kills || 0) },
    { key: "deaths", label: "D", value: (row) => Number(row.deaths || 0) },
    { key: "assists", label: "A", value: (row) => Number(row.assists || 0) },
    { key: "firstKills", label: "FK", value: (row) => Number(row.firstKills || 0) },
    { key: "firstDeaths", label: "FD", value: (row) => Number(row.firstDeaths || 0) },
  ];
}

function playerMapStatsRow(row, columns = playerMapStatColumns()) {
  return `
    <tr>
      ${columns.map((column) => playerMapStatCell(row, column)).join("")}
    </tr>
  `;
}

function playerMapStatCell(row, column) {
  const key = column.key;
  if (key === "map") {
    return `
      <td>
        <a class="player-map-banner-cell ${row.banner ? "has-banner" : ""}" href="#/maps/${escapeHtml(row.id)}">
          ${row.banner ? `<img src="${escapeHtml(row.banner)}" alt="${escapeHtml(row.name)}" loading="lazy" onerror="this.closest('.player-map-banner-cell').classList.remove('has-banner'); this.remove()" />` : ""}
          <span>
            <strong>${escapeHtml(row.name)}</strong>
            <small>${escapeHtml(`${row.mapWins || 0}-${row.mapLosses || 0} mapas`)}</small>
          </span>
        </a>
      </td>
    `;
  }
  if (key === "mapsPlayed") return `<td class="numeric">${escapeHtml(String(row.mapsPlayed || 0))}</td>`;
  if (key === "winRate") return tournamentStatValueCell(pct(row.winRate));
  if (key === "rounds") return `<td class="numeric">${escapeHtml(String(row.rounds || 0))}</td>`;
  if (key === "rating") return tournamentStatValueCell(fmt(row.rating));
  if (key === "acs") return tournamentStatValueCell(fmt(row.acs, 0));
  if (key === "kd") return tournamentStatValueCell(fmt(row.kd));
  if (key === "kast") return tournamentStatValueCell(pct(row.kast));
  if (key === "adr") return tournamentStatValueCell(fmt(row.adr, 0));
  if (key === "kpr") return tournamentStatValueCell(fmt(row.kpr));
  if (key === "apr") return tournamentStatValueCell(fmt(row.apr));
  if (key === "fkpr") return tournamentStatValueCell(fmt(row.rounds ? row.firstKills / row.rounds : 0));
  if (key === "fdpr") return tournamentStatValueCell(fmt(row.rounds ? row.firstDeaths / row.rounds : 0));
  if (key === "hs") return tournamentStatValueCell(pct(row.hs));
  if (key === "kills") return `<td class="numeric">${escapeHtml(String(row.kills || 0))}</td>`;
  if (key === "deaths") return `<td class="numeric">${escapeHtml(String(row.deaths || 0))}</td>`;
  if (key === "assists") return `<td class="numeric">${escapeHtml(String(row.assists || 0))}</td>`;
  if (key === "firstKills") return `<td class="numeric">${escapeHtml(String(row.firstKills || 0))}</td>`;
  if (key === "firstDeaths") return `<td class="numeric">${escapeHtml(String(row.firstDeaths || 0))}</td>`;
  const value = column.value ? column.value(row) : "";
  if (column.type === "text") return `<td>${escapeHtml(String(value || ""))}</td>`;
  return tournamentStatValueCell(fmt(Number(value || 0)));
}

function playerMapStatsScopeId(playerId) {
  return `player:${playerId}`;
}

function bindPlayerMapStatsControls(playerId) {
  const root = document.querySelector(".player-maps-section");
  if (!root) return;
  const scopeId = playerMapStatsScopeId(playerId);
  root.addEventListener("click", (event) => {
    const sortButton = event.target.closest("[data-tournament-stat-sort]");
    if (sortButton) {
      const [table, key] = String(sortButton.dataset.tournamentStatSort || "").split(":");
      if (table !== "maps") return;
      const column = playerMapStatColumns().find((item) => item.key === key);
      if (!column) return;
      const current = tournamentStatsSortState(table);
      const defaultDirection = column.direction || "desc";
      const direction = current.key === key ? (current.direction === "desc" ? "asc" : "desc") : defaultDirection;
      state.tournamentStatsSort = { ...state.tournamentStatsSort, [table]: { key, direction } };
      renderPlayerDetail(playerId);
      return;
    }

    const expandButton = event.target.closest("[data-tournament-stat-expand]");
    if (expandButton) {
      const table = expandButton.dataset.tournamentStatExpand;
      const key = `${scopeId}:${table}`;
      state.tournamentStatsExpanded = { ...state.tournamentStatsExpanded, [key]: !state.tournamentStatsExpanded?.[key] };
      renderPlayerDetail(playerId);
    }
  });
}

function playerResultsTab(player, tournamentRows) {
  const ongoingRows = tournamentRows.filter((row) => !eventIsDone(row.event));
  const finishedRows = tournamentRows.filter((row) => eventIsDone(row.event));
  return `
    <section class="data-panel player-results-panel">
      <div class="section-head"><h2>Em andamento</h2><p>Campeonatos ativos em que o jogador aparece nas partidas registradas.</p></div>
      ${ongoingRows.length ? playerResultsTable(player, ongoingRows) : `<div class="empty-state compact-empty">Nenhum campeonato em andamento registrado para este jogador.</div>`}
    </section>
    <section class="data-panel player-results-panel player-results-finished-panel">
      <div class="section-head"><h2>Resultados em campeonatos</h2><p>Campeonatos finalizados, equipe usada e colocação da campanha.</p></div>
      ${finishedRows.length ? playerResultsTable(player, finishedRows) : `<div class="empty-state">Nenhum campeonato finalizado registrado para este jogador.</div>`}
    </section>
  `;
}

function playerTrophiesTab(player, trophies) {
  const champions = trophies.filter((trophy) => trophy.trophyKey === "champion").length;
  const podiums = trophies.length - champions;
  return `
    <div class="player-team-kpis">
      ${stat(champions, "Títulos")}
      ${stat(podiums, "Pódios")}
      ${stat(trophies.length, "Troféus")}
      ${stat(new Set(trophies.map((trophy) => trophy.teamId)).size, "Equipes")}
    </div>
    <section class="data-panel">
      <div class="section-head"><h2>Todos os troféus</h2></div>
      <div class="player-trophy-list">${trophies.length ? trophies.map(playerTrophyRow).join("") : `<div class="empty-state">Nenhum troféu registrado para este jogador.</div>`}</div>
    </section>
  `;
}

function playerTeamHistoryRows(player, matches = matchSeriesForPlayer(player.id), tournamentRows = playerTournamentRows(player, matches)) {
  const matchBuckets = playerTeamMatchBuckets(player.id, matches);
  const tournamentTeamIds = tournamentRows.map((row) => row.teamId).filter(Boolean);
  const ids = [...new Set([player.teamId, player.observedTeamId, ...(player.teamHistory || []), ...matchBuckets.keys(), ...tournamentTeamIds].filter(Boolean))];
  return ids
    .map((teamId, index) => {
      const team = teamById(teamId);
      const timeline = team ? playerTimelineEntryForTeam(team, player) : null;
      const bucket = matchBuckets.get(teamId) || {};
      const start = minPositive(timeline?.start, bucket.start);
      const end = maxPositive(timeline?.end, bucket.end, start);
      const trophies = playerTeamTrophies(teamId, tournamentRows);
      const current = teamId === player.teamId;
      const range = start || end ? formatDateRange(start, end, { current }) : "Período não informado";
      const duration = start || end ? formatTenureDuration(start || end, end || start) : "Duração indisponível";
      return {
        teamId,
        team,
        index,
        start,
        end,
        range,
        duration,
        current,
        series: Number(bucket.series || 0),
        maps: Number(bucket.maps || timeline?.matches || 0),
        rounds: Number(bucket.rounds || timeline?.rounds || 0),
        trophies,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.end || 0) - (a.end || 0) || a.index - b.index);
}

function playerTimelineEntryForTeam(team, player) {
  const rows = lineupTimelineRows(team);
  const key = normalizeNameKey(player.nick || player.handle);
  return rows.find((item) => item.playerId === player.id || normalizeNameKey(item.name) === key || normalizeNameKey(item.handle) === key) || null;
}

function playerTeamMatchBuckets(playerId, matches) {
  const buckets = new Map();
  for (const series of matches) {
    const teamsInSeries = new Set();
    for (const match of series.maps || []) {
      const entry = playerInMatchTeam(match, playerId);
      if (!entry?.teamId) continue;
      const bucket = buckets.get(entry.teamId) || { teamId: entry.teamId, series: 0, maps: 0, rounds: 0, start: 0, end: 0 };
      bucket.maps += 1;
      bucket.rounds += Number(entry.player.rounds || 0);
      bucket.start = minPositive(bucket.start, match.startedAt || series.startedAt);
      bucket.end = maxPositive(bucket.end, match.startedAt || series.startedAt);
      buckets.set(entry.teamId, bucket);
      teamsInSeries.add(entry.teamId);
    }
    teamsInSeries.forEach((teamId) => {
      const bucket = buckets.get(teamId);
      if (bucket) bucket.series += 1;
    });
  }
  return buckets;
}

function playerInMatchTeam(match, playerId) {
  const player = (match.players || []).find((row) => row.id === playerId);
  if (!player) return null;
  const teamId = match.teamA.color === player.teamColor ? match.teamA.id : match.teamB.id;
  return { player, teamId };
}

function playerTeamTimelineChart(teamRows) {
  const rows = teamRows.filter((row) => row.start && row.end);
  if (!rows.length) return `<div class="empty-state">Sem datas suficientes para montar o gráfico de equipes.</div>`;
  const min = Math.min(...rows.map((row) => row.start));
  const max = Math.max(...rows.map((row) => row.end));
  const span = Math.max(DAY_MS, max - min);
  const ticks = timelineTicks(min, max);
  return `
    <div class="lineup-timeline-chart player-team-timeline">
      <div class="lineup-timeline-axis">
        <span></span>
        <div class="lineup-axis-track">
          ${ticks.map((tick) => `<span style="left:${timelinePct(tick, min, max)}%">${escapeHtml(chartDateLabel(tick))}</span>`).join("")}
        </div>
        <span></span>
      </div>
      <div class="lineup-timeline-rows">
        ${rows
          .map((row) => {
            const start = timelinePct(row.start, min, max);
            const width = clamp(((row.end - row.start) / span) * 100, 2, 100 - start);
            const name = row.team?.name || row.teamId;
            return `
              <div class="lineup-timeline-row">
                <a class="lineup-timeline-name" href="#/teams/${escapeHtml(row.teamId)}">
                  ${teamLogo(row.teamId, "timeline-team-logo")}
                  <span><strong>${escapeHtml(name)}</strong>${row.current ? `<small>Atual</small>` : ""}</span>
                </a>
                <div class="lineup-timeline-track">
                  <span class="lineup-timeline-bar ${row.current ? "current" : ""}" style="--start:${fmt(start, 2)};--width:${fmt(width, 2)}" title="${escapeHtml(`${name}: ${row.range}`)}"></span>
                </div>
                <span class="lineup-timeline-meta">${escapeHtml(row.range)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function playerTeamHistoryList(player, teamRows) {
  if (!teamRows.length) return `<div class="empty-state">Sem histórico de equipes cadastrado.</div>`;
  return `
    <div class="player-team-history-list">
      ${teamRows
        .map((row) => {
          const name = row.team?.name || row.teamId;
          const href = row.team ? `href="#/teams/${row.teamId}"` : "";
          const tag = row.team ? "a" : "span";
          return `
            <div class="player-team-history-row">
              <span class="player-team-period">
                <strong>${escapeHtml(row.range)}</strong>
                <small>${escapeHtml(row.duration)}</small>
              </span>
              <${tag} class="player-team-name" ${href}>
                ${teamLogo(row.teamId, "player-team-row-logo")}
                <span><strong>${escapeHtml(name)}</strong><small>${row.current ? "Equipe atual" : "Passagem registrada"}</small></span>
              </${tag}>
              <span class="player-team-volume">
                <strong>${row.series || row.maps}</strong>
                <small>${row.series ? "séries" : "mapas"}</small>
              </span>
              <span class="player-team-trophies">
                ${row.trophies.length ? row.trophies.slice(0, 6).map(playerMiniTrophyLink).join("") : `<small>Sem conquistas registradas</small>`}
              </span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function playerTournamentRows(player, matches = matchSeriesForPlayer(player.id)) {
  const visibleEvents = new Map(visibleTournaments().map((event) => [event.id, event]));
  const byEvent = new Map();
  for (const series of matches) {
    const event = visibleEvents.get(series.eventId);
    if (!event) continue;
    const row = byEvent.get(event.id) || {
      event,
      teams: new Map(),
      series: 0,
      maps: 0,
      rounds: 0,
      start: 0,
      end: 0,
    };
    row.series += 1;
    const seriesTeams = new Set();
    for (const match of series.maps || []) {
      const entry = playerInMatchTeam(match, player.id);
      if (!entry?.teamId) continue;
      row.maps += 1;
      row.rounds += Number(entry.player.rounds || 0);
      row.start = minPositive(row.start, match.startedAt || series.startedAt);
      row.end = maxPositive(row.end, match.startedAt || series.startedAt);
      seriesTeams.add(entry.teamId);
    }
    seriesTeams.forEach((teamId) => row.teams.set(teamId, (row.teams.get(teamId) || 0) + 1));
    byEvent.set(event.id, row);
  }
  return [...byEvent.values()]
    .map((row) => {
      const teamId = [...row.teams.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
      const team = teamById(teamId);
      const campaign = team ? teamEventCampaign(teamId, row.event) : {};
      const stats = player.eventStats?.find((eventStats) => eventStats.eventId === row.event.id) || {};
      return {
        ...row,
        teamId,
        team,
        placement: campaign.placement || 0,
        placementLabel: campaign.placementLabel || "Colocação indisponível",
        placementStatus: campaign.placementStatus || "unknown",
        size: campaign.size || row.event.teams.length,
        rating: stats.rating || 0,
        acs: stats.acs || 0,
      };
    })
    .sort((a, b) => Number(b.event.end || b.end || b.event.start || 0) - Number(a.event.end || a.end || a.event.start || 0) || String(a.event.name || "").localeCompare(String(b.event.name || ""), "pt-BR"));
}

function playerResultsTable(player, tournamentRows) {
  return `
    <div class="table-wrap player-results-table-wrap">
      <table class="team-player-stats-table player-results-table">
        <thead><tr><th>Campeonato</th><th>Time</th><th>Colocação</th><th class="numeric">Séries</th><th class="numeric">Mapas</th><th class="numeric">rAAting 3.0</th><th class="numeric">ACS</th></tr></thead>
        <tbody>
          ${tournamentRows.map((row) => playerResultsTableRow(row)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function playerResultsTableRow(row) {
  return `
    <tr>
      <td>
        <a class="player-event-cell" href="#/tournaments/${escapeHtml(row.event.id)}">
          ${eventLogo(row.event, "tiny")}
          <span><strong>${escapeHtml(row.event.name)}</strong><small>${escapeHtml(eventTimeRange(row.event))}</small></span>
        </a>
      </td>
      <td>${row.team ? `<a class="player-result-team-cell" href="#/teams/${escapeHtml(row.teamId)}">${teamLogo(row.teamId, "tiny")}<span>${escapeHtml(row.team.name)}</span></a>` : "-"}</td>
      <td><span class="player-placement-badge">${escapeHtml(row.placementLabel)}${row.size ? `<small>${escapeHtml(`${row.size} equipes`)}</small>` : ""}</span></td>
      <td class="numeric">${row.series}</td>
      <td class="numeric">${row.maps}</td>
      <td class="numeric">${row.rating ? fmt(row.rating) : "-"}</td>
      <td class="numeric">${row.acs ? fmt(row.acs, 0) : "-"}</td>
    </tr>
  `;
}

function playerTrophyAchievements(player, tournamentRows = playerTournamentRows(player)) {
  return tournamentRows
    .flatMap((row) => playerTeamTrophies(row.teamId, [row]).map((trophy) => ({ ...trophy, teamId: row.teamId, team: row.team, playerMaps: row.maps, playerSeries: row.series })))
    .sort((a, b) => b.date - a.date || a.placement - b.placement || String(a.event.name || "").localeCompare(String(b.event.name || ""), "pt-BR"));
}

function playerTeamTrophies(teamId, tournamentRows) {
  const team = teamById(teamId);
  if (!team) return [];
  const eventIds = new Set((tournamentRows || []).filter((row) => row.teamId === teamId).map((row) => row.event.id));
  return teamTrophyAchievements(team).filter((trophy) => eventIds.has(trophy.event.id));
}

function playerMiniTrophyLink(trophy) {
  const label = [trophy.event.name || "Campeonato", trophy.placementLabel].filter(Boolean).join(" - ");
  return `<a class="player-mini-trophy ${escapeHtml(trophy.podiumClass)}" href="#/tournaments/${escapeHtml(trophy.event.id)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${trophyVisual(trophy)}</a>`;
}

function playerTrophyRow(trophy) {
  const team = trophy.team || teamById(trophy.teamId);
  return `
    <a class="player-trophy-row" href="#/tournaments/${escapeHtml(trophy.event.id)}">
      ${trophyVisual(trophy)}
      <span class="player-trophy-main">
        <strong>${escapeHtml(trophy.event.name || "Campeonato")}</strong>
        <small>${escapeHtml(`${trophy.placementLabel} - ${eventTimeRange(trophy.event)}`)}</small>
      </span>
      ${team ? `<span class="player-trophy-team">${teamLogo(team.id, "tiny")}<strong>${escapeHtml(team.name)}</strong></span>` : ""}
    </a>
  `;
}

function minPositive(...values) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? Math.min(...nums) : 0;
}

function maxPositive(...values) {
  const nums = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return nums.length ? Math.max(...nums) : 0;
}

function isOfficialRatingSample(player) {
  return (player?.sample_status || player?.sampleStatus) === "OK";
}

function playerRankingRows(players) {
  const rows = state.playerSort === "rating" ? players.filter(isOfficialRatingSample) : players.slice();
  return rows.sort((a, b) => {
    const valueA = state.playerSort === "rating" ? officialRatingValue(a) : state.playerSort === "swing" ? playerSwingPerRound(a) : a[state.playerSort];
    const valueB = state.playerSort === "rating" ? officialRatingValue(b) : state.playerSort === "swing" ? playerSwingPerRound(b) : b[state.playerSort];
    const valueDiff = Number(valueB || 0) - Number(valueA || 0);
    if (valueDiff) return valueDiff;
    if (state.playerSort === "rating") return Number(b.rounds || 0) - Number(a.rounds || 0) || a.nick.localeCompare(b.nick, "pt-BR");
    return a.nick.localeCompare(b.nick, "pt-BR");
  });
}

function renderMapDetail(id) {
  const map = mapById(id);
  if (!map) return renderNotFound("Mapa");
  const matches = matchSeriesForMap(id);
  Shell(`
    <section class="profile-header">
      ${mapLogo(map.id, "large")}
      <div>
        <span class="eyebrow">Mapa competitivo</span>
        <h1>${escapeHtml(map.name)}</h1>
        <p class="muted">${map.matches} partidas - ${map.rounds} rounds jogados</p>
      </div>
      <div class="profile-actions">
        <a class="action-link" href="#/matches">Partidas</a>
      </div>
    </section>
    <div class="layout-grid">
      <div class="stack">
        <section class="section-band">
          ${sectionHead("Partidas neste mapa", "Histórico real importado.", null, null)}
          <div class="match-list">${matches.map(matchCard).join("")}</div>
        </section>
        <section class="section-band">
          ${sectionHead("Equipes por aproveitamento", "Win rate da equipe neste mapa.", null, null)}
          <div class="card-grid">${map.teamStats.map((row) => teamCard(teamById(row.teamId))).join("")}</div>
        </section>
      </div>
      <aside class="side-rail">
        <section class="data-panel dark">
          <div class="section-head"><h2>Resumo</h2></div>
          <div class="stats-grid">
            ${stat(map.matches, "Partidas")}
            ${stat(map.rounds, "Rounds")}
            ${stat(map.teamStats.length, "Equipes")}
            ${stat(map.agentStats[0]?.name || "-", "Agente mais usado")}
          </div>
        </section>
        <section class="data-panel">
          <div class="section-head"><h2>Agentes</h2></div>
          ${agentBars(map.agentStats.slice(0, 8), { showPickRate: true })}
        </section>
        <section class="data-panel">
          <div class="section-head"><h2>Win rate por equipe</h2></div>
          ${bars(map.teamStats.map((item) => [teamById(item.teamId).name, item.winRate, `${item.wins}-${item.matches - item.wins}`]))}
        </section>
      </aside>
    </div>
  `);
}

function panelTitle(title, routeName, linkLabel) {
  return `<header class="panel-title"><h2>${escapeHtml(title)}</h2>${routeName ? `<a href="#/${routeName}">${escapeHtml(linkLabel)}</a>` : ""}</header>`;
}

function panelFooterLink(routeName, label) {
  return `<a class="panel-footer-link" href="#/${routeName}">${escapeHtml(label)}</a>`;
}

function eventIsVisible(event) {
  return !event?.hidden;
}

function visibleTournaments() {
  return (state.db?.tournaments || []).filter(eventIsVisible);
}

function sortedEvents(sortKey = "end") {
  return visibleTournaments().slice().sort((a, b) => {
    const diff = eventSortValue(b, sortKey) - eventSortValue(a, sortKey);
    if (diff) return diff;
    return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { sensitivity: "base" });
  });
}

function eventSortValue(event, sortKey = "end") {
  if (sortKey === "start") return Number(event.start || event.end || 0);
  if (sortKey === "recent") return Math.max(Number(event.end || 0), Number(event.start || 0));
  return Number(event.end || event.start || 0);
}

function allMatchSeries() {
  return state.db.matchSeries || state.db.matches.map((match) => createMatchSeriesSummary([match]));
}

function compareSeriesDateDesc(a, b) {
  return (b.startedAt || b.sortAt || 0) - (a.startedAt || a.sortAt || 0);
}

function isMatchSeriesItem(item) {
  return Array.isArray(item?.maps);
}

function normalizeMatchItem(item) {
  if (isMatchSeriesItem(item)) return item;
  return allMatchSeries().find((series) => series.seriesKey === item.seriesKey) || createMatchSeriesSummary([item]);
}

function matchSeriesRoute(item) {
  const series = normalizeMatchItem(item);
  return `matches/${series.primaryMatchId}${series.mapCount > 1 ? "/all" : ""}`;
}

function matchSeriesHref(item) {
  return `#/${matchSeriesRoute(item)}`;
}

function seriesHasTeam(series, teamId) {
  return series.teamA.id === teamId || series.teamB.id === teamId;
}

function seriesHasMap(series, mapId) {
  return series.maps.some((match) => match.mapId === mapId);
}

function seriesHasPlayer(series, playerId) {
  return series.maps.some((match) => match.players.some((player) => player.id === playerId));
}

function matchSeriesForEvent(eventId) {
  return allMatchSeries().filter((series) => series.eventId === eventId).sort(compareSeriesDateDesc);
}

function matchSeriesForTeam(teamId) {
  return allMatchSeries().filter((series) => seriesHasTeam(series, teamId)).sort(compareSeriesDateDesc);
}

function matchSeriesForMap(mapId) {
  return allMatchSeries().filter((series) => seriesHasMap(series, mapId)).sort(compareSeriesDateDesc);
}

function matchSeriesForPlayer(playerId) {
  return allMatchSeries().filter((series) => seriesHasPlayer(series, playerId)).sort(compareSeriesDateDesc);
}

function filteredMatches() {
  ensureResultFilterDefaults();
  const from = dateInputToStart(state.matchDateFrom);
  const to = dateInputToEnd(state.matchDateTo);
  return allMatchSeries()
    .filter((series) => state.matchBestOf === "all" || seriesBestOf(series) === state.matchBestOf)
    .filter((series) => state.matchMaps.some((mapId) => seriesHasMap(series, mapId)))
    .filter((series) => state.matchTeams.every((teamId) => seriesHasTeam(series, teamId)))
    .filter((series) => state.matchTournaments.includes(series.eventId))
    .filter((series) => !from || (series.sortAt || series.startedAt) >= from)
    .filter((series) => !to || series.startedAt <= to)
    .sort(compareSeriesDateDesc);
}

function seriesBestOf(series) {
  const label = String(series.label || seriesFormatLabel(series.maps || []));
  const match = label.match(/\d+/);
  return match ? match[0] : "1";
}

function dateInputToStart(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function dateInputToEnd(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function bindMatchFilters() {
  const sidebar = document.querySelector(".match-filter-sidebar");
  sidebar?.querySelectorAll(".filter-dropdown").forEach((details) => {
    details.addEventListener("toggle", () => {
      const group = details.dataset.filterGroup;
      if (group) state.resultFilterOpen[group] = details.open;
    });
  });
  sidebar?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-match-filter]");
    if (!button) return;
    const filter = button.dataset.matchFilter;
    const value = button.dataset.value || "all";
    // devolve o foco ao mesmo controle depois da re-renderizacao
    const foco = `[data-match-filter="${filter}"]` + (button.dataset.value ? `[data-value="${button.dataset.value}"]` : "");
    if (filter === "reset") {
      resetResultFilters();
      pushFilterState("matches", new URLSearchParams(), foco);
      return;
    }
    if (filter === "bestOf") {
      state.matchBestOf = state.matchBestOf === value ? "all" : value;
    }
    if (filter === "map") toggleResultFilterValue("matchMaps", value);
    if (filter === "tournament") toggleResultFilterValue("matchTournaments", value);
    if (filter === "team") toggleResultFilterValue("matchTeams", value);
    pushFilterState("matches", matchFiltersToQuery(), foco);
  });
  // `change` e nao `input`: o seletor de data dispara `input` a cada digito do
  // ano, e cada disparo empurraria uma entrada no historico do navegador.
  sidebar?.querySelectorAll("[data-match-date]").forEach((campo) => {
    campo.addEventListener("change", () => {
      const alvo = campo.dataset.matchDate === "from" ? "matchDateFrom" : "matchDateTo";
      state[alvo] = campo.value || "";
      // Inverteu o intervalo: em vez de devolver lista vazia sem explicacao, a
      // outra ponta acompanha.
      if (state.matchDateFrom && state.matchDateTo && state.matchDateFrom > state.matchDateTo) {
        if (alvo === "matchDateFrom") state.matchDateTo = state.matchDateFrom;
        else state.matchDateFrom = state.matchDateTo;
      }
      pushFilterState("matches", matchFiltersToQuery(), `[data-match-date="${campo.dataset.matchDate}"]`);
    });
  });
  document.getElementById("match-team-query")?.addEventListener("input", (event) => {
    state.matchTeamQuery = event.target.value;
    const options = document.querySelector("[data-team-options]");
    if (options) options.innerHTML = matchTeamOptionsHtml();
  });
}

function toggleResultFilterValue(key, value) {
  const current = Array.isArray(state[key]) ? state[key] : [];
  state[key] = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function resetResultFilters() {
  state.matchBestOf = "all";
  state.matchMaps = state.db.maps.map((map) => map.id);
  state.matchTournaments = visibleTournaments().map((event) => event.id);
  state.matchTeams = [];
  state.matchTeamQuery = "";
  state.matchDateFrom = "";
  state.matchDateTo = "";
  state.resultFilterOpen = {
    bestOf: false,
    maps: false,
    tournaments: false,
    datas: false,
    teams: false,
  };
}

function filteredPlayers() {
  const nameQuery = normalize(state.playerQuery);
  const teamQuery = normalize(state.playerTeamQuery);
  const rows = state.db.players
    .filter((player) => {
      const nick = normalize(`${player.nick} ${player.handle} ${(player.nickHistory || []).join(" ")}`);
      return !nameQuery || nick.includes(nameQuery);
    })
    .filter((player) => {
      const team = teamById(player.teamId);
      const observed = teamById(player.observedTeamId);
      const teamText = normalize(`${team?.name || ""} ${team?.tag || ""} ${observed?.name || ""} ${observed?.tag || ""}`);
      return !teamQuery || teamText.includes(teamQuery);
    })
    .filter((player) => state.playerTeam === "all" || player.teamId === state.playerTeam || player.observedTeamId === state.playerTeam)
    .filter((player) => state.playerInitial === "all" || normalize(player.nick).charAt(0).toUpperCase() === state.playerInitial);
  return rows.sort((a, b) => String(a.nick || "").localeCompare(String(b.nick || ""), "pt-BR", { numeric: true, sensitivity: "base" }) || String(a.handle || "").localeCompare(String(b.handle || ""), "pt-BR", { numeric: true, sensitivity: "base" }));
}

function bindPlayerFilters() {
  document.getElementById("player-query")?.addEventListener("input", (event) => {
    state.playerQuery = event.target.value;
    refreshPlayersKeepingFocus("player-query", event.target.selectionStart);
  });
  document.getElementById("player-query")?.addEventListener("change", () => {
    pushFilterState("players", playerFiltersToQuery(), "#player-query");
  });
  document.getElementById("player-team-query")?.addEventListener("input", (event) => {
    state.playerTeamQuery = event.target.value;
    refreshPlayersKeepingFocus("player-team-query", event.target.selectionStart);
  });
  document.querySelectorAll("[data-player-team-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.playerTeam = button.dataset.playerTeamFilter || "all";
      pushFilterState("players", playerFiltersToQuery(), `[data-player-team-filter="${button.dataset.playerTeamFilter || "all"}"]`);
    });
  });
  document.getElementById("player-team")?.addEventListener("change", (event) => {
    state.playerTeam = event.target.value;
    pushFilterState("players", playerFiltersToQuery(), "#player-team");
  });
  document.querySelectorAll("[data-letter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.playerInitial = button.dataset.letter;
      pushFilterState("players", playerFiltersToQuery(), `[data-letter="${button.dataset.letter}"]`);
    });
  });
}

function refreshPlayersKeepingFocus(inputId, caret) {
  state.skipFilterHydration = true;
  renderPlayersCompact();
  const input = document.getElementById(inputId);
  if (!input) return;
  input.focus();
  if (Number.isFinite(caret)) input.setSelectionRange(caret, caret);
}

function playerInitialOptions() {
  const letters = new Set(state.db.players.map((player) => normalize(player.nick).charAt(0).toUpperCase()).filter(Boolean));
  return ["all", ...[...letters].sort((a, b) => a.localeCompare(b))];
}

function playerFigure(player, team, extra = "") {
  // Toda celula da faixa mostra um rosto no mesmo lugar: quem nao tem foto
  // recebe a silhueta, entao a linha dos olhos nao pula de um card para o
  // outro e o retangulo nunca aparece vazio.
  const accent = team ? teamAccentStyle(team) : "";
  const photo = player?.photo ? assetPath(player.photo) : "";
  if (!photo) {
    return `<span class="player-figure is-silhouette ${escapeHtml(extra)}" ${accent}><img src="${escapeHtml(assetPath(PLAYER_FALLBACK_PHOTO))}" alt="" loading="lazy" onerror="this.onerror=null; this.remove()" /></span>`;
  }
  return `<span class="player-figure ${escapeHtml(extra)}" ${accent}><img src="${escapeHtml(photo)}" alt="" loading="lazy" onerror="playerFigureError(this)" /></span>`;
}

function playerFigureError(image) {
  const figure = image?.closest(".player-figure");
  if (!figure) return;
  // Trocar o src em vez de remover a imagem: a silhueta ocupa o mesmo espaco
  // da foto que falhou, entao a altura da celula nao muda depois do carregamento.
  figure.classList.add("is-silhouette");
  image.onerror = null;
  image.src = assetPath(PLAYER_FALLBACK_PHOTO);
}

// Enquanto o banco completo não chegou, os líderes vêm prontos do home.json.
// O `category` sintético devolve o valor já formatado no build, então
// weekLeadCard e weekTile não precisam saber de onde veio.
function homeSummaryLeaders() {
  return (state.homeSummary?.leaders || []).map((leader) => ({
    category: {
      key: leader.key,
      label: leader.label,
      statLabel: leader.statLabel,
      format: () => leader.value,
      support: leader.support,
    },
    player: leader.player,
    windowLabel: leader.windowLabel,
  }));
}

function weekHighlights() {
  const leaders = state.homeSummary ? homeSummaryLeaders() : playerOfWeekLeaders();
  const note = `Mínimo de ${PLAYER_OF_WEEK_MIN_MAPS} mapas jogados no período exibido para entrar.`;
  if (!leaders.length) {
    return `
      <section class="week-board week-board-empty" aria-labelledby="week-board-title">
        <header class="week-board-head">
          <h2 id="week-board-title">Melhores da semana</h2>
        </header>
        <p class="empty-state">Nenhum jogador atingiu o mínimo de ${PLAYER_OF_WEEK_MIN_MAPS} mapas nesta janela.</p>
      </section>
    `;
  }
  const [lead, ...rest] = leaders;
  return `
    <section class="week-board" aria-labelledby="week-board-title">
      <header class="week-board-head">
        <h2 id="week-board-title">Melhores da semana</h2>
        <span class="week-board-range">${escapeHtml(lead.windowLabel)}</span>
        <small class="week-board-note">${escapeHtml(note)}</small>
      </header>
      <div class="week-board-body">
        ${weekLeadCard(lead)}
        <ul class="week-rail">${rest.map(weekTile).join("")}</ul>
      </div>
    </section>
  `;
}

function weekLeadCard({ category, player }) {
  const team = teamById(player.teamId);
  const tag = team?.sourceTag || team?.tag || player.teamTag || "";
  return `
    <a class="week-lead" href="${playerHref(player)}">
      ${playerFigure(player, team, "week-lead-figure")}
      <span class="week-lead-copy">
        <small class="week-lead-category">${escapeHtml(category.label)}</small>
        <strong class="week-lead-nick" title="${escapeHtml(player.nick)}">${escapeHtml(player.nick)}</strong>
        <span class="week-lead-team">${team ? teamLogo(team.id) : ""}<em>${escapeHtml(tag)}</em></span>
      </span>
      <span class="week-lead-value">
        <strong>${escapeHtml(category.format(player))}</strong>
        <small>${escapeHtml(category.statLabel)}</small>
      </span>
      ${weekSupportStats(category, player, "week-lead-detail")}
      <span class="week-lead-context">${escapeHtml(`${player.matches} mapas · ${player.rounds} rounds`)}</span>
    </a>
  `;
}

function weekTile({ category, player }) {
  const team = teamById(player.teamId);
  return `
    <li>
      <a class="week-tile" href="${playerHref(player)}">
        ${playerFigure(player, team, "week-tile-figure")}
        ${weekSupportStats(category, player, "week-tile-detail")}
        <span class="week-tile-nick" title="${escapeHtml(player.nick)}">${escapeHtml(player.nick)}</span>
        ${team ? teamLogo(team.id, "week-tile-crest") : `<span class="week-tile-crest"></span>`}
        <span class="week-tile-stat">
          <small class="week-tile-category">${escapeHtml(category.statLabel)}</small>
          <strong class="week-tile-value">${escapeHtml(category.format(player))}</strong>
        </span>
      </a>
    </li>
  `;
}

function playerOfWeekLeaders() {
  const { players, start, end } = playerOfWeekWindow();
  if (!players.length) return [];
  const windowLabel = `${playerWeekDateLabel(start)} - ${playerWeekDateLabel(end)}`;
  return PLAYER_OF_WEEK_CATEGORIES
    .map((category) => {
      const player = playerOfWeekLeader(players, category);
      return player ? { category, player, windowLabel } : null;
    })
    .filter(Boolean);
}

function playerOfWeekWindow() {
  const cutoffAt = Number(latestRankingSnapshot()?.cutoffAt || rankingTuesdayStartOnOrBefore(Date.now()));
  const allMatches = state.db?.matches || [];
  const earliestMatchAt = allMatches.reduce((earliest, match) => {
    const startedAt = Number(match.startedAt || 0);
    return startedAt && startedAt <= cutoffAt ? Math.min(earliest, startedAt) : earliest;
  }, Infinity);
  let start = cutoffAt - WEEK_MS;

  while (true) {
    const matches = allMatches.filter((match) => {
      const startedAt = Number(match.startedAt || 0);
      return startedAt >= start && startedAt <= cutoffAt;
    });
    const players = weeklyPlayerRows(matches);
    const reachedFirstMatch = Number.isFinite(earliestMatchAt) ? start <= earliestMatchAt : true;
    if (players.length || reachedFirstMatch) return { start, end: cutoffAt, matches, players };
    start -= WEEK_MS;
  }
}

function weeklyPlayerRows(matches) {
  const rows = new Map();
  for (const match of matches || []) {
    for (const player of match.players || []) {
      if (!player.id) continue;
      const base = playerById(player.id) || player;
      const teamId = match.teamA?.color === player.teamColor ? match.teamA.id : match.teamB?.id;
      const row = rows.get(player.id) || {
        id: player.id,
        puuid: player.puuid || base.puuid || player.id,
        nick: base.nick || player.nick || "Jogador",
        handle: base.handle || player.handle || player.nick || "Jogador",
        photo: base.photo || player.photo || "",
        currentTeam: base.currentTeam || "",
        teams: new Map(),
        matches: 0,
        rounds: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        score: 0,
        damage: 0,
        firstKills: 0,
        firstDeaths: 0,
        kastRounds: 0,
        impactTotal: 0,
        ...emptyRaatingAggregateFields(),
      };
      row.matches += 1;
      row.rounds += Number(player.rounds || 0);
      row.kills += Number(player.kills || 0);
      row.deaths += Number(player.deaths || 0);
      row.assists += Number(player.assists || 0);
      row.score += Number(player.score || 0);
      row.damage += Number(player.damage || 0);
      row.firstKills += Number(player.firstKills || 0);
      row.firstDeaths += Number(player.firstDeaths || 0);
      row.kastRounds += Number(player.kastRounds || 0);
      row.impactTotal += Number(player.impactTotal || 0);
      addRaatingAggregateFields(row, player);
      if (teamId) row.teams.set(teamId, (row.teams.get(teamId) || 0) + 1);
      rows.set(player.id, row);
    }
  }

  return [...rows.values()]
    .map((player) => {
      const observedTeamId = [...player.teams.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || player.currentTeam || "";
      player.teamId = observedTeamId;
      player.teamTag = teamById(observedTeamId)?.sourceTag || teamById(observedTeamId)?.tag || observedTeamId;
      player.acs = player.rounds ? player.score / player.rounds : 0;
      player.adr = player.rounds ? player.damage / player.rounds : 0;
      player.kpr = player.rounds ? player.kills / player.rounds : 0;
      player.dpr = player.rounds ? player.deaths / player.rounds : 0;
      player.apr = player.rounds ? player.assists / player.rounds : 0;
      player.kd = player.deaths ? player.kills / player.deaths : player.kills;
      player.kastFrac = player.rounds ? player.kastRounds / player.rounds : 0;
      player.kast = player.kastFrac * 100;
      player.impactRound = player.rounds ? player.impactTotal / player.rounds : 0;
      player.impactRoundLegacy = player.rounds ? Number(player.impactTotalLegacy || 0) / player.rounds : 0;
      player.kastLegacyFrac = player.rounds ? Number(player.kastLegacyRounds || 0) / player.rounds : player.kastFrac;
      player.kastLegacy = player.kastLegacyFrac * 100;
      applyRaatingFields(player);
      return player;
    })
    .filter((player) => player.rounds > 0 && player.matches >= PLAYER_OF_WEEK_MIN_MAPS);
}

function playerOfWeekLeader(players, category) {
  return players.slice().sort((a, b) => {
    const valueA = Number(category.value(a) || 0);
    const valueB = Number(category.value(b) || 0);
    const metricDiff = category.lowIsBetter ? valueA - valueB : valueB - valueA;
    if (metricDiff !== 0) return metricDiff;
    return b.rounds - a.rounds || Number(officialRatingValue(b) || 0) - Number(officialRatingValue(a) || 0) || a.nick.localeCompare(b.nick, "pt-BR");
  })[0] || null;
}

function playerWeekDateLabel(value) {
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

// A capa so e baixada quando o ponteiro chega na linha: nenhum byte cobrado de
// quem nunca passa o mouse pelo painel. Depois da primeira vez a classe fica, e
// entrar e sair da linha vira so opacidade - sem novo pedido, sem piscada.
// O `img.onload` existe para nao acender a camada em cima de um buraco: o veu
// escuro sozinho parece um bug ate a arte chegar.
function bindHomeEventCovers() {
  // Espelha o @media do CSS: sem ponteiro fino nao ha o que revelar, entao nem
  // o download acontece.
  if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
  const panel = document.querySelector(".events-panel");
  if (!panel) return;
  const revelar = (row) => {
    const capa = row?.dataset?.cover;
    if (!capa) return;
    delete row.dataset.cover;
    const img = new Image();
    img.onload = () => {
      row.style.setProperty("--event-capa", `url("${capa}")`);
      row.classList.add("tem-capa");
    };
    img.src = capa;
  };
  panel.addEventListener("pointerover", (event) => revelar(event.target.closest(".event-row")));
  panel.addEventListener("focusin", (event) => revelar(event.target.closest(".event-row")));
}

function bindHomeRankingPanel() {
  const panel = document.querySelector(".ranking-panel");
  panel?.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    if (event.target.closest("a, button, input, select, textarea")) return;
    window.location.hash = "#/ranking";
  });
}

function compactRankingRow(team) {
  const score = team.rankingScore ?? team.points;
  const snapshot = latestRankingSnapshot();
  const ranking = snapshot?.byTeamId?.[team.id] || team.ranking;
  return `
    <a class="compact-ranking-row pintura-de-equipe" href="#/ranking/${escapeHtml(team.id)}" data-home-ranking-team="${escapeHtml(team.id)}" ${teamAccentStyle(team)}>
      <span class="rank-position">${teamShortRankLabel(team)}</span>
      ${rankingPositionChangeBadge({ team, ranking, snapshot }, "rank-delta")}
      ${teamLogo(team.id)}
      <span class="row-main"><strong>${escapeHtml(team.name)}</strong><small>${team.matches || team.wins + team.losses} partidas - ${team.sourceTag || team.tag}</small></span>
      <span class="row-score">${fmt(score, 1)}</span>
    </a>
  `;
}

function matchListScore(item) {
  const series = normalizeMatchItem(item);
  if (series.mapCount > 1) {
    return {
      a: series.scoreA,
      b: series.scoreB,
      label: series.label,
      detail: series.mapNames.join(" / "),
    };
  }
  const match = series.maps[0];
  return {
    a: match.teamA.score,
    b: match.teamB.score,
    label: match.mapName,
    detail: match.mapName,
  };
}

function matchSeriesMetaLabel(item) {
  const series = normalizeMatchItem(item);
  if (series.mapCount > 1) return `${series.mapCount} mapas: ${series.mapNames.join(" / ")}`;
  return `MVP: ${series.mvp ? series.mvp.nick : "-"}`;
}

// Opcoes num objeto de proposito: `.map(matchResultRow)` passa o indice no
// segundo argumento, e um numero nao tem `.when` nem `.art`. Assim as cinco
// listas que chamam pelo `.map` cru recebem exatamente o padrao (data, sem
// arte de mapa) sem precisar saber que o indice chega ali.
// A data e o padrao porque so uma das sete listas agrupa por dia; nas outras
// a hora sozinha ("16:17") nao respondia "quando foi isso". Quem agrupa pede
// `{ when: "hour" }`, porque la o dia ja e o cabecalho do grupo.
// A arte do mapa so e emitida por quem a exibe: o CSS a esconde fora da home,
// e gerar essa marcacao nas outras listas custava 253 nos de DOM em /partidas.
function matchResultRow(item, options) {
  const opts = options && typeof options === "object" ? options : {};
  const series = normalizeMatchItem(item);
  const score = matchListScore(series);
  const event = state.db.tournaments.find((row) => row.id === series.eventId);
  const when = opts.when === "hour" ? formatDate(series.startedAt, "hour") : formatDate(series.startedAt);
  return `
    <a class="result-row" href="${matchSeriesHref(series)}">
      ${opts.art ? matchMapBanner(series) : ""}
      <span class="result-team left">${teamLogo(series.teamA.id)}<strong title="${escapeHtml(series.teamA.name)}">${escapeHtml(series.teamA.name)}</strong></span>
      <span class="result-score"><b class="${scoreNumberClass(score.a, score.b)}">${score.a}</b><i>:</i><b class="${scoreNumberClass(score.b, score.a)}">${score.b}</b><small>${escapeHtml(score.label)}</small></span>
      <span class="result-team right"><strong title="${escapeHtml(series.teamB.name)}">${escapeHtml(series.teamB.name)}</strong>${teamLogo(series.teamB.id)}</span>
      ${matchMapStrip(series)}
      <span class="result-meta"><span class="result-meta-when">${escapeHtml(when)}</span>${opts.art ? matchMapSequence(series) : ""}<span class="result-meta-where">${escapeHtml(event?.name || "Evento")}</span>${event ? eventLogo(event, "tiny") : ""}</span>
    </a>
  `;
}

// Os mapas na ordem em que foram jogados, no meio da faixa de cima. Numa md3 ou
// md5 a sequencia e parte do resultado - antes so o primeiro mapa aparecia, sob
// o placar. So a home mostra isso: nas listas cheias os mapas ja tem a propria
// tira com placar por mapa (.result-maps), e repetir os nomes seria ruido.
function matchMapSequence(item) {
  const series = normalizeMatchItem(item);
  const names = (series.mapNames || []).filter(Boolean);
  if (!names.length) return "";
  // --maps alimenta a largura do holofote e a das fatias: os nomes e as artes
  // usam a mesma conta, entao cada nome cai centrado sobre o proprio mapa.
  return `<span class="result-meta-maps" style="--maps:${names.length}">${names
    .map((name) => `<span class="result-meta-map">${escapeHtml(name)}</span>`)
    .join("")}</span>`;
}

// Arte do mapa em versao web: 640x360 WebP (~20 KB) em vez do PNG de origem
// 1600x900 (~500 KB, e 2 MB no caso do summit). Nenhum lugar do site desenha
// essa arte acima de 640px de largura - nem o holofote da home nem o tile de
// 40px das listas cheias - entao o PNG grande nunca chegou a ser usado como
// PNG grande: so como download grande.
// O original fica no data-fallback e entra se o WebP faltar, para um mapa novo
// que ainda nao passou pela conversao nao aparecer sem arte nenhuma.
function mapArtAttrs(map, preferred) {
  const original = assetPath(preferred || map?.icon || "");
  const web = map?.id ? assetPath(`assets/maps/web/${map.id}.webp`) : "";
  if (!web && !original) return null;
  const src = web || original;
  const fallback = web && original && original !== web ? original : "";
  return { src, fallback };
}

function mapArtError(image) {
  if (!image) return;
  const fallback = image.dataset?.fallback;
  // Marca no elemento em vez de comparar `image.src` com o fallback: o getter
  // devolve URL absoluta e assetPath guarda caminho relativo, entao a
  // comparacao era sempre verdadeira - o handler reatribuia o mesmo src para
  // sempre e o ramo de limpeza abaixo nunca era alcancado.
  if (fallback && !image.dataset.artFallbackUsed) {
    image.dataset.artFallbackUsed = "1";
    image.src = fallback;
    return;
  }
  image.onerror = null;
  image.closest(".result-map-tile")?.classList.remove("has-banner");
  image.closest(".tournament-map-banner")?.classList.remove("has-image");
  image.closest(".tournament-map-agent-banner")?.classList.remove("has-banner");
  image.closest(".search-match-map-image")?.classList.add("missing-image");
  // A fatia vazia fica: e ela que segura a largura da coluna. Removendo o <i>,
  // as fatias restantes se redistribuiriam e os nomes acima sairiam do lugar.
  image.remove();
}

function mapBannerSrc(name) {
  return mapArtAttrs(mapByName(name));
}

// Uma fatia por mapa, na ordem jogada. Numa md3 o holofote vira tres paineis
// lado a lado separados por fio - a serie inteira aparece de uma vez, em vez de
// escolhermos um mapa "representativo" e esconder os outros.
function matchMapBanner(item) {
  const series = normalizeMatchItem(item);
  const names = (series.mapNames || []).filter(Boolean);
  // Uma fatia por NOME, e nao por arte encontrada. Filtrar as que nao resolvem
  // deixava, numa md3 com um mapa novo fora da base, tres nomes sobre duas
  // fatias: `--maps` dizia 3, as duas fatias flex dividiam a largura em 50%
  // cada e os nomes deixavam de cair sobre a propria arte. A fatia sem arte
  // entra vazia e segura a coluna.
  const slices = names.map((name) => mapBannerSrc(name));
  if (!slices.some(Boolean)) return "";
  return `<span class="result-banner" aria-hidden="true" style="--maps:${names.length}">${slices
    .map((art) =>
      art
        ? `<i><img src="${escapeHtml(art.src)}" data-fallback="${escapeHtml(art.fallback)}" alt="" loading="lazy" onerror="mapArtError(this)" /></i>`
        : "<i></i>",
    )
    .join("")}</span>`;
}

function matchMapStrip(item) {
  const series = normalizeMatchItem(item);
  const maps = series.maps.slice(0, 3);
  const extra = Math.max(0, series.maps.length - maps.length);
  return `
    <span class="result-maps" aria-label="Mapas da série">
      ${maps.map((match, index) => matchMapTile(match, series, index)).join("")}
      ${extra ? `<span class="result-map-extra">+${extra}</span>` : ""}
    </span>
  `;
}

function matchMapTile(match, series, index) {
  const map = mapById(match.mapId) || mapByName(match.mapName) || {};
  const art = mapArtAttrs(map, match.mapIcon);
  const scoreA = scoreForTeamInMatch(match, series.teamA.id);
  const scoreB = scoreForTeamInMatch(match, series.teamB.id);
  const name = map.name || match.mapName || `Mapa ${index + 1}`;
  const mapNumber = match.mapNumber || index + 1;
  const winnerClass = match.winnerId === series.teamA.id ? "left-win" : "right-win";
  const bannerClass = art ? "has-banner" : "";
  return `
    <span class="result-map-tile ${winnerClass} ${bannerClass}" data-map="${escapeHtml(name)}" title="${escapeHtml(`${name} ${scoreA}-${scoreB}`)}">
      ${art ? `<img src="${escapeHtml(art.src)}" data-fallback="${escapeHtml(art.fallback)}" alt="${escapeHtml(name)}" loading="lazy" onerror="mapArtError(this)" />` : ""}
      <span class="result-map-index">M${mapNumber}</span>
      <span class="result-map-score">${scoreA}-${scoreB}</span>
    </span>
  `;
}

// A capa de hero e pesada demais para hover: 121 KB de media, 315 KB no pior
// caso, e por isso ela ja estava fora do aquecimento de cache. A variante de
// linha sai de scripts/build_event_row_banners.py e mora em row/ - 17 KB de
// media, recortada em 646x260, que e 2x a maior linha medida (323x130).
function eventRowCoverPath(event) {
  const banner = String(event?.banner || "").trim();
  if (!banner) return "";
  const nome = banner.split("/").pop().replace(/\.[^.]+$/, "");
  return nome ? `assets/tournament-banners/row/${nome}.webp` : "";
}

function eventListRow(event) {
  const capa = eventRowCoverPath(event);
  return `
    <a class="event-row" href="#/events/${event.id}"${capa ? ` data-cover="${escapeHtml(assetPath(capa))}"` : ""}>
      ${eventLogo(event, "small")}
      <span class="row-main"><strong>${escapeHtml(event.name)}</strong><small>${escapeHtml(eventTimeRange(event))}</small><span class="event-status ${eventStatusClass(event.status)}">${escapeHtml(event.status || "Evento")}</span></span>
      ${eventTierBadge(event)}
      <span class="event-numbers">${event.matches} partidas<br>${event.teams.length} equipes</span>
    </a>
  `;
}

// O tier e a unica hierarquia entre campeonatos que o site publica, e ate aqui
// so aparecia dentro da pagina do evento. Cada nivel ganha cor propria - nunca
// o vermelho, que neste site e marca e nao dado.
function eventTierBadge(event) {
  const tier = String(event?.tier || "")
    .trim()
    .replace(/^tier\s*/i, "")
    .toUpperCase();
  if (!tier) return "";
  const key = /^[SABCD]$/.test(tier) ? tier.toLowerCase() : "other";
  // Letra grande e solta no vao que sobrava entre o nome e as contagens. Sem
  // caixa: o selo com contorno foi reprovado por parecer feito por IA, e um
  // dado de um caractere nao precisa de moldura para ser lido - o tamanho e a
  // cor ja o separam de tudo em volta. O nome inteiro fica no rotulo acessivel.
  return `<span class="event-tier tier-${key}" title="Tier ${escapeHtml(tier)}" aria-label="Tier ${escapeHtml(tier)}" role="img">${escapeHtml(tier)}</span>`;
}

function eventDirectoryRow(event) {
  const matches = matchSeriesForEvent(event.id);
  const teamTotal = Number(event.teamCount || 0) || event.teams.length;
  const featuredTeams = eventFeaturedTeamIds(event, matches, 8)
    .map((teamId) => tournamentTeamById(event, teamId))
    .filter(Boolean);
  return `
    <a class="event-row event-row-rich" href="#/events/${event.id}">
      <span class="event-row-identity">
        ${eventLogo(event, "small")}
        <span class="row-main event-row-title">
          <strong>${escapeHtml(event.name)}</strong>
          <small>${escapeHtml(eventTimeRange(event))}</small>
          <span class="event-status ${eventStatusClass(event.status)}">${escapeHtml(event.status || "Evento")}</span>
        </span>
      </span>
      <span class="event-row-facts" aria-label="Dados do torneio">
        ${eventFact(event.prizePool || event.prize || "A definir", "Prizepool")}
        ${eventFact(teamTotal, "Times")}
        ${eventFact(event.tier || "A definir", "Tier")}
        ${eventFact(event.type || "A definir", "Tipo")}
        ${eventFact(tournamentFormatLabel(event, matches), "Formato", "format")}
      </span>
      <span class="event-row-participants">
        ${eventParticipantStack(featuredTeams, teamTotal)}
        <small>Equipes Participantes</small>
      </span>
    </a>
  `;
}

function eventFact(value, label, extra = "") {
  return `
    <span class="event-fact ${escapeHtml(extra)}" title="${escapeHtml(String(value || "-"))}">
      <strong>${escapeHtml(String(value || "-"))}</strong>
      <small>${escapeHtml(label)}</small>
    </span>
  `;
}

function eventFeaturedTeamIds(event, matches = [], limit = 8) {
  const ids = [];
  const seen = new Set();
  const add = (teamId) => {
    if (!teamId || seen.has(teamId)) return;
    seen.add(teamId);
    ids.push(teamId);
  };

  if (event.placements?.length) {
    normalizePlacementRowsForDisplay(event.placements)
      .slice()
      .sort((a, b) => (a.placementStart || 999) - (b.placementStart || 999) || a.originalIndex - b.originalIndex)
      .forEach((row) => add(row.id || row.teamId));
  }

  if (ids.length < limit) {
    eventStandings(matches).forEach((row) => add(row.id));
  }

  if (ids.length < limit) {
    (event.teams || [])
      .map((teamId) => tournamentTeamById(event, teamId))
      .filter(Boolean)
      .sort(compareTeamsByCanonicalRank)
      .forEach((team) => add(team.id));
  }

  return ids.slice(0, limit);
}

function eventParticipantStack(teams, teamTotal) {
  if (!teams.length) return `<span class="event-team-stack muted">Sem equipes</span>`;
  const remaining = Math.max(0, teamTotal - teams.length);
  return `
    <span class="event-team-stack" aria-label="${escapeHtml(teams.map((team) => team.name).join(", "))}">
      ${teams.map((team) => `<span class="event-team-badge" title="${escapeHtml(team.name)}">${teamLogo(team.id, "event-participant-logo")}</span>`).join("")}
      ${remaining ? `<span class="event-team-extra" title="${escapeHtml(`${remaining} equipes restantes`)}">+${remaining}</span>` : ""}
    </span>
  `;
}

function playerDirectoryTable(players) {
  if (!players.length) return `<div class="empty-state">Nenhum player encontrado.</div>`;
  return `<div class="player-card-grid">${players.map(playerDirectoryCard).join("")}</div>`;
}

function playerDirectoryCard(player) {
  const team = teamById(player.teamId) || teamById(player.currentTeam) || teamById(player.observedTeamId);
  const name = playerDirectoryName(player);
  const currentNick = playerCurrentNick(player);
  const teamName = team?.name || "Sem time atual";
  const teamTag = team ? team.sourceTag || team.tag || team.id : "Sem time";
  return `
    <a class="player-directory-card" href="${playerHref(player)}" aria-label="${escapeHtml(`${name} - ${currentNick} - ${teamName}`)}">
      <span class="player-directory-photo">
        ${playerLogo(player.id, "player-directory-avatar")}
      </span>
      <span class="player-directory-body">
        <span class="player-directory-field primary">
          <strong title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
        </span>
        <span class="player-directory-field nick-line">
          <small>Nick atual</small>
          <span title="${escapeHtml(currentNick)}">${escapeHtml(currentNick)}</span>
        </span>
        <span class="player-directory-team">
          ${team ? teamLogo(team.id, "tiny player-directory-team-logo") : `<span class="team-logo clean-logo tiny logo-empty player-directory-team-logo" aria-label="Sem time"></span>`}
          <span>
            <strong title="${escapeHtml(teamName)}">${escapeHtml(teamName)}</strong>
            <em>${escapeHtml(teamTag)}</em>
          </span>
        </span>
      </span>
    </a>
  `;
}

function playerDirectoryName(player) {
  return player?.nick || player?.apiNick || player?.handle || "Jogador";
}

function playerCurrentNick(player) {
  const nicks = (player?.nickHistory || []).filter(Boolean);
  return player?.handle || nicks[nicks.length - 1] || player?.apiNick || player?.nick || "Nick em atualização";
}

function bindSearch() {
  const input = document.getElementById("global-search");
  const results = document.getElementById("search-results");
  if (!input || !results) return;

  const renderResults = () => {
    state.search = input.value;
    const query = normalize(input.value);
    if (!query) {
      state.searchOpen = false;
      results.classList.remove("open");
      results.innerHTML = "";
      return;
    }
    const rows = searchEntities().filter((item) => normalize(item.searchText || `${item.label} ${item.meta || ""}`).includes(query)).slice(0, 10);
    state.searchOpen = true;
    results.classList.add("open");
    input.setAttribute("aria-expanded", "true");
    results.innerHTML = rows.length
      ? rows.map((item, index) => renderSearchResult(item, index)).join("")
      : `<div class="empty-state">Nenhuma entidade encontrada.</div>`;
    anunciar(rows.length);
    ativo = -1;
    sincronizarAtivo();
    results.querySelectorAll("[data-path]").forEach((button) => {
      button.addEventListener("click", () => abrir(button));
    });
  };

  const status = document.getElementById("search-status");
  let ativo = -1;

  const anunciar = (n) => {
    if (!status) return;
    status.textContent = n === 0 ? "Nenhum resultado." : n === 1 ? "1 resultado." : `${n} resultados.`;
  };

  const opcoes = () => [...results.querySelectorAll("[data-path]")];

  const sincronizarAtivo = () => {
    const lista = opcoes();
    lista.forEach((el, i) => {
      const marcado = i === ativo;
      el.setAttribute("aria-selected", String(marcado));
      el.classList.toggle("is-active", marcado);
      if (marcado) el.scrollIntoView({ block: "nearest" });
    });
    if (ativo >= 0 && lista[ativo]) input.setAttribute("aria-activedescendant", lista[ativo].id);
    else input.removeAttribute("aria-activedescendant");
  };

  const mover = (passo) => {
    const lista = opcoes();
    if (!lista.length) return;
    const n = lista.length;
    if (ativo === -1) ativo = passo > 0 ? 0 : n - 1;
    else {
      ativo += passo;
      if (ativo < 0) ativo = n - 1;
      else if (ativo >= n) ativo = 0;
    }
    sincronizarAtivo();
  };

  const fechar = () => {
    state.searchOpen = false;
    results.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    ativo = -1;
  };

  function abrir(button) {
    state.search = "";
    fechar();
    window.location.hash = `#/${button.dataset.path}`;
  }

  input.addEventListener("input", renderResults);
  input.addEventListener("focus", renderResults);

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); mover(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); mover(-1); return; }
    if (event.key === "Enter") {
      const lista = opcoes();
      if (ativo >= 0 && lista[ativo]) { event.preventDefault(); abrir(lista[ativo]); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); fechar(); input.blur(); }
  });

  // O selo "/" ao lado do campo prometia este atalho desde sempre.
  if (!state.searchHotkeyBound) {
    state.searchHotkeyBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const alvo = event.target;
      const digitando = alvo && (alvo.isContentEditable || /^(input|textarea|select)$/i.test(alvo.tagName));
      if (digitando) return;
      const campo = document.getElementById("global-search");
      if (!campo || campo.disabled) return;
      event.preventDefault();
      campo.focus();
      campo.select();
    });
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".global-search")) fechar();
  });
  renderResults();
}

function searchEntities() {
  const db = state.db;
  return [
    ...visibleTournaments().map(searchTournamentResult),
    ...db.teams.map(searchTeamResult),
    ...db.maps.map((map) => ({
      type: "map",
      path: `maps/${map.id}`,
      label: map.name,
      meta: `${map.matches} partidas`,
      entity: map,
      searchText: map.name,
      visual: mapLogo(map.id),
      colors: map.colors,
      mark: map.name.slice(0, 3).toUpperCase(),
    })),
    ...db.players.map(searchPlayerResult),
    ...allMatchSeries().map((series) => {
      const score = matchListScore(series);
      const event = state.db?.tournaments.find((row) => row.id === series.eventId);
      const patch = matchSearchPatchLabel(series);
      return {
        type: "match",
        path: matchSeriesRoute(series),
        label: `${series.teamA.name} ${score.a} x ${score.b} ${series.teamB.name}`,
        meta: `${score.label} - ${score.detail} - ${formatDate(series.startedAt, "time")} - ${event?.name || "Campeonato"} - ${patch}`,
        entity: series,
        searchText: matchSearchText(series, score, event, patch),
        colors: ["#181715", "#d8323c"],
        mark: score.label.slice(0, 3).toUpperCase(),
      };
    }),
  ];
}

function searchTeamResult(team) {
  const tag = teamSearchTagLabel(team);
  const stateLabel = teamStateSearchLabel(team);
  const institution = teamInstitutionLabel(team);
  return {
    type: "team",
    path: `teams/${team.id}`,
    label: team.name,
    meta: `${tag} - ${stateLabel} - ${institution}`,
    entity: team,
    searchText: `${team.name} ${team.id} ${tag} ${team.shortTag || ""} ${stateLabel} ${institution}`,
  };
}

function searchPlayerResult(player) {
  const team = playerPrimaryTeam(player);
  const teamName = team?.name || "Sem time";
  const teamTag = team ? teamSearchTagLabel(team) : "";
  return {
    type: "player",
    path: playerPath(player),
    label: player.nick,
    meta: `${player.handle || player.nick} - atual: ${teamName}`,
    entity: player,
    searchText: `${player.nick} ${player.handle || ""} ${(player.nickHistory || []).join(" ")} ${teamName} ${teamTag}`,
  };
}

function searchTournamentResult(event) {
  const start = tournamentSearchStartLabel(event);
  const tier = tournamentTierSearchLabel(event);
  return {
    type: "tournament",
    path: `tournaments/${event.id}`,
    label: event.name,
    meta: `${tier} - ${start} - ${event.status || "Status a definir"} - ${event.matches} partidas`,
    entity: event,
    searchText: event.name,
  };
}

function matchSearchText(series, score, event, patch) {
  const teamA = matchSearchTeamAliases(series.teamA);
  const teamB = matchSearchTeamAliases(series.teamB);
  const primaryA = teamA[0] || series.teamA.name;
  const primaryB = teamB[0] || series.teamB.name;
  const scoreVariants = matchSearchScoreVariants(score.a, score.b);
  const reverseScoreVariants = matchSearchScoreVariants(score.b, score.a);
  const scorePhrases = scoreVariants.flatMap((scoreText) => [
    scoreText,
    `${primaryA} ${scoreText} ${primaryB}`,
    `${primaryA} ${scoreText}`,
    `${scoreText} ${primaryB}`,
  ]);
  const reverseScorePhrases = reverseScoreVariants.flatMap((scoreText) => [
    `${primaryB} ${scoreText} ${primaryA}`,
    `${primaryB} ${scoreText}`,
    `${scoreText} ${primaryA}`,
  ]);
  return [
    `${primaryA} ${score.a} x ${score.b} ${primaryB}`,
    ...teamA,
    ...teamB,
    ...scorePhrases,
    ...reverseScorePhrases,
    score.label,
    score.detail,
    event?.name || "",
    formatDate(series.startedAt, "time"),
    patch,
  ].filter(Boolean).join(" ");
}

function matchSearchTeamAliases(team) {
  const dbTeam = teamById(team?.id);
  return [...new Set([
    team?.name,
    dbTeam?.name,
    dbTeam ? teamSearchTagLabel(dbTeam) : "",
    team?.tag,
    dbTeam?.tag,
    dbTeam?.shortTag,
    dbTeam?.sourceTag,
    team?.id,
  ].filter(Boolean))];
}

function matchSearchScoreVariants(a, b) {
  return [
    `${a} x ${b}`,
    `${a}x${b}`,
    `${a} : ${b}`,
    `${a}:${b}`,
    `${a} - ${b}`,
    `${a}-${b}`,
  ];
}

function renderSearchResult(item, index = 0) {
  searchResultIndex = index;
  const renderers = {
    team: renderTeamSearchResult,
    player: renderPlayerSearchResult,
    tournament: renderTournamentSearchResult,
    match: renderMatchSearchResult,
    map: renderMapSearchResult,
  };
  return (renderers[item.type] || renderGenericSearchResult)(item);
}

function renderSearchButton(item, content, index = 0) {
  const type = item.type || "generic";
  const pos = index || searchResultIndex;
  return `<button class="search-result search-result-${escapeHtml(type)}" type="button" role="option" id="search-option-${pos}" aria-selected="false" data-path="${escapeHtml(item.path)}" aria-label="${escapeHtml(`Abrir ${item.label}`)}">${content}</button>`;
}

function renderTeamSearchResult(item) {
  const team = item.entity;
  const tag = teamSearchTagLabel(team);
  const stateLabel = teamStateSearchLabel(team);
  const institution = teamInstitutionLabel(team);
  return renderSearchButton(
    item,
    `
      <span class="search-result-visual">${teamLogo(team.id, "search-entity-logo")}</span>
      <span class="search-result-content">
        <span class="search-result-kicker">Time</span>
        <strong class="search-result-title">${escapeHtml(team.name)}</strong>
        <span class="search-result-meta">${escapeHtml(institution)}</span>
        <span class="search-team-facts">
          <span class="search-team-tag">${escapeHtml(tag)}</span>
          <span class="search-team-state">${teamSearchStateFlag(team)}<span>${escapeHtml(stateLabel)}</span></span>
        </span>
      </span>
    `,
  );
}

function renderPlayerSearchResult(item) {
  const player = item.entity;
  const team = playerPrimaryTeam(player);
  return renderSearchButton(
    item,
    `
      <span class="search-result-visual">${playerLogo(player.id, "search-player-photo")}</span>
      <span class="search-result-content">
        <span class="search-result-kicker">Jogador</span>
        <strong class="search-result-title">${escapeHtml(player.nick)}</strong>
        <span class="search-player-handle">${escapeHtml(player.handle || player.nick)}</span>
        <span class="search-player-team-line">
          ${team ? teamLogo(team.id, "search-player-team-logo") : `<span class="team-logo clean-logo logo-empty search-player-team-logo" aria-label="Sem time"></span>`}
          <span>${escapeHtml(team?.name || "Sem time")}</span>
          ${team ? `<em>${escapeHtml(teamSearchTagLabel(team))}</em>` : ""}
        </span>
      </span>
    `,
  );
}

function renderTournamentSearchResult(item) {
  const event = item.entity;
  return renderSearchButton(
    item,
    `
      <span class="search-result-visual">${eventLogo(event, "search-event-logo")}</span>
      <span class="search-result-content">
        <span class="search-result-kicker">Campeonato</span>
        <strong class="search-result-title">${escapeHtml(event.name)}</strong>
        <span class="search-tournament-facts">
          <span>${escapeHtml(tournamentTierSearchLabel(event))}</span>
          <span>${escapeHtml(tournamentSearchStartLabel(event))}</span>
          <span>${escapeHtml(event.status || "Status a definir")}</span>
          <span>${escapeHtml(`${event.matches} partidas`)}</span>
        </span>
      </span>
    `,
  );
}

function renderMatchSearchResult(item) {
  const series = item.entity;
  const score = matchListScore(series);
  const event = state.db?.tournaments.find((row) => row.id === series.eventId);
  return renderSearchButton(
    item,
    `
      ${matchSearchMapVisual(series)}
      <span class="search-result-content">
        <span class="search-result-kicker">Partida</span>
        <strong class="search-match-score-line">
          <span class="search-match-team search-match-team-a">
            ${teamLogo(series.teamA.id, "search-match-team-logo")}
            <span>${escapeHtml(series.teamA.name)}</span>
          </span>
          <b><span class="${scoreNumberClass(score.a, score.b)}">${escapeHtml(String(score.a))}</span><i>:</i><span class="${scoreNumberClass(score.b, score.a)}">${escapeHtml(String(score.b))}</span></b>
          <span class="search-match-team search-match-team-b">
            <span>${escapeHtml(series.teamB.name)}</span>
            ${teamLogo(series.teamB.id, "search-match-team-logo")}
          </span>
        </strong>
        <span class="search-match-event-line">
          ${event ? eventLogo(event, "search-match-event-logo") : ""}
          <span>${escapeHtml(event?.name || "Campeonato")}</span>
        </span>
        <span class="search-match-facts">
          <span>${escapeHtml(formatDate(series.startedAt, "time"))}</span>
          <span>${escapeHtml(matchSearchPatchLabel(series))}</span>
          <span>${escapeHtml(matchSearchMapLabel(series, score))}</span>
        </span>
      </span>
    `,
  );
}

function matchSearchMapVisual(series) {
  const maps = series.maps || [];
  const mapCount = Math.max(maps.length, 1);
  const countClass = mapCount > 1 ? "multi" : "single";
  return `
    <span class="search-result-visual search-match-map-visual ${countClass}" style="--search-match-map-count:${mapCount}" aria-label="${escapeHtml(matchSearchMapLabel(series, matchListScore(series)))}">
      ${maps.map(searchMatchMapImage).join("")}
    </span>
  `;
}

function searchMatchMapImage(match, index) {
  const asset = matchMapAsset(match);
  const label = asset.name || match?.mapName || `Mapa ${index + 1}`;
  return `
    <span class="search-match-map-image ${asset.src ? "" : "missing-image"}" title="${escapeHtml(label)}">
      ${asset.src ? `<img src="${escapeHtml(asset.src)}" data-fallback="${escapeHtml(asset.fallback)}" alt="${escapeHtml(label)}" loading="lazy" onerror="mapArtError(this)" />` : ""}
      <span>${escapeHtml(label.slice(0, 3).toUpperCase())}</span>
    </span>
  `;
}

function matchSearchMapLabel(series, score = matchListScore(series)) {
  if (series.mapCount > 1) return `${score.label} - ${score.detail}`;
  return score.detail || score.label || "Mapa";
}

function matchSearchPatchLabel(series) {
  const patches = [...new Set((series.maps || []).map((match) => patchLabel(match?.gameVersion || "")).filter((label) => label && label !== "-"))];
  if (!patches.length) return "Patch -";
  return `Patch ${patches.slice(0, 3).join(" / ")}${patches.length > 3 ? ` +${patches.length - 3}` : ""}`;
}

function mapSearchMatches(map) {
  const mapId = String(map?.id || "");
  const mapNameKey = normalizeNameKey(map?.name || "");
  const mapIdKey = normalizeNameKey(mapId);
  return (state.db?.matches || []).filter((match) => {
    const matchMapNameKey = normalizeNameKey(match.mapName || "");
    const matchMapIdKey = normalizeNameKey(match.mapId || "");
    return (mapId && match.mapId === mapId) || (mapNameKey && matchMapNameKey === mapNameKey) || (mapIdKey && matchMapIdKey === mapIdKey);
  });
}

function mapSearchPatchLabel(map) {
  const patches = [...new Set(mapSearchMatches(map).map((match) => patchLabel(match?.gameVersion || "")).filter((label) => label && label !== "-"))];
  if (!patches.length) return "Patch -";
  return `Patch ${patches.slice(0, 4).join(" / ")}${patches.length > 4 ? ` +${patches.length - 4}` : ""}`;
}

function mapSearchTournaments(map) {
  const tournamentsById = new Map((state.db?.tournaments || []).map((event) => [event.id, event]));
  const eventIds = [...new Set(mapSearchMatches(map).map((match) => match.eventId).filter(Boolean))];
  return eventIds.map((eventId) => tournamentsById.get(eventId)).filter(Boolean);
}

function mapSearchTournamentLogos(map) {
  const events = mapSearchTournaments(map);
  const visibleEvents = events.slice(0, 5);
  const extra = events.length - visibleEvents.length;
  if (!events.length) return `<span class="search-map-events search-map-events-empty">Sem campeonatos</span>`;
  return `
    <span class="search-map-events" aria-label="${escapeHtml(`${events.length} campeonatos`)}">
      ${visibleEvents.map((event) => eventLogo(event, "search-map-event-logo")).join("")}
      ${extra ? `<span class="search-map-event-extra">+${extra}</span>` : ""}
    </span>
  `;
}

function mapSearchBanner(map) {
  const art = mapArtAttrs(map);
  const label = map?.name || "Mapa";
  return `
    <span class="search-result-visual search-map-banner ${art ? "" : "missing-image"}" aria-label="${escapeHtml(label)}">
      ${art ? `<img src="${escapeHtml(art.src)}" data-fallback="${escapeHtml(art.fallback)}" alt="${escapeHtml(`Mapa ${label}`)}" loading="lazy" onerror="mapArtError(this)" />` : ""}
      <span>${escapeHtml(label.slice(0, 3).toUpperCase())}</span>
    </span>
  `;
}

function renderMapSearchResult(item) {
  const map = item.entity;
  return renderSearchButton(
    item,
    `
      ${mapSearchBanner(map)}
      <span class="search-result-content">
        <span class="search-result-kicker">Mapa</span>
        <strong class="search-result-title">${escapeHtml(map.name)}</strong>
        <span class="search-map-stats">${escapeHtml(`${map.matches} partidas - ${map.rounds} rounds`)}</span>
        <span class="search-map-facts">
          <span>${escapeHtml(mapSearchPatchLabel(map))}</span>
          ${mapSearchTournamentLogos(map)}
        </span>
      </span>
    `,
  );
}

function renderGenericSearchResult(item) {
  const visual = item.visual || logo(item.mark || "?", item.colors || ["#181715", "#d8323c"], "search-entity-logo");
  return renderSearchButton(
    item,
    `
      <span class="search-result-visual">${visual}</span>
      <span class="search-result-content">
        <span class="search-result-kicker">Resultado</span>
        <strong class="search-result-title">${escapeHtml(item.label)}</strong>
        <span class="search-result-meta">${escapeHtml(item.meta || "")}</span>
      </span>
    `,
  );
}

function teamSearchTagLabel(team) {
  return team?.sourceTag || team?.tag || team?.shortTag || team?.id || "Sem tag";
}

function teamStateSearchLabel(team) {
  return teamStateSearchInfo(team).label;
}

function teamStateSearchInfo(team) {
  const profile = team?.profile || {};
  const code = profile.state || team?.state || "";
  const name = profile.stateName || team?.stateName || "";
  const flag = profile.flag || team?.flag || team?.stateFlag || "";
  const label = code && name && normalize(name) !== normalize(code) ? `${name} - ${code}` : name || code || "Estado não informado";
  return { code, name, flag, label };
}

function teamSearchStateFlag(team) {
  const state = teamStateSearchInfo(team);
  const fallback = escapeHtml(state.code || "UF");
  return state.flag
    ? `<img class="search-state-flag" src="${escapeHtml(assetPath(state.flag))}" alt="Bandeira ${escapeHtml(state.label)}" loading="lazy" onerror="this.replaceWith(this.nextElementSibling)" /><span class="search-state-flag placeholder">${fallback}</span>`
    : `<span class="search-state-flag placeholder">${fallback}</span>`;
}

function teamInstitutionLabel(team) {
  const profile = team?.profile || {};
  return profile.org || team?.org || profile.orgTag || team?.orgTag || "Instituição não informada";
}

function tournamentSearchStartLabel(event) {
  return event?.start ? `Início ${formatDate(event.start)}` : "Início a definir";
}

function tournamentTierSearchLabel(event) {
  const tier = String(event?.tier || "").trim();
  if (!tier) return "Tier a definir";
  return /^tier\b/i.test(tier) ? tier : `Tier ${tier}`;
}

function metric(value, label) {
  return `<div class="metric-tile"><span class="metric-value">${value}</span><span class="metric-label">${escapeHtml(label)}</span></div>`;
}

function sectionHead(title, desc, routeName, linkLabel) {
  return `<div class="section-head"><div><h2>${escapeHtml(title)}</h2>${desc ? `<p>${escapeHtml(desc)}</p>` : ""}</div>${routeName ? `<a class="subtle-link" href="#/${routeName}">${escapeHtml(linkLabel)}</a>` : ""}</div>`;
}

function matchCard(item) {
  const series = normalizeMatchItem(item);
  const score = matchListScore(series);
  const event = state.db?.tournaments.find((row) => row.id === series.eventId);
  return `
    <a class="match-card" href="${matchSeriesHref(series)}">
      <div class="team-side">${teamLogo(series.teamA.id)}<strong>${escapeHtml(series.teamA.name)}</strong></div>
      <div class="score-box"><strong>${score.a} : ${score.b}</strong><span>${escapeHtml(score.label)}</span></div>
      <div class="team-side right"><strong>${escapeHtml(series.teamB.name)}</strong>${teamLogo(series.teamB.id)}</div>
      <div class="match-meta">
        ${event ? eventLogo(event, "tiny") : ""}
        <span>${escapeHtml(formatDate(series.startedAt, "time"))}</span>
        <span>${escapeHtml(event?.name || series.seriesCode || "Campeonato")}</span>
        <span>${escapeHtml(matchSeriesMetaLabel(series))}</span>
      </div>
    </a>
  `;
}

function teamCard(team) {
  if (!team) return "";
  const lineupCount = team.currentLineup?.length || team.lineup?.length || 0;
  return `
    <a class="entity-card" href="#/teams/${team.id}">
      <div class="entity-row">${teamLogo(team.id)}<span class="entity-main"><strong>${escapeHtml(team.name)}</strong><span>tag: ${escapeHtml(team.sourceTag || team.id)} - nota ${fmt(team.rankingScore ?? team.points, 1)} - ${team.wins}-${team.losses}</span></span></div>
      <div class="chip-row"><span class="chip red">${teamCanonicalRankLabel(team)}</span><span class="chip">${pct(team.winRate)} WR</span><span class="chip">${lineupCount} lineup</span>${!teamIsRankingValid(team) && !rankingIsInactive(team.ranking) ? `<span class="chip">prov</span>` : ""}</div>
    </a>
  `;
}

function lineupEntryCard(entry, team) {
  const player = entry.playerId ? playerById(entry.playerId) : null;
  const name = player?.nick || entry.name || "Jogador";
  const handle = player?.handle || "";
  const stats = player && team ? playerStatsForTeam(player, team.id) : player;
  const body = `
    <div class="roster-photo-wrap">
      ${player ? playerLogo(player.id, "roster-photo") : logo((name || "J").slice(0, 2).toUpperCase(), ["#181715", "#6c665d"], "round roster-photo")}
    </div>
    <div class="roster-card-body">
      <strong>${escapeHtml(name)}</strong>
      <span>${handle ? escapeHtml(handle) : "Perfil em atualização"}</span>
      ${player ? `
        <div class="roster-player-metrics">
          <span><strong>${escapeHtml(playerRating(stats))}</strong><small>rAAting</small></span>
          <span><strong>${escapeHtml(String(stats.matches || 0))}</strong><small>Mapas</small></span>
          <span><strong>${escapeHtml(fmt(stats.acs, 0))}</strong><small>ACS</small></span>
        </div>
      ` : `<small class="roster-player-empty">Perfil em atualização</small>`}
    </div>
  `;
  return player ? `<a class="roster-player-card" href="${playerHref(player)}">${body}</a>` : `<div class="roster-player-card">${body}</div>`;
}

function tournamentRow(event) {
  return `<a class="simple-row" href="#/tournaments/${event.id}">${eventLogo(event)}<span><strong>${escapeHtml(event.name)}</strong><br><span class="tiny">${escapeHtml(eventTimeRange(event))} - ${event.matches} partidas - ${event.teams.length} equipes</span></span><span class="chip event-chip ${eventStatusClass(event.status)}">${escapeHtml(event.status)}</span></a>`;
}

function mapCard(map) {
  return `
    <a class="entity-card" href="#/maps/${map.id}">
      <div class="entity-row">${mapLogo(map.id)}<span class="entity-main"><strong>${escapeHtml(map.name)}</strong><span>${map.matches} partidas - ${map.rounds} rounds</span></span></div>
      <div class="chip-row"><span class="chip red">${map.matches} partidas</span><span class="chip">${map.teamStats.length} equipes</span><span class="chip">${map.agentStats[0]?.name || "Agente"}</span></div>
    </a>
  `;
}

function mapRow(map) {
  if (!map) return "";
  return `<a class="simple-row" href="#/maps/${map.id}">${mapLogo(map.id)}<span><strong>${escapeHtml(map.name)}</strong><br><span class="tiny">${map.matches} partidas - ${map.rounds} rounds</span></span><span class="chip">${map.agentStats[0]?.name || "-"}</span></a>`;
}

// Campeonato e sempre exibido por dia (sem horario); o horario continua valendo
// so para partidas, que acontecem em um horario especifico.
function eventTimeRange(event) {
  if (!event?.start && !event?.end) return "Sem janela definida";
  if (!event?.start) return `Termina ${formatDate(event.end)}`;
  if (!event?.end) return `Inicio ${formatDate(event.start)}`;
  const endLabel = !eventIsDone(event) && periodEndIsCurrent(event.end) ? "Atualmente" : formatDate(event.end);
  if (formatDate(event.start) === endLabel) return formatDate(event.start);
  return `${formatDate(event.start)} - ${endLabel}`;
}

function eventStatusClass(status) {
  // "Agendado" nao e "ao vivo": antes os dois caiam na mesma classe e um
  // campeonato marcado para daqui a um mes usava o selo de partida rolando.
  const value = String(status || "").toLowerCase();
  if (value.includes("finalizado")) return "done";
  if (value.includes("agendad") || value.includes("em breve")) return "scheduled";
  return "live";
}

function eventIsDone(event) {
  return eventStatusClass(event?.status) === "done";
}

function scoreNumberClass(value, opponent) {
  if (value > opponent) return "score-number win";
  if (value < opponent) return "score-number loss";
  return "score-number";
}

function playerTable(players) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th class="numeric">#</th><th>Jogador</th><th>Equipe</th><th class="numeric">rAAting 3.0</th><th class="numeric">Rounds</th><th class="numeric">Mapas</th><th class="numeric">ACS</th><th class="numeric">K/D</th><th class="numeric">ADR</th><th class="numeric">KAST</th><th class="numeric">Swing/R</th><th class="numeric">FK-FD</th></tr></thead>
        <tbody>${players.map((player, index) => {
          const team = teamById(player.teamId);
          const fkFdDiff = Number(player.firstKills || 0) - Number(player.firstDeaths || 0);
          return `<tr><td class="numeric">${index + 1}</td><td>${entityLink("players", player.id, player.nick)}<br><span class="tiny">${escapeHtml(player.handle)}</span>${sampleStatusChip(player)}</td><td>${team ? entityLink("teams", team.id, team.tag) : "-"}</td><td class="numeric rating-cell ${playerRatingTone(player)}">${playerRating(player)}</td><td class="numeric">${player.rounds}</td><td class="numeric">${player.matches}</td><td class="numeric">${fmt(player.acs, 0)}</td><td class="numeric">${fmt(player.kd)}</td><td class="numeric">${fmt(player.adr, 0)}</td><td class="numeric">${pct(player.kast)}</td><td class="numeric ${directionalTone(playerSwingPerRound(player))}">${formatMaybeSwing(player)}</td><td class="numeric ${signedTone(fkFdDiff)}">${signed(fkFdDiff)}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>
  `;
}

function agentBadge(agent) {
  const name = agent?.agent || agent?.name || "Agente";
  const role = agent?.agentClass || agent?.role || "";
  const icon = agent?.agentIcon || agent?.icon || "";
  const slug = agent?.agentSlug || agent?.slug || name;
  const fallback = displayAgentName(name, slug).slice(0, 3).toUpperCase();
  const image = icon
    ? `<span class="agent-icon"><span>${escapeHtml(fallback)}</span><img src="${escapeHtml(assetPath(icon))}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.remove()" /></span>`
    : `<span class="agent-icon"><span>${escapeHtml(fallback)}</span></span>`;
  return `<span class="agent-badge">${image}<span><strong>${escapeHtml(name)}</strong>${role ? `<small>${escapeHtml(role)}</small>` : ""}</span></span>`;
}

function aggregateTeamStatsForMatches(matches, teamId) {
  return matches.reduce((total, match) => {
    const stats = match.teamStats[teamId] || emptyTeamRoundStats();
    for (const key of Object.keys(total)) {
      total[key] += stats[key] || 0;
    }
    return total;
  }, emptyTeamRoundStats());
}

function teamCompareBars(match, selectedMatches = [match]) {
  return `
    <div class="team-compare-list">
      ${teamCompareCard(match.teamA, selectedMatches)}
      ${teamCompareCard(match.teamB, selectedMatches)}
    </div>
  `;
}

function teamCompareCard(team, selectedMatches) {
  const stats = aggregateTeamStatsForMatches(selectedMatches, team.id);
  const roundsWon = selectedMatches.reduce((sum, item) => sum + scoreForTeamInMatch(item, team.id), 0);
  const roundsTotal = selectedMatches.reduce((sum, item) => sum + item.teamA.score + item.teamB.score, 0);
  const rows = [
    ["Rounds", roundsWon, roundsTotal],
    ["Ataque", stats.attackWins, stats.attackRounds],
    ["Defesa", stats.defenseWins, stats.defenseRounds],
    ["Pistols", stats.pistolWins, stats.pistolRounds],
  ];
  return `
    <section class="team-compare-card">
      <div class="team-compare-head">${teamLogo(team.id, "small")}<strong>${escapeHtml(team.name)}</strong></div>
      ${rows.map(([label, wins, total]) => teamCompareMetric(label, wins, total)).join("")}
    </section>
  `;
}

function teamCompareMetric(label, wins, total) {
  const value = pctValue(wins, total);
  return `
    <div class="team-compare-row">
      <span>${escapeHtml(label)}</span>
      <div class="team-compare-track"><i style="width:${clamp(value, 0, 100)}%"></i><strong>${pct(value)}</strong></div>
      <em>${escapeHtml(`${wins}/${total}`)}</em>
    </div>
  `;
}

function playerMapTable(player) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Mapa</th><th class="numeric">Partidas</th><th class="numeric">rAAting 3.0</th><th class="numeric">ACS</th></tr></thead>
        <tbody>${player.mapStats.map((row) => `<tr><td>${entityLink("maps", slugify(row.name), row.name)}</td><td class="numeric">${row.matches}</td><td class="numeric">${fmt(row.rating)}</td><td class="numeric">${fmt(row.acs, 0)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function agentBars(rows, options = {}) {
  if (!rows.length) return `<div class="empty-state">Sem agentes registrados.</div>`;
  return `
    <div class="bars">
      ${rows
        .map(
          (agent) => `
            <div class="bar-row agent-bar">
              <span>${agentBadge(agent)}</span>
              <div class="bar-track"><div class="bar-fill" style="width:${clamp(agent.rate, 0, 100)}%"></div></div>
              <span class="numeric">${options.showPickRate ? escapeHtml(`${agent.picks || 0} picks · ${pct(agent.rate)}`) : `${escapeHtml(String(agent.rounds))} rounds`}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function bars(rows) {
  return `<div class="bars">${rows.map(([label, value, note]) => `<div class="bar-row"><span>${escapeHtml(String(label))}</span><div class="bar-track"><div class="bar-fill" style="width:${clamp(value, 0, 100)}%"></div></div><span class="numeric">${note ? escapeHtml(String(note)) : pct(value)}</span></div>`).join("")}</div>`;
}

function stat(value, label, title = "") {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<div class="stat-card"${titleAttr}><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function entityLink(type, id, text) {
  const routeId = type === "players" ? playerRouteId(id) : id;
  return `<a class="subtle-link" href="#/${escapeHtml(type)}/${escapeHtml(routeId)}">${escapeHtml(text)}</a>`;
}

function logo(label, colors, extra = "") {
  return `<span class="logo ${extra}" style="background:linear-gradient(135deg, ${colors[0]}, ${colors[1]})">${escapeHtml(label)}</span>`;
}

function imageLogo(src, label, colors, extra = "", alt = "") {
  const safeSrc = assetPath(src);
  if (!safeSrc) return logo(label, colors, extra);
  return `
    <span class="logo image-logo ${extra}" style="background:linear-gradient(135deg, ${colors[0]}, ${colors[1]})">
      <span class="logo-fallback">${escapeHtml(label)}</span>
      <img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(alt || label)}" loading="lazy" onerror="this.remove()" />
    </span>
  `;
}

function eventLogo(event, extra = "") {
  const label = event?.mark || eventAcronym(event?.name || event?.id || "EV");
  const src = assetPath(event?.logo || "");
  const classes = `event-logo clean-logo ${extra}`.trim();
  const alt = `Logo ${event?.name || label}`;
  if (!src) return `<span class="${escapeHtml(`${classes} logo-empty`)}" aria-label="${escapeHtml(alt)}"></span>`;
  return `<span class="${escapeHtml(classes)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.closest('.event-logo').classList.add('logo-empty'); this.remove()" /></span>`;
}

function organizerLogo(event, extra = "") {
  const label = event?.organizer || "Organizador";
  const src = assetPath(event?.organizerLogo || event?.organizerLogoPath || "");
  const classes = `organizer-logo clean-logo ${extra}`.trim();
  const alt = `Logo ${label}`;
  if (!src) return `<span class="${escapeHtml(`${classes} logo-empty`)}" aria-label="${escapeHtml(alt)}"></span>`;
  return `<span class="${escapeHtml(classes)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" onerror="this.closest('.organizer-logo').classList.add('logo-empty'); this.remove()" /></span>`;
}

function teamLogo(id, extra = "") {
  const team = teamById(id);
  const src = assetPath(team?.profile?.logo || team?.logo || "");
  const label = `Logo ${team?.name || id}`;
  if (!src) return `<span class="team-logo clean-logo logo-empty ${escapeHtml(extra)}" aria-label="${escapeHtml(label)}"></span>`;
  return `<span class="team-logo clean-logo ${escapeHtml(extra)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" loading="lazy" onerror="this.closest('.team-logo').classList.add('logo-empty'); this.remove()" /></span>`;
}

function playerLogo(id, extra = "") {
  const player = playerById(id);
  const src = playerPhotoSrc(player);
  const classes = `logo image-logo player-avatar round ${extra}`.trim();
  return `<span class="${escapeHtml(classes)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(`Foto ${player?.nick || "Jogador"}`)}" loading="lazy" onerror="playerPhotoError(this)" /></span>`;
}

function playerPhotoSrc(player) {
  return assetPath(player?.photo || PLAYER_FALLBACK_PHOTO);
}

function playerPhotoError(image) {
  if (!image) return;
  image.onerror = null;
  image.src = assetPath(PLAYER_FALLBACK_PHOTO);
}

function mapLogo(id, extra = "") {
  const map = mapById(id);
  const label = (map?.name || id).slice(0, 3).toUpperCase();
  // O maior lugar onde este logo aparece tem 82px; o PNG de origem tem 1600px
  // de largura. Se o WebP faltar, imageLogo ja cai no monograma de tres letras
  // que fica atras da imagem, entao nao precisa de cadeia de fallback aqui.
  const art = mapArtAttrs(map);
  return imageLogo(art?.src || "", label, map?.colors || mapColors(id), `map-logo ${extra}`.trim(), `Mapa ${map?.name || id}`);
}

function teamById(id) {
  return state.db?.teams.find((team) => team.id === id);
}

function playerById(id) {
  const key = String(id || "");
  if (!key) return null;
  const routeKey = slugify(key);
  return state.db?.players.find((player) => player.id === key || player.puuid === key || (player.accounts || []).some((account) => account.puuid === key) || player.routeSlug === routeKey);
}

function playerRouteId(playerOrId) {
  const player = resolvePlayerRouteTarget(playerOrId);
  return player?.routeSlug || player?.id || String(playerOrId || "");
}

function resolvePlayerRouteTarget(playerOrId) {
  if (!playerOrId || typeof playerOrId !== "object") return playerById(playerOrId);
  return playerById(playerOrId.id || playerOrId.puuid || playerOrId.playerId) || playerOrId;
}

function playerPath(playerOrId, tab = "") {
  const id = playerRouteId(playerOrId);
  return `players/${id}${tab ? `/${tab}` : ""}`;
}

function playerHref(playerOrId, tab = "") {
  return `#/${playerPath(playerOrId, tab)}`;
}

function mapById(id) {
  return state.db?.maps.find((map) => map.id === id);
}

function mapByName(name) {
  return state.db?.maps.find((map) => map.name === name);
}

function updateDocumentTitle() {
  document.title = formatDocumentTitle(documentTitleForRoute(route()));
}

function formatDocumentTitle(title) {
  const segment = cleanDocumentTitleSegment(title);
  return segment ? `${segment} - ${SITE_NAME}` : SITE_NAME;
}

function documentTitleForRoute(currentRoute) {
  const { section, id, tab } = currentRoute;
  if (!state.ready || !state.db) return STATIC_DOCUMENT_TITLES[section] || STATIC_DOCUMENT_TITLES.home;

  if (section === "matches" && id) return matchDocumentTitle(id, tab);
  if ((section === "events" || section === "tournaments") && id) return tournamentDocumentTitle(id);
  if (section === "players" && id) return playerDocumentTitle(id);
  if (section === "teams" && id) return teamDocumentTitle(id);
  if (section === "maps" && id) return mapDocumentTitle(id);

  return STATIC_DOCUMENT_TITLES[section] || STATIC_DOCUMENT_TITLES.home;
}

function matchDocumentTitle(id, tab) {
  const match = state.db.matches.find((item) => item.id === id);
  if (!match) return STATIC_DOCUMENT_TITLES.matches;
  const series = matchSeries(match);
  const aggregateMode = tab === "all" && series.length > 1;
  const selectedMatches = aggregateMode ? series : [match];
  const score = matchDisplayScore(match, selectedMatches, aggregateMode);
  return `${matchTitleTeamTag(match.teamA)} ${score.a} x ${score.b} ${matchTitleTeamTag(match.teamB)}`;
}

function matchTitleTeamTag(side) {
  const team = teamById(side.id) || side;
  const candidates = [team.sourceTag, team.tag, side.sourceTag, side.tag, team.shortTag, side.shortTag];
  const preferred = candidates.find((value) => value && value !== side.id && value !== team.id);
  return preferred || (team.id ? teamTag(team.id) : "") || team.name || side.name || side.id;
}

function tournamentDocumentTitle(id) {
  return visibleTournaments().find((event) => event.id === id)?.name || STATIC_DOCUMENT_TITLES.events;
}

function playerDocumentTitle(id) {
  const player = playerById(id);
  return player?.nick || player?.handle || STATIC_DOCUMENT_TITLES.players;
}

function teamDocumentTitle(id) {
  return teamById(id)?.name || STATIC_DOCUMENT_TITLES.teams;
}

function mapDocumentTitle(id) {
  return mapById(id)?.name || STATIC_DOCUMENT_TITLES.maps;
}

function cleanDocumentTitleSegment(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function route() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  // o estado de filtro viaja depois do "?", entao o caminho para de ler ali
  const [caminho] = hash.split("?");
  const [section = "home", id, tab] = caminho.split("/");
  return { section, id, tab };
}

function routeQuery() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const i = hash.indexOf("?");
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : "");
}

function routePath() {
  return "#/" + window.location.hash.replace(/^#\/?/, "").split("?")[0];
}

// A chave de rota ignora a query de proposito: trocar um filtro nao e mudar de
// pagina, entao nao deve jogar a rolagem para o topo.
function currentRouteKey() {
  return routePath();
}

function scrollToRouteTop(routeChanged) {
  if (!routeChanged || typeof window.scrollTo !== "function") return;
  window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
}

function resolveMapMeta(apiMapId, fallbackSlug, metadata) {
  const apiSlug = MAP_API_SLUGS[apiMapId] || slugify(fallbackSlug || apiMapFallbackName(apiMapId));
  const registered = metadata.mapsBySlug.get(apiSlug) || metadata.mapsByName.get(normalizeNameKey(fallbackSlug || ""));
  const slug = registered?.slug || apiSlug || slugify(fallbackSlug || apiMapId || "mapa");
  return {
    slug,
    name: displayEntityName(registered?.name || slug),
    icon: assetPath(registered?.icon || ""),
  };
}

function apiMapFallbackName(apiMapId) {
  const parts = String(apiMapId || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function resolveAgentMeta(characterId, metadata) {
  const apiSlug = AGENT_API_SLUGS[characterId] || "";
  const registered = metadata.agentsBySlug.get(apiSlug);
  const slug = registered?.slug || apiSlug || characterId || "";
  return {
    slug,
    name: displayAgentName(registered?.name || slug, slug, characterId),
    role: displayEntityName(registered?.role || ""),
    icon: assetPath(registered?.icon || ""),
  };
}

function displayAgentName(name, slug, characterId) {
  if (slug === "kayo") return "KAY/O";
  if (!name && characterId) return `Agente ${characterId.slice(0, 8)}`;
  return displayEntityName(name || slug);
}

function displayEntityName(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === text.toLowerCase() || text.includes("_") || text.includes("-")) return displayText(text);
  return text;
}

function assetPath(path) {
  const value = String(path || "").trim().replaceAll("\\", "/");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return value.replace(/^\/+/, "");
}

function displayTeamName(id) {
  return id
    .split("_")
    .map((part) => (KNOWN_ACRONYMS.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function teamTag(id) {
  const parts = id.split("_");
  const acronymParts = parts.filter((part) => KNOWN_ACRONYMS.has(part));
  if (acronymParts.length) return acronymParts.map((part) => part.toUpperCase()).join("").slice(0, 5);
  return parts.map((part) => part[0]).join("").toUpperCase().slice(0, 5);
}

function displayText(id) {
  return id.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function teamColors(id) {
  const key = String(id || "").toLowerCase();
  const overrides = {
    macklogic_red: ["#ef101a", "#270407"],
    macklogic_white: ["#f5f1f2", "#ef101a"],
    macklogic_rainbow: ["#ef101a", "#6d2fff"],
    ceub_octopus: ["#8e1b8f", "#ef5ad4"],
    azure_bears_golden: ["#19a7ff", "#f4c64a"],
    azure_bears_black: ["#19a7ff", "#101820"],
  };
  return overrides[key] || colorPair(id);
}

function eventColorPair(event = {}) {
  if (Array.isArray(event.colors) && event.colors.length >= 2) return event.colors.slice(0, 2);
  return colorPair(`event-${event.id || event.name || "campeonato"}`);
}

function eventAcronym(value) {
  const clean = String(value || "EV").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const compact = clean.replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length <= 5) return compact.toUpperCase();
  const stopWords = new Set(["de", "da", "do", "das", "dos", "e"]);
  const parts = clean
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part && !stopWords.has(part.toLowerCase()));
  return (parts.map((part) => part[0]).join("") || compact.slice(0, 3)).toUpperCase().slice(0, 5);
}

function mapColors(name) {
  return colorPair(`map-${name}`);
}

// A paleta gerada sai em hex, nao em hsl(). Ate 26/08/2026 saia em hsl e o
// preco era silencioso: hexToRgb() so aceita #rrggbb, entao teamWashFor()
// abortava na primeira linha e devolvia tinta clara sobre a cor crua, sem o
// passeio que garante 4,5:1 - a Sixa Eaters, unica das 98 equipes que nao esta
// em dados_excel/teams_infos.xlsx, ficava em 2,93:1. teamPatternFor() falhava
// junto, no mesmo hexToRgb, e caia no "tecido" para toda equipe gerada.
// Mesmas cores, notacao que as guardas conseguem ler.
function colorPair(seed) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = seed.charCodeAt(index) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 145) % 360;
  return [rgbToHex(hslToRgb(hue, 64, 38)), rgbToHex(hslToRgb(hue2, 58, 22))];
}

function hslToRgb(h, s, l) {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lum - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((canal) => Math.round((canal + m) * 255));
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalize(value) {
  return slugify(value).replace(/-/g, " ");
}

function normalizeNameKey(value) {
  return normalize(value).replace(/\s+/g, "");
}

function pctValue(value, total) {
  return total ? (value / total) * 100 : 0;
}

function pct(value) {
  return `${fmt(value, 0)}%`;
}

function fmt(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatDate(value, mode = "date") {
  if (!value) return "-";
  const date = new Date(value);
  // "hour" existe para a lista agrupada por dia: o dia ja e o cabecalho do
  // grupo, entao a linha so precisa da hora.
  if (mode === "hour") return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const options =
    mode === "time"
      ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short", year: "numeric" };
  return date.toLocaleDateString("pt-BR", options).replace(".", "");
}

function formatDuration(ms) {
  if (!ms) return "-";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Cada entidade carrega o proprio genero e o proprio caminho de volta: antes
// era `${entity} não encontrado.` para todas, produzindo "Equipe nao
// encontrado." e "Partida nao encontrado.", e sem nenhuma saida - num produto
// que se espalha por link colado, o link velho era um beco sem saida.
const NOT_FOUND_ENTITIES = {
  Partida: { frase: "Partida não encontrada", volta: "#/matches", voltaLabel: "Ver todas as partidas" },
  Campeonato: { frase: "Campeonato não encontrado", volta: "#/events", voltaLabel: "Ver todos os campeonatos" },
  Equipe: { frase: "Equipe não encontrada", volta: "#/ranking", voltaLabel: "Ver o ranking de equipes" },
  Jogador: { frase: "Jogador não encontrado", volta: "#/players", voltaLabel: "Ver todos os jogadores" },
  Mapa: { frase: "Mapa não encontrado", volta: "#/maps", voltaLabel: "Ver todos os mapas" },
  Recurso: { frase: "Página não encontrada", volta: "#/home", voltaLabel: "Voltar para a inicial" },
};

function renderNotFound(entity) {
  const info = NOT_FOUND_ENTITIES[entity] || NOT_FOUND_ENTITIES.Recurso;
  Shell(`
    <div class="boot-state" role="alert">
      <strong>${escapeHtml(info.frase)}</strong>
      <p>O link pode estar velho, ou o item pode ter saído do site desde que ele foi compartilhado.</p>
      <a class="boot-retry" href="${info.volta}">${escapeHtml(info.voltaLabel)}</a>
    </div>
  `);
}
