"""Explica cada jogador do arquivo que não casou com os competidores do jogo.

Uso: python ferramentas/tracker-campeonato/conferir_identidades.py <pasta>

Lê lote/relatorio.json (coletar.cjs), cm.json e puuids.json. Para cada lado
de cada jogo com arquivo, o que sobrou no tracker é comparado com o que faltou
nos competidores que jogaram (papel 0):

- nome velho no Challengermode: o competidor que faltou tem Riot ID que a Riot
  não conhece mais (404) e sobra exatamente um de cada lado. É a mesma conta
  renomeada; provável, não provado, porque o PUUID do CM é cifrado para a chave
  deles.
- outra conta: o competidor que faltou resolve para um PUUID diferente do de
  quem jogou. Conta emprestada ou substituição; decisão do dono.
- fora da lista: sobra no tracker sem competidor faltando no CM.

Grava lote/identidades.md e imprime o resumo.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path


def main() -> None:
    pasta = Path(sys.argv[1])
    rel = json.loads((pasta / "lote" / "relatorio.json").read_text(encoding="utf-8"))
    cm = json.loads((pasta / "cm.json").read_text(encoding="utf-8"))
    pu = {v["riotId"].lower(): v for v in json.loads((pasta / "puuids.json").read_text(encoding="utf-8")).values()}
    jogos = {j["id"]: j for p in cm["partidas"] for j in p["jogos"] if j.get("id")}

    def chave(rid: str) -> str:
        r = pu.get((rid or "").lower())
        return "p:" + r["puuid"] if r and r.get("puuid") else "n:" + (rid or "").lower()

    contagem: Counter[str] = Counter()
    jogos_ok = 0
    linhas = ["# Identidades nos jogos com arquivo", "",
              "| Série | Lado | Tracker | Challengermode | Leitura |", "|---|---|---|---|---|"]
    for a in rel["alvos"]:
        arq = a["arquivo"]
        if not arq:
            continue
        j = jogos[a["jogoId"]]
        explicado = True
        for lado, l in enumerate(arq["lados"]):
            if not l["sobra"]:
                continue
            achados = {chave(x) for x in l["reconhecidos"]}
            faltou = [c for c in j["competidores"]
                      if c["lado"] == lado and c["papel"] == 0 and c.get("riotId") and chave(c["riotId"]) not in achados]
            velhos = [c for c in faltou if (pu.get(c["riotId"].lower()) or {}).get("status") == 404]
            outros = [c for c in faltou if c not in velhos]
            if len(l["sobra"]) == len(faltou) == len(velhos):
                leitura = "nome velho no Challengermode"
            elif len(l["sobra"]) == len(faltou) and outros:
                leitura = "outra conta" if not velhos else "outra conta e nome velho"
                explicado = False
            else:
                leitura = "fora da lista"
                explicado = False
            contagem[leitura] += len(l["sobra"])
            linhas.append(f"| {a['serie']} | {a['equipes'][lado]['nome']} | {', '.join(l['sobra'])} | "
                          f"{', '.join(c['riotId'] + (' (404)' if c in velhos else '') for c in faltou) or '-'} | {leitura} |")
        jogos_ok += explicado
    total = sum(1 for a in rel["alvos"] if a["arquivo"])
    linhas += ["", f"{jogos_ok} de {total} jogos com arquivo têm todos os jogadores reconhecidos ou explicados por nome velho.",
               "", "Jogadores por leitura: " + ", ".join(f"{k} {v}" for k, v in contagem.most_common())]
    (pasta / "lote" / "identidades.md").write_text("\n".join(linhas) + "\n", encoding="utf-8")
    print(linhas[-3])
    print(linhas[-1])

    # Quem jogou e já está no cadastro, pelo PUUID.
    vistos = {}
    for a in rel["alvos"]:
        if a["arquivo"]:
            for l in a["arquivo"]["lados"]:
                for rid in l["reconhecidos"] + l["sobra"]:
                    vistos[rid.lower()] = pu.get(rid.lower())
    com = sum(1 for r in vistos.values() if r and r.get("puuid"))
    cad = sum(1 for r in vistos.values() if r and r.get("jogador"))
    print(f"contas distintas nos arquivos: {len(vistos)}, com PUUID {com}, já na planilha {cad}")


if __name__ == "__main__":
    main()
