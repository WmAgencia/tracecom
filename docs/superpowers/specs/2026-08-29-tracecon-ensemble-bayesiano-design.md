# TRACE/CON Ensemble Bayesiano — Spec

**Data**: 2026-08-29
**Status**: Draft — aguardando revisão do usuário
**Tipo**: Mudança arquitetural (novos subsistemas: modelos, ensemble, anti-overfitting)

---

## 1. Objetivo

Transformar o motor TRACECON de "compete com moeda" (win rate ~52% OOS) para "consistentemente no edge" (alvo win rate > 53% em 30+ dias de paper trading) através de um **ensemble Bayesiano de 3 modelos** com calibração online e proteção rigorosa contra overfitting.

**Premissa fundamental**: TRACECON nunca executa ordens. O motor entrega sinal + probabilidade + tamanho de posição sugerido. O usuário clica na corretora.

---

## 2. Escopo

### 2.1 Dentro do escopo

- 3 modelos em paralelo: técnico (refator), microestrutura (novo), regime (novo)
- Combinação Bayesiana com pesos adaptativos baseados em calibração recente
- Integração com as 5 camadas existentes (guards, confluência, calibração Wilson, clássica, métricas)
- Aprendizado online com anti-overfitting (holdout, regularização, drift detection)
- Position sizing adaptativo (sugestão na down-bar; nunca execução)
- Novas rotas API para inspeção do ensemble
- Down-bar com ensemble %, regime, EV, pos sugerida
- Vitrine com métricas de "acertividade" (win rate, Sharpe, max DD)

### 2.2 Fora do escopo

- Auto-execution na corretora (TRACECON continua sinalizando, nunca executando)
- Integração via API de corretoras (Binance/CCXT) — extensão só mostra sinal
- Trading de futuros/margem/shorting — foco em spot
- UI mobile nativa — extensão Chrome desktop é o alvo
- Backtesting distribuído em GPU — modelos CPU-friendly
- Suporte a corretoras além de TradingView/Binance/Exodus

---

## 3. Arquitetura

### 3.1 Pipeline do sinal

```
features (candles 1m+5m+15m + book depth + aggTrades + funding)
        ↓
[3 modelos em paralelo] — técnico, microestrutura, regime
        ↓
ensemble.P(up), P(down), P(neutral), weights_distribution
        ↓
[Calibração Wilson sobre P(up) do ensemble]
        ↓
[Confluência multi-TF — ensemble aplicado a cada TF (1m, 5m, 15m)]
        ↓
[Guards: circuit breaker + cooldown + vol + staleness]
        ↓
[Risk layer — position sizing + EV calculation]
        ↓
decision = BUY/SELL/WAIT + position_size + expected_value
```

### 3.2 Camadas do motor

| Camada | Onde | Responsabilidade |
|---|---|---|
| **Modelo técnico** | `src/models/technical.ts` (refator de `src/quant/engine.ts`) | Features: RSI(7/14), MACD(12/26/9), EMA-cross, Bollinger(20,2), ATR(14), OBV, VWAP sessão. Output: P(direction), score -1..1 |
| **Modelo microestrutura** | `src/models/microestrutura.ts` (novo) | Features: order flow imbalance, trade aggression, book pressure, spread dynamics, CVD slope, trade size distribution. Output: P(direction), score |
| **Modelo regime** | `src/models/regime.ts` (novo) | Classificador Random Forest 50 árvores, 5 classes. Output: regime + confiança |
| **Ensemble Bayesiano** | `src/models/ensemble.ts` (novo) | `P(direction) = Π P_i^weight_i`, pesos = `brier_score_i^(-1)` |
| **Camadas existentes** | `src/fusion/service.ts` (refator) | Wilson, confluência, guards, clássica |
| **Risk layer** | `src/risk/position.ts` (novo) | Position sizing baseado em Kelly parcial |

---

## 4. Modelos

### 4.1 Modelo técnico (refator)

**Arquivo**: `src/models/technical.ts` (cria, deprecate `src/quant/engine.ts`)

**Input**: candles 1m/5m/15m (OHLCV) + volume profile

**Features** (10, max conforme anti-overfitting):
- `rsi_7`, `rsi_14` — RSI em janelas curta/longa
- `macd_hist`, `macd_signal_dist` — MACD histograma e distância do signal
- `ema_cross_9_21` — diferença percentual EMA9 - EMA21
- `bb_position_20_2` — posição do preço dentro das Bandas de Bollinger
- `atr_14_pct` — ATR% (volatilidade normalizada)
- `obv_slope_60` — slope do OBV em 60 candles
- `vwap_dist_session` — distância % do VWAP da sessão
- `volume_ratio_5_30` — razão volume recente vs baseline

