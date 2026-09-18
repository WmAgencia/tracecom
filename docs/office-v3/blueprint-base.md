# OFFICE V3 — Blueprint Base (renderizador híbrido)

> Frontend/renderização apenas. PRACTICE only. ZERO REAL. Sem ordens, sem stake.

## O que é

O renderizador **híbrido** usa a imagem de referência congelada
(`docs/office-v2/screenshots/reference.png`, 1536×1024) como a **camada base
estática pré-renderizada**. O TraceCom desenha **apenas as camadas dinâmicas**
por cima, alinhadas às coordenadas do blueprint (`docs/office-v2/BLUEPRINT.md`).

Essa é a única técnica que consegue se aproximar de **100% de identidade visual
para a cena estática**: em vez de tentar repintar piso, paredes, mesas, quadros
e plantas à mão, nós os herdamos da própria referência. Os personagens e badges
pintados **não** são herdados: são removidos por inpainting determinístico
(`blueprint-clean.png`) porque só o runtime pode dizer quem está trabalhando e
qual foi o P&L real.

```
┌─────────────────────────────────────────────┐
│ drawBlueprintBase(ctx, base)   ← estático    │  referência 1:1 (1536×1024)
│   piso, paredes, mesas, painéis, rótulos     │  sem escala, sem blur, sem crop
├─────────────────────────────────────────────┤
│ drawDynamicOverlay(...)        ← dinâmico    │  só o que muda com o estado
│   agentes OPEN, badges P&L, scrim/tag CLOSED │  alinhado às âncoras do blueprint
│   hover, supervisor                          │
└─────────────────────────────────────────────┘
```

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/http/public/office-v3/blueprint-base.js` | carrega e desenha a base; config `OFFICE_V3_BASE` |
| `src/http/public/office-v3/overlay.js` | `STATION_ANCHORS`, agentes/badges/tags/hover/supervisor |
| `src/http/public/office-v3/base-mode.js` | `resolveBaseMode(search, env)` |
| `src/http/public/office-v3/blueprint-reference.png` | cópia servida da referência congelada |
| `scripts/office-v3-base-diff.mjs` | renderiza o híbrido e mede a similaridade |
| `scripts/office-v3-hybrid-shots.mjs` | screenshots híbridos (overview/zoom/hover/viewports) |
| `scripts/office-v3-clean-plate.mjs` | gera o clean plate (baias geométricas + detector de resíduo) |
| `scripts/office-v3-browser-check.mjs` | validação em browser real (7 cenários + screenshots) |
| `tests/ai/office-v3-blueprint-base.test.ts` | 24 testes headless |

A referência original **não** é tocada; `blueprint-reference.png` é uma cópia
para o navegador poder carregá-la.

## Âncoras (`STATION_ANCHORS`) — calibradas pela PRÓPRIA referência

As âncoras **não** usam mais a estimativa antiga do `BLUEPRINT.md` (célula
124px, fim em x≈1378). Um scan headless da referência congelada
(`docs/office-v2/screenshots/reference.png`) mediu as mesas pintadas: as bandas
de 10 mesas têm `x0 ≈ 261` / `pitch ≈ 113`, e as bandas divididas
(OTC|CRIPTO, ÍNDICES|COMMODITIES) são **dois setores de 5 mesas** com origens
próprias. Sem resize, crop ou blur.

Geometria data-driven: `ANCHOR_BANDS = [{ y, sectors: [{ x0, pitch, count }] }]`.

| Banda | `y` (topo) | Setor | `x0` | `pitch` | mesas |
|---|---|---|---|---|---|
| FOREX MAJORS | 392 | — | 261 | 113 | 10 |
| FOREX CRUZADOS | 502 | — | 261 | 113 | 10 |
| OTC + CRIPTO | 616 | OTC 24H | 258 | 114 | 5 |
| OTC + CRIPTO | 616 | CRIPTO | 847 | 110 | 5 |
| ÍNDICES + COMMODITIES | 731 | ÍNDICES | 249 | 114 | 5 |
| ÍNDICES + COMMODITIES | 731 | COMMODITIES | 846 | 113 | 5 |
| OUTROS ATIVOS | 839 | — | 254 | 114 | 10 |
| OTC EXTRA (expandido) | 1072 | — | 261 | 113 | 5 |

Medidas de apoio (mesma varredura): frente da mesa ≈ **82–85px de largura** e
≈ **26px de altura**; o retângulo de âncora usa **100×52** para cobrir tampo +
frente. Linha de assento = `y + 30`; badge de P&L = `y − 14`. A resolução tenta
`marketKey` → `display/symbol` (exato e normalizado) → índice.

Cada âncora expõe `{ x, y, desk, seatY, traderX, criticX, badgeY, band, col }`.
As 55 posições saem de `buildDeskSlots()` (10+10+5+5+5+5+10+5); os 5 mercados
que não cabem nas 50 mesas pintadas usam a banda expandida em `y = 1072`.

## Hover, clique e teclado

- **mousemove** → `screenToWorld` + hit test nas âncoras calibradas
  (`overlay.hitTestAnchor`); a mesa sob o cursor recebe `drawHoverHighlight`
  (contorno dourado) via `hoverMarketKey`. O estado `hoveredStationId` **não
  toca a camada base** (a base é desenhada idêntica a cada frame).
- cursor vira `pointer` sobre uma mesa; **tooltip** flutuante mostra
  `símbolo · disponibilidade · payout`.
- **clique** → `mountMarketDetail` + `zoomToDesk` (o foco usa a âncora do
  overlay, não o `CONTENT_X` do `world.js`).
- **teclado**: a lista `#office-station-list` é focável (`role="listbox"`),
  navegável com ↑/↓ (roving tabindex) e **Enter abre o detalhe** da estação.
