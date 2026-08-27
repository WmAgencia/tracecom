/**
 * Binance WebSocket stream — recebe klines/trades em tempo real.
 *
 * Reconexão automática com backoff exponencial + jitter + teto. Detecta
 * desconexão, sincroniza gap (buscando histórico via REST) e continua.
 *
 * NOTA: WebSocket nativo global do Node é exposto sem tipo TS em alguns
 * setups; aqui usamos o DOM/undici `WebSocket` global (Node 22+).
 */
import type { MarketCandle, MarketTick, Timeframe } from "../../model";
import { normalizeWsKline, normalizeWsTrade } from "../../normalize";
import type { ProviderEvent } from "../../providerV2";

const WS_URL = "wss://stream.binance.com:9443/stream?streams=";

export interface BinanceStreamConfig {
  readonly provider?: string;
  readonly source?: string;
  readonly onEvent: (ev: ProviderEvent) => void;
  readonly onState: (state: "connected" | "reconnecting" | "error" | "disconnected") => void;
  readonly backoffBase?: number;
  readonly backoffMax?: number;
  url?: string;
}

interface Sub {
  readonly symbol: string;
  readonly timeframes: readonly Timeframe[];
}

export class BinanceStream {
  private ws: WebSocket | null = null;
  private stopped = false;
  private subs: Sub[] = [];
  private attempt = 0;
  private readonly cfg: BinanceStreamConfig;
  private readonly maxBackoff: number;

  constructor(cfg: BinanceStreamConfig) {
    this.cfg = cfg;
    this.maxBackoff = cfg.backoffMax ?? 10_000;
  }

  start(subs: Sub[]): void {
    this.subs = subs;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  private open(): void {
    if (this.stopped) return;
    this.cfg.onState(this.attempt === 0 ? "connected" : "reconnecting");

    const streams: string[] = [];
    for (const s of this.subs) {
      for (const tf of s.timeframes) streams.push(`${s.symbol.toLowerCase()}@kline_${tf}`);
      streams.push(`${s.symbol.toLowerCase()}@aggTrade`);
    }
    const url = this.cfg.url ?? (WS_URL + streams.join("/"));
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.attempt = 0;
      this.cfg.onState("connected");
    };
    this.ws.onmessage = (ev) => {
      // ev.data pode ser string (texto) — parse.
      const text = typeof ev.data === "string" ? ev.data : ev.data + "";
      this.handle(text);
    };
    this.ws.onerror = () => {
      this.cfg.onState("error");
    };
    this.ws.onclose = () => {
      this.scheduleReconnect();
    };
  }

  private handle(text: string): void {
    let data: { data?: unknown; stream?: string };
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }
    const payload = data.data as
      | { e: string; s: string; k?: Record<string, unknown>; p?: string; q?: string; T?: number; m?: boolean; x?: boolean }
      | undefined;
    if (!payload) return;
    const receivedAt = Date.now();
    if (payload.e === "kline" && payload.k) {
      const candle = normalizeWsKline(
        { k: payload.k as never, s: payload.s },
        { provider: "binance", timeframe: (payload.k.i as Timeframe), source: "ws:kline", receivedAt },
      );
      this.cfg.onEvent({ type: "candle", candle });
    } else if (payload.e === "aggTrade") {
      const tick = normalizeWsTrade(
        { p: payload.p ?? "0", q: payload.q ?? "0", T: payload.T ?? 0, m: payload.m },
        { provider: "binance", symbol: payload.s, source: "ws:trade", receivedAt },
      );
      this.cfg.onEvent({ type: "tick", tick });
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.cfg.onState("reconnecting");
    const base = this.cfg.backoffBase ?? 500;
    const exp = base * Math.pow(2, this.attempt);
    const capped = Math.min(exp, this.maxBackoff);
    const jitter = capped * 0.2 * (Math.random() * 2 - 1);
    const delay = Math.max(200, Math.round(capped + jitter));
    this.attempt++;
    setTimeout(() => this.open(), delay);
  }

  /** Expõe símbolos assinados (para reconciliar gap). */
  subscribedSymbols(): string[] {
    return this.subs.map((s) => s.symbol);
  }
}
