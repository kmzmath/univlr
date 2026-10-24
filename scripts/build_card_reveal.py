"""Atualiza a página pública das cartinhas com os dias já revelados."""

import argparse
import csv
import json
import re
import shutil
import subprocess
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "outputs/cartinhas/publicacao-2026-minimo-200-rounds-12-partidas"
SCHEDULE = SOURCE / "calendario-publicacao-216-cartinhas.csv"
IMAGES = SOURCE / "Temporada 2026 - Todos os campeonatos"
ELIGIBLE = SOURCE / "elegiveis.json"
PUBLIC = ROOT / "cartas"
PREVIEW = ROOT / "outputs/cartinhas/preview-cartas"


def exported_name(value):
    normalized = unicodedata.normalize("NFD", str(value))
    ascii_name = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    ascii_name = re.sub(r"[^\x20-\x7E]+", "-", ascii_name)
    ascii_name = re.sub(r'[\\/:*?"<>|]+', "_", ascii_name)
    return re.sub(r"\s+", " ", ascii_name).strip()


def load_schedule():
    with SCHEDULE.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream, delimiter=";"))
    if len(rows) != 216:
        raise ValueError(f"Esperadas 216 cartinhas; encontradas {len(rows)}")
    dates = [date.fromisoformat(row["Data"]) for row in rows]
    counts = Counter(dates)
    if dates[0] != date(2026, 10, 23) or dates[-1] != date(2026, 11, 24):
        raise ValueError("O calendário precisa ir de 23/10 a 24/11")
    if max(counts.values()) > 10:
        raise ValueError("Há um dia com mais de 10 cartinhas")
    if len(counts) != 33:
        raise ValueError("O calendário precisa ter 33 dias")
    if sum(count for day, count in counts.items() if day > date(2026, 11, 14)) != 20:
        raise ValueError("O top 20 precisa ficar após a final do UNIVAVÁ")
    if any(dates[i] > dates[i + 1] for i in range(len(dates) - 1)):
        raise ValueError("As datas não estão em ordem")
    if any(int(row["Ordem geral"]) != index + 1 for index, row in enumerate(rows)):
        raise ValueError("A ordem geral tem lacunas")
    if any(int(rows[i]["Overall"]) > int(rows[i + 1]["Overall"]) for i in range(len(rows) - 1)):
        raise ValueError("Os overalls não estão em ordem crescente")
    for row in rows:
        source = IMAGES / exported_name(row["Time"]) / f'{exported_name(row["Jogador"])}.png'
        if not source.is_file():
            raise FileNotFoundError(f"Cartinha exportada não encontrada: {source}")
    return rows, counts


def publish(through, preview):
    rows, counts = load_schedule()
    if through < date(2026, 10, 22) or through > date(2026, 11, 24):
        raise ValueError("Escolha uma data entre 22/10 e 24/11/2026")
    if through > date.today() and not preview:
        raise ValueError("Data futura: use --preview apenas para preparar uma versão local")

    destination = PREVIEW if preview else PUBLIC
    image_dir = destination / "cards"
    image_dir.mkdir(parents=True, exist_ok=True)
    if preview:
        for name in ("index.html", "styles.css", "app.js"):
            shutil.copy2(PUBLIC / name, destination / name)
    selected = [row for row in rows if date.fromisoformat(row["Data"]) <= through]
    eligible = json.loads(ELIGIBLE.read_text(encoding="utf-8"))["jogadores"]
    eligible_by_key = {(item["jogador"], item["time"]): item for item in eligible}
    ids = {key: item["puuid"] for key, item in eligible_by_key.items()}
    if len(ids) != len(eligible):
        raise ValueError("Jogador e time precisam identificar cada cartinha sem ambiguidade")
    selected_ids = []
    for row in selected:
        key = (row["Jogador"], row["Time"])
        if key not in ids:
            raise ValueError(f"Jogador ausente dos elegíveis: {key}")
        selected_ids.append(ids[key])
    if selected_ids:
        process = subprocess.run(
            ["node", str(ROOT / "scripts/card_reveal_details.cjs")],
            input=json.dumps(selected_ids), text=True, capture_output=True,
            encoding="utf-8", cwd=ROOT, check=True,
        )
        details = json.loads(process.stdout)
    else:
        details = {}
    released = {}
    for row in rows:
        day = date.fromisoformat(row["Data"])
        if day > through:
            continue
        rank = int(row["Ordem geral"])
        filename = f"{rank:03d}.webp"
        source = IMAGES / exported_name(row["Time"]) / f'{exported_name(row["Jogador"])}.png'
        target = image_dir / filename
        if not target.is_file() or source.stat().st_mtime_ns > target.stat().st_mtime_ns:
            with Image.open(source) as card:
                card.save(target, "WEBP", quality=92, method=6)
        released[filename] = True

    # Apenas arquivos criados por este publicador, identificados por três dígitos.
    for pattern in ("[0-9][0-9][0-9].png", "[0-9][0-9][0-9].webp"):
        for target in image_dir.glob(pattern):
            if target.name not in released:
                target.unlink()

    days = []
    for day in sorted(counts):
        day_rows = [row for row in rows if row["Data"] == day.isoformat()]
        entry = {"date": day.isoformat(), "count": counts[day]}
        if day <= through:
            entry["cards"] = [
                {
                    "rank": int(row["Ordem geral"]),
                    "name": row["Jogador"],
                    "team": row["Time"],
                    "overall": int(row["Overall"]),
                    "image": f'cards/{int(row["Ordem geral"]):03d}.webp',
                    "adjustedRating": eligible_by_key[(row["Jogador"], row["Time"])]["raatingFinal"],
                    **details[ids[(row["Jogador"], row["Time"])]],
                }
                for row in day_rows
            ]
        days.append(entry)

    manifest = {
        "season": 2026,
        "total": len(rows),
        "publishedThrough": through.isoformat(),
        "days": days,
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    label = "Prévia local" if preview else "Página pública"
    print(f"{label} atualizada até {through:%d/%m/%Y}: {len(released)} cartinhas liberadas")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ate", required=True, type=date.fromisoformat, metavar="AAAA-MM-DD")
    parser.add_argument("--preview", action="store_true", help="Permite preparar uma edição futura localmente")
    args = parser.parse_args()
    publish(args.ate, args.preview)
