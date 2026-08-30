# Backend do UNIVLR (Supabase)

Ciclo 1: contas, perfil público e comentários em partidas e eventos.
Notícias é ciclo 2 - o schema já tem o encaixe (`subject_kind = 'article'`),
mas nenhuma tela.

## Modelo de segurança, em uma frase

Não existe servidor nosso. O navegador fala direto com o Postgres, usando uma
chave que está visível para qualquer visitante. Então **toda regra de negócio
mora no banco**: leitura por RLS, escrita por RPC `security definer`.

Consequência prática: esconder um botão não protege nada. Se `0002_policies.sql`
tiver uma linha frouxa, a porta está aberta - por isso `tests/rls_test.sql`
existe e precisa passar antes de qualquer tela.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `migrations/0001_community.sql` | Tabelas, índices, triggers |
| `migrations/0002_policies.sql` | RLS e grants por coluna |
| `migrations/0003_functions.sql` | RPCs de escrita (o caminho único) |
| `migrations/0004_favorito_unico_e_perfis.sql` | Favorito único e comentário em perfil |
| `tests/rls_test.sql` | 16 ataques que precisam falhar |
| `tests/positive_test.sql` | 19 operações legítimas que precisam passar |

## Setup (o que precisa ser feito no painel)

1. **Criar o projeto** em supabase.com. Região `South America (São Paulo)` -
   é a mais perto do público e corta uns 150 ms de latência por requisição.
   Guardar a senha do banco no gerenciador de senhas.

2. **Rodar as migrações**, em ordem, no SQL Editor: `0001`, `0002`, `0003`.
   Se alguma reclamar, parar e trazer o erro - não seguir para a seguinte.

3. **Rodar os dois testes** (`tests/rls_test.sql` e `tests/positive_test.sql`).
   Cada um devolve uma tabela e **toda linha precisa estar `ok`**. Os dois
   fazem `rollback` no fim e não deixam rastro.

   Rodar os dois não é zelo excessivo: `rls_test` prova que o ataque falha,
   `positive_test` prova que o uso legítimo passa. Sozinho, o primeiro daria
   verde num banco com permissão quebrada por inteiro - tudo bloqueado é tudo
   "seguro". É o par que diz que a permissão está certa, não só fechada.

4. **Authentication → Providers:** deixar só `Email` ligado. Desligar
   "Confirm email" (decisão consciente: comenta sem verificar, e o rate limit
   do `0003` é quem segura spam).

5. **Authentication → URL Configuration.** O site é servido como Static Site
   no Render, em `https://univlr.onrender.com`. Preencher assim:

   - **Site URL:** `https://univlr.onrender.com`
   - **Redirect URLs:** `https://univlr.onrender.com/**` e
     `http://localhost:8000/**` (a porta do `local-static-server.cjs`; se ela
     estiver ocupada o servidor escolhe outra, e aí some a porta usada).

   O `/**` importa: o retorno vai para `origin + pathname`, que pode ser `/`
   ou `/index.html`. Sem o curinga, um dos dois é recusado.

6. **SMTP - só afeta "esqueci a senha".** Nada mais no site manda e-mail:
   a verificação de cadastro está desligada por decisão de projeto.

   **Ligar "Enable custom SMTP" sem preencher os campos é pior que deixar
   desligado**: o SMTP customizado substitui o embutido, e com host inválido
   nenhum e-mail sai. Os valores que aparecem no formulário
   (`noreply@yourdomain.com`, `your.smtp.host.com`, `SMTP Username`) são
   placeholders do Supabase, não configuração.

   Provedor exige domínio verificado para enviar, e `univlr.onrender.com` é
   subdomínio do Render - não dá para provar o DNS dele. As saídas reais:

   | Opção | O que dá |
   |---|---|
   | **Gmail com App Password** | `smtp.gmail.com`, porta `465`, usuário = o Gmail, senha = App Password (exige 2FA na conta Google). ~500/dia. Sem domínio, sem custo. |
   | **Domínio próprio + Resend** | `smtp.resend.com`, porta `465`, usuário `resend`, senha = a API key. Precisa comprar domínio. |
   | **Deixar desligado** | Reset por interface não funciona; troca-se a senha por SQL (ver abaixo). |

7. **Anotar as duas chaves** de Settings → API:
   - `Project URL` e `anon public` → vão para o front, são públicas por design.
   - `service_role` → **nunca** entra no repositório nem no navegador. Ela
     ignora toda a RLS; vazá-la entrega o banco inteiro.

8. **Virar admin:** depois de criar sua conta pelo site, rodar
   `update public.profiles set role = 'admin' where username = 'seu_nome';`

## Estado

Migrações aplicadas e os dois testes passando no projeto `univlr`
(`sa-east-1`), em 30/08/2026: 16 ataques bloqueados, 16 operações legítimas
funcionando.

Cada bloqueio foi conferido pelo motivo, não só pelo fato de falhar:
`42501` de grant ou RLS, `23505` da chave primária, `P0001` das validações das
RPCs. Um teste que passa porque o SQL tem erro de digitação não vale nada.

### Conectar pelo terminal

A conexão direta (`db.<ref>.supabase.co`) é **IPv6-only** - numa rede sem IPv6
o `psql` falha com "could not translate host name". O caminho IPv4 é o pooler,
em modo sessão:

```
psql -h aws-0-sa-east-1.pooler.supabase.com -p 5432 -U postgres.ruqomwmdmhwivooqdlcf -d postgres
```

Modo sessão (5432), não transação (6543): os testes usam tabela temporária e
`set local role`, que o modo transação não preserva.

## Trocar a senha de alguém por SQL

Enquanto o SMTP não estiver de pé, é assim que se resolve um "esqueci a senha":

