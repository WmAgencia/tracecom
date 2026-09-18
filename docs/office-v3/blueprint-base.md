# OFFICE V3 — Blueprint Base (renderizador híbrido)

> Frontend/renderização apenas. PRACTICE only. ZERO REAL. Sem ordens, sem stake.

## O que é

O renderizador **híbrido** usa a imagem de referência congelada
(`docs/office-v2/screenshots/reference.png`, 1536×1024) como a **camada base
estática pré-renderizada**. O TraceCom desenha **apenas as camadas dinâmicas**
por cima, alinhadas às coordenadas do blueprint (`docs/office-v2/BLUEPRINT.md`).

Essa é a única técnica que consegue se aproximar de **100% de identidade visual
para a cena estática**: em vez de tentar repintar piso, paredes, mesas, quadros,
plantas e personagens pintados à mão, nós os herdamos da própria referência.

```
┌─────────────────────────────────────────────┐
│ drawBlueprintBase(ctx, base)   ← estático    │  referência 1:1 (1536×1024)
│   piso, paredes, mesas, painéis, agentes     │  sem escala, sem blur, sem crop
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
| `tests/ai/office-v3-blueprint-base.test.ts` | 19 testes headless |

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

- **Identidade estática ~100%**: a cena estática é literalmente a referência.
  Medido: **similaridade base-only = 100.000%** (mean abs diff = 0.0000).
- **Mesas fechadas não removem os agentes pintados.** A base sempre mostra
  agentes; como não é possível apagá-los, o overlay aplica um **scrim
  translúcido + tag** (`FECHADO` / `SUSPENSO` / `INDISPONÍVEL`). Não é o mesmo
  que uma mesa vazia de verdade — é uma limitação consciente da técnica híbrida.
- **A arte dinâmica é nossa**: os agentes desenhados por cima são os sprites do
  `assets.js`, não os da referência. Podem não coincidir pixel a pixel com os
  agentes pintados (daí o pequeno desvio no híbrido). Os badges de P&L do
  overlay caem sobre os badges pintados (não dá para apagá-los).
- **Pan/zoom**: no híbrido a câmera é aplicada à base + overlay, então
  `zoomToDesk` funciona; em repouso (`zoom=1, x=y=0`) a base fica 1:1, sem
  resize/crop/blur. `prefers-reduced-motion` desliga a animação suave.

## Similaridade medida (não manipulada)

`node scripts/office-v3-base-diff.mjs` → `docs/office-v3/screenshots/hybrid-base.png`

Cenário do script: 55 mercados, 49 OPEN / 6 CLOSED, 98 agentes + 49 badges.

| Camada | mean abs diff | similaridade |
|---|---|---|
| base-only (estático) | 0.0000 | **100.000%** |
| **híbrido (base + overlay)** | **2.3388** | **99.083%** |

Tabela 8 regiões (híbrido):

| Região | similaridade | mean abs diff |
|---|---|---|
| R1C1 | 99.672% | 0.8353 |
| R1C2 | 98.980% | 2.6020 |
| R1C3 | 99.393% | 1.5484 |
| R1C4 | 99.628% | 0.9483 |
| R2C1 | 99.223% | 1.9816 |
| R2C2 | 97.711% | 5.8372 |
| R2C3 | 98.772% | 3.1322 |
| R2C4 | 99.284% | 1.8256 |

O híbrido fica acima de 95% (pior região 97.7%), o que confirma a identidade
visual para as partes estáticas. A calibração das âncoras subiu a similaridade
de **99.025% → 99.083%** (os agentes agora pousam nas mesas pintadas).

## Verificação

```
node --check src/http/public/office-v3/blueprint-base.js
node --check src/http/public/office-v3/base-mode.js
node --check src/http/public/office-v3/overlay.js
node --check src/http/public/office-v3/office-v3.js
node scripts/office-v3-base-diff.mjs
node scripts/office-v3-hybrid-shots.mjs
npx vitest run tests/ai/office-v3-blueprint-base.test.ts
npx tsc -p tsconfig.json --noEmit
```
