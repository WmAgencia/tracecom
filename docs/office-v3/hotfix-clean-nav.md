# Office V3 — Hotfix: limpeza + navegação + correlação + teste PRACTICE

**Escopo:** frontend/UX apenas. Nenhuma mudança em Brain G2, Feature Engine, Critic,
Consensus, Quality Gate, JIT, Entry Location, MicroVeto, gates de Portfolio/Execution,
stake rules ou estratégia. Rollback preservado (`/classic.html`, `/office-v2.html`).
PRACTICE only, ZERO REAL.

## TASK 1 — Limpeza do escritório
- `world.js`: `buildAmenities()` agora retorna `[]` (removidos sofás, cozinha, sinuca,
  lounge, móveis decorativos, plantas, objetos sociais e todo item estético).
- Removidos os desenhos (não escondidos): `drawLeftPanels`, `drawBottomBranding`,
  `drawGlobalPanel`, `drawDisciplinePoster` e suas chamadas no `drawWorld`/camada de chão.
- Mantidos apenas: agentes, mesas (desk/placa/monitor/teclado/torre), painel superior
  (RESULTADO DO DIA + MERCADOS + LUCRO SEMANAL/MENSAL + logo) e chão/paredes/ribbons.
- `buildLighting()` reduzido aos pools técnicos das bandas.
- Testes que dependiam dos objetos sociais/amenities foram reescritos (não mascarados).

## TASK 2 — Agentes só com ativo WORKING
- `life.js`: `updateLife` agora coloca o par no desk quando o mercado está WORKING
  (derivado feed-aware via `setPresence`/`resolveOpen`) e **oculta** o par nos demais
  estados (`CLOSED/SUSPENDED/DISABLED/NOT_OFFERED/UNKNOWN/OPEN_BUT_FEED_OFFLINE`).
- Novo `hideAgent()` e `LOCATION_HIDDEN`; removidas as áreas sociais, spots, loiter e o
  comportamento idle. Registry `marketKey → { traderAgentId, criticAgentId }` mantido.
- `drawAgents` nunca renderiza agente oculto; invariante de render exatamente 1× por
  agentId preservada (strict/test).

## TASK 3 — Escritório centralizado
- `world.js` expõe `contentBounds`/`minX..maxY` = área real do escritório (512..2048 × 0..1024).
- `camera.refreshWorldBounds` usa esses bounds; `camera.fitContent` enquadra o escritório
  com folga de 48px nos 4 lados e zoom ≤ 1; o clamp usa world bounds × zoom × viewport e
  alcança todas as bordas. `office-v3.js` aplica o fit uma única vez (não é re-fit).

## TASK 4 — Navegação do mouse
- **wheel normal = scroll/pan** vertical (Shift = horizontal) — nunca zoom.
- **Ctrl/Meta + wheel = zoom** suave centrado no cursor (`handleWheel`/`zoomAt`).
- **Space + botão esquerdo = pan** (pointer capture, blur/pointercancel, cursor grab/grabbing,
  sem seleção de texto, clique acidental suprimido) — mantido e revalidado.
- HUD atualizado no shell raiz e na página direta.

## TASK 5 — Gráfico
- Gráfico de equity do painel superior refeito: moldura, grid, linha real, marcador do
  último ponto, rótulo "EQUITY · SÉRIE REAL" e último valor real. Sem clipping; eixo
  com padding; baseline zero apenas quando a série real cruza zero. Nenhum dado inventado.

## TASK 6 — Tipografia/encaixe
- Varredura do painel superior e das mesas: labels e placas entalhadas sem corte; o
  painel do dia foi reposicionado para não sobrepor métricas e gráfico.

## TASK 7 — Correlação (fonte única)
- Mesa/popup/painel/zoom continuam resolvidos por `createAnchorResolver` + `state-model`.
- Validação ao vivo contra `GET /api/iq/office` (produção): 37 mercados WORKING, 37/37
  com âncora única, hit-test concordando e `agentsWorking=true`; zero problemas.

## TASK 8 — Teste funcional final (PRACTICE)
### 8.1 Browser real (Playwright + Chrome 152)
- `scripts/office-v3-browser-check.mjs`: **52/52 asserts PASS** — boot, centro com folga,
  wheel=scroll, Shift+wheel, Ctrl+wheel no cursor, Space+drag, clamp nas 4 bordas,
  clique na mesa, painel correlacionado, MESAS ↑↓+Enter, troca de ativo, feed offline.
- Screenshots em `docs/office-v3/screenshots/` (inclui `browser-s2-scroll-vertical.png`).
- Relatório: `docs/office-v3/browser-check.report.json`.

### 8.2 Teste operacional controlado (PRACTICE)
- `scripts/office-v3-practice-check.mjs` — usa **somente** mecanismos existentes.
- Fase 1 (read-only): 37/37 WORKING correlacionados; contagens `working=37, disabled=17`.
- Fase 2 (`--execute`): `POST /api/iq/arm` → ARMED; `POST /api/iq/test-order` em
  `EURUSD:OTC` (primeiro WORKING) → `state=ACKNOWLEDGED`, `brokerOrderId=14274204934`,
  `mode=PRACTICE` (conta PRACTICE USD 60; saldo REAL intocado, 0 BRL); depois
  `POST /api/iq/disarm` → desarmado. AUTO nunca ligado.
- **O que falta (documentado, não inventado):** não existe endpoint de disparo em lote
  (apenas 1 mercado por vez em `/api/iq/test-order`) nem endpoint que force um ciclo de
  análise/consenso sob demanda. Por isso o teste foi ARM + 1 ciclo no 1º WORKING.
- Relatório: `docs/office-v3/practice-test.report.json`.

## Dados reais
- `GET /api/iq/office` de produção: 54 mercados; `connection.connected=true`,
  `healthy=true`, host `ws.iqoption.com`; `working=37`, `disabled=17`.

## Verificação
- `npx vitest run tests/ai` → **743/743 verdes**.
- `npx tsc -p tsconfig.json --noEmit` → limpo (exit 0).
- Browser real Playwright+Chrome → 52/52 asserts PASS.
- `npm run build` OK; deploy `vercel --prod` OK, alias `https://tracecom.consecom.com.br`;
  smoke `GET /` = 200, `GET /classic.html` = 200.

## Commit
- commit: `e2f32a6`
- branch: `main` (origin `WmAgencia/tracecom`)

## Pendências
- Sem trigger de sinal em lote no relay (testado 1 mercado por vez).
- Supervisor segue no mundo (não vinculado a ativo); fora da área visível do escritório
  no layout atual. Sem idle/social por decisão desta rodada.
- `dist/` é gerado no build (não versionado).