```sql
update auth.users
   set encrypted_password = extensions.crypt('SenhaProvisoria123', extensions.gen_salt('bf'))
 where email = 'pessoa@exemplo.com';
```

Combine a senha provisória por fora e peça para a pessoa trocar depois.

## Favorito é UM de cada, como na HLTV

Cada pessoa tem no máximo **um time** e **um jogador** favoritos. Escolher outro
troca o atual; clicar no que já é favorito desmarca.

Por isso não existe tabela `favorites`: são duas colunas em `profiles`
(`fav_team`, `fav_player`), adicionadas em `0004`. Com "no máximo um", a
unicidade fica estrutural em vez de virar regra que alguém precisa fiscalizar -
e o favorito passa a chegar **no mesmo embed do autor do comentário**, sem
segunda consulta por lista.

Os dois aparecem ao lado do nome em cada comentário, no formato da HLTV:

```
♥ jogador | [escudo do time] usuario
```

O escudo ocupa o lugar da bandeira de país que a HLTV usa - mesmo papel, o
vínculo declarado colado no nome.

## Onde se pode comentar

`threads.subject_kind` aceita `match`, `event`, `player`, `team` e `article`.
As quatro primeiras têm tela; `article` é o encaixe do ciclo 2 (notícias) e
ainda não tem nada.

## Moderar por SQL

Fila de denúncias abertas, da mais recente para a mais antiga:

```sql
select r.id, r.reason, r.created_at, p.username as autor, c.body
  from public.reports r
  join public.comments c on c.id = r.comment_id
  join public.profiles p on p.id = c.author_id
 where r.resolved_at is null
 order by r.created_at desc;
```

Apagar um comentário (zera o texto, mantém as respostas):

```sql
update public.comments set body = '', deleted_at = now() where id = 'UUID-AQUI';
```

Banir por 7 dias, e desbanir:

```sql
update public.profiles set banned_until = now() + interval '7 days' where username = 'NOME';
update public.profiles set banned_until = null where username = 'NOME';
```

Marcar a denúncia como resolvida:

```sql
update public.reports set resolved_at = now() where id = 'UUID-AQUI';
```

## Armadilhas descobertas (custaram tempo, ficam registradas)

**1. `comments` não embute `profiles` sem desambiguar.** Pedir
`profiles(username)` devolve *"more than one relationship was found"*. Existe só
uma FK direta (`comments.author_id`), mas `comment_votes` e `reports` têm chave
para `comments` **e** para `profiles`, então o PostgREST as lê como tabelas de
junção e enxerga três caminhos. A forma correta nomeia a constraint:

```
profiles!comments_author_id_fkey(username)
```

Vale para qualquer tabela que ganhe FK para as duas pontas no futuro.

**2. Inserir em `auth.users` na mão exige token vazio, não nulo.** Deixar
`confirmation_token`, `recovery_token`, `email_change` e companhia como `NULL`
faz o login falhar com *"Database error querying schema"* - o scanner do GoTrue
é Go e não aceita nulo em campo de texto. Preencher com `''`.

**3. `mailer_autoconfirm` precisa estar desligado no painel.** Enquanto
"Confirm email" estiver ligado, `signUp` não devolve sessão e o usuário fica
preso esperando um e-mail que, sem SMTP, não chega. Conferir em
`GET /auth/v1/settings`.

**4. O `/auth/v1/verify` responde NO FRAGMENTO, mesmo com PKCE.** Um link de
recuperação vencido volta como
`#error=access_denied&error_code=otp_expired&...` - no fragmento, não na query.
Como o UNIVLR roteia por hash, `route()` leria isso como nome de seção e cairia
na home calada, sem nunca dizer o motivo. O `community-core.js` resgata e limpa
o fragmento **na carga do script**, de forma síncrona: o `init()` é async e o
`app.js` chama `render()` antes de ele terminar.

**5. O Supabase recusa domínios de teste** (`.invalid`, `example.com`) com
*"Email address is invalid"*. Não afeta usuário real; afeta script de teste.

## Front-end

| Arquivo | Papel |
|---|---|
| `supabase-js.js` | SDK oficial 2.112.4, versionado (não CDN) |
| `community-core.js` | Única camada que fala com o Supabase |
| `auth.js` | Espaço da conta no cabeçalho + janelas |
| `comments.js` | Árvore de comentários |
| `profile.js` | Perfil público em `#/u/<username>` |
| `favorites.js` | Botão "ser fã" em equipe e jogador |

Carregam **antes** do `app.js`, como os outros `*-core`. Nenhum deles toca
`state` na carga: `state` é `const` no `app.js` e ler antes de ele executar
cairia na zona morta temporal.

## Pendente / não feito

**Bloqueia o lançamento:**
- Termos de uso e política de privacidade não existem. O site passa a guardar
  e-mail e a hospedar texto de terceiros - não é opcional.
- "Confirm email" ainda está **ligado** no painel (passo 4). Enquanto estiver,
  quem se cadastra não recebe sessão e fica esperando um e-mail que, sem SMTP,
  não chega. A tela já trata esse caso, mas o cadastro fica inútil.
- SMTP do Resend não configurado - "esqueci a senha" não funciona sem ele.

**Descopado por decisão do usuário (30/08/2026):**
- Painel de moderação. Modera-se por SQL. As consultas prontas estão em
  "Moderar por SQL", abaixo.

**Aceito como está:**
- Notificação some da lista assim que a janela abre (marca tudo como lida).
  Não há "marcar uma só".

**Decisões conscientes, registradas para não virarem surpresa:**
- Sem upload de foto: o avatar é a inicial sobre cor derivada do username.
- Sem voto negativo, só `+1`.
- Editar comentário só nos primeiros 15 minutos.
- Apagar zera o texto para sempre; não guardamos cópia.
