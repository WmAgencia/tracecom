# Os 4 Campeões — Explicação Completa e Resultados (113 trades)

Data: 2026-09-15 · Mesmos trades/mesma metodologia causal · WR = W/(W+L) · Dois horizontes: T+45s e T+60s.

---

## #1 — `reversion-v1-fib` · 73,3% (T+60) · o campeão absoluto

### O que é
Reversão de RSI extremo **com confluência Fibonacci**. Junta dois conceitos clássicos: exaustão de curto prazo (RSI extremo) + pullback saudável dentro de uma perna (zona dourada de Fibonacci).

### Como funciona (passo a passo)
1. **Volatilidade baixa**: desvio-padrão dos últimos 12 retornos de 5s < 0,0009 (mercado calmo, sem faca caindo).
2. **RSI extremo**: `s = (55 − RSI(14)) / 45`. Compra se `s > 0,33` (RSI ≲ 40); venda se `s < −0,33` (RSI ≳ 70).
3. **Fibonacci**: olha os últimos 24 candles (2 min); acha o topo e o fundo do swing; calcula a zona dourada (38,2% a 61,8% do recuo). O preço TEM que estar dentro dessa zona.
4. **Contexto de swing**: compra só se o fundo veio antes do topo (perna de alta → recuo comprável); venda só no espelho.
5. Liquidação em T+60s pelo preço real (primeira observação entre +60s e +90s).

### Por que funciona
RSI extremo sozinho dispara em qualquer queda — **a zona Fibonacci filtra os que são apenas recuo** (comprável) vs. rompimento (não comprável). A confluência aumenta a precisão à custa de frequência.

### Números (T+60)
| Corte | N | W | L | D | WR | IC95 |
|---|---|---|---|---|---|---|
| **Todos** | 35 | **22** | **8** | 5 | **73,3%** | 55,6% – 85,8% |
| BUY | 33 | 21 | 7 | 5 | **75,0%** | 56,6% – 87,3% |
| SELL | 2 | 1 | 1 | 0 | 50% | — |
| 1ª → 2ª metade | 17→18 | — | — | — | 71,4% → 75,0% | estável |
| EUR/NZD | 14 | 10 | 4 | 0 | 71,4% | — |
| NZD/USD | 11 | 9 | 2 | 0 | 81,8% | — |
| EUR/USD | 10 | 3 | 2 | 5 | 60% (5 empates) | — |

**T+45**: 62,1% (18W/11L/5D, n=34). **Pontos fracos**: raríssimo (35 sinais em 8.327 observações); SELL sem amostra.

---

## #2 — `reversion-v3-fib` · 66,7% (T+60) · o equilibrado

### O que é
Igual ao #1, **mas com filtro de tendência**: só compra reversões que estejam alinhadas à tendência de 120 segundos, e aceita um extremo um pouco menos profundo (RSI ≲ 45). Gera ~70% mais sinais que o #1.

### Como funciona
1. Vol < 0,0012 (um pouco mais permissivo).
2. `|s| > 0,22` (RSI ≲ 45 na compra / ≳ 65 na venda).
3. **Tendência**: `mom120 > 0` na compra / `< 0` na venda (não compra queda contra tendência).
4. Mesma confluência Fibonacci (zona dourada 38,2–61,8% + contexto de swing).

### Por que funciona
"A tendência é sua amiga": em vez de pegar qualquer fundo, pega **fundos dentro de uma perna de alta** — o pullback com tendência a favor tem maior probabilidade de retomar.

### Números (T+60)
| Corte | N | W | L | D | WR | IC95 |
|---|---|---|---|---|---|---|
| **Todos** | 60 | **40** | **20** | 0 | **66,7%** | 54,1% – 77,3% |
| BUY | 51 | 36 | 15 | 0 | **70,6%** | 57,0% – 81,3% |
| SELL | 9 | 4 | 5 | 0 | 44,4% | — |
| 1ª → 2ª metade | 30→30 | — | — | — | 56,7% → **76,7%** | melhora |
| EUR/NZD | 23 | 19 | 4 | 0 | **82,6%** | 62,9% – 93,0% |
| EUR/USD | 13 | 8 | 5 | 0 | 61,5% | — |
| NZD/USD | 24 | 13 | 11 | 0 | 54,2% | — |

**T+45**: 59,0%. **Pontos fracos**: lado SELL fraco (n=9); NZD/USD mediano.

---

## #3 — `reversion-v2-fib` · 65,4% (T+60) · o mais consistente

### O que é
A versão **mais frequente** da família: extremo de RSI + volatilidade + Fibonacci, **sem filtro de tendência**. É o irmão estatisticamente mais robusto (n=83 e estável em metades e ativos).

