# Comparativo — Últimos 113 Trades Reais por Estratégia

Método: extração dos **últimos 113 trades reais** de cada estratégia no banco do experimento shadow (mesmo formato do export do v6). WR = WIN / (WIN+LOSS), excluindo empates (DRAW); empates ocorrem quando o preço de liquidação é idêntico ao de entrada (momentos de preço estático no gráfico).

## Tabela (por WR)

| Estratégia | N | W | L | D | U | WR | IC95 inf | Amostra efetiva (W+L) |
|---|---|---|---|---|---|---|---|---|
| reversion-v2 | 113 | 25 | 12 | 67 | 9 | 67,6%* | 51,5% | 37 ⚠️ (67 empates) |
| **reversion-v1** | 113 | 62 | 37 | 0 | 14 | **62,6%** | **52,8%** | **99 ✓** |
| reversion-v6 | 113 | 59 | 42 | 3 | 9 | 58,4% | 48,7% | 101 ✓ |
| reversion-v5 | 98 | 51 | 37 | 2 | 8 | 58,0% | 47,5% | 88 |
| bollinger-rsi-v1 | 113 | 27 | 25 | 52 | 9 | 51,9%* | 38,7% | 52 ⚠️ (52 empates) |
| macd-rsi-v1 | 83 | 37 | 36 | 7 | 3 | 50,7% | 39,5% | 73 |
| snapback-v1 | 113 | 50 | 49 | 1 | 13 | 50,5% | 40,8% | 99 |
| pullback-v1 | 32 | 13 | 14 | 4 | 1 | 48,1% | 30,7% | 27 |
| dual-rsi-v1 | 113 | 48 | 55 | 1 | 9 | 46,6% | 37,3% | 103 |
| reversion-v3 | 113 | 45 | 53 | 15 | 0 | 45,9% | 36,4% | 98 |
| trend-v1 | 113 | 46 | 55 | 3 | 9 | 45,5% | 36,2% | 101 |
| momentum-v1 | 113 | 38 | 65 | 1 | 9 | 36,9% | 28,2% | 103 |

\* WR calculado sobre amostra efetiva pequena por causa de empates — tratar como inconclusivo.

## Leitura

1. **`reversion-v1` é a mais sólida**: 62,6% sobre 99 liquidações reais (IC95 inf 52,8%) — único resultado com amostra efetiva cheia E limite inferior acima de 50%.
2. **`reversion-v6` (T+45)** confirma a família: 58,4% (101 liquidações). A variante T+45 vs T+60 do v5 (58,0%) fica praticamente empatada nessa janela recente.
3. **`reversion-v2`** mostra o maior WR bruto (67,6%) mas com apenas 37 liquidações — 67 empates inflam o número bruto; inconclusivo.
4. **Controles negativos**: `momentum-v1` (36,9%) e `trend-v1` (45,5%) reforçam que o edge recente está na reversão, não no momentum.
5. Empates (DRAW) são legítimos (preço estático no período), mas devem ser lidos como "sem decisão" — nunca contam como vitória.

## Exportações

CSVs por estratégia em `exports/last113/` (`<estrategia>-last113.csv`), com os campos completos (trade_id, ativo, decisão, confiança, timestamps, resultado).
