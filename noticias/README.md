# Como publicar uma notícia

Escreva no Word, salve aqui, rode um comando, commite. Não existe painel nem
login de jornalista - o repositório é a redação.

## 1. O nome do arquivo

```
noticias/2026-08-30-griffins-vence-a-classificatoria-3.docx
```

- **A data na frente** (`AAAA-MM-DD`) é a data da matéria. Se você esquecer, o
  build usa a data de modificação do arquivo - funciona, mas é frágil: copiar
  o arquivo de uma pasta para outra muda essa data. Prefira o prefixo.
- **O resto vira o endereço** da matéria: `univlr.onrender.com/#/news/griffins-vence-a-classificatoria-3`.
  Use só letras minúsculas, números e hífen. Sem acento, sem espaço.

## 2. O conteúdo do documento

O build tira os metadados do próprio texto, porque Word não tem campo de
metadado. As regras:

| O que | De onde sai |
|---|---|
| Título | O primeiro parágrafo com estilo **Título 1** |
| Resumo | O primeiro parágrafo de texto |
| Capa | Um arquivo de imagem com o **mesmo nome** do `.docx`, ao lado dele |

### A capa fica FORA do Word

Salve a capa como um arquivo separado, com o mesmo nome do documento:

```
noticias/2026-08-30-boas-vindas-ao-univlr.docx
noticias/2026-08-30-boas-vindas-ao-univlr.webp   <- a capa
```

Serve `.webp`, `.jpg`, `.png` ou `.gif`, e o build copia para
`assets/noticias/<slug>/`. Se não houver arquivo ao lado, a primeira imagem de
dentro do documento vira a capa.

Ela fica fora do Word porque é a maior imagem da matéria e a que mais pesa: colada
lá dentro, entra no tamanho e no formato que o Word guardou. A capa desta primeira
matéria tinha **1,1 MB em PNG** e virou **50 KB em WebP** — o mesmo quadro, 23
vezes menor. Como arquivo separado, dá para comprimir antes.

Título e capa **saem do corpo** depois de virarem metadado - senão apareceriam
duas vezes na página. O resumo continua no texto: ele é a abertura da matéria, e
só aparece sozinho nos cartões da listagem e da home.

**Use os estilos do Word, não formatação manual.** "Título 1" e "Título 2" no
menu de estilos viram `<h1>` e `<h2>`; texto que você só deixou grande e negrito
vira parágrafo comum. O que funciona:

- Título 1 → o título da matéria
- Título 2 e 3 → subtítulos dentro do texto
- **Negrito**, *itálico*
- Listas com marcador e numeradas
- Links (Ctrl+K)
- Imagens coladas no meio do texto
- Tabelas
- Citação (parágrafo com estilo Citação)

## Mencionar uma equipe, jogador ou partida

**Isto é procedimento padrão em todo texto oficial do UNIVLR.** Nome de equipe,
de jogador ou de partida que aparece no texto vai linkado - sem exceção. Um nome
solto é um beco sem saída para quem está lendo e quer saber quem é aquele time.

Marque a menção como **link normal do Word** (Ctrl+K) apontando para o endereço
da página no próprio site. O jeito mais fácil é abrir a página, copiar a URL da
barra de endereços e colar.

```
CEUB Octopus   ->  https://univlr.onrender.com/#/teams/ceub_octopus
kssarato       ->  https://univlr.onrender.com/#/players/kssarato
uma partida    ->  https://univlr.onrender.com/#/matches/304e0da1-...
```

Na página publicada, o link vira uma menção com o símbolo colado no nome:

- **Equipe** ganha o escudo, em vermelho.
- **Jogador** ganha o escudo da **equipe dele**, não a foto — só 9,6% dos
  jogadores têm foto, então a silhueta apareceria na maioria das menções.
- **Partida e campeonato** ganham o logo do campeonato, em azul.

O escudo é buscado no banco na hora de desenhar, não gravado no `news.json`.
Se uma equipe trocar de logo, as matérias antigas acompanham.

## Blocos de dados dentro do texto

Um parágrafo **sozinho**, sem mais nada na linha, com `{{nome: argumento | argumento}}`
vira um bloco montado a partir do banco na hora de desenhar a página.

A regra é sempre a mesma: **digitar a tabela na mão funciona hoje e envelhece
amanhã.** Se a partida for reprocessada ou o ranking rodar de novo, o número
escrito no Word passa a mentir; assim ele acompanha o banco para sempre. Se o id
não existir, o bloco simplesmente não aparece - o token nunca vaza como texto
para o leitor.

