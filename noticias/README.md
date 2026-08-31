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

## Colocar o placar de um jogador numa partida

Escreva um parágrafo sozinho com:

```
{{placar: <id da partida> | <nick do jogador>}}
```

Por exemplo:

```
{{placar: 304e0da1-3603-4a89-9fd4-5e6c593b5415 | kssarato}}
```

O id da partida está na URL dela. O bloco é montado a partir do banco: rAAting,
ACS, kills, mortes, assistências, KAST, ADR, Swing/R, multi-kills, FK e FD.

**Digitar a tabela na mão funcionaria hoje e envelheceria amanhã.** Se a
partida for reprocessada, os números do texto passariam a mentir; assim eles
seguem o banco para sempre. Se o id ou o nick não existirem, o bloco
simplesmente não aparece - o token nunca vaza como texto para o leitor.

## 3. Publicar

```bash
node scripts/build_news.js
```

Isso gera `news.json` e extrai as imagens do `.docx` para
`assets/noticias/<slug>/`. Depois:

```bash
git add noticias assets/noticias news.json
git commit -m "noticia: griffins vence a classificatoria 3"
git push
```

O Render redeploya sozinho em um ou dois minutos.

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