**Modelo**: regressão logística regularizada (L2, α=1.0) calibrada com Platt scaling.

**Output**: `P(up)`, `P(down)`, `P(neutral)`, score -1..1, brier_score_self.

**Treino**: dataset Binance Vision, 90 dias OOS, janela deslizante.

### 4.2 Modelo microestrutura (novo)

**Arquivo**: `src/models/microestrutura.ts`

**Input**: order book depth 20 (atualizado 10x/s via WebSocket) + aggTrades (1 trade por mensagem)

**Features** (10):
- `obi_60s` — order flow imbalance em janela 60s: `(bid_vol - ask_vol) / (bid_vol + ask_vol)`
- `obi_300s` — mesma métrica em janela 300s
- `trade_aggression_60s` — razão volume de buy trades / volume total
- `book_pressure_5` — razão `bid_depth[:5] / ask_depth[:5]`
- `spread_z_60s` — z-score do spread atual vs spread médio 60s
- `cvd_slope_60s` — slope do Cumulative Volume Delta em 60s
- `cvd_slope_300s` — slope CVD em 300s
- `large_trade_ratio_60s` — % de trades com size > 2× avg
- `book_imbalance_top` — bid_vol[:1] / ask_vol[:1] (topo do book)
- `mid_change_60s` — mudança % do mid price em 60s

**WebSocket client** (`src/market/microstructure_feed.ts`):
- Conecta em `wss://stream.binance.com:9443/ws/btcusdt@depth20@100ms` + `btcusdt@aggTrade`
- Mantém ring buffer de 300s de book + trades
- Reconexão automática com backoff exponencial
- Estado: `lastBook`, `recentTrades`, `cvd`, `cvdHistory`

**Modelo**: regressão logística regularizada.

**Output**: `P(up)`, `P(down)`, score, brier_score_self.

### 4.3 Modelo regime (novo)

**Arquivo**: `src/models/regime.ts`

**Input**: features técnicas + volatilidade realizada + drawdown sessão

**Classes** (5):
- `trend_up` — tendência de alta, volatilidade moderada
- `trend_down` — tendência de baixa
- `range` — sem direção, oscilação
- `high_vol` — volatilidade extrema (ATR > 5% ou desvio 3σ)
- `low_vol` — volatilidade comprimida (ATR < 0.5%)

**Features** (8):
- `ema_cross_9_21`, `ema_cross_50_200`
- `atr_14_pct`, `realized_vol_24h`
- `drawdown_session`, `drawdown_24h`
- `volume_trend_24h`
- `bb_width_20`

**Modelo**: Random Forest 50 árvores, max_depth=8, class_weight balanced.

**Output**: `{regime, confidence}` ∈ {[0,1]}.

**Threshold por regime** (modifica Wilson):
- `trend_up`/`trend_down`: ciLower > baseline + 0.03 (mais permissivo)
- `range`: ciLower > baseline + 0.08 (mais conservador)
- `high_vol`: ciLower > baseline + 0.12 (muito conservador — GUARDS já bloqueiam ATR > 8%)
- `low_vol`: ciLower > baseline + 0.05

### 4.4 Ensemble Bayesiano

**Arquivo**: `src/models/ensemble.ts`

**Combinação**:
```
P(up | features) = Π P_i(up) ^ weight_i
P(down | features) = Π P_i(down) ^ weight_i
P(neutral | features) = 1 - P(up) - P(down)
```

**Pesos adaptativos** (`src/models/weight_calibrator.ts`):
- Cada modelo reporta seu brier_score_self (calibração Platt interna)
- Pesos diários: `weight_i = (1 / brier_score_i) / Σ(1 / brier_score_j)`
- Recalculados a cada 24h, ou após 100 trades novos
- Pesos nunca mudam mais de 10% por dia (regularização)

**Output final**:
```ts
{
  direction: 'up' | 'down' | 'neutral',
  probability: { up, down, neutral },
  weights: { technical, microstructure, regime },
  confidence_ensemble: 0..1,
  brier_per_model: { technical, microstructure, regime },
  features_used: {...}
}
```

**Critério de decisão** (camada ensemble, separado da fusão):
- `P(up) > 0.55` E `P(down) < 0.35` → candidato BUY
- `P(down) > 0.55` E `P(up) < 0.35` → candidato SELL
- Caso contrário → candidato neutral (vai pra Wilson layer)

---

## 5. Integração com camadas existentes

### 5.1 Pipeline refatorado em `src/fusion/service.ts`

