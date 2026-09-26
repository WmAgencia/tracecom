/**
 * CRYPTO CONSENSUS (CRYPTO_CONSENSUS_V1) — 6 engines deterministicos + 1 LLM final.
 * O LLM responde LONG | SHORT | NO_TRADE (nunca APPROVE_BUY/APPROVE_SELL de binaria).
 * Prompt SEPARADO da Binary V3. RSI e contexto; numero nunca inventado pelo LLM.
 */
export const CRYPTO_CONSENSUS_VERSION = "crypto-consensus-v1";

export const CRYPTO_CONSENSUS_ROLE = "CRYPTO_CONSENSUS";
export const CRYPTO_CONSENSUS_MODEL = process.env.CRYPTO_CONSENSUS_MODEL || "openai/gpt-oss-120b";

export const CRYPTO_AGENT_ROLES = Object.freeze(["RSI", "DMI_ADX", "BOLLINGER", "ATR", "PRICE_ACTION", "ASSET"]);

/** Engines deterministicos (codigo puro). Cada um devolve assessment estruturado. */
export function cryptoDeterministicEngines({ regime, indicators, structure, setup, symbol }) {
  const rsi = indicators?.rsi ?? {};
  const adx = indicators?.adx ?? {};
  const boll = indicators?.bollinger ?? {};
  const atr = indicators?.atr ?? {};
  const emas = indicators?.emas ?? {};

  const RSI = {
    role: "RSI",
    assessment: `${rsi.rsi ?? 0} (${rsi.zone ?? "NEUTRAL"}) — contexto de momentum, NAO sinal isolado.`,
    stance: rsi.zone === "OVERBOUGHT" && setup?.side === "LONG" ? "CAUTION" : rsi.zone === "OVERSOLD" && setup?.side === "SHORT" ? "CAUTION" : "NEUTRAL",
    zone: rsi.zone ?? "NEUTRAL",
  };
  const DMI_ADX = {
    role: "DMI_ADX",
    assessment: `ADX ${adx.adx ?? 0}, DMI+ ${adx.plusDi ?? 0} / DMI- ${adx.minusDi ?? 0}, dominancia ${adx.dominance ?? "NONE"}.`,
    stance: (adx.adx ?? 0) >= 25 ? (adx.dominance === "PLUS" ? "TREND_UP" : "TREND_DOWN") : "WEAK",
  };
  const BOLLINGER = {
    role: "BOLLINGER",
    assessment: `Largura ${boll.width ?? 0}, percentB ${boll.percentB ?? 0}.`,
    stance: (boll.percentB ?? 0.5) > 0.9 ? "OVERBOUGHT" : (boll.percentB ?? 0.5) < 0.1 ? "OVERSOLD" : "MID",
  };
  const ATR = {
    role: "ATR",
    assessment: `ATR ${atr.atr ?? 0} (percentil ${atr.percentile ?? 0}%), expansao ${atr.expansion === true}, contracao ${atr.contraction === true}.`,
    stance: atr.expansion === true ? "HIGH_VOL" : atr.contraction === true ? "LOW_VOL" : "NORMAL",
  };
  const PRICE_ACTION = {
    role: "PRICE_ACTION",
    assessment: `Estrutura ${structure?.uptrend ? "HH/HL" : structure?.downtrend ? "LH/LL" : "mista"}; setup ${setup?.reason ?? "none"}${setup?.candidate ? ` (${setup.candidate.side}, R:R ${setup.candidate.rr})` : ""}.`,
    stance: setup?.candidate?.side === "LONG" ? "BULLISH" : setup?.candidate?.side === "SHORT" ? "BEARISH" : "FLAT",
    setup: setup?.reason ?? "NO_SETUP",
    rr: setup?.candidate?.rr ?? null,
  };
  const ASSET = {
    role: "ASSET",
    assessment: `${symbol} — regime ${regime}, setup ${setup?.reason ?? "NO_SETUP"}${setup?.candidate ? ` ${setup.candidate.side} entry ${setup.candidate.entry} stop ${setup.candidate.stop} target ${setup.candidate.target}` : ""}.`,
    stance: setup?.candidate?.side === "LONG" ? "LONG_CANDIDATE" : setup?.candidate?.side === "SHORT" ? "SHORT_CANDIDATE" : "NO_CANDIDATE",
    regime,
  };
  return { RSI, DMI_ADX, BOLLINGER, ATR, PRICE_ACTION, ASSET };
}

