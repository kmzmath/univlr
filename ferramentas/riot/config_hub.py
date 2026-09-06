# -*- coding: utf-8 -*-
"""
Caminhos e segredo dos scripts que falam com a API da Riot.

Tres coisas moram em lugares diferentes de proposito:

  REPO_DIR      o repositorio do site. Guarda o CODIGO (estes scripts) e a
                FONTE (dados_excel). E publico, entao nada de segredo aqui.
  TRABALHO_DIR  a pasta de trabalho, fora do repo: Finalizados, out_tournament,
                matchlists, as saidas de analise e o .env com a chave. Sao
                centenas de MB de arquivo bruto que nao precisam de historico.
  RIOT_API_KEY  variavel de ambiente, ou o .env da pasta de trabalho.

O REPO_DIR e deduzido do proprio arquivo (ferramentas/riot -> raiz), entao
funciona em qualquer maquina sem editar caminho. A pasta de trabalho tem um
padrao e aceita a variavel UNIVLR_TRABALHO por cima.

NAO ha fallback para copia local das planilhas, de proposito: uma copia velha
que funciona em silencio foi o que fez a A2E UFF sair como "unknown" no nome de
arquivo do JUBS presencial, com o script lendo um cadastro de 12 dias atras. Se
a planilha nao estiver no lugar, os scripts param com o caminho na mensagem.
"""
import os
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parents[2]
DADOS_EXCEL = REPO_DIR / "dados_excel"

TRABALHO_DIR = Path(
    os.environ.get("UNIVLR_TRABALHO") or r"C:/Users/Administrator/Desktop/Pend1/API VAL"
).resolve()


def planilha(nome: str) -> Path:
    alvo = DADOS_EXCEL / nome
    if not alvo.exists():
        raise RuntimeError(
            f"Planilha nao encontrada: {alvo}\n"
            f"Os scripts leem as planilhas do repo do site (dados_excel). "
            f"Confira se o repo esta completo."
        )
    return alvo


def riot_api_key() -> str:
    """
    Chave da Riot, nunca em codigo: o repositorio e publico.

    Ordem: variavel de ambiente RIOT_API_KEY, depois o .env da pasta de
    trabalho. Devolve "" quando nao acha - quem valida e o RiotClient, para o
    import destes modulos continuar funcionando sem chave (as analises nao
    precisam dela).
    """
    do_ambiente = (os.environ.get("RIOT_API_KEY") or "").strip()
    if do_ambiente:
        return do_ambiente

    env = TRABALHO_DIR / ".env"
    if not env.exists():
        return ""
    for linha in env.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, _, valor = linha.partition("=")
        if chave.strip() == "RIOT_API_KEY":
            return valor.strip().strip('"').strip("'")
    return ""


# Excel e LibreOffice avaliam como formula a celula que comeca com = + - @,
# e o openpyxl chega a gravar a string como formula de verdade (data_type "f").
# O nick da Riot e escolhido por terceiro e entra aqui inteiro: quem se chamar
# "=..." escreve formula na nossa planilha e no relatorio que a gente abre.
PREFIXOS_DE_FORMULA = ("=", "+", "-", "@", "\t", "\r")


def texto_seguro(valor):
    """
    Neutraliza injecao de formula sem estragar o dado.

    Devolve o valor intacto se nao for texto perigoso. Numero passa direto -
    so texto que comeca com um dos prefixos ganha a aspa simples, que e o
    marcador de literal do proprio Excel.
    """
    if not isinstance(valor, str) or not valor:
        return valor
    return "'" + valor if valor.startswith(PREFIXOS_DE_FORMULA) else valor


PLAYERS_XLSX = planilha("players.xlsx")
TEAMS_XLSX = planilha("teams.xlsx")
ROUND_STATE_WINRATES_XLSX = planilha("round_state_winrates.xlsx")