- **`prefers-reduced-motion: reduce`** desativa a animação suave da câmera
  (`zoomToDesk` salta direto para o alvo).


## Modos e como alternar

`OFFICE_V3_BASE = "reference" | "procedural"` (padrão `"reference"`).

Precedência: **query** `?base=procedural` > **env** `OFFICE_V3_BASE` > padrão.

- `reference` → base congelada + overlay dinâmico (híbrido);
- `procedural` → renderizador procedural do `world.js` (sem imagem base).

Valores inválidos são ignorados e caem no padrão, sem lançar.

## Trade-off honesto

- **Identidade estática**: piso, paredes, mesas, plantas, quadros e rótulos são
  literalmente a referência; a única diferença é a remoção intencional de
  personagens/badges pintados (medido abaixo).
- **Agentes e badges pintados foram removidos** do `blueprint-clean.png`
  (125 máscaras de cor + 100 baias geométricas de desk derivadas das próprias
  `ANCHOR_BANDS`, terminando em `band.y + 25` antes do rótulo gravado).
  A paridade fora das máscaras continua 0 e os 50 rótulos das mesas foram
  preservados byte a byte (o pipeline antigo os destruía parcialmente).
- **Reconstrução social** (lounge, sinuca, café/cozinha, reunião, terraço) usa
  difusão local e pode deixar suavização visível — não há personagem/sprite
  remanescente (verificado por detector de faces embutidas nas 100 baias).
- **Rótulos pintados ≠ universo dinâmico** em parte da arte: a referência
  rotula NZD/USD, ETH/LTC/XRP/ADA, WTI/BRENT/NATGAS e ações. A ordem de
  `ANCHOR_MARKETS` foi realinhada ao rótulo pintado sempre que existe
  contraparte no universo reconciliado (majors, cruzados, OTC 24H, BTC,
  índices US500/US100/US30/GER30/UK100, GOLD/SILVER); os mercados sem
  contraparte pintada ocupam as mesas restantes e são identificados por
  MESAS, tooltip e painel (não pelo texto pintado).
- **A arte dinâmica é nossa**: os agentes desenhados por cima são os sprites do
  `assets.js`. Com a base limpa não há mais agente pintado residual.
- **Pan/zoom**: no híbrido a câmera é aplicada à base + overlay, então
  `zoomToDesk` funciona; em repouso (`zoom=1, x=y=0`) a base fica 1:1, sem
  resize/crop/blur. `prefers-reduced-motion` desliga a animação suave.

## Similaridade medida (não manipulada)

`node scripts/office-v3-base-diff.mjs` → `docs/office-v3/screenshots/hybrid-base.png`

Cenário do script: 55 mercados, 49 OPEN / 6 CLOSED, 98 agentes + 49 badges.
A comparação é feita contra a referência bruta: a diferença da coluna
"base-only" É a remoção intencional dos badges e personagens pintados.

| Camada | mean abs diff | similaridade |
|---|---|---|
| base-only (clean plate vs referência bruta) | 6.2301 | **97.557%** |
| **híbrido (base + overlay)** | **7.1181** | **97.209%** |

Tabela 8 regiões (híbrido):

| Região | similaridade | mean abs diff |
|---|---|---|
| R1C1 | 98.022% | 5.0435 |
| R1C2 | 97.134% | 7.3086 |
| R1C3 | 97.979% | 5.1527 |
| R1C4 | 98.149% | 4.7206 |
| R2C1 | 97.676% | 5.9269 |
| R2C2 | 95.651% | 11.0904 |
| R2C3 | 96.336% | 9.3428 |
| R2C4 | 96.722% | 8.3597 |

O híbrido fica acima de 95% (pior região 95.65%); a diferença restante é a
recriação dinâmica de agentes/badges e a suavização das zonas sociais — não há
mais sprite pintado reconhecível.

## Verificação

```
node --check src/http/public/office-v3/blueprint-base.js
node --check src/http/public/office-v3/base-mode.js
node --check src/http/public/office-v3/overlay.js
node --check src/http/public/office-v3/office-v3.js
node scripts/office-v3-clean-plate.mjs          # regenera a base (determinístico)
node scripts/office-v3-base-diff.mjs
node scripts/office-v3-hybrid-shots.mjs
node scripts/office-v3-browser-check.mjs        # browser real (playwright + chrome)
npx vitest run tests/ai/office-v3-blueprint-base.test.ts tests/ai/office-v3-clean-plate.test.ts
npx tsc -p tsconfig.json --noEmit
```

Relatório do browser real: `docs/office-v3/browser-check.md` (+ `browser-check.report.json`).
