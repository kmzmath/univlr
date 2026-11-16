# Patch notes no Fórum - plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** seção "Patch notes" no Fórum, só admin publica, painel acima da tabela, e o texto de 16/11.

**Architecture:** regra no banco (migração 0011, RPC `security definer`), front lê `topic_list` filtrando `secao`; o Supabase falso dos testes acompanha a regra.

**Tech Stack:** Postgres/Supabase (SQL), PGlite para testar, JS sem build, testes em Node `vm`.

**Spec:** `docs/superpowers/specs/2026-11-16-patch-notes-no-forum-design.md`

## Global Constraints
- Nunca travessão; nenhum texto explicativo na interface.
- A 0011 tem de aceitar o site de hoje (chamada de dois argumentos e lista sem filtro).
- Toda escrita continua por RPC; nada de policy de INSERT/UPDATE.

## Review Focus
- Conta comum chamando `create_topic(..., 'patch')` direto na API: recusa no banco.
- Seção inventada (`'xyz'`) ou nula: recusa ou cai em `geral`, nunca grava lixo.
- Patch notes de 8.000 caracteres e thread geral de 2.001: o primeiro passa, o segundo não, também na edição.
- Chamada antiga `create_topic(p_title, p_body)` depois da 0011: continua criando thread geral.
- Lista do Fórum com só patch notes no banco: tabela vazia ("Nenhuma thread ainda.") e painel cheio.

---

### Task 1: migração 0011 e testes SQL
**Files:** `supabase/migrations/0011_patch_notes.sql`, `supabase/tests/rls_test.sql`, `supabase/tests/positive_test.sql`.
- [ ] Casos novos nos dois testes SQL (ver Review Focus); rodar no PGlite com 0001-0010 -> falham.
- [ ] Escrever a 0011.
- [ ] Rodar no PGlite com 0001-0011 -> todas as linhas `ok`, inclusive as antigas.

### Task 2: núcleo do front e Supabase falso
**Files:** `community-core.js`, `scripts/fake_supabase.js`, `scripts/test_threads_core.js`.
**Interfaces:** `listarTopicos({ pagina, porPagina, secao })` filtra por seção quando dada; `criarTopico(titulo, texto, secao = "geral")` manda `p_secao` só quando não é geral; `topico(id)` traz `secao`.
- [ ] Testes: patch notes de conta comum recusado; admin cria; listas separadas por seção.
- [ ] Implementar e rodar.

### Task 3: tela do Fórum
**Files:** `threads.js`, `styles.css` ou `placar.css` (bloco `th-*`), `scripts/test_visual_placar.js` se tocar o painel da home.
- [ ] Painel "Patch notes" (3 mais recentes, "Ver todos" acima de 3, "+ Patch notes" só admin), tabela só com `geral`, rota `#/forum/patch-notes`, formulário com `?secao=patch` e limite 8.000, rótulo "Patch notes" na thread.
- [ ] Conferir no navegador com o Supabase falso.

### Task 4: texto de 16/11
- [ ] `docs/patch-notes/2026-11-16.txt`, conferido contra os commits do dia e abaixo de 8.000 caracteres.
