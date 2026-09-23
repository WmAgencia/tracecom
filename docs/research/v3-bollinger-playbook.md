# V3 — PLAYBOOK: BOLLINGER BANDS (John Bollinger)

Fontes: `BOLLINGER_OFFICIAL_RULES` (regras oficiais do autor) e `BOLLINGER_2001`.
Contratos: `relay/v3/playbooks.mjs` (BOLLINGER_*) · medicoes: `relay/v3/measurements.mjs::measureBollingerContext`.

## SOURCE-BACKED (regras oficiais)

- As bandas dao **definicao relativa** de caro/barato: preco alto na banda superior, baixo na inferior.
- **Tags nao sao sinais**: tocar a banda nao e vender/comprar. Em tendencia o preco **caminha**
  pela banda (band walk). Fechamentos fora das bandas sao, inicialmente, **continuacao**, nao reversao.
- **%B**: posicao do fechamento dentro das bandas (1.0 = banda superior, 0.0 = inferior).
- **BandWidth** = (upper - lower) / mid. O autor define **The Squeeze** como BandWidth na
  **minima de 125 periodos**; o oposto (Bulge) diagnostica fim de tendencia.
- **Midline**: deve refletir a tendencia de intermediario prazo; sua inclinacao e contexto.
- **Nao assumir normalidade estatistica** (o autor e explicito).

## TRACECOM OPERATIONAL DEFINITION

- `bandWalk`: ABOVE_UPPER / UPPER_HALF / MID / LOWER_HALF / BELOW_LOWER pelo fechamento.
- `reentry`: fechou fora e voltou para dentro (comparacao com candle -lookback).
- `rejection`: extremo da banda tocado no pavio com fechamento de volta para dentro.
- `squeeze`: percentil do BandWidth na janela disponivel (proxy do 125-period low, documentado
  como adaptacao para series curtas de 5s).
- `expansion`: EXPANDING/CONTRACTING pela comparacao com candle -lookback.
- **BLOCKERS**: SQUEEZE (direcao desconhecida), VOL_BULGE (fim de expansao) — bloqueiam
  aprovacao, nao o cenario.

## Uso pelo especialista

WHEN RELEVANT: contexto relativo e compressao/expansao. WHEN NOT RELEVANT: series curtas.
SUPPORTING: walk/rejeicao a favor da tese. COUNTER: walk/reentry contra.
Erros comuns: tag como reversao; ignorar midline; esperar 95% dentro das bandas.
Causalidade: BandWidth/%B por candle fechado; percentil usa somente o passado disponivel.
