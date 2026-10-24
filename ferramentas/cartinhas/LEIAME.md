# Gerador de cartinhas

Gera a cartinha de cada jogador (PNG 750 × 1200 com fundo transparente) e um
post por time (JPG 1080 × 1350).

## Visual

Moldura angular (chanfros e um pico baixo no topo, ponta embaixo), fundo em
degradê nas cores do time com facetas, feixes de luz, retícula e granulação.
Overall no canto, com o escudo do time (sem fundo) e o agente mais jogado
(+PICK) embaixo; foto centralizada, com o nome grande na frente: o fim do
recorte some numa faixa atrás do nome e das estatísticas. Ícone da função e
"X PARTIDAS" na ponta da carta. Sem brilho nos textos. Fonte: Oswald (em
`fontes/`, licença OFL).

A foto é sempre a original (nada é gerado): cada uma tem o tamanho e a posição
ajustados para a cabeça ficar na mesma altura em todas as cartas, e o que
chegaria perto do overall, do escudo ou do agente vai se dissolvendo, só ali
(ver "Enquadramento das fotos").

A cor principal do time escolhe o tema da carta:

| Tema | Quando | Exemplo |
|---|---|---|
| Escuro | o resto (degradê da cor até quase preto, texto claro) | CEUB, UFG, CAAP |
| Claro (perolado) | cor principal quase branca ou bem clara | UFU, Mauá, Acucarados |
| Dourado | cor principal dourada ou amarela | USP Stars, Furia, Sheriff |
| Prata | cor principal cinza médio | Tigre Branco, UEPA, UEG |

A segunda cor vira o acento (feixes e luz atrás da foto). Escudo que some
contra o fundo (logo branco em carta perolada, por exemplo) ganha um contorno
fino.

## Abrir

Dois cliques em `abrir-gerador.bat`. Ele sobe o `local-static-server.cjs` na
porta 8000 (o mesmo servidor da prévia local) e abre
<http://localhost:8000/ferramentas/cartinhas/>.

