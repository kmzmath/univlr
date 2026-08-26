# Gera a versão de linha das capas de campeonato, para o hover da home.
#
# Uso: python scripts/build_event_row_banners.py
#
# Por que existe: a capa cheia de assets/tournament-banners/ é feita para o
# hero da página do campeonato — até 2400px de largura e 315 KB no pior caso,
# 121 KB de média. É o asset mais pesado da casa e por isso ficou de fora do
# aquecimento de cache (ver collectWarmImageSources em app.js). Revelar essa
# capa no hover da linha da home com o arquivo de hero custaria 121 KB por
# passada de mouse.
#
# A linha da home foi medida em 323x130 px no maior caso (o painel de
# campeonatos é uma calha de largura fixa; em 375px e em 1440px a linha fica
# entre 97 e 130 de altura). O alvo é 2x disso: 646x260.
#
# O recorte é assado no arquivo, e não deixado para o background-size: cover:
# as capas vão de 1:1 a 4:1, e deixar o navegador cortar exigiria mandar a
# imagem inteira. Com o recorte central assado, uma capa 1:1 de 1080x1080 vira
# 646x260 em vez de 646x646 — o mesmo pixel visível, 40% do peso.
#
# Medido nas 9 capas:
#   originais ................ 1.111.978 B (1,06 MB)
#   cobrindo sem recortar ....   232.040 B  (q80)
#   recorte 646x260 q70 ......   119.386 B
#   recorte 646x260 q80 ......   155.456 B  <- escolhido, 17 KB de media
#   recorte 646x260 q85 ......   195.402 B
#
# q80 e não lossless: capa é arte fotográfica atrás de um véu de 72% de opacidade,
# o oposto do caso das bandeiras (cor chapada com linha fina, onde o lossless
# ganhou). Aqui a perda não chega ao olho.

import io
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
ORIGEM = ROOT / "assets" / "tournament-banners"
DESTINO = ORIGEM / "row"

LARGURA, ALTURA = 646, 260
QUALIDADE = 80
EXTENSOES = {".png", ".jpg", ".jpeg", ".webp"}


def main():
    fontes = sorted(p for p in ORIGEM.glob("*.*") if p.suffix.lower() in EXTENSOES)
    if not fontes:
        print("nenhuma capa em assets/tournament-banners - nada a fazer")
        return

    DESTINO.mkdir(parents=True, exist_ok=True)
    antes = 0
    depois = 0
    for origem in fontes:
        imagem = Image.open(origem).convert("RGB")
        recorte = ImageOps.fit(
            imagem, (LARGURA, ALTURA), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5)
        )
        buffer = io.BytesIO()
        recorte.save(buffer, format="WEBP", quality=QUALIDADE, method=6)
        alvo = DESTINO / f"{origem.stem}.webp"
        alvo.write_bytes(buffer.getvalue())
        antes += origem.stat().st_size
        depois += buffer.getbuffer().nbytes
        print(f"  {alvo.name:34} {imagem.size[0]}x{imagem.size[1]} -> {LARGURA}x{ALTURA}  {buffer.getbuffer().nbytes:6} B")

    print(f"\n{len(fontes)} capas")
    print(f"hero  : {antes} B ({antes / 1048576:.2f} MB)")
    print(f"linha : {depois} B ({depois / 1024:.1f} KB), media {depois // len(fontes)} B por passada de mouse")


if __name__ == "__main__":
    main()
