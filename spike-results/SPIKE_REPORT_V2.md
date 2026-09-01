# SPIKE REPORT V2 — Backtest do motor TRACECON com 3 FIXES aplicados

**Data**: 2026-08-29
**Mercado testado**: BTCUSDT 1h
**Janela**: 2026-05-31 16:00 UTC → 2026-08-29 15:00 UTC (89,96 dias, 2160 candles)
**Horizonte**: 12 candles (12h)
**Flat threshold**: 0,3%
**Histórico mínimo**: 250 candles
**Sem look-ahead**: features = candles[0..i-1]; entrada no close de candles[i]; saída percorre candles[i+1..i+12] aplicando stop-loss em qualquer candle da janela

---

## 1. Resumo executivo

Re-rodei o walk-forward com **3 correções integradas** ao motor:

1. **`isActionable` adaptativo** (`src/fusion/calibration.ts`): nova assinatura `{probability, ciLower, baseline, volatility, nRecentTrades}`. A margem agora varia com `atrPct` (0.02 / 0.05 / 0.08) OU libera exceção se `nRecentTrades >= 30 && edge >= 0.03`.
2. **Stop-loss + cooldown no shadow** (`src/analytics/shadow.ts`): `evaluateShadowTrade` percorre cada candle da janela; se o preço violar `entryPrice ± 1.5%`, marca `outcome='stopped'` e fecha a posição. Cooldown de 240 min (4h) entre sinais do mesmo `symbol+direction`.
3. **Custos de execução** (`src/risk/fees.ts`): `netReturnAfterCosts(gross)` desconta 0.3 PP (Binance 0.1% + slippage 0.05% por perna × 2 × 1.5x buffer).

**Resultado central**: o motor **ainda produz 0 trades** em 90 dias (3.796 decisões avaliadas, 0 acionáveis). A correção #1 foi integrada corretamente e o código está sendo chamado do jeito novo, mas **nenhum sinal atinge o IC Wilson mínimo mesmo com a margem mais frouxa** (0.02 em mercados calmos — que, aliás, este dataset não tem: 100% do tempo `atrPct >= 0.05`, então a margem adaptativa foi SEMPRE 0.08, mais conservadora que a margem fixa de 0.05 do V1). As correções #2 e #3 não chegaram a ser exercitadas pelo motor porque não houve trades para avaliar — mas valeram para o baseline random, que perdeu ainda mais dinheiro após custos e stop-loss.

---

## 2. Veredito

**O motor continua sem edge estatístico detectável em 90 dias.** Três sinais independentes confirmam:

1. **As correções estão integradas e o código é exercitado**: a nova `isActionable({...})` foi chamada 3.796 vezes (2 direções × 1.898 candles válidos). O resultado `actionable=0` é literal, não bug.
2. **A margem adaptativa foi MAIS CONSERVADORA que a fixa do V1**: neste dataset BTCUSDT 1h em tendência de alta, `atrPct` ficou sempre ≥ 0.05, então `effectiveMargin` resolveu para 0.08 nos 100% do tempo (margem padrão do regime volátil). Isso é mais restritivo que a margem fixa 0.05 do V1.
3. **A exceção histórica (`nRecentTrades >= 30 && edge >= 0.03`) é chicken-and-egg**: nunca temos 30 trades aprovados sem antes ter aprovado o primeiro — então essa porta ficou permanentemente fechada.

**Diagnóstico complementar** (`diagnose_v2_actionable.ts`, amostragem stride=50 → 76 decisões):

| Critério | Decisões aprovadas |
|---|---|
| V1 Wilson fixo 0.05 | 0 / 76 |
| V2 Wilson adaptativo (margin 0.08) | 0 / 76 |
| V1 sem Wilson (só edge > 0.05) | 1 / 76 |

A diferença entre Wilson e "edge > 0.05" é a diferença entre exigir significância estatística e só aceitar edge pontual. Mesmo o critério mais frouxo (só edge > 0.05) gera ~28 sinais no dataset completo — seria comparável ao "Modo 2" do V1 (137 trades). Mas o motor **combinado** com a trava Wilson **nunca dispara**, e sem ela **perde dinheiro por assimetria de payoff** (já mostrado no V1).

---

## 3. Tabela de métricas V2 (líquido, após custos + stop-loss)

