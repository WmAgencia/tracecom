import { deepFreeze } from "./features.mjs";

const out = (specialist, features, { domainAssessment, supportingEvidence = [], counterEvidence = [], blockers = [], summary }) => deepFreeze({
  specialist,
  featuresVersion: features.version,
  featuresAt: features.at,
  domainAssessment,
  supportingEvidence,
  counterEvidence,
  blockers,
  summary,
});

export function rsiSpecialist(features) {
  const { structure, rsi } = features;
  if (structure === "UPTREND" && (rsi.zone === "LOW" || rsi.zone === "OVERSOLD")) {
    return out("rsi", features, { domainAssessment: "BULLISH_PULLBACK", supportingEvidence: ["uptrend com RSI em zona baixa"], summary: `RSI ${Math.round(rsi.value)} em uptrend` });
  }
  if (structure === "DOWNTREND" && (rsi.zone === "HIGH" || rsi.zone === "OVERBOUGHT")) {
    return out("rsi", features, { domainAssessment: "BEARISH_PULLBACK", supportingEvidence: ["downtrend com RSI em zona alta"], summary: `RSI ${Math.round(rsi.value)} em downtrend` });
  }
  if (structure === "UPTREND" && rsi.zone === "OVERBOUGHT") {
    return out("rsi", features, { domainAssessment: "BULLISH_EXTREME", counterEvidence: ["sobrecomprado no uptrend"], summary: `RSI ${Math.round(rsi.value)} sobrecomprado` });
  }
  if (structure === "DOWNTREND" && rsi.zone === "OVERSOLD") {
    return out("rsi", features, { domainAssessment: "BEARISH_EXTREME", counterEvidence: ["sobrevendido no downtrend"], summary: `RSI ${Math.round(rsi.value)} sobrevendido` });
  }
  return out("rsi", features, { domainAssessment: "NEUTRAL", summary: `RSI ${Math.round(rsi.value)} neutro` });
}

export function dmiSpecialist(features) {
  const { dmi } = features;
  if (dmi.adx === null) return out("dmi", features, { domainAssessment: "UNKNOWN", blockers: ["ADX_UNKNOWN"], summary: "ADX indisponivel" });
  if (!dmi.trending) return out("dmi", features, { domainAssessment: "WEAK_TREND", blockers: ["ADX_RANGE"], summary: `ADX ${Math.round(dmi.adx)} sem tendencia` });
  if (dmi.plusDi > dmi.minusDi) return out("dmi", features, { domainAssessment: "TREND_UP", supportingEvidence: ["ADX>=20 com +DI dominante"], summary: `ADX ${Math.round(dmi.adx)} +DI ${Math.round(dmi.plusDi)}` });
  return out("dmi", features, { domainAssessment: "TREND_DOWN", supportingEvidence: ["ADX>=20 com -DI dominante"], summary: `ADX ${Math.round(dmi.adx)} -DI ${Math.round(dmi.minusDi)}` });
}

export function bollingerSpecialist(features) {
  const { bollinger, structure } = features;
  if (!bollinger) return out("bollinger", features, { domainAssessment: "UNKNOWN", blockers: ["BOLLINGER_UNKNOWN"], summary: "Bollinger indisponivel" });
  const counter = [];
  if (structure === "UPTREND" && bollinger.percentB > 0.95) counter.push("preco colado na banda superior");
  if (structure === "DOWNTREND" && bollinger.percentB < 0.05) counter.push("preco colado na banda inferior");
  if (bollinger.percentB > 0.8) return out("bollinger", features, { domainAssessment: "WALK_UP", supportingEvidence: [bollinger.expanding ? "bandas expandindo na alta" : "faixa superior"], counterEvidence: counter, summary: `%B ${Math.round(bollinger.percentB * 100)}` });
  if (bollinger.percentB < 0.2) return out("bollinger", features, { domainAssessment: "WALK_DOWN", supportingEvidence: [bollinger.expanding ? "bandas expandindo na baixa" : "faixa inferior"], counterEvidence: counter, summary: `%B ${Math.round(bollinger.percentB * 100)}` });
  return out("bollinger", features, { domainAssessment: bollinger.expanding ? "EXPANDING" : "COMPRESSED", counterEvidence: counter, summary: `%B ${Math.round(bollinger.percentB * 100)}` });
}

export function atrSpecialist(features) {
  const { atr, volRatio } = features;
  if (!atr || volRatio === null) return out("atr", features, { domainAssessment: "UNKNOWN", blockers: ["ATR_UNKNOWN"], summary: "ATR indisponivel" });
  if (volRatio > 2.5) return out("atr", features, { domainAssessment: "EXPANDING", blockers: ["ATR_EXPANDING"], summary: `volRatio ${volRatio}` });
  if (volRatio < 0.5) return out("atr", features, { domainAssessment: "DEAD", blockers: ["ATR_DEAD"], summary: `volRatio ${volRatio}` });
  return out("atr", features, { domainAssessment: "ALIVE", supportingEvidence: ["volatilidade em faixa operavel"], summary: `volRatio ${volRatio}` });
}

export function priceActionSpecialist(features) {
  const { priceAction, structure, at } = features;
  const recent = (event) => event && at - event.at <= 5 * 60_000;
  if (priceAction.pullback?.depth === "STRUCTURE_THREATENING") {
    return out("priceAction", features, { domainAssessment: "STRUCTURE_THREATENING", blockers: ["STRUCTURE_THREATENING"], summary: "pullback ameaca a estrutura" });
  }
  if (priceAction.lastCHoCH && recent(priceAction.lastCHoCH) && ((priceAction.lastCHoCH.type === "CHOCH_DOWN" && structure === "UPTREND") || (priceAction.lastCHoCH.type === "CHOCH_UP" && structure === "DOWNTREND"))) {
    return out("priceAction", features, { domainAssessment: "REVERSAL_WARNING", blockers: ["CHOCH_AGAINST"], summary: `${priceAction.lastCHoCH.type} recente contra a estrutura` });
  }
  if (priceAction.pullback?.active === true && ["SHALLOW", "NORMAL"].includes(priceAction.pullback.depth) && structure !== "RANGE") {
    return out("priceAction", features, { domainAssessment: "PULLBACK_HOLDING", supportingEvidence: [`pullback ${priceAction.pullback.depth} em ${structure}`], summary: `pullback ${priceAction.pullback.depth}` });
  }
  if (priceAction.lastBOS && recent(priceAction.lastBOS)) {
    return out("priceAction", features, { domainAssessment: priceAction.lastBOS.type === "BOS_UP" ? "STRUCTURE_BREAK_UP" : "STRUCTURE_BREAK_DOWN", supportingEvidence: [`${priceAction.lastBOS.type} recente`], summary: priceAction.lastBOS.type });
  }
  return out("priceAction", features, { domainAssessment: "NEUTRAL", summary: "sem sinal de price action" });
}

export function runSpecialists(features) {
  if (!features) return null;
  return [rsiSpecialist(features), dmiSpecialist(features), bollingerSpecialist(features), atrSpecialist(features), priceActionSpecialist(features)];
}