```ts
async analyze(req: AnalyzeRequest): Promise<FusionResult> {
  // 1. Coletar features (candles multi-TF + book + trades)
  const candles = getMultiTFCandles(req.symbol, ['1m', '5m', '15m']);
  const microstructure = microstructureFeed.getSnapshot(req.symbol);
  
  // 2. Rodar 3 modelos em paralelo
  const [techOut, microOut, regimeOut] = await Promise.all([
    technicalModel.predict({ candles }),
    microstructureModel.predict({ features: microstructure }),
    regimeModel.predict({ candles }),
  ]);
  
  // 3. Combinar via ensemble
  const ensemble = combineEnsemble([techOut, microOut, regimeOut]);
  
  // 4. Aplicar calibração Wilson sobre P(up) do ensemble
  const calibration = calibrateWithWilson({
    p_up: ensemble.probability.up,
    baseline: 0.5, // baseline dinâmico por regime
    sampleSize: getRecentTradeCount(req.symbol, 90), // ~90 dias
  });
  
  // 5. Calcular confluência multi-TF (ensemble por TF)
  const confluence = analyzeConfluence({
    ensembles: ['1m', '5m', '15m'].map(tf => ensemblePerTF(tf)),
    direction: candidateDirection,
  });
  
  // 6. Guards
  const guardState = loadGuardState(req.symbol);
  const guard = evaluateGuards({ state: guardState, atrPct: ..., lastCandleAgeMs: ... });
  
  // 7. Combinar tudo
  return applyRobustnessLayers(ensemble, calibration, confluence, guard);
}
```

### 5.2 Risk layer (novo)

**Arquivo**: `src/risk/position.ts`

**Position sizing** (Kelly fracional, conservador):
```ts
function suggestPositionSize({
  confidence,    // P(up) ou P(down) calibrado
  baseline,      // baseline do regime
  atr_pct,       // volatilidade atual
  bank_size,     // bankroll em USDT (configurável)
}) {
  const edge = Math.abs(confidence - baseline); // ex: 0.6 - 0.5 = 0.10
  const kelly = 2 * edge - Math.pow(edge, 2); // Kelly simplificado
  const fractional_kelly = kelly * 0.25; // 1/4 Kelly (conservador)
  const volatility_adjustment = 1 / Math.max(atr_pct, 0.005); // inversamente proporcional à volatilidade
  const base_size = bank_size * 0.01; // nunca mais que 1% do bank por trade (hard cap)
  const position = base_size * fractional_kelly * Math.min(volatility_adjustment, 1);
  return {
    position_usdt: Math.max(0, Math.min(position, bank_size * 0.02)), // hard cap 2%
    expected_value_pct: edge * 100, // ex: 0.10 → 10%
    risk_reward_ratio: edge / (1 - confidence),
  };
}
```

**Output na down-bar** (nunca execução):
- `EV: +0.42%`
- `Pos sugerida: 1.5% bank ($15.00)`
- `Stop sugerido: 77400` (ATR × 1.5 abaixo da entrada)
- `Take profit: 77850` (ATR × 2 acima)

---

## 6. Aprendizado online com anti-overfitting

### 6.1 Pipeline de re-treino

**Trigger**: a cada **100 trades novos avaliados** OU **a cada 24h** (o que vier primeiro).

**Passos**:
1. Buscar últimos N trades (N=2000, holdout 20% = 400)
2. Re-treinar Platt scaling de cada modelo no **training set (80%)**
3. Re-calibrar pesos do ensemble no **training set**
4. Validar no **holdout set (20%)** — calcular Brier, ECE, win rate
5. Se holdout pior que modelo anterior → rollback + alerta
6. Se holdout melhor → commit novos pesos

### 6.2 Anti-overfitting: técnicas obrigatórias

| Técnica | Como |
|---|---|
| **Holdout fixo** | 20% dos trades mais recentes ficam fora do treino |
| **Regularização L2** | Regressão logística com α=1.0 (não permite coeficientes grandes) |
| **Limite de features** | 10 features por modelo, max (sem neural nets profundas) |
| **Limite de peso** | Pesos do ensemble mudam no máximo 10% por dia |
| **Drift detection** | Se Brier do ensemble piorar 3 dias consecutivos → rollback + alerta |
| **Limite de complexidade** | Random Forest max_depth=8, sem boosting extremo |
| **Walk-forward** | Treino sempre expandindo janela, sem shuffle aleatório |

### 6.3 Drift detection (`src/models/drift_detector.ts`)

