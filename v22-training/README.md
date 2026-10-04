# V22 Training — Session Logger

## O que é gravado

- **snapshots/**: snapshot a cada 5 segundos com candles, indicadores, regime, RSI, ADX, posições abertas
- **sessions/**: arquivo por sessão com timestamp, resultado final, candles processados, sinais emitidos
- **signals.log**: todas as decisões de entrada/skip com timestamp e razão

## Como funciona

1. O `session-logger.mjs` exporta `startSessionLogger(state)` que é chamado pelo bot
2. Roda em paralelo ao bot, não interfere na latência
3. Ao final (Ctrl+C ou encerramento), `endSessionLogger()` fecha o arquivo

## Comandos

```powershell
# Sessão normal
node ws-otc-v22.mjs demo

# Forçar commit manual (sem esperar encerrar)
node v22-training/scripts/post-session.mjs

# Ver sessão atual
dir v22-training/sessions/
```