| Token | O que vira |
|---|---|
| `{{ficha: <equipe> \| <grupo> \| <adversário>}}` | Cartão da equipe: escudo, posição e nota no ranking, grupo e o adversário de estreia |
| `{{mappool: <equipe>}}` | Tabela de mapas: recorde, saldo de rounds e aproveitamento, com o ícone de cada mapa |
| `{{elenco: <equipe> \| <campeonato>}}` | Os jogadores que a equipe usou naquele campeonato, com rAAting, mapas e ACS **daquele campeonato** |
| `{{previsao: <a> \| <b> \| <c>}}` | Três probabilidades com barra - playoffs, grande final, título |
| `{{formula: <expressão>}}` | Fórmula matemática. Aceita `\frac{a}{b}`, `x^2`, `x^{...}`, `R_A`, `R_{...}` |
| `{{placar: <partida> \| <nick>}}` | O boletim de um jogador numa partida (rAAting, ACS, kills, KAST, ADR...) |

Exemplos, como aparecem no Word:

```
{{ficha: ceub_octopus | A | fametro_berserkers}}
{{mappool: ceub_octopus}}
{{elenco: ceub_octopus | jubs-fase-inicial}}
{{previsao: 82,7 | 54,6 | 31,0}}
{{formula: P(A)=\frac{1}{1+e^{-0,0445(R_A-R_B)}}}}
{{placar: 304e0da1-3603-4a89-9fd4-5e6c593b5415 | kssarato}}
```

O id da equipe e o do campeonato são os mesmos que aparecem na URL das páginas
delas (`#/teams/ceub_octopus`, `#/tournaments/jubs-fase-inicial`).

**Quem entra no `elenco`:** todo mundo que jogou pelo menos 40% dos mapas da
equipe naquele campeonato. Um corte fixo de cinco esconderia rodízio de verdade;
mostrar todos traria o reserva de meio mapa como se fosse titular.

## A capa e os dois recortes

A mesma imagem serve dois lugares com proporções diferentes: **21:9** na página
da matéria e **16:10** no herói da home. O recorte da home descarta 31% da
largura, e o título entra por cima do terço de baixo.

Então o assunto da capa precisa caber nos **68% centrais** da largura e acima
de **62%** da altura. Fora disso, some na home.

## 3. Publicar

```bash
node scripts/build_news.js
```

Isso gera:

- `news.json`, que é o que o site lê;
- as imagens do `.docx`, em `assets/noticias/<slug>/`;
- a imagem de preview de link, em `assets/noticias/<slug>/capa-share.jpg`;
- a página de preview de link, em `news/<slug>/index.html`.

Depois:

```bash
git add noticias assets/noticias assets/share news news.json
git commit -m "noticia: griffins vence a classificatoria 3"
git push
```

O Render redeploya sozinho em um ou dois minutos.

## O link que você cola no WhatsApp

Para o card com capa aparecer, o link tem que ser o **sem `#`**:

```
https://univlr.onrender.com/news/griffins-vence-a-classificatoria-3
```

O endereço com `#` continua funcionando e é o mesmo lugar - mas ele nunca vai
mostrar card, e isso não tem conserto. Tudo depois do `#` fica no navegador e
não chega ao servidor: o robô do WhatsApp pede a raiz do site e recebe o
`index.html`, seja qual for a matéria. E ele não roda JavaScript, então nada que
o site monte depois existe para ele.

Por isso o build escreve uma página de verdade por matéria, em `news/<slug>/`.
Ela carrega o título, o resumo e a capa nas tags `og:` e devolve a pessoa para o
site na hora - quem é gente nem vê essa página.

A imagem do card é um **JPEG** de 1200x630 gerado à parte, e não a capa em WebP:
os robôs do WhatsApp e do Facebook não renderizam WebP de forma confiável, e
`og:image` que eles não decodificam vira card sem imagem. Quem gera é
`scripts/build_share_images.py`, chamado pelo build. Sem Python ou sem Pillow na
máquina o build avisa e segue - o card sai com a capa em WebP.

Um endereço sem matéria (a home, um jogador, uma partida) mostra o card genérico
do site, que está em `index.html`.

## Detalhes que economizam dor de cabeça

- **Rode o build antes de commitar.** O site lê `news.json`, não os `.docx` - se
  você commitar só o Word, nada aparece.
- O build ignora `~$arquivo.docx`, aquele arquivo temporário que o Word cria
  enquanto o documento está aberto. Ainda assim, feche o Word antes de rodar.
- Apagar a matéria é apagar o `.docx` e rodar o build de novo. Os comentários
  dela continuam no banco, órfãos e invisíveis - se for uma remoção definitiva,
  apague a thread também:
  `delete from public.threads where subject_kind='article' and subject_id='<slug>';`
- Não há rascunho nem agendamento: o arquivo existir no repositório *é* a
  publicação.
- O HTML gerado entra na página sem sanitização, porque só quem tem acesso ao
  repositório escreve aqui. Se um dia outra pessoa passar a escrever, isso
  precisa mudar.
