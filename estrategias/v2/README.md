# V2 — RSI_REVERSAL_STRICT_V2 / RSI_EXTREME_PULLBACK_V2

Segunda geração: duas skills comparadas em shadow, 50/50 NORMAL+OTC, sem execução (congeladas).
Código: `relay/rsi-skills-v2.mjs`, `relay/rsi-agents-v2.mjs`. Freeze: `docs/research/data/rsi-agents-v2-freeze.json`.

- STRICT V2: reversão confirmada com criterios mais duros (tendencia estrutural contra + reversao de DI/RSI).
- PULLBACK V2: entrada em continuacao da reversao inicial (pullback) com confirmacao.
- Objetivo: comparar perfis sem executar; a V3 unificou tudo numa estrategia unica.
- Ambas permanecem `controlsExecution=false` ate hoje (shadow historico).