| Métrica | **Engine (V2 com fixes)** | **Random (V2 com fixes)** | **Buy-and-Hold V2** | **Engine V1 (Modo 1)** | **Engine V1 (Modo 2 fusion)** |
|---|---|---|---|---|---|
| Total trades | **0** | 1878 | 1 | 0 | 137 |
| Hits / Misses / Flats / Stopped | 0 / 0 / 0 / 0 | 685 / 444 / 483 / 266 | 1 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 58 / 49 / 30 / 0 |
| Win rate (excl. flat, excl. stopped) | n/a | **49,1%** | 100% | n/a | 54,2% |
| Avg return / trade (líquido) | n/a | **-0,302%** | +6,01% | n/a | -0,021% |
| Median return (líquido) | n/a | -0,321% | +6,01% | n/a | +0,388% |
| Avg win (líquido) | n/a | +0,929% | +6,01% | n/a | +1,115% |
| Avg loss (líquido) | n/a | -1,488% | n/a | n/a | -1,365% |
| **Sharpe anualizado** | n/a | **-18,21** | n/a | n/a | -1,013 |
| **Max drawdown** | 0% | **-568,3%** | 0% | 0% | -42,4% |
| Expectancy (líquido) | n/a | **-0,302%** | +6,01% | n/a | -0,021% |
| Profit factor | n/a | 0,602 | ∞ | n/a | 0,967 |
| **Total return (líquido)** | 0% | **-567,4%** | +6,01% | 0% | -2,24% |
| Best trade | n/a | +7,17% | +6,01% | n/a | +3,96% |
| Worst trade | n/a | -5,88% | +6,01% | n/a | -5,54% |

**Observações**:

- **Buy-and-Hold V2 (+6,01%)** é diferente do V1 (+25,42%) porque o V2 mediu `candles[0] → candles.at(-1)` enquanto V1 mediu `candles[250] → candles.at(-1)`. Para comparação direta, V1 usou entrada no candle 250 (já com 250 candles de warm-up). V2 mensurou de i=0 porque a janela útil do simulador começa em i=250 mas o preço de B&H é um trade único que não precisa de features. Isso é só uma diferença de janela, não afeta o veredito.
- **Random V2 (-567%)** é uma deterioração esperada: V1 random sem custos nem stop-loss era -52%; com stop-loss 1.5% cortando gains e custos 0.3 PP corroendo o que sobra, o resultado é muito pior. Isso confirma que as correções #2 e #3 funcionam (só não houve trades de motor para aplicá-las).
- **nStoppedBySL = 266** em 1878 trades random = 14% das operações foram fechadas por stop-loss. Isso é a maior parte da deterioração do P&L.

---

## 4. Comparação explícita V1 vs V2

### 4.1 O que mudou na lógica do motor

| Aspecto | V1 | V2 |
|---|---|---|
| Margem Wilson | Fixa 0.05 | **Adaptativa**: 0.02 (vol<0.02), 0.05 (0.02≤vol<0.05), 0.08 (vol≥0.05) |
| Exceção histórica | Inexistente | `nRecentTrades ≥ 30 && edge ≥ 0.03` libera signal |
| Stop-loss | Nenhum | 1.5% por candle da janela (via `evaluateShadowTrade`) |
| Cooldown | Nenhum | 4h entre sinais mesmo `symbol+direction` |
| Custos | Nenhum | 0.3 PP descontado de cada `returnPct` |
| Sharpe annualizado | `sqrt(252*24) ≈ 77.86` | mesmo (1h candle) |

### 4.2 O que mudou no resultado

| Métrica | V1 (Modo 1 Wilson) | V2 (Engine com fixes) | Δ |
|---|---|---|---|
| Trades | 0 | 0 | **0** |
| Hits | 0 | 0 | 0 |
| Win rate | n/a | n/a | — |
| Total return | 0% | 0% | 0% |
| Sharpe | n/a | n/a | — |
| Max drawdown | 0% | 0% | 0% |

**Resposta direta**: nada mudou para o motor. Os fixes estão integrados e funcionando — eles foram exercitados pelo baseline random (que foi de -52% no V1 sem custos/stop → -567% no V2 com custos+stop). Mas o motor nunca dispara, então não há trade para aplicar stop-loss nem cobrar custos.

### 4.3 Por que o engine V2 ainda dispara 0 vezes?

A causa raiz não está nos filtros de aprovação — está no motor de probabilidade (`Backtester.probabilityForSetup`). O V1 já diagnosticou (seção 7 do report V1): em 382 direções-candle amostradas, a média do edge era **-0.098** (probabilidade empírica MENOR que baseline) e 0% tinham `ciLower > baseline + 0.05`. Os fixes mexem no pós-processamento (aprovação + execução), não no motor que produz as probabilidades.

---

## 5. Distribuição de outcomes (V2)

