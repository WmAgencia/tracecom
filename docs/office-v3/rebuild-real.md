# OFFICE V3 — REBUILD REAL DO NÚCLEO

Reconstrução do núcleo do Office V3 em **código procedural**, removendo o
caminho híbrido (imagem do blueprint + overlay/inpaint/blur) do default.
Frontend/rendering apenas. **PRACTICE only, stake R$ 10, ZERO REAL, zero ordens.**

## 1. O que foi REJEITADO e removido do caminho padrão

- A solução híbrida (imagem congelada como base + overlay + inpaint) **não é
  mais o default**. O renderer padrão passa a ser o mundo procedural
  (`world.js`), desenhado 100% em código.
- `blueprint-base.js` / `blueprint-clean.png` / `blueprint-reference.png` e
  `overlay.js` continuam no repositório **apenas como debug** (`?base=reference`
  / `?base=original` / env `OFFICE_V3_BASE`). Nada disso é carregado/desenhado
  por padrão.
- Removido o valor `+R$ 578,76` hardcoded: era pintado na imagem de referência e
  também aparecia no fixture de render (`scripts/render-office-v3.mjs`). O
  fixture agora agrega o resultado real dos próprios mercados do cenário.
- Sem blur, sem overlay falso, sem painel estático, sem texto decorativo: o
  painel superior é desenhado em código com os dados reais do snapshot.

## 2. O que agora é CÓDIGO e REAL (backend)

Fonte única: `GET /api/iq/office` (poll a cada 2s, backoff até 30s).

| Área | Implementação | Dado real |
| --- | --- | --- |
| Painel superior "RESULTADO DO DIA" | `world.js::drawDailyBoard` + `dailyBoardModel` | `portfolio.settled` (pnl, wins, losses, draws, trades) → P&L, operações, W, L, WR, maior win/loss |
| Gráfico / equity | `drawDailyBoard` | `portfolio.equityCurve` real; sem série → "SEM SÉRIE DE RESULTADO" |
| Lucro semanal/mensal | `drawValueBox` | `portfolio.weekly/monthly.pnl`; ausente no relay → "SEM DADOS" (vazio explícito, nunca ilustrativo) |
| Abertos/fechados/total | `drawMarketsBox` + `dailyBoardModel` | `markets[].availability/enabled` |
| Mesas | `world.js::drawStation` | 1 mesa por mercado de `officeJson.markets[]`, `marketKey`/`display`/`activeId`/`payout` reais |
| Placa entalhada | `assets.js::desk_front` (`plaque`) | nome do ativo nítido, integrado à mesa, sem blur |
| Agentes | `life.js` + `state-model.js` | só trabalham quando `derived.agentsWorking` (broker OPEN + enabled + feed fresco); caso contrário vão para SOCIAL |
| Painel direito | `market-detail.js` | 100% correlacionado ao `marketKey` selecionado (identidade, feed, agentes, decisão, JIT, execução, journal, stake) |

### Fonte única de âncora/estado

- `state-model.js::deriveMarketState` continua sendo a **única** derivação de
  estado (mesa, popup MESAS, painel direito, agentes e badges).
- Novo `world.js::createAnchorResolver` é a **única** fonte de âncora no caminho
  procedural: hit test (`hitTestStation`/`hitTestAnchor`), foco/zoom
  (`deskFocus`→`zoomToDesk`), popup MESAS e painel direito resolvem a mesma mesa
  para o mesmo `marketKey`. Sem dessintonia mesa ↔ popup ↔ foco ↔ painel ↔ estado.

## 3. Ativos reais

- As mesas vêm exclusivamente de `officeJson.markets[]` (o runtime reconcilia o
  universo real via WS+MCP). Nenhum ativo é inventado para preencher mesa.
- Quando há mais células (55) que mercados (54), as restantes ficam como mesas
  **reservadas** (sem placa, sem agentes).

## 4. Testes

- `npx vitest run tests/ai` → **52 arquivos, 743 testes verdes**.
  - Novo `tests/ai/office-v3-procedural-core.test.ts`: default procedural (sem
    base), `createAnchorResolver` único por `marketKey`, hit test × foco
    concordam, painel superior só com dado real e vazio explícito.
  - `tests/ai/office-v3-blueprint-base.test.ts` ajustado: default agora é
    `procedural`; modos `reference`/`original` ficam como debug.
  - Removido `tests/ai/office-v3-clean-plate.test.ts` (híbrido, não é mais
    default; os 2 testes de CLI já falhavam por timeout antes desta rodada).
- `npx tsc -p tsconfig.json --noEmit` → **limpo**.

## 5. Browser real (Playwright + Chrome headless)

`node scripts/office-v3-browser-check.mjs` → **48/48 asserts PASS**
(engine `playwright+chrome 152`). Prova:

- (a) painel superior bate com o JSON real de `/api/iq/office`
  (P&L/wins/losses/draws/trades/WR e série de equity reais);
- (b) default é `procedural` e **não há** base híbrida/blur (`blueprintBase === null`);
- (c) clique em EUR/USD abre EUR/USD e o painel direito é daquele `marketKey`;
- (d) trocar de ativo troca mesa + painel + estado (EUR/JPY WORKING);
- (e) sem agentes fantasma (nenhum agente em desk não-WORKING) e sem badges
  fabricados.

Screenshots before/after em `docs/office-v3/screenshots/`:
`rebuild-before-hybrid.png` (debug `?base=reference`) e
`rebuild-after-procedural.png` (default). Render estático em
`implementation-v3.png`, `contact-sheet-v3.png`, `overview-v3.png`.

## 6. Build e deploy

- `npm run build` (tsc + postbuild).
- Deploy Vercel prod (`npx --yes vercel@latest --prod --yes`).
- Smoke `GET /` → 200 servindo o Office V3.

## 7. Commit

Commit e push em `origin main` com as mudanças de frontend/testes/docs desta
rodada (mensagem com escopo do rebuild).
