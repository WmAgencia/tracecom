# Binários REAIS via MCP da IQ — mercado aberto hoje — primeira coleta e análise — set/2026

**Fonte**: MCPs oficiais da IQ Option, ferramentas read-only (nunca `place_trade`). Foco: **ativos de mercado REAL abertos agora** (não-OTC) — 91 no binary-options, 51 no turbo, 74 no blitz, 67 no digital, todos com payout 89–91%. Coletor: `diagnostic-results/iq_otc_collect.mjs` (filtro `!OTC && is_open`); análise: `iq_otc_analyze.mts`; resultados: `iq-real-analysis.json`.

## 1. Coleta obtida

- **36 séries de binários reais** salvas em `diagnostic-results/data/iq-real/binary-options/` — índices (US 500/2000/30, UK 100, JP 225, DE 40, FR 40), ETFs setoriais (SPDRs, Semiconductor, Russell 2000) e Treasury ETFs.
- Profundidade por série: 1m ≈ **17–118h acumuladas**; 5m ≈ **135–148h** (máximo do MCP: 1000 candles por chamada, sem paginação).
- **Rate limit**: global 60 req/min por token; o servidor entrou em degradação durante a coleta (rejeitando mesmo respeitando `retry_after_ms`) — turbo/blitz/digital e o restante dos 85 ativos abertos ficam para as próximas passadas do coletador (re-executável, append aos CSVs).

## 2. Estrutura estatística dos reais (a diferença central vs OTC)

Agregado das 36 séries: lag1 médio **−0.002**, VR(5) médio **0.988** — mas com **estrutura segmentada** que o OTC não tem:

| Segmento | Comportamento 1m | Exemplos |
|---|---|---|
| Índices europeus/americanos | **mean-reversion** | UK-100 lag1 −0.073 VR 0.83; US-2000 VR 0.815; US-30 VR 0.884 |
| ETFs tech/alavancados | **trending** | Semiconductor VR 1.148; UltraPro Short QQQ 1.105; Technology SPDR 1.094 |

Ou seja: no mercado real há padrão explorável **por classe de ativo** — reversão em índices 1m, momentum em ETFs alavancados de tech. O OTC, em contraste, é random-walk uniforme (VR 0.992).

## 3. Win rates medidos nos binários reais (288 combinações; n≥200; Wilson 95%; in-sample)

| Ativo | TF | Setup | h | n | WR | IC 95% |
|---|---|---|---|---|---|---|
| **UK-100** | 1m | RSI14 | 5 | 241 | **70.1%** | [64.2, 75.5] |
| **UK-100** | 1m | RSI14 | 1 | 244 | 69.3% | [63.3, 74.6] |
| iShares Russell 2000 | 1m | RSI14 | 5 | 597 | **67.0%** | [63.2, 70.6] |
| US 2000 | 1m | Bollinger 2.0 | 5 | 561 | **66.7%** | [62.7, 70.4] |
| US 30 | 1m | RSI14 | 5 | 259 | 66.4% | [60.5, 71.8] |
| Dow Jones ETF | 1m | BB 2.0 | 5 | 507 | 63.1% | [58.9, 67.2] |
| Semiconductor ETF | 1m | RSI14 | 5 | 512 | 62.7% | [58.5, 66.7] |
| S&P 500 ETF | 1m | fade3 | 5 | 1767 | **62.1%** | [59.9, 64.4] |
| iShares Russell 2000 | 1m | fade3 | 5 | 1542 | 60.3% | [57.9, 62.7] |
| Technology SPDR | 1m | fade3 | 5 | 1524 | 59.0% | [56.5, 61.4] |

**Sinais consistentes (não cauda isolada)**: índices 1m com RSI14/BB/fade3 h5 concentram 10+ casos ≥59% com n entre 241 e 1767 — muito acima do esperado por seleção múltipla (288 testes). Com payout de 91%, o breakeven é 52.4% — **todos os IC-lower acima de 57% sobrevivem com folga**, se persistirem OOS.

## 4. Comparação direta (mesmo método, três universos)

| Métrica | OTC IQ (57 séries) | **Binários REAIS IQ (36 séries)** | Proxies (Yahoo/Binance) |
|---|---|---|---|
| lag1 1m médio | −0.003 | −0.002 | −0.14 (FX) |
| VR(5) médio | 0.992 | 0.988 | 0.82–0.91 |
| Estrutura | random-walk uniforme | **segmentada por classe** (índices MR, tech trending) | FX mean-reverting forte |
| Melhor WR (n≥200) | 69.0% (1 caso) | **70.1% e ~10 casos ≥59%** | 69.6% OOS (ETHUSDT 5m) |
| Breakeven (payout 91%) | 52.4% | 52.4% | 52.4% (payout 85→54.1%) |

## 5. Conclusões honestas e próximos passos

1. **O mercado real da IQ tem estrutura que o OTC não tem** — índices 1m mean-reverting sustentam os setups de reversão do repo com WR medido 60–70%.
2. **Faltam dados para afirmar validade OOS**: 148h máximas por série. Coletador re-executável acumula profundidade; turbo/blitz/digital ainda não coletados (rate limit degradou o servidor no fim da sessão).
3. **Candidatos a forward paper imediato** (mesma régua do forward Binance): UK-100 1m RSI14 h5/h1, Russell 2000 1m RSI14/BB h5, S&P 500 ETF 1m fade3 h5.
4. Nenhuma ordem real ou PRACTICE foi colocada — tudo leitura.
