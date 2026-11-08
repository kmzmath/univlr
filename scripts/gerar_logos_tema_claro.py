"""Gera as versoes do logo para o tema claro.

O logo tem o U vermelho e o resto (letras, capelo) em branco e cinza. No tema
claro o branco some sobre o fundo gelo, entao os pixels sem cor (saturacao
baixa) tem o brilho invertido: branco vira o preto da marca, cinza continua
cinza. O vermelho fica intacto. Rodar de novo se o logo mudar.
"""
from pathlib import Path
from PIL import Image
import colorsys

RAIZ = Path(__file__).resolve().parent.parent
PRETO = (4, 3, 6)

for nome in ("univlr_logo_longa.png", "logo_univlr.png"):
    origem = RAIZ / "assets" / nome
    destino = origem.with_name(origem.stem + "_claro.png")
    img = Image.open(origem).convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s < 0.25:
                t = 1 - v  # 0 = branco vira preto da marca, 1 = preto vira branco
                px[x, y] = tuple(round(p + (255 - p) * t) for p in PRETO) + (a,)
    img.save(destino, optimize=True)
    print(destino.name, img.size)
