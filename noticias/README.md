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
| Capa | A primeira imagem do documento |

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
