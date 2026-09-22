import { buildMarketSnapshot } from "../relay/consensus/snapshot.mjs";
import { analyzeCandleAgent } from "../relay/agents/candle.agent.mjs";
const STEP_MS = 5000; const START_MS = Date.parse("2026-09-20T12:00:00Z"); const unit = 0.00008;
const makeCandles = ({ closes }) => closes.map((close, index) => { const open = index === 0 ? close : closes[index - 1]; const bucketEnd = START_MS + (index + 1) * STEP_MS; return { bucketStart: bucketEnd - STEP_MS, bucketEnd, open, high: Math.max(open, close), low: Math.min(open, close), close }; });
const closes = []; let px = 1.1;
for (let leg = 0; leg < 5; leg += 1) { for (let i = 0; i < 14; i += 1) { px += unit * 0.6; closes.push(px); } for (let i = 0; i < 8; i += 1) { px -= unit * 0.35; closes.push(px); } }
for (let i = 0; i < 10; i += 1) { px += unit * 0.6; closes.push(px); }
const candles = makeCandles({ closes });
const now = candles[candles.length - 1].bucketEnd;
const snapshot = buildMarketSnapshot({ marketKey: "T:OTC", marketType: "OTC", candles, now });
console.log("RECENT=" + (snapshot?.recentCandles?.length ?? 0));
const list = (snapshot?.recentCandles ?? []).slice(-360);
const lb = 3; const highs = []; const lows = [];
for (let i = lb; i < list.length - lb; i += 1) { const win = list.slice(i - lb, i + lb + 1); const high = Number(list[i].high); const low = Number(list[i].low); if (high === Math.max(...win.map((c) => Number(c.high)))) highs.push(high); if (low === Math.min(...win.map((c) => Number(c.low)))) lows.push(low); }
console.log("PIVOTS highs=" + highs.length + " lows=" + lows.length);
console.log("OPINION", JSON.stringify({ structure: analyzeCandleAgent(snapshot).swingStructure, labels: analyzeCandleAgent(snapshot).swingLabels, bos: analyzeCandleAgent(snapshot).bos, pullback: analyzeCandleAgent(snapshot).pullbackHolding, pivots: analyzeCandleAgent(snapshot).debugPivots, obs: analyzeCandleAgent(snapshot).observations }));