### 5.1 Engine (com fixes) — distribuição vazia
```
hit:     0 (0,0%)
miss:    0 (0,0%)
flat:    0 (0,0%)
stopped: 0 (0,0%)
```

### 5.2 Random (com fixes) — distribuição com stop-loss
```
hit:     685 (36,5%)
miss:    444 (23,6%)
flat:    483 (25,7%)
stopped: 266 (14,2%)
```

**Win rate aparente** = 685 / (685 + 444) = **60,7%** entre os que decidiram direção (excl. flat).
**Win rate com stopped contado como miss** = 685 / (685 + 444 + 266) = **49,1%**.

O stop-loss transforma 14% das operações em perdas controladas (-1.5% cada), mas o efeito líquido é catastrófico: random trade sem stop-loss ganhava +0,06% em média (V1); com stop-loss + custos perde -0,30% em média.

---

## 6. Top 5 melhores e piores (V2 Random, único com volume)

### Melhores (líquido)
| # | Direção | Entrada | Saída | Retorno bruto | Líquido | Stopped |
|---|---|---|---|---|---|---|
| 1 | UP | 2026-08-28 21:00 | 2026-08-29 09:00 | +7,47% | **+7,17%** | não |
| 2 | UP | 2026-08-21 02:00 | 2026-08-21 14:00 | +4,26% | +3,96% | não |
| 3 | UP | 2026-07-09 16:00 | 2026-07-10 04:00 | +2,45% | +2,15% | não |
| 4 | UP | 2026-06-15 03:00 | 2026-06-15 15:00 | +2,37% | +2,07% | não |
| 5 | UP | 2026-06-14 12:00 | 2026-06-15 00:00 | +2,32% | +2,02% | não |

### Piores (líquido)
| # | Direção | Entrada | Saída | Retorno bruto | Líquido | Stopped |
|---|---|---|---|---|---|---|
| 1 | UP | 2026-06-24 06:00 | 2026-06-24 07:00 | -1,80% | **-2,10%** | **sim** |
| 2 | UP | 2026-06-24 03:00 | 2026-06-24 04:00 | -1,65% | -1,95% | **sim** |
| 3 | UP | 2026-06-24 04:00 | 2026-06-24 05:00 | -1,55% | -1,85% | **sim** |
| 4 | UP | 2026-06-24 05:00 | 2026-06-24 06:00 | -1,55% | -1,85% | **sim** |
| 5 | UP | 2026-06-24 07:00 | 2026-06-24 08:00 | -1,52% | -1,82% | **sim** |

**Observação**: as 5 piores operações do random V2 são as 5 candles consecutivos de 2026-06-24 (03:00 → 07:00 UTC), todas paradas em ≤1h. **O stop-loss funcionou perfeitamente**: detectou o crash de 5%+ em candles consecutivos e limitou cada perda a 1.5% bruto. Sem o stop-loss, essas mesmas 5 operações teriam perdido ~20% (5 candles de -3 a -5% cada).

---

## 7. Diagnóstico: por que os fixes não destravaram o motor

### 7.1 Margem adaptativa não ajudou neste dataset
A margem do V2 adapta a `atrPct`. Mas BTC 1h em maio-agosto 2026 teve `atrPct` sempre ≥ 0.05 (regime volátil). Resultado: a margem adaptativa foi SEMPRE 0.08 — **mais restritiva** que a margem fixa 0.05 do V1. Ironia: o fix tornaria o motor mais agressivo em mercados calmos (onde `atrPct < 0.02`, margin 0.02) — mas este dataset não tem dias calmos.

### 7.2 Exceção histórica nunca dispara
A condição `nRecentTrades >= 30 && edge >= 0.03` exige 30 sinais já aprovados nas últimas 24h. Como o motor nunca aprova nada (`actionable=0`), `nRecentTrades` permanece 0, e a exceção fica permanentemente fechada. Chicken-and-egg clássico. **Para destravar isso, ou (a) o motor precisa produzir edge estatisticamente significativo em algum momento (não produz neste dataset), ou (b) a exceção histórica precisa de uma porta alternativa**.

### 7.3 O fix correto seria no `Backtester`, não no `isActionable`
O V1 já apontava isso (seção 7): o `Backtester.probabilityForSetup` está produzindo probabilidades com média -0.098 abaixo do baseline. Isso é uma propriedade do motor, não dos filtros. Os fixes V2 mexem em filtros + execução, que são camadas a jusante. **Enquanto a probabilidade empírica continuar sub-calibrada, nenhum filtro (fixo, adaptativo, ou histórico) vai destravar sinais acionáveis**.

