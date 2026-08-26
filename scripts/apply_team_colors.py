# Injeta as cores de equipe (cor1/cor2 de dados_excel/teams_infos.xlsx) no
# metadata.json JÁ COMMITADO.
#
# Uso: python scripts/apply_team_colors.py
#      node scripts/apply_team_colors.js     <- depois deste, sempre
#
# Por que existe: scripts/build_metadata.py já lê cor1/cor2 e emite
# teams[].colors, mas rodar o build inteiro hoje traz junto três divergências
# que nada têm a ver com cor — dois logos renomeados na planilha
# (pucc_cardinals -> puccCanaries, pucgo_sistematica -> ..._academy) e um
# instagram trocado — além de desfazer as trocas .png -> .webp que
# scripts/rewrite_asset_paths.js aplica por fora. Este script mexe só no campo
# `colors`, deixando o resto do artefato como está.
#
# O formato de saída é o mesmo do build: indent 2, ensure_ascii=False, quebra
# de linha LF e newline no fim. Gravar com o padrão do Windows trocaria as
# 13.352 linhas por CRLF e o diff viraria o arquivo inteiro.

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLANILHA = ROOT / "dados_excel" / "teams_infos.xlsx"
ALVO = ROOT / "metadata.json"


def carrega_build_metadata():
    """Reaproveita hex_color/slug_key/load_rows em vez de duplicar a limpeza."""
    spec = importlib.util.spec_from_file_location("bm", ROOT / "scripts" / "build_metadata.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def main():
    if not PLANILHA.exists():
        print(f"ABORTADO - {PLANILHA} nao existe")
        raise SystemExit(1)

    bm = carrega_build_metadata()
    cores = {}
    ignoradas = []
    for row in bm.load_rows(PLANILHA):
        slug = bm.slug_key(row.get("slug", ""))
        if not slug:
            continue
        par = [c for c in (bm.hex_color(row.get("cor1")), bm.hex_color(row.get("cor2"))) if c]
        if len(par) == 2:
            cores[slug] = par
        else:
            ignoradas.append((slug, repr(row.get("cor1")), repr(row.get("cor2"))))

    dados = json.loads(ALVO.read_text(encoding="utf-8"))
    equipes = dados.get("teams") or []
    controle = {"equipes": len(equipes), "jogadores": len(dados.get("players") or []), "estados": len(dados.get("states") or [])}

    pintadas = 0
    sem_cor = []
    for equipe in equipes:
        par = cores.get(equipe.get("id") or equipe.get("slug"))
        if not par:
            sem_cor.append(equipe.get("id"))
            continue
        equipe["colors"] = par
        pintadas += 1

    saida = json.dumps(dados, ensure_ascii=False, indent=2) + "\n"
    lido = json.loads(saida)
    checagens = [
        ("equipes", len(lido.get("teams") or []) == controle["equipes"]),
        ("jogadores", len(lido.get("players") or []) == controle["jogadores"]),
        ("estados", len(lido.get("states") or []) == controle["estados"]),
        ("todo par tem 2 cores #rrggbb", all(len(t["colors"]) == 2 and all(c.startswith("#") and len(c) == 7 for c in t["colors"]) for t in lido["teams"] if "colors" in t)),
    ]
    falhas = [nome for nome, ok in checagens if not ok]
    if falhas:
        print("ABORTADO - verificacao falhou:")
        for nome in falhas:
            print(f"  x {nome}")
        raise SystemExit(1)

    with ALVO.open("w", encoding="utf-8", newline="\n") as arquivo:
        arquivo.write(saida)

    print(f"planilha: {len(cores)} equipes com o par completo")
    if ignoradas:
        print(f"  cor incompleta ou invalida em {len(ignoradas)}:")
        for slug, c1, c2 in ignoradas[:10]:
            print(f"    {slug}: cor1={c1} cor2={c2}")
    print(f"metadata.json: {pintadas}/{len(equipes)} equipes pintadas")
    if sem_cor:
        print(f"  sem correspondencia na planilha ({len(sem_cor)}): {', '.join(filter(None, sem_cor))}")
    for nome, _ in checagens:
        print(f"  ok {nome}")


if __name__ == "__main__":
    main()
