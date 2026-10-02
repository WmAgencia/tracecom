# Padrões nos subjacentes dos OTC (proxy não-OTC) — set/2026

**Rótulo obrigatório**: tudo abaixo foi medido sobre **subjacentes reais** (Yahoo Forex, Binance cripto) de `diagnostic-results/data/` — **não é o feed OTC da IQ Option**. A sonda do MCP "Iq Option" (`WPMPEwG_E8iHtgzS2P__gRBI-dDNhSNccZmjvlVj` como bearer/token em `/api/mcp/servers` e rotas análogas, 3 estilos de header) retornou **401 em todas as 9 combinações** — questão MCP encerrada como inacessível por este agente. Reprodutível com `npx tsx diagnostic-results/otc_proxy_pattern_analysis.mts`; resultados brutos em `diagnostic-results/otc-proxy-pattern-analysis.json` e `.csv`.

## 1. Volatilidade por sessão (anualizada, UTC; Ásia 0–8h, Londres 7–16h, NY 12–21h com precedência Londres no overlap)

- **Londres é a sessão mais volátil em 18/18 séries** (ex.: EUR/USD 1h: Ásia 4.87% → Londres 6.87% → NY 5.92%; GBP/USD 1h: 5.32% → 8.23% → 6.29%; BTCUSDT 1m: 23.6% → 35.4% → 30.4%).
- Cripto ~4–6× a vol do FX (BTC 1h ~33–42% vs EUR/USD 1h ~5–7%).
- Implicação para binárias 1m/5m: janelas Londres têm movimentos maiores → mais chance de ultrapassar threshold de payout, mas também mais ruído.

## 2. Autocorrelação e mean-reversion vs trending (lag 1–5, Ljung-Box ~, VR(5))

- **FX 1m é onde a estrutura aparece**: EUR/USD lag1 = **−0.142** (VR5 0.82), USD/CAD lag1 = **−0.351** (VR5 0.358!), USD/JPY lag1 = −0.052 (VR5 0.909) → **mean-reversion forte em 1m**. NZD/USD 1m: VR5 1.09 → trending.
- Em **1h** quase tudo é random-walk (|lag1| ≤ 0.04; VR5 0.9–1.02), com mean-reversion fraca em AUD/USD, GBP/USD, USD/CAD, NZD/USD.
- Cripto 1m/1h: praticamente random-walk (lag1 ≤ 0.024).
- **Atenção**: o USD/CAD 1m do Yahoo é a série mais suspeita (lag1 −0.35 é sintoma clássico dedados de baixa qualidade/tick esparsos); tratar como artefato até validar contra outra fonte.

## 2b. 5m (reamostrado dos 1m — sem coleta nova)

5m **não existe nativamente nos CSVs**; foi derivado por agregação OHLC 1m→5m (buckets alinhados, buckets com <3 candles descartados). **Limitação de amostra: ~7 dias úteis de 1m → ~1.415 candles 5m por ativo FX** (cripto: ~8.640). Tratar como indicação, não conclusão.

**ACF/VR(5) em 5m** (lag1, VR5):
- FX: mean-reversion em EUR/USD (−0.014, 0.874), GBP/USD (−0.027, **0.797**), NZD/USD (−0.045, 0.871), USD/JPY (VR 0.847); AUD/USD misto (lag5 −0.126, VR 1.069); USD/CAD novamente artifício (lag1 −0.244, VR 0.555).
- Padrão consistente com 1m: reversão à média é a estrutura dominante do FX intradiário, mais forte em GBP/USD.

**Win rates 5m agregados (Wilson 95%)**:

| Grupo | Setup | h | n | WR | IC 95% |
|---|---|---|---|---|---|
| forex | momentum | 1 | 7.627 | 44.3% | [43.2, 45.4] |
| forex | momentum | 5 | 7.600 | 46.5% | [45.3, 47.6] |
| forex | reversal3 | 5 | 1.508 | **54.4%** | [51.9, 56.9] |
| forex | rsi70 | 5 | 196 | 59.7% | [52.8, 66.2] ⚠ n baixo |
| cripto | momentum | 1/5 | ~17.2k | 48.8% | [48.1, 49.6] |
| cripto | reversal3 | 5 | 4.046 | 53.4% | [51.9, 54.9] |
| cripto | rsi70 | 5 | 618 | **60.4%** | [56.5, 64.1] |
| cripto | rsi30 | 5 | 555 | 56.6% | [52.4, 60.6] |

- Confirma em 5m o padrão de 1m: **momentum é anti-padrão em FX** (44–47%) e reversão/RSI-extremo ficam na faixa 53–60% (com n pequeno nos extremos RSI).
- Similaridade 5m: mesma ressalva de drift — USD/CAD 66–68% espelha o baseline do período (mesmo artefato do dado); BTC/ETH ~50% = sem edge.

## 3. Win rates medidos — setups binários (minMovePct=0, excl. flat; Wilson 95%)

