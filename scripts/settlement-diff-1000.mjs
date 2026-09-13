/* Replays the existing paper decisions only. No strategy or model calls. */
import fs from 'node:fs';

const resultPath = 'paper-usdcad-1000-results.json';
const datasetPath = 'data/real/usdcad-1m-8d.json';
const results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
const rows = dataset.rows ?? dataset;

// The source is closed 1m OHLC. The one permitted policy is CLOSE-to-CLOSE;
// never interpolate a price inside a candle.
const byTs = new Map(rows.map(r => [new Date(r.timestamp).getTime(), r]));
const settleTrade = (direction, entryPrice, settlementPrice) => {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(settlementPrice)) return 'UNKNOWN';
  if (settlementPrice === entryPrice) return 'DRAW';
  return direction === 'BUY'
    ? (settlementPrice > entryPrice ? 'WIN' : 'LOSS')
    : (settlementPrice < entryPrice ? 'WIN' : 'LOSS');
};
const pct = n => `${(n * 100).toFixed(2)}%`;
const trades = results.trades.map(t => {
  const decisionTimestamp = new Date(t.timestamp).getTime();
  const entryLeadSeconds = Number.isFinite(t.entryLeadSeconds) ? t.entryLeadSeconds : 0;
  const expirationSeconds = Number.isFinite(t.expirationSeconds) ? t.expirationSeconds : (t.horizonSeconds ?? 60);
  const expectedEntryTimestamp = decisionTimestamp + entryLeadSeconds * 1000;
  const expectedSettlementTimestamp = expectedEntryTimestamp + expirationSeconds * 1000;
  const entry = byTs.get(expectedEntryTimestamp);
  const settlement = byTs.get(expectedSettlementTimestamp);
  const actualEntryTimestamp = entry ? expectedEntryTimestamp : null;
  const actualSettlementTimestamp = settlement ? expectedSettlementTimestamp : null;
  const entryPrice = entry?.close ?? null;
  const settlementPrice = settlement?.close ?? null;
  const independentResult = settleTrade(t.direction, entryPrice, settlementPrice);
  let differenceReason = 'MATCH';
  if (!entry || !settlement) differenceReason = 'TEMPORAL_RESOLUTION_INSUFFICIENT';
  else if (independentResult === 'DRAW' && t.outcome !== 'DRAW') differenceReason = 'DRAW_HANDLING_MISMATCH';
  else if (independentResult !== t.outcome) differenceReason = 'DIRECTION_MISMATCH';
  return {
    tradeId: t.tradeId, decisionId: t.tradeId, direction: t.direction,
    decisionTimestamp: new Date(decisionTimestamp).toISOString(), entryLeadSeconds,
    expectedEntryTimestamp: new Date(expectedEntryTimestamp).toISOString(), actualEntryTimestamp: actualEntryTimestamp ? new Date(actualEntryTimestamp).toISOString() : null,
    entryPrice, expirationSeconds,
    expectedSettlementTimestamp: new Date(expectedSettlementTimestamp).toISOString(), actualSettlementTimestamp: actualSettlementTimestamp ? new Date(actualSettlementTimestamp).toISOString() : null,
    settlementPrice, recordedResult: t.outcome, independentResult, differenceReason,
    // Yahoo provides one-minute OHLC only. A close is not observable at an
    // intraminute entry (and is future data until the bucket closes), so these
    // rows are bucket-aligned, never exact. Exact requires a tick/second quote.
    classification: !entry || !settlement ? 'TEMPORAL_RESOLUTION_INSUFFICIENT' : 'VALID_BUCKET_ALIGNED',
    pricePolicy: 'CLOSE_TO_CLOSE_NO_INTRAMINUTE_INTERPOLATION', sourcePrecision: 'ORIGINAL_YAHOO_FLOAT'
  };
});
const count = xs => xs.reduce((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {});
const valid = trades.filter(t => t.classification === 'VALID_BUCKET_ALIGNED');
const diff = { schemaVersion: 3, generatedAt: new Date().toISOString(), source: resultPath, dataset: datasetPath, marketType: 'FOREX_NORMAL', settlementPolicy: { entry: 'decisionTimestamp + entryLeadSeconds', settlement: 'entryTimestamp + expirationSeconds', price: 'CLOSE_TO_CLOSE', interpolation: false, precision: 'original float', temporalClass: 'VALID_BUCKET_ALIGNED', lookahead: 'close is only known at bucket close; not causal for intrabucket entry' }, tradeCount: trades.length, validExact: trades.filter(t => t.classification === 'VALID_EXACT').length, validBucketAligned: valid.length, classificationCounts: count(trades.map(t => t.classification)), differenceCounts: count(trades.map(t => t.differenceReason)), recordedCounts: count(valid.map(t => t.recordedResult)), correctedCounts: count(valid.map(t => t.independentResult)), agreement: valid.filter(t => t.recordedResult === t.independentResult).length / valid.length, trades };
fs.mkdirSync('diagnostic-results/paper', { recursive: true });
fs.writeFileSync('diagnostic-results/paper/settlement-diff-1000.json', JSON.stringify(diff, null, 2) + '\n');
const report = `# Settlement diff — 1,000 decision replay\n\nReplay of **${resultPath}** using the same decisions and no model calls.\n\n- Policy: close-to-close on original Yahoo floating-point prices; no intraminute interpolation.\n- Alignment: entry = decision + entryLead; settlement = entry + expiration.\n- Valid exact: **${valid.length}/${trades.length}**\n- Recorded: ${JSON.stringify(diff.recordedCounts)}\n- Corrected: ${JSON.stringify(diff.correctedCounts)}\n- Difference causes: ${JSON.stringify(diff.differenceCounts)}\n- Agreement: **${pct(diff.agreement)}**\n\nThe prior labels are retained for comparison and are **INVALIDATED_BY_SETTLEMENT_AUDIT**; they must not enter training or calibration. This artifact is a consistency replay, not evidence of predictive edge.\n`;
fs.writeFileSync('diagnostic-results/paper/settlement-diff-1000.md', report);
fs.writeFileSync('diagnostic-results/paper/paper-usdcad-1000-results.status.json', JSON.stringify({ status: 'INVALIDATED_BY_SETTLEMENT_AUDIT', source: resultPath, replacement: 'settlement-diff-1000.json' }, null, 2) + '\n');
console.log(JSON.stringify({ tradeCount: trades.length, validExact: diff.validExact, validBucketAligned: diff.validBucketAligned, agreement: diff.agreement, differenceCounts: diff.differenceCounts }, null, 2));
