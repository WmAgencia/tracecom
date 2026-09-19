# RSI_REVERSAL_V4

**Filosofia:** "O passado coloca o ativo sob observação. O PRESENTE autoriza a ordem."

Workflow único e simples:

```
DETECT  ->  WATCH  ->  CONFIRM  ->  REVALIDATE  ->  ENTER ou CANCEL
```

- O RSI extremo (<=30 / >=70, Wilder 14) apenas CRIA o candidate (observação).
- Enquanto o episódio é logicamente contínuo, o ativo fica sob ACTIVE WATCH (1 avaliação por candle de 5s).
- A ordem só existe se o **estado atual** — sem conhecer o passado — parecer uma reversão coerente:
  Bollinger (esticou + rejeição/reentrada atual), DMI/ADX (pressão antiga enfraquecendo + DI novo reagindo),
  sem counter-evidence HARD, cushion NORMAL/STRONG.
- `counterEvidenceAtEntry[]` é registrada com severidade: qualquer HARD bloqueia; SOFT apenas registra.
- Instrumentos: `BINARY` (expiry sincronizado com o broker, entrada na última avaliação causal antes do
  safe cutoff) e `BLITZ_45S` (entrada imediata na confirmação; expiry = entrada + 45s) — o segundo SOMENTE
  se o broker expuser o instrumento e o caminho de ordem for verificado (fail-closed, nunca simulado).

Segurança: PRACTICE only, REAL locked, stake fixo R$10, sem martingale/recovery/progressão.