```ts
function detectDrift(recentBriers: number[], baselineBrier: number, windowDays: number) {
  // Compara Brier score médio dos últimos N dias vs baseline
  const recent = avg(recentBriers.slice(-windowDays));
  const baseline = baselineBrier;
  const delta = (recent - baseline) / baseline; // ex: +0.20 = 20% pior
  
  if (delta > 0.15) return { drift: true, severity: 'mild', action: 'alert' };
  if (delta > 0.30 && recentBriers.slice(-3).every(b => b > baseline * 1.2) {
    return { drift: true, severity: 'severe', action: 'rollback' };
  }
  return { drift: false, severity: 'none', action: 'none' };
}
```

---

## 7. API e dados expostos

### 7.1 Novas rotas

**GET `/api/analyze`** (atualizado):
```json
{
  "decision": "BUY",
  "score": 0.42,
  "confidence": 0.62,
  "ensemble": {
    "probability": { "up": 0.62, "down": 0.22, "neutral": 0.16 },
    "weights": { "technical": 0.45, "microstructure": 0.35, "regime": 0.20 },
    "brier_per_model": { "technical": 0.21, "microstructure": 0.19, "regime": 0.18 }
  },
  "regime": { "name": "trend_up", "confidence": 0.74 },
  "microstructure": {
    "obi_60s": 0.18,
    "obi_300s": 0.31,
    "trade_aggression_60s": 0.62,
    "book_pressure_5": 0.55,
    "cvd_slope_60s": 0.04
  },
  "calibration": { "ci_lower": 0.55, "actionable": true, "expected_value": 0.12 },
  "guards": { "allowed": true, "reason": null },
  "confluence": { "direction": "up", "agreement_score": 0.85 },
  "position_suggestion": {
    "position_pct_of_bank": 0.015,
    "expected_value_pct": 12.0,
    "stop_suggestion": 77400,
    "take_profit_suggestion": 77850
  },
  "rationale": "Ensemble 62% up (técnico 0.55, micro 0.71, regime confirma). Regime trend_up conf 74%. EV 12%. Pos sugerida 1.5%."
}
```

**GET `/api/analytics/model-drift`** (nova):
```json
{
  "ensemble": {
    "brier_30d_avg": 0.21,
    "brier_baseline": 0.22,
    "drift_detected": false,
    "drift_severity": "none"
  },
  "per_model": {
    "technical": { "brier_30d_avg": 0.23, "calibration_healthy": true },
    "microstructure": { "brier_30d_avg": 0.19, "calibration_healthy": true },
    "regime": { "brier_30d_avg": 0.20, "calibration_healthy": true }
  },
  "last_retrain": "2026-08-29T14:00:00Z",
  "trades_since_retrain": 87
}
```

### 7.2 Schema SQLite novo

```sql
-- Pesos adaptativos do ensemble
CREATE TABLE IF NOT EXISTS ensemble_weights (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  weights_json TEXT NOT NULL,           -- {"technical":0.45,"microstructure":0.35,"regime":0.20}
  baseline_brier_json TEXT NOT NULL,     -- {"technical":0.21,"microstructure":0.19,"regime":0.18}
  trained_at INTEGER NOT NULL,
  sample_size INTEGER NOT NULL,
  holdout_brier REAL
);

-- Histórico de re-treinos
CREATE TABLE IF NOT EXISTS retrain_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trained_at INTEGER NOT NULL,
  trigger TEXT NOT NULL,                 -- "auto_24h" | "auto_100trades" | "manual" | "rollback"
  weights_json TEXT NOT NULL,
  holdout_brier REAL,
  deployed INTEGER NOT NULL DEFAULT 1    -- 0 = rolled back, 1 = active
);

-- Métricas diárias por modelo (drift detection)
CREATE TABLE IF NOT EXISTS model_daily_metrics (
  date TEXT NOT NULL,
  model TEXT NOT NULL,                   -- 'technical' | 'microstructure' | 'regime' | 'ensemble'
  brier REAL,
  win_rate REAL,
  n_trades INTEGER,
  PRIMARY KEY (date, model)
);

-- Drift alerts
CREATE TABLE IF NOT EXISTS drift_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at INTEGER NOT NULL,
  model TEXT NOT NULL,
  severity TEXT NOT NULL,                -- 'mild' | 'severe'
  action_taken TEXT NOT NULL,            -- 'alert' | 'rollback'
  details_json TEXT
);
```

---

## 8. UI

### 8.1 Extensão (down-bar)

