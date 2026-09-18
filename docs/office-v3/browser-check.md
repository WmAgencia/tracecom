# OFFICE V3 — REAL BROWSER CHECK + FRESH CRITIC

> Frontend/rendering only. PRACTICE only. ZERO REAL. Nenhuma ordem, nenhum stake
> write; o fixture de API vive dentro do próprio script de checagem.

## Como rodar

```powershell
node scripts/office-v3-browser-check.mjs                 # servidor estático + fixture
node scripts/office-v3-browser-check.mjs --url=http://host/   # contra URL externa
node scripts/office-v3-browser-check.mjs --scenario=3
```

O script tenta, nesta ordem, e **imprime qual engine rodou**:

1. `playwright` já instalado em `node_modules`;
2. instalação temporária de `playwright` + chromium do sistema
   (`channel: chrome` → `msedge` → bundled, sem baixar 150 MB quando há Chrome);
3. harness sintético (fake-DOM, **rotulado SYNTHETIC**, nunca vendido como browser real).

**Engine que realmente rodou nesta validação: `playwright+chrome` (Chrome 152.0.7977.84, headless),
`realBrowser=true`.** O fallback sintético não foi usado.

Servidor local: `scripts/office-v3-browser-check.mjs` serve `src/http/public` e responde
`/api/iq/office` com um fixture determinístico derivado do universo reconciliado
(`relay/market-universe.mjs`, leitura apenas): 54 mercados, 51 WORKING, GBP/USD
OPEN+feed stale, USD/JPY CLOSED, EUR/GBP SUSPENDED, EUR/USD com settlement real
(WIN +R$ 8,50) e stake configurado 25, EUR/JPY stake 30, `config.defaultStake=10`.

Relatório bruto: `docs/office-v3/browser-check.report.json` (43 asserts, todos com valores).
Screenshots: `docs/office-v3/screenshots/browser-s*.png`.

## Cenários — PASS/FAIL com evidência

| # | Cenário | Resultado | Evidência (screenshot) | Valores-chave medidos |
|---|---|---|---|---|
| 0 | Boot + snapshot (`/` e rollback `/classic.html`) | **PASS 8/8** | `browser-s0-boot.png` | 54 estações; canvas 1530 cores distintas; EUR/USD `WORKING`/agentes; GBP/USD `OPEN_BUT_FEED_OFFLINE`/sem agentes; USD/JPY `CLOSED`; EUR/GBP `SUSPENDED`; overlay desenha `agents=102 = working 51×2` |
| 1 | Space + drag (←→↑↓), cursor, seleção, sem clique acidental | **PASS 9/9** | `browser-s1-pan-before/after.png` | cursor `grab`→`grabbing`→`default`; `camera.x 243.98→380.11→243.98`; `camera.y 152.49→251.49→152.49`; `selection=""` nos 4 drags; body `tc-v3-select-off`; `panReady=false`, `dragging=false`, 0 painéis ao soltar |
| 2 | Wheel zoom centrado no cursor | **PASS 4/4** | `browser-s2-zoom-before/in/after.png` | `zoom 1→1.4681→1`; drift do ponto do mundo `0.0000 px` no zoom in e out |
| 3 | Clamp/bordas (zoom mínimo e zoom 1) | **PASS 5/5** | `browser-s3-minzoom/maxedge/minedge.png` | min zoom centralizado (`centeredX/Y=true`), mundo inteiro visível `(320,104)→(960,616)`; bordas exatas `x=1280=maxX`, `y=1328=maxY`, depois `x=0`, `y=0`; `spanX=1280=viewport/zoom` |
| 4 | Clique EUR/USD → zoom + painel do marketKey | **PASS 6/6** | `browser-s4-panel-open/closed.png` | painel `data-market-key=EURUSD:NORMAL`, título `EUR/USD`, `zoom 1→4`; stake input `25` e meta `efetivo R$ 25,00 · teto R$ 100,00`; estado `MERCADO ABERTO · OPERANDO`; FECHAR → `panels=0, selected=null` |
| 5 | MESAS: abrir, buscar, ↑↓+Enter | **PASS 4/4** | `browser-s5-mesas-popup.png`, `browser-s5-mesas.png` | destaque `GBP/USD · MERCADO ABERTO · FEED OFFLINE`; seleção `GBPUSD:NORMAL`; foco/zoom e painel no MESMO marketKey |
| 6 | Trocar de ativo (sem dado velho) | **PASS 4/4** | `browser-s6-eurjpy.png` | painel `EURJPY:NORMAL`, título `EUR/JPY`, nenhum texto de GBP/USD, `state=WORKING`, overlay 102 agentes = 51 working×2 |
| 7 | Rótulo derivado × agentes (feed offline) | **PASS 3/3** | `browser-s7-feed-offline.png` | `OPEN_BUT_FEED_OFFLINE` + label `MERCADO ABERTO · FEED OFFLINE` + short `FEED OFFLINE` + `agentsWorking=false`; painel com o MESMO rótulo e `OCIOSO (SOCIAL/IDLE)`; `feedOffline=1` e contagem de agentes coerente |
| | **TOTAL** | **PASS 43/43** | 15 screenshots | engine `playwright+chrome`, `realBrowser=true` |

