/**
 * AGENTE CONSENSO — especialista senior. Recebe o MESMO snapshot + as opinioes estruturadas dos 5 agentes.
 * Sintese semantica (NUNCA votacao). Regras profissionais documentadas em docs/research/agentic-rsi-fib.md.
 * Saida: BUY | SELL | WAIT + supporting/counter/reason/evidenceStrength (descritivo, nunca probabilidade).
 */
export const CONSENSUS_AGENT_VERSION = "agent-consensus-v1";
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const VETO_SEVERITY = Object.freeze({ MOVIMENTO_CONSTANTE_CONTRA: 8, SEM_CONFIRMACAO_REVERSAO: 99, STOCH_SEM_EXTREMO: 99, SQUEEZE_SEM_REVERSAO: 99, CANDLE_GATE_SEM_REVERSAO: 99, FIB_LEG_INCOMPATIVEL: 1, FIB_ZONE_BROKEN: 2, ATR_MOVIMENTO_CLIMATICO: 3, RSI_REGIME_CONTRA_FRACA: 3, ADX_TENDENCIA_ANTIGA_FORTALECENDO: 4, ADX_PRECO_CONTRA_TENDENCIA: 4, ATR_EXPANDINDO_CONTRA: 4, RSI_EXTREMO_ACELERANDO: 5, CANDLE_CONTRA: 5, CANDLE_CONTRA_TENDENCIA: 5, BOLLINGER_BW_EXPANDINDO_CONTRA: 5, ATR_MERCADO_MORTO: 6, BOLLINGER_WALK_CONTRA: 7, RSI_REGIME_CONTRA: 7, ADX_DI_CONTRA: 7 });
const MISSING_SEVERITY = Object.freeze({ "LOCALIZACAO(Bollinger OU Fib)": 3, ATR: 4, ADX: 5, RSI_QUALIDADE: 6 });
const safetyOf = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(100, Number(v))) : 100);
const budgetOf = (safety) => (safety >= 100 ? 0 : safety <= 0 ? 99 : Math.floor((100 - safety) / 5));
const tolerate = (items, budget, severityOf) => {
  const sorted = [...items].sort((a, b) => severityOf(a) - severityOf(b));
  const tolerated = []; const blocking = []; let used = 0;
  for (const item of sorted) {
    const cost = severityOf(item);
    if (used + cost <= budget) { used += cost; tolerated.push(item); } else blocking.push(item);
  }
  return { tolerated, blocking, used };
};

