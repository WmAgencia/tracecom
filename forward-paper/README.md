# TRACECON — Validação prospectiva PAPER (ETHUSDT 5m Bollinger ±2σ)

**Status: EXPERIMENTOS EM COLETA — NADA APROVADO.** O resultado histórico (WR OOS 69,6% [64.1, 74.5], n=289) **não aprova** a estratégia; aprovação exige os critérios da §4 sobre dados prospectivos novos.

## 1. Congelamento (pré-registro)

| Experimento | Arquivo | Horizonte real | Ledger |
|---|---|---|---|
| **H5** | `forward-paper/params-h5.json` | **25 minutos** (5 candles 5m) | `forward-paper/signals/TRACECON-WF-ETHUSDT-5M-BB20-H5.jsonl` |
| **H1** (distinto) | `forward-paper/params-h1.json` | **5 minutos** (1 candle) | `...-H1.jsonl` |

- Regra congelada: no close de cada candle 5m fechado, SMA20 e **desvio-padrão populacional** das últimas 20 closes; close > média+2σ → **DOWN**; close < média−2σ → **UP**; dentro das bandas → nada; sem filtros.
- Hash da fonte histórica: `walk_forward_real.mts` sha256-prefixo `95ae42577f7e721b`.
- **H5 ≠ expiração de 300s do Binary V3** — experimentos independentes; Binary V3, OTC Lab e Crypto V1 não foram tocados.
- Qualquer mudança de parâmetro exige novo `strategy_id` e novo ledger (nunca editar os existentes).

## 2. Pipeline de coleta (read-only, sem ordens)

`npx tsx forward-paper/runner.mts` (deixá-lo rodando; log em `forward-paper/logs/runner.log`):

- Feed real: WebSocket público Binance `ethusdt@kline_5m` + `ethusdt@bookTicker` com timestamps `E` do exchange.
- **Entrada executável pós-sinal**: UP paga o **ask**, DOWN vende no **bid** do primeiro bookTicker após o boundary; bid/ask e timestamp do book ficam no registro.
- **Slippage documentado** por trade (`slippage_bps` vs close do sinal).
- **Custos**: taxa taker 0,1% por perna nas duas pernas.
- **Liquidação**: H5 no close do 5º candle seguinte (25 min); H1 no close do 1º (5 min).
- **Histórico imutável**: ledgers JSONL com **hash-chain** (sha256 encadeado; `evaluate.mts` verifica).
- **Sobreposições**: cada trade registra `overlapping_same_direction` (trades abertos no mesmo sentido no momento do sinal).
- Sinais e liquidações só são gravados quando os respectivos candles fecham no exchange (nenhum dado simulado).

## 3. Métricas prospectivas (`npx tsx forward-paper/evaluate.mts`)

- **Amostra efetiva (ESS)**: ajustada por sobreposição (`1/(1+overlap)` por trade) — trades sobrepostos não contam como independentes.
- **WR** com **IC 95% por block bootstrap** (bloco de 12 candles = 1h), respeitando a dependência temporal.
- **EV líquido/trade**: binário (payout 0,85, custos 2×0,1%) e spot; **baseline aleatório** com o mesmo custo (≈ −10,2% por trade em EV binário).
- **Drawdown máximo** da curva de EV acumulado; **slippage médio**; **cobertura** (sinais emitidos por tempo de coleta).

## 4. Regra de aprovação (pré-registrada; não negociável retroativamente)

Aprovado **somente se**, numa amostra prospectiva com **ESS ≥ 100**: limite inferior do IC bootstrap de WR > **55,8%** (breakeven payout 85%) **e** EV binário líquido > 0 **e** EV spot líquido > 0. Qualquer combinação que falhe → não aprovado, sem re-teste com parâmetros alterados no mesmo ledger.

## 5. Separações obrigatórias respeitadas

- **Estudo histórico intacto**: `walk-forward-real-results.json` e `docs/analytics/*` intocados.
- **OTC Lab / Binary V3 / Crypto V1**: nenhum arquivo alterado.
- **Coleta OTC prospectiva**: projeto independente (ponte read-only IQ); **nenhum dado Yahoo/Binance entra nela**.
- **USD/CAD 1m: banido** de qualquer experimento até a auditoria do artefato de quantização concluir.
- **Nenhuma ordem real ou PRACTICE** — o runner não contém chamada de ordem; é fisicamente read-only.

## 6. Estado atual

Runner conectado ao feed da Binance; ledgers vazios (correto — sinais só quando as bandas ±2σ são tocadas, o que historicamente acontece algumas vezes por dia). Rode `npx tsx forward-paper/evaluate.mts` a qualquer momento; a amostra precisa de **≥ 100 ESS** (estimativa: ~4–8 semanas de coleta contínua) antes que qualquer veredito prospectivo seja possível.
