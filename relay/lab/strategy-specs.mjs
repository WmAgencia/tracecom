/**
 * LAB 6 STRATEGIES — StrategySpecs CONGELADAS (PRACTICE-only).
 * Nenhum threshold/periodo pode mudar depois de T0 (bug tecnico: registrar e reavaliar amostra).
 * marketSnapshotSchema: consensus-market-snapshot-v1 + lab-ext (ema/macd/stochastic/fib/atrNormalized).
 */
import crypto from "node:crypto";

export const LAB_VERSION = "lab6-v1";
export const LAB_STAKE_POLICY = Object.freeze({ fixedStake: true, source: "runtime.config.defaultStake", cap: "hardCap", martingale: false, progression: false });
export const LAB_EXPIRY_POLICY = Object.freeze({ type: "BINARY_NEXT_MINUTE", horizonSeconds: 60, revalidation: "FINAL_WINDOW_1S", safeCutoffMs: 7000 });
export const LAB_SETTLEMENT_CAP = 20;

const S01 = {
  id: "S01_RSI_REVERSAL", version: "lab-s01-v1",
  hypothesis: "Movimento extremo de momentum pode produzir reversao, mas RSI extremo sozinho nao autoriza ordem.",
  specialists: ["rsi", "bollinger", "dmi_adx", "price_action"],
  parameters: { rsiPeriod: 14, rsiSellMin: 73, rsiBuyMax: 28, bollinger: [20, 2], dmiPeriod: 14, adxPeriod: 14 },
  entry: "RSI abre oportunidade; exige rejeicao/reentrada Bollinger + Price Action revertendo + DI antigo enfraquecendo + DI oposto reagindo (ou nova dominancia).",
  hardBlockers: ["PRICE_ACTION_CONTINUACAO", "BOLLINGER_BAND_RIDING_CONTINUACAO", "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", "RSI_ACELERANDO_COM_CONTINUACAO"],
  softCounterEvidence: ["BOLLINGER_SEM_REJEICAO_REENTRADA", "DMI_ADX_SEM_TRANSICAO", "PRICE_ACTION_SEM_REVERSAO"],
  consensus: "consensus-decisor-v1 (sintese semantica, sem votacao)",
};
const S02 = {
  id: "S02_MACD_MOMENTUM", version: "lab-s02-v1",
  hypothesis: "Procurar o nascimento/retomada de impulso direcional em vez de prever o fim do movimento.",
  specialists: ["macd", "price_action", "dmi_adx"],
  parameters: { macd: { fast: 12, slow: 26, signal: 9 }, histogramSlopeWindow: 3, weakCrossThresholdAtr: 0.15 },
  entry: "BUY: cruzamento/assuncao acima da Signal + histograma melhorando + estrutura nao contradiz + pressao direcional coerente. SELL espelho.",
  hardBlockers: ["PRICE_ACTION_CONTRA_CONTINUACAO", "DMI_ADX_CONTRADIR_MOMENTUM", "MACD_RANGE_WHIPSAW"],
  softCounterEvidence: ["MACD_HISTOGRAM_FRACO", "PRICE_ACTION_SEM_FOLLOW_THROUGH"],
  consensus: "lab-macd-consensus-v1",
};
const S03 = {
  id: "S03_EMA_PULLBACK_TREND", version: "lab-s03-v1",
  hypothesis: "Em tendencia estabelecida, pullback pode fornecer entrada na RETOMADA (9/21 como hipotese experimental de curto prazo).",
  specialists: ["ema_trend", "pullback", "dmi_adx", "volatility"],
  parameters: { emaFast: 9, emaSlow: 21, atrPeriod: 14, deadMarketRatio: 0.3, noisyMarketRatio: 2.5 },
  entry: "TREND + PULLBACK + RESUMPTION. Nao entra apenas porque EMA9>EMA21.",
  hardBlockers: ["TREND_BREAK_SLOW_EMA", "PULLBACK_SEM_RETOMADA", "DMI_ADX_CONTRADIR_TENDENCIA", "VOLATILITY_DEAD_MARKET"],
  softCounterEvidence: ["VOLATILITY_NOISY", "EMA_SLOPES_DIVERGENTES"],
  consensus: "lab-ema-consensus-v1",
};
const S04 = {
  id: "S04_BOLLINGER_MEAN_REVERSION", version: "lab-s04-v1",
  hypothesis: "Extensao estatistica seguida de rejeicao/reentrada pode representar retorno a regiao media (Bollinger = gatilho principal).",
  specialists: ["bollinger", "price_action", "momentum", "dmi_adx"],
  parameters: { bollinger: [20, 2], reversalEvidenceMin: 0.35, rsiContextOnly: true },
  entry: "Excursao na banda + rejeicao/reentrada + confirmacao de Price Action. TOUCH/OUTSIDE NAO SAO SINAL.",
  hardBlockers: ["BAND_RIDING", "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", "PRICE_ACTION_CONTRA_REVERSAO"],
  softCounterEvidence: ["MOMENTUM_ACELERANDO_CONTRA", "PRICE_ACTION_SEM_REVERSAO"],
  consensus: "lab-bollinger-consensus-v1",
};
const S05 = {
  id: "S05_STOCHASTIC_REVERSAL", version: "lab-s05-v1",
  hypothesis: "Posicao do fechamento no range recente pode mostrar perda de momentum em extremos (Fast %K14 / %D SMA3).",
  specialists: ["stochastic", "price_action", "bollinger", "dmi_adx"],
  parameters: { kPeriod: 14, dPeriod: 3, overbought: 80, oversold: 20, reversalEvidenceMin: 0.35, divergence: "SECONDARY_EVIDENCE_ONLY" },
  entry: "Extremo + vira + cruza/retorna + confirmacao de preco + sem continuacao forte contra.",
  hardBlockers: ["DMI_ADX_CONTRADIR_REVERSAO", "PRICE_ACTION_CONTRA_REVERSAO", "STOCHASTIC_SEM_VIRADA"],
  softCounterEvidence: ["STOCHASTIC_STILL_EXTREME", "BOLLINGER_SEM_CONTEXTO"],
  consensus: "lab-stochastic-consensus-v1",
};
const S06 = {
  id: "S06_RSI_FIBONACCI_REVERSAL", version: "lab-s06-v1",
  hypothesis: "RSI extremo ganha contexto quando a reversao ocorre em zona estrutural de Fibonacci (38.2/50/61.8) de swing causal confirmado.",
  specialists: ["rsi", "fibonacci", "price_action", "bollinger", "dmi_adx"],
  parameters: { rsiPeriod: 14, rsiSellMin: 73, rsiBuyMax: 28, fibLevels: ["38.2", "50.0", "61.8"], fibContextLevel: "23.6", swingPivot: 3, zoneToleranceAtr: 0.5, zoneBrokenBeyondAnchor: true },
  entry: "S01 (RSI + confirmacoes) E preco em zona Fibonacci com reacao (ZONE_REACTION).",
  hardBlockers: ["FIB_FORA_DE_ZONA", "FIB_ZONE_BROKEN", "FIB_SEM_REACAO", "PRICE_ACTION_CONTINUACAO", "BOLLINGER_BAND_RIDING_CONTINUACAO", "DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO", "RSI_ACELERANDO_COM_CONTINUACAO"],
  softCounterEvidence: ["BOLLINGER_SEM_REJEICAO_REENTRADA", "DMI_ADX_SEM_TRANSICAO", "PRICE_ACTION_SEM_REVERSAO"],
  consensus: "lab-rsi-fib-consensus-v1",
  comparisonNote: "S06 deve ser comparada com S01 para medir se Fibonacci filtrou losses/wins e mudou frequencia/timing.",
};

export const LAB_STRATEGY_SPECS = Object.freeze([S01, S02, S03, S04, S05, S06]);
export const LAB_STRATEGY_IDS = Object.freeze(LAB_STRATEGY_SPECS.map((s) => s.id));
export function labSpecsCanonical() { return JSON.stringify({ version: LAB_VERSION, stakePolicy: LAB_STAKE_POLICY, expiryPolicy: LAB_EXPIRY_POLICY, settlementCap: LAB_SETTLEMENT_CAP, strategies: LAB_STRATEGY_SPECS }); }
export function labSpecsHash() { return crypto.createHash("sha256").update(labSpecsCanonical()).digest("hex"); }