## Critic fresco — REGION → PROBLEM → CAUSE → FIX → STATUS

| Região | Problema | Causa | Fix | Status |
|---|---|---|---|---|
| `blueprint-clean.png` (desks) | **GHOST_AGENT**: 14 baias de desk ainda com agente pintado reconhecível (rosto/olhos). Confirmado por crop 4× e detector independente (AUD/USD, BTC, ETH, XRP, ADA, DOW JONES, WTI, BRENT, META, MICROSOFT, GBP/JPY OTC…) | O detector de cor exige componente de pele compacto; em vários sprites a pele se funde com a madeira da mesa, e o passe de "back seeds" retornava 0 (filtros nunca casavam) | 100 baias geométricas derivadas de `ANCHOR_BANDS` (trader = cx−20, critic = cx+20, até `band.y+25`), clip das máscaras automáticas antes do rótulo e detector de resíduo com olhos embutidos; `blueprint-clean.png` regenerado (225 máscaras, 252.000 px, parity fora = 0, resíduos = 0) | **FIXED** |
| `blueprint-clean.png` (rótulos) | Rótulos gravados destruídos parcialmente (ex.: `NASDAQ→NASE`, `PETR4→reT`, `AUD/USD→AUD/`) | Máscaras automáticas cresciam para dentro da frente da mesa (até `band.y+42`) | Clip em `band.y+25` + baias geométricas; teste exige 0 px alterados na faixa do rótulo | **FIXED** |
| Zonas sociais | Suavização/smear visível (cozinha, sinuca, reunião) | Inpainting por difusão em regiões grandes; limitação honesta da técnica | Nenhum personagem reconhecível restante (detector = 0); limitação documentada | **ACEITO (caveat documentado)** |
| `overlay.js` / `office-v3.js` | **DUPLICATE_AGENT + WRONG_MARKET_PANEL**: marketKey fora da tabela calibrada caía na âncora por índice e colidia (ex.: fixture demo antigo NZD/USD e EUR/JPY na mesma mesa) → 2 pares de agentes no mesmo desk e clique abrindo outro mercado | `anchorForMarket` é preferência; fallback por índice sem exclusividade | `createAnchorResolver(stations)` único e determinístico, usado por `drawDynamicOverlay`, `hitTestAnchor` e pelo zoom-to-desk do shell; resolver + teste de colisão | **FIXED** |
| `ANCHOR_MARKETS` × rótulos pintados | **BASE_OVERLAY_DESYNC semântico**: tag/agente de USD/JPY sobre a mesa pintada GBP/USD; EUR/JPY sobre NZD/USD | Ordem da tabela seguia o universo do relay, não os rótulos da arte | Ordem realinhada à arte sempre que existe contraparte (majors, cruzados, OTC 24H/5, BTC na mesa CRIPTO, US500/US100/US30/GER30/UK100, GOLD/SILVER) + teste de alinhamento por coordenada | **FIXED (residual documentado: ~18 mesas sem contraparte pintada — WTI/BRENT/ações etc.)** |
| `office-v3.js` (pan) | **PAN_BROKEN**: após um pan, `wasMoved()` ficava verdadeiro e todo clique normal de mesa era suprimido (painel nunca abria); cursor `grab/grabbing` não aparecia porque o `style.cursor` inline do hover sobrescrevia o CSS | `moved` nunca era resetado no `endPan` (supressão one-shot já existe) e o hover setava cursor inline | `endPan` reseta `moved` (mantém `suppressClick` one-shot); `setSpaceDown` limpa `style.cursor`; cenário 1/4 no browser real + testes de regressão | **FIXED** |
| `market-detail.js` + `office-v3.js` | **STATE_DESYNC**: FECHAR removia o painel mas o shell mantinha `selectedMarketKey`; o próximo poll (2 s) reabria o painel. O re-mount do MESMO mercado pelo poll também disparava `onClose` e zerava a seleção | FECHAR chamava `closeMarketDetail()` direto, sem avisar o shell; onClose sem distinguir close de replace | `detachMarketDetail(runOnClose)` + `onClose(marketKey)` apenas em close real; shell limpa a seleção só se ainda for a mesma | **FIXED** |
| Badges (overlay) | **GHOST_BADGE** | — | Badge só é desenhado quando `derived.badge.visible` (evento settlement real WIN/LOSS/DRAW); clean plate sem badges (`strict=0/fringe=0`); no browser só EUR/USD (evento real) exibiu `+R$ 8,50` | **NÃO REPRODUZIDO (verificado)** |
| Stake (painel/topbar) | **FAKE_STAKE** | — | Valores sempre do snapshot: painel EUR/USD `25` (`configuredStake`), meta `efetivo R$ 25,00 · teto R$ 100,00`, topbar global `10`; nenhum valor inventado | **NÃO REPRODUZIDO (verificado)** |
| Estado × agentes | **OPEN_BUT_OFFLINE**: desk WORKING com feed offline | — | GBP/USD OPEN+stale: `MERCADO ABERTO · FEED OFFLINE`, `agentsWorking=false`, `feedOffline=1`, overlay `agents=102=working×2`; painel idêntico ao desk | **NÃO REPRODUZIDO (verificado)** |
| Câmera | **ZOOM_CLAMP_BROKEN** | — | Wheel mantém o ponto sob o cursor com drift `0.0000 px`; min zoom centraliza e mostra as 4 bordas; em zoom 1 as bordas exatas são alcançáveis (`x=0/1280`, `y=0/1328`); `span=viewport/zoom` | **NÃO REPRODUZIDO (verificado)** |

