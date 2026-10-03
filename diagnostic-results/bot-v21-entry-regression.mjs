import assert from 'node:assert/strict';
import { ClosedCandles, calcRSI, evaluateEntry } from '../ws-otc-v21.mjs';
const base = 1791000000000;
const buffer = new ClosedCandles(5);
let price = 100;
for (let i = 0; i < 16; i++) {
  const open = price;
  if (i > 0) price += i === 15 ? -10 : (i % 2 ? 1 : -1);
  const from = base + i * 5000;
  buffer.ingest({ from: from / 1000, open, close: price, max: Math.max(open, price) + .1, min: Math.min(open, price) - .1 }, from + 5000);
}
assert.equal(buffer.ticks.at(-1).open, 100);
assert.equal(buffer.ticks.at(-1).close, 90);
const previous = calcRSI(buffer.ticks.slice(-16, -1));
assert.equal(previous, 50);
const decision = evaluateEntry({ ticks: buffer.ticks, open: [], rsi: calcRSI(buffer.ticks), adx: 20, regime1m: { direction: 'alta1m', spreadPct: .1 } });
assert.equal(decision.skip, null);
assert.equal(decision.direction, 'CALL');
const broken = buffer.ticks.map(({open, ...bar}) => bar);
assert.equal(evaluateEntry({ ticks: broken, open: [], rsi: calcRSI(broken), adx: 20, regime1m: { direction: 'alta1m', spreadPct: .1 } }).skip, 'corpoFraco');
const moved = new ClosedCandles(5);
moved.ingest({from:base/1000, price_open:123, close:124}, base+5000);
assert.equal(moved.ticks[0].open,123);
const shifted = Array.from({length:16}, (_,i)=>({close:100+i}));
assert.equal(calcRSI(shifted.slice(-15,-1)),50);
assert.equal(calcRSI(shifted.slice(-16,-1)),100);
console.log('PASS: OHLC, entrada CALL elegível, reprodução do bloqueio original, price_open, RSI anterior. Zero conexão e zero ordens.');
