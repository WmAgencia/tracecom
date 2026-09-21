/**
 * CANDLES ARCHIVE — grava cada candle de 5s em disco (por ativo/dia) para arquivamento em zip no GitHub.
 *
 * - Aditivo: NAO participa de decisao/execucao. Só registra.
 * - Disco efemero do container: o GitHub Action puxa a cada 3h (janela rolante de 3 dias no repo).
 * - Formato: /<dir>/YYYY-MM-DD/<marketKey>.csv  (linhas: bucketEnd,open,high,low,close)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const CANDLES_ARCHIVE_VERSION = "candles-archive-v1";
export const CANDLES_KEEP_DAYS = 3;

const dayOf = (ms) => new Date(Number(ms)).toISOString().slice(0, 10);
const safeKey = (marketKey) => String(marketKey ?? "unknown").replace(/[^A-Za-z0-9_.:-]/g, "_");

export class CandlesArchive {
  constructor({ dir = process.env.CANDLES_ARCHIVE_DIR || "/tmp/tracecom-candles", log = () => {}, now = () => Date.now(), keepDays = CANDLES_KEEP_DAYS } = {}) {
    this.dir = dir;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.now = now;
    this.keepDays = Math.max(1, Math.min(14, Number(keepDays) || CANDLES_KEEP_DAYS));
    this.stats = { recorded: 0, errors: 0, lastAt: null, lastMarket: null, days: 0, bytes: 0 };
    this.ready = false;
    try { fs.mkdirSync(this.dir, { recursive: true }); this.ready = true; } catch { this.ready = false; }
  }

  record(marketKey, candle) {
    if (!this.ready || !candle) return false;
    const bucketEnd = Number(candle.bucketEnd ?? candle.bucketStart ?? 0);
    const open = Number(candle.open); const high = Number(candle.high); const low = Number(candle.low); const close = Number(candle.close);
    if (!Number.isFinite(bucketEnd) || !Number.isFinite(close)) return false;
    try {
      const day = dayOf(bucketEnd);
      const dir = path.join(this.dir, day);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, safeKey(marketKey) + ".csv"), `${bucketEnd},${open},${high},${low},${close}\n`);
      this.stats.recorded += 1;
      this.stats.lastAt = this.now();
      this.stats.lastMarket = marketKey;
      return true;
    } catch { this.stats.errors += 1; return false; }
  }

  listDays() {
    if (!this.ready) return [];
    try {
      return fs.readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map((d) => d.name).sort();
    } catch { return []; }
  }

  /** Gzip do CSV concatenado (market,bucketEnd,open,high,low,close) de um dia. */
  dayGzip(date) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "")) ? String(date) : dayOf(this.now());
    const dir = path.join(this.dir, day);
    if (!this.ready || !fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".csv")).sort();
    const chunks = ["market,bucketEnd,open,high,low,close\n"];
    for (const file of files) {
      const market = file.replace(/\.csv$/, "");
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      for (const line of text.split("\n")) {
        if (!line) continue;
        chunks.push(market + "," + line + "\n");
      }
    }
    const csv = chunks.join("");
    return { day, bytes: Buffer.byteLength(csv), gzip: zlib.gzipSync(Buffer.from(csv, "utf8"), { level: 9 }), markets: files.length };
  }

  /** Remove dias mais antigos que keepDays. */
  prune() {
    const cutoff = dayOf(this.now() - this.keepDays * 86_400_000);
    let removed = 0;
    for (const day of this.listDays()) {
      if (day < cutoff) {
        try { fs.rmSync(path.join(this.dir, day), { recursive: true, force: true }); removed += 1; } catch { /* noop */ }
      }
    }
    if (removed) this.#safeLog("CANDLES_ARCHIVE_PRUNED", JSON.stringify({ removed, cutoff }));
    return removed;
  }

  status() {
    const days = this.listDays();
    return { version: CANDLES_ARCHIVE_VERSION, ready: this.ready, dir: this.dir, days, keepDays: this.keepDays, stats: { ...this.stats } };
  }

  #safeLog(type, detail) { try { this.log(type, detail); } catch { /* noop */ } }
}
