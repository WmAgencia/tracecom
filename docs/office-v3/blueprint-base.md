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
| `tests/ai/office-v3-blueprint-base.test.ts` | 18 testes headless |

A referência original **não** é tocada; `blueprint-reference.png` é uma cópia
para o navegador poder carregá-la.

## Âncoras (`STATION_ANCHORS`)

Calibradas pela geometria do blueprint, para pousarem **sobre as próprias mesas
da referência** (independente do `CONTENT_X` do `world.js`):

- 10 colunas, `x0 ≈ 200`, célula 124px, mesa 118px →
  centros `262, 386, 510, 634, 758, 882, 1006, 1130, 1254, 1378`;
- bandas de mesa em `y = 368 / 486 / 604 / 720 / 836`;
- os 5 mercados OTC que não cabem no viewport de 50 mesas usam a banda
  expandida do v2 em `y = 1072` (documentado no `BLUEPRINT.md`).

Cada âncora expõe `{ x, y, desk, seatY, traderX, criticX, badgeY, band, col }`.
A resolução tenta `marketKey` → `display/symbol` (exato e normalizado) → índice.

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
  agentes pintados (daí o pequeno desvio no híbrido).
- **Pan/zoom**: a base é fixa em 1:1; o overlay desenha no espaço do blueprint.
  A navegação procedural continua disponível no modo `procedural`.

## Similaridade medida (não manipulada)

`node scripts/office-v3-base-diff.mjs` → `docs/office-v3/screenshots/hybrid-base.png`

Cenário do script: 55 mercados, 49 OPEN / 6 CLOSED, 98 agentes + 49 badges.

| Camada | mean abs diff | similaridade |
|---|---|---|
| base-only (estático) | 0.0000 | **100.000%** |
| **híbrido (base + overlay)** | **2.4856** | **99.025%** |

Tabela 8 regiões (híbrido):

| Região | similaridade | mean abs diff |
|---|---|---|
| R1C1 | 99.573% | 1.0897 |
| R1C2 | 98.667% | 3.4003 |
| R1C3 | 99.001% | 2.5467 |
| R1C4 | 99.336% | 1.6921 |
| R2C1 | 99.450% | 1.4028 |
| R2C2 | 97.912% | 5.3247 |
| R2C3 | 99.077% | 2.3525 |
| R2C4 | 99.186% | 2.0762 |

O híbrido fica acima de 95% (pior região 97.9%), o que confirma a identidade
visual para as partes estáticas.

## Verificação

```
node --check src/http/public/office-v3/blueprint-base.js
node --check src/http/public/office-v3/base-mode.js
node --check src/http/public/office-v3/overlay.js
npx vitest run tests/ai/office-v3-blueprint-base.test.ts
npx tsc -p tsconfig.json --noEmit
```
