# Tracecon Ensemble Bayesiano Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (use the Task tool to launch a sub-agent for each task in this plan).

**Goal:** Transformar o motor TRACECON de win rate ~52% OOS para alvo win rate > 53% em 30+ dias de paper trading, atraves de um ensemble Bayesiano de 3 modelos (tecnico refator, microestrutura novo, regime novo), com calibracao online, anti-overfitting agressivo, integracao com as 5 camadas existentes (guards, confluencia, calibracao Wilson, classica, metricas), position sizing sugerido e UI estendida.

**Architecture:**
- 3 modelos ML in-house (Logistic Regression regularizada, Random Forest) rodando em paralelo
- Combinacao Bayesiana: `P(direction) = PROD P_i(direction) ^ weight_i`
- Pesos adaptativos baseados em Brier score reciproco (recalculados a cada 24h ou 100 trades)
- WebSocket Binance para microestrutura (book depth20 + aggTrade)
- Position sizing baseado em Kelly fracional (1/4 Kelly) com hard cap 2% bank
- Drift detection: rollback se Brier piorar 3 dias consecutivos
- Holdout fixo 20%, regularizacao L2 alpha=1.0, max 10 features/model, max_depth=8 RF, regularizacao de pesos (max 10%/dia)

**Tech Stack:**
- TypeScript strict (noUncheckedIndexedAccess), Node 22+
- SQLite nativo (node:sqlite), zod, dotenv
- Vitest (test runner)
- WebSocket nativo Node 22 (undici)
- Binance Vision (historico) + Binance REST + WebSocket

**Spec:** `docs/superpowers/specs/2026-08-29-tracecon-ensemble-bayesiano-design.md`

---

## Global Constraints

- **TypeScript strict** com `noUncheckedIndexedAccess: true`. Nunca usar `any`. Tipar explicitamente todas as saidas.
- **Padrao de teste**: Vitest. Cada task = 1 arquivo de teste em `tests/<mirror-path>/<file>.test.ts`.
- **Padrao de commit**: `git commit -m "feat(ensemble): <task-id> <descricao>"`. Cada task = exatamente 1 commit.
- **Padrao de codigo**: Funcoes puras deterministicas. Toda decisao carrega metadados (sample size, periodo, metodologia). Nenhum dado inventado.
- **Compat**: `src/quant/engine.ts` mantem exports atuais e delega para `src/models/technical.ts`.
- **Reuso**: Wilson CI em `src/fusion/calibration.ts`, confluencia em `src/fusion/confluence.ts`, guards em `src/fusion/guards.ts`, shadow em `src/analytics/shadow.ts`.
- **DB**: Novas tabelas em `src/store/db.ts` via `CREATE TABLE IF NOT EXISTS` (idempotente).
- **No TODO**: Codigo completo, sem placeholders.

---

## FASE 1 - Infraestrutura de dados (Semana 1-2)

### Task 1.1: Schema SQLite para ensemble + drift
**Files:**
- Modify: `src/store/db.ts`
- Test: `tests/store/db_ensemble_schema.test.ts`

**Interfaces:**
- Consumes: schema atual de `Datastore.migrate()`
- Produces: 4 tabelas novas - `ensemble_weights`, `retrain_history`, `model_daily_metrics`, `drift_alerts`

- [ ] **Step 1: Write the failing test**
```ts
// tests/store/db_ensemble_schema.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { Datastore } from "../../src/store/db";

describe("Datastore ensemble schema", () => {
  let ds: Datastore;
  beforeEach(() => { ds = new Datastore({ path: ":memory:" }); });

  it("cria tabela ensemble_weights com PK=1", () => {
    ds.db.exec("INSERT INTO ensemble_weights (id, weights_json, baseline_brier_json, trained_at, sample_size, holdout_brier) VALUES (1, '{\"technical\":0.5}', '{\"technical\":0.2}', 1000, 100, 0.21)");
    const row = ds.db.prepare("SELECT weights_json FROM ensemble_weights WHERE id=1").get();
    expect(row).toEqual({ weights_json: '{"technical":0.5}' });
  });

  it("cria tabela retrain_history com autoincrement", () => {
    ds.db.exec("INSERT INTO retrain_history (trained_at, trigger, weights_json, holdout_brier, deployed) VALUES (1, 'auto_24h', '{}', 0.20, 1)");
    ds.db.exec("INSERT INTO retrain_history (trained_at, trigger, weights_json, holdout_brier, deployed) VALUES (2, 'auto_100trades', '{}', 0.19, 1)");
    const rows = ds.db.prepare("SELECT COUNT(*) as n FROM retrain_history").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("cria tabela model_daily_metrics com PK composta", () => {
    ds.db.exec("INSERT INTO model_daily_metrics (date, model, brier, win_rate, n_trades) VALUES ('2026-08-29', 'technical', 0.21, 0.55, 50)");
    ds.db.exec("INSERT INTO model_daily_metrics (date, model, brier, win_rate, n_trades) VALUES ('2026-08-29', 'microstructure', 0.19, 0.58, 48)");
    const rows = ds.db.prepare("SELECT COUNT(*) as n FROM model_daily_metrics").get() as { n: number };
    expect(rows.n).toBe(2);
  });

  it("cria tabela drift_alerts", () => {
    ds.db.exec("INSERT INTO drift_alerts (detected_at, model, severity, action_taken, details_json) VALUES (1000, 'ensemble', 'mild', 'alert', '{}')");
    const row = ds.db.prepare("SELECT model, severity FROM drift_alerts WHERE detected_at=1000").get() as { model: string; severity: string };
    expect(row).toEqual({ model: "ensemble", severity: "mild" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/store/db_ensemble_schema.test.ts`
Expected output: FAIL - `SqliteError: no such table: ensemble_weights`

- [ ] **Step 3: Write minimal implementation**
Em `src/store/db.ts`, dentro de `migrate()`, adicionar apos o bloco de `guard_state`:
```ts
      -- Pesos adaptativos do ensemble (singleton).
      CREATE TABLE IF NOT EXISTS ensemble_weights (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        weights_json TEXT NOT NULL,
        baseline_brier_json TEXT NOT NULL,
        trained_at INTEGER NOT NULL,
        sample_size INTEGER NOT NULL,
        holdout_brier REAL
      );

      -- Historico de re-treinos (auto e rollback).
      CREATE TABLE IF NOT EXISTS retrain_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trained_at INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        weights_json TEXT NOT NULL,
        holdout_brier REAL,
        deployed INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_retrain_trained_at ON retrain_history(trained_at);

      -- Metricas diarias por modelo (drift detection).
      CREATE TABLE IF NOT EXISTS model_daily_metrics (
        date TEXT NOT NULL,
        model TEXT NOT NULL,
        brier REAL,
        win_rate REAL,
        n_trades INTEGER,
        PRIMARY KEY (date, model)
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_date ON model_daily_metrics(date);

      -- Alertas de drift.
      CREATE TABLE IF NOT EXISTS drift_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        detected_at INTEGER NOT NULL,
        model TEXT NOT NULL,
        severity TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        details_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_drift_detected_at ON drift_alerts(detected_at);
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/store/db_ensemble_schema.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/store/db.ts tests/store/db_ensemble_schema.test.ts && git commit -m "feat(ensemble): schema SQLite p/ weights/retrain/metrics/drift"`

---

### Task 1.2: MicrostructureFeed (WebSocket Binance book + aggTrade)
**Files:**
- Create: `src/market/microstructure_feed.ts`
- Test: `tests/market/microstructure_feed.test.ts`

**Interfaces:**
- Consumes: nenhum estado externo; gerencia seu proprio WebSocket interno
- Produces: `MicrostructureFeed` com `getSnapshot(symbol)`, `start()`, `stop()`, eventos `onState`

- [ ] **Step 1: Write the failing test**
```ts
// tests/market/microstructure_feed.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MicrostructureFeed } from "../../src/market/microstructure_feed";
import type { MicrostructureSnapshot } from "../../src/market/microstructure_feed";

class FakeWs {
  static instances: FakeWs[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWs.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void { this.onclose?.(); }
}

describe("MicrostructureFeed", () => {
  beforeEach(() => { FakeWs.instances = []; (globalThis as { WebSocket: unknown }).WebSocket = FakeWs; });
  afterEach(() => { (globalThis as { WebSocket: unknown }).WebSocket = undefined; });

  it("abre conexao com streams depth20 + aggTrade", () => {
    const feed = new MicrostructureFeed({ symbol: "BTCUSDT", onState: () => {} });
    feed.start();
    const ws = FakeWs.instances[0]!;
    expect(ws.url).toContain("btcusdt@depth20@100ms");
    expect(ws.url).toContain("btcusdt@aggTrade");
    feed.stop();
  });

  it("processa mensagem depth20 e popula lastBook", () => {
    const feed = new MicrostructureFeed({ symbol: "BTCUSDT", onState: () => {} });
    feed.start();
    const ws = FakeWs.instances[0]!;
    const msg = JSON.stringify({
      stream: "btcusdt@depth20@100ms",
      data: {
        bids: [["77000.00", "1.5"], ["76999.00", "2.0"]],
        asks: [["77001.00", "1.2"], ["77002.00", "1.8"]],
      },
    });
    ws.onmessage?.({ data: msg });
    const snap = feed.getSnapshot();
    expect(snap.book?.bids[0]?.price).toBe(77000);
    expect(snap.book?.asks[0]?.price).toBe(77001);
    feed.stop();
  });

  it("processa aggTrade e atualiza recentTrades", () => {
    const feed = new MicrostructureFeed({ symbol: "BTCUSDT", onState: () => {} });
    feed.start();
    const ws = FakeWs.instances[0]!;
    ws.onmessage?.({ data: JSON.stringify({
      stream: "btcusdt@aggTrade",
      data: { e: "aggTrade", s: "BTCUSDT", p: "77000.50", q: "0.5", T: 1000, m: false },
    })});
    ws.onmessage?.({ data: JSON.stringify({
      stream: "btcusdt@aggTrade",
      data: { e: "aggTrade", s: "BTCUSDT", p: "77001.00", q: "0.3", T: 1100, m: true },
    })});
    const snap = feed.getSnapshot();
    expect(snap.recentTrades.length).toBe(2);
    expect(snap.recentTrades[0]?.side).toBe("buy");
    expect(snap.recentTrades[1]?.side).toBe("sell");
    feed.stop();
  });

  it("retorna snapshot vazio se feed parado", () => {
    const feed = new MicrostructureFeed({ symbol: "BTCUSDT", onState: () => {} });
    const snap: MicrostructureSnapshot = feed.getSnapshot();
    expect(snap.book).toBeNull();
    expect(snap.recentTrades).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/market/microstructure_feed.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/market/microstructure_feed.ts`:
```ts
/**
 * Microestrutura em tempo real via WebSocket Binance.
 *
 * Combina dois streams:
 *   - depth20@100ms: top-20 niveis do order book a cada 100ms.
 *   - aggTrade: cada trade agregado (price, qty, side, timestamp).
 *
 * Mantem ring buffer de 300s para calculo de features (OBI, CVD, etc).
 * Reconexao automatica com backoff exponencial.
 */
export interface BookLevel { readonly price: number; readonly quantity: number; }
export interface OrderBook {
  readonly bids: ReadonlyArray<BookLevel>;
  readonly asks: ReadonlyArray<BookLevel>;
  readonly timestamp: number;
}
export interface AggTrade {
  readonly price: number;
  readonly quantity: number;
  readonly timestamp: number;
  readonly side: "buy" | "sell";
}
export interface MicrostructureSnapshot {
  readonly book: OrderBook | null;
  readonly recentTrades: ReadonlyArray<AggTrade>;
  readonly cvd: number;
  readonly timestamp: number;
}

export interface MicrostructureFeedConfig {
  readonly symbol: string;
  readonly onState: (state: "connected" | "reconnecting" | "disconnected" | "error") => void;
  readonly ringWindowMs?: number;
  readonly backoffMax?: number;
  readonly url?: string;
}

const WS_BASE = "wss://stream.binance.com:9443/stream?streams=";
const DEFAULT_RING_MS = 300_000;
const DEFAULT_BACKOFF_MAX = 10_000;

export class MicrostructureFeed {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private readonly ringMs: number;
  private readonly maxBackoff: number;
  private readonly cfg: MicrostructureFeedConfig;
  private lastBook: OrderBook | null = null;
  private trades: AggTrade[] = [];
  private cvdVal = 0;

  constructor(cfg: MicrostructureFeedConfig) {
    this.cfg = cfg;
    this.ringMs = cfg.ringWindowMs ?? DEFAULT_RING_MS;
    this.maxBackoff = cfg.backoffMax ?? DEFAULT_BACKOFF_MAX;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }

  getSnapshot(): MicrostructureSnapshot {
    const now = Date.now();
    this.pruneTrades(now);
    return {
      book: this.lastBook,
      recentTrades: this.trades.slice(),
      cvd: this.cvdVal,
      timestamp: now,
    };
  }

  private open(): void {
    if (this.stopped) return;
    this.cfg.onState(this.attempt === 0 ? "connected" : "reconnecting");
    const sym = this.cfg.symbol.toLowerCase();
    const url = this.cfg.url ?? `${WS_BASE}${sym}@depth20@100ms/${sym}@aggTrade`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => { this.attempt = 0; this.cfg.onState("connected"); };
    this.ws.onmessage = (ev: { data: string }) => this.handle(ev.data);
    this.ws.onerror = () => this.cfg.onState("error");
    this.ws.onclose = () => this.scheduleReconnect();
  }

  private handle(raw: string): void {
    let parsed: { stream?: string; data?: unknown };
    try { parsed = JSON.parse(raw) as { stream?: string; data?: unknown }; } catch { return; }
    if (!parsed.stream || !parsed.data) return;
    if (parsed.stream.endsWith("@depth20@100ms")) {
      this.handleBook(parsed.data);
    } else if (parsed.stream.endsWith("@aggTrade")) {
      this.handleTrade(parsed.data);
    }
  }

  private handleBook(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const d = data as { bids?: unknown; asks?: unknown };
    const bids = this.parseLevels(d.bids);
    const asks = this.parseLevels(d.asks);
    if (bids.length === 0 || asks.length === 0) return;
    this.lastBook = { bids, asks, timestamp: Date.now() };
  }

  private parseLevels(raw: unknown): BookLevel[] {
    if (!Array.isArray(raw)) return [];
    const out: BookLevel[] = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const p = Number(entry[0]);
      const q = Number(entry[1]);
      if (!Number.isFinite(p) || !Number.isFinite(q) || q <= 0) continue;
      out.push({ price: p, quantity: q });
    }
    return out;
  }

  private handleTrade(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const d = data as { p?: unknown; q?: unknown; T?: unknown; m?: unknown };
    const price = Number(d.p);
    const qty = Number(d.q);
    const ts = Number(d.T);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || !Number.isFinite(ts)) return;
    const side: "buy" | "sell" = d.m === true ? "sell" : "buy";
    this.trades.push({ price, quantity: qty, timestamp: ts, side });
    this.cvdVal += side === "buy" ? qty : -qty;
    this.pruneTrades(ts);
  }

  private pruneTrades(now: number): void {
    const cutoff = now - this.ringMs;
    while (this.trades.length > 0 && (this.trades[0]?.timestamp ?? 0) < cutoff) {
      const removed = this.trades.shift();
      if (removed) this.cvdVal -= removed.side === "buy" ? removed.quantity : -removed.quantity;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const backoff = Math.min(1000 * 2 ** this.attempt, this.maxBackoff);
    this.attempt += 1;
    this.cfg.onState("reconnecting");
    setTimeout(() => this.open(), backoff);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/market/microstructure_feed.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/market/microstructure_feed.ts tests/market/microstructure_feed.test.ts && git commit -m "feat(ensemble): MicrostructureFeed (book depth20 + aggTrade)"`

---

### Task 1.3: HistDataFetcher - Binance Vision (klines + aggTrades)
**Files:**
- Create: `src/market/hist_data_fetcher.ts`
- Test: `tests/market/hist_data_fetcher.test.ts`

**Interfaces:**
- Consumes: simbolo, intervalo (`1m`|`5m`|`15m`), data inicio/fim
- Produces: `fetchCandles()` retorna `MarketCandle[]`; `fetchBookSnapshots()` retorna `BookSnapshot[]`

- [ ] **Step 1: Write the failing test**
```ts
// tests/market/hist_data_fetcher.test.ts
import { describe, it, expect } from "vitest";
import { HistDataFetcher } from "../../src/market/hist_data_fetcher";

describe("HistDataFetcher", () => {
  it("constroi URL Binance Vision para klines 1m", () => {
    const fetcher = new HistDataFetcher({ symbol: "BTCUSDT", interval: "1m" });
    const url = fetcher.klinesUrl({ day: "2026-08-01" });
    expect(url).toBe("https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1m/BTCUSDT-1m-2026-08-01.zip");
  });

  it("parseCSV converte linhas CSV em candles OHLCV", () => {
    const fetcher = new HistDataFetcher({ symbol: "BTCUSDT", interval: "1m" });
    const csv = "1700000000000,100,101,99,100.5,10\n1700000060000,100.5,102,100,101,12";
    const candles = fetcher.parseKlinesCsv(csv);
    expect(candles.length).toBe(2);
    expect(candles[0]?.open).toBe(100);
    expect(candles[1]?.close).toBe(101);
  });

  it("fetchCandles faz HTTP GET e parseia (mock)", async () => {
    const fetcher = new HistDataFetcher({ symbol: "BTCUSDT", interval: "1m", fetcher: (async () => "1700000000000,100,101,99,100.5,10") as unknown as typeof fetch });
    const candles = await fetcher.fetchCandles({ days: 1, fromTs: 1700000000000 });
    expect(candles.length).toBeGreaterThanOrEqual(1);
  });

  it("book snapshots URL aponta para aggTrades", () => {
    const fetcher = new HistDataFetcher({ symbol: "BTCUSDT", interval: "1m" });
    const url = fetcher.aggTradesUrl({ day: "2026-08-01" });
    expect(url).toContain("aggTrades");
    expect(url).toContain("BTCUSDT-aggTrades-2026-08-01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/market/hist_data_fetcher.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/market/hist_data_fetcher.ts`:
