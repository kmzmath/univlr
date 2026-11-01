"""Resolve Riot IDs para PUUID (cifrado com a NOSSA chave) e casa com a planilha.

Uso: python ferramentas/tracker-campeonato/resolver_puuid.py <pasta> [arquivo-de-ids.txt]

O tracker e o avatar do Challengermode mostram o Riot ID ATUAL da conta, então
`riot/account/v1/accounts/by-riot-id` devolve o PUUID mesmo para partidas de
anos atrás. O PUUID que o Challengermode guarda (AvatarExternalId) não serve:
é cifrado para a chave deles.

Lê os Riot IDs de <pasta>/cm.json (membros e competidores) e, se houver, de um
arquivo extra (um por linha, para jogadores que só aparecem no tracker). Grava
<pasta>/puuids.json, retomável: Riot ID já resolvido não é consultado de novo.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
from pathlib import Path

import openpyxl
import requests

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "ferramentas" / "riot"))
import config_hub  # noqa: E402

PLANILHA = REPO / "dados_excel" / "players.xlsx"
URL = "https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/{}/{}"
# Chave de desenvolvimento: 20/1 s e 100/120 s.
INTERVALO_S = 1.25


def chave_id(riot_id: str) -> str:
    # lower(), não casefold(): tem que bater com o toLowerCase() do coletar.cjs
    return riot_id.strip().lower()


def jogadores_por_puuid() -> dict[str, str]:
    wb = openpyxl.load_workbook(PLANILHA, read_only=True, data_only=True)
    linhas = list(wb.active.iter_rows(values_only=True))
    cab = [str(x or "") for x in linhas[0]]
    cols = [i for i, x in enumerate(cab) if x.lower().startswith("puuid")]
    jog = cab.index("Jogador")
    saida: dict[str, str] = {}
    for linha in linhas[1:]:
        for i in cols:
            if linha[i]:
                saida[str(linha[i]).strip()] = linha[jog]
    return saida


def ids_do_cm(pasta: Path) -> set[str]:
    if not (pasta / "cm.json").exists():
        return set()
    cm = json.loads((pasta / "cm.json").read_text(encoding="utf-8"))
    ids = {m["riotId"] for e in cm["equipes"] for m in e["membros"] if m.get("riotId")}
    for p in cm["partidas"]:
        for j in p["jogos"]:
            ids |= {c["riotId"] for c in j.get("competidores", []) if c.get("riotId")}
    return ids


def main() -> None:
    pasta = Path(sys.argv[1])
    ids = ids_do_cm(pasta)
    if len(sys.argv) > 2:
        ids |= {l.strip() for l in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if "#" in l}

    destino = pasta / "puuids.json"
    cache = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
    planilha = jogadores_por_puuid()

    s = requests.Session()
    s.headers["X-Riot-Token"] = config_hub.riot_api_key()
    pendentes = sorted(i for i in ids if chave_id(i) not in cache or cache[chave_id(i)]["status"] not in (200, 404))
    print(f"{len(ids)} Riot IDs, {len(pendentes)} a consultar")
    for n, rid in enumerate(pendentes, 1):
        nome, _, tag = rid.rpartition("#")
        r = s.get(URL.format(urllib.parse.quote(nome, safe=""), urllib.parse.quote(tag, safe="")), timeout=30)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After") or 10))
            r = s.get(URL.format(urllib.parse.quote(nome, safe=""), urllib.parse.quote(tag, safe="")), timeout=30)
        reg = {"riotId": rid, "status": r.status_code}
        if r.status_code == 200:
            d = r.json()
            reg.update(puuid=d["puuid"], atual=f"{d.get('gameName')}#{d.get('tagLine')}")
        cache[chave_id(rid)] = reg
        if n % 25 == 0 or n == len(pendentes):
            destino.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"  {n}/{len(pendentes)}")
        time.sleep(INTERVALO_S)

    # O vínculo com a planilha é recalculado sempre: o cadastro muda.
    for reg in cache.values():
        reg["jogador"] = planilha.get(reg.get("puuid", ""), None)
    destino.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")

    ok = [r for r in cache.values() if r["status"] == 200]
    print(f"resolvidos {len(ok)}/{len(cache)}, na planilha {sum(1 for r in ok if r['jogador'])}, "
          f"404 {sum(1 for r in cache.values() if r['status'] == 404)}")


if __name__ == "__main__":
    main()
