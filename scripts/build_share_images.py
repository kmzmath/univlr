# Gera as imagens que aparecem no preview de link (WhatsApp, Discord, Twitter).
#
# Uso: python scripts/build_share_images.py
#      (o scripts/build_news.js chama isto sozinho no fim do build)
#
# Por que um arquivo separado da capa que o site usa:
#
#   1. FORMATO. A capa do site e WebP porque ela e servida a todo leitor e o
#      WebP pesa metade. O robo de preview e outra historia: o do WhatsApp e o
#      do Facebook nao renderizam WebP de forma confiavel, e um og:image que
#      eles nao decodificam vira card sem imagem. Entao a versao de preview e
#      JPEG, sempre.
#
#   2. PROPORCAO. O padrao de card grande e 1,91:1 (1200x630). A capa do site e
#      2:1. Sao proximos, mas nao iguais - e quem recorta e o aplicativo, sem
#      dizer por onde. Melhor recortar aqui, onde da para conferir.
#
#   3. PESO. O WhatsApp descarta imagem grande demais em vez de reduzi-la.
#      1200x630 em JPEG fica na casa dos 100 KB.
#
# Sem Pillow instalado o script sai em silencio com codigo 0: o build de
# noticias nao pode quebrar por causa da imagem de preview.

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:  # pragma: no cover
    print("Pillow nao encontrado - imagens de preview nao foram geradas")
    sys.exit(0)

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L, A = 1200, 630
FUNDO = (8, 9, 13)
MARCA = (246, 19, 42)


def fundo_da_marca():
    """O mesmo chao dos cartoes do site: preto com um foco de luz atras."""
    base = Image.new("RGB", (L, A), FUNDO)
    brilho = Image.new("L", (L, A), 0)
    ImageDraw.Draw(brilho).ellipse([L * 0.1, -A * 0.4, L * 0.9, A * 1.4], fill=70)
    brilho = brilho.filter(ImageFilter.GaussianBlur(130))
    return Image.composite(Image.new("RGB", (L, A), (26, 28, 38)), base, brilho)


def cartao_do_site(destino):
    """O card de quem cola a raiz do site, ou qualquer rota sem pagina propria."""
    img = fundo_da_marca()
    logo = Image.open(os.path.join(RAIZ, "assets", "univlr_logo_longa.png")).convert("RGBA")
    largura = 620
    logo = logo.resize((largura, round(largura * logo.height / logo.width)), Image.LANCZOS)
    img.paste(logo, ((L - logo.width) // 2, (A - logo.height) // 2), logo)
    ImageDraw.Draw(img).rectangle([0, 0, 5, A], fill=MARCA)
    img.save(destino, "JPEG", quality=88, optimize=True)
    return destino


def cartao_da_capa(origem, destino):
    """Recorta uma capa de materia para 1,91:1, pelo centro."""
    capa = Image.open(origem).convert("RGB")
    escala = max(L / capa.width, A / capa.height)
    capa = capa.resize((round(capa.width * escala), round(capa.height * escala)), Image.LANCZOS)
    esq, topo = (capa.width - L) // 2, (capa.height - A) // 2
    capa = capa.crop((esq, topo, esq + L, topo + A))
    capa.save(destino, "JPEG", quality=86, optimize=True)
    return destino


def main():
    feitos = []

    compartilhar = os.path.join(RAIZ, "assets", "share")
    os.makedirs(compartilhar, exist_ok=True)
    feitos.append(cartao_do_site(os.path.join(compartilhar, "univlr.jpg")))

    noticias = os.path.join(RAIZ, "assets", "noticias")
    if os.path.isdir(noticias):
        for slug in sorted(os.listdir(noticias)):
            pasta = os.path.join(noticias, slug)
            if not os.path.isdir(pasta):
                continue
            capas = [f for f in os.listdir(pasta) if f.startswith("capa.")]
            if not capas:
                continue
            feitos.append(cartao_da_capa(os.path.join(pasta, capas[0]),
                                         os.path.join(pasta, "capa-share.jpg")))

    for caminho in feitos:
        rel = os.path.relpath(caminho, RAIZ).replace("\\", "/")
        print(f"  {rel}  {os.path.getsize(caminho) // 1024} KB")
    print(f"{len(feitos)} imagem(ns) de preview")


if __name__ == "__main__":
    main()