export function runConsensusAgent({ snapshot, opinions, safetyPct = 100, filters = null } = {}) {
  const safety = safetyOf(safetyPct);
  const budget = budgetOf(safety);
  const snapshotId = snapshot?.snapshotId ?? null;
  const at = snapshot?.at ?? Date.now();
  const rsi = opinions?.rsi ?? null; const bollinger = opinions?.bollinger ?? null; const adx = opinions?.adx ?? null;
  const atr = opinions?.atr ?? null; const fib = opinions?.fib ?? null; const candle = opinions?.candle ?? null;
  const base = { agent: "CONSENSUS", version: CONSENSUS_AGENT_VERSION, snapshotId, at, decision: "WAIT", side: null, evidenceStrength: 0, supportingEvidence: [], counterEvidence: [], reason: "", conversation: [] };
  if (!rsi?.trigger) return { ...base, reason: `Sem oportunidade: RSI ${rsi?.rsi ?? "-"} fora de 70/30.`, conversation: buildConversation(opinions) };

  const side = rsi.side; const buy = side === "BUY";
  const supportingEvidence = []; const counterEvidence = [];
  const sideAdx = adx?.perSide?.[side] ?? null;
  const oppositeAdx = adx?.perSide?.[buy ? "SELL" : "BUY"] ?? null;

  if (atr?.state === "DEAD") counterEvidence.push({ code: "ATR_MERCADO_MORTO", detail: `ratio ${atr.ratio}` });
  if (atr?.climactic === true) counterEvidence.push({ code: "ATR_MOVIMENTO_CLIMATICO", detail: "volatilidade climatica com tendencia forte" });
  if (atr?.volTrend === "EXPANDING") counterEvidence.push({ code: "ATR_EXPANDINDO_CONTRA", detail: `volatilidade expandindo ${atr.volRatio}x (movimento com forca: fade arriscado)` });
  if (bollinger?.walkSide === (buy ? "LOWER" : "UPPER")) counterEvidence.push({ code: "BOLLINGER_WALK_CONTRA", detail: `preco caminhando na banda ${bollinger.walkSide.toLowerCase()} contra a tese` });
  if (bollinger?.walkSide === (buy ? "LOWER" : "UPPER") && bollinger?.bwTrend === "EXPANDING") counterEvidence.push({ code: "BOLLINGER_BW_EXPANDINDO_CONTRA", detail: "walk com bandwidth expandindo (walk forte: nao fade)" });
  else if (bollinger?.walkSide === (buy ? "LOWER" : "UPPER") && bollinger?.bwTrend === "CONTRACTING") supportingEvidence.push({ code: "BOLLINGER_WALK_EXAURINDO", detail: "walk perdendo bandwidth (exaustao a favor da reversao)" });
  if (buy && bollinger?.state === "EXPANSION" && bollinger?.position !== null && bollinger.position < 0.2 && bollinger?.rejection !== "LOWER") counterEvidence.push({ code: "BOLLINGER_FORA_INFERIOR", detail: "fechando fora da banda inferior sem reentrada" });
  if (!buy && bollinger?.state === "EXPANSION" && bollinger?.position !== null && bollinger.position > 0.8 && bollinger?.rejection !== "UPPER") counterEvidence.push({ code: "BOLLINGER_FORA_SUPERIOR", detail: "fechando fora da banda superior sem reentrada" });
  if (sideAdx?.oldStrengthening === true) counterEvidence.push({ code: "ADX_TENDENCIA_ANTIGA_FORTALECENDO", detail: "tendencia antiga (contra a tese) fortalecendo com ADX subindo" });
  if (rsi.state === "EXTREME_ACCELERATING") counterEvidence.push({ code: "RSI_EXTREMO_ACELERANDO", detail: `slope ${rsi.rsi} acelerando para o extremo` });
  if (fib?.state === "ZONE_BROKEN") counterEvidence.push({ code: "FIB_ZONE_BROKEN", detail: "anchor do leg perdido" });
  if (fib?.state === "OUT_OF_ZONE") counterEvidence.push({ code: "FIB_FORA_DE_ZONA", detail: "fora das zonas 38.2/50.0/61.8" });
  if (["AT_EXTREME", "IN_RETRACEMENT", "IN_ZONE"].includes(fib?.state)) counterEvidence.push({ code: "FIB_SEM_REACAO", detail: "sem reacao no extremo/zona ainda" });

  const constancia = detectConstantMove({ snapshot, side, atrNormalized: atr?.atrNormalized, adxValue: adx?.adx, adxSlope: adx?.adxSlope });
  if (constancia.constant) counterEvidence.push({ code: "MOVIMENTO_CONSTANTE_CONTRA", detail: constancia.detail });

  if (filters?.confirmation === true) {
    const candles = Array.isArray(snapshot?.recentCandles) ? snapshot.recentCandles : [];
    const last = candles[candles.length - 1] ?? null;
    const candleTurned = last ? (buy ? Number(last.close) > Number(last.open) : Number(last.close) < Number(last.open)) : false;
    const crossback = rsi?.crossback === true;
    if (!candleTurned && !crossback) counterEvidence.push({ code: "SEM_CONFIRMACAO_REVERSAO", detail: "ultimo candle 5s ainda contra a tese e RSI sem crossback" });
  }
  if (filters?.noSqueeze === true) {
    const isSqueeze = bollinger?.squeeze === true || String(bollinger?.regime ?? bollinger?.state ?? "").toUpperCase() === "SQUEEZE";
    if (isSqueeze) counterEvidence.push({ code: "SQUEEZE_SEM_REVERSAO", detail: "Bollinger em squeeze (risco de breakout contra a reversao)" });
  }
  if (filters?.stochastic === true) {
    const stoch = snapshot?.indicators?.stochastic ?? null;
    const k = Number(stoch?.k);
    const kLag = Number(stoch?.kLag);
    if (Number.isFinite(k)) {
      const zoneOk = buy ? (k <= 25 && (!Number.isFinite(kLag) || k > kLag)) : (k >= 75 && (!Number.isFinite(kLag) || k < kLag));
      if (!zoneOk) counterEvidence.push({ code: "STOCH_SEM_EXTREMO", detail: "k " + k.toFixed(1) + " d " + String(stoch?.d ?? "-") + " kLag " + (Number.isFinite(kLag) ? kLag.toFixed(1) : "-") });
    }
  }

  const rsiQuality = Boolean(rsi.divergence || rsi.failureSwing || rsi.crossback);
  if (rsiQuality) supportingEvidence.push({ code: "RSI_QUALIDADE", detail: rsi.divergence ? `divergencia ${rsi.divergence.toLowerCase()}` : rsi.failureSwing ? `failure swing ${rsi.failureSwing.toLowerCase()}` : "crossback do extremo" });
  else counterEvidence.push({ code: "RSI_SEM_QUALIDADE", detail: "extremo sem divergencia/failure swing/crossback (apenas alerta)" });
  if (rsi.line50Ok !== true) counterEvidence.push({ code: "RSI_LINHA_50_CONTRA", detail: `rsi ${rsi.rsi} contra o filtro da linha 50` });

  const bollingerSupports = Boolean(bollinger?.rejection && ((buy && bollinger.rejection === "LOWER") || (!buy && bollinger.rejection === "UPPER"))) || bollinger?.regime === "RANGE";
  if (bollingerSupports) supportingEvidence.push({ code: "BOLLINGER_SUPORTE", detail: bollinger.rejection ? `rejeicao ${bollinger.rejection.toLowerCase()}` : "regime de range" });
  else counterEvidence.push({ code: "BOLLINGER_SEM_SUPORTE", detail: `regime ${bollinger?.regime ?? "?"} sem rejeicao a favor` });

  if (candle?.structure === "CONTINUATION" && candle.direction && candle.direction !== side) {
    counterEvidence.push({ code: "CANDLE_CONTRA", detail: `candles/price action em continuacao ${candle.direction.toLowerCase()} (${candle.state ?? "-"})` });
  } else if (candle?.structure === "REVERSAL" && candle.direction === side) {
    supportingEvidence.push({ code: "CANDLE_SUPORTE", detail: `padrao de reversao ${candle.state ?? "-"} a favor de ${side}` });
  } else if (candle?.rejection && ((buy && candle.rejection === "LOWER") || (!buy && candle.rejection === "UPPER"))) {
    supportingEvidence.push({ code: "CANDLE_REJEICAO", detail: `rejeicao de candle ${candle.rejection.toLowerCase()}` });
  } else if (candle && candle.structure === "UNCLEAR") {
    counterEvidence.push({ code: "CANDLE_SEM_LEITURA", detail: "candles sem padrao claro no extremo" });
  }
  if (filters?.candle === true) {
    const candleOk = Boolean(candle && ((candle.structure === "REVERSAL" && candle.direction === side) || candle.rejection === (buy ? "LOWER" : "UPPER")));
    if (!candleOk) counterEvidence.push({ code: "CANDLE_GATE_SEM_REVERSAO", detail: "candle gate: sem padrao de reversao no extremo a favor da tese" });
  }

  const adxSupports = sideAdx?.oldStrengthening !== true && (adx?.regime === "RANGE" || sideAdx?.oldTrendWeakening === true || sideAdx?.oppositeReacting === true || sideAdx?.newDominance === true);
  if (adxSupports) supportingEvidence.push({ code: "ADX_SUPORTE", detail: `regime ${adx?.regime} dominancia ${adx?.dominance}` });
  else counterEvidence.push({ code: "ADX_SEM_SUPORTE", detail: `tendencia antiga ainda forte (ADX ${adx?.adx})` });
  if (sideAdx?.trendStrengthening === true) counterEvidence.push({ code: "ADX_DI_CONTRA", detail: "DMI separando com ADX subindo contra a tese (tendencia fortalecendo: nao fade)" });
  else if (sideAdx?.priceTrendAgainst === true) counterEvidence.push({ code: "ADX_PRECO_CONTRA_TENDENCIA", detail: "preco ja percorreu a tendencia dominante contra a tese" });

  const atrSupports = atr?.state === "NORMAL" && atr?.climactic !== true;
  if (atrSupports) supportingEvidence.push({ code: "ATR_SUPORTE", detail: `ratio ${atr?.ratio}` });
  const fibAligned = fib?.direction === side;
  const fibSupports = (fib?.state === "AT_EXTREME_REACTION" || fib?.state === "ZONE_REJECTION" || fib?.state === "ZONE_REACTION") && fibAligned;
  if (fibSupports) supportingEvidence.push({ code: "FIB_CONFLUENCIA", detail: `reacao na zona ${(fib.inZone ?? []).join("/")} (leg ${fib.direction})` });
  if (!fibAligned) counterEvidence.push({ code: "FIB_LEG_INCOMPATIVEL", detail: `leg ${fib?.direction} nao confirma a queda/alta da tese ${side}` });

  const vetoRows = counterEvidence.filter((row) => VETO_SEVERITY[row.code] != null);
  const vetoPick = tolerate(vetoRows, budget, (row) => VETO_SEVERITY[row.code]);
  const hardBlocked = vetoPick.blocking.length > 0;
  const evidenceStrength = clamp01(0.3 * (rsi.quality ?? 0) + 0.2 * (bollinger?.strength ?? 0) + 0.2 * (adx?.strength ?? 0) + 0.1 * (atrSupports ? 1 : 0) + 0.2 * (fib?.strength ?? 0));

  if (hardBlocked) {
    return { ...base, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence,
      reason: `Oportunidade ${side} barrada: ${vetoPick.blocking.map((r) => r.code).join("+")}.`,
      tolerance: { safetyPct: safety, budget, tolerated: vetoPick.tolerated.map((r) => r.code) },
      conversation: buildConversation(opinions, `Bloqueio duro: ${vetoPick.blocking.map((r) => r.code).join("+")}`) };
  }
  const locationOk = bollingerSupports || fibSupports;
  const missingAll = [!rsiQuality ? "RSI_QUALIDADE" : null, !adxSupports ? "ADX" : null, !atrSupports ? "ATR" : null, !locationOk ? "LOCALIZACAO(Bollinger OU Fib)" : null].filter(Boolean);
  const missingPick = tolerate(missingAll, budget - vetoPick.used, (item) => MISSING_SEVERITY[item] ?? 9);
  const missing = missingPick.blocking;
  const toleratedMissing = missingPick.tolerated;
  if (missing.length) {
    return { ...base, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence,
      reason: `Confluencia incompleta para ${side}: falta ${missing.join(" + ")}. WAIT.`,
      tolerance: { safetyPct: safety, budget, tolerated: [...vetoPick.tolerated.map((r) => r.code), ...toleratedMissing] },
      conversation: buildConversation(opinions, `Falta confluencia: ${missing.join(" + ")}`) };
  }
  return {
    agent: "CONSENSUS", version: CONSENSUS_AGENT_VERSION, snapshotId, at, decision: side, side, evidenceStrength: round(evidenceStrength, 4),
    supportingEvidence, counterEvidence,
    tolerance: { safetyPct: safety, budget, tolerated: [...vetoPick.tolerated.map((r) => r.code), ...toleratedMissing] },
    reason: `Reversao ${side} confirmada: RSI ${rsi.rsi} (${rsi.state.toLowerCase()}) + Bollinger ${bollinger?.rejection ?? bollinger?.regime} + ADX ${adx?.regime}/${adx?.dominance} + ATR normal + Fibonacci ${(fib?.inZone ?? []).join("/")}.` + (safety < 100 ? ` [seguranca ${safety}%]` : ""),
    conversation: buildConversation(opinions, `Confluencia completa -> ${side}`),
  };
}


