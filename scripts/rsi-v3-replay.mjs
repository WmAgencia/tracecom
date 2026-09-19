/**
 * RSI V3 REPLAY — comparacao causal V3 (pre-fix) x V3.1 sobre um dump de oportunidades.
 *
 * Uso: node scripts/rsi-v3-replay.mjs --dump=<caminho.json> [--last-minutes=10]
 *
 * Regras:
 *  - Somente dados point-in-time ja persistidos (nenhuma informacao futura).
 *  - Nenhuma ordem; controlsExecution=false (script read-only).
 *  - Duas leituras da V3.1:
 *      PROVA (lower bound): exige evidencia de rejeicao Bollinger NO PROPRIO tick do accept
 *        (band.touchUpper/outsideUpper/rejectionUpperNow no snapshot persistido).
 *      MEMORIA (upper bound): assume que a rejeicao/DI cross haviam sido registrados no
 *        episodio ~10s antes e seguem validos (o que a V3.1 passara a persistir).
 *  - Nada e considerado "submetido": apenas firstSight/revalidacao hipotetica.
 */
import { readFileSync } from "node:fs";
// @ts-expect-error - relay ESM sem tipagem
const v3 = await import("../relay/rsi-v3.mjs");

const args = process.argv.slice(2);
const valueOf = (name) => { const hit = args.find((arg) => arg.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : null; };
const dumpPath = valueOf("dump");
const lastMinutes = Number(valueOf("last-minutes") ?? 0);
if (!dumpPath) { console.error("--dump=<caminho.json> obrigatorio"); process.exit(1); }

const dump = JSON.parse(readFileSync(dumpPath, "utf8").replace(/^\uFEFF/, ""));
const nowMs = Number(dump.now?.ms) || Date.now();
const dir = (value) => value === "BUY" || value === "SELL";
const num = (value) => (value === null || value === undefined ? null : Number(value));

const rows = (dump.opps ?? [])
  .map((row) => ({ ...row, observed_at: num(row.observed_at), candidate_at: num(row.candidate_at), cushion: num(row.expected_cushion) }))
  .filter((row) => (lastMinutes > 0 ? row.observed_at >= nowMs - lastMinutes * 60_000 : true))
  .filter((row) => dir(row.v3_decision));

const makeIndicators = (row) => {
  const band = typeof row.band === "string" ? JSON.parse(row.band) : (row.band ?? {});
  const bollinger = typeof row.bollinger === "string" ? JSON.parse(row.bollinger) : (row.bollinger ?? {});
  const dmi = typeof row.dmi === "string" ? JSON.parse(row.dmi) : (row.dmi ?? {});
  const adx = typeof row.adx === "string" ? JSON.parse(row.adx) : (row.adx ?? {});
  const indicators = typeof row.indicators === "string" ? JSON.parse(row.indicators) : (row.indicators ?? {});
  return {
    at: row.candidate_at, rsi: num(row.rsi) ?? num(indicators.rsi), rsiSlope: num(indicators.rsiSlope),
    bollinger: { ...indicators.bollinger, position: band.position ?? indicators.bollinger?.position, touchUpper: band.touchUpper ?? indicators.bollinger?.touchUpper, touchLower: band.touchLower ?? indicators.bollinger?.touchLower, outsideUpper: band.outsideUpper ?? indicators.bollinger?.outsideUpper, outsideLower: band.outsideLower ?? indicators.bollinger?.outsideLower, close: bollinger.close ?? indicators.bollinger?.close },
    dmi: { ...indicators.dmi, ...dmi }, adx: { ...indicators.adx, ...adx },
    structuralTrend: row.structural_trend ?? indicators.structuralTrend,
    shortHorizonDirection: row.short_horizon_direction ?? indicators.shortHorizonDirection,
    shortMomentum: num(indicators.shortMomentum), velocity: num(indicators.velocity), acceleration: num(indicators.acceleration),
    noisePerCandle: num(indicators.noisePerCandle), noiseHorizon: num(indicators.noiseHorizon),
    bandRiding: indicators.bandRiding ?? { upper: false, lower: false },
    strongContinuation: indicators.strongContinuation ?? { upper: false, lower: false },
    dominantDI: indicators.dominantDI ?? null,
    rejectionUpperNow: band.rejectionUpperNow === true, rejectionLowerNow: band.rejectionLowerNow === true,
  };
};

const atTickRejection = (row, sell) => {
  const band = typeof row.band === "string" ? JSON.parse(row.band) : (row.band ?? {});
  return sell ? band.rejectionUpperNow === true || band.touchUpper === true || band.outsideUpper === true : band.rejectionLowerNow === true || band.touchLower === true || band.outsideLower === true;
};
const baseEpisode = (row, sell, { memory }) => {
  const close = num(row.entry_price) ?? num(typeof row.bollinger === "string" ? JSON.parse(row.bollinger).close : row.bollinger?.close);
  const candidatePrice = num(row.candidate_price);
  // Extremo da rejeicao desconhecido no dado antigo (bug corrigido na V3.1): usa limite inferior
  // derivado do proprio tick (max/min entre preco do candidate e close atual) — nunca dado futuro.
  const extreme = sell
    ? Math.max(candidatePrice ?? close ?? 0, close ?? 0)
    : Math.min(candidatePrice ?? close ?? Infinity, close ?? Infinity);
  return {
    direction: row.direction ?? (sell ? "SELL" : "BUY"),
    candidateAt: row.candidate_at, candidateRsi: num(row.candidate_rsi), candidatePrice,
    minRsi: num(row.candidate_rsi), maxRsi: num(row.candidate_rsi),
    touchedUpper: sell, touchedLower: !sell, outsideUpper: sell, outsideLower: !sell, reenteredUpper: sell, reenteredLower: !sell,
    maxSpread: num(typeof row.dmi === "string" ? JSON.parse(row.dmi).spread : row.dmi?.spread) ?? 0,
    bollingerRejectionAt: memory ? row.candidate_at - 10_000 : null,
    bollingerRejectionPrice: close, bollingerRejectionDirection: sell ? "UPPER" : "LOWER",
    bollingerReentryConfirmed: memory, bollingerRejectionExtreme: extreme,
    diCrossAt: memory ? row.candidate_at - 5_000 : null, diCrossDirection: memory ? (sell ? "SELL" : "BUY") : null,
    newDirectionConfirmedAt: memory ? row.candidate_at - 5_000 : null,
    oldDiWeakStreak: 2, newDiReactStreak: 2, neutralTicks: 0, lateralTicks: 0,
  };
};

const summary = { totalDirectionalRows: rows.length, baselineAccepted: 0, stage2: 0, atTickRejectionEvidence: 0, v31Prova: 0, v31Memoria: 0, baselineFails: {}, v31ProvaFails: {}, v31MemoriaFails: {}, samples: [] };
for (const row of rows) {
  const sell = (row.direction ?? row.v3_decision) === "SELL";
  const indicators = makeIndicators(row);
  summary.baselineAccepted += 1;
  if (row.stage === "NEW_DIRECTION_EMERGING") summary.stage2 += 1;
  const hasEvidence = atTickRejection(row, sell);
  if (hasEvidence) summary.atTickRejectionEvidence += 1;
  const base = v3.firstSightThesisV3({ indicators, direction: sell ? "SELL" : "BUY", episode: null, at: row.candidate_at });
  if (!base.valid) for (const fail of base.hardFails) summary.baselineFails[fail] = (summary.baselineFails[fail] ?? 0) + 1;
  const prova = hasEvidence
    ? v3.firstSightThesisV3({ indicators, direction: sell ? "SELL" : "BUY", episode: baseEpisode(row, sell, { memory: false }), at: row.candidate_at })
    : { valid: false, hardFails: ["SEM_EVIDENCIA_NO_TICK"] };
  if (prova.valid) summary.v31Prova += 1; else for (const fail of prova.hardFails) summary.v31ProvaFails[fail] = (summary.v31ProvaFails[fail] ?? 0) + 1;
  const memoria = v3.firstSightThesisV3({ indicators, direction: sell ? "SELL" : "BUY", episode: baseEpisode(row, sell, { memory: true }), at: row.candidate_at });
  if (memoria.valid) summary.v31Memoria += 1; else for (const fail of memoria.hardFails) summary.v31MemoriaFails[fail] = (summary.v31MemoriaFails[fail] ?? 0) + 1;
  if (memoria.valid && summary.samples.length < 8) summary.samples.push({ market: row.market_key, direction: row.direction, candidateRsi: num(row.candidate_rsi), stage: row.stage, strength: row.strength, cushion: row.cushion, atTickRejection: hasEvidence, prova: prova.valid, memoria: memoria.valid });
}

console.log(JSON.stringify({ dump: dumpPath, window: lastMinutes ? `ultimos ${lastMinutes} min` : "tudo", ...summary }, null, 1));