Layout (5 colunas → 6 colunas):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● BUY  BTCUSDT  trend_up 1h  ensemble 62% (tech 55% · micro 71%)        │
│        EV +12%  pos 1.5% bank  stop 77400  tp 77850    [⟳] [Auto] [─]  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Novos elementos**:
- Chip de regime (`trend_up`, `range`, etc) com cor por classe
- Ensemble % com breakdown dos 3 modelos (visualização opcional, on-hover)
- EV com sinal (+/-)
- Pos sugerida (% do bank)
- Stop e take profit sugeridos (linha base + ATR)

### 8.2 Vitrine (web)

**Nova seção** entre Calibração e Shadow trading:

**`#performance`** — Performance pública do motor:
- Win rate últimos 30d / 90d
- Sharpe anualizado
- Max drawdown
- Brier score e ECE
- Gráfico simples de PnL acumulado (linha SVG)
- Disclaimer: "resultados passados não garantem performance futura"

---

## 9. Critérios de aceite ("motor acertivo")

O motor é considerado **acertivo** quando, simultaneamente, em janela de **30+ dias consecutivos** de paper trading:

| Métrica | Threshold |
|---|---|
| Win rate | **> 53%** |
| EV/trade (após spread) | **> 0.15%** |
| Sharpe anualizado | **> 1.5** |
| Max drawdown | **< 8%** |
| Calibração (ECE) | **< 0.05** |

**Regra de rollback**: se **2 dos 5 thresholds** falharem por **14 dias consecutivos**, o motor vira WAIT permanente até revisão manual.

---

## 10. Cronograma

| Semana | Entrega | Validação |
|---|---|---|
| **1-2** | Modelo técnico refator (10 features). Dataset Binance Vision 90d carregado. | Backtest OOS Brier < 0.25 |
| **3** | WebSocket Binance (book + aggTrades). Modelo microestrutura. | Brier vs técnico sozinho |
| **4** | Modelo regime (Random Forest). 5 classes. | Acurácia > 60% em holdout |
| **5** | Ensemble Bayesiano. Pesos adaptativos. | Sharpe ensemble > melhor modelo sozinho |
| **6** | Integração com 5 camadas existentes. Position sizing. | Smoke tests E2E |
| **7** | Aprendizado online + drift detection. UI do ensemble. | Rollback funciona em drift simulado |
| **8** | Validação 14 dias paper trading. Documentação final. | Critérios §9 atingidos |

---

## 11. Riscos e mitigações

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Ensemble overfita no histórico | Alta | Alto (sinais perfeitos in-sample, lixo OOS) | Holdout 20%, regularização pesos, drift detection, limite de features |
| Binance bloquear IP Vercel (HTTP 451) | Já acontece | Alto | Backend Node local como caminho completo |
| Cold start Vercel 1-3s | Alta | Médio | Cron pré-aquece, cache de book, modo degraded |
| WebSocket desconecta | Alta | Médio | Reconexão automática, alerta > 30s offline |
| Dataset book/aggTrades indisponível | Média | Alto | Binance Vision tem; fallback klines 1m |
| Custo Anthropic subir | Baixa | Baixo | Plano Free roda só com backtest + Wilson |
| CRON hit em deploy cold | Média | Médio | Cron + status; se falhar vira WAIT |

---

## 12. Deployment

| Ambiente | Função | Endereço |
|---|---|---|
| **Dev local** | Debug, testes manuais | `npm run dev` |
| **Staging (Vercel preview)** | Cada push vira preview URL com dados sintéticos | automático |
| **Produção (Vercel Free)** | Cron job 1min chama `/api/analyze`. WebSocket limitado a 10s por function. | `tracecom.consecom.com.br` |
| **Produção (Node opcional, $5/mês)** | WebSocket persistente, latência < 100ms, sem timeout | VPS do usuário |

---

## 13. Out-of-scope (explícito)

1. **Auto-execution na corretora**: TRACECON nunca clica em nada. Usuário decide.
2. **Integração via API de corretoras**: extensão só mostra sinal, não opera.
3. **Trading de futuros/margem**: foco em spot.
4. **UI mobile nativa**: desktop é o alvo (extensão Chrome desktop).
5. **Backtesting em GPU**: modelos CPU-friendly (~1ms/inferência).
6. **Suporte a corretoras além de TradingView/Binance/Exodus**.

---

## 14. Resumo em uma frase

Ensemble Bayesiano de 3 modelos (técnico + microestrutura + regime) com calibração Wilson online, anti-overfitting agressivo, alvo win rate 53%+ em 30+ dias de paper trading.

---

## 15. Próximo passo

Após revisão e aprovação desta spec, invocar `writing-plans` skill para gerar plano de implementação detalhado.
