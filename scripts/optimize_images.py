# Otimiza as imagens de assets/ in-place: redimensiona para o tamanho máximo
# de exibição real e quantiza a paleta (PNG) ou recomprime (JPEG).
#
# Uso: python scripts/optimize_images.py
#
# Só substitui o arquivo quando o resultado fica menor que o original.
# Os originais ficam preservados no histórico do git.

import io
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

# (pasta, dimensão máxima, cores da paleta)
FOLDER_RULES = [
    ("assets/player-photos", 320, 256),
    ("assets/team-logos", 256, 256),
    ("assets/tournament-icons", 256, 256),
    ("assets/organizers-logos", 256, 256),
    ("assets/trofeus-campeonatos", 320, 256),
    ("assets/agent-icons", 128, 256),
    ("assets/maps", 1600, 256),
    ("assets/tournament-banners", 1600, 256),
]

# Arquivos soltos na raiz de assets/
FILE_RULES = {
    "assets/user-silhouette.png": (320, 256),
    "assets/logo_univlr.png": (512, 256),
    "assets/univlr_logo_longa.png": (600, 256),
    "assets/manutencao.png": (800, 256),
}

EXTENSIONS = {".png", ".jpg", ".jpeg"}


def optimize_file(path, max_dim, colors):
    original_bytes = path.stat().st_size
    with Image.open(path) as source:
        image = source.convert("RGBA" if source.mode not in ("RGB", "L") else source.mode)
        if max(image.size) > max_dim:
            image.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)

        buffer = io.BytesIO()
        if path.suffix.lower() == ".png":
            if image.mode in ("RGBA", "RGB"):
                image = image.quantize(colors=colors, method=Image.Quantize.FASTOCTREE)
            image.save(buffer, format="PNG", optimize=True)
        else:
            image.convert("RGB").save(buffer, format="JPEG", quality=82, optimize=True, progressive=True)

    new_bytes = buffer.getbuffer().nbytes
    if new_bytes >= original_bytes:
        return original_bytes, original_bytes, False
    path.write_bytes(buffer.getvalue())
    return original_bytes, new_bytes, True


def main():
    targets = []
    for folder, max_dim, colors in FOLDER_RULES:
        base = ROOT / folder
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix.lower() in EXTENSIONS and path.is_file():
                targets.append((path, max_dim, colors))
    for rel, (max_dim, colors) in FILE_RULES.items():
        path = ROOT / rel
        if path.is_file():
            targets.append((path, max_dim, colors))

    total_before = total_after = changed = 0
    for path, max_dim, colors in targets:
        try:
            before, after, replaced = optimize_file(path, max_dim, colors)
        except Exception as error:  # arquivo corrompido/formato inesperado
            print(f"  AVISO: falha em {path.relative_to(ROOT)}: {error}")
            continue
        total_before += before
        total_after += after
        changed += 1 if replaced else 0

    mb = lambda n: f"{n / 1048576:.1f} MB"
    print(f"{len(targets)} imagens analisadas, {changed} otimizadas")
    print(f"antes: {mb(total_before)} -> depois: {mb(total_after)} (-{100 - 100 * total_after // max(total_before, 1)}%)")


if __name__ == "__main__":
    sys.exit(main())
