// Gera cartas/cores.json: as duas cores de cada equipe, pelo caminho do logo, para
// as linhas da pagina de cartinhas. Fica fora do manifest.json porque os dias ja
// postados nao mudam. As cores vem do ultimo commit, para baterem com a pagina de
// Jogadores, mas so entram equipes da origin/main: a branch tem equipes da previa,
// que nao podem aparecer no site antes da hora.
const { execFileSync } = require("child_process");
const fs = require("fs");

const metadataDe = (ref) =>
  JSON.parse(execFileSync("git", ["show", `${ref}:metadata.json`], { encoding: "utf8", maxBuffer: 1 << 26 }).replace(/^﻿/, ""));

const publicas = new Set(metadataDe("origin/main").teams.map((team) => team.logo));
const cores = Object.fromEntries(
  metadataDe("HEAD")
    .teams.filter((team) => publicas.has(team.logo) && team.colors?.length)
    .map((team) => [`/${team.logo}`, team.colors.slice(0, 2)]),
);

fs.writeFileSync("cartas/cores.json", `${JSON.stringify(cores)}\n`);
console.log(`cartas/cores.json: ${Object.keys(cores).length} equipes`);
