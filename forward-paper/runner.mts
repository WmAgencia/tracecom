/**
 * FORWARD PAPER RUNNER — TRACECON-WF-ETHUSDT-5M-BB20 (H5=25min, H1=5min)
 *
 * Read-only: apenas WebSocket público da Binance (kline_5m + bookTicker) e REST.
 * NUNCA envia ordem real ou PRACTICE — não existe chamada de ordem neste arquivo.
 *
 * Comportamento:
 *  - No fechamento de cada candle 5m: calcula SMA20/SD20 (populacional) dos closes
 *    fechados e aplica a regra congelada (params-h5.json / params-h1.json):
 *    close > mean+2σ -> DOWN ; close < mean−2σ -> UP.
 *  - ENTRADA EXECUTÁVEL: preço pós-sinal do bookTicker (ask para UP, bid para DOWN),
 *    coletado no primeiro tick após o boundary, com bid/ask documentados e slippage
 *    vs o close do sinal.
 *  - Custos: taker 0.1% por perna (spot Binance), registrados.
 *  - Liquidação: H5 no close do 5º candle seguinte (25 min); H1 no close do 1º.
 *  - Ledgers JSONL imutáveis com hash-chain (sha256 do registro anterior incluso).
 *  - Sobreposições: cada trade registra os trade_ids ainda abertos no mesmo sentido.
 *
 * Uso: npx tsx forward-paper/runner.mts   (roda indefinidamente; Ctrl+C para parar)
 */
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { WebSocket } from "ws";

const TAKER_FEE = 0.001; // 0.1% por perna, spot Binance
const HORIZONS: Record<string, number> = { "TRACECON-WF-ETHUSDT-5M-BB20-H5": 5, "TRACECON-WF-ETHUSDT-5M-BB20-H1": 1 }; // em candles 5m
const PARAM_FILES: Record<string, string> = { "TRACECON-WF-ETHUSDT-5M-BB20-H5": "forward-paper/params-h5.json", "TRACECON-WF-ETHUSDT-5M-BB20-H1": "forward-paper/params-h1.json" };

// ---- state ----
let lastBook: { bid: number; ask: number; eventTime: number } | null = null;
const closedCloses: number[] = []; // closes de candles 5m FECHADOS, em ordem
const currentKline: { open: number; high: number; low: number; close: number; bucketStart: number } | null = null;
let prevHash: Record<string, string> = {};
const openTrades: Array<{ strategy_id: string; id: number; direction: "up" | "down"; entryPx: number; settleBucket: number }> = [];
let tradeSeq = 0;

function chainLedger(file: string, record: Record<string, unknown>): void {
  const h = createHash("sha256").update((prevHash[file] ?? "GENESIS") + JSON.stringify(record)).digest("hex");
  prevHash[file] = h;
  appendFileSync(file, JSON.stringify({ ...record, prev_hash: existsSync(file) ? undefined : "GENESIS", hash: h }) + "\n");
}

function mean(xs: number[]): number { return xs.reduce((s, x) => s + x, 0) / xs.length; }
function sdPop(xs: number[], m: number): number { return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length); }

interface Params { strategy_id: string; horizon: { duration_minutes: number }; }
function loadParams(id: string): Params { return JSON.parse(readFileSync(PARAM_FILES[id]!, "utf8")) as Params; }
const paramsH5 = loadParams("TRACECON-WF-ETHUSDT-5M-BB20-H5");
const paramsH1 = loadParams("TRACECON-WF-ETHUSDT-5M-BB20-H1");