Abrir o `index.html` direto (file://) não funciona: o navegador bloqueia as
imagens.

## Conjuntos de dados

O seletor "Dados" lista o que está em `dados/indice.json`:

- **Hub Uni · todos os campeonatos (overall ajustado, ao vivo)**: monta as
  cartas direto do `database.json` do site, com os números que o Hub Uni já
  calcula para cada jogador somando todos os jogos de todos os campeonatos (os
  mesmos da página do jogador). Entra quem tem no mínimo 200 rounds e 12
  partidas (mapas jogados). Depois de
  rodar `node scripts/build_database.js`, basta recarregar o gerador: a força
  dos adversários e o overall são recalculados na hora (`ajuste-overall.js`).
  - Overall = arredonda(65,399 + 18,182 × rAAting final), a mesma régua das
    cartas da Fase de Grupos.
  - rAAting final = média + rounds/(rounds + 40) × (rAAting 3.0 + nível dos
    adversários − média). Nível dos adversários = força média dos times
    enfrentados, pesada pelos rounds (+ = adversários mais fortes). Explicação
    e validação na planilha `outputs/cartinhas/Temporada 2026 - Todos os
    campeonatos/Overall ajustado - Temporada 2026.xlsx`.
  - Os parâmetros ficam em `ajuste` na entrada `hub-temporada-2026` do
    `indice.json` (`k`, `intensidade`, `media`; `"ativo": false` volta ao
    overall direto do rAAting).
  - Função = classe com mais mapas jogados (empate = Flex); +PICK = agente com
    mais mapas.
  - Time = time atual no site (sem time atual: o último time pelo qual jogou).
  - Nome = o do site, exceto quem está em `dados/nomes.json` (puuid → nome).
  - Mínimos de rounds e partidas, base e inclinação do overall ficam na entrada
    `hub-temporada-2026` do `indice.json`.
- **Univavá 2026 · Fase de Grupos**: o arquivo fixo da fase de grupos.

## De onde vem cada elemento

| Elemento | Origem |
|---|---|
| Overall, nick, função e estatísticas | `database.json` (conjunto ao vivo), arquivo em `dados/` ou tabela colada do Excel |
| Escudo e cores do time | `metadata.json` (`teams[].logo` e `teams[].colors`); dá para trocar em `times` no arquivo de dados |
| Foto | campo `foto` do jogador; vazio = `metadata.json` pelo puuid (ou pelo nick) |
| Silhueta (jogador sem foto) | `assets/user-silhouette.png`, a mesma do site, na cor da carta |
| "X PARTIDAS" | campo `mapas` (no site, partidas = mapas jogados); sem o campo, não aparece |
| Agente (+PICK) | campo `agente`; ícone de `assets/agent-icons` |
| Ícone da função | `assets/roles`; Flex usa um ícone próprio (setas circulares) |
| Nome do time na lateral (opcional, desligado) | `times[id].nomeFundo`, ou o nome do time |

Jogador sem foto ganha a silhueta do Hub Uni no lugar e aparece com o selo
"sem foto" na grade.

## Enquadramento das fotos

Cada foto do site tem um enquadramento diferente (de corpo inteiro até só
rosto e peito, braços abertos, apontando...). Para as cartas ficarem parecidas:

- A cabeça fica na mesma altura e com tamanho parecido em todas as cartas, e o
  corpo sempre chega até atrás do nome (nunca termina antes, "flutuando").
- O que chegaria perto do overall, do escudo ou do +PICK (ombro, braço aberto)
  vai se dissolvendo, só na altura dessa coluna: a foto some aos poucos ao
  longo de um degradê largo (`corte.suave` em `PADRAO.foto`, 72 unidades), sem
  borda marcada. A cabeça é sempre protegida, e o resto da foto e o lado
  direito ficam intactos. Nada é gerado: é sempre a foto original, só com
  tamanho, posição e esse degradê.
- `dados/enquadramento-fotos.json` guarda o enquadramento revisado de cada foto
  (zoom e deslocamento x/y, em unidades da carta de 500 × 800). As fotos da
  temporada 2026 estão todas lá; greinzera, Kaytoh e Gutoso são as
  referências. Opções por foto: `"cortar": false` desliga o degradê lateral, e
  `"proteger": [[x0, y0, x1, y1]]` marca áreas da foto (frações da imagem) que
  ele não apaga, como a mão do Medina.
- Foto que não está na tabela (jogador novo, foto trocada no site) recebe o
  enquadramento automático, que segue as mesmas regras. Cada entrada da tabela
  tem a "assinatura" da foto: se a foto mudar, a entrada é ignorada e vale o
  automático.
- A silhueta (jogador sem foto) não se dissolve: ela encolhe até ficar longe
  do escudo e do +PICK.
- Na janela da carta, Zoom/Horizontal/Vertical ajustam por cima desse
  enquadramento. A linha abaixo deles mostra o enquadramento final (zoom, x e
  y), e fica vermelha se a cabeça encostar no escudo ou no +PICK. Para fixar um ajuste
  em qualquer navegador, copie zoom, x e y dessa linha para a entrada da foto
  na tabela.

## Nova fase ou novo campeonato

- **Rápido:** no seletor "Dados", escolha "Colar tabela do Excel…" e cole a
  tabela resumida com o cabeçalho (Nome, Time, Overall, Função, ACS, Kast,
  KPR, MPR, APR, Swing; opcionais: Agente ou "Agentes (mapas)", Mapas, ADR,
  puuid, Foto). Time, escudo, cores e foto são achados pelo `metadata.json`.
- **Para guardar:** "Baixar dados (.json)", salve o arquivo em `dados/` e
  acrescente uma linha em `dados/indice.json`.

## Ajustar uma carta

Clique na carta: nick, overall, função, agente, estatísticas, zoom e posição
da foto (por cima do enquadramento da foto), e "Trocar foto…" (ou arraste a
imagem para a prévia). Os ajustes
ficam guardados neste navegador; "Baixar dados (.json)" leva tudo para o
arquivo. PageUp e PageDown passam para a carta anterior ou a próxima.

Foto definitiva: ponha o recorte em `assets/player-photos/<time>/` e rode
`python scripts/build_metadata.py` (o gerador lê o `metadata.json`), ou
preencha `foto` no arquivo de dados. As fotos do site têm 320 px; uma foto
maior deixa a carta mais nítida.

## Exportar

- **Baixar cartas (.zip):** as cartas que estão na tela (respeita busca e
  filtro), uma pasta por time.
- **Posts por time (.zip):** um post por time, cartas da maior nota para a menor.
- **Baixar PNG** (dentro do editor): só a carta aberta.
- Opcional, sem abrir o navegador:
  `node ferramentas/cartinhas/exportar.mjs --dados hub-temporada-2026 --posts`
  grava em `outputs/cartinhas/` (precisa do pacote `playwright`; os ajustes
  feitos na interface só entram se estiverem no arquivo de dados). `--dados`
  aceita o id de um conjunto do índice ou o nome de um arquivo em `dados/`;
  `--so-com-foto` gera só as cartas de quem tem foto e `--time <id>` só as de
  um time.

## Arquivo de dados

```json
{
  "evento": { "nome": "Univavá 2026", "fase": "Fase de Grupos", "icone": "assets/tournament-icons/UNIVAVA.png" },
  "estatisticas": ["acs", "kast", "kpr", "mpr", "apr", "swing"],
  "times": { "ufu_saints": { "nome": "UFU Saints", "cores": ["#fefefe", "#d7ad00"], "logo": "assets/team-logos/ufu_saints.png" } },
  "jogadores": [
    { "nick": "Fijora", "time": "ufu_saints", "overall": 84, "funcao": "Duelista",
      "acs": 195, "kast": 0.72, "kpr": 0.70, "mpr": 0.68, "apr": 0.22, "swing": 0.2,
      "agente": "Neon", "puuid": "…", "foto": "assets/player-photos/ufu_saints/fijora_new.png" }
  ]
}
```

- As 3 primeiras estatísticas vão para a coluna da esquerda e as 3 últimas
  para a da direita. Disponíveis: `acs`, `kast`, `kpr`, `mpr`, `apr`, `swing`,
  `adr`, `kd`, `hs`, `fkfd`, `rating`. Rótulo próprio:
  `{ "campo": "adr", "rotulo": "DPR" }` (o ADR de 2026 não conta overkill, então
  não compara com o DPR de 2024/2025).
- `kast` aceita fração (0.72) ou porcentagem (72).
- Cores: a carta monta a paleta sozinha a partir das duas cores do time. Para
  forçar, use `times[id].paleta` com `topo`, `meio`, `fundo` (degradê),
  `acento` (feixes) e, se quiser, `texto` e `rotulo`.
