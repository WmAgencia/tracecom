# OFFICE V3 — PROMOÇÃO PARA A RAIZ (`/`)

Frontend/routing apenas. Nenhuma alteração em `relay/**`, WS, MCP, Brain G2,
Feature Engine, Critic, Consensus, Quality Gate, JIT, Entry Location, MicroVeto,
Portfolio/Execution Gate, stake ou regra de trading. **PRACTICE only, ZERO REAL.**

## O que mudou

| Arquivo | Mudança |
| --- | --- |
| `src/http/public/index.html` | Passou a ser o **shell do PIXEL OFFICE V3** (mesmo DOM/estilo de `office-v3.html`), com `<base href="/office-v3/">` e assets absolutos `/office-v3/styles-v3.css` + `/office-v3/office-v3.js`. A URL continua `/` — sem meta-refresh, sem redirect. |
| `src/http/public/classic.html` | **Dashboard legado movido para cá** (conteúdo intacto; todos os assets já eram absolutos, então funciona igual a partir de `/classic.html`). |
| `src/http/public/office-v3/office-v3.html` | **Intocado.** `/office-v3/office-v3.html` continua servindo a experiência V3 diretamente (`?base=procedural` incluso). |
| `src/http/public/office-v2.html` | **Intocado.** Rollback V2 permanece acessível. |
| `vercel.json` | Rewrites secundários `/dashboard` e `/classic` → `/classic.html`. Rewrites de API/health/extension inalterados. |
| `tests/ai/office-controls-contract.test.ts`, `tests/strategies/final-adjustments.test.ts`, `tests/vision/transport-contract.test.ts` | Apenas o caminho de leitura do dashboard legado: `src/http/public/index.html` → `src/http/public/classic.html` (mesmas asserções). |
| `tests/ai/office-v3-root-shell.test.ts` | Novo contrato de roteamento: raiz = V3 (sem marcadores legados), legado em `classic.html`, V3 direto intacto, rewrites declarados. |
| `docs/office-v3/promotion.md` | Este documento. |

O `GET /api/iq/office` continua sendo a **única** chamada de rede do V3; nenhum
endpoint, payload ou regra foi alterado.

## Mecanismo de roteamento

Hosting estático (Vercel `outputDirectory: dist`) + `postbuild.mjs`, que copia
`src/http/public/**` para `dist/` e `dist/http/public/`. Não existe router de
servidor para a raiz. A integração foi feita no **documento raiz**:

- `/` → `dist/index.html` = shell V3 (URL preservada, assets absolutos).
- `<base href="/office-v3/">` garante que o único caminho relativo remanescente
  do V3 (`BASE_ASSET = "./blueprint-reference.png"`, resolvido pelo `new Image()`)
  aponte para `/office-v3/blueprint-reference.png` mesmo servido na raiz.
- Legado: `/classic.html` (arquivo real) e atalhos `/dashboard` e `/classic` via
  `vercel.json` rewrites.

Funciona igualmente no preview local (`node serve-dist.cjs` → `dist/`) e no
servidor Node (`src/http/api.ts` serve `index.html` em `/`).

## Rollback (um passo)

Opção A — restaurar o documento legado na raiz e redeployar:

```powershell
Copy-Item src/http/public/classic.html src/http/public/index.html -Force
npm run build
npx --yes vercel@latest --prod --yes   # na raiz do repo, nunca em relay/
```

Opção B — reverter o commit da promoção (o arquivo legado continua versionado):

```powershell
git revert <sha-da-promocao>
npm run build
npx --yes vercel@latest --prod --yes
```

`/office-v2.html`, `/office-v3/office-v3.html` e `?base=procedural` permanecem
disponíveis durante e após o rollback.

## Smoke da raiz (produção `https://tracecom.consecom.com.br`)

| Rota | Status | Bytes |
| --- | --- | --- |
| `/` (+ `?base=procedural`) | 200 | 6.926 |
| `/office-v3/office-v3.html` (+ `?base=procedural`) | 200 | 6.370 |
| `/classic.html` | 200 | 32.302 |
| `/dashboard` e `/classic` (rewrites) | 200 | 32.302 |
| `/office-v2.html` | 200 | 5.107 |
| `/office-v3/office-v3.js` | 200 | 30.653 |
| `/office-v3/world.js` | 200 | 41.271 |
| `/office-v3/assets.js` | 200 | 63.200 |
| `/office-v3/life.js` | 200 | 41.632 |
| `/office-v3/camera.js` | 200 | 12.667 |
| `/office-v3/dashboard.js` | 200 | 19.544 |
| `/office-v3/market-detail.js` | 200 | 13.424 |
| `/office-v3/blueprint-base.js` | 200 | 4.361 |
| `/office-v3/overlay.js` | 200 | 17.137 |
| `/office-v3/base-mode.js` | 200 | 2.167 |
| `/office-v3/styles-v3.css` | 200 | 17.354 |
| `/office-v3/blueprint-reference.png` | 200 | 2.912.872 |
| `/api/iq/office` | 200 | 483.938 (JSON com `markets`) |

Asserções do corpo da raiz: contém `/office-v3/office-v3.js`, `id="office-canvas"`,
`PIXEL OFFICE V3` e `<base href="/office-v3/"`; **não** contém `page-operational`
nem `/app.js` (shell legado). `classic.html` contém `page-operational` e `/app.js`.

## Regressão

- `npx vitest run tests/ai` → **47 arquivos / 639 testes verdes** (inclui os testes V3 e o novo contrato de raiz).
- `npx vitest run tests/vision tests/strategies` → 20 arquivos / 117 testes verdes.
- `npx tsc -p tsconfig.json --noEmit` → limpo.
- `npm run build` → limpo (tsc + postbuild).