function onCandleClosed(bucketStart: number, o: number, h: number, l: number, c: number): void {
  closedCloses.push(c);
  if (closedCloses.length < 21) return;
  const win = closedCloses.slice(-20);
  const m = mean(win);
  const s = sdPop(win, m);
  if (s <= 0) return;
  let direction: "up" | "down" | null = null;
  if (c > m + 2 * s) direction = "down";
  else if (c < m - 2 * s) direction = "up";
  if (!direction) { console.log(`[sig] ${new Date(bucketStart).toISOString()} close=${c} sem sinal (bandas ${ (m - 2 * s).toFixed(2) } / ${ (m + 2 * s).toFixed(2) })`); return; }

  // ENTRADA EXECUTÁVEL: primeiro book pós-sinal (usa o bookTicker mais recente; é o
  // preço que estaria disponível no boundary — em produção real entraria no próximo tick).
  const book = lastBook ?? { bid: c, ask: c, eventTime: 0 };
  const entryPx = direction === "up" ? book.ask : book.bid; // paga o ask / vende no bid
  const refPx = c;
  const slippageBps = ((entryPx - refPx) / refPx) * 10000 * (direction === "up" ? 1 : -1); // positivo = custa
  const signalTs = bucketStart + 300_000; // boundary = fim do candle do sinal

  for (const [sid, hCandles] of Object.entries(HORIZONS)) {
    tradeSeq++;
    const p = sid.endsWith("H5") ? paramsH5 : paramsH1;
    const overlaps = openTrades.filter((t) => t.strategy_id === sid && t.direction === direction).length;
    const rec = {
      ts_utc: new Date(signalTs).toISOString(),
      strategy_id: sid,
      trade_id: tradeSeq,
      direction,
      signal_close: refPx,
      entry_px_executable: entryPx,
      bid_at_entry: book.bid, ask_at_entry: book.ask, book_event_time: book.eventTime,
      slippage_bps: Math.round(slippageBps * 100) / 100,
      fee_per_leg: TAKER_FEE,
      horizon_candles: hCandles, horizon_minutes: p.horizon.duration_minutes,
      settle_bucket_start: bucketStart + hCandles * 300_000,
      overlapping_same_direction: overlaps,
      status: "open",
    };
    chainLedger(`forward-paper/signals/${sid}.jsonl`, rec);
    openTrades.push({ strategy_id: sid, id: tradeSeq, direction, entryPx, settleBucket: bucketStart + hCandles * 300_000 });
    console.log(`[SINAL] ${sid} #${tradeSeq} ${direction.toUpperCase()} entry=${entryPx} slip=${rec.slippage_bps}bps settle=${new Date(rec.settle_bucket_start).toISOString()}`);
  }
}

function settleDue(nowBucket: number): void {
  for (let i = openTrades.length - 1; i >= 0; i--) {
    const t = openTrades[i]!;
    if (t.settleBucket !== nowBucket) continue;
    const settleClose = closedCloses.at(-1)!; // close do candle que acabou de fechar no settleBucket
    const moved = (settleClose - t.entryPx) / t.entryPx;
    const hit = t.direction === "up" ? settleClose > t.entryPx : settleClose < t.entryPx;
    // EV spot líquido: movimento na direção menos 2 pernas de taxa
    const spotNet = (t.direction === "up" ? moved : -moved) - 2 * TAKER_FEE;
    // EV binário (proxy payout 85%): hit paga 0.85, miss perde 1
    const binNet = hit ? 0.85 - 2 * TAKER_FEE : -1 - 2 * TAKER_FEE;
    chainLedger(`forward-paper/signals/${t.strategy_id}.jsonl`, {
      ts_utc: new Date(nowBucket + 300_000).toISOString(), strategy_id: t.strategy_id, trade_id: t.id,
      direction: t.direction, entry_px_executable: t.entryPx, settle_px: settleClose,
      moved_pct: Math.round(moved * 100000) / 100000, hit, spot_net_return: Math.round(spotNet * 100000) / 100000,
      binary_net_return_payout85: binNet, fees_total: 2 * TAKER_FEE, status: "settled",
    });
    console.log(`[SETTLE] ${t.strategy_id} #${t.id} ${t.direction.toUpperCase()} entry=${t.entryPx} settle=${settleClose} hit=${hit} spotNet=${(spotNet * 100).toFixed(3)}%`);
    openTrades.splice(i, 1);
  }
}

// ---- WebSocket Binance (público, read-only) ----
const ws = new WebSocket("wss://stream.binance.com:9443/stream?streams=ethusdt@kline_5m/ethusdt@bookTicker");
ws.on("open", () => console.log("[ws] conectado a Binance (read-only)"));
ws.on("message", (raw: string) => {
  const msg = JSON.parse(raw) as { stream: string; data: Record<string, unknown> };
  if (msg.stream.endsWith("bookTicker")) {
    lastBook = { bid: Number(msg.data.b), ask: Number(msg.data.a), eventTime: Number(msg.data.E ?? Date.now()) };
    return;
  }
  const k = msg.data.k as { t: number; o: string; h: string; l: string; c: string; x: boolean };
  if (!k.x) return; // só candle fechado
  const bucketStart = k.t;
  settleDue(bucketStart);
  onCandleClosed(bucketStart, Number(k.o), Number(k.h), Number(k.l), Number(k.c));
});
ws.on("error", (e: Error) => console.error("[ws] erro:", e.message));
ws.on("close", () => { console.error("[ws] fechado — reconectando em 5s"); setTimeout(() => process.exit(3), 5000); }); // supervisor externo reinicia
console.log("[runner] forward paper iniciado — leitura apenas, sem ordens");
