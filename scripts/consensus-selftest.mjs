/**
 * SELFTEST DETERMINISTICO do CONSENSUS CORE (sem rede, sem banco).
 * Cenarios sinteticos: reversao SELL, continuacao (WAIT), reversao BUY.
 */
import { evaluateConsensus, createConsensusLog } from "../relay/consensus/index.mjs";

const STEP_MS = 5000;
const START_MS = Date.parse("2026-09-20T12:00:00Z");

function makeCandles({ closes, wicks = [], stepMs = STEP_MS, startMs = START_MS }) {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    const wick = wicks[index] ?? { up: 0, down: 0 };
    const high = Math.max(open, close) + (wick.up ?? 0);
    const low = Math.min(open, close) - (wick.down ?? 0);
    const bucketEnd = startMs + (index + 1) * stepMs;
    return { bucketStart: bucketEnd - stepMs, bucketEnd, open, high, low, close };
  });
}

function drift({ from, count, delta }) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(from + delta * (i + 1));
  return out;
}

const base = 1.1000;
const unit = 0.00008;

const sellRally = [...drift({ from: base, count: 70, delta: unit * 0.15 })];
const sellPeakStart = sellRally[sellRally.length - 1];
for (let i = 0; i < 16; i += 1) sellRally.push(sellPeakStart + unit * (i + 1) * 1.2);
const sellPeak = sellRally[sellRally.length - 1];
sellRally.push(sellPeak - unit * 0.5, sellPeak - unit * 0.9, sellPeak - unit * 1.3, sellPeak - unit * 1.6);
const sellWicks = sellRally.map(() => ({ up: 0, down: 0 }));
sellWicks[sellRally.length - 1] = { up: unit * 9, down: 0 };

const buyDecline = [...drift({ from: base, count: 70, delta: -unit * 0.15 })];
const buyTroughStart = buyDecline[buyDecline.length - 1];
for (let i = 0; i < 16; i += 1) buyDecline.push(buyTroughStart - unit * (i + 1) * 1.2);
const buyTrough = buyDecline[buyDecline.length - 1];
buyDecline.push(buyTrough + unit * 0.5, buyTrough + unit * 0.9, buyTrough + unit * 1.3, buyTrough + unit * 1.6);
const buyWicks = buyDecline.map(() => ({ up: 0, down: 0 }));
buyWicks[buyDecline.length - 1] = { up: 0, down: unit * 9 };

const continuation = [...drift({ from: base, count: 70, delta: unit * 0.15 })];
const contStart = continuation[continuation.length - 1];
for (let i = 0; i < 24; i += 1) continuation.push(contStart + unit * (i + 1) * 1.1);
const contWicks = continuation.map(() => ({ up: 0, down: 0 }));

const scenarios = [
  { name: "SELL_REVERSAL", candles: makeCandles({ closes: sellRally, wicks: sellWicks }), expect: "SELL" },
  { name: "SELL_CONTINUATION_WAIT", candles: makeCandles({ closes: continuation, wicks: contWicks }), expect: "WAIT" },
  { name: "BUY_REVERSAL", candles: makeCandles({ closes: buyDecline, wicks: buyWicks }), expect: "BUY" },
];

const logger = createConsensusLog({ emit: () => {} });
let failures = 0;
for (const scenario of scenarios) {
  const now = scenario.candles[scenario.candles.length - 1].bucketEnd;
  const result = evaluateConsensus({ marketKey: scenario.name, marketType: "OTC", candles: scenario.candles, now });
  logger.logEvaluation({ marketKey: scenario.name, ...result });
  const got = result.decision.decision;
  const ok = got === scenario.expect;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${scenario.name}: expected=${scenario.expect} got=${got} latencyMs=${result.latencyMs}`);
  console.log(`   rsi=${result.rsi?.rsi} state=${result.rsi?.state} side=${result.rsi?.side} opp=${result.rsi?.opportunity}`);
  console.log(`   bollinger=${result.bollinger?.state} dmi=${result.dmiAdx?.state} pa=${result.priceAction?.structure} paRev=${result.priceAction?.reversalEvidence} paCont=${result.priceAction?.continuationEvidence}`);
  console.log(`   reason=${result.decision.reason}`);
}
console.log(failures === 0 ? "CONSENSUS_SELFTEST_ALL_PASS" : `CONSENSUS_SELFTEST_FAILURES=${failures}`);
process.exit(failures === 0 ? 0 : 1);