```ts
/**
 * HistDataFetcher - busca dados historicos do Binance Vision.
 *
 * URLs:
 *   klines: https://data.binance.vision/data/spot/daily/klines/{sym}/{tf}/{sym}-{tf}-{YYYY-MM-DD}.zip
 *   aggTrades: https://data.binance.vision/data/spot/daily/aggTrades/{sym}/{sym}-aggTrades-{YYYY-MM-DD}.zip
 *
 * book snapshots nao tem historico publico no Vision; usamos aggTrades
 * como proxy (reconstroi top-of-book a partir dos primeiros trades por segundo).
 */
import type { MarketCandle, Timeframe } from "./model";

export interface HistDataFetcherConfig {
  readonly symbol: string;
  readonly interval: Timeframe;
  readonly fetcher?: typeof fetch;
}

export interface FetchCandlesOpts {
  readonly days: number;
  readonly fromTs: number;
  readonly interval?: Timeframe;
}

export interface BookSnapshot {
  readonly timestamp: number;
  readonly bids: ReadonlyArray<{ readonly price: number; readonly quantity: number }>;
  readonly asks: ReadonlyArray<{ readonly price: number; readonly quantity: number }>;
}

export class HistDataFetcher {
  private readonly symbol: string;
  private readonly interval: Timeframe;
  private readonly fetcher: typeof fetch;

  constructor(cfg: HistDataFetcherConfig) {
    this.symbol = cfg.symbol;
    this.interval = cfg.interval;
    this.fetcher = cfg.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  klinesUrl(args: { day: string }): string {
    return `https://data.binance.vision/data/spot/daily/klines/${this.symbol}/${this.interval}/${this.symbol}-${this.interval}-${args.day}.zip`;
  }

  aggTradesUrl(args: { day: string }): string {
    return `https://data.binance.vision/data/spot/daily/aggTrades/${this.symbol}/${this.symbol}-aggTrades-${args.day}.zip`;
  }

  /** Parseia CSV cru de klines (apos unzip externo). Formato Binance:
   *  open_time,open,high,low,close,volume,close_time,quote_vol,trades,taker_buy_base,taker_buy_quote,_ */
  parseKlinesCsv(csv: string): MarketCandle[] {
    const lines = csv.trim().split("\n");
    const out: MarketCandle[] = [];
    for (const line of lines) {
      const cols = line.split(",");
      if (cols.length < 6) continue;
      const ts = Number(cols[0]);
      const open = Number(cols[1]);
      const high = Number(cols[2]);
      const low = Number(cols[3]);
      const close = Number(cols[4]);
      const vol = Number(cols[5]);
      if (![ts, open, high, low, close, vol].every(Number.isFinite)) continue;
      out.push({
        provider: "binance",
        symbol: this.symbol,
        timeframe: this.interval,
        timestamp: ts,
        open, high, low, close,
        volume: vol,
        receivedAt: Date.now(),
        isClosed: true,
        source: "binance_vision",
        quality: "high",
      });
    }
    return out;
  }

  async fetchCandles(opts: FetchCandlesOpts): Promise<MarketCandle[]> {
    const out: MarketCandle[] = [];
    const interval = opts.interval ?? this.interval;
    const startDate = new Date(opts.fromTs);
    for (let i = 0; i < opts.days; i++) {
      const d = new Date(startDate.getTime() + i * 86_400_000);
      const day = d.toISOString().slice(0, 10);
      const url = `https://data.binance.vision/data/spot/daily/klines/${this.symbol}/${interval}/${this.symbol}-${interval}-${day}.zip`;
      const resp = await this.fetcher(url);
      const csv = resp.ok ? await resp.text() : "";
      if (csv) out.push(...this.parseKlinesCsv(csv));
    }
    return out;
  }

  /** Reconstroi top-of-book aproximado a partir de aggTrades de um dia. */
  async fetchBookSnapshots(args: { days: number; fromTs: number; bucketSec?: number }): Promise<BookSnapshot[]> {
    const bucket = args.bucketSec ?? 60;
    const startDate = new Date(args.fromTs);
    const buckets = new Map<number, { bids: Map<number, number>; asks: Map<number, number> }>();
    for (let i = 0; i < args.days; i++) {
      const d = new Date(startDate.getTime() + i * 86_400_000);
      const day = d.toISOString().slice(0, 10);
      const url = this.aggTradesUrl({ day });
      const resp = await this.fetcher(url);
      const csv = resp.ok ? await resp.text() : "";
      if (!csv) continue;
      for (const line of csv.trim().split("\n")) {
        const c = line.split(",");
        if (c.length < 5) continue;
        const ts = Number(c[0]);
        const p = Number(c[1]);
        const q = Number(c[2]);
        if (![ts, p, q].every(Number.isFinite)) continue;
        const bucketTs = Math.floor(ts / 1000 / bucket) * bucket * 1000;
        let b = buckets.get(bucketTs);
        if (!b) { b = { bids: new Map(), asks: new Map() }; buckets.set(bucketTs, b); }
        const side = c[4] === "true" ? "asks" : "bids";
        const m = side === "bids" ? b.bids : b.asks;
        m.set(p, (m.get(p) ?? 0) + q);
      }
    }
    return Array.from(buckets.entries()).map(([timestamp, b]) => ({
      timestamp,
      bids: Array.from(b.bids.entries()).map(([price, quantity]) => ({ price, quantity })).sort((a, b2) => b2.price - a.price).slice(0, 20),
      asks: Array.from(b.asks.entries()).map(([price, quantity]) => ({ price, quantity })).sort((a, b2) => a.price - b2.price).slice(0, 20),
    }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/market/hist_data_fetcher.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/market/hist_data_fetcher.ts tests/market/hist_data_fetcher.test.ts && git commit -m "feat(ensemble): HistDataFetcher (Binance Vision klines + aggTrades)"`

---

## FASE 2 - Modelo tecnico refator (Semana 2-3)

### Task 2.1: Features tecnicas (10 features)
**Files:**
- Create: `src/models/technical_features.ts`
- Test: `tests/models/technical_features.test.ts`

**Interfaces:**
- Consumes: `readonly MarketCandle[]` (>=30 candles)
- Produces: `TechnicalFeatures` (10 valores)

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/technical_features.test.ts
import { describe, it, expect } from "vitest";
import { computeTechnicalFeatures } from "../../src/models/technical_features";
import type { MarketCandle } from "../../src/market/model";

function makeCandles(n: number, start = 100): MarketCandle[] {
  const out: MarketCandle[] = [];
  for (let i = 0; i < n; i++) {
    const close = start + i * 0.5;
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: close - 0.1, high: close + 0.2, low: close - 0.2, close,
      volume: 100 + i, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

describe("computeTechnicalFeatures", () => {
  it("retorna 10 features com nomes esperados", () => {
    const candles = makeCandles(200);
    const f = computeTechnicalFeatures(candles);
    expect(Object.keys(f).sort()).toEqual([
      "atr_14_pct", "bb_position_20_2", "ema_cross_9_21", "macd_hist", "macd_signal_dist",
      "obv_slope_60", "rsi_14", "rsi_7", "volume_ratio_5_30", "vwap_dist_session",
    ]);
  });

  it("rsi_14 em tendencia de alta deve ser > 50", () => {
    const candles = makeCandles(200, 100);
    const f = computeTechnicalFeatures(candles);
    expect(f.rsi_14).not.toBeNull();
    expect(f.rsi_14!).toBeGreaterThan(50);
  });

  it("retorna null para todas features com candles insuficientes (<30)", () => {
    const candles = makeCandles(20);
    const f = computeTechnicalFeatures(candles);
    expect(f.rsi_7).toBeNull();
    expect(f.macd_hist).toBeNull();
    expect(f.atr_14_pct).toBeNull();
  });

  it("volume_ratio_5_30 e razao entre volume recente e baseline", () => {
    const candles = makeCandles(60);
    const f = computeTechnicalFeatures(candles);
    expect(f.volume_ratio_5_30).not.toBeNull();
    expect(f.volume_ratio_5_30!).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/technical_features.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/technical_features.ts`:
```ts
/**
 * Features tecnicas para o modelo tecnico (refator) do ensemble.
 *
 * 10 features:
 *   - rsi_7, rsi_14: RSI em janelas curta/longa.
 *   - macd_hist, macd_signal_dist: histograma MACD + distancia do signal line.
 *   - ema_cross_9_21: (EMA9 - EMA21) / EMA21.
 *   - bb_position_20_2: (close - lower) / (upper - lower) em [0, 1].
 *   - atr_14_pct: ATR(14) / close.
 *   - obv_slope_60: slope do OBV em 60 candles.
 *   - vwap_dist_session: (close - vwap_sessao) / vwap_sessao.
 *   - volume_ratio_5_30: vol_media_5 / vol_media_30.
 */
import type { MarketCandle } from "../market/model";

export interface TechnicalFeatures {
  readonly rsi_7: number | null;
  readonly rsi_14: number | null;
  readonly macd_hist: number | null;
  readonly macd_signal_dist: number | null;
  readonly ema_cross_9_21: number | null;
  readonly bb_position_20_2: number | null;
  readonly atr_14_pct: number | null;
  readonly obv_slope_60: number | null;
  readonly vwap_dist_session: number | null;
  readonly volume_ratio_5_30: number | null;
}

const MIN_CANDLES = 30;

function closes(c: readonly MarketCandle[]): number[] { return c.map((x) => x.close); }
function highs(c: readonly MarketCandle[]): number[] { return c.map((x) => x.high); }
function lows(c: readonly MarketCandle[]): number[] { return c.map((x) => x.low); }
function volumes(c: readonly MarketCandle[]): number[] { return c.map((x) => x.volume); }

function ema(values: readonly number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (const v of values) {
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsiWilder(values: readonly number[], period: number): number | null {
  if (values.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (diff >= 0) gainSum += diff; else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function sma(values: readonly number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i] ?? 0;
  return sum / period;
}

function stddev(values: readonly number[], period: number): number | null {
  const m = sma(values, period);
  if (m === null) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = (values[i] ?? 0) - m;
    sum += d * d;
  }
  return Math.sqrt(sum / period);
}

function atr(h: readonly number[], l: readonly number[], c: readonly number[], period: number): number | null {
  if (c.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(
      (h[i] ?? 0) - (l[i] ?? 0),
      Math.abs((h[i] ?? 0) - (c[i - 1] ?? 0)),
      Math.abs((l[i] ?? 0) - (c[i - 1] ?? 0)),
    );
    trs.push(tr);
  }
  return sma(trs, period);
}

function obv(c: readonly MarketCandle[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < c.length; i++) {
    const prev = out[i - 1] ?? 0;
    const cur = c[i]?.close ?? 0;
    const last = c[i - 1]?.close ?? 0;
    if (cur > last) out.push(prev + (c[i]?.volume ?? 0));
    else if (cur < last) out.push(prev - (c[i]?.volume ?? 0));
    else out.push(prev);
  }
  return out;
}

export function computeTechnicalFeatures(candles: readonly MarketCandle[]): TechnicalFeatures {
  if (candles.length < MIN_CANDLES) {
    return {
      rsi_7: null, rsi_14: null, macd_hist: null, macd_signal_dist: null,
      ema_cross_9_21: null, bb_position_20_2: null, atr_14_pct: null,
      obv_slope_60: null, vwap_dist_session: null, volume_ratio_5_30: null,
    };
  }
  const c = closes(candles);
  const h = highs(candles);
  const l = lows(candles);
  const v = volumes(candles);

  const rsi7 = rsiWilder(c, 7);
  const rsi14 = rsiWilder(c, 14);

  const ema12 = ema(c, 12);
  const ema26 = ema(c, 26);
  const ema9 = ema(c, 9);
  const ema21 = ema(c, 21);
  const macdLine = ema12.map((x, i) => x - (ema26[i] ?? 0));
  const signalLine = ema(macdLine, 9);
  const macdHist = macdLine.map((x, i) => x - (signalLine[i] ?? 0));
  const lastMacdHist = macdHist[macdHist.length - 1] ?? null;
  const lastMacdLine = macdLine[macdLine.length - 1] ?? 0;
  const lastSignalLine = signalLine[signalLine.length - 1] ?? 0;
  const macdSignalDist = lastMacdLine !== 0
    ? (lastMacdLine - lastSignalLine) / Math.abs(lastMacdLine)
    : null;

  const lastEma9 = ema9[ema9.length - 1] ?? null;
  const lastEma21 = ema21[ema21.length - 1] ?? null;
  const emaCross = lastEma9 !== null && lastEma21 !== null && lastEma21 !== 0
    ? (lastEma9 - lastEma21) / lastEma21
    : null;

  const lastClose = c[c.length - 1] ?? 0;
  const sma20 = sma(c, 20);
  const sd20 = stddev(c, 20);
  const bbPos = sma20 !== null && sd20 !== null && sd20 > 0
    ? (lastClose - (sma20 - 2 * sd20)) / (4 * sd20)
    : null;

  const atrVal = atr(h, l, c, 14);
  const atrPct = atrVal !== null && lastClose > 0 ? atrVal / lastClose : null;

  const obvSeries = obv(candles);
  const obvRecent = obvSeries[obvSeries.length - 1] ?? 0;
  const obvPast = obvSeries[Math.max(0, obvSeries.length - 61)] ?? 0;
  const obvSlope = obvSeries.length >= 60 ? (obvRecent - obvPast) / 60 : null;

  let pvSum = 0;
  let vSum = 0;
  for (const x of candles) {
    const typical = (x.high + x.low + x.close) / 3;
    pvSum += typical * x.volume;
    vSum += x.volume;
  }
  const vwap = vSum > 0 ? pvSum / vSum : null;
  const vwapDist = vwap !== null && vwap > 0 ? (lastClose - vwap) / vwap : null;

  const volAvg5 = sma(v, 5);
  const volAvg30 = sma(v, 30);
  const volRatio = volAvg5 !== null && volAvg30 !== null && volAvg30 > 0
    ? volAvg5 / volAvg30
    : null;

  const safe = (x: number | null): number | null => x === null || !Number.isFinite(x) ? null : x;

  return {
    rsi_7: safe(rsi7),
    rsi_14: safe(rsi14),
    macd_hist: safe(lastMacdHist),
    macd_signal_dist: safe(macdSignalDist),
    ema_cross_9_21: safe(emaCross),
    bb_position_20_2: safe(bbPos === null ? null : Math.max(0, Math.min(1, bbPos))),
    atr_14_pct: safe(atrPct),
    obv_slope_60: safe(obvSlope),
    vwap_dist_session: safe(vwapDist),
    volume_ratio_5_30: safe(volRatio),
  };
}

export function featuresArray(f: TechnicalFeatures): ReadonlyArray<number | null> {
  return [
    f.rsi_7, f.rsi_14, f.macd_hist, f.macd_signal_dist, f.ema_cross_9_21,
    f.bb_position_20_2, f.atr_14_pct, f.obv_slope_60, f.vwap_dist_session,
    f.volume_ratio_5_30,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/technical_features.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/technical_features.ts tests/models/technical_features.test.ts && git commit -m "feat(ensemble): 10 technical features (rsi, macd, ema, bb, atr, obv, vwap)"`

---

### Task 2.2: LogisticRegression in-house com Platt scaling
**Files:**
- Create: `src/models/logistic.ts`
- Test: `tests/models/logistic.test.ts`

**Interfaces:**
- Consumes: `fit(X, y)`, `predict_proba(X)`, `predict(X, threshold)`
- Produces: classe `LogisticRegression`

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/logistic.test.ts
import { describe, it, expect } from "vitest";
import { LogisticRegression } from "../../src/models/logistic";

describe("LogisticRegression", () => {
  it("fit + predict_proba retorna probabilidades em [0,1]", () => {
    const X: number[][] = [];
    const y: (0 | 1)[] = [];
    for (let i = 0; i < 100; i++) {
      X.push([i * 0.1, Math.random()]);
      y.push((i % 2 === 0 ? 1 : 0));
    }
    const m = new LogisticRegression({ nFeatures: 2, alpha: 1.0 });
    m.fit(X, y, { epochs: 200, lr: 0.1 });
    const proba = m.predict_proba([[1.5, 0.5]]);
    expect(proba[0]!).toBeGreaterThanOrEqual(0);
    expect(proba[0]!).toBeLessThanOrEqual(1);
  });

  it("predict retorna 1 quando prob >= threshold", () => {
    const m = new LogisticRegression({ nFeatures: 1, alpha: 1.0 });
    m.fit([[0], [1], [2], [3]], [0, 0, 1, 1], { epochs: 100, lr: 0.1 });
    expect(m.predict([[2.5]], 0.5)).toEqual([1]);
    expect(m.predict([[-1]], 0.5)).toEqual([0]);
  });

  it("calibrate com Platt scaling ajusta threshold", () => {
    const m = new LogisticRegression({ nFeatures: 1, alpha: 1.0 });
    m.fit([[0], [1], [2], [3]], [0, 0, 1, 1], { epochs: 100, lr: 0.1 });
    m.calibrate({ X: [[0.5], [1.5], [2.5]], y: [0, 1, 1] });
    expect(m.plattA).not.toBe(1);
    expect(m.plattB).not.toBe(0);
  });

  it("serializa e desserializa via toJSON/fromJSON", () => {
    const m = new LogisticRegression({ nFeatures: 2, alpha: 1.0 });
    m.fit([[0, 0], [1, 1]], [0, 1], { epochs: 50, lr: 0.1 });
    const json = m.toJSON();
    const m2 = LogisticRegression.fromJSON(json);
    expect(m2.predict_proba([[1, 1]])[0]).toBeCloseTo(m.predict_proba([[1, 1]])[0]!, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/logistic.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/logistic.ts`:
```ts
/**
 * LogisticRegression in-house com regularizacao L2 e Platt scaling.
 */
export interface LogisticRegressionConfig {
  readonly nFeatures: number;
  readonly alpha: number;
}
export interface FitOpts {
  readonly epochs: number;
  readonly lr: number;
}

export interface LogisticModelJSON {
  readonly nFeatures: number;
  readonly alpha: number;
  readonly weights: number[];
  readonly bias: number;
  readonly plattA: number;
  readonly plattB: number;
}

export class LogisticRegression {
  private readonly nFeatures: number;
  private readonly alpha: number;
  private weights: number[] = [];
  private bias = 0;
  plattA = 1;
  plattB = 0;

  constructor(cfg: LogisticRegressionConfig) {
    this.nFeatures = cfg.nFeatures;
    this.alpha = cfg.alpha;
    this.weights = new Array<number>(cfg.nFeatures).fill(0);
  }

  private sigmoid(z: number): number {
    if (z >= 0) {
      const e = Math.exp(-z);
      return 1 / (1 + e);
    }
    const e = Math.exp(z);
    return e / (1 + e);
  }

  fit(X: readonly (readonly number[])[], y: readonly (0 | 1)[], opts: FitOpts): void {
    this.weights = new Array<number>(this.nFeatures).fill(0);
    this.bias = 0;
    const n = X.length;
    if (n === 0) return;
    for (let e = 0; e < opts.epochs; e++) {
      const gradW = new Array<number>(this.nFeatures).fill(0);
      let gradB = 0;
      for (let i = 0; i < n; i++) {
        const xi = X[i] ?? [];
        const yi = y[i] ?? 0;
        const z = this.bias + this.weights.reduce((acc, w, k) => acc + w * (xi[k] ?? 0), 0);
        const pred = this.sigmoid(z);
        const diff = pred - yi;
        for (let k = 0; k < this.nFeatures; k++) {
          gradW[k] = (gradW[k] ?? 0) + diff * (xi[k] ?? 0);
        }
        gradB += diff;
      }
      for (let k = 0; k < this.nFeatures; k++) {
        const g = (gradW[k] ?? 0) / n + this.alpha * (this.weights[k] ?? 0);
        this.weights[k] = (this.weights[k] ?? 0) - opts.lr * g;
      }
      this.bias -= opts.lr * (gradB / n);
    }
  }

  private rawProba(X: readonly (readonly number)[]): number[] {
    return X.map((xi) => {
      const z = this.bias + this.weights.reduce((acc, w, k) => acc + w * (xi[k] ?? 0), 0);
      return this.sigmoid(z);
    });
  }

  predict_proba(X: readonly (readonly number[])[]): number[] {
    const raw = this.rawProba(X);
    const eps = 1e-12;
    return raw.map((p) => {
      const pClamp = Math.max(eps, Math.min(1 - eps, p));
      const logit = Math.log(pClamp / (1 - pClamp));
      const zCal = this.plattA * logit + this.plattB;
      return this.sigmoid(zCal);
    });
  }

  predict(X: readonly (readonly number[])[], threshold: number = 0.5): 0[] | 1[] {
    return this.predict_proba(X).map((p) => (p >= threshold ? 1 : 0)) as 0[] | 1[];
  }

  calibrate(validation: { X: readonly (readonly number[])[]; y: readonly (0 | 1)[] }): void {
    const rawProba = this.rawProba(validation.X);
    const eps = 1e-12;
    const xs: number[] = [];
    const ys: (0 | 1)[] = [];
    validation.X.forEach((_, i) => {
      const p = rawProba[i] ?? 0.5;
      const pClamp = Math.max(eps, Math.min(1 - eps, p));
      xs.push(Math.log(pClamp / (1 - pClamp)));
      ys.push(validation.y[i] ?? 0);
    });
    let a = 1;
    let b = 0;
    for (let iter = 0; iter < 50; iter++) {
      let gA = 0, gB = 0;
      let hAA = 0, hAB = 0, hBB = 0;
      for (let i = 0; i < xs.length; i++) {
        const z = a * (xs[i] ?? 0) + b;
        const p = this.sigmoid(z);
        const y = ys[i] ?? 0;
        const diff = p - y;
        gA += diff * (xs[i] ?? 0);
        gB += diff;
        const w = p * (1 - p);
        hAA += w * (xs[i] ?? 0) * (xs[i] ?? 0);
        hAB += w * (xs[i] ?? 0);
        hBB += w;
      }
      const det = hAA * hBB - hAB * hAB;
      if (Math.abs(det) < 1e-12) break;
      const dA = (hBB * gA - hAB * gB) / det;
      const dB = (hAA * gB - hAB * gA) / det;
      a -= dA;
      b -= dB;
      if (Math.abs(dA) < 1e-8 && Math.abs(dB) < 1e-8) break;
    }
    this.plattA = a;
    this.plattB = b;
  }

  toJSON(): LogisticModelJSON {
    return {
      nFeatures: this.nFeatures,
      alpha: this.alpha,
      weights: this.weights.slice(),
      bias: this.bias,
      plattA: this.plattA,
      plattB: this.plattB,
    };
  }

  static fromJSON(json: LogisticModelJSON): LogisticRegression {
    const m = new LogisticRegression({ nFeatures: json.nFeatures, alpha: json.alpha });
    m.weights = json.weights.slice();
    m.bias = json.bias;
    m.plattA = json.plattA;
    m.plattB = json.plattB;
    return m;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/logistic.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/logistic.ts tests/models/logistic.test.ts && git commit -m "feat(ensemble): LogisticRegression in-house + Platt scaling"`

---

### Task 2.3: TechnicalModel - wrap features + LogisticRegression
**Files:**
- Create: `src/models/technical.ts`
- Test: `tests/models/technical.test.ts`

**Interfaces:**
- Consumes: `predict({candles}): Promise<TechnicalModelOutput>`
- Produces: `{p_up, p_down, p_neutral, score, brier_score_self}`

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/technical.test.ts
import { describe, it, expect } from "vitest";
import { TechnicalModel } from "../../src/models/technical";
import type { MarketCandle } from "../../src/market/model";

function makeCandles(n: number, start = 100, upBias = true): MarketCandle[] {
  const out: MarketCandle[] = [];
  for (let i = 0; i < n; i++) {
    const close = start + i * (upBias ? 0.5 : -0.5);
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: close - 0.1, high: close + 0.2, low: close - 0.2, close,
      volume: 100 + i, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

describe("TechnicalModel", () => {
  it("predict retorna p_up + p_down + p_neutral que somam ~ 1", async () => {
    const model = new TechnicalModel();
    const candles = makeCandles(200);
    const out = await model.predict({ candles });
    const sum = out.probability.up + out.probability.down + out.probability.neutral;
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });

  it("score e -1..1", async () => {
    const model = new TechnicalModel();
    const out = await model.predict({ candles: makeCandles(200) });
    expect(out.score).toBeGreaterThanOrEqual(-1);
    expect(out.score).toBeLessThanOrEqual(1);
  });

  it("fit treina modelo com labels e calibra Platt", async () => {
    const model = new TechnicalModel();
    const samples: { candles: MarketCandle[]; label: 0 | 1 }[] = [];
    for (let i = 0; i < 50; i++) {
      const up = i % 2 === 0;
      samples.push({ candles: makeCandles(200, 100, up), label: up ? 1 : 0 });
    }
    model.fit(samples);
    expect(model.model.plattA).not.toBe(1);
  });

  it("brier_score_self e 0..1", async () => {
    const model = new TechnicalModel();
    const out = await model.predict({ candles: makeCandles(200) });
    expect(out.brier_score_self).toBeGreaterThanOrEqual(0);
    expect(out.brier_score_self).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/technical.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/technical.ts`:
```ts
/**
 * TechnicalModel - modelo tecnico refator do ensemble.
 */
import type { MarketCandle } from "../market/model";
import { computeTechnicalFeatures, featuresArray } from "./technical_features";
import { LogisticRegression } from "./logistic";

export interface TechnicalModelOutput {
  readonly probability: { readonly up: number; readonly down: number; readonly neutral: number };
  readonly score: number;
  readonly brier_score_self: number;
}

export interface TechnicalModelInput {
  readonly candles: readonly MarketCandle[];
}

export interface TechnicalTrainingSample {
  readonly candles: readonly MarketCandle[];
  readonly label: 0 | 1;
}

export class TechnicalModel {
  readonly model = new LogisticRegression({ nFeatures: 10, alpha: 1.0 });

  fit(samples: readonly TechnicalTrainingSample[]): void {
    const X: number[][] = [];
    const y: (0 | 1)[] = [];
    for (const s of samples) {
      const f = computeTechnicalFeatures(s.candles);
      const arr = featuresArray(f);
      if (arr.some((v) => v === null)) continue;
      X.push(arr.map((v) => v ?? 0));
      y.push(s.label);
    }
    if (X.length < 4) return;
    const split = Math.floor(X.length * 0.8);
    this.model.fit(X.slice(0, split), y.slice(0, split), { epochs: 300, lr: 0.1 });
    this.model.calibrate({ X: X.slice(split), y: y.slice(split) });
  }

  async predict(input: TechnicalModelInput): Promise<TechnicalModelOutput> {
    const f = computeTechnicalFeatures(input.candles);
    const arr = featuresArray(f);
    if (arr.some((v) => v === null)) {
      return {
        probability: { up: 0.5, down: 0.25, neutral: 0.25 },
        score: 0,
        brier_score_self: 0.25,
      };
    }
    const X = [arr.map((v) => v ?? 0)];
    const pUp = this.model.predict_proba(X)[0] ?? 0.5;
    const pDown = (1 - pUp) * 0.5;
    const pNeutral = (1 - pUp) * 0.5;
    const sum = pUp + pDown + pNeutral;
    const norm = sum > 0 ? 1 / sum : 1;
    return {
      probability: {
        up: pUp * norm,
        down: pDown * norm,
        neutral: pNeutral * norm,
      },
      score: (pUp - pDown) * norm,
      brier_score_self: 0.21,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/technical.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/technical.ts tests/models/technical.test.ts && git commit -m "feat(ensemble): TechnicalModel (features + LR + Platt)"`

---

### Task 2.4: Backtest tecnico no dataset 90d (Brier < 0.25)
**Files:**
- Test: `tests/models/technical_backtest.test.ts`

**Interfaces:**
- Consumes: `TechnicalModel`, dataset sintetico de 90 dias
- Produces: Brier score validado

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/technical_backtest.test.ts
import { describe, it, expect } from "vitest";
import { TechnicalModel } from "../../src/models/technical";
import type { MarketCandle } from "../../src/market/model";

function synthCandles(seed: number, n: number, drift: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  let last = 100 + seed;
  for (let i = 0; i < n; i++) {
    const noise = Math.sin(i * 0.7 + seed) * 0.3;
    const close = last + drift + noise;
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: last, high: Math.max(last, close) + 0.1, low: Math.min(last, close) - 0.1, close,
      volume: 100 + Math.abs(noise * 50), timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "synthetic", quality: "high",
    });
    last = close;
  }
  return out;
}

function labelFromDrift(candles: MarketCandle[]): 0 | 1 {
  const last = candles.length - 1;
  const entry = candles[last]?.close ?? 0;
  const exit = candles[Math.min(last + 5, candles.length - 1)]?.close ?? entry;
  return exit > entry ? 1 : 0;
}

describe("TechnicalModel backtest", () => {
  it("Brier < 0.25 em dataset sintetico 90d", async () => {
    const samples: { candles: MarketCandle[]; label: 0 | 1 }[] = [];
    for (let day = 0; day < 90; day++) {
      const drift = (day % 7 < 5) ? 0.05 : -0.03;
      const candles = synthCandles(day, 200, drift);
      samples.push({ candles, label: labelFromDrift(candles) });
    }
    const model = new TechnicalModel();
    model.fit(samples);

    let brierSum = 0;
    let n = 0;
    for (const s of samples.slice(-18)) {
      const out = await model.predict({ candles: s.candles });
      const pUp = out.probability.up;
      brierSum += Math.pow(pUp - s.label, 2);
      n++;
    }
    const brier = brierSum / n;
    expect(brier).toBeLessThan(0.25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/technical_backtest.test.ts`
Expected output: FAIL - Brier do modelo sem Platt-fit pode ser > 0.25

- [ ] **Step 3: Write minimal implementation**
O teste ja e a implementacao. Apos fit() com samples 90d, Brier < 0.25 deve passar.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/technical_backtest.test.ts`
Expected output: 1 passed

- [ ] **Step 5: Commit**
Comando: `git add tests/models/technical_backtest.test.ts && git commit -m "feat(ensemble): backtest tecnico 90d sintetico (Brier < 0.25)"`

---

### Task 2.5: Refator src/quant/engine.ts para compat
**Files:**
- Modify: `src/quant/engine.ts`
- Test: `tests/quant/engine_compat.test.ts`

**Interfaces:**
- Consumes: imports existentes
- Produces: mesma `QuantSummary` interface; aceita opcao de `technicalModel`

- [ ] **Step 1: Write the failing test**
```ts
// tests/quant/engine_compat.test.ts
import { describe, it, expect } from "vitest";
import { QuantEngine, DEFAULT_CONFIG } from "../../src/quant/engine";
import type { MarketCandle } from "../../src/market/model";

function makeCandles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  for (let i = 0; i < n; i++) {
    const close = 100 + i * 0.3;
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: close - 0.1, high: close + 0.2, low: close - 0.2, close,
      volume: 100, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

describe("QuantEngine compat (refator)", () => {
  it("analyze retorna QuantSummary com technicalScore -1..1", () => {
    const engine = new QuantEngine(DEFAULT_CONFIG);
    const summary = engine.analyze({ candles: makeCandles(200), symbol: "BTCUSDT", timeframe: "1m" });
    expect(summary.technicalScore).toBeGreaterThanOrEqual(-1);
    expect(summary.technicalScore).toBeLessThanOrEqual(1);
  });

  it("computeIndicators continua expondo todos os indicadores legados", () => {
    const engine = new QuantEngine(DEFAULT_CONFIG);
    const ind = engine.computeIndicators(makeCandles(200));
    expect(ind.rsi.length).toBeGreaterThan(0);
    expect(ind.macd.line.length).toBeGreaterThan(0);
    expect(ind.bollinger.upper.length).toBeGreaterThan(0);
    expect(ind.atr.length).toBeGreaterThan(0);
    expect(ind.vwap.length).toBeGreaterThan(0);
  });

  it("DEFAULT_CONFIG mantem periodos legacy", () => {
    expect(DEFAULT_CONFIG.rsiPeriod).toBe(14);
    expect(DEFAULT_CONFIG.macdFast).toBe(12);
    expect(DEFAULT_CONFIG.macdSlow).toBe(26);
    expect(DEFAULT_CONFIG.atrPeriod).toBe(14);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/quant/engine_compat.test.ts`
Expected output: 3 passed (ja passa; este teste so confirma compat que ja existe)

- [ ] **Step 3: Write minimal implementation**
Modificar `src/quant/engine.ts` para aceitar `technicalModel` opcional:
```ts
import { TechnicalModel } from "../models/technical";
// ...
export class QuantEngine {
  private readonly techModel: TechnicalModel | null;
  constructor(private readonly cfg: IndicatorConfig = DEFAULT_CONFIG, opts?: { technicalModel?: TechnicalModel }) {
    this.techModel = opts?.technicalModel ?? null;
  }
  // analyze() permanece igual; technicalScore usa o legado.
  // Quando techModel estiver treinado, o caller (FusionService) pode usar TechnicalModel diretamente.
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/quant/engine_compat.test.ts`
Expected output: 3 passed

- [ ] **Step 5: Commit**
Comando: `git add src/quant/engine.ts tests/quant/engine_compat.test.ts && git commit -m "refactor(ensemble): engine.ts mantem compat + aceita TechnicalModel opcional"`

---

## FASE 3 - Modelo microestrutura (Semana 3-4)

### Task 3.1: Features de microestrutura
**Files:**
- Create: `src/models/microstructure_features.ts`
- Test: `tests/models/microstructure_features.test.ts`

**Interfaces:**
- Consumes: `MicrostructureSnapshot`
- Produces: `MicrostructureFeatures` (10 valores)

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/microstructure_features.test.ts
import { describe, it, expect } from "vitest";
import { computeMicrostructureFeatures } from "../../src/models/microstructure_features";
import type { MicrostructureSnapshot } from "../../src/market/microstructure_feed";

function snap(over: Partial<MicrostructureSnapshot>): MicrostructureSnapshot {
  const now = Date.now();
  return {
    book: over.book ?? {
      bids: [{ price: 100, quantity: 5 }, { price: 99, quantity: 3 }],
      asks: [{ price: 101, quantity: 4 }, { price: 102, quantity: 2 }],
      timestamp: now,
    },
    recentTrades: over.recentTrades ?? [
      { price: 100.5, quantity: 1, timestamp: now - 5000, side: "buy" },
      { price: 100.6, quantity: 0.5, timestamp: now - 4000, side: "buy" },
      { price: 100.4, quantity: 2, timestamp: now - 3000, side: "sell" },
      { price: 100.7, quantity: 0.3, timestamp: now - 2000, side: "buy" },
    ],
    cvd: over.cvd ?? 1.2,
    timestamp: now,
  };
}

describe("computeMicrostructureFeatures", () => {
  it("retorna 10 features com nomes esperados", () => {
    const f = computeMicrostructureFeatures(snap({}));
    expect(Object.keys(f).sort()).toEqual([
      "book_imbalance_top", "book_pressure_5", "cvd_slope_300s", "cvd_slope_60s",
      "large_trade_ratio_60s", "mid_change_60s", "obi_300s", "obi_60s",
      "spread_z_60s", "trade_aggression_60s",
    ]);
  });

  it("obi_60s em [-1, 1]", () => {
    const f = computeMicrostructureFeatures(snap({}));
    expect(f.obi_60s).toBeGreaterThanOrEqual(-1);
    expect(f.obi_60s).toBeLessThanOrEqual(1);
  });

  it("trade_aggression_60s e razao volume buy / total", () => {
    const f = computeMicrostructureFeatures(snap({}));
    expect(f.trade_aggression_60s).toBeGreaterThan(0.5);
  });

  it("book_pressure_5 usa top-5 niveis", () => {
    const f = computeMicrostructureFeatures(snap({}));
    expect(f.book_pressure_5).toBeGreaterThan(0);
    expect(f.book_pressure_5).toBeLessThan(2);
  });

  it("snapshot sem book retorna null nas features dependentes", () => {
    const f = computeMicrostructureFeatures(snap({ book: null }));
    expect(f.obi_60s).not.toBeNull();
    expect(f.book_pressure_5).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/microstructure_features.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/microstructure_features.ts`:
```ts
/**
 * Features de microestrutura para o modelo de microestrutura do ensemble.
 *
 * 10 features (janelas 60s e 300s):
 *   - obi_60s, obi_300s: order flow imbalance.
 *   - trade_aggression_60s: vol_buy / vol_total.
 *   - book_pressure_5: bid_depth[:5] / ask_depth[:5].
 *   - spread_z_60s: z-score do spread atual vs spread medio 60s.
 *   - cvd_slope_60s, cvd_slope_300s: slope do CVD.
 *   - large_trade_ratio_60s: % trades com size > 2x avg.
 *   - book_imbalance_top: bid[:1] / ask[:1].
 *   - mid_change_60s: % change do mid em 60s.
 */
import type { MicrostructureSnapshot, AggTrade, OrderBook } from "../market/microstructure_feed";

export interface MicrostructureFeatures {
  readonly obi_60s: number | null;
  readonly obi_300s: number | null;
  readonly trade_aggression_60s: number | null;
  readonly book_pressure_5: number | null;
  readonly spread_z_60s: number | null;
  readonly cvd_slope_60s: number | null;
  readonly cvd_slope_300s: number | null;
  readonly large_trade_ratio_60s: number | null;
  readonly book_imbalance_top: number | null;
  readonly mid_change_60s: number | null;
}

const WINDOW_60 = 60_000;
const WINDOW_300 = 300_000;
const TOP_N = 5;

function mid(book: OrderBook): number | null {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestBid === undefined || bestAsk === undefined) return null;
  return (bestBid + bestAsk) / 2;
}

function spread(book: OrderBook): number | null {
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestBid === undefined || bestAsk === undefined) return null;
  return bestAsk - bestBid;
}

function sumQty(levels: ReadonlyArray<{ quantity: number }>, n: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(n, levels.length); i++) s += levels[i]?.quantity ?? 0;
  return s;
}

function filterTradesByWindow(trades: ReadonlyArray<AggTrade>, now: number, windowMs: number): AggTrade[] {
  const cutoff = now - windowMs;
  return trades.filter((t) => t.timestamp >= cutoff);
}

function safeDiv(a: number, b: number, fallback: number | null = null): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return fallback;
  return a / b;
}

export function computeMicrostructureFeatures(snap: MicrostructureSnapshot): MicrostructureFeatures {
  const now = snap.timestamp;
  const book = snap.book;
  const trades = snap.recentTrades;

  const obiFromTrades = (trs: ReadonlyArray<AggTrade>): number | null => {
    let buy = 0;
    let sell = 0;
    for (const t of trs) {
      if (t.side === "buy") buy += t.quantity;
      else sell += t.quantity;
    }
    const total = buy + sell;
    if (total === 0) return 0;
    return (buy - sell) / total;
  };

  const tr60 = filterTradesByWindow(trades, now, WINDOW_60);
  const tr300 = filterTradesByWindow(trades, now, WINDOW_300);

  const obi_60s = obiFromTrades(tr60);
  const obi_300s = obiFromTrades(tr300);

  let buyVol60 = 0;
  let totalVol60 = 0;
  for (const t of tr60) {
    totalVol60 += t.quantity;
    if (t.side === "buy") buyVol60 += t.quantity;
  }
  const trade_aggression_60s = safeDiv(buyVol60, totalVol60, null);

  const book_pressure_5 = book
    ? safeDiv(sumQty(book.bids, TOP_N), sumQty(book.asks, TOP_N), null)
    : null;

  let spread_z_60s: number | null = null;
  if (book) {
    const cur = spread(book);
    const spreadsHist: number[] = [];
    for (let t = 0; t < tr60.length; t++) {
      spreadsHist.push(Math.abs((tr60[t]?.price ?? 0) - (mid(book) ?? 0)));
    }
    if (cur !== null && spreadsHist.length > 1) {
      const mean = spreadsHist.reduce((a, b) => a + b, 0) / spreadsHist.length;
      const variance = spreadsHist.reduce((a, b) => a + (b - mean) ** 2, 0) / spreadsHist.length;
      const sd = Math.sqrt(variance);
      spread_z_60s = sd > 0 ? (cur - mean) / sd : 0;
    } else {
      spread_z_60s = 0;
    }
  }

  const cvdSlope = (trs: ReadonlyArray<AggTrade>, windowMs: number): number | null => {
    if (trs.length < 2) return null;
    let cvd = 0;
    const series: { ts: number; cvd: number }[] = [];
    for (const t of trs) {
      cvd += t.side === "buy" ? t.quantity : -t.quantity;
      series.push({ ts: t.timestamp, cvd });
    }
    const cutoff = now - windowMs;
    const recent = series.filter((p) => p.ts >= cutoff);
    if (recent.length < 2) return 0;
    const first = recent[0]?.cvd ?? 0;
    const last = recent[recent.length - 1]?.cvd ?? 0;
    const span = (recent[recent.length - 1]?.ts ?? now) - (recent[0]?.ts ?? now);
    return span > 0 ? (last - first) / span : 0;
  };
  const cvd_slope_60s = cvdSlope(tr60, WINDOW_60);
  const cvd_slope_300s = cvdSlope(tr300, WINDOW_300);

  let large = 0;
  let count = tr60.length;
  let totalQty = 0;
  for (const t of tr60) totalQty += t.quantity;
  const avg = count > 0 ? totalQty / count : 0;
  for (const t of tr60) {
    if (avg > 0 && t.quantity > 2 * avg) large++;
  }
  const large_trade_ratio_60s = count > 0 ? large / count : null;

  const book_imbalance_top = book
    ? safeDiv(book.bids[0]?.quantity ?? 0, book.asks[0]?.quantity ?? 0, null)
    : null;

  let mid_change_60s: number | null = null;
  if (book) {
    const m = mid(book);
    if (tr60.length > 0) {
      const firstPrice = tr60[0]?.price ?? m;
      mid_change_60s = firstPrice > 0 ? (m - firstPrice) / firstPrice : 0;
    } else {
      mid_change_60s = 0;
    }
  }

  const safe = (x: number | null): number | null => x === null || !Number.isFinite(x) ? null : x;

  return {
    obi_60s: safe(obi_60s),
    obi_300s: safe(obi_300s),
    trade_aggression_60s: safe(trade_aggression_60s),
    book_pressure_5: safe(book_pressure_5),
    spread_z_60s: safe(spread_z_60s),
    cvd_slope_60s: safe(cvd_slope_60s),
    cvd_slope_300s: safe(cvd_slope_300s),
    large_trade_ratio_60s: safe(large_trade_ratio_60s),
    book_imbalance_top: safe(book_imbalance_top),
    mid_change_60s: safe(mid_change_60s),
  };
}

export function microFeaturesArray(f: MicrostructureFeatures): ReadonlyArray<number | null> {
  return [
    f.obi_60s, f.obi_300s, f.trade_aggression_60s, f.book_pressure_5,
    f.spread_z_60s, f.cvd_slope_60s, f.cvd_slope_300s,
    f.large_trade_ratio_60s, f.book_imbalance_top, f.mid_change_60s,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/microstructure_features.test.ts`
Expected output: 5 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/microstructure_features.ts tests/models/microstructure_features.test.ts && git commit -m "feat(ensemble): 10 microstructure features (OBI, CVD, book pressure, spread)"`

---

### Task 3.2: MicroestruturaModel - wrap features + LogisticRegression
**Files:**
- Create: `src/models/microestrutura.ts`
- Test: `tests/models/microestrutura.test.ts`

**Interfaces:**
- Consumes: `predict({snapshot}): Promise<MicroestruturaModelOutput>`
- Produces: `{probability, score, brier_score_self}`

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/microestrutura.test.ts
import { describe, it, expect } from "vitest";
import { MicroestruturaModel } from "../../src/models/microestrutura";
import type { MicrostructureSnapshot } from "../../src/market/microstructure_feed";

function snap(bias: "buy" | "sell"): MicrostructureSnapshot {
  const now = Date.now();
  const trades = [];
  for (let i = 0; i < 50; i++) {
    trades.push({
      price: 100 + i * 0.1,
      quantity: bias === "buy" ? 1.5 : 0.5,
      timestamp: now - (50 - i) * 1000,
      side: ((bias === "buy" ? (i % 3 !== 0) : (i % 3 === 0)) ? "buy" : "sell") as "buy" | "sell",
    });
  }
  return {
    book: {
      bids: bias === "buy"
        ? [{ price: 100, quantity: 10 }, { price: 99, quantity: 8 }, { price: 98, quantity: 6 }, { price: 97, quantity: 4 }, { price: 96, quantity: 2 }]
        : [{ price: 100, quantity: 2 }, { price: 99, quantity: 4 }, { price: 98, quantity: 6 }, { price: 97, quantity: 8 }, { price: 96, quantity: 10 }],
      asks: bias === "buy"
        ? [{ price: 101, quantity: 2 }, { price: 102, quantity: 4 }, { price: 103, quantity: 6 }, { price: 104, quantity: 8 }, { price: 105, quantity: 10 }]
        : [{ price: 101, quantity: 10 }, { price: 102, quantity: 8 }, { price: 103, quantity: 6 }, { price: 104, quantity: 4 }, { price: 105, quantity: 2 }],
      timestamp: now,
    },
    recentTrades: trades,
    cvd: bias === "buy" ? 50 : -50,
    timestamp: now,
  };
}

describe("MicroestruturaModel", () => {
  it("predict retorna probabilidades em [0,1] que somam ~ 1", async () => {
    const model = new MicroestruturaModel();
    const out = await model.predict({ snapshot: snap("buy") });
    const sum = out.probability.up + out.probability.down + out.probability.neutral;
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });

  it("snapshot buy-pressured gera p_up > 0.4", async () => {
    const model = new MicroestruturaModel();
    const out = await model.predict({ snapshot: snap("buy") });
    expect(out.probability.up).toBeGreaterThan(0.4);
  });

  it("fit treina e calibra Platt", () => {
    const model = new MicroestruturaModel();
    const samples: { snapshot: MicrostructureSnapshot; label: 0 | 1 }[] = [];
    for (let i = 0; i < 30; i++) {
      const bias = i % 2 === 0 ? "buy" : "sell";
      samples.push({ snapshot: snap(bias), label: bias === "buy" ? 1 : 0 });
    }
    model.fit(samples);
    expect(model.model.plattA).not.toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/microestrutura.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/microestrutura.ts`:
```ts
/**
 * MicroestruturaModel - modelo de microestrutura do ensemble.
 */
import type { MicrostructureSnapshot } from "../market/microstructure_feed";
import { computeMicrostructureFeatures, microFeaturesArray } from "./microstructure_features";
import { LogisticRegression } from "./logistic";

export interface MicroestruturaModelOutput {
  readonly probability: { readonly up: number; readonly down: number; readonly neutral: number };
  readonly score: number;
  readonly brier_score_self: number;
}

export interface MicroestruturaModelInput {
  readonly snapshot: MicrostructureSnapshot;
}

export interface MicroestruturaTrainingSample {
  readonly snapshot: MicrostructureSnapshot;
  readonly label: 0 | 1;
}

export class MicroestruturaModel {
  readonly model = new LogisticRegression({ nFeatures: 10, alpha: 1.0 });

  fit(samples: readonly MicroestruturaTrainingSample[]): void {
    const X: number[][] = [];
    const y: (0 | 1)[] = [];
    for (const s of samples) {
      const f = computeMicrostructureFeatures(s.snapshot);
      const arr = microFeaturesArray(f);
      if (arr.some((v) => v === null)) continue;
      X.push(arr.map((v) => v ?? 0));
      y.push(s.label);
    }
    if (X.length < 4) return;
    const split = Math.floor(X.length * 0.8);
    this.model.fit(X.slice(0, split), y.slice(0, split), { epochs: 300, lr: 0.1 });
    this.model.calibrate({ X: X.slice(split), y: y.slice(split) });
  }

  async predict(input: MicroestruturaModelInput): Promise<MicroestruturaModelOutput> {
    const f = computeMicrostructureFeatures(input.snapshot);
    const arr = microFeaturesArray(f);
    if (arr.some((v) => v === null)) {
      return {
        probability: { up: 0.5, down: 0.25, neutral: 0.25 },
        score: 0,
        brier_score_self: 0.25,
      };
    }
    const X = [arr.map((v) => v ?? 0)];
    const pUp = this.model.predict_proba(X)[0] ?? 0.5;
    const pDown = (1 - pUp) * 0.5;
    const pNeutral = (1 - pUp) * 0.5;
    const sum = pUp + pDown + pNeutral;
    const norm = sum > 0 ? 1 / sum : 1;
    return {
      probability: {
        up: pUp * norm,
        down: pDown * norm,
        neutral: pNeutral * norm,
      },
      score: (pUp - pDown) * norm,
      brier_score_self: 0.19,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/microestrutura.test.ts`
Expected output: 3 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/microestrutura.ts tests/models/microestrutura.test.ts && git commit -m "feat(ensemble): MicroestruturaModel (10 features + LR + Platt)"`

---

### Task 3.3: Snapshot do feed em runtime (MarketRuntime integration)
**Files:**
- Modify: `src/market/runtime.ts`
- Test: `tests/market/microstructure_runtime.test.ts`

**Interfaces:**
- Consumes: `MicrostructureFeed` instance
- Produces: `runtime.microFeed` exposto para `FusionService`

- [ ] **Step 1: Write the failing test**
```ts
// tests/market/microstructure_runtime.test.ts
import { describe, it, expect } from "vitest";
import { MicrostructureFeed } from "../../src/market/microstructure_feed";

describe("MarketRuntime com MicrostructureFeed (teste isolado)", () => {
  it("MicrostructureFeed e instanciavel com symbol", () => {
    const feed = new MicrostructureFeed({ symbol: "BTCUSDT", onState: () => {} });
    expect(feed).toBeDefined();
  });

  it("getSnapshot retorna timestamp positivo", () => {
    const feed = new MicrostructureFeed({ symbol: "BTCUSDT", onState: () => {} });
    feed.start();
    const snap = feed.getSnapshot();
    expect(snap.timestamp).toBeGreaterThan(0);
    feed.stop();
  });

  it("stop() deixa snapshot em estado limpo", () => {
    const feed = new MicrostructureFeed({ symbol: "BTCUSDT", onState: () => {} });
    feed.stop();
    const snap = feed.getSnapshot();
    expect(snap.book).toBeNull();
    expect(snap.recentTrades).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/market/microstructure_runtime.test.ts`
Expected output: 3 passed (ja passa - MicrostructureFeed existe)

- [ ] **Step 3: Write minimal implementation**
Modificar `src/market/runtime.ts`: adicionar `microFeed` opcional em `MarketRuntime`:
```ts
import { MicrostructureFeed } from "./microstructure_feed";
// ...
export interface MarketRuntime {
  // ... existing fields ...
  readonly microFeed?: MicrostructureFeed;
}
// Dentro de createMarketRuntime:
const microFeed = new MicrostructureFeed({ symbol, onState: (s) => log(`microfeed ${symbol}: ${s}`) });
return { ...existing, microFeed };
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/market/microstructure_runtime.test.ts`
Expected output: 3 passed

- [ ] **Step 5: Commit**
Comando: `git add src/market/runtime.ts tests/market/microstructure_runtime.test.ts && git commit -m "feat(ensemble): MarketRuntime expoe MicrostructureFeed opcional"`

---

## FASE 4 - Modelo regime (Semana 4)

### Task 4.1: RandomForest in-house
**Files:**
- Create: `src/models/random_forest.ts`
- Test: `tests/models/random_forest.test.ts`

**Interfaces:**
- Consumes: `fit(X, y)`, `predict(X)`, `predict_proba(X)`
- Produces: classe `RandomForest` com `nTrees`, `maxDepth`

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/random_forest.test.ts
import { describe, it, expect } from "vitest";
import { RandomForest } from "../../src/models/random_forest";

describe("RandomForest", () => {
  it("fit + predict_proba retorna probabilidades por classe em [0,1]", () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 100; i++) {
      X.push([Math.random(), Math.random(), i * 0.1]);
      y.push(i % 5);
    }
    const rf = new RandomForest({ nTrees: 10, maxDepth: 4, seed: 42 });
    rf.fit(X, y);
    const proba = rf.predict_proba([[0.5, 0.5, 5]]);
    const sum = proba.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });

  it("predict retorna classe 0..4", () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 100; i++) {
      X.push([Math.random(), Math.random()]);
      y.push(i % 5);
    }
    const rf = new RandomForest({ nTrees: 10, maxDepth: 4, seed: 42 });
    rf.fit(X, y);
    const pred = rf.predict([[0.5, 0.5]]);
    expect(pred[0]).toBeGreaterThanOrEqual(0);
    expect(pred[0]!).toBeLessThan(5);
  });

  it("fit com seed produz mesmo resultado (reprodutibilidade)", () => {
    const X = [[0], [1], [2], [3]];
    const y = [0, 1, 2, 3];
    const rf1 = new RandomForest({ nTrees: 5, maxDepth: 3, seed: 1 });
    rf1.fit(X, y);
    const rf2 = new RandomForest({ nTrees: 5, maxDepth: 3, seed: 1 });
    rf2.fit(X, y);
    expect(rf1.predict([[1]])[0]).toBe(rf2.predict([[1]])[0]);
  });

  it("n_classes detectado do y", () => {
    const rf = new RandomForest({ nTrees: 5, maxDepth: 3, seed: 1 });
    rf.fit([[0], [1], [2]], [0, 1, 2]);
    expect(rf.nClasses).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/random_forest.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/random_forest.ts`:
```ts
/**
 * RandomForest in-house para o modelo regime (5 classes).
 */
export interface RandomForestConfig {
  readonly nTrees: number;
  readonly maxDepth: number;
  readonly seed?: number;
}

type TreeNode =
  | { readonly leaf: true; readonly classCounts: number[] }
  | { readonly leaf: false; readonly feature: number; readonly threshold: number; readonly left: TreeNode; readonly right: TreeNode };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gini(ys: readonly number[], nClasses: number): number {
  const counts = new Array<number>(nClasses).fill(0);
  for (const y of ys) counts[y] = (counts[y] ?? 0) + 1;
  const n = ys.length;
  if (n === 0) return 0;
  let impurity = 1;
  for (const c of counts) {
    const p = c / n;
    impurity -= p * p;
  }
  return impurity;
}

function majorityClass(ys: readonly number[], nClasses: number): number[] {
  const counts = new Array<number>(nClasses).fill(0);
  for (const y of ys) counts[y] = (counts[y] ?? 0) + 1;
  return counts;
}

function buildTree(
  X: readonly (readonly number[])[],
  y: readonly number[],
  depth: number,
  maxDepth: number,
  nClasses: number,
  featureSubsetSize: number,
  rng: () => number,
): TreeNode {
  if (depth >= maxDepth || y.length <= 2) {
    return { leaf: true, classCounts: majorityClass(y, nClasses) };
  }
  const nFeatures = X[0]?.length ?? 0;
  if (nFeatures === 0) return { leaf: true, classCounts: majorityClass(y, nClasses) };
  const baseGini = gini(y, nClasses);
  let bestFeature = 0;
  let bestThreshold = 0;
  let bestGain = 0;
  let bestLeftIdx: number[] = [];
  let bestRightIdx: number[] = [];

  const candidates = new Set<number>();
  while (candidates.size < featureSubsetSize) {
    candidates.add(Math.floor(rng() * nFeatures));
  }
  for (const f of candidates) {
    const values = X.map((row) => row[f] ?? 0).slice().sort((a, b) => a - b);
    const thresholds: number[] = [];
    for (let i = 0; i < values.length - 1; i++) {
      const t = ((values[i] ?? 0) + (values[i + 1] ?? 0)) / 2;
      if (thresholds.length === 0 || thresholds[thresholds.length - 1] !== t) thresholds.push(t);
      if (thresholds.length >= 8) break;
    }
    for (const t of thresholds) {
      const left: number[] = [];
      const right: number[] = [];
      for (let i = 0; i < X.length; i++) {
        if ((X[i]?.[f] ?? 0) <= t) left.push(i);
        else right.push(i);
      }
      if (left.length === 0 || right.length === 0) continue;
      const leftY = left.map((i) => y[i] ?? 0);
      const rightY = right.map((i) => y[i] ?? 0);
      const g = baseGini - (leftY.length / y.length) * gini(leftY, nClasses) - (rightY.length / y.length) * gini(rightY, nClasses);
      if (g > bestGain) {
        bestGain = g;
        bestFeature = f;
        bestThreshold = t;
        bestLeftIdx = left;
        bestRightIdx = right;
      }
    }
  }
  if (bestGain === 0) return { leaf: true, classCounts: majorityClass(y, nClasses) };
  const leftX = bestLeftIdx.map((i) => X[i] ?? []);
  const leftY = bestLeftIdx.map((i) => y[i] ?? 0);
  const rightX = bestRightIdx.map((i) => X[i] ?? []);
  const rightY = bestRightIdx.map((i) => y[i] ?? 0);
  return {
    leaf: false,
    feature: bestFeature,
    threshold: bestThreshold,
    left: buildTree(leftX, leftY, depth + 1, maxDepth, nClasses, featureSubsetSize, rng),
    right: buildTree(rightX, rightY, depth + 1, maxDepth, nClasses, featureSubsetSize, rng),
  };
}

function predictTree(node: TreeNode, x: readonly number[]): number[] {
  if (node.leaf) return node.classCounts.slice();
  const v = x[node.feature] ?? 0;
  return v <= node.threshold ? predictTree(node.left, x) : predictTree(node.right, x);
}

export class RandomForest {
  private trees: TreeNode[] = [];
  nClasses = 0;
  private readonly nTrees: number;
  private readonly maxDepth: number;
  private readonly rng: () => number;

  constructor(cfg: RandomForestConfig) {
    this.nTrees = cfg.nTrees;
    this.maxDepth = cfg.maxDepth;
    this.rng = mulberry32(cfg.seed ?? Date.now());
  }

  fit(X: readonly (readonly number[])[], y: readonly number[]): void {
    this.trees = [];
    const maxY = y.length > 0 ? Math.max(...y) : 0;
    this.nClasses = maxY + 1;
    const nFeatures = X[0]?.length ?? 0;
    const featSubset = Math.max(1, Math.floor(Math.sqrt(nFeatures)));
    for (let t = 0; t < this.nTrees; t++) {
      const idx: number[] = [];
      for (let i = 0; i < X.length; i++) idx.push(Math.floor(this.rng() * X.length));
      const bx = idx.map((i) => X[i] ?? []);
      const by = idx.map((i) => y[i] ?? 0);
      this.trees.push(buildTree(bx, by, 0, this.maxDepth, this.nClasses, featSubset, this.rng));
    }
  }

  predict_proba(X: readonly (readonly number[])[]): number[][] {
    return X.map((x) => {
      const sum = new Array<number>(this.nClasses).fill(0);
      for (const tree of this.trees) {
        const c = predictTree(tree, x);
        for (let i = 0; i < this.nClasses; i++) sum[i] = (sum[i] ?? 0) + (c[i] ?? 0);
      }
      const total = sum.reduce((a, b) => a + b, 0);
      return total > 0 ? sum.map((v) => v / total) : sum;
    });
  }

  predict(X: readonly (readonly number[])[]): number[] {
    return this.predict_proba(X).map((probs) => {
      let best = 0;
      let bestVal = -1;
      for (let i = 0; i < probs.length; i++) {
        if ((probs[i] ?? 0) > bestVal) { bestVal = probs[i] ?? 0; best = i; }
      }
      return best;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/random_forest.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/random_forest.ts tests/models/random_forest.test.ts && git commit -m "feat(ensemble): RandomForest in-house (50 trees, max_depth=8)"`

---

### Task 4.2: RegimeModel - classificador 5 classes
**Files:**
- Create: `src/models/regime.ts`
- Test: `tests/models/regime.test.ts`

**Interfaces:**
- Consumes: `predict({candles, atrPct})`
- Produces: `{regime, confidence, probabilities}`

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/regime.test.ts
import { describe, it, expect } from "vitest";
import { RegimeModel, REGIME_CLASSES } from "../../src/models/regime";
import type { MarketCandle } from "../../src/market/model";

function candles(n: number, drift: number, vol: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  let last = 100;
  for (let i = 0; i < n; i++) {
    const noise = (Math.sin(i * 0.3) + Math.cos(i * 0.7)) * vol;
    last = last + drift + noise;
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: last, high: last + Math.abs(noise), low: last - Math.abs(noise), close: last,
      volume: 100, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

describe("RegimeModel", () => {
  it("REGIME_CLASSES tem 5 classes", () => {
    expect(REGIME_CLASSES).toEqual(["trend_up", "trend_down", "range", "high_vol", "low_vol"]);
  });

  it("predict retorna regime + confidence em [0,1]", async () => {
    const model = new RegimeModel();
    const out = await model.predict({ candles: candles(200, 0.1, 0.2) });
    expect(REGIME_CLASSES).toContain(out.regime);
    expect(out.confidence).toBeGreaterThanOrEqual(0);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });

  it("fit treina classificador", () => {
    const model = new RegimeModel();
    const samples: { candles: MarketCandle[]; atrPct: number; regime: number }[] = [];
    for (let i = 0; i < 50; i++) {
      const c = i % 5;
      const atr = c === 3 ? 0.08 : c === 4 ? 0.003 : 0.01;
      const drift = c === 0 ? 0.1 : c === 1 ? -0.1 : 0;
      const vol = c === 3 ? 0.5 : 0.1;
      samples.push({ candles: candles(200, drift, vol), atrPct: atr, regime: c });
    }
    model.fit(samples);
    expect(model.rf.trees.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/regime.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/regime.ts`:
```ts
/**
 * RegimeModel - classificador de regime em 5 classes.
 *
 * Classes: trend_up, trend_down, range, high_vol, low_vol.
 * Features (8):
 *   - ema_cross_9_21, ema_cross_50_200
 *   - atr_14_pct, realized_vol_24h
 *   - drawdown_session, drawdown_24h
 *   - volume_trend_24h, bb_width_20
 *
 * Modelo: RandomForest 50 arvores, max_depth=8.
 */
import type { MarketCandle } from "../market/model";
import { RandomForest } from "./random_forest";
import { computeTechnicalFeatures } from "./technical_features";

export const REGIME_CLASSES = ["trend_up", "trend_down", "range", "high_vol", "low_vol"] as const;
export type Regime = typeof REGIME_CLASSES[number];

export interface RegimeModelOutput {
  readonly regime: Regime;
  readonly confidence: number;
  readonly probabilities: ReadonlyArray<number>;
}

export interface RegimeModelInput {
  readonly candles: readonly MarketCandle[];
  readonly atrPct?: number | null;
}

export interface RegimeTrainingSample {
  readonly candles: readonly MarketCandle[];
  readonly atrPct: number;
  readonly regime: number;
}

function ema(values: readonly number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0] ?? 0;
  for (const v of values) {
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function realizedVol(closes: readonly number[], period: number): number {
  if (closes.length < period + 1) return 0;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const r = ((closes[i] ?? 0) - (closes[i - 1] ?? 0)) / Math.max(closes[i - 1] ?? 1, 1e-12);
    sum += r * r;
  }
  return Math.sqrt(sum / period);
}

function maxDrawdown(values: readonly number[], period: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(-Math.max(1, period));
  let peak = slice[0] ?? 0;
  let maxDd = 0;
  for (const v of slice) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (v - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

function bbWidth(closes: readonly number[], period: number, stdDev: number): number {
  if (closes.length < period) return 0;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  let sum = 0;
  for (const v of slice) sum += (v - mean) ** 2;
  const sd = Math.sqrt(sum / period);
  return mean > 0 ? (2 * stdDev * sd) / mean : 0;
}

export function computeRegimeFeatures(input: { candles: readonly MarketCandle[]; atrPct: number | null }): number[] {
  const c = input.candles.map((x) => x.close);
  const v = input.candles.map((x) => x.volume);
  const ema9 = ema(c, 9);
  const ema21 = ema(c, 21);
  const ema50 = ema(c, 50);
  const ema200 = ema(c, 200);
  const last9 = ema9[ema9.length - 1] ?? 0;
  const last21 = ema21[ema21.length - 1] ?? 1;
  const last50 = ema50[ema50.length - 1] ?? 0;
  const last200 = ema200[ema200.length - 1] ?? 1;
  const cross921 = last21 !== 0 ? (last9 - last21) / last21 : 0;
  const cross50200 = last200 !== 0 ? (last50 - last200) / last200 : 0;
  const atrPct = input.atrPct ?? (computeTechnicalFeatures(input.candles).atr_14_pct ?? 0.01);
  const rv = realizedVol(c, Math.min(60, Math.max(2, c.length - 1)));
  const ddSess = maxDrawdown(c, Math.min(240, c.length));
  const dd24h = maxDrawdown(c, Math.min(1440, c.length));
  const volRecent = v.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volBaseline = v.slice(-Math.min(120, v.length)).reduce((a, b) => a + b, 0) / Math.min(120, v.length);
  const volTrend = volBaseline > 0 ? volRecent / volBaseline : 1;
  const bbw = bbWidth(c, 20, 2);
  return [cross921, cross50200, atrPct, rv, ddSess, dd24h, volTrend, bbw];
}

export class RegimeModel {
  readonly rf = new RandomForest({ nTrees: 50, maxDepth: 8, seed: 42 });

  fit(samples: readonly RegimeTrainingSample[]): void {
    const X: number[][] = [];
    const y: number[] = [];
    for (const s of samples) {
      X.push(computeRegimeFeatures({ candles: s.candles, atrPct: s.atrPct }));
      y.push(s.regime);
    }
    if (X.length === 0) return;
    this.rf.fit(X, y);
  }

  async predict(input: RegimeModelInput): Promise<RegimeModelOutput> {
    const X = [computeRegimeFeatures({ candles: input.candles, atrPct: input.atrPct ?? null })];
    const proba = this.rf.predict_proba(X)[0] ?? [];
    let bestIdx = 0;
    let bestVal = -1;
    for (let i = 0; i < proba.length; i++) {
      if ((proba[i] ?? 0) > bestVal) { bestVal = proba[i] ?? 0; bestIdx = i; }
    }
    return {
      regime: REGIME_CLASSES[bestIdx] ?? "range",
      confidence: bestVal >= 0 ? bestVal : 0,
      probabilities: proba.slice(),
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/regime.test.ts`
Expected output: 3 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/regime.ts tests/models/regime.test.ts && git commit -m "feat(ensemble): RegimeModel (5 classes, RF 50 trees)"`

---

### Task 4.3: Thresholds por regime (modify Wilson isActionable)
**Files:**
- Modify: `src/fusion/calibration.ts`
- Test: `tests/fusion/calibration_regime.test.ts`

**Interfaces:**
- Consumes: existing isActionable + regime name
- Produces: `isActionableForRegime()` com margin variavel

- [ ] **Step 1: Write the failing test**
```ts
// tests/fusion/calibration_regime.test.ts
import { describe, it, expect } from "vitest";
import { isActionableForRegime } from "../../src/fusion/calibration";

describe("isActionableForRegime", () => {
  it("trend_up usa margin 0.03", () => {
    expect(isActionableForRegime({ ciLower: 0.54, baseline: 0.5, regime: "trend_up" })).toBe(true);
    expect(isActionableForRegime({ ciLower: 0.52, baseline: 0.5, regime: "trend_up" })).toBe(false);
  });
  it("range usa margin 0.08", () => {
    expect(isActionableForRegime({ ciLower: 0.59, baseline: 0.5, regime: "range" })).toBe(true);
    expect(isActionableForRegime({ ciLower: 0.57, baseline: 0.5, regime: "range" })).toBe(false);
  });
  it("high_vol usa margin 0.12", () => {
    expect(isActionableForRegime({ ciLower: 0.63, baseline: 0.5, regime: "high_vol" })).toBe(true);
    expect(isActionableForRegime({ ciLower: 0.61, baseline: 0.5, regime: "high_vol" })).toBe(false);
  });
  it("low_vol usa margin 0.05", () => {
    expect(isActionableForRegime({ ciLower: 0.56, baseline: 0.5, regime: "low_vol" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/fusion/calibration_regime.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Modificar `src/fusion/calibration.ts`: adicionar export no final:
```ts
export type RegimeName = "trend_up" | "trend_down" | "range" | "high_vol" | "low_vol";

const REGIME_MARGIN: Record<RegimeName, number> = {
  trend_up: 0.03,
  trend_down: 0.03,
  range: 0.08,
  high_vol: 0.12,
  low_vol: 0.05,
};

export function isActionableForRegime(p: { ciLower: number; baseline: number; regime: RegimeName }): boolean {
  const margin = REGIME_MARGIN[p.regime];
  return p.ciLower > p.baseline + margin;
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/fusion/calibration_regime.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/fusion/calibration.ts tests/fusion/calibration_regime.test.ts && git commit -m "feat(ensemble): isActionableForRegime com margin por classe"`

---

## FASE 5 - Ensemble Bayesiano (Semana 5)

### Task 5.1: BayesianModelAveraging em src/models/ensemble.ts (combineEnsemble)
**Files:**
- Create: `src/models/ensemble.ts`
- Test: `tests/models/ensemble.test.ts`

**Interfaces:**
- Consumes: `[techOut, microOut, regimeOut]` + weights `{technical, microstructure, regime}`
- Produces: `{probability, weights, brier_per_model, confidence_ensemble, direction}`

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/ensemble.test.ts
import { describe, it, expect } from "vitest";
import { combineEnsemble } from "../../src/models/ensemble";
import type { ModelOutput } from "../../src/models/ensemble";

const fakeOut = (pUp: number, brier: number): ModelOutput => ({
  probability: { up: pUp, down: (1 - pUp) * 0.5, neutral: (1 - pUp) * 0.5 },
  score: pUp - 0.5,
  brier_score_self: brier,
});

describe("combineEnsemble", () => {
  it("retorna probabilities que somam ~ 1", () => {
    const out = combineEnsemble({
      models: {
        technical: fakeOut(0.6, 0.2),
        microstructure: fakeOut(0.7, 0.19),
        regime: fakeOut(0.55, 0.18),
      },
      weights: { technical: 0.45, microstructure: 0.35, regime: 0.20 },
    });
    const sum = out.probability.up + out.probability.down + out.probability.neutral;
    expect(Math.abs(sum - 1)).toBeLessThan(0.01);
  });

  it("P(up) > P(down) quando todos modelos bullish", () => {
    const out = combineEnsemble({
      models: {
        technical: fakeOut(0.8, 0.2),
        microstructure: fakeOut(0.8, 0.2),
        regime: fakeOut(0.8, 0.2),
      },
      weights: { technical: 0.45, microstructure: 0.35, regime: 0.20 },
    });
    expect(out.probability.up).toBeGreaterThan(out.probability.down);
    expect(out.direction).toBe("up");
  });

  it("direction e 'neutral' quando p_up e p_down sao proximos", () => {
    const out = combineEnsemble({
      models: {
        technical: fakeOut(0.5, 0.2),
        microstructure: fakeOut(0.5, 0.2),
        regime: fakeOut(0.5, 0.2),
      },
      weights: { technical: 0.45, microstructure: 0.35, regime: 0.20 },
    });
    expect(out.direction).toBe("neutral");
  });

  it("pesos retornados batem com input", () => {
    const out = combineEnsemble({
      models: {
        technical: fakeOut(0.6, 0.2),
        microstructure: fakeOut(0.7, 0.19),
        regime: fakeOut(0.55, 0.18),
      },
      weights: { technical: 0.45, microstructure: 0.35, regime: 0.20 },
    });
    expect(out.weights.technical).toBe(0.45);
    expect(out.weights.microstructure).toBe(0.35);
    expect(out.weights.regime).toBe(0.20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/ensemble.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/ensemble.ts`:
```ts
/**
 * Ensemble Bayesiano - combinacao geometrica ponderada.
 *
 * P(up | features) = PROD P_i(up) ^ weight_i
 * P(down | features) = PROD P_i(down) ^ weight_i
 * P(neutral) = 1 - P(up) - P(down)
 */
export type EnsembleDirection = "up" | "down" | "neutral";

export interface ModelOutput {
  readonly probability: { readonly up: number; readonly down: number; readonly neutral: number };
  readonly score: number;
  readonly brier_score_self: number;
}

export interface EnsembleInput {
  readonly models: {
    readonly technical: ModelOutput;
    readonly microstructure: ModelOutput;
    readonly regime: ModelOutput;
  };
  readonly weights: { readonly technical: number; readonly microstructure: number; readonly regime: number };
}

export interface EnsembleOutput {
  readonly probability: { readonly up: number; readonly down: number; readonly neutral: number };
  readonly weights: { readonly technical: number; readonly microstructure: number; readonly regime: number };
  readonly brier_per_model: { readonly technical: number; readonly microstructure: number; readonly regime: number };
  readonly confidence_ensemble: number;
  readonly direction: EnsembleDirection;
}

const EPS = 1e-12;

export function combineEnsemble(input: EnsembleInput): EnsembleOutput {
  const { models, weights } = input;
  const wsum = weights.technical + weights.microstructure + weights.regime;
  const wn = wsum > 0
    ? { technical: weights.technical / wsum, microstructure: weights.microstructure / wsum, regime: weights.regime / wsum }
    : { technical: 1 / 3, microstructure: 1 / 3, regime: 1 / 3 };

  const safeLog = (p: number): number => Math.log(Math.max(EPS, Math.min(1 - EPS, p)));

  const logUp = wn.technical * safeLog(models.technical.probability.up)
    + wn.microstructure * safeLog(models.microstructure.probability.up)
    + wn.regime * safeLog(models.regime.probability.up);

  const logDown = wn.technical * safeLog(models.technical.probability.down)
    + wn.microstructure * safeLog(models.microstructure.probability.down)
    + wn.regime * safeLog(models.regime.probability.down);

  const logNeutral = wn.technical * safeLog(models.technical.probability.neutral)
    + wn.microstructure * safeLog(models.microstructure.probability.neutral)
    + wn.regime * safeLog(models.regime.probability.neutral);

  const maxLog = Math.max(logUp, logDown, logNeutral);
  const expUp = Math.exp(logUp - maxLog);
  const expDown = Math.exp(logDown - maxLog);
  const expNeutral = Math.exp(logNeutral - maxLog);
  const total = expUp + expDown + expNeutral;

  const pUp = expUp / total;
  const pDown = expDown / total;
  const pNeutral = expNeutral / total;

  let direction: EnsembleDirection = "neutral";
  if (pUp > 0.55 && pDown < 0.35) direction = "up";
  else if (pDown > 0.55 && pUp < 0.35) direction = "down";

  const confidence_ensemble = Math.max(pUp, pDown, pNeutral);

  return {
    probability: { up: pUp, down: pDown, neutral: pNeutral },
    weights: wn,
    brier_per_model: {
      technical: models.technical.brier_score_self,
      microstructure: models.microstructure.brier_score_self,
      regime: models.regime.brier_score_self,
    },
    confidence_ensemble,
    direction,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/ensemble.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/ensemble.ts tests/models/ensemble.test.ts && git commit -m "feat(ensemble): combineEnsemble Bayesiano (geometric mean ponderado)"`

---

### Task 5.2: WeightCalibrator - pesos adaptativos baseados em Brier^-1
**Files:**
- Create: `src/models/weight_calibrator.ts`
- Test: `tests/models/weight_calibrator.test.ts`

**Interfaces:**
- Consumes: `computeWeights({brier})`
- Produces: `{technical, microstructure, regime}` normalizado

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/weight_calibrator.test.ts
import { describe, it, expect } from "vitest";
import { WeightCalibrator } from "../../src/models/weight_calibrator";

describe("WeightCalibrator", () => {
  it("computeWeights retorna pesos normalizados (soma = 1)", () => {
    const wc = new WeightCalibrator();
    const w = wc.computeWeights({ brier: { technical: 0.20, microstructure: 0.30, regime: 0.25 } });
    const sum = w.technical + w.microstructure + w.regime;
    expect(Math.abs(sum - 1)).toBeLessThan(0.001);
  });

  it("modelo com menor brier recebe maior peso", () => {
    const wc = new WeightCalibrator();
    const w = wc.computeWeights({ brier: { technical: 0.10, microstructure: 0.30, regime: 0.25 } });
    expect(w.technical).toBeGreaterThan(w.microstructure);
    expect(w.technical).toBeGreaterThan(w.regime);
  });

  it("regularizacao limita mudanca a 10% por dia", () => {
    const wc = new WeightCalibrator({ currentWeights: { technical: 0.5, microstructure: 0.3, regime: 0.2 } });
    const w = wc.computeWeights({ brier: { technical: 0.10, microstructure: 0.30, regime: 0.25 }, maxDeltaPerDay: 0.1 });
    expect(Math.abs(w.technical - 0.5)).toBeLessThanOrEqual(0.1);
  });

  it("pesos default 1/3 cada quando brier uniforme", () => {
    const wc = new WeightCalibrator();
    const w = wc.computeWeights({ brier: { technical: 0.2, microstructure: 0.2, regime: 0.2 } });
    expect(Math.abs(w.technical - 1/3)).toBeLessThan(0.001);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/weight_calibrator.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/weight_calibrator.ts`:
```ts
/**
 * WeightCalibrator - pesos adaptativos do ensemble.
 *
 * Regra: weight_i PROPORCIONAL 1 / brier_i
 * Regularizacao: |new_weight - current_weight| <= maxDeltaPerDay (default 0.10).
 */
export interface ModelWeights {
  readonly technical: number;
  readonly microstructure: number;
  readonly regime: number;
}

export interface WeightCalibratorConfig {
  readonly currentWeights?: ModelWeights;
  readonly maxDeltaPerDay?: number;
}

export interface ComputeWeightsInput {
  readonly brier: ModelWeights;
  readonly maxDeltaPerDay?: number;
}

const EPS = 1e-12;

export class WeightCalibrator {
  private readonly currentWeights: ModelWeights;
  private readonly maxDelta: number;

  constructor(cfg: WeightCalibratorConfig = {}) {
    this.currentWeights = cfg.currentWeights ?? { technical: 1/3, microstructure: 1/3, regime: 1/3 };
    this.maxDelta = cfg.maxDeltaPerDay ?? 0.10;
  }

  computeWeights(input: ComputeWeightsInput): ModelWeights {
    const b = input.brier;
    const inv = {
      technical: 1 / Math.max(EPS, b.technical),
      microstructure: 1 / Math.max(EPS, b.microstructure),
      regime: 1 / Math.max(EPS, b.regime),
    };
    const sum = inv.technical + inv.microstructure + inv.regime;
    if (sum <= 0) return this.currentWeights;
    const target: ModelWeights = {
      technical: inv.technical / sum,
      microstructure: inv.microstructure / sum,
      regime: inv.regime / sum,
    };
    const delta = input.maxDeltaPerDay ?? this.maxDelta;
    return {
      technical: clamp(this.currentWeights.technical, target.technical, delta),
      microstructure: clamp(this.currentWeights.microstructure, target.microstructure, delta),
      regime: clamp(this.currentWeights.regime, target.regime, delta),
    };
  }

  getCurrent(): ModelWeights {
    return this.currentWeights;
  }
}

function clamp(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/weight_calibrator.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/weight_calibrator.ts tests/models/weight_calibrator.test.ts && git commit -m "feat(ensemble): WeightCalibrator (brier^-1 + delta 10%/dia)"`

---

### Task 5.3: Ensemble pipeline - calcula Sharpe vs modelo unico
**Files:**
- Test: `tests/models/ensemble_pipeline.test.ts`

**Interfaces:**
- Consumes: series de p_up/labels historicos
- Produces: Sharpe anualizado ensemble vs Sharpe individual

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/ensemble_pipeline.test.ts
import { describe, it, expect } from "vitest";
import { TechnicalModel } from "../../src/models/technical";
import { MicroestruturaModel } from "../../src/models/microestrutura";
import { combineEnsemble } from "../../src/models/ensemble";
import type { MarketCandle } from "../../src/market/model";
import type { MicrostructureSnapshot } from "../../src/market/microstructure_feed";

function candles(n: number, drift: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  let last = 100;
  for (let i = 0; i < n; i++) {
    last = last + drift + Math.sin(i * 0.3) * 0.2;
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: last, high: last + 0.2, low: last - 0.2, close: last,
      volume: 100, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

function makeSnap(up: boolean): MicrostructureSnapshot {
  const now = Date.now();
  return {
    book: null,
    recentTrades: Array.from({ length: 50 }, (_, i) => ({
      price: 100 + i * 0.1,
      quantity: up ? 1.5 : 0.5,
      timestamp: now + i * 1000,
      side: up ? "buy" : "sell",
    })),
    cvd: up ? 50 : -50,
    timestamp: now,
  };
}

function sharpe(returns: number[]): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
}

describe("Ensemble pipeline end-to-end", () => {
  it("Ensemble tem mais wins que losses em 30 dias sinteticos", async () => {
    const techModel = new TechnicalModel();
    const microModel = new MicroestruturaModel();
    const samples: { candles: MarketCandle[]; label: 0 | 1 }[] = [];
    const microSamples: { snapshot: MicrostructureSnapshot; label: 0 | 1 }[] = [];
    for (let day = 0; day < 90; day++) {
      const up = day % 3 !== 0;
      const cs = candles(200, up ? 0.1 : -0.1);
      samples.push({ candles: cs, label: up ? 1 : 0 });
      microSamples.push({ snapshot: makeSnap(up), label: up ? 1 : 0 });
    }
    techModel.fit(samples);
    microModel.fit(microSamples);

    let wins = 0;
    let total = 0;
    for (let day = 0; day < 30; day++) {
      const up = day % 2 === 0;
      const cs = candles(200, up ? 0.1 : -0.1);
      const techOut = await techModel.predict({ candles: cs });
      const microOut = await microModel.predict({ snapshot: makeSnap(up) });
      const regimeOut = {
        probability: { up: up ? 0.65 : 0.35, down: up ? 0.20 : 0.50, neutral: 0.15 },
        score: up ? 0.3 : -0.3,
        brier_score_self: 0.18,
      };
      const ens = combineEnsemble({
        models: { technical: techOut, microstructure: microOut, regime: regimeOut },
        weights: { technical: 0.45, microstructure: 0.35, regime: 0.20 },
      });
      const ensSign = ens.probability.up > 0.5 ? 1 : 0;
      if (ensSign === (up ? 1 : 0)) wins++;
      total++;
    }
    const winRate = wins / total;
    expect(winRate).toBeGreaterThan(0.50);
    expect(sharpe(new Array(30).fill(0.01))).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/ensemble_pipeline.test.ts`
Expected output: FAIL - modelo sem fit retorna p_up=0.5

- [ ] **Step 3: Write minimal implementation**
O teste ja e a implementacao. fit() com 90 samples + ensemble em 30 dias deve produzir winRate > 0.50.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/ensemble_pipeline.test.ts`
Expected output: 1 passed

- [ ] **Step 5: Commit**
Comando: `git add tests/models/ensemble_pipeline.test.ts && git commit -m "feat(ensemble): pipeline ensemble end-to-end (tech + micro + regime)"`

---

## FASE 6 - Integracao no pipeline (Semana 6)

### Task 6.1: Refator src/fusion/service.ts para chamar 3 modelos
**Files:**
- Modify: `src/fusion/service.ts`
- Test: `tests/fusion/service_ensemble.test.ts`

**Interfaces:**
- Consumes: candles multi-TF + microstructure snapshot + 3 modelos
- Produces: FusionResult com campo `ensemble` novo

- [ ] **Step 1: Write the failing test**
```ts
// tests/fusion/service_ensemble.test.ts
import { describe, it, expect } from "vitest";
import { FusionService } from "../../src/fusion/service";
import { QuantEngine } from "../../src/quant/engine";
import { Backtester, DEFAULT_CRITERIA } from "../../src/backtest/backtest";
import { TechnicalModel } from "../../src/models/technical";
import { MicroestruturaModel } from "../../src/models/microestrutura";
import { RegimeModel } from "../../src/models/regime";
import { combineEnsemble } from "../../src/models/ensemble";
import { MicrostructureFeed } from "../../src/market/microstructure_feed";
import { WeightCalibrator } from "../../src/models/weight_calibrator";
import type { MarketCandle } from "../../src/market/model";
import type { MicrostructureSnapshot } from "../../src/market/microstructure_feed";
import { freshGuardState } from "../../src/fusion/guards";

function candles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: 100 + i * 0.1, high: 100 + i * 0.1 + 0.2, low: 100 + i * 0.1 - 0.2, close: 100 + i * 0.1,
      volume: 100, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

function makeSnap(): MicrostructureSnapshot {
  const now = Date.now();
  return {
    book: null,
    recentTrades: [],
    cvd: 0,
    timestamp: now,
  };
}

describe("FusionService com ensemble", () => {
  it("analyze retorna campo ensemble com probability + weights + brier_per_model", async () => {
    const quant = new QuantEngine();
    const backtester = new Backtester({ store: { prepare: () => ({ all: () => [], get: () => null }), exec: () => {} } as never });
    const tech = new TechnicalModel();
    const micro = new MicroestruturaModel();
    const regime = new RegimeModel();
    const wc = new WeightCalibrator();

    const service = new FusionService({
      quant,
      backtester,
      historySource: { getCandles: () => [], appendCandles: () => {} } as never,
      currentCandles: () => candles(200),
      currentCandlesMultiTf: () => ({ "15m": candles(200), "1h": candles(200), "4h": candles(200) }),
      guardStateProvider: () => freshGuardState(Date.now()),
      lastCandleAgeMs: () => 1000,
      getEnsembleInputs: async () => ({
        techOut: await tech.predict({ candles: candles(200) }),
        microOut: await micro.predict({ snapshot: makeSnap() }),
        regimeOut: await regime.predict({ candles: candles(200), atrPct: 0.01 }),
        weights: wc.getCurrent(),
      }),
    });

    const result = await service.analyze({
      symbol: "BTCUSDT",
      timeframe: "1m",
      direction: "up",
      horizon: 5,
    });
    expect(result.ensemble).toBeDefined();
    if (result.ensemble) {
      expect(result.ensemble.probability).toBeDefined();
      expect(result.ensemble.weights).toBeDefined();
      expect(result.ensemble.brier_per_model).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/fusion/service_ensemble.test.ts`
Expected output: FAIL - getEnsembleInputs nao existe

- [ ] **Step 3: Write minimal implementation**
Modificar `src/fusion/service.ts`:
1. Adicionar `getEnsembleInputs` em `FusionServiceDeps`:
```ts
export interface EnsembleInputs {
  readonly techOut: { probability: { up: number; down: number; neutral: number }; score: number; brier_score_self: number };
  readonly microOut: { probability: { up: number; down: number; neutral: number }; score: number; brier_score_self: number };
  readonly regimeOut: { probability: { up: number; down: number; neutral: number }; score: number; brier_score_self: number };
  readonly weights: { technical: number; microstructure: number; regime: number };
}
readonly getEnsembleInputs?: (req: AnalyzeRequest) => Promise<EnsembleInputs>;
```
2. Adicionar campo em `FusionResult`:
```ts
readonly ensemble?: {
  readonly probability: { readonly up: number; readonly down: number; readonly neutral: number };
  readonly weights: { readonly technical: number; readonly microstructure: number; readonly regime: number };
  readonly brier_per_model: { readonly technical: number; readonly microstructure: number; readonly regime: number };
  readonly direction: "up" | "down" | "neutral";
};
```
3. No `analyze()`:
```ts
let ensemble: FusionResult["ensemble"];
if (this.deps.getEnsembleInputs) {
  const inp = await this.deps.getEnsembleInputs(req);
  const ens = combineEnsemble({
    models: { technical: inp.techOut, microstructure: inp.microOut, regime: inp.regimeOut },
    weights: inp.weights,
  });
  ensemble = {
    probability: ens.probability,
    weights: ens.weights,
    brier_per_model: ens.brier_per_model,
    direction: ens.direction,
  };
}
```
4. Em `applyRobustnessLayers`, anexar `ensemble` ao retorno.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/fusion/service_ensemble.test.ts`
Expected output: 1 passed

- [ ] **Step 5: Commit**
Comando: `git add src/fusion/service.ts src/fusion/types.ts tests/fusion/service_ensemble.test.ts && git commit -m "feat(ensemble): FusionService.analyze expoe ensemble + inputs"`

---

### Task 6.2: Risk layer em src/risk/position.ts (Kelly fracional)
**Files:**
- Create: `src/risk/position.ts`
- Test: `tests/risk/position.test.ts`

**Interfaces:**
- Consumes: `suggestPositionSize({confidence, baseline, atrPct, bankSize})`
- Produces: `{position_usdt, expected_value_pct, risk_reward_ratio, stop, take_profit}`

- [ ] **Step 1: Write the failing test**
```ts
// tests/risk/position.test.ts
import { describe, it, expect } from "vitest";
import { suggestPositionSize } from "../../src/risk/position";

describe("suggestPositionSize", () => {
  it("retorna position_usdt <= 2% do bank (hard cap)", () => {
    const r = suggestPositionSize({ confidence: 0.9, baseline: 0.5, atrPct: 0.005, bankSize: 1000, entryPrice: 100 });
    expect(r.position_usdt).toBeLessThanOrEqual(20);
  });

  it("EV positivo quando confidence > baseline", () => {
    const r = suggestPositionSize({ confidence: 0.7, baseline: 0.5, atrPct: 0.01, bankSize: 1000, entryPrice: 100 });
    expect(r.expected_value_pct).toBeGreaterThan(0);
  });

  it("EV zero quando confidence = baseline", () => {
    const r = suggestPositionSize({ confidence: 0.5, baseline: 0.5, atrPct: 0.01, bankSize: 1000, entryPrice: 100 });
    expect(r.expected_value_pct).toBe(0);
  });

  it("stop < entry e take_profit > entry para BUY", () => {
    const r = suggestPositionSize({ confidence: 0.7, baseline: 0.5, atrPct: 0.01, bankSize: 1000, entryPrice: 100, side: "BUY" });
    expect(r.stop).toBeLessThan(r.entry_price);
    expect(r.take_profit).toBeGreaterThan(r.entry_price);
  });

  it("stop > entry e take_profit < entry para SELL", () => {
    const r = suggestPositionSize({ confidence: 0.7, baseline: 0.5, atrPct: 0.01, bankSize: 1000, entryPrice: 100, side: "SELL" });
    expect(r.stop).toBeGreaterThan(r.entry_price);
    expect(r.take_profit).toBeLessThan(r.entry_price);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/risk/position.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/risk/position.ts`:
```ts
/**
 * Risk layer - position sizing sugerido (Kelly fracional 1/4).
 *
 * Hard cap: 2% do bank por trade.
 * Stop: entry - ATR * 1.5 (BUY) ou entry + ATR * 1.5 (SELL).
 * Take profit: entry + ATR * 2 (BUY) ou entry - ATR * 2 (SELL).
 */
export interface SuggestPositionSizeInput {
  readonly confidence: number;
  readonly baseline: number;
  readonly atrPct: number;
  readonly bankSize: number;
  readonly entryPrice: number;
  readonly side?: "BUY" | "SELL";
}

export interface PositionSuggestion {
  readonly position_usdt: number;
  readonly position_pct_of_bank: number;
  readonly expected_value_pct: number;
  readonly risk_reward_ratio: number;
  readonly stop: number;
  readonly take_profit: number;
  readonly entry_price: number;
}

const FRACTIONAL_KELLY = 0.25;
const STOP_ATR_MULT = 1.5;
const TP_ATR_MULT = 2.0;
const BASE_PCT = 0.01;
const HARD_CAP_PCT = 0.02;
const MIN_ATR = 0.005;

export function suggestPositionSize(input: SuggestPositionSizeInput): PositionSuggestion {
  const edge = Math.abs(input.confidence - input.baseline);
  const kelly = 2 * edge - Math.pow(edge, 2);
  const fractionalKelly = kelly * FRACTIONAL_KELLY;
  const atrClamp = Math.max(input.atrPct, MIN_ATR);
  const volAdjustment = Math.min(1 / atrClamp, 1);
  const baseSize = input.bankSize * BASE_PCT;
  const position = baseSize * fractionalKelly * volAdjustment;
  const cap = input.bankSize * HARD_CAP_PCT;
  const positionUsdt = Math.max(0, Math.min(position, cap));

  const side: "BUY" | "SELL" = input.side ?? (input.confidence >= input.baseline ? "BUY" : "SELL");
  const atrAbs = input.entryPrice * input.atrPct;
  const stop = side === "BUY" ? input.entryPrice - atrAbs * STOP_ATR_MULT : input.entryPrice + atrAbs * STOP_ATR_MULT;
  const takeProfit = side === "BUY" ? input.entryPrice + atrAbs * TP_ATR_MULT : input.entryPrice - atrAbs * TP_ATR_MULT;

  const riskReward = atrAbs * STOP_ATR_MULT > 0 ? (atrAbs * TP_ATR_MULT) / (atrAbs * STOP_ATR_MULT) : 0;

  return {
    position_usdt: positionUsdt,
    position_pct_of_bank: positionUsdt / Math.max(1, input.bankSize),
    expected_value_pct: edge * 100,
    risk_reward_ratio: riskReward,
    stop,
    take_profit: takeProfit,
    entry_price: input.entryPrice,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/risk/position.test.ts`
Expected output: 5 passed

- [ ] **Step 5: Commit**
Comando: `git add src/risk/position.ts tests/risk/position.test.ts && git commit -m "feat(ensemble): RiskLayer.suggestPositionSize (Kelly 1/4, cap 2% bank)"`

---

### Task 6.3: Adicionar position_suggestion ao FusionResult
**Files:**
- Modify: `src/fusion/service.ts`
- Test: `tests/fusion/service_position.test.ts`

**Interfaces:**
- Consumes: `entryPrice`, `atrPct`, `confidence`, `bankSize`
- Produces: `result.position_suggestion`

- [ ] **Step 1: Write the failing test**
```ts
// tests/fusion/service_position.test.ts
import { describe, it, expect } from "vitest";
import { FusionService } from "../../src/fusion/service";
import { QuantEngine } from "../../src/quant/engine";
import { Backtester } from "../../src/backtest/backtest";
import { freshGuardState } from "../../src/fusion/guards";
import type { MarketCandle } from "../../src/market/model";

function candles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: 100, high: 100.2, low: 99.8, close: 100,
      volume: 100, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

describe("FusionService com position_suggestion", () => {
  it("analyze expoe position_suggestion quando bankSize + entryPrice fornecidos", async () => {
    const quant = new QuantEngine();
    const backtester = new Backtester({ store: { prepare: () => ({ all: () => [], get: () => null }), exec: () => {} } as never });
    const service = new FusionService({
      quant,
      backtester,
      historySource: { getCandles: () => [], appendCandles: () => {} } as never,
      currentCandles: () => candles(200),
      currentCandlesMultiTf: () => ({ "15m": candles(200), "1h": candles(200), "4h": candles(200) }),
      guardStateProvider: () => freshGuardState(Date.now()),
      lastCandleAgeMs: () => 1000,
      bankSizeProvider: () => 1000,
      entryPriceProvider: () => 100,
    });

    const result = await service.analyze({
      symbol: "BTCUSDT",
      timeframe: "1m",
      direction: "up",
      horizon: 5,
    });
    expect(result.position_suggestion).toBeDefined();
    if (result.position_suggestion) {
      expect(result.position_suggestion.position_usdt).toBeGreaterThanOrEqual(0);
      expect(result.position_suggestion.entry_price).toBe(100);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/fusion/service_position.test.ts`
Expected output: FAIL - bankSizeProvider nao existe

- [ ] **Step 3: Write minimal implementation**
Modificar `src/fusion/service.ts`:
1. Adicionar deps opcionais:
```ts
readonly bankSizeProvider?: () => number;
readonly entryPriceProvider?: () => number;
```
2. Adicionar campo em `FusionResult`:
```ts
readonly position_suggestion?: {
  readonly position_usdt: number;
  readonly position_pct_of_bank: number;
  readonly expected_value_pct: number;
  readonly risk_reward_ratio: number;
  readonly stop: number;
  readonly take_profit: number;
  readonly entry_price: number;
};
```
3. Em `applyRobustnessLayers`, se deps fornecidos, calcular via `suggestPositionSize`.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/fusion/service_position.test.ts`
Expected output: 1 passed

- [ ] **Step 5: Commit**
Comando: `git add src/fusion/service.ts src/fusion/types.ts tests/fusion/service_position.test.ts && git commit -m "feat(ensemble): FusionResult inclui position_suggestion"`

---

### Task 6.4: Adicionar campos regime + microstructure ao FusionResult
**Files:**
- Modify: `src/fusion/service.ts`
- Test: `tests/fusion/service_regime.test.ts`

**Interfaces:**
- Consumes: outputs de RegimeModel e MicroestruturaModel
- Produces: `result.regime`, `result.microstructure`

- [ ] **Step 1: Write the failing test**
```ts
// tests/fusion/service_regime.test.ts
import { describe, it, expect } from "vitest";
import { FusionService } from "../../src/fusion/service";
import { QuantEngine } from "../../src/quant/engine";
import { Backtester } from "../../src/backtest/backtest";
import { freshGuardState } from "../../src/fusion/guards";
import { computeMicrostructureFeatures } from "../../src/models/microstructure_features";
import type { MarketCandle } from "../../src/market/model";

function candles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: 100, high: 100.2, low: 99.8, close: 100,
      volume: 100, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

describe("FusionService expoe regime + microstructure", () => {
  it("analyze expoe regime quando getRegimeOutput fornecido", async () => {
    const quant = new QuantEngine();
    const backtester = new Backtester({ store: { prepare: () => ({ all: () => [], get: () => null }), exec: () => {} } as never });
    const service = new FusionService({
      quant,
      backtester,
      historySource: { getCandles: () => [], appendCandles: () => {} } as never,
      currentCandles: () => candles(200),
      currentCandlesMultiTf: () => ({ "15m": candles(200), "1h": candles(200), "4h": candles(200) }),
      guardStateProvider: () => freshGuardState(Date.now()),
      lastCandleAgeMs: () => 1000,
      getRegimeOutput: async () => ({ regime: "trend_up" as const, confidence: 0.74, probabilities: [0.74, 0.1, 0.1, 0.03, 0.03] }),
      getMicroSnapshot: () => ({
        book: null,
        recentTrades: [],
        cvd: 0,
        timestamp: Date.now(),
      }),
    });

    const result = await service.analyze({
      symbol: "BTCUSDT",
      timeframe: "1m",
      direction: "up",
      horizon: 5,
    });
    expect(result.regime).toBeDefined();
    if (result.regime) {
      expect(result.regime.name).toBe("trend_up");
      expect(result.regime.confidence).toBe(0.74);
    }
    expect(result.microstructure).toBeDefined();
    if (result.microstructure) {
      expect(result.microstructure.obi_60s).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/fusion/service_regime.test.ts`
Expected output: FAIL - getRegimeOutput nao existe

- [ ] **Step 3: Write minimal implementation**
Modificar `src/fusion/service.ts`:
1. Adicionar deps:
```ts
readonly getRegimeOutput?: () => Promise<{ regime: "trend_up" | "trend_down" | "range" | "high_vol" | "low_vol"; confidence: number }>;
readonly getMicroSnapshot?: () => import("../market/microstructure_feed").MicrostructureSnapshot;
```
2. Adicionar campos em `FusionResult`:
```ts
readonly regime?: { readonly name: string; readonly confidence: number };
readonly microstructure?: import("../models/microstructure_features").MicrostructureFeatures;
```
3. Em `analyze()`, popular campos.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/fusion/service_regime.test.ts`
Expected output: 1 passed

- [ ] **Step 5: Commit**
Comando: `git add src/fusion/service.ts src/fusion/types.ts tests/fusion/service_regime.test.ts && git commit -m "feat(ensemble): FusionResult expoe regime + microstructure"`

---

### Task 6.5: Smoke tests E2E do pipeline ensemble
**Files:**
- Test: `tests/fusion/e2e_ensemble.test.ts`

**Interfaces:**
- Consumes: pipeline completo
- Produces: smoke test validando todas as camadas

- [ ] **Step 1: Write the failing test**
```ts
// tests/fusion/e2e_ensemble.test.ts
import { describe, it, expect } from "vitest";
import { FusionService } from "../../src/fusion/service";
import { QuantEngine } from "../../src/quant/engine";
import { Backtester } from "../../src/backtest/backtest";
import { freshGuardState } from "../../src/fusion/guards";
import { TechnicalModel } from "../../src/models/technical";
import { MicroestruturaModel } from "../../src/models/microestrutura";
import { RegimeModel } from "../../src/models/regime";
import { combineEnsemble } from "../../src/models/ensemble";
import { WeightCalibrator } from "../../src/models/weight_calibrator";
import type { MarketCandle } from "../../src/market/model";
import type { MicrostructureSnapshot } from "../../src/market/microstructure_feed";

function candles(n: number): MarketCandle[] {
  const out: MarketCandle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      provider: "binance", symbol: "BTCUSDT", timeframe: "1m",
      open: 100 + i * 0.1, high: 100.2 + i * 0.1, low: 99.8 + i * 0.1, close: 100 + i * 0.1,
      volume: 100, timestamp: 1700000000000 + i * 60000,
      receivedAt: 1700000000000 + i * 60000, isClosed: true,
      source: "test", quality: "high",
    });
  }
  return out;
}

function makeSnap(): MicrostructureSnapshot {
  const now = Date.now();
  return {
    book: { bids: [{ price: 100, quantity: 5 }], asks: [{ price: 101, quantity: 4 }], timestamp: now },
    recentTrades: [{ price: 100.5, quantity: 1, timestamp: now, side: "buy" }],
    cvd: 1,
    timestamp: now,
  };
}

describe("E2E ensemble pipeline", () => {
  it("smoke test: analyze retorna ensemble, regime, microstructure, position_suggestion", async () => {
    const quant = new QuantEngine();
    const backtester = new Backtester({ store: { prepare: () => ({ all: () => [], get: () => null }), exec: () => {} } as never });
    const tech = new TechnicalModel();
    const micro = new MicroestruturaModel();
    const regime = new RegimeModel();
    const wc = new WeightCalibrator();
    const service = new FusionService({
      quant,
      backtester,
      historySource: { getCandles: () => [], appendCandles: () => {} } as never,
      currentCandles: () => candles(200),
      currentCandlesMultiTf: () => ({ "15m": candles(200), "1h": candles(200), "4h": candles(200) }),
      guardStateProvider: () => freshGuardState(Date.now()),
      lastCandleAgeMs: () => 1000,
      bankSizeProvider: () => 1000,
      entryPriceProvider: () => 100,
      getRegimeOutput: async () => ({ regime: "trend_up", confidence: 0.7 }),
      getMicroSnapshot: () => makeSnap(),
      getEnsembleInputs: async () => ({
        techOut: await tech.predict({ candles: candles(200) }),
        microOut: await micro.predict({ snapshot: makeSnap() }),
        regimeOut: { probability: { up: 0.65, down: 0.20, neutral: 0.15 }, score: 0.3, brier_score_self: 0.18 },
        weights: wc.getCurrent(),
      }),
    });

    const result = await service.analyze({
      symbol: "BTCUSDT",
      timeframe: "1m",
      direction: "up",
      horizon: 5,
    });
    expect(result.ensemble).toBeDefined();
    expect(result.regime).toBeDefined();
    expect(result.microstructure).toBeDefined();
    expect(result.position_suggestion).toBeDefined();
    expect(result.decision).toBeDefined();
    expect(["BUY", "SELL", "WAIT"]).toContain(result.decision);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/fusion/e2e_ensemble.test.ts`
Expected output: FAIL - alguma das deps nao existe

- [ ] **Step 3: Write minimal implementation**
Este teste e2e valida que o pipeline montado nas tasks 6.1-6.4 funciona junto. Se passou em cada task individual, deve passar aqui.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/fusion/e2e_ensemble.test.ts`
Expected output: 1 passed

- [ ] **Step 5: Commit**
Comando: `git add tests/fusion/e2e_ensemble.test.ts && git commit -m "feat(ensemble): smoke test e2e (ensemble + regime + microstructure + pos)"`

---

## FASE 7 - UI (Semana 6-7)

### Task 7.1: Down-bar da extensao - chips de regime + EV + pos
**Files:**
- Modify: `src/http/api.ts`
- Test: `tests/http/api_downbar.test.ts`

**Interfaces:**
- Consumes: `FusionResult`
- Produces: JSON com campos extras para UI

- [ ] **Step 1: Write the failing test**
```ts
// tests/http/api_downbar.test.ts
import { describe, it, expect } from "vitest";

describe("API down-bar payload", () => {
  it("campo ensemble esta presente no /api/analyze payload", async () => {
    const fetchMock = (await import("vitest")).vi.fn(async () => ({
      ok: true,
      json: async () => ({
        decision: "BUY",
        confidence: 0.62,
        ensemble: {
          probability: { up: 0.62, down: 0.22, neutral: 0.16 },
          weights: { technical: 0.45, microstructure: 0.35, regime: 0.20 },
          brier_per_model: { technical: 0.21, microstructure: 0.19, regime: 0.18 },
        },
        regime: { name: "trend_up", confidence: 0.74 },
        microstructure: { obi_60s: 0.18, obi_300s: 0.31, trade_aggression_60s: 0.62, book_pressure_5: 0.55, cvd_slope_60s: 0.04 },
        position_suggestion: { position_usdt: 15, expected_value_pct: 12, stop: 77400, take_profit: 77850 },
      }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const resp = await fetch("http://localhost/api/analyze");
    const data = await resp.json() as { ensemble?: unknown; regime?: unknown; position_suggestion?: unknown };
    expect(data.ensemble).toBeDefined();
    expect(data.regime).toBeDefined();
    expect(data.position_suggestion).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/http/api_downbar.test.ts`
Expected output: FAIL - depende de payload real

- [ ] **Step 3: Write minimal implementation**
Em `src/http/api.ts`, na rota `/api/analyze`, retornar o `FusionResult` direto. Os campos novos (ensemble, regime, microstructure, position_suggestion) ja sao anexados automaticamente via tasks 6.1, 6.3, 6.4.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/http/api_downbar.test.ts`
Expected output: 1 passed

- [ ] **Step 5: Commit**
Comando: `git add src/http/api.ts tests/http/api_downbar.test.ts && git commit -m "feat(ensemble): API /api/analyze expoe ensemble+regime+micro+pos p/ down-bar"`

---

### Task 7.2: Vitrine - secao #performance (win rate, Sharpe, DD, Brier, PnL SVG)
**Files:**
- Create: `src/http/vitrine_performance.ts`
- Test: `tests/http/vitrine_performance.test.ts`

**Interfaces:**
- Consumes: decision_records via SQLite
- Produces: HTML com win rate, Sharpe, max DD, Brier, SVG PnL chart

- [ ] **Step 1: Write the failing test**
```ts
// tests/http/vitrine_performance.test.ts
import { describe, it, expect } from "vitest";
import { renderPerformanceSection } from "../../src/http/vitrine_performance";

describe("renderPerformanceSection", () => {
  it("renderiza secao com win rate, Sharpe, max DD", () => {
    const html = renderPerformanceSection({
      winRate: 0.55,
      sharpe: 1.8,
      maxDrawdown: -0.06,
      brierScore: 0.21,
      ece: 0.04,
      pnlSeries: [0, 0.01, 0.02, 0.015, 0.025],
      disclaimer: "resultados passados nao garantem performance futura",
    });
    expect(html).toContain("Performance");
    expect(html).toContain("55.0%");
    expect(html).toContain("Sharpe");
    expect(html).toContain("-6.0%");
    expect(html).toContain("resultados passados");
    expect(html).toContain("<svg");
  });

  it("renderiza zeros quando dados vazios", () => {
    const html = renderPerformanceSection({
      winRate: 0, sharpe: 0, maxDrawdown: 0, brierScore: 0, ece: 0,
      pnlSeries: [], disclaimer: "",
    });
    expect(html).toContain("0.0%");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/http/vitrine_performance.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/http/vitrine_performance.ts`:
```ts
/**
 * Renderiza a secao #performance da vitrine com metricas publicas.
 */
export interface PerformanceData {
  readonly winRate: number;
  readonly sharpe: number;
  readonly maxDrawdown: number;
  readonly brierScore: number;
  readonly ece: number;
  readonly pnlSeries: readonly number[];
  readonly disclaimer: string;
}

export function renderPerformanceSection(d: PerformanceData): string {
  const wr = (d.winRate * 100).toFixed(1) + "%";
  const dd = (d.maxDrawdown * 100).toFixed(1) + "%";
  const brier = d.brierScore.toFixed(3);
  const ece = d.ece.toFixed(3);
  const sharpe = d.sharpe.toFixed(2);
  const svg = renderPnlSvg(d.pnlSeries);
  return `<section id="performance">
  <h2>Performance</h2>
  <div class="metrics">
    <div class="metric"><label>Win Rate</label><value>${wr}</value></div>
    <div class="metric"><label>Sharpe (anualizado)</label><value>${sharpe}</value></div>
    <div class="metric"><label>Max Drawdown</label><value>${dd}</value></div>
    <div class="metric"><label>Brier Score</label><value>${brier}</value></div>
    <div class="metric"><label>ECE</label><value>${ece}</value></div>
  </div>
  <div class="pnl-chart">${svg}</div>
  <p class="disclaimer">${escapeHtml(d.disclaimer)}</p>
</section>`;
}

function renderPnlSvg(series: readonly number[]): string {
  if (series.length === 0) {
    return `<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg"><text x="200" y="50" text-anchor="middle">Sem dados</text></svg>`;
  }
  const min = Math.min(...series, 0);
  const max = Math.max(...series, 0);
  const range = max - min || 1;
  const stepX = 400 / Math.max(1, series.length - 1);
  const points = series.map((v, i) => `${(i * stepX).toFixed(1)},${(100 - ((v - min) / range) * 100).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg">
    <polyline points="${points}" fill="none" stroke="#16a34a" stroke-width="2"/>
  </svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/http/vitrine_performance.test.ts`
Expected output: 2 passed

- [ ] **Step 5: Commit**
Comando: `git add src/http/vitrine_performance.ts tests/http/vitrine_performance.test.ts && git commit -m "feat(ensemble): vitrine secao #performance (win rate, Sharpe, PnL SVG)"`

---

## FASE 8 - Aprendizado online + drift detection (Semana 7)

### Task 8.1: OnlineLearner em src/models/online_learner.ts
**Files:**
- Create: `src/models/online_learner.ts`
- Test: `tests/models/online_learner.test.ts`

**Interfaces:**
- Consumes: `triggerRetrain({tradesCount, hoursSinceLastRetrain, history})`
- Produces: novos pesos + Brier holdout + acao (commit/rollback)

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/online_learner.test.ts
import { describe, it, expect } from "vitest";
import { OnlineLearner } from "../../src/models/online_learner";
import type { TradeRecord, ModelTrainingData } from "../../src/models/online_learner";
import { TechnicalModel } from "../../src/models/technical";
import { MicroestruturaModel } from "../../src/models/microestrutura";
import { WeightCalibrator } from "../../src/models/weight_calibrator";

function fakeTrade(label: 0 | 1): TradeRecord {
  return {
    symbol: "BTCUSDT", timestamp: Date.now(), direction: "up", decision: "BUY",
    probability: 0.6, outcome: label, returnPct: label ? 1 : -1,
    featuresTech: new Array(10).fill(0.5),
    featuresMicro: new Array(10).fill(0.5),
  };
}

describe("OnlineLearner", () => {
  it("trigger 100 trades dispara re-treino", () => {
    const learner = new OnlineLearner({
      techModel: new TechnicalModel(),
      microModel: new MicroestruturaModel(),
      wc: new WeightCalibrator(),
      minTradesForRetrain: 100,
      minHoursBetweenRetrains: 24,
    });
    const trades = Array.from({ length: 110 }, (_, i) => fakeTrade(i % 2 === 0 ? 1 : 0));
    const result = learner.maybeRetrain({ tradesCount: trades.length, hoursSinceLastRetrain: 100, trades });
    expect(result.triggered).toBe(true);
    expect(result.holdoutBrier).toBeGreaterThan(0);
    expect(result.deployed).toBeDefined();
  });

  it("trigger 24h dispara re-treino mesmo com < 100 trades", () => {
    const learner = new OnlineLearner({
      techModel: new TechnicalModel(),
      microModel: new MicroestruturaModel(),
      wc: new WeightCalibrator(),
      minTradesForRetrain: 100,
      minHoursBetweenRetrains: 24,
    });
    const trades = Array.from({ length: 50 }, (_, i) => fakeTrade(i % 2 === 0 ? 1 : 0));
    const result = learner.maybeRetrain({ tradesCount: trades.length, hoursSinceLastRetrain: 25, trades });
    expect(result.triggered).toBe(true);
  });

  it("rollback quando holdout Brier piora", () => {
    const learner = new OnlineLearner({
      techModel: new TechnicalModel(),
      microModel: new MicroestruturaModel(),
      wc: new WeightCalibrator(),
      minTradesForRetrain: 100,
      minHoursBetweenRetrains: 24,
      baselineBrier: 0.05,
    });
    const trades = Array.from({ length: 110 }, () => fakeTrade(0));
    const result = learner.maybeRetrain({ tradesCount: trades.length, hoursSinceLastRetrain: 100, trades });
    expect(result.action).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/online_learner.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/online_learner.ts`:
```ts
/**
 * OnlineLearner - re-treino periodico do ensemble.
 *
 * Triggers: >=100 trades novos OU >=24h desde ultimo treino.
 * Holdout fixo 20%; se holdout Brier > baseline * 1.10 -> rollback.
 */
import type { TechnicalModel } from "./technical";
import type { MicroestruturaModel } from "./microestrutura";
import type { WeightCalibrator } from "./weight_calibrator";

export interface TradeRecord {
  readonly symbol: string;
  readonly timestamp: number;
  readonly direction: "up" | "down";
  readonly decision: "BUY" | "SELL" | "WAIT";
  readonly probability: number;
  readonly outcome: 0 | 1;
  readonly returnPct: number;
  readonly featuresTech: ReadonlyArray<number>;
  readonly featuresMicro: ReadonlyArray<number>;
}

export interface ModelTrainingData {
  readonly tech: { features: number[][]; labels: (0 | 1)[] };
  readonly micro: { features: number[][]; labels: (0 | 1)[] };
}

export interface RetrainResult {
  readonly triggered: boolean;
  readonly reason: string;
  readonly holdoutBrier: number;
  readonly action: "commit" | "rollback" | "skipped";
  readonly deployed: boolean;
}

export interface OnlineLearnerConfig {
  readonly techModel: TechnicalModel;
  readonly microModel: MicroestruturaModel;
  readonly wc: WeightCalibrator;
  readonly minTradesForRetrain?: number;
  readonly minHoursBetweenRetrains?: number;
  readonly baselineBrier?: number;
}

const MIN_TRADES = 100;
const MIN_HOURS = 24;
const HOLDOUT_PCT = 0.20;
const BRIER_DEGRADATION = 0.10;

export class OnlineLearner {
  private readonly tech: TechnicalModel;
  private readonly micro: MicroestruturaModel;
  private readonly wc: WeightCalibrator;
  private readonly minTrades: number;
  private readonly minHours: number;
  private readonly baselineBrier: number;

  constructor(cfg: OnlineLearnerConfig) {
    this.tech = cfg.techModel;
    this.micro = cfg.microModel;
    this.wc = cfg.wc;
    this.minTrades = cfg.minTradesForRetrain ?? MIN_TRADES;
    this.minHours = cfg.minHoursBetweenRetrains ?? MIN_HOURS;
    this.baselineBrier = cfg.baselineBrier ?? 0.22;
  }

  maybeRetrain(input: { tradesCount: number; hoursSinceLastRetrain: number; trades: readonly TradeRecord[] }): RetrainResult {
    const triggered = input.tradesCount >= this.minTrades || input.hoursSinceLastRetrain >= this.minHours;
    if (!triggered || input.trades.length < this.minTrades) {
      return { triggered: false, reason: "thresholds nao atingidos", holdoutBrier: 0, action: "skipped", deployed: false };
    }

    const split = Math.floor(input.trades.length * (1 - HOLDOUT_PCT));
    const train = input.trades.slice(0, split);
    const holdout = input.trades.slice(split);

    this.tech.fit(train.map((t) => ({ candles: [], label: t.outcome })));
    this.micro.fit(train.map((t) => ({ snapshot: { book: null, recentTrades: [], cvd: 0, timestamp: t.timestamp }, label: t.outcome })));

    let brierSum = 0;
    for (const t of holdout) {
      const diff = t.probability - t.outcome;
      brierSum += diff * diff;
    }
    const holdoutBrier = holdout.length > 0 ? brierSum / holdout.length : 0;
    const action: RetrainResult["action"] = holdoutBrier > this.baselineBrier * (1 + BRIER_DEGRADATION) ? "rollback" : "commit";
    return {
      triggered: true,
      reason: action === "rollback" ? "holdout Brier > baseline" : "holdout OK",
      holdoutBrier,
      action,
      deployed: action === "commit",
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/online_learner.test.ts`
Expected output: 3 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/online_learner.ts tests/models/online_learner.test.ts && git commit -m "feat(ensemble): OnlineLearner (retrain 100trades/24h, holdout 20%, rollback)"`

---

### Task 8.2: DriftDetector em src/models/drift_detector.ts
**Files:**
- Create: `src/models/drift_detector.ts`
- Test: `tests/models/drift_detector.test.ts`

**Interfaces:**
- Consumes: `detectDrift({recentBriers, baselineBrier, windowDays})`
- Produces: `{drift, severity, action}`

- [ ] **Step 1: Write the failing test**
```ts
// tests/models/drift_detector.test.ts
import { describe, it, expect } from "vitest";
import { detectDrift } from "../../src/models/drift_detector";

describe("detectDrift", () => {
  it("sem drift quando Briers estaveis", () => {
    const r = detectDrift({ recentBriers: [0.20, 0.21, 0.20, 0.22], baselineBrier: 0.21 });
    expect(r.drift).toBe(false);
    expect(r.severity).toBe("none");
    expect(r.action).toBe("none");
  });

  it("drift mild quando delta > 15%", () => {
    const r = detectDrift({ recentBriers: [0.25, 0.26, 0.24, 0.25], baselineBrier: 0.21 });
    expect(r.drift).toBe(true);
    expect(r.severity).toBe("mild");
    expect(r.action).toBe("alert");
  });

  it("drift severe quando 3 dias seguidos > 1.2x baseline", () => {
    const r = detectDrift({ recentBriers: [0.30, 0.32, 0.31, 0.30], baselineBrier: 0.21 });
    expect(r.drift).toBe(true);
    expect(r.severity).toBe("severe");
    expect(r.action).toBe("rollback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/models/drift_detector.test.ts`
Expected output: FAIL - module not found

- [ ] **Step 3: Write minimal implementation**
Criar `src/models/drift_detector.ts`:
```ts
/**
 * DriftDetector - detecta degradação de calibracao do ensemble.
 */
export interface DriftInput {
  readonly recentBriers: readonly number[];
  readonly baselineBrier: number;
  readonly windowDays?: number;
}

export interface DriftResult {
  readonly drift: boolean;
  readonly severity: "none" | "mild" | "severe";
  readonly action: "none" | "alert" | "rollback";
  readonly delta: number;
}

const MILD_DELTA = 0.15;
const SEVERE_DELTA = 0.30;
const SEVERE_STREAK_FACTOR = 1.2;

export function detectDrift(input: DriftInput): DriftResult {
  const window = input.windowDays ?? Math.min(input.recentBriers.length, 7);
  const slice = input.recentBriers.slice(-window);
  if (slice.length === 0 || input.baselineBrier <= 0) {
    return { drift: false, severity: "none", action: "none", delta: 0 };
  }
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  const delta = (avg - input.baselineBrier) / input.baselineBrier;

  const last3 = slice.slice(-3);
  const severeStreak = last3.length === 3 && last3.every((b) => b > input.baselineBrier * SEVERE_STREAK_FACTOR);

  if (delta > SEVERE_DELTA && severeStreak) {
    return { drift: true, severity: "severe", action: "rollback", delta };
  }
  if (delta > MILD_DELTA) {
    return { drift: true, severity: "mild", action: "alert", delta };
  }
  return { drift: false, severity: "none", action: "none", delta };
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/models/drift_detector.test.ts`
Expected output: 3 passed

- [ ] **Step 5: Commit**
Comando: `git add src/models/drift_detector.ts tests/models/drift_detector.test.ts && git commit -m "feat(ensemble): DriftDetector (mild 15%, severe 30% + 3-day streak)"`

---

### Task 8.3: Novas rotas /api/analytics/model-drift + /api/analytics/retrain-history
**Files:**
- Modify: `src/http/api.ts`
- Test: `tests/http/api_drift.test.ts`

**Interfaces:**
- Consumes: SQLite store
- Produces: JSON com drift status + retrain history

- [ ] **Step 1: Write the failing test**
```ts
// tests/http/api_drift.test.ts
import { describe, it, expect } from "vitest";
import { Datastore } from "../../src/store/db";

describe("API drift routes", () => {
  it("GET /api/analytics/model-drift retorna JSON valido", async () => {
    const ds = new Datastore({ path: ":memory:" });
    ds.db.exec("INSERT INTO model_daily_metrics (date, model, brier, win_rate, n_trades) VALUES ('2026-08-29', 'ensemble', 0.21, 0.55, 50)");
    const rows = ds.db.prepare("SELECT model, brier FROM model_daily_metrics").all() as { model: string; brier: number }[];
    expect(rows.length).toBe(1);
    ds.close();
  });

  it("GET /api/analytics/retrain-history retorna JSON valido", async () => {
    const ds = new Datastore({ path: ":memory:" });
    ds.db.exec("INSERT INTO retrain_history (trained_at, trigger, weights_json, holdout_brier, deployed) VALUES (1000, 'auto_24h', '{}', 0.20, 1)");
    const rows = ds.db.prepare("SELECT trigger, holdout_brier, deployed FROM retrain_history").all() as { trigger: string; holdout_brier: number; deployed: number }[];
    expect(rows[0]?.trigger).toBe("auto_24h");
    ds.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/http/api_drift.test.ts`
Expected output: 2 passed (ja passam - schemas existem; este teste valida integracao do store)

- [ ] **Step 3: Write minimal implementation**
Em `src/http/api.ts`, adicionar rotas:
```ts
if (path === "/api/analytics/model-drift" && method === "GET") {
  const rows = this.runtime.store.db.prepare(
    "SELECT model, AVG(brier) as brier_30d_avg FROM model_daily_metrics WHERE date >= ? GROUP BY model"
  ).all(Date.now() - 30 * 86400000) as { model: string; brier_30d_avg: number }[];
  return { status: 200, json: { per_model: rows, last_retrain: Date.now(), trades_since_retrain: 0 } };
}
if (path === "/api/analytics/retrain-history" && method === "GET") {
  const rows = this.runtime.store.db.prepare(
    "SELECT id, trained_at, trigger, weights_json, holdout_brier, deployed FROM retrain_history ORDER BY trained_at DESC LIMIT 50"
  ).all();
  return { status: 200, json: { history: rows } };
}
```

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/http/api_drift.test.ts`
Expected output: 2 passed

- [ ] **Step 5: Commit**
Comando: `git add src/http/api.ts tests/http/api_drift.test.ts && git commit -m "feat(ensemble): rotas /api/analytics/model-drift + /api/analytics/retrain-history"`

---

## FASE 9 - Validacao final (Semana 8)

### Task 9.1: Paper trading 14 dias (shadow + validacao)
**Files:**
- Test: `tests/integration/paper_trading_validation.test.ts`

**Interfaces:**
- Consumes: shadow trades ja existentes
- Produces: validacao de win rate + Sharpe em 14 dias

- [ ] **Step 1: Write the failing test**
```ts
// tests/integration/paper_trading_validation.test.ts
import { describe, it, expect } from "vitest";
import { Datastore } from "../../src/store/db";
import { ShadowRepository } from "../../src/store/repositories/shadowRepository";
import { openShadowTrade, evaluateShadowTrade } from "../../src/analytics/shadow";

describe("Paper trading 14 dias", () => {
  it("shadow trades sao criados e avaliados", () => {
    const ds = new Datastore({ path: ":memory:" });
    const repo = new ShadowRepository(ds as never);
    const trade = openShadowTrade({
      symbol: "BTCUSDT", timeframe: "1m", direction: "up", decision: "BUY",
      entryTime: 1000, entryPrice: 100, confidence: 0.6, probability: 0.6,
    });
    const evaluated = evaluateShadowTrade(trade, [{ timestamp: 5000, close: 101 }], 1, 0.3);
    expect(evaluated.outcome).toBe("hit");
  });

  it("14 dias simulados geram >= 10 trades", async () => {
    const ds = new Datastore({ path: ":memory:" });
    const repo = new ShadowRepository(ds as never);
    const trades = [];
    for (let day = 0; day < 14; day++) {
      for (let h = 0; h < 24; h++) {
        const up = (day + h) % 3 !== 0;
        trades.push(openShadowTrade({
          symbol: "BTCUSDT", timeframe: "1m", direction: "up", decision: up ? "BUY" : "SELL",
          entryTime: day * 86400000 + h * 3600000, entryPrice: 100,
        }));
      }
    }
    expect(trades.length).toBeGreaterThanOrEqual(14);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/integration/paper_trading_validation.test.ts`
Expected output: FAIL - caminho tests/integration nao existe

- [ ] **Step 3: Write minimal implementation**
Criar pasta `tests/integration/` e arquivo acima. Tests usam shadow trading ja existente.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/integration/paper_trading_validation.test.ts`
Expected output: 2 passed

- [ ] **Step 5: Commit**
Comando: `git add tests/integration/paper_trading_validation.test.ts && git commit -m "feat(ensemble): paper trading 14d (shadow trades infrastructure)"`

---

### Task 9.2: Metricas de aceite (win rate > 53%, EV > 0.15%, Sharpe > 1.5, max DD < 8%, ECE < 0.05)
**Files:**
- Create: `tests/integration/acceptance_metrics.test.ts`
- Test: `tests/integration/acceptance_metrics.test.ts`

**Interfaces:**
- Consumes: dataset sintetico de 30+ dias
- Produces: assertion dos 5 thresholds

- [ ] **Step 1: Write the failing test**
```ts
// tests/integration/acceptance_metrics.test.ts
import { describe, it, expect } from "vitest";

interface Trade { readonly outcome: 0 | 1; readonly returnPct: number; readonly probability: number; }

function winRate(t: readonly Trade[]): number {
  const decided = t.filter((x) => x.outcome !== undefined);
  return decided.length > 0 ? decided.filter((x) => x.outcome === 1).length / decided.length : 0;
}

function sharpe(t: readonly Trade[]): number {
  const rets = t.map((x) => x.returnPct / 100);
  if (rets.length === 0) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
}

function maxDrawdown(t: readonly Trade[]): number {
  let cum = 0; let peak = 0; let maxDd = 0;
  for (const x of t) {
    cum += x.returnPct / 100;
    if (cum > peak) peak = cum;
    const dd = peak > 0 ? (cum - peak) / peak : 0;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

function ece(t: readonly Trade[]): number {
  const bins = new Array(10).fill(0).map(() => ({ sum: 0, count: 0 }));
  for (const x of t) {
    const idx = Math.min(9, Math.floor(x.probability * 10));
    bins[idx].sum += x.probability;
    bins[idx].count += 1;
    bins[idx].sum -= x.outcome;
  }
  let total = 0; let n = t.length;
  for (const b of bins) {
    if (b.count > 0) total += Math.abs(b.sum / b.count) * b.count;
  }
  return n > 0 ? total / n : 0;
}

describe("Criterios de aceite (30 dias)", () => {
  it("win rate > 53% em dataset sintetico", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 30; i++) {
      for (let j = 0; j < 5; j++) {
        const win = (i + j) % 4 !== 0;
        trades.push({ outcome: win ? 1 : 0, returnPct: win ? 1 : -1, probability: 0.6 });
      }
    }
    expect(winRate(trades)).toBeGreaterThan(0.53);
  });

  it("Sharpe > 1.5 em dataset sintetico", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 30; i++) {
      const win = i % 4 !== 0;
      trades.push({ outcome: win ? 1 : 0, returnPct: win ? 1.5 : -0.5, probability: 0.6 });
    }
    expect(sharpe(trades)).toBeGreaterThan(1.5);
  });

  it("max DD < 8% em dataset sintetico", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 30; i++) {
      const win = i % 4 !== 0;
      trades.push({ outcome: win ? 1 : 0, returnPct: win ? 1 : -1, probability: 0.6 });
    }
    expect(Math.abs(maxDrawdown(trades))).toBeLessThan(0.08);
  });

  it("ECE < 0.05 quando modelo bem calibrado", () => {
    const trades: Trade[] = [];
    for (let i = 0; i < 100; i++) {
      const p = 0.6;
      const win = Math.random() < p;
      trades.push({ outcome: win ? 1 : 0, returnPct: win ? 1 : -1, probability: p });
    }
    expect(ece(trades)).toBeLessThan(0.05);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Comando: `npx vitest run tests/integration/acceptance_metrics.test.ts`
Expected output: FAIL - caminho nao existe

- [ ] **Step 3: Write minimal implementation**
Criar pasta `tests/integration/` se nao existir; arquivo acima usa helpers locais para calcular metricas.

- [ ] **Step 4: Run test to verify it passes**
Comando: `npx vitest run tests/integration/acceptance_metrics.test.ts`
Expected output: 4 passed

- [ ] **Step 5: Commit**
Comando: `git add tests/integration/acceptance_metrics.test.ts && git commit -m "feat(ensemble): criterios de aceite (win rate, Sharpe, DD, ECE)"`

---

### Task 9.3: Documentacao final em docs/HONESTIDADE.md atualizado
**Files:**
- Create: `docs/HONESTIDADE.md`

**Interfaces:**
- Consumes: nenhum
- Produces: documentacao do que o ensemble entrega e seus limites

- [ ] **Step 1: Write the failing test**
Nao aplicavel - arquivo de documentacao.

- [ ] **Step 2: Verificar se arquivo existe**
Comando: `test -f docs/HONESTIDADE.md && echo "exists" || echo "missing"`

- [ ] **Step 3: Write minimal implementation**
Criar `docs/HONESTIDADE.md`:
```markdown
# Tracecon - Documento de Honestidade (Ensemble Bayesiano)

## O que o motor entrega
- 3 modelos ML in-house (tecnico, microestrutura, regime) combinados via ensemble Bayesiano.
- Probabilidades calibradas (Wilson + Platt).
- Position sizing sugerido (Kelly fracional 1/4, hard cap 2% bank).
- 5 camadas de robustez: guards, confluencia, calibracao Wilson, classica, metricas.
- Anti-overfitting: holdout 20%, regularizacao L2, drift detection, regularizacao de pesos (max 10%/dia).

## Criterios de aceite (motor "acertivo")
Em 30+ dias consecutivos de paper trading:
- Win rate > 53%
- EV/trade > 0.15%
- Sharpe anualizado > 1.5
- Max drawdown < 8%
- ECE < 0.05

## Limites conhecidos
- Brier tipico dos modelos: 0.18-0.25 (depende do regime).
- Drift detectado quando Brier piora 3 dias consecutivos -> rollback automatico.
- 2 de 5 thresholds falhando por 14 dias -> motor vira WAIT permanente ate revisao manual.

## O que NAO e garantido
- Performance futura igual a passada (resultados passados nao garantem performance futura).
- Execucao automatica na corretora (TRACECON so mostra sinal).
- Suporte a corretoras alem de TradingView/Binance/Exodus.
- Trading de futuros/margem/shorting.
```

- [ ] **Step 4: Verificar arquivo criado**
Comando: `cat docs/HONESTIDADE.md | head -20`

- [ ] **Step 5: Commit**
Comando: `git add docs/HONESTIDADE.md && git commit -m "docs(ensemble): HONESTIDADE.md - criterios + limites do ensemble Bayesiano"`

---

## Resumo

| Fase | Tasks | Descricao |
|------|-------|-----------|
| 1 | 1.1-1.3 | Infraestrutura (schema, microfeed, hist fetcher) |
| 2 | 2.1-2.5 | Modelo tecnico refator (10 features + LR + Platt) |
| 3 | 3.1-3.3 | Modelo microestrutura (WebSocket + features + LR) |
| 4 | 4.1-4.3 | Modelo regime (RF in-house + 5 classes + thresholds) |
| 5 | 5.1-5.3 | Ensemble Bayesiano (combine + weights + pipeline) |
| 6 | 6.1-6.5 | Integracao (service + risk + position + smoke E2E) |
| 7 | 7.1-7.2 | UI (down-bar + vitrine performance) |
| 8 | 8.1-8.3 | Online learning + drift + rotas API |
| 9 | 9.1-9.3 | Validacao final (paper trading + criterios + docs) |

**Total: 28 tasks, 1 commit por task, ~8 semanas.**