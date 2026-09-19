# SCENARIO ENGINE V3 — motor puro de cenários, regimes e playbooks (SHADOW)

- **Arquivo do motor:** `relay/scenario-engine.mjs` — `SCENARIO_ENGINE_VERSION = "SCENARIO_ENGINE_V3"`.
- **Testes:** `tests/ai/scenario-engine.test.ts` — 47 casos determinísticos com fixtures próprias.
- **Consumidor:** `relay/scenario-shadow.mjs` (contrato congelado: `SCENARIO_ENGINE_VERSION`, `REGIMES`,
  `SCENARIOS`, `extractContext`, `classifyRegime`, `classifyScenario`, `evaluatePlaybook`, `analyzeScenario`).
- **Escopo:** SHADOW/RESEARCH ONLY, **PRACTICE only, ZERO real**. O motor **não** envia ordens, **não**
  controla execução, stake, direção, threshold 75, pesos do Quality Gate, Brain G2, setups, JIT,
  Critic/Consensus de produção ou Execution Gate. Nenhum arquivo de produção foi alterado.
- **Puro:** zero imports, zero IO, zero DB, zero fetch, zero `Date.now`, zero `Math.random`, zero efeitos
  colaterais. Mesma entrada → mesma saída byte a byte.
- **Sem tuning em resultado:** nada aqui foi ajustado olhando WIN/LOSS de observações (`NO_TUNING_ON_WIN_LOSS`).

---

## 1. Contrato congelado

| Export | Assinatura | Observação |
|---|---|---|
| `SCENARIO_ENGINE_VERSION` | `"SCENARIO_ENGINE_V3"` | versão do motor |
| `REGIMES` | `{TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, TRANSITION, UNCERTAIN}` | congelado |
| `SCENARIOS` | `{TREND_CONTINUATION, TREND_PULLBACK, BREAKOUT, FAILED_BREAKOUT, RANGE_MEAN_REVERSION, REVERSAL, COMPRESSION_EXPANSION, TRANSITION_NO_TRADE}` | congelado |
| `extractContext(input)` | `{multiTimeframe, trendMajor, trendRecent, volatility, structure, location, supportResistance, candleBehavior, tickBehavior, velocity, acceleration, feedQuality, unavailable}` | features observáveis + indisponíveis |
| `classifyRegime(context)` | `{regime, subRegime, evidenceFor, evidenceAgainst, confidence: LOW\|MEDIUM\|HIGH}` | nenhum indicador isolado decide |
| `classifyScenario(context, regime, opts?)` | `{primaryScenario, secondaryScenario, primaryEvidenceFor, primaryEvidenceAgainst, competitorEvidence, winnerRationale, ambiguous}` | concorrentes explícitos |
| `evaluatePlaybook(playbook, context, features)` | `{applicable, validRegimes, evidenceFor, evidenceAgainst, locationState, structureState, momentumState, volatilityState, microstructureState, triggerState, invalidations, entryEligible, action, waitConditions, competing}` | aceita `string`/`{id}`/`{playbookId}` |
| `analyzeScenario(input)` | `{scenarioEngineVersion, marketRegime, primaryScenario, secondaryScenario, competing, scenarioEvidenceFor, scenarioEvidenceAgainst, structureState, locationState, trendState, momentumState, volatilityState, microstructureState, triggerState, invalidations, action, confidence, featuresUsed, unavailable, ambiguous}` | usado pelo shadow |

`extractContext` aceita `input.features` (formato do shadow: `rsi14`, `adx14`, `plusDI`, `minusDI`,
`bodyRatio`, `upperWick`, `lowerWick`, `donchianPosition`, `distanceToUpperATR`,
`distanceToLowerATR`, `channelHigh`, `channelLow`, `atr`, `atrRatio`, `structureLabel`, `fresh`,
`tickAgeMs`), `input.snapshot` (T0 com `structure/location/momentum/strength/volatility/microstructure/freshness`),
`input.candles`/`input.candlesHigher`, `input.ticks` e `input.ablation` (respeita componentes desligados:
um key de componente desabilitado nunca entra em `featuresUsed` e não é lido do snapshot).

### 1.1 Política de indisponibilidade (OTC)

O OTC da IQ Option expõe **preço/ticks/candles**, não volume nem order book. O motor usa somente o
observável e marca o resto como `unavailable`; **nunca inventa volume nem order book**:

