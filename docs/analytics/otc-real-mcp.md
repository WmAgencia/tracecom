# OTC REAL via MCP da IQ Option — primeira coleta e análise — set/2026

**Fonte**: servidores MCP oficiais da IQ Option (streamable-http, Bearer fornecido pelo usuário) — ferramentas read-only apenas (`get_capabilities`, `list_assets`, `get_candles`). **Nenhuma ordem** (`place_trade`/`place_market_order` jamais chamados). Coletor: `diagnostic-results/iq_otc_collect.mjs`; análise: `iq_otc_analyze.mts`; resultados: `iq-otc-analysis.json`.

## 1. O que foi coletado

**99 séries, ~101.000 candles** em `diagnostic-results/data/iq-otc/` + `MANIFEST-OTC.json`:

| Servidor | Séries | Conteúdo |
|---|---|---|
| binary-options | 33 | 57 OTCs listados (limitado pelo rate limit global) |
| marginal-cfd | 40 | ações/índices/commodities reais (CFD) |
| turbo-options | 24 | OTCs (cripto e FX) |
| marginal-crypto | 2 | perp futures |

- **Profundidade real obtida**: `get_candles` entrega **máximo 1000 candles por chamada e sem paginação para o passado** (sem parâmetro de data inicial). Resultado: 1m ≈ **16,8h** de histórico; 5m ≈ **83,6h** (3,5 dias); CFDs 60s até ~75h. **Este é o teto do MCP** — não existe histórico de meses/anos acessível.
- Rate limit **global de 60 req/min por token** (compartilhado entre os 7 servidores); coleta completa dos ~57 OTCs × 2 timeframes nos 4 servidores de opções exige múltiplas passadas (~10 min cada) — o coletador já respeita `retry_after_ms` e é reexecutável (append aos CSVs).
- Todos os 57 ativos OTC são **24/7 abertos** (`is_open: true`), payout típico 90%.

## 2. Estrutura estatística dos OTCs (a resposta central)

Agregado das 57 séries OTC: **lag1 médio = −0.003** (31/57 negativas); **VR(5) médio = 0.992** (16 séries mean-reversion, 10 trending, resto random-walk). **Os OTCs da IQ são, em agregado, um random-walk quase perfeito** — não há a reversão à média sistemática que existe no FX real 1m (EUR/USD lag1 −0.14, USD/CAD VR 0.36). Em outras palavras: **os padrões descobertos nos proxies NÃO transferem para o OTC da IQ.** Isto valida a suspeita inicial: o feed OTC é sintético e se comporta diferente do subjacente real.

## 3. Win rates medidos nos OTCs (784 combinações série×setup×horizonte)

Top resultados com n ≥ 200 (in-sample exploratório; `minMovePct=0`, excl. flat; Wilson 95%):

| Ativo OTC | TF | Setup | h | n | WR | IC 95% |
|---|---|---|---|---|---|---|
| USD/ZAR | 1m | RSI14 | 5 | 342 | **69.0%** | [64.0, 73.6] |
| USD/INR | 5m | RSI14 | 5 | 370 | 64.9% | [59.9, 69.5] |
| SHIB/USD | 5m | Bollinger 2.0 | 5 | 601 | 64.6% | [60.7, 68.3] |
| Ripple | 5m | RSI14 / BB | 5 | 328/648 | 62.8% / 61.6% | [57.5–65.2] |
| USD/SGD | 5m | RSI14 | 5 | 547 | 62.7% | [58.6, 66.6] |
| Jupiter | 1m | BB 2.0 | 5 | 470 | 60.6% | [56.2, 64.9] |

Agregado geral: **bb2 h5 5m = 52.6%** (n=11.289); fade1 ≈ 50%; fade3 5m 5m = 51.4%; rsi14 h5 5m = 49.7%. Ou seja: a média é ~50% e os casos ≥60–69% são **cauda da seleção múltipla** (784 testes → espera-se ~5% acima de ~53% por puro acaso; 20+ casos ≥58% é acima do esperado por sorte, mas os ICs são in-sample).

## 4. Comparação OTC real vs proxies (Yahoo/Binance)

| Métrica | FX real 1m | Cripto real 1m/5m | **OTC IQ (agregado)** |
|---|---|---|---|
| lag1 | −0.14 (EUR/USD) | ~0 | **−0.003** |
| VR(5) | 0.82–0.91 | ~1.0 | **0.992** |
| Melhor WR simples | ~60% (espelho momentum) | 58.5% (rsi30) | 50–53% agregado; cauda 60–69% |
| Mean-reversion dominante? | **Sim** | Fraca | **Não** |

## 5. Conclusões honestas

1. **O MCP da IQ funciona e a coleta está instrumentada** — mas o histórico acessível é curto (≈3,5 dias em 5m; 16,8h em 1m por chamada, acumulável por re-execuções futuras do coletador).
2. **OTC ≈ random-walk**: sem a estrutura mean-reverting do FX real. As estratégias validadas nos proxies (ETHUSDT 5m BB 69.6% OOS etc.) não são válidas para OTC da IQ.
3. Os WRs ≥60% vistos em ativos OTC específicos (USD/ZAR 69%, SHIB 64.6%) precisam de validação OOS/forward antes de qualquer uso — múltiplas comparações e in-sample.
4. **Caminho prático**: re-executar o coletador periodicamente acumula profundidade real (CSV append) — em 2–4 semanas teríamos OTC 1m/5m suficiente para walk-forward como o feito nos proxies, agora com dados da própria casa.
5. O forward paper da Binance (ETHUSDT 5m) segue independente e intocado.