Agregado por grupo (todas as linhas por ativo somadas). Full por ativo no JSON.

| Grupo | TF | Setup | h | n | WR | IC 95% |
|---|---|---|---|---|---|---|
| forex | 1m | momentum | 1 | 34.796 | **39.7%** | [39.2, 40.3] |
| forex | 1m | momentum | 5 | 34.774 | 44.0% | [43.5, 44.5] |
| forex | 1m | reversal3 | 1 | 5.860 | 48.4% | [47.1, 49.6] |
| forex | 1m | reversal3 | 5 | 5.852 | 49.9% | [48.7, 51.2] |
| forex | 1h | momentum | 1 | 41.516 | 47.5% | [47.1, 48.0] |
| forex | 1h | reversal3 | 1 | 9.218 | 51.3% | [50.3, 52.3] |
| forex | 1h | rsi30 | 5 | 2.202 | 52.3% | [50.2, 54.4] |
| cripto | 1h | reversal3 | 1/5 | ~3.870 | **54.5–54.8%** | [53.3, 56.1] |
| cripto | 1h | rsi30 | 5 | 954 | **58.5%** | [55.3, 61.6] |
| cripto | 1m | rsi30/rsi70 | 5 | ~3.8–4.2k | 53.3–53.6% | [51.7, 55.1] |
| cripto | 1m | momentum | 1/5 | ~83.4k | 49.2% | [48.9, 49.5] |

- **Momentum 1m em FX é o anti-padrão mais claro** (WR 39.7% h1 → significa que o oposto — reverter o último candle de 1m — teria WR ~60%); consistente com a ACF negativa da §2.
- **Nenhum setup simples atinge 60% com IC confortável exceto o espelho do momentum FX 1m**; rsi30 em cripto 1h chega a 58.5% mas com n=954 e IC largo.
- **Referência de payout**: com payout típico de 70–85%, o breakeven é 54–59% de WR. Só os melhores pontos acima chegam perto — e são in-sample, sem custo, sem spread.

## 4. Backtest de similaridade (DEFAULT_CRITERIA, threshold 0.85, direção "up", h=12, minMovePct 0.05)

| Ativo | TF | WR | IC 95% | baseline "up" h12 |
|---|---|---|---|---|
| USD/JPY | 1h | **58.2%** | [56.8, 59.6] | 58.5% |
| USD/CHF | 1h | 55.5% | [54.2, 56.9] | 55.6% |
| USD/CAD | 1h | 54.9% | [53.4, 56.4] | 54.5% |
| EUR/USD | 1h | 46.4% | [44.9, 47.9] | 46.2% |
| BTCUSDT | 1h | 50.7% | [49.6, 51.8] | 50.5% |

- **Conclusão honesta**: as WRs de similaridade acompanham o baseline direcional do período (drift), **não demonstram edge além dele**. Reforça o achado do SPIKE_REPORT_V2: o motor de similaridade não adiciona poder preditivo sobre o baseline.
- Base up h12 > 50% em USD/JPY/USD/CHF/USD/CAD é drift do período (janela de 1 ano, dólar fraco), não padrão replicável.

## 5. O que mudaria com dados OTC autênticos

1. **Tudo acima pode não transferir**: o feed OTC da IQ é sintético controlado pela casa (o próprio repo trata `-OTC` como identidade distinta). A ACF negativa de 1m no FX real é o análogo mais próximo, mas o OTC pode ter microestrutura própria (requotes, spreads assimétricos, pilotagem da casa).
2. **Precisaríamos medir**: ACF/VR nos próprios candles OTC; WR dos mesmos setups por ativo OTC; payout real por ativo/hora (que muda o breakeven); e taxa de "flat" no OTC (define quantos sinais morrem no threshold).
3. **Caminho de coleta** (já suportado pelo repo): extensão read-only + `MARKET_DATA_MODE=iqoption` → `POST /api/iq-option/ingest`; o MCP está inacessível (401 na sonda).
4. **Regra de decisão**: só considerar operar um setup OTC quando WR OOS (Wilson lower) > breakeven do payout com folga ≥ 3 p.p. e n ≥ 500 — hoje isso não existe nem no proxy.

## 6. Metodologia / limitações

- Setups avaliados com `evaluateOutcome` do repo (close-to-close, excl. flat); IC Wilson 95% (`wilsonInterval`); ACF/Ljung-Box/VR calculados offline sobre retornos log.
- Janela FX 1m = 7 dias apenas (limite Yahoo); AUD/NZD 1m degradados (2min) — pesos menores no agregado FX 1m; 5m derivado desses mesmos 1m herda as limitações (~1.415 candles/ativo FX).
- Sem spread/custo: WR bruta superestima qualquer edge real. In-sample por construção (exploratório).
- Nenhuma ordem aberta; nenhum dado novo coletado; somente leitura dos CSVs da sessão anterior.