| Feature | OTC | NORMAL sem dado |
|---|---|---|
| `volume` | `volume:OTC_NOT_OBSERVABLE` | `volume:NOT_PROVIDED` |
| `orderBook` / `marketDepth` | `orderBook:OTC_NOT_OBSERVABLE`, `marketDepth:OTC_NOT_OBSERVABLE` | `orderBook:NOT_PROVIDED` |
| `realizedVolatility`/`bbw`/`donchianWidth` | `...:UNAVAILABLE` sem candles | idem |
| `ticks`/`tickMicrostructure` | `ticks:NOT_PROVIDED`, `tickMicrostructure:UNAVAILABLE` | idem |
| `rsi14`/`adx14`/`rsiTrajectory`/`multiTimeframe` | `*:NOT_PROVIDED`/`UNAVAILABLE` | idem |

### 1.2 Zero leakage

`extractContext` varre a entrada (inclusive `snapshot`) e qualquer chave que case
`/(result|settlement|outcome|pnl|profit|postwindow|post_window|future|expiryclose|expiry_close|broker|causal|feedable)/i`
é **ignorada** e marcada como `leakageIgnored:<path>` em `unavailable`. Os testes provam que trocar
`WIN`→`LOSS` e inverter candles futuros produz saída **byte a byte idêntica**.

---

## 2. Regimes e conflitos

`classifyRegime` acumula pontos por evidência de estrutura, multi-timeframe, momentum, ADX/DI, BOS e
volatilidade. Decisões principais:

1. **Feed STALE** → `UNCERTAIN` (LOW) e governança de WAIT.
2. **COMPRESSION** quando a evidência de compressão ≥ 2 e `max(trend) < 2.5` (compressão não escolhe direção).
3. **TREND_UP/DOWN** só com score ≥ 3 e gap ≥ 1.25 (estrutura + pelo menos outra evidência; ADX/DI sozinho nunca).
4. **EXPANSION** quando a volatilidade expandiu (evento/ATR ratio), com `subRegime` `BREAKOUT_STARTED` ou `VOLATILITY_ONLY`.
5. **RANGE** com score ≥ 3 (estrutura lateral, ADX baixo, DI spread pequeno, ATR na banda, bordas definidas/estáveis).
6. **TRANSITION** para conflitos (`STRUCTURE_MOMENTUM_CONFLICT`, `MULTI_TIMEFRAME_CONFLICT`, `EXPANSION_WITHOUT_DIRECTION`, ADX alto sem estrutura).
7. `UNCERTAIN` para evidência estrutural insuficiente.

Conflitos observáveis (`context.conflicts`): `STRUCTURE_MOMENTUM_CONFLICT`, `MULTI_TIMEFRAME_CONFLICT`,
`EXPANSION_WITHOUT_DIRECTION`, `RANGE_BREAK_RISK`, `FEED_STALE`.

### 2.1 Concorrência e `ambiguous`

`classifyScenario` ranqueia os 8 cenários por score (desempate pela ordem congelada) e:

- `secondaryScenario` = melhor concorrente do vencedor (lista `competing` do playbook);
- `competitorEvidence = [{scenario, for, against}]` (até 3) explica por que X venceu Y;
- `ambiguous: true` quando a diferença top-2 ≤ 1.0, quando a compressão não tem direção ou quando há governança;
- governança → `TRANSITION_NO_TRADE` + WAIT quando: regime TRANSITION/UNCERTAIN sem gatilho duro,
  score top < 3, conflito estrutura×momentum, divergência Trader/Critic, feed STALE ou expansão sem direção.

---

## 3. Os 8 playbooks

Para cada playbook: **DEFINITION · VALID/INVALID REGIMES · STRUCTURE · LOCATION · MOMENTUM · VOLATILITY ·
MICROSTRUCTURE · TRIGGER · INVALIDATION · COMPETING · TRADER LOGIC · CRITIC ATTACK · WAIT CONDITIONS ·
FEATURES USED · SOURCES · TRACECom HYPOTHESIS**.

Convenção de fontes: **(a) acadêmica** (artigos revisados), **(b) heurística de análise técnica**
(certificações/educação séria, sem comprovação de edge), **(c) hipótese TraceCom** (OTC 60 s, NÃO provada).
Material educacional de corretora **não** é comprovação de edge.

### 3.1 TREND_CONTINUATION

- **DEFINITION:** continuação de tendência com estrutura e momentum a favor, preço aceito na metade do
  canal, sem sinal de exaustão.
