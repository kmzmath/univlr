# Coletar campeonatos de VALORANT anteriores a 2026 pelo tracker.gg

Você está no repositório do UNIVLR em `C:\Users\mmora\Documents\Hub Uni`, nesta máquina Windows. Rode tudo localmente: o método depende de um Chrome aberto nesta máquina.

## Contexto

O site só tem partidas a partir de 2026, porque a API da Riot guarda poucos meses.

Para os campeonatos antigos, a fonte é o tracker.gg. O detalhe de partida dele é o mesmo dado da Riot, só que com outro esquema. Já existe um método testado para coletar, conferir e converter.

Seu trabalho é rodar esse método nos campeonatos da tabela abaixo e relatar o resultado. Não redesenhe o método.

Antes de qualquer coisa, leia `ferramentas/tracker-campeonato/README.md`. Ele explica:

- o método;
- os comandos;
- a leitura do relatório;
- o ritmo de requisições;
- as armadilhas conhecidas.

As ferramentas dessa pasta ainda não estão commitadas. Não apague, não mova e não reescreva nada nela.

## Campeonatos

Processe na ordem da tabela, que deve ser cronológica. A pasta de cada um é `outputs/<slug>`, com slug curto, em minúsculas e com hífen (ex.: `classificatoria-3-2025`).

| # | URL do torneio no Challengermode | Pasta |
|---|---|---|
| 1 | (preencher) | outputs/(preencher) |

Se um campeonato não estiver no Challengermode, pare nele e me avise. Não monte o `cm.json` à mão.

## Antes do primeiro campeonato

1. **Chrome dedicado.** Rode `Invoke-RestMethod http://127.0.0.1:9222/json/version`.
   - Se falhar, abra o Chrome com `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\mmora\Downloads\tracker-collector-cdp\cdp\start-chrome.ps1"`. Espere 10 s e confira de novo.
   - Esse Chrome é a única via de acesso ao tracker e ao Challengermode.
   - Se o tracker mostrar verificação de acesso, pare e me chame. Quem passa por ela sou eu, no próprio Chrome.
2. **Codificação.** Em todo terminal que rodar Python, defina `$env:PYTHONIOENCODING = "utf-8"`.
3. **Chave da Riot.** O `ferramentas/riot/config_hub.py` lê a chave sozinho. Não imprima, não copie e não grave a chave em lugar nenhum.
4. **Nenhuma outra consulta ao tracker.** Rode `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -match 'coletar.cjs|baixar_detalhes.cjs' | Select-Object ProcessId, CommandLine` e confirme que a saída vem vazia. O tracker conta as requisições por IP.

## Para cada campeonato

1. **Extração do Challengermode:**
   - Rode `node ferramentas/tracker-campeonato/extrair_cm.cjs outputs/<slug> <url>`.
   - Anote as equipes, chaves, partidas e jogos que ele imprime.
   - Se aparecer `AVISO` de fase de grupos, confira o número de partidas com jogo contra a página `<url>/matches`, se conseguir. Se não conseguir, registre o aviso como não conferido.
2. **PUUID:** rode `python ferramentas/tracker-campeonato/resolver_puuid.py outputs/<slug>`.
3. **Coleta, em segundo plano.** É o único passo que faz requisições ao tracker, e leva cerca de 1 h para 60 jogos.
   ```powershell
   Start-Process -FilePath node -WorkingDirectory "C:\Users\mmora\Documents\Hub Uni" -WindowStyle Hidden `
     -RedirectStandardOutput "outputs\<slug>\coleta-stdout.txt" -RedirectStandardError "outputs\<slug>\coleta-stderr.txt" `
     -ArgumentList @("ferramentas/tracker-campeonato/coletar.cjs", "outputs/<slug>", "--reaproveitar", "outputs/classificatoria-1-2025/lote/indices", "--reaproveitar", "outputs/classificatoria-2-2025/lote/indices")
   ```
   - **Reaproveitamento:** passe um `--reaproveitar <pasta>/lote/indices` para cada campeonato já coletado do mesmo ano, incluindo os que você coletar antes nesta tarefa. Os dois da linha acima são de 2025. Uma página de índice cobre semanas ou meses, então isso economiza requisições.
   - **Acompanhamento:** de 5 em 5 a 10 em 10 min, rode `Get-Content "outputs\<slug>\lote\coleta.log" -Tail 15 -Encoding utf8`. A execução termina com uma linha `FIM`.
   - **Uma instância por vez.** Nunca abra uma segunda coleta, nem em outra pasta, enquanto houver uma rodando.
   - **Se aparecer `PARADA`:**

     | Motivo na linha | O que fazer |
     |---|---|
     | "verificação de acesso" ou HTTP 403 | Pare tudo e me chame. Não tente de novo. |
     | "segundo 429" | Pare tudo e me chame. |
     | "teto de N requisições" | Rode de novo. A coleta retoma de onde parou. |
     | "três vezes" (falha de rede) | Confira a conexão e rode de novo uma vez. Se repetir, pare e me chame. |

   - **Se o processo morrer com exceção** (veja `coleta-stderr.txt`), copie o erro para o relatório e não remende às cegas.
