"""Monta no site um campeonato coletado pelo tracker (coletar.cjs + converter.py).

Uso:
  python ferramentas/tracker-campeonato/montar_evento.py <pasta-outputs> \
      --equipes <equipes.json> --prefixo ALIANCA_C1 --evento <id> --nome "<nome>" \
      --destino "campeonatos/<Evento>/<Fase>" [--copia "trabalho/Finalizados/Válidos/..."] \
      [--manuais <associacoes.json>] [--pontos <placementPoints.json>] [--gravar]

Sem --gravar, só mostra o plano: nomes de arquivo, o bloco da chave e a entrada
do ranking-weights. Com --gravar, copia os arquivos convertidos (riot/) com o
nome do padrão (<prefixo>_<NNN>_<dd-mm-aa>_<A>_<pa>_x_<pb>_<B>_<mapa>.json, na
ordem da plataforma) e grava override.js e ranking-weights.json na pasta.

- equipes.json: {"<id da equipe no Challengermode>": "<slug do site>"}.
- associacoes.json: {"<série>": {"uuid": "...", "motivo": "..."}} para arquivo
  que a conferência automática não aceitou mas a evidência sustenta.
- W.O.: série com 1x0 do admin e sem arquivo. Série com placar real e sem
  arquivo entra na chave com o placar e sem status, como as da Univavá C1.
- Colocações: as quatro vagas são "Classificado"; o resto sai em blocos pela
  rodada da chave inferior em que a equipe foi eliminada.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import OrderedDict, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BRT = timezone(timedelta(hours=-3))
MAPAS = {
    "Ascent": "ascent", "Duality": "bind", "Foxtrot": "breeze", "Canyon": "fracture", "Triad": "haven",
    "Port": "icebox", "Jam": "lotus", "Pitt": "pearl", "Bonsai": "split", "Juliett": "sunset",
    "Infinity": "abyss", "Rook": "corrode", "Plummet": "summit",
}
SEM = "Sem adversário"


def ler(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def placar_real(lados):
    p = [l["placar"] for l in sorted(lados, key=lambda l: l["lado"])]
    return len(p) == 2 and all(isinstance(x, int) for x in p) and max(p) >= 13


def utc(s):
    return datetime.fromisoformat(s[:23]).replace(tzinfo=timezone.utc)


def js(v, ind=0):
    """Objeto no estilo do TOURNAMENT_OVERRIDES: chaves sem aspas, acentos em
    \\uXXXX, partida/colocação numa linha só e listas uma por linha."""
    pad, pad2 = " " * ind, " " * (ind + 2)
    if isinstance(v, dict):
        if all(not isinstance(x, (dict, list)) for x in v.values()):
            return "{ " + ", ".join(f"{k}: {json.dumps(x, ensure_ascii=True)}" for k, x in v.items()) + " }"
        linhas = [f"{pad2}{k}: {js(x, ind + 2)}," for k, x in v.items()]
        return "{\n" + "\n".join(linhas) + f"\n{pad}}}"
    if isinstance(v, list):
        if all(isinstance(x, str) for x in v) and sum(len(x) for x in v) < 70:
            return "[" + ", ".join(json.dumps(x, ensure_ascii=True) for x in v) + "]"
        return "[\n" + "\n".join(f"{pad2}{js(x, ind + 2)}," for x in v) + f"\n{pad}]"
    return json.dumps(v, ensure_ascii=True)


def titulo(chave_tipo, k, ultima):
    if chave_tipo == 3:
        return {4: "Quartas de final superior", 2: "Semifinais superior", 1: "Final superior"}.get(k, f"Rodada de {2 * k} superior")
    return "Quartas de final inferior" if ultima else f"Rodada de {2 * k} inferior"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pasta")
    ap.add_argument("--equipes", required=True)
    ap.add_argument("--prefixo", required=True)
    ap.add_argument("--evento", required=True)
    ap.add_argument("--nome", required=True)
    ap.add_argument("--destino", required=True)
    ap.add_argument("--copia")
    ap.add_argument("--manuais")
    ap.add_argument("--pontos")
    # Campos do override que mudam de evento para evento (format, type, tier,
    # standingsLabel da liga...), como JSON.
    ap.add_argument("--extra")
    # Séries com 1x0 do admin e indício de jogo no tracker: ficam sem "W.O.".
    ap.add_argument("--sem-wo", default="")
    ap.add_argument("--gravar", action="store_true")
    op = ap.parse_args()
    sem_wo = {int(x) for x in op.sem_wo.split(",") if x.strip()}

    base = Path(op.pasta)
    cm, rod, rel = ler(base / "cm.json"), ler(base / "rodadas.json"), ler(base / "lote" / "relatorio.json")
    pu = {v["riotId"].lower(): v for v in ler(base / "puuids.json").values()}
    slug_de = ler(op.equipes)
    manuais = ler(op.manuais) if op.manuais else {}
    erros, avisos = [], []

    equipes = {e["id"]: e for e in cm["equipes"]}
    seeded = sorted((e for e in cm["equipes"] if e["seed"] is not None), key=lambda e: e["seed"])
    for e in seeded:
        if e["id"] not in slug_de:
            erros.append(f"equipe sem slug: {e['nome']} ({e['id']})")
    partida = {p["numero"]: p for p in cm["partidas"]}

    # arquivo de cada série: conferência automática + associações manuais
    arquivo_da_serie = {}
    for a in rel["alvos"]:
        if a["arquivo"]:
            arquivo_da_serie.setdefault(a["serie"], {})[a["jogoId"]] = a["arquivo"]["uuid"]
    for serie, m in manuais.items():
        jogos_reais = [j for j in partida[int(serie)]["jogos"] if j.get("id") and placar_real(j["lados"])]
        arquivo_da_serie[int(serie)] = {jogos_reais[0]["id"]: m["uuid"]}

    def chave_puuid(rid):
        r = pu.get((rid or "").lower())
        return r.get("puuid") if r and r.get("puuid") else None

    arquivos = []  # (serie, sufixo, origem, nome novo)
    placar_card = {}
    mapas = set()
    inicio_jogos = []
    for serie, por_jogo in sorted(arquivo_da_serie.items()):
        p = partida[serie]
        ids = [t["equipeId"] for t in p["equipes"]]
        for n, (jogo_id, uuid) in enumerate(sorted(por_jogo.items(), key=lambda kv: kv[0])):
            jogo = next(j for j in p["jogos"] if j.get("id") == jogo_id)
            riot = ler(base / "riot" / f"{uuid}.json")
            # orientação: cor do arquivo -> equipe da plataforma, pelos PUUIDs
            comp = {eid: {chave_puuid(c["riotId"]) for c in jogo["competidores"]
                          if [l["equipeId"] for l in jogo["lados"] if l["lado"] == c["lado"]][0] == eid} - {None}
                    for eid in ids}
            cor_puuids = defaultdict(set)
            for pl in riot["players"]:
                cor_puuids[pl["teamId"]].add(pl["puuid"])
            opcoes = []
            for ca, cb in (("Red", "Blue"), ("Blue", "Red")):
                opcoes.append((len(cor_puuids[ca] & comp[ids[0]]) + len(cor_puuids[cb] & comp[ids[1]]), ca, cb))
            total, cor_a, cor_b = max(opcoes)
            if total < 6:
                avisos.append(f"P{serie}: só {total} jogadores reconhecidos na orientação")
            rw = {t["teamId"]: t["roundsWon"] for t in riot["teams"]}
            pa, pb = rw[cor_a], rw[cor_b]
            cm_p = {l["equipeId"]: l["placar"] for l in jogo["lados"]}
            if (cm_p.get(ids[0]), cm_p.get(ids[1])) != (pa, pb) and str(serie) not in manuais:
                avisos.append(f"P{serie}: arquivo {pa}x{pb}, plataforma {cm_p.get(ids[0])}x{cm_p.get(ids[1])}")
            vencedor_p = [t["equipeId"] for t in p["equipes"] if t["colocacao"] == 0]
            if vencedor_p and vencedor_p[0] != (ids[0] if pa > pb else ids[1]):
                erros.append(f"P{serie}: vencedor do arquivo diverge da chave")
            inicio_jogos.append(datetime.fromtimestamp(riot["matchInfo"]["gameStartMillis"] / 1000, timezone.utc))
            data = inicio_jogos[-1].astimezone(BRT).strftime("%d-%m-%y")
            mapa = MAPAS[riot["matchInfo"]["mapId"].split("/")[-1]]
            mapas.add(mapa)
            sufixo = "" if len(por_jogo) == 1 else "abcde"[n]
            nome = f"{op.prefixo}_{serie:03d}{sufixo}_{data}_{slug_de[ids[0]]}_{pa}_x_{pb}_{slug_de[ids[1]]}_{mapa}.json"
            arquivos.append((serie, uuid, nome))
            placar_card[serie] = (pa, pb)

    # chave
    def card(n, ultima_inferior=False, slot=None):
        p = partida[n]
        ts = p["equipes"]
        reais = [t for t in ts if t["equipeId"] and not t["bye"]]
        partes = OrderedDict()
        partes["code"] = f"Partida {n}"
        if slot is not None:
            partes["slot"] = slot
        vencedor = next((t["equipeId"] for t in ts if t["colocacao"] == 0), None)
        if len(reais) < 2:
            for letra, t in zip("ab", ts):
                if t["equipeId"] and not t["bye"]:
                    partes[letra] = slug_de[t["equipeId"]]
                    partes["score" + letra.upper()] = 1
                else:
                    partes[letra + "Label"] = SEM
                    partes["score" + letra.upper()] = 0
            partes["winner"] = slug_de[reais[0]["equipeId"]] if reais else None
            return partes
        a, b = ts[0]["equipeId"], ts[1]["equipeId"]
        partes["a"] = slug_de[a]
        reais_jogos = [j for j in p["jogos"] if j.get("id") and placar_real(j["lados"])]
        status = None
        if n in placar_card:
            sa, sb = placar_card[n]
        elif reais_jogos:
            j = sorted(reais_jogos, key=lambda j: j["criado"])[-1]
            pl = {l["equipeId"]: l["placar"] for l in j["lados"]}
            sa, sb = pl[a], pl[b]
            avisos.append(f"P{n}: placar real {sa}x{sb} sem arquivo")
        else:
            sa, sb = ts[0]["placar"], ts[1]["placar"]
            status = None if n in sem_wo else "W.O."
        partes["scoreA"] = sa
        partes["b"] = slug_de[b]
        partes["scoreB"] = sb
        partes["winner"] = slug_de[vencedor] if vencedor else None
        if status:
            partes["status"] = status
        return partes

    no_chave = {t["equipeId"] for p in cm["partidas"] for t in p["equipes"] if t["equipeId"] and not t["bye"]}
    times = []
    for e in seeded:
        if e["id"] in no_chave and slug_de.get(e["id"]) not in times:
            times.append(slug_de.get(e["id"]))
    # Na liga o admin lançou o resultado depois do jogo: a data do jogo na
    # plataforma vem depois da partida, e o início sai do arquivo.
    datas = [utc(j["criado"]) for p in cm["partidas"] for j in p["jogos"] if j.get("criado")] + inicio_jogos
    fim = max(datas).astimezone(BRT).replace(hour=23, minute=0, second=0, microsecond=0)
    extra = ler(op.extra) if op.extra else {}
    liga = next((c for c in rod["chaves"] if c["tipo"] == 6), None)
    if liga:
        override, pesos = montar_liga(op, liga, partida, card, slug_de, times, mapas, extra, fim)
    else:
        override, pesos = montar_chave(op, rod, partida, card, slug_de, equipes, times, mapas, extra, fim, no_chave, erros)
    if op.pontos:
        pesos.update(ler(op.pontos))
    wo = sum(1 for m in percorrer_cards(override) if m.get("status") == "W.O.")

    bloco = "  " + json.dumps(op.evento) + ": " + js(override, 2) + ","
    print(f"{op.nome}: {len(arquivos)} arquivos, {len(times)} equipes, {wo} W.O.")
    for serie, uuid, nome in arquivos:
        print(f"  P{serie:<3} {uuid[:8]} -> {nome}")
    for a in avisos:
        print("AVISO", a)
    for e in erros:
        print("ERRO", e)
    if erros:
        sys.exit(1)
    (base / "override.js").write_text(bloco + "\n", encoding="utf-8")
    (base / "ranking-weights.json").write_text(json.dumps({op.evento: pesos}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # campeonato.json com logo e sourceId vazios de propósito: sem ele, a busca
    # do build_metadata no tournaments.xlsx casa pelo nome da pasta e uma
    # "Classificatória 2" herda datas, ícone e id de outro campeonato.
    inicio = min(datas).astimezone(BRT).strftime("%Y-%m-%dT13:00:00")
    meta = OrderedDict(id=op.evento, name=op.nome, organizer="AcadArena", source="Histórico", sourceId="",
                       startAt=inicio, endAt=fim.strftime("%Y-%m-%dT%H:%M:%S"), logo="")
    if op.gravar:
        for destino in filter(None, [op.destino, op.copia]):
            d = REPO / destino
            d.mkdir(parents=True, exist_ok=True)
            for serie, uuid, nome in arquivos:
                shutil.copyfile(base / "riot" / f"{uuid}.json", d / nome)
        with open(REPO / op.destino / "campeonato.json", "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
        print(f"gravados {len(arquivos)} arquivos e o campeonato.json em {op.destino}" + (f" (cópia dos arquivos em {op.copia})" if op.copia else ""))
    else:
        print("campeonato.json:", json.dumps(meta, ensure_ascii=False))


def percorrer_cards(override):
    for r in override.get("bracket", {}).get("regions", []):
        for c in r["columns"]:
            yield from c["matches"]
    for r in override.get("swiss", {}).get("rounds", []):
        yield from r["matches"]


def faixa_de(pos, pontos):
    """Rótulo da tabela de pontos que contém a posição ("9-11" para 10), ou a
    posição sozinha quando a tabela não tem faixa numérica para ela."""
    for rotulo in pontos:
        partes = rotulo.split("-")
        if all(p.isdigit() for p in partes) and int(partes[0]) <= pos <= int(partes[-1]):
            return rotulo
    return str(pos)


def montar_liga(op, liga, partida, card, slug_de, times, mapas, extra, fim):
    """Pontos corridos (chave tipo 6), no molde da Copa LUCE: rodadas da
    plataforma, classificação oficial do grupo e as N primeiras classificadas."""
    grupo = liga["grupos"][0]
    avancam = grupo["avancam"] or 0
    rodadas = [{"title": f"Rodada {i + 1}", "status": "Concluída", "bestOf": "MD1", "matches": [card(n) for n in sorted(r)]}
               for i, r in enumerate(liga["rodadas"])]
    pontos = (ler(op.pontos).get("placementPoints") if op.pontos else None) or {}
    standings, eliminadas, colocacoes = [], [], []
    for i, t in enumerate(grupo["tabela"]):
        v, slug, pos = t["ScoreValues"], slug_de[t["TeamId"]], i + 1
        linha = OrderedDict(id=slug, wins=v[1], losses=v[8], range=f"{pos}º")
        campanha = f"{v[1]}-{v[8]}"
        if pos <= avancam:
            standings.append(OrderedDict(linha, status="Classificado"))
            colocacoes.append({"range": "Classificado", "id": slug, "note": campanha})
        else:
            eliminadas.append(linha)
            colocacoes.append({"range": faixa_de(pos, pontos), "id": slug, "note": campanha})
    n_series = sum(len(r) for r in liga["rodadas"])
    override = OrderedDict(
        name=op.nome, organizer="AcadArena", organizerLogo="assets/organizers-logos/logo_AcadArena.png",
        prizePool="-", tier=extra.get("tier", "A"), type=extra.get("type", "Online - Fase de grupos"), status="Finalizado",
        teamCount=len(times), mapPool=sorted(m.capitalize() for m in mapas),
        format=extra.get("format", {"summary": "Pontos corridos", "details": [], "standings": "Classificação final"}),
        teams=times, placements=colocacoes,
        swiss=OrderedDict(roundRobin=True, seriesCount=n_series,
                          standingsLabel=extra.get("standingsLabel", f"Classificação final - as {avancam} primeiras avançam"),
                          rounds=rodadas, standings=standings, eliminated=eliminadas),
    )
    pesos = OrderedDict(defaultPhase="regular", name=op.nome, teams=len(times),
                        endAt=fim.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    return override, pesos


def montar_chave(op, rod, partida, card, slug_de, equipes, times, mapas, extra, fim, no_chave, erros):
    """Eliminação dupla (chaves tipo 3 e 4), no molde das classificatórias da
    Univavá: quatro vagas e colocações em blocos pela rodada da chave inferior."""
    regioes = []
    colunas_inferior = []
    vagas_chave = 2 * len(next(c for c in rod["chaves"] if c["tipo"] == 3)["rodadas"][0])
    for c in sorted(rod["chaves"], key=lambda c: c["tipo"]):
        if c["tipo"] not in (3, 4) or not c["rodadas"]:
            continue
        colunas = []
        for i, rodada in enumerate(c["rodadas"]):
            ultima = i == len(c["rodadas"]) - 1
            primeiro = min(rodada)
            reais = [n for n in rodada if len([t for t in partida[n]["equipes"] if t["equipeId"] and not t["bye"]]) == 2]
            if not reais:
                continue  # rodada só de bye (1ª inferior da chave de 64)
            # Chave de 64: rodada com bye lista só os jogos reais, com slot =
            # posição na coluna seguinte (Univavá C1). Na de 32 o bye aparece
            # como "Sem adversário" (Univavá C3).
            if vagas_chave >= 64 and len(reais) < len(rodada):
                cards = [card(n, slot=(n - primeiro) // 2) for n in sorted(reais)]
            else:
                cards = [card(n) for n in sorted(rodada)]
            col = {"title": titulo(c["tipo"], len(rodada), ultima), "matches": cards}
            colunas.append(col)
            if c["tipo"] == 4:
                colunas_inferior.append((i, col["title"], rodada, ultima))
        regioes.append({"name": "Chave superior" if c["tipo"] == 3 else "Chave inferior",
                        "className": "upper-bracket" if c["tipo"] == 3 else "lower-bracket", "columns": colunas})

    # colocações
    eliminada = {}
    for i, tit, rodada, ultima in colunas_inferior:
        for n in rodada:
            for t in partida[n]["equipes"]:
                if t["equipeId"] and not t["bye"] and t["colocacao"] == 1:
                    eliminada[t["equipeId"]] = (i, "Decisão de vaga inferior" if ultima else tit)
    superior = next(c for c in rod["chaves"] if c["tipo"] == 3)
    inferior = next(c for c in rod["chaves"] if c["tipo"] == 4)
    vagas = []
    for chave, nota in ((superior, "Chave superior"), (inferior, "Chave inferior")):
        for n in chave["rodadas"][-1]:
            v = next(t["equipeId"] for t in partida[n]["equipes"] if t["colocacao"] == 0)
            vagas.append((v, nota))
    colocacoes = [{"range": "Classificado", "id": slug_de[v], "note": nota} for v, nota in vagas]
    pos = len(vagas) + 1
    for i in sorted({v[0] for v in eliminada.values()}, reverse=True):
        bloco = [eid for eid, v in eliminada.items() if v[0] == i]
        nota = eliminada[bloco[0]][1]
        faixa = f"{pos}-{pos + len(bloco) - 1}" if len(bloco) > 1 else str(pos)
        bloco.sort(key=lambda eid: equipes[eid]["seed"])
        colocacoes += [{"range": faixa, "id": slug_de[eid], "note": nota} for eid in bloco]
        pos += len(bloco)
    sem_colocacao = no_chave - {v for v, _ in vagas} - set(eliminada)
    if sem_colocacao:
        erros.append(f"equipes sem colocação: {[equipes[e]['nome'] for e in sem_colocacao]}")

    override = OrderedDict(
        name=op.nome, organizer="AcadArena", organizerLogo="assets/organizers-logos/logo_AcadArena.png",
        prizePool="-", tier=extra.get("tier", "A"), type=extra.get("type", "Online - Classificatória"), status="Finalizado",
        teamCount=len(times), mapPool=sorted(m.capitalize() for m in mapas), teams=times, placements=colocacoes,
        format=extra.get("format", {"summary": "Eliminação dupla",
                "details": ["Classificatória com 4 vagas", "2 vagas pela chave superior", "2 vagas pela chave inferior", "Jogos MD1"],
                "standings": "Classificados oficiais"}),
        bracket={"title": "Eliminação dupla", "regions": regioes},
    )
    pesos = OrderedDict(defaultPhase="regular", phaseRules=[
        {"phase": "qualifier", "seriesCodeMin": min(superior["rodadas"][-2]), "seriesCodeMax": max(superior["rodadas"][-1])},
        {"phase": "qualifier", "seriesCodeMin": min(inferior["rodadas"][-2]), "seriesCodeMax": max(inferior["rodadas"][-1])},
    ], name=op.nome, teams=len(times), endAt=fim.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"))
    return override, pesos


if __name__ == "__main__":
    main()