- **VALID REGIMES:** `TREND_UP`, `TREND_DOWN`, `EXPANSION`. **INVALID:** `RANGE`, `COMPRESSION`, `TRANSITION`, `UNCERTAIN`.
- **STRUCTURE:** HH/HL (ou LH/LL) intactos; sem break of structure contra.
- **LOCATION:** UP `pos ≥ 0.45`; DOWN `pos ≤ 0.55`; extremo oposto derruba a validade.
- **MOMENTUM:** velocidade/aceleração na direção; RSI na direção sem extremo contra.
- **VOLATILITY:** NORMAL ou EXPANSION; compressão forte penaliza.
- **MICROSTRUCTURE:** ticks alinhados/neutros; sem wick de rejeição dominante contra.
- **TRIGGER:** fechamento de continuação após pausa sem romper swing a favor.
- **INVALIDATION:** `STRUCTURE_AGAINST_TREND`, `BREAK_OF_STRUCTURE_AGAINST`, `MOMENTUM_CONFLICT`, `REJECTION_AT_EXTREME`.
- **COMPETING:** `TREND_PULLBACK`, `REVERSAL`, `TRANSITION_NO_TRADE` (exaustão/transição).
- **TRADER LOGIC:** operar a favor; extensão > 2.5 ATR ou rejeição no extremo → WAIT.
- **CRITIC ATTACK:** estrutura em janela curta; momentum pode ser ruído; exaustão pode não aparecer.
- **WAIT CONDITIONS:** `WAIT_FOR_STRUCTURE_AND_MOMENTUM_ALIGNMENT`, `WAIT_FOR_NON_EXTENDED_LOCATION`.
- **FEATURES USED:** `structureLabel`, `donchianPosition`, `velocity`, `acceleration`, `adx14`, `plusDI`, `minusDI`, `rsi14`, `atrRatio`, `bodyRatio`, `ticks`.
- **SOURCES:** (a) Moskowitz–Ooi–Pedersen (2012) *Time Series Momentum*; Hurst–Ooi–Pedersen (2017)
  *A Century of Evidence on Trend-Following Investing*; (b) CMT Association (tendência/estrutura);
  CFA Institute Research Foundation, *Technical Analysis: Modern Perspectives*.
- **TRACECom HYPOTHESIS (não provada):** em OTC 60 s, continuação com estrutura alinhada teria vantagem
  marginal; não validada prospectivamente e sem volume/order book.

### 3.2 TREND_PULLBACK

- **DEFINITION:** retração para zona de valor mantendo swing a favor e sem quebra estrutural.
- **VALID REGIMES:** `TREND_UP`, `TREND_DOWN`. **INVALID:** `RANGE`, `COMPRESSION`, `TRANSITION`, `UNCERTAIN`.
- **STRUCTURE:** HL em UP / LH em DOWN mantidos; nenhum BOS contra.
- **LOCATION:** UP `0.25–0.65`; DOWN `0.35–0.75`.
- **MOMENTUM:** momento contra apenas como retração (RSI 38–62), sem flip de aceleração.
- **VOLATILITY:** NORMAL; pullback em compressão tende a virar transição.
- **MICROSTRUCTURE:** sem corpo forte contra; retest/pullback observado.
- **TRIGGER:** candle de continuação após o pullback sem romper o swing.
- **INVALIDATION:** `STRUCTURE_BROKEN`, `BREAK_OF_STRUCTURE_AGAINST`, `LOCATION_AT_EXTREME`.
- **COMPETING:** `REVERSAL` (**principal**), `TREND_CONTINUATION`, `TRANSITION_NO_TRADE`.
- **TRADER LOGIC:** entrar a favor com swing mantido; nunca fade da tendência sadia.
- **CRITIC ATTACK:** pullback vs reversal depende de swing; RSI de exaustão confunde; ruído OTC pode romper swing sem estrutura.
- **WAIT CONDITIONS:** `WAIT_FOR_PULLBACK_ZONE_AND_HELD_SWING`, `WAIT_FOR_RESUMPTION_CANDLE`.
- **FEATURES USED:** `structureLabel`, `donchianPosition`, `velocity`, `acceleration`, `rsi14`, `atrRatio`, `bodyRatio`, `upperWick`, `lowerWick`.
- **SOURCES:** (b) CMT Association (retrações); Fidelity Learning Center (pullbacks); CFA Institute Research Foundation.
- **TRACECom HYPOTHESIS (não provada):** retração a favor com swing mantido em OTC 60 s; **não
  distinguível de reversão** sem rompimento confirmado (o motor exige BOS para reversal).

### 3.3 BREAKOUT