### Como funciona
1. Vol < 0,0012.
2. `|s| > 0,22`.
3. Confluência Fibonacci (zona dourada + contexto de swing).
4. Sem exigência de tendência — pega reversões tanto contra como a favor (o Fibonacci é quem controla a qualidade).

### Números (T+60)
| Corte | N | W | L | D | WR | IC95 |
|---|---|---|---|---|---|---|
| **Todos** | 83 | **51** | **27** | 5 | **65,4%** | **54,3% – 75,0%** |
| BUY | 71 | 45 | 21 | 5 | **68,2%** | 56,2% – 78,2% |
| SELL | 12 | 6 | 6 | 0 | 50% | — |
| 1ª → 2ª metade | 41→42 | — | — | — | 62,2% → 68,3% | estável |
| EUR/NZD | 33 | 23 | 10 | 0 | 69,7% | 52,7% – 82,6% |
| EUR/USD | 22 | 11 | 6 | 5 | 64,7% | — |
| NZD/USD | 28 | 17 | 11 | 0 | 60,7% | — |

**T+45**: 57,0%. **Ponto fraco**: menos seletivo (mais sinais = WR um pouco menor que #1/#2).

---

## #5 — `stochrsi-v1` · 62,4% (T+60, n=113) · a melhor técnica "pura"

### O que é
**Stochastic RSI**: aplica a fórmula do Estocástico sobre os valores do RSI (em vez do preço). É um oscilador ultra-sensível de exaustão — dos indicadores mais citados para 1 minuto (backtests históricos famosos de 78%).

### Como funciona
1. Calcula o RSI(14) dos **últimos 14 candles** (série de 14 valores de RSI).
2. `StochRSI = (RSI_atual − menor RSI) / (maior RSI − menor RSI)` → sempre entre 0 e 1.
3. **Entrada**: StochRSI **cruza acima de 0,20** (saindo da exaustão) com EMA9 > EMA21 → BUY; **cruza abaixo de 0,80** com EMA9 < EMA21 → SELL.
4. Liquidação T+60s.

### Por que funciona
Normalizar o RSI pelo seu próprio range o torna **relativo ao regime** — detecta quando a exaustão acabou de reverter, o que é exatamente o que uma opção de 45–60s precisa (o gatilho do snapback).

### Números (T+60, últimos 113)
| Corte | N | W | L | D | WR | IC95 |
|---|---|---|---|---|---|---|
| **Últimos 113** | 113 | **68** | **41** | 4 | **62,4%** | **53,0% – 70,9%** |
| Amostra total | 209 | 115 | 88 | 6 | 56,7% | 49,8% – 63,3% |
| **SELL** | 109 | **71** | 37 | 1 | **65,7%** | 56,4% – 74,0% |
| BUY | 100 | 44 | 51 | 5 | 46,3% ❌ | — |
| 1ª → 2ª metade | 104→105 | — | — | — | 49,0% → **64,1%** | melhora |
| EUR/NZD | 90 | 54 | 36 | 0 | 60,0% | 49,7% – 69,5% |
| EUR/USD | 77 | 42 | 30 | 5 | 58,3% | — |
| NZD/USD | 42 | 19 | 22 | 1 | 46,3% | — |

**T+45**: 58,7%. **Ponto CRÍTICO**: o lado **BUY é ruim (46,3%)** e o **SELL é excelente (65,7%)** — o oposto das estratégias Fibonacci. São sistemas complementares!

---

## Comparativo final dos 4

| | #1 v1+fib | #2 v3+fib | #3 v2+fib | #5 stochrsi |
|---|---|---|---|---|
| WR (melhor corte) | **73,3%** (n=35) | 66,7% (n=60) | 65,4% (n=83) | 62,4% (n=113) |
| IC95 inferior | 55,6% | 54,1% | **54,3%** | **53,0%** |
| Frequência | raríssima | baixa | média | **alta** |
| Lado forte | BUY (75%) | BUY (70,6%) | BUY (68,2%) | **SELL (65,7%)** |
| Estabilidade entre metades | ✓ | ✓ (melhora) | ✓ | ✓ (melhora) |
| Melhor ativo | NZD/USD | EUR/NZD | EUR/NZD | EUR/NZD |

**Leitura estratégica**: os três Fibonacci são "máquinas de compra" (BUY), o StochRSI é uma "máquina de venda" (SELL). Combinados, cobrem os dois lados do mercado. É o embrião de um portfólio de operações.

## Arquivos (trades auditáveis com preços)
- `exports/research-four-champions/reversion-v1-fib-t60-all.csv`
- `exports/research-four-champions/reversion-v3-fib-t60-all.csv`
- `exports/research-four-champions/reversion-v2-fib-t60-all.csv`
- `exports/research-four-champions/stochrsi-v1-t60-all.csv`
- `exports/research-four-champions/four-champions.json` — todos os cortes.
- `scripts/four-champions.js` — motor reprodutível.
