# Comparativo EUR/NZD — `reversion-v6` vs `reversion-v3+Fibonacci`

Data: 2026-09-15 · Mesma metodologia causal para as duas (todos os sinais registrados no banco, liquidação por observação real). Ativo: EUR/NZD OTC.

## Resultado (T+60s, mesma metodologia)

| Métrica | `reversion-v3 + Fibonacci` | `reversion-v6` (banda profunda) |
|---|---|---|
| Sinais EUR/NZD disponíveis | **23** | 130 |
| **Wins / Losses / Draws** | **19 / 4 / 0** | 64 / 66 / 0 (todos: 64W/66L) |
| **WR** | **82,6%** | 49,2% |
| IC95 (Wilson) | **62,9% – 93,0%** | 40,8% – 57,7% |
| T+45s (mesma amostra) | 68,0% (17W/8L/1D, n=26) | 48,9% (64W/67L, n=131) |
| Últimos 100 sinais EUR/NZD | — (só existem 23) | 40,0% (40W/60L) |

## Por que não deu 100 trades de cada no EUR/NZD

- A `v3+fib` é muito mais seletiva: em TODA a gravação de EUR/NZD (desde 17:14Z) existem apenas **23 sinais** válidos dela. Para chegar a 100 é preciso mais stream ao vivo (ou o motor rodando forward).
- A `v6` tem mais sinais (130) porque exige apenas RSI extremo profundo + vol baixa, sem a zona Fibonacci.
- **Não é possível fabricar** os 77 trades restantes da v3+fib — regra de integridade do projeto.

## Contexto importante: número do v6 AO VIVO vs OFFLINE

- **v6 ao vivo (forward real, engine)**: 60 trades EUR/NZD, 34W/17L/1D/8U = **66,7%** — melhores períodos apenas (o engine só cria trades dos finalistas; entre 18:29 e 23:23 o v6 ficou de fora do freeze).
- **v6 offline (TODOS os sinais)**: 49,2% em 130 sinais — inclui o trecho ruim que o engine não operou.
- Moral: o v6 é **sensível ao regime** (melhores janelas ~67%, todas as janelas ~49%); a v3+fib, na mesma janela completa, manteve **82,6%** com amostra menor (23).

## Veredito

1. **`reversion-v3+fib` venceu o comparativo** com folga na mesma metodologia (82,6% vs 49,2%), mas com N=23 vs 130 — a vitória é forte, porém ainda não estatisticamente definitiva para a v3+fib (IC95 inf 62,9% já é robusto, mas a amostra precisa crescer).
2. **Próximo passo único**: quando o stream voltar (e o source do motor for recuperado), implementar `reversion-v3+fib` (BUY-only como política inicial) e rodar os **100 trades forward no EUR/NZD**; a v6 retoma do 60/100.
3. A regra de governança continua: nenhuma promoção sem N≥100 e IC95 inferior > 50%.

## Arquivos

- `exports/research-repro-v3fib/compare-report.json` — todos os cortes.
- `exports/research-repro-v3fib/reversion-v3-fib-t60-eurnzd.csv` e `reversion-v6-t60-eurnzd.csv` — trades individuais com preços.