- **DEFINITION:** rompimento com fechamento e expansão: aceitação além de extremo/compressão, corpo dominante e follow-through.
- **VALID REGIMES:** `TREND_UP`, `TREND_DOWN`, `EXPANSION`, `COMPRESSION`. **INVALID:** `RANGE` puro.
- **STRUCTURE:** extremo/canal rompido com fechamento (não apenas wick).
- **LOCATION:** UP `pos ≥ 0.85`; DOWN `pos ≤ 0.15`; extensão 0.1–2.5 ATR além do nível.
- **MOMENTUM:** velocidade/aceleração na direção; > 2.5 ATR vira risco de fracasso.
- **VOLATILITY:** EXPANSION ou expansão iniciando; compressão sem expansão não confirma.
- **MICROSTRUCTURE:** ticks alinhados; corpo ≥ 0.5; wick dominante contra é ataque do Critic.
- **TRIGGER:** fechamento além do extremo com corpo e extensão ≥ 0.05–0.1 ATR.
- **INVALIDATION:** `BREAKOUT_FAILED_CLOSE_BACK_INSIDE`, `UPPER_WICK_REJECTION`, `NO_EXPANSION`, `OVEREXTENDED_FROM_CHANNEL`.
- **COMPETING:** `FAILED_BREAKOUT` (**principal**), `COMPRESSION_EXPANSION`, `TREND_CONTINUATION`.
- **TRADER LOGIC:** só perseguir com fechamento+expansão; rompimento fraco/sem corpo = WAIT.
- **CRITIC ATTACK:** maioria dos rompimentos intradiários falha; sem order book a qualidade é inferida; entrada atrasada é risco.
- **WAIT CONDITIONS:** `WAIT_FOR_CLOSE_BEYOND_LEVEL`, `WAIT_FOR_EXPANSION_AND_BODY`, `WAIT_FOR_FRESH_TICKS`.
- **FEATURES USED:** `structureLabel`, `donchianPosition`, `channelHigh`, `channelLow`, `distanceToUpperATR`, `distanceToLowerATR`, `atrRatio`, `bodyRatio`, `upperWick`, `lowerWick`, `velocity`, `ticks`.
- **SOURCES:** (a) Brock–Lakonishok–LeBaron (1992) *Simple Technical Trading Rules*; Sullivan–Timmermann–White
  (1999) *Data-Snooping…* (o outperformance de regras de breakout **desaparece** após correção de
  data snooping); White (2000) *Reality Check*; (b) CME Group Education.
- **TRACECom HYPOTHESIS (não provada):** expansão após compressão com fechamento poderia ter assimetria
  em OTC 60 s; não medido sem volume/order book.

### 3.4 FAILED_BREAKOUT

- **DEFINITION:** perfuração do extremo com fechamento de volta para dentro e rejeição; viés contrário ao rompimento.
- **VALID REGIMES:** `RANGE`, `TRANSITION`, `EXPANSION`, `COMPRESSION`.
- **STRUCTURE:** sem aceitação fora do canal; retorno para dentro.
- **LOCATION:** retorno (`pos ≤ 0.8` no failed up; `pos ≥ 0.2` no failed down).
- **MOMENTUM:** velocidade contra o rompimento / desaceleração.
- **VOLATILITY:** expansão sem follow-through (armadilha) ou normalização.
- **MICROSTRUCTURE:** wick de rejeição dominante; ticks contra a direção perfurada.
- **TRIGGER:** rejeição confirmada (wick ≥ 0.5 ou evento) **e** fechamento de volta.
- **INVALIDATION:** `ACCEPTANCE_BEYOND_LEVEL`, `STRONG_BODY_IN_BREAK_DIRECTION`, `NO_REJECTION_CONFIRMATION`.
- **COMPETING:** `BREAKOUT` (**principal**), `RANGE_MEAN_REVERSION`, `REVERSAL`.
- **TRADER LOGIC:** falha confirmada opera de volta ao range; **falha sem rejeição = WAIT (não é retest)**.
- **CRITIC ATTACK:** distinguir falha de retest exige nível robusto; “aceitação” inferida; rejeição pode ser ruído/spread.
- **WAIT CONDITIONS:** `WAIT_FOR_CLOSE_BACK_INSIDE`, `WAIT_FOR_REJECTION_CONFIRMATION`.
- **FEATURES USED:** `structureLabel`, `donchianPosition`, `distanceToUpperATR`, `distanceToLowerATR`, `bodyRatio`, `upperWick`, `lowerWick`, `velocity`, `atrRatio`, `ticks`.
- **SOURCES:** (b) CMT Association (armadilhas/rejeição); Fidelity Learning Center; (a) Park–Irwin (2007)
  *What Do We Know About the Profitability of Technical Analysis?*.
- **TRACECom HYPOTHESIS (não provada):** perfuração sem fechamento reverte para o range em OTC 60 s;
  retest vs falha não provado (os dois geram direções opostas no motor).

### 3.5 RANGE_MEAN_REVERSION

- **DEFINITION:** range **provado** com bordas estáveis; BUY perto da base com rejeição/retorno; SELL perto
  do topo; **MID reduz muito a validade**.
