/**
 * AGENTE CONSENSO — especialista senior. Recebe o MESMO snapshot + as opinioes estruturadas dos 5 agentes.
 * Sintese semantica (NUNCA votacao). Regras profissionais documentadas em docs/research/agentic-rsi-fib.md.
 * Saida: BUY | SELL | WAIT + supporting/counter/reason/evidenceStrength (descritivo, nunca probabilidade).
 */
export const CONSENSUS_AGENT_VERSION = "agent-consensus-v1";
const round = (v, d = 4) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function runConsensusAgent({ snapshot, opinions } = {}) {
  const snapshotId = snapshot?.snapshotId ?? null;
  const at = snapshot?.at ?? Date.now();
  const rsi = opinions?.rsi ?? null; const bollinger = opinions?.bollinger ?? null; const adx = opinions?.adx ?? null;
  const atr = opinions?.atr ?? null; const fib = opinions?.fib ?? null;
  const base = { agent: "CONSENSUS", version: CONSENSUS_AGENT_VERSION, snapshotId, at, decision: "WAIT", side: null, evidenceStrength: 0, supportingEvidence: [], counterEvidence: [], reason: "", conversation: [] };
  if (!rsi?.trigger) return { ...base, reason: `Sem oportunidade: RSI ${rsi?.rsi ?? "-"} fora de 70/30.`, conversation: buildConversation(opinions) };

  const side = rsi.side; const buy = side === "BUY";
  const supportingEvidence = []; const counterEvidence = [];
  const sideAdx = adx?.perSide?.[side] ?? null;
  const oppositeAdx = adx?.perSide?.[buy ? "SELL" : "BUY"] ?? null;

  if (atr?.state === "DEAD") counterEvidence.push({ code: "ATR_MERCADO_MORTO", detail: `ratio ${atr.ratio}` });
  if (atr?.climactic === true) counterEvidence.push({ code: "ATR_MOVIMENTO_CLIMATICO", detail: "volatilidade climatica com tendencia forte" });
  if (bollinger?.walkSide === (buy ? "LOWER" : "UPPER")) counterEvidence.push({ code: "BOLLINGER_WALK_CONTRA", detail: `preco caminhando na banda ${bollinger.walkSide.toLowerCase()} contra a tese` });
  if (buy && bollinger?.state === "EXPANSION" && bollinger?.position !== null && bollinger.position < 0.2 && bollinger?.rejection !== "LOWER") counterEvidence.push({ code: "BOLLINGER_FORA_INFERIOR", detail: "fechando fora da banda inferior sem reentrada" });
  if (!buy && bollinger?.state === "EXPANSION" && bollinger?.position !== null && bollinger.position > 0.8 && bollinger?.rejection !== "UPPER") counterEvidence.push({ code: "BOLLINGER_FORA_SUPERIOR", detail: "fechando fora da banda superior sem reentrada" });
  if (sideAdx?.oldStrengthening === true) counterEvidence.push({ code: "ADX_TENDENCIA_ANTIGA_FORTALECENDO", detail: "tendencia antiga (contra a tese) fortalecendo com ADX subindo" });
  if (rsi.state === "EXTREME_ACCELERATING") counterEvidence.push({ code: "RSI_EXTREMO_ACELERANDO", detail: `slope ${rsi.rsi} acelerando para o extremo` });
  if (fib?.state === "ZONE_BROKEN") counterEvidence.push({ code: "FIB_ZONE_BROKEN", detail: "anchor do leg perdido" });
  if (fib?.state === "OUT_OF_ZONE") counterEvidence.push({ code: "FIB_FORA_DE_ZONA", detail: "fora das zonas 38.2/50.0/61.8" });
  if (["AT_EXTREME", "IN_RETRACEMENT", "IN_ZONE"].includes(fib?.state)) counterEvidence.push({ code: "FIB_SEM_REACAO", detail: "sem reacao no extremo/zona ainda" });

  const rsiQuality = Boolean(rsi.divergence || rsi.failureSwing || rsi.crossback);
  if (rsiQuality) supportingEvidence.push({ code: "RSI_QUALIDADE", detail: rsi.divergence ? `divergencia ${rsi.divergence.toLowerCase()}` : rsi.failureSwing ? `failure swing ${rsi.failureSwing.toLowerCase()}` : "crossback do extremo" });
  else counterEvidence.push({ code: "RSI_SEM_QUALIDADE", detail: "extremo sem divergencia/failure swing/crossback (apenas alerta)" });
  if (rsi.line50Ok !== true) counterEvidence.push({ code: "RSI_LINHA_50_CONTRA", detail: `rsi ${rsi.rsi} contra o filtro da linha 50` });

  const bollingerSupports = Boolean(bollinger?.rejection && ((buy && bollinger.rejection === "LOWER") || (!buy && bollinger.rejection === "UPPER"))) || bollinger?.regime === "RANGE";
  if (bollingerSupports) supportingEvidence.push({ code: "BOLLINGER_SUPORTE", detail: bollinger.rejection ? `rejeicao ${bollinger.rejection.toLowerCase()}` : "regime de range" });
  else counterEvidence.push({ code: "BOLLINGER_SEM_SUPORTE", detail: `regime ${bollinger?.regime ?? "?"} sem rejeicao a favor` });

  const adxSupports = sideAdx?.oldStrengthening !== true && (adx?.regime === "RANGE" || sideAdx?.oldTrendWeakening === true || sideAdx?.oppositeReacting === true || sideAdx?.newDominance === true);
  if (adxSupports) supportingEvidence.push({ code: "ADX_SUPORTE", detail: `regime ${adx?.regime} dominancia ${adx?.dominance}` });
  else counterEvidence.push({ code: "ADX_SEM_SUPORTE", detail: `tendencia antiga ainda forte (ADX ${adx?.adx})` });

  const atrSupports = atr?.state === "NORMAL" && atr?.climactic !== true;
  if (atrSupports) supportingEvidence.push({ code: "ATR_SUPORTE", detail: `ratio ${atr?.ratio}` });
  const fibAligned = fib?.direction === side;
  const fibSupports = (fib?.state === "AT_EXTREME_REACTION" || fib?.state === "ZONE_REJECTION" || fib?.state === "ZONE_REACTION") && fibAligned;
  if (fibSupports) supportingEvidence.push({ code: "FIB_CONFLUENCIA", detail: `reacao na zona ${(fib.inZone ?? []).join("/")} (leg ${fib.direction})` });
  if (!fibAligned) counterEvidence.push({ code: "FIB_LEG_INCOMPATIVEL", detail: `leg ${fib?.direction} nao confirma a queda/alta da tese ${side}` });

  const hardBlocked = counterEvidence.some((row) => ["ATR_MERCADO_MORTO", "ATR_MOVIMENTO_CLIMATICO", "BOLLINGER_WALK_CONTRA", "BOLLINGER_FORA_INFERIOR", "BOLLINGER_FORA_SUPERIOR", "ADX_TENDENCIA_ANTIGA_FORTALECENDO", "RSI_EXTREMO_ACELERANDO", "FIB_ZONE_BROKEN", "FIB_FORA_DE_ZONA", "FIB_SEM_REACAO"].includes(row.code));
  const evidenceStrength = clamp01(0.3 * (rsi.quality ?? 0) + 0.2 * (bollinger?.strength ?? 0) + 0.2 * (adx?.strength ?? 0) + 0.1 * (atrSupports ? 1 : 0) + 0.2 * (fib?.strength ?? 0));

  if (hardBlocked) {
    return { ...base, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence,
      reason: `Oportunidade ${side} barrada: ${counterEvidence.filter((r) => hardBlockedCodes.includes(r.code)).map((r) => r.code).join("+")}.`,
      conversation: buildConversation(opinions, `Bloqueio duro: ${counterEvidence.filter((r) => hardBlockedCodes.includes(r.code)).map((r) => r.code).join("+")}`) };
  }
  const locationOk = bollingerSupports || fibSupports;
  const missing = [!rsiQuality ? "RSI_QUALIDADE" : null, !adxSupports ? "ADX" : null, !atrSupports ? "ATR" : null, !locationOk ? "LOCALIZACAO(Bollinger OU Fib)" : null].filter(Boolean);
  if (missing.length) {
    return { ...base, side, evidenceStrength: round(evidenceStrength, 4), supportingEvidence, counterEvidence,
      reason: `Confluencia incompleta para ${side}: falta ${missing.join(" + ")}. WAIT.`,
      conversation: buildConversation(opinions, `Falta confluencia: ${missing.join(" + ")}`) };
  }
  return {
    agent: "CONSENSUS", version: CONSENSUS_AGENT_VERSION, snapshotId, at, decision: side, side, evidenceStrength: round(evidenceStrength, 4),
    supportingEvidence, counterEvidence,
    reason: `Reversao ${side} confirmada: RSI ${rsi.rsi} (${rsi.state.toLowerCase()}) + Bollinger ${bollinger?.rejection ?? bollinger?.regime} + ADX ${adx?.regime}/${adx?.dominance} + ATR normal + Fibonacci ${(fib?.inZone ?? []).join("/")}.`,
    conversation: buildConversation(opinions, `Confluencia completa -> ${side}`),
  };
}

const hardBlockedCodes = ["FIB_LEG_INCOMPATIVEL", "ATR_MERCADO_MORTO", "ATR_MOVIMENTO_CLIMATICO", "BOLLINGER_WALK_CONTRA", "ADX_TENDENCIA_ANTIGA_FORTALECENDO", "RSI_EXTREMO_ACELERANDO", "FIB_ZONE_BROKEN"];

function buildConversation(opinions, consensusLine = null) {
  const lines = [];
  for (const key of ["rsi", "bollinger", "adx", "atr", "fib"]) {
    const agent = opinions?.[key];
    if (agent) lines.push({ agent: agent.agent, opinion: agent.opinion, state: agent.state, direction: agent.direction });
  }
  if (consensusLine) lines.push({ agent: "CONSENSUS", opinion: consensusLine });
  return lines;
}