export function detectConstantMove({ snapshot, side, atrNormalized = null, adxValue = null, adxSlope = null, lookback = 60 } = {}) {
  const candles = Array.isArray(snapshot?.recentCandles) ? snapshot.recentCandles.slice(-lookback) : [];
  if (candles.length < 6) return { constant: false, detail: "dados insuficientes" };
  const first = Number(candles[0]?.close);
  const last = Number(candles[candles.length - 1]?.close);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return { constant: false, detail: "candles invalidos" };
  const net = last - first;
  const against = side === "BUY" ? -1 : 1;
  const dirMove = net > 0 ? 1 : net < 0 ? -1 : 0;
  if (dirMove === 0 || dirMove !== against) return { constant: false, detail: "sem movimento contra a tese" };
  let sameDir = 0; let run = first; let maxAdverse = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const close = Number(candles[i]?.close);
    const prev = Number(candles[i - 1]?.close);
    if (!Number.isFinite(close) || !Number.isFinite(prev)) continue;
    if (Math.sign(close - prev) === dirMove) sameDir += 1;
    if (dirMove < 0) { run = Math.min(run, close); maxAdverse = Math.max(maxAdverse, close - run); }
    else { run = Math.max(run, close); maxAdverse = Math.max(maxAdverse, run - close); }
  }
  const legs = candles.length - 1;
  const consistency = legs > 0 ? sameDir / legs : 0;
  const lastClose = Number(candles[candles.length - 1]?.close);
  const atr = Number(atrNormalized) > 0 && Number.isFinite(lastClose) && lastClose > 0 ? Number(atrNormalized) * lastClose : null;
  const netAtr = atr ? Math.abs(net) / atr : null;
  const pullbackRatio = atr ? maxAdverse / atr : null;
  const adxOk = !Number.isFinite(Number(adxValue)) || Number(adxValue) >= 30;
  const slopeOk = !Number.isFinite(Number(adxSlope)) || Number(adxSlope) > 0;
  const moveOk = netAtr === null || netAtr >= 1.2;
  const constant = consistency >= 0.72 && (pullbackRatio === null || pullbackRatio <= 0.6) && moveOk && adxOk && slopeOk;
  return { constant, detail: "net " + (netAtr === null ? net.toFixed(6) : netAtr.toFixed(2) + "xATR") + " contra a tese, consistencia " + (consistency * 100).toFixed(0) + "%, pullback " + (pullbackRatio === null ? "-" : pullbackRatio.toFixed(2) + "xATR") + ", ADX " + (Number.isFinite(Number(adxValue)) ? adxValue : "-") + " slope " + (Number.isFinite(Number(adxSlope)) ? adxSlope : "-") };
}

function buildConversation(opinions, consensusLine = null) {
  const lines = [];
  for (const key of ["rsi", "bollinger", "adx", "atr", "fib", "candle"]) {
    const agent = opinions?.[key];
    if (agent) lines.push({ agent: agent.agent, opinion: agent.opinion, state: agent.state, direction: agent.direction });
  }
  if (consensusLine) lines.push({ agent: "CONSENSUS", opinion: consensusLine });
  return lines;
}