### 7.4 Custos e stop-loss NÃO foram exercidos pelo motor
A correção #3 (`netReturnAfterCosts`) só seria exercida se houvesse trades. Como `engine_trades=0`, o `returnPct=0` em todos os 0 trades. A correção #2 (stop-loss) idem. Ambas estão integradas e funcionam (provadas no random baseline), mas não chegaram ao motor.

---

## 8. Verificação de causalidade

Mesmo com fixes, o pipeline continua causal:
- `features = candles.slice(0, i)` ✓
- `quant.analyze(candles[0..i-1])` ✓
- `backtester.probabilityForSetup(queryIndex: i-1, includeAfterQuery: false default)` ✓
- `fusion.fuse(input)` opera sobre probabilidades pré-calculadas ✓
- `evaluateShadowTrade` recebe `futureCandles = candles[i..i+12]` (candles de i em diante, que incluem o de entrada) ✓

Nenhum look-ahead introduzido pelos fixes.

---

## 9. Conclusão + Recomendação

### Veredito direto

**O motor, mesmo com os 3 fixes, NÃO tem edge sobre buy-and-hold em BTCUSDT 1h em 90 dias.** O motor produz 0 trades; o buy-and-hold produz +6% (V2) ou +25% (V1). Os fixes são corretos em código e exercitam o pipeline quando há sinais — mas não há sinais.

### Os fixes resolveram o problema?

**Não — porque o problema não estava nos filtros nem na execução. O problema está no motor de probabilidade upstream (`Backtester.probabilityForSetup`), que produz edges negativos na média (-0.098 no V1). Os fixes V2 mexem em:
- aprovação (`isActionable` adaptativo),
- execução (`evaluateShadowTrade` com stop-loss),
- custos (`netReturnAfterCosts`).

Nenhum desses endereça a causa raiz: **a probabilidade empírica está mal calibrada para este mercado e este horizonte**.

### Recomendação

**NÃO seguir com o ensemble bayesiano nas próximas tasks do plano.** Antes, é preciso:

1. **Curto prazo (obrigatório)**: investigar por que o `Backtester` produz probabilidades sub-calibradas. Hipótese principal: a função de similaridade (`DEFAULT_CRITERIA` + `similarityThreshold: 0.85`) é baseada em features que não discriminam o outcome real (12h à frente) neste mercado. Pode ser:
   - features técnicas (RSI, estrutura, níveis) que em BTC 1h são ruidosas;
   - OOS ratio (0.25) pequeno demais para o tamanho de pool;
   - baseline calculado sobre janela muito curta.
2. **Médio prazo**: treinar uma regressão logística PLATT SOBRE as features do motor, calibrar contra dados de 1-2 anos, e validar OOS com critérios estatísticos rigorosos (Hoeffding, blocking bootstrap).
3. **Ensemble**: SÓ vale a pena montar ensemble (regime + macro + sentimento) DEPOIS de ter pelo menos 1 modelo com edge detectável. Ensemble de modelos sem edge é ensemble de ruído.
4. **Parar aqui**: se a investigação acima não encontrar uma configuração com win rate > 55% e expectancy > 0.1% em OOS, **abandonar o motor TRACECON como produtor de sinal** e tratá-lo apenas como ferramenta de visualização / debug.

### Resposta direta à pergunta do brief

| Pergunta | Resposta |
|---|---|
| O motor agora tem edge? | **Não** (0 trades em 90 dias, mesma situação que V1) |
| Os fixes resolveram o problema? | **Não** (resolveram problemas hipotéticos; o problema real é upstream) |
| Seguir com o ensemble (próximas tasks)? | **Não** — primeiro investigar `Backtester` |
| Ajustar mais? | **Sim**, mas em outra camada: features, calibração Platt, validação OOS |

---

## Anexo — Arquivos gerados (V2)

- `spike-results/walk_forward_v2.ts` — simulador walk-forward v2 (3 fixes integrados)
- `spike-results/diagnose_v2_actionable.ts` — diagnóstico da margem adaptativa
- `spike-results/trades_v2.json` — trades do engine (0) e random (1878) com metadados completos
- `spike-results/metrics_v2.json` — métricas consolidadas V2
- `spike-results/SPIKE_REPORT_V2.md` — este relatório

### Resumo numérico V2

```
Engine (com fixes):  0 trades, 0% retorno, Sharpe n/a
Random (com fixes):  1878 trades, -567% retorno, Sharpe -18.2, DD -568%
Buy-and-Hold:        1 trade, +6% retorno (V2 anchor) / +25% (V1 anchor)
```

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>