- **VALID REGIMES:** `RANGE`. **INVALID:** tendências, `COMPRESSION`, `EXPANSION`, `TRANSITION`, `UNCERTAIN`.
- **STRUCTURE:** lateral com `rangeHigh/Low/Mid/Width` definidos, bordas respeitadas, sem BOS.
- **LOCATION:** `pos ≤ 0.2` (BUY) / `pos ≥ 0.8` (SELL); `0.35–0.65` (MID) gera `MID_LOCATION` e WAIT.
- **MOMENTUM:** ADX < 20, DI spread ≤ 5, RSI **retornando** do extremo (trajetória) — RSI extremo isolado não basta.
- **VOLATILITY:** NORMAL/TIGHT; expansão é risco de rompimento (não fade).
- **MICROSTRUCTURE:** rejeição na borda (wick) e ticks revertendo; Donchian/estabilidade observáveis.
- **TRIGGER:** rejeição/retorno na borda + fechamento de volta; se parece romper → WAIT.
- **INVALIDATION:** `MID_LOCATION`, `RANGE_BREAK_IN_PROGRESS`, `RANGE_EXPANSION_RISK`, `BREAKOUT_RISK_ADX_DI`, `STRUCTURE_NOT_RANGE`.
- **COMPETING:** `BREAKOUT`, `COMPRESSION_EXPANSION`, `FAILED_BREAKOUT`; se parece romper, o score do MR
  colapsa (`RANGE_THESIS_COLLAPSED_BY_BREAKOUT`) e o motor devolve WAIT/breakout.
- **TRADER LOGIC:** fade só na borda com rejeição; MID é WAIT; rompimento em curso nunca é fade.
- **CRITIC ATTACK:** ranges podem romper sem aviso; RSI extremo não é gatilho; sem volume a defesa da borda é candle/ticks.
- **WAIT CONDITIONS:** `WAIT_FOR_RANGE_EDGE_WITH_REJECTION`, `WAIT_FOR_RANGE_PROOF_STABLE_EDGES`, `WAIT_FOR_NO_BREAKOUT_RISK`.
- **FEATURES USED:** `structureLabel`, `donchianPosition`, `channelHigh`, `channelLow`, `atrRatio`, `adx14`, `plusDI`, `minusDI`, `rsi14`, `bodyRatio`, `upperWick`, `lowerWick`, `ticks`, `candles`.
- **PROVA DE RANGE (evidência coletada):** regime RANGE + estrutura lateral + `rangeHigh/Low/Mid/Width` +
  posição normalizada + estabilidade das bordas (toques/rejeições) + ADX/DI baixos + ATR relativo na banda +
  Donchian + trajetória do RSI. Nenhum item isolado fecha a tese.
- **SOURCES:** (a) Poterba–Summers (1988) *Mean Reversion in Stock Prices*; De Bondt–Thaler (1985)
  *Does the Stock Market Overreact?*; (b) CMT Association (suporte/resistência/canais); Fidelity Learning Center.
- **TRACECom HYPOTHESIS (não provada):** fade de bordas de range estável em OTC 60 s; **não validado** e
  sem volume/order book.

### 3.6 REVERSAL

- **DEFINITION:** reversão **confirmada**: BOS contra a tendência anterior + rejeição no extremo +
  divergência de momentum.
- **VALID REGIMES:** `TREND_UP`, `TREND_DOWN`, `EXPANSION`, `TRANSITION`. **INVALID:** `RANGE` puro, `COMPRESSION`.
- **STRUCTURE:** LL após UP / HH após DOWN; **sem BOS não há reversal** (`NO_STRUCTURE_BREAK`).
- **LOCATION:** extremo da tendência anterior (UP `pos ≥ 0.75`; DOWN `pos ≤ 0.25`) com rejeição.
- **MOMENTUM:** divergência (novo extremo de preço sem novo extremo de momentum) e aceleração contra.
- **VOLATILITY:** EXPANSION/spike contra a tendência anterior.
- **MICROSTRUCTURE:** ticks virando; wick de rejeição; failed breakout a favor.
- **TRIGGER:** BOS + rejeição; **RSI extremo sozinho nunca gera reversal** (teste dedicado).
- **INVALIDATION:** `TREND_STRUCTURE_INTACT`, `NO_STRUCTURE_BREAK`, `RSI_EXTREME_WITHOUT_STRUCTURE`.
- **COMPETING:** `TREND_PULLBACK` (**principal**), `TREND_CONTINUATION`, `FAILED_BREAKOUT`.
- **TRADER LOGIC:** só contra a tendência com BOS/rejeição/divergência; sem confirmação tratar como pullback/WAIT.
- **CRITIC ATTACK:** falsos BOS são frequentes; RSI extremo é o erro clássico; tendência forte pode retomar.
- **WAIT CONDITIONS:** `WAIT_FOR_BREAK_OF_STRUCTURE`, `WAIT_FOR_EXTREME_REJECTION`, `WAIT_FOR_MOMENTUM_DIVERGENCE`.
- **FEATURES USED:** `structureLabel`, `donchianPosition`, `velocity`, `acceleration`, `rsi14`, `atrRatio`, `bodyRatio`, `upperWick`, `lowerWick`, `ticks`.
- **SOURCES:** (a) Lo–Mamaysky–Wang (2000) *Foundations of Technical Analysis*; Park–Irwin (2007);
  (b) CMT Association (reversão/exaustão); Fidelity Learning Center.
- **TRACECom HYPOTHESIS (não provada):** reversões após BOS+rejeição em OTC 60 s; RSI extremo isolado
  explicitamente rejeitado como gatilho.

### 3.7 COMPRESSION_EXPANSION

- **DEFINITION:** compressão de volatilidade (ATR relativo + trajetória, realVol, Donchian width, BBW
  quando validado, candle ranges, movimento de ticks) seguida de expansão. **Compressão não escolhe
  direção**; direção só quando expansão/ruptura começa.
- **VALID REGIMES:** `COMPRESSION`, `EXPANSION`. **INVALID:** `RANGE`, tendências, `TRANSITION`, `UNCERTAIN`.
- **STRUCTURE:** antes candles menores/canal estreito; depois fechamento além da fronteira de compressão.
- **LOCATION:** posição não define direção na compressão; direção = lado do rompimento.
- **MOMENTUM:** morno na compressão; acelera com o evento.
- **VOLATILITY:** ATR ratio ≤ 0.75/0.85 + trajetória `NARROWING`; realVol/BBW/Donchian estreitos quando
  validados; expansão = rangeRatio/ATR subindo.
- **MICROSTRUCTURE:** ticks pequenos/alternados na compressão; tick a favor no breakout.
- **TRIGGER:** expansão efetiva com fechamento e corpo; **expansão só por wick = `FALSE_EXPANSION`**.
- **INVALIDATION:** `EXPANSION_WITHOUT_DIRECTION`, `FALSE_EXPANSION_WICK_ONLY`, `COMPRESSION_NOT_CONFIRMED`.
- **DISTINÇÃO:** `COMPRESSION` (sem direção, WAIT), `COMPRESSION_BREAKOUT` (evento+breakout, entrada) e
  `FALSE_EXPANSION` (wick sem fechamento/direção, WAIT) — implementadas como estados/evidências.
- **COMPETING:** `BREAKOUT`, `FAILED_BREAKOUT` (**principal**), `TRANSITION_NO_TRADE`.
- **TRADER LOGIC:** nunca prever direção na compressão; esperar expansão com fechamento; sem direção = WAIT.
- **CRITIC ATTACK:** BBW/realVol exigem janela; compressão pode ser sessão sem liquidez; expansão pode falhar.
- **WAIT CONDITIONS:** `WAIT_FOR_EXPANSION_DIRECTION`, `WAIT_FOR_COMPRESSION_CONFIRMED`, `WAIT_FOR_CLOSE_BEYOND_COMPRESSION_BOUNDARY`.
- **FEATURES USED:** `atrRatio`, `atr`, `structureLabel`, `donchianPosition`, `channelHigh`, `channelLow`, `bodyRatio`, `velocity`, `ticks`, `candles`.
- **SOURCES:** (a) Mandelbrot (1963) *The Variation of Certain Speculative Prices* (clustering de
  volatilidade); Engle (1982) ARCH; Bollerslev (1986) GARCH; Andersen–Bollerslev (1998) *Answering the Skeptics*.
- **TRACECom HYPOTHESIS (não provada):** compressão medida por ATR relativo/candle ranges precede expansão
  em OTC 60 s; direção sempre condicional ao evento.

### 3.8 TRANSITION_NO_TRADE

- **DEFINITION:** tendência enfraquecendo sem reversal confirmado; range rompendo sem breakout confiável;
  compressão sem direção; estrutura confusa; momentum × estrutura discordando; confiança estrutural baixa → **WAIT sempre**.
- **VALID REGIMES:** todos (é o estado de abstenção). **INVALID:** nenhum.
- **STRUCTURE:** confusa/ambígua/em transição.
- **LOCATION:** irrelevante — nenhum local autoriza entrada.
- **MOMENTUM:** discorda da estrutura.
- **VOLATILITY:** mudança de regime sem direção.
- **MICROSTRUCTURE:** sinais mistos; confiança insuficiente.
- **TRIGGER:** nenhum.
- **INVALIDATION:** `ALWAYS_WAIT_BY_DESIGN`.
- **COMPETING:** os 7 cenários direcionais (evidência em `competitorEvidence`).
- **TRADER LOGIC:** não operar; aguardar definição.
- **CRITIC ATTACK:** WAIT também tem custo de oportunidade; ambiguidade pode esconder tese boa; transição pode resolver rápido.
- **WAIT CONDITIONS:** `WAIT_UNTIL_REGIME_DEFINED`, `WAIT_FOR_REVERSAL_CONFIRMATION`, `WAIT_FOR_RELIABLE_BREAKOUT`.
- **FEATURES USED:** `structureLabel`, `velocity`, `acceleration`, `adx14`, `atrRatio`, `rsi14`, `ticks`, `candles`.
- **SOURCES:** (b) CFA Institute Research Foundation (regime uncertainty); CMT Association (transição); (a) Park–Irwin (2007).
- **TRACECom HYPOTHESIS (não provada):** abster-se em transição evita falsos sinais; custo de oportunidade não medido.

---

## 4. Fontes — separação explícita de status epistêmico

### 4.1 (a) Evidência acadêmica

| Tema | Referência | O que sustenta / o que NÃO sustenta |
|---|---|---|
| Trend following | Moskowitz, Ooi & Pedersen (2012), *Time Series Momentum*, JFE 104(2) | momentum de série temporal em futuros; **não** prova edge em opções binárias OTC 60 s |
| Trend following | Hurst, Ooi & Pedersen (2017), *A Century of Evidence on Trend-Following Investing*, JPM | persistência secular de trend following; horizonte de meses/anos, não 60 s |
| Regras técnicas | Brock, Lakonishok & LeBaron (1992), *Simple Technical Trading Rules…*, JF 47(5) | média móvel/breakout tiveram retorno histórico; resultado **não sobrevive** a correções posteriores |
| Data snooping | Sullivan, Timmermann & White (1999), *Data-Snooping…*, JF 54(5); White (2000), *A Reality Check…*, Econometrica 68(5) | o desempenho aparente de regras de breakout some após corrigir múltiplas hipóteses |
| Padrões | Lo, Mamaysky & Wang (2000), *Foundations of Technical Analysis*, JF 55(4) | alguns padrões carregam informação incremental; sem garantia de lucratividade líquida |
| Survey | Park & Irwin (2007), *What Do We Know About the Profitability of Technical Analysis?*, JES 21(4) | evidência mista e sensível a mercado/período/custos |
| Mean reversion | Poterba & Summers (1988), *Mean Reversion in Stock Prices*, JFE 22(1); De Bondt & Thaler (1985), JF 40(3) | reversão de longo prazo em ações; **não** valida fade de range em 60 s |
| Volatilidade | Mandelbrot (1963); Engle (1982) ARCH, Econometrica 50(4); Bollerslev (1986) GARCH, J. Econometrics 31(3); Andersen & Bollerslev (1998) | clustering e previsibilidade de volatilidade; suporta compressão→expansão como fenômeno, não como direção |
| Microestrutura | Kyle (1985), Econometrica 53(6); Glosten & Milgrom (1985), JFE 14(1); Roll (1984), JF 39(2); Blume & Stambaugh (1983), JFE 12(4) | preço reflete fluxo/informação; bid-ask bounce contamina microestrutura de ticks |
| Microestrutura | Cont (2001), *Empirical Properties of Asset Returns*, Quantitative Finance 1(2); Cont, Kukanov & Stoikov (2014), *The Price Impact of Order Book Events*, JFEc 12(1); Hasbrouck (2007); O'Hara (1995) | propriedades estilizadas e impacto de eventos de book; **order book não existe no OTC** → nada disso é importado como feature |
| Mercado eficiente | Fama (1970), *Efficient Capital Markets*, JF 25(2) | ceticismo de base: sem custo/risco ajustados, padrões podem ser ruído |
| Uso profissional | Menkhoff (2010), *The Use of Technical Analysis by Fund Managers*, JBF 34(11) | analistas usam TA; uso não é prova de edge |

### 4.2 (b) Heurística de análise técnica (educação séria; NÃO comprova edge)

- **CMT Association** — currículo Chartered Market Technician: tendência, estrutura, suporte/resistência,
  canais, padrões de reversão/continuação. Usado para vocabulário e definições operacionais.
- **CFA Institute Research Foundation** — *Technical Analysis: Modern Perspectives* (survey que contrasta
  visão tradicional e evidência de mercados adaptativos).
- **CME Group Education** — rompimentos, volatilidade e mecânica de mercado futuro.
- **Fidelity Learning Center** — pullbacks, ranges, failed breakouts e padrões (material educacional de
  corretora: explicitamente **não** é comprovação de edge).
- **Literatura de data snooping** (Sullivan–Timmermann–White; White) é usada como **ataque do Critic**
  contra qualquer regra de breakout/padrão, não como endosso.

