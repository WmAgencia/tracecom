# /estrategias — arquivo histórico das estratégias RSI do TraceCon

Cada pasta documenta UMA versão da mesma família (detecção de reversão por RSI extrema).
Nenhuma versão antiga foi alterada: o comportamento vive nos módulos `relay/rsi-*.mjs` e o
histórico operacional está no banco (`iq_rsi_*`). Aqui ficam apenas documentação e datasets.

| Versão | Estratégia | Módulo | Executa? | Estado |
|---|---|---|---|---|
| v1 | RSI_REVERSAL_STRICT_V1 / RSI_EXTREME_PULLBACK_V1 | relay/rsi-reversal.mjs, relay/rsi-variants.mjs | não (pausada) | arquivada |
| v2 | RSI_REVERSAL_STRICT_V2 / RSI_EXTREME_PULLBACK_V2 | relay/rsi-skills-v2.mjs, relay/rsi-agents-v2.mjs | não (shadow congelado) | arquivada |
| v3 | RSI_REVERSAL_PULLBACK_V3 | relay/rsi-v3.mjs, relay/rsi-agents-v3.mjs | não (desligada) | arquivada |
| v3.1 | RSI_REVERSAL_PULLBACK_V3 (V1_1: memória de episódio + watch) | relay/rsi-v3.mjs, relay/rsi-agents-v3.mjs, relay/rsi-v3-watch.mjs | não (desligada) | substituída pela v4 |
| v4 | RSI_REVERSAL_V4 | relay/rsi-v4.mjs, relay/rsi-agents-v4.mjs | **SIM** (PRACTICE, armed=false até ARM manual) | ativa |

## Como ler cada pasta
- `README.md`: visão geral e como interpretar.
- `strategy.md`: workflow, indicadores, regras e instrumentos.
- `thresholds.json`: números usados (fonte: política no código).
- `changelog.md`: o que mudou e por quê, com commits/fatos verificáveis.

## Dados de auditoria
- `v4/first-10-trades/`: primeiras 10 operações da V4 em JSON (BINARY e BLITZ_45S separados),
  geradas por `scripts/rsi-v4-export-first10.mjs` (sanitizado; bloqueia segredos).
- `docs/research/data/rsi-v4-counterfactual.json`: replay causal V3→V4 das 12 operações V3.
- `docs/research/data/rsi-v4-complexity.json`: complexity budget V3.1 → V4.

## Regras invioláveis do arquivo
1. Nunca declarar edge com amostra pequena.
2. Nunca reescrever o passado: JSONs são congelados; correções viram novo documento.
3. Nunca incluir segredos (ssid/token/cookie/sessão/saldo/credenciais) — ver scanner de export.
4. PRACTICE ONLY; REAL LOCKED; sem martingale/recovery/progressão de stake (stake fixo R$10).
