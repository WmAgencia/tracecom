# Validação Forward — `shadow-reversion-v6` @ EUR/NZD OTC

## Definição da estratégia

- Sinal: RSI(14) em banda profunda **|s| ∈ [0,63; 0,857]** onde `s = (55 − RSI) / 45`
  - BUY: RSI ≈ 16,4–26,7 · SELL: RSI ≈ 83,3–93,6
- Filtro: volatilidade realizada (12 candles de 5s) < 0,0009
- Horizonte de liquidação: **T+45 segundos** (per-strategy horizon)
- Sem automação de corretora; 100% shadow/paper; liquidação por observações causais reais.

## Evidência que originou o v6 (retrospectiva, mesma janela causal)

| Grupo | T+30s | T+45s | T+60s |
|---|---|---|---|
| Banda profunda (n≈165–170) | 69,7% | **79,0%** | 74,1% |
| · 1ª metade | 71,9% | 79,6% | 73,5% |
| · 2ª metade | 66,7% | 78,3% | 75,0% |
| Abaixo da banda (controle) | 53,8% | 50,7% | 50,3% |

Réplica fora da amostra em duas estratégias independentes:
- `reversion-v1` banda 72,0% (n=60) · metades 76,3%/63,6%
- `reversion-v2` banda 71,9% (n=57) · metades 73,2%/68,8%
- Cauda extrema excluída (conf ≥ 0,80: ~18% — falha consistente)

## Resultado forward (ao vivo, EUR/NZD OTC)

- **60 / 100 trades** no momento do registro
- **34W / 17L / 1D / 8U** → **WR = 66,7%** (IC95: 53,0% – 78,1%)
- Progresso interrompido por indisponibilidade do stream de captura (não é falha do motor).
- Para referência, o mesmo v6 em EUR/USD fechou em 50,0% (25W/25L, n=53).

## Leitura estatística

- N ainda abaixo de 100 → **veredito pendente**. A meta do experimento é N=100 com IC95 inferior estável.
- O resultado atual (66,7%) está acima da meta operacional de 60–65% e do melhor resultado forward do experimento até aqui.
- Histórico da sessão exige cautela: outras variantes com WR alto em N pequeno colapsaram (ver `RELATORIO-SESSAO-2026-09-14.md`).

## Próximos passos

1. Retomar o stream de captura (EUR/NZD OTC) e completar os 40 trades restantes.
2. Fechar o veredito com N=100 (WR final + IC95).
3. Se mantiver ≥ 60% com IC95 inferior > 50%, promover a estratégia a candidata de primeira classe para a fase de validação formal.