/** Prompt SEPARADO da Binary V3 — decisao LONG/SHORT/NO_TRADE com contexto completo. */
export function cryptoConsensusPrompt({ symbol, timeframe, regime, trendDirection, structure, indicators, setup, engines, paper }) {
  return [
    `Voce e o CONSENSUS de cripto do TraceCom (CRYPTO_CONSENSUS_V1). Mercado real 24/7, ${paper ? "execucao PAPER" : "execucao BLOQUEADA"}.`,
    `SYMBOL: ${symbol}`,
    `TIMEFRAME (contexto/setup/timing): 15m/5m/1m`,
    `REGIME: ${regime}`,
    `TREND: ${trendDirection ?? "NONE"}`,
    `STRUCTURE: ${JSON.stringify(structure ?? {})}`,
    `RSI: ${indicators?.rsi?.rsi ?? 0} (${indicators?.rsi?.zone ?? "NEUTRAL"})`,
    `DMI/ADX: ADX ${indicators?.adx?.adx ?? 0}, DMI+ ${indicators?.adx?.plusDi ?? 0}, DMI- ${indicators?.adx?.minusDi ?? 0}`,
    `ATR: ${indicators?.atr?.atr ?? 0} (percentil ${indicators?.atr?.percentile ?? 0}%)`,
    `BOLLINGER: largura ${indicators?.bollinger?.width ?? 0}, percentB ${indicators?.bollinger?.percentB ?? 0}`,
    `PRICE ACTION: ${PRICE_ACTION_TEXT}`,
    `SETUP CANDIDATO: ${setup?.candidate ? `${setup.candidate.side} entry=${setup.candidate.entry} stop=${setup.candidate.stop} target=${setup.candidate.target} rr=${setup.candidate.rr}` : "nenhum"}`,
    `SUPPORT/RESISTANCE: low=${structure?.recentLow ?? "?"} high=${structure?.recentHigh ?? "?"}`,
    `RISK/REWARD: ${setup?.candidate?.rr ?? 0}`,
    `COUNTER-CASE: se a estrutura for violada (CHoCH/invalidacao), o trade esta errado.`,
    `INVALIDATION: stop estrutural violado => posicao encerrada.`,
    `ENGINES DETERMINISTICOS: ${JSON.stringify(Object.values(engines).map((e) => ({ role: e.role, stance: e.stance })))}`,
    ``,
    `Responda APENAS JSON: {"result": "LONG" | "SHORT" | "NO_TRADE", "confidence": 0..1, "thesis": "resumo curto", "counterCase": "risco principal", "invalidation": "condicao que invalida"}`,
    `REGRA: nunca invente numeros; use somente os fornecidos. RSI sozinho nao e sinal.`,
  ].join("\n");
}
const PRICE_ACTION_TEXT = "estrutura e setup descritos nos engines determinísticos (codigo calcula; voce apenas interpreta).";

/** Valida a resposta do LLM (fail-closed: qualquer shape invalido => NO_TRADE). */
export function parseCryptoConsensus(text) {
  if (typeof text !== "string") return { ok: false, reason: "NOT_STRING" };
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* fallback abaixo */ }
  if (!parsed || typeof parsed !== "object") {
    const match = String(text).match(/\{(?:[^{}]|"[^"]*")*\}/);
    if (match) { try { parsed = JSON.parse(match[0]); } catch { return { ok: false, reason: "INVALID_JSON" }; } }
  }
  const result = String(parsed?.result ?? "").toUpperCase();
  if (!["LONG", "SHORT", "NO_TRADE"].includes(result)) return { ok: false, reason: "INVALID_RESULT" };
  const confidence = Number(parsed.confidence);
  return {
    ok: true,
    result,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    thesis: String(parsed.thesis ?? "").slice(0, 480),
    counterCase: String(parsed.counterCase ?? "").slice(0, 480),
    invalidation: String(parsed.invalidation ?? "").slice(0, 480),
  };
}