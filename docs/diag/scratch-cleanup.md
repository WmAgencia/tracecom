# Limpeza segura dos scratch (26 itens nao rastreados) — 2026-09-19 UTC

Escopo: inventario e limpeza **sem tocar runtime, estrategia, playbooks, thresholds ou execucao**.
Nada de producao foi alterado; nenhum arquivo versionado foi removido.

Comando de inventario: `git status --short` (26 arquivos nao rastreados, lista conferida item a item).

Classificacao usada:

- **TEMP_DIAGNOSTIC** — dump/estado ad-hoc de probe (nao reproduzivel como dado de pesquisa).
- **REPRODUCIBLE_OUTPUT** — saida regeneravel por script do repo.
- **POTENTIALLY_USEFUL** — ferramenta ad-hoc ainda funcional; **nao apagada**.
- **SHOULD_BE_VERSIONED** — arquivo de configuracao pequeno que deveria estar no git.

## Inventario e acao

| Arquivo | Classe | Acao |
|---|---|---|
| `diag-fase5.mjs` | POTENTIALLY_USEFUL | **mantido** (untracked, documentado aqui); diag read-only da cadeia de auditoria, sem segredos; sobreposto por `scripts/diag-g2-audit.mjs` |
| `serve-dist.cjs` | POTENTIALLY_USEFUL | **mantido** (untracked, documentado aqui); preview local de `dist/` em `127.0.0.1:8099` |
| `execs.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\root\` |
| `office.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\root\` |
| `sig.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\root\` |
| `st.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\root\` |
| `fase7-catalog-table.json` | REPRODUCIBLE_OUTPUT | movido para `%TEMP%\tracecom-scratch\root\` |
| `fase7b-audit.json` | REPRODUCIBLE_OUTPUT | movido para `%TEMP%\tracecom-scratch\root\` (regeneravel via `scripts/fase7b-audit.mjs`) |
| `iq-catalog.json` | REPRODUCIBLE_OUTPUT | movido para `%TEMP%\tracecom-scratch\root\` (regeneravel via `scripts/iq-catalog.mjs`) |
| `stress-55-report.json` | REPRODUCIBLE_OUTPUT | movido para `%TEMP%\tracecom-scratch\root\` (regeneravel via `npm run stress:55`) |
| `wr-study-summary.json` | REPRODUCIBLE_OUTPUT | movido para `%TEMP%\tracecom-scratch\root\` (regeneravel via `scripts/wr-recovery-study.mjs`) |
| `relay/.gitignore` | SHOULD_BE_VERSIONED | **versionado** (`git add`); conteudo: ignora `relay/.vercel` |
| `relay/am.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/ev.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/office.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/sig.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/st.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/status.json` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/be.txt` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` (stderr do Railway CLI) |
| `relay/bl.txt` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` (build logs do Railway CLI) |
| `relay/re.txt` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` (stderr do Railway CLI) |
| `relay/rl.txt` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` (runtime logs do Railway CLI) |
| `relay/relay-build-err.txt` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/relay-build-logs.txt` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/relay-logs.err.txt` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |
| `relay/relay-logs.txt` | TEMP_DIAGNOSTIC | movido para `%TEMP%\tracecom-scratch\relay\` |

Resumo: **23 movidos para fora do repo**, **1 versionado** (`relay/.gitignore`), **2 mantidos** como
ferramentas ad-hoc (documentados, sem segredos, sem impacto em runtime/estrategia).

## `.gitignore` (padroes especificos, sem wildcard amplo)

Adicionados apenas caminhos exatos (nunca `*.json`/`*.txt`) para impedir que os dumps voltem a
poluir `git status`:

```
/execs.json
/office.json
/sig.json
/st.json
/fase7-catalog-table.json
/fase7b-audit.json
/iq-catalog.json
/stress-55-report.json
/wr-study-summary.json
/relay/am.json
/relay/be.txt
/relay/bl.txt
/relay/ev.json
/relay/office.json
/relay/re.txt
/relay/rl.txt
/relay/sig.json
/relay/st.json
/relay/status.json
/relay/relay-build-err.txt
/relay/relay-build-logs.txt
/relay/relay-logs.err.txt
/relay/relay-logs.txt
```

## Estado final

- `git status` nao tem mais nenhum item de runtime/estrategia;
- os unicos itens nao rastreados remanescentes sao `diag-fase5.mjs` e `serve-dist.cjs`
  (POTENTIALLY_USEFUL, ambos documentados acima) e os novos artefatos desta rodada
  (freeze/testes/qualidade), que sao versionados no commit;
- nenhum arquivo POTENTIALLY_USEFUL/SHOULD_BE_VERSIONED foi apagado;
- nenhuma alteracao em `relay/` de runtime/estrategia; `relay/.gitignore` e apenas configuracao de git.