4. **Segunda passada de PUUID:**
   - Rode `python ferramentas/tracker-campeonato/resolver_puuid.py outputs/<slug> outputs/<slug>/lote/ids_tracker.txt`.
   - Depois rode `node ferramentas/tracker-campeonato/coletar.cjs outputs/<slug> --max 0`, que refaz o relatório sem nenhuma requisição.
   - Repita os dois até o `ids_tracker.txt` não trazer conta nova.
5. **Identidades:** rode `python ferramentas/tracker-campeonato/conferir_identidades.py outputs/<slug>`.
6. **Conversão:** rode `python ferramentas/tracker-campeonato/converter.py outputs/<slug>/puuids.json outputs/<slug>/riot outputs/<slug>/lote/relatorio.json`.
7. **Pipeline do site:** rode `node --max-old-space-size=8192 ferramentas/tracker-campeonato/comparar_site.cjs convertidos outputs/<slug>/riot`. O esperado é "0 erro(s), 0 linha(s) estranha(s)".
8. **Relatório do campeonato:** escreva `outputs/<slug>/RELATORIO.md`, no formato descrito no fim deste prompt.

## Regras

- **Ritmo:**
  - Não faça requisições ao tracker fora desses scripts.
  - Não rode duas coletas ao mesmo tempo.
  - Não mude o ritmo (`ritmo.cjs`), as folgas de janela, `MIN_CONFERE_LADO` nem `MAX_CONTAS_POR_JOGO`.
- **Acesso:**
  - Não contorne Cloudflare.
  - Não copie cookies.
  - Não use outro navegador.
- **Arquivos do site:**
  - Não toque em `campeonatos/`, `dados_excel/`, `app.js`, `metadata.json`, `data-sources.json`, `database.json` nem `home.json`.
  - Não rode o build.
  - Não commite nada.
- **Decisões que não são suas:**
  - se um jogo foi W.O.;
  - o que fazer com um jogo de "outra conta";
  - qual equipe de 2025 corresponde a qual slug do site;
  - se o campeonato entra no site.

  Relate cada caso com a evidência.
- **Faltantes:**
  - Diga que "o tracker não tem" um jogo só com evidência: pelo menos uma conta que jogou, com o índice cobrindo a janela inteira, sem a partida. As páginas percorridas estão em `lote/estado.json`.
  - Sem essa evidência, escreva "não encontrado".
- **Bugs nas ferramentas:** se encontrar um, faça a correção mínima e explique.
  - Rode `node --check` no arquivo e a coleta com `--max 0`.
  - Se mexer no `converter.py`, refaça o controle:
    - `python ferramentas/tracker-campeonato/converter.py outputs/controle-conversor/puuids.json outputs/controle-conversor/riot outputs/controle-conversor/tracker`
    - `node --max-old-space-size=8192 ferramentas/tracker-campeonato/comparar_site.cjs controle outputs/controle-conversor/controle.json outputs/controle-conversor/riot`
  - No controle, só podem diferir `damage`, `adr`, `eDamageTotal`, `adjustedRoundSwingTotalPp` e `raating_3`, com p95 de até 0,0015. Isso é o ruído de ordem descrito no README.
- **Escrita:**
  - Escreva em português.
  - Nunca use travessão (o traço longo). Use hífen.
- **Sempre diga** o que não foi feito ou não foi conferido.

## Formato do relatório

Faça um `RELATORIO.md` por campeonato e, no fim, um resumo na conversa com uma linha por campeonato.

- **Jogos com placar real:**
  - total;
  - com arquivo, separando os "10 de 10" dos parciais;
  - faltantes, cada um com a evidência ou com "não encontrado".
- **Jogos sem placar real:** série, equipes, placar no store, resolução, duração e a leitura (assinatura de W.O., possível jogo, lobby refeito).
- **Identidades:**
  - quantos jogadores foram explicados por nome velho no Challengermode;
  - a lista de "outra conta" e de "fora da lista", com série, equipe e os dois Riot IDs.
- **Contas sem PUUID:** a lista, depois da última passada.
- **Coleta:**
  - requisições de índice, de detalhe e com 451;
  - o horário da primeira e da última requisição;
  - quantos candidatos vieram do reaproveitamento.
- **Conversão:** quantos arquivos foram convertidos, os erros e as linhas estranhas do pipeline.
- **Avisos e pendências:** fase de grupos, o que ficou sem conferir, as PARADAs e o que você fez em cada uma.