### 4.3 (c) Hipóteses específicas do TraceCom (OTC 60 s) — NÃO PROVADAS

Todas as hipóteses abaixo estão marcadas no código como `HYPOTHESIS TraceCom` e não foram validadas:

1. Continuidade/pullback com estrutura alinhada teria vantagem marginal em OTC 60 s.
2. Expansão após compressão (ATR relativo/candle ranges) com fechamento teria assimetria.
3. Perfuração sem fechamento (failed breakout) reverteria para o range; retest ≠ falha.
4. Fade de bordas de range estável (`pos ≤ 0.2` / `≥ 0.8`) com rejeição teria assimetria.
5. Reversões após BOS + rejeição + divergência teriam validade; RSI extremo isolado não.
6. Abster-se em transição evitaria falsos sinais (custo de oportunidade não medido).

**Contexto regulatório (não é evidência de edge, é risco):** ESMA (2018) interveio em opções binárias e a
FCA (PS19/11, 2019) baniu sua venda a varejo na UE/UK por perdas de varejo; produtos OTC com payout < odds
justas tendem a ter valor esperado negativo. Por isso: **PRACTICE only, ZERO real**, e a classificação é
observacional.

---

## 5. Garantias de isolamento (por que isso não toca produção)

- Motor é **novo arquivo**; nenhuma linha de `professional-brain.mjs`, `strategy-manager.mjs`,
  `trade-quality.mjs`, `portfolio-gate.mjs`, `entry-timing.mjs`, `late-window-timing.mjs` ou
  `scenario-shadow.mjs` foi alterada por este trabalho.
- O motor não importa nada e não é importado por produção; `relay/scenario-shadow.mjs` o consome via
  dynamic import (fallback determinístico se ausente). O shadow é `SHADOW_ONLY` (`controlsExecution:false`)
  e o Execution Gate nunca é chamado.
- Nenhum peso/threshold do Quality Gate, nenhuma stake, nenhuma ordem, nenhum JIT.
- OTC: nenhuma feature de volume/order book é criada; indisponíveis ficam em `unavailable`.

---

## 6. Cobertura de testes (`tests/ai/scenario-engine.test.ts`, 47 casos)

| Grupo | Casos |
|---|---|
| Contrato/pureza/determinismo | versão+enums congelados; 5 funções; code sem IO/relógio/random/import; byte a byte igual; shapes de `extractContext`/`classifyRegime`/`classifyScenario`/`analyzeScenario`; playbook desconhecido conservador |
| Tendência | continuação bull/bear; pullback bull/bear; pullback ≠ reversal (competidor `NO_STRUCTURE_BREAK`); reversal bull/bear; RSI extremo sozinho ≠ reversal |
| Breakout | breakout bull/bear válidos; breakout fraco → WAIT; failed breakout up/down; failed ≠ retest |
| RANGE | base → BUY; topo → SELL; MID → WAIT (`MID_LOCATION`); prova de `rangeHigh/Low/Mid/Width`/posição/estabilidade; range rompendo invalida MR; competidor BREAKOUT/EXPANSION |
| Compressão | compressão sem direção (WAIT + ambiguous); compression expansion bull/bear; false expansion → WAIT |
| Transição/indicadores | TRANSITION → WAIT; ADX sozinho sem direção; ATR sozinho sem direção; divergência Trader/Critic → WAIT |
| Mudança | cenário muda candidate→final; mudança invalidante cancela tese (sem BUY) |
| Leakage/OTC | `settlement/result/postWindow/future` ignorados com marca; WIN×LOSS byte a byte igual; futuro não cria eventos; NORMAL×OTC isolados; OTC sem volume/order book sintéticos |
| Playbooks | 8 definições com seções obrigatórias + `HYPOTHESIS TraceCom` + ≥3 fontes; `evaluatePlaybook({id})`; regime inválido nunca libera entrada; `competitorEvidence`/`winnerRationale` explicam X×Y |

Comandos de verificação:

```powershell
node --check relay/scenario-engine.mjs
npx vitest run tests/ai/scenario-engine.test.ts
npx tsc -p tsconfig.json --noEmit
```

---

## 7. Limitações conhecidas

- Sem candles/ticks, várias features ficam `unavailable` (realVol, BBW, Donchian width, trajetória de ATR,
  tick microstructure) — por design, nunca inferidas.
- OTC não tem volume/order book; “aceitação” de rompimento é inferida por candle/ticks.
- Rótulos de regime/cenário são hipóteses de pesquisa; **não** foram calibrados nem validados por WIN/LOSS,
  e não devem ser usados para promover ou vetar trades de produção.
- `confidence` é um score determinístico de evidência (0–1), não probabilidade calibrada.

