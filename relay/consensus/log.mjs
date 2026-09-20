/**
 * LOG DO CONSENSUS — humano + estruturado, com coalescing.
 * NAO repetir o texto inteiro quando nada relevante mudou (WAIT -> WAIT).
 * Registrar mudanca: WAIT->BUY/SELL, mudanca de estado de indicador, candidate, final, ordem, settlement.
 */
export const CONSENSUS_LOG_VERSION = "consensus-log-v1";

const n1 = (value) => (Number.isFinite(Number(value)) ? Number(Number(value).toFixed(1)) : "-");
const arrow = (trajectory) => (Array.isArray(trajectory) ? trajectory.filter((v) => Number.isFinite(Number(v))).map((v) => n1(v)).join(" -> ") : "-");

export function consensusFingerprint(entry) {
  const { decision, rsi, bollinger, dmiAdx, priceAction } = entry;
  return [decision?.decision, decision?.reason, rsi?.state, rsi?.side, bollinger?.state, dmiAdx?.state, priceAction?.structure].join("|");
}

export function formatConsensusHuman(entry) {
  const { marketKey, rsi, bollinger, dmiAdx, priceAction, decision } = entry;
  const lines = [];
  lines.push(`${marketKey}`);
  lines.push("");
  lines.push("RSI:");
  lines.push(`  ${rsi?.opportunity ? `${rsi.side} opportunity` : "sem oportunidade"}`);
  lines.push(`  RSI ${n1(rsi?.rsi)}  trajectory ${arrow(rsi?.trajectory)}  state=${rsi?.state ?? "-"}`);
  lines.push("");
  lines.push("BOLLINGER:");
  lines.push(`  estado=${bollinger?.state ?? "-"} lado=${bollinger?.side ?? "-"} posicao=${n1(bollinger?.position)}`);
  lines.push(`  evidencia_reversao=${bollinger?.evidenceReversal ?? 0} evidencia_continuacao=${bollinger?.evidenceContinuation ?? 0}`);
  if (bollinger?.observations?.length) lines.push(`  ${bollinger.observations.join("; ")}`);
  lines.push("");
  lines.push("DMI/ADX:");
  lines.push(`  +DI ${n1(dmiAdx?.plusDI)} (${n1(dmiAdx?.plusSlope)})  -DI ${n1(dmiAdx?.minusDI)} (${n1(dmiAdx?.minusSlope)})  ADX ${n1(dmiAdx?.adx?.value)} (${n1(dmiAdx?.adx?.slope)})`);
  lines.push(`  estado=${dmiAdx?.state ?? "-"} dominancia=${dmiAdx?.dominance ?? "-"}`);
  if (dmiAdx?.observations?.length) lines.push(`  ${dmiAdx.observations.join("; ")}`);
  lines.push("");
  lines.push("PRICE ACTION:");
  lines.push(`  direcao=${priceAction?.direction ?? "-"} estrutura=${priceAction?.structure ?? "-"} forca=${priceAction?.strength ?? 0}`);
  lines.push(`  reversao=${priceAction?.reversalEvidence ?? 0} continuacao=${priceAction?.continuationEvidence ?? 0}`);
  if (priceAction?.observations?.length) lines.push(`  ${priceAction.observations.join("; ")}`);
  lines.push("");
  lines.push("DECISOR:");
  lines.push(`  ${decision?.decision ?? "WAIT"}`);
  lines.push("");
  lines.push("REASON:");
  lines.push(`  ${decision?.reason ?? "-"}`);
  return lines.join("\n");
}

export function createConsensusLog({ emit = () => {} } = {}) {
  const lastFingerprint = new Map();
  return {
    logEvaluation(entry) {
      const key = entry.marketKey;
      const fingerprint = consensusFingerprint(entry);
      const changed = lastFingerprint.get(key) !== fingerprint;
      lastFingerprint.set(key, fingerprint);
      const structured = {
        type: "consensus.decision", version: CONSENSUS_LOG_VERSION, marketKey: key,
        snapshotId: entry.snapshot?.snapshotId ?? null, at: entry.snapshot?.at ?? null,
        decision: entry.decision?.decision ?? "WAIT", side: entry.decision?.side ?? null,
        reason: entry.decision?.reason ?? null,
        evidenceStrength: entry.decision?.evidenceStrength ?? 0,
        supportingEvidence: entry.decision?.supportingEvidence ?? [],
        counterEvidence: entry.decision?.counterEvidence ?? [],
        rsi: { value: entry.rsi?.rsi ?? null, state: entry.rsi?.state ?? null, trajectory: entry.rsi?.trajectory ?? [] },
        bollinger: { state: entry.bollinger?.state ?? null, side: entry.bollinger?.side ?? null },
        dmiAdx: { state: entry.dmiAdx?.state ?? null, dominance: entry.dmiAdx?.dominance ?? null },
        priceAction: { structure: entry.priceAction?.structure ?? null, direction: entry.priceAction?.direction ?? null },
        coalesced: !changed,
      };
      emit({ structured, human: changed ? formatConsensusHuman(entry) : null, changed });
      return { changed, structured };
    },
    reset(marketKey = null) { if (marketKey === null) lastFingerprint.clear(); else lastFingerprint.delete(marketKey); },
  };
}
