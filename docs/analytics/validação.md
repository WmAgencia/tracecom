# TRACECON — Persistência e Aprendizado estatístico (Etapa 10)

## Cold store de candles

`store/repositories/candleRepository.ts` grava candles **fechados** reais em
`market_candles` (PK provider+symbol+timeframe+timestamp ⇒ dedup idempotente).
Rejeita valores inválidos (NaN/preço≤0); detecta gaps. É a fonte do backtest e
da estatística. NUNCA persiste candle aberto nem dado inventado.

## Registro e validação de decisões

`analytics/service.ts` + `store/repositories/decisionRepository.ts`:

- `recordDecision` → grava a decisão da fusão (direção, score, confiança,
  prob. empírica, amostra, regime, racional) em `decision_records`.
- `evaluatePending` → **somente quando o horizonte já decorreu**, consulta os
  candles reais e classifica `hit` / `miss` / `flat` (tolerância mínima).
- `stats` → win rate, retorno médio/líquido, calibração.

**Causalidade:** a validação é sempre POSTERIOR à decisão — nunca informa a
decisão. Sem candle real para o horizonte, permanece `pending` (não inventa).

## Ciclo de aprendizado

```
DECISÃO (fusão, com dados até então)
   ↓ registro
datum (entry_time/entry_price)
   ↓ horário decorre
VALIDAÇÃO (candles reais do futuro já ocorrido) → hit/miss/flat
   ↓ agregação
ESTATÍSTICA (win rate, retorno) — calibração observada
```

## Como usar

```bash
npm run decide BTCUSDT 1h up 12     # analisa, registra decisão e valida pendentes
curl "http://127.0.0.1:8788/api/analytics/stats?symbol=BTCUSDT"
```

A estatística é **observada**, nunca prometida: se a tracecon não tem vantagem,
ela reporta o win rate real (incluindo resultados ruins) para o usuário ajustar
critérios.