## Fixes aplicados (frontend apenas)

| Arquivo | Mudança |
|---|---|
| `src/http/public/office-v3/blueprint-clean.png` | regenerado sem personagens/badges pintados e com rótulos preservados |
| `scripts/office-v3-clean-plate.mjs` | `DESK_AGENT_BOXES`/`deskClipLimit`/`scanDeskAgentResiduals`; limpeza residual geométrica; CLI reporta `desk residuals` |
| `src/http/public/office-v3/overlay.js` | `createAnchorResolver` (âncoras únicas) integrado a `drawDynamicOverlay`/`hitTestAnchor`; `ANCHOR_MARKETS` realinhado aos rótulos pintados |
| `src/http/public/office-v3/office-v3.js` | resolver compartilhado no zoom-to-desk; reset de `moved` no `endPan`; limpeza do cursor inline no Space; `onClose` do painel; hook `__tracecomOffice` (somente leitura/seleção) |
| `src/http/public/office-v3/market-detail.js` | `detachMarketDetail(runOnClose)` + `onClose` no close real (não no replace) |
| `src/http/public/office-v3/blueprint-base.js` | comentário de trade-off atualizado (base limpa, sem agente pintado) |
| `scripts/office-v3-browser-check.mjs` (novo) | servidor estático + fixture + 7 cenários em browser real + screenshots + JSON |
| `tests/ai/office-v3-anchor-resolver.test.ts` (novo) | regressão de âncoras únicas/hitbox/zoom consistente |
| `tests/ai/office-v3-clean-plate.test.ts` | regressão de resíduo nas 100 baias + rótulos intactos + relatório do CLI |
| `tests/ai/office-v3-blueprint-base.test.ts` | regressão do alinhamento mesa pintada × mercado |
| `tests/ai/office-v3-ui-controls.test.ts` | regressão de cursor/moved/onClose (achados do browser real) |
| `docs/office-v3/blueprint-base.md` | trade-off e similaridade atualizados (97.6% base / 97.2% híbrido, remoções intencionais) |

## Verde de verificação

```
node --check scripts/office-v3-browser-check.mjs        OK
node --check scripts/office-v3-clean-plate.mjs          OK
node --check src/http/public/office-v3/overlay.js       OK
node --check src/http/public/office-v3/office-v3.js     OK
node --check src/http/public/office-v3/market-detail.js OK
npx vitest run tests/ai                                 52 files / 756 tests PASS
npx tsc -p tsconfig.json --noEmit                       exit 0
node scripts/office-v3-browser-check.mjs                43/43 PASS (playwright+chrome)
```
