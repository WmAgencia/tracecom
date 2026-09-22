/**
 * SEGURANCA A/B SHADOW — mede o efeito de cada nivel de Seguranca (%) na taxa de acerto.
 *
 * Regras:
 *  - NUNCA envia ordem, NUNCA toca no lock de execucao, NUNCA altera a decisao ao vivo.
 *  - Roda o MESMO snapshot (mesmas opinioes dos 5 agentes) em N niveis de Seguranca e registra
 *    entradas hipoteticas (paper) no mesmo instante da janela de entrada da execucao real.
 *  - Liquidacao pelo FEED (candle que cobre o vencimento), separada do P&L real:
 *    resultado e `result`/`pnl` de paper (stake 1), nunca confundido com execucao.
 */
import { runConsensusAgent } from "./consensus.agent.mjs";
import { CUSTOM_STRATEGIES } from "./custom-strategies.mjs";

export const SAFETY_SHADOW_RUN_ID = "agentic-safety-shadow-v1";
export const SAFETY_SHADOW_VERSION = "safety-shadow-v1";
export const DEFAULT_SHADOW_LEVELS = [100, 90, 80, 70, 50];

export function parseSafetyLevels(value) {
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  const specs = []; const seen = new Set();
  for (const item of source) {
    const raw = String(item ?? "").trim().toUpperCase();
    if (!raw) continue;
    const match = raw.match(/^(\d{1,3})\s*([A-Z]{0,3})$/);
    if (!match) continue;
    const safetyPct = Math.max(0, Math.min(100, Math.round(Number(match[1]))));
    const variant = match[2] || "";
    const label = String(safetyPct) + variant;
    if (seen.has(label)) continue;
    seen.add(label);
    specs.push({ safetyPct, variant, label });
  }
  if (!specs.length) return DEFAULT_SHADOW_LEVELS.map((n) => ({ safetyPct: n, variant: "", label: String(n) }));
  return specs.sort((a, b) => b.safetyPct - a.safetyPct || (a.variant < b.variant ? -1 : a.variant > b.variant ? 1 : 0));
}

export class SafetyShadow {
  constructor({ pool, levels = DEFAULT_SHADOW_LEVELS, now = () => Date.now(), log = () => {}, candles = null, entryOffsetMs = 40_000, entryToleranceMs = 2_500, runId = SAFETY_SHADOW_RUN_ID } = {}) {
    this.pool = pool;
    this.runId = runId;
    this.levels = parseSafetyLevels(levels);
    this.now = now;
    this.log = log;
    this.candles = candles;
    this.entryOffsetMs = entryOffsetMs;
    this.entryToleranceMs = entryToleranceMs;
    this.pending = new Set();
    this.customLastAt = new Map();
    this.stats = { calls: 0, inWindow: 0, outOfWindow: 0, noExpiry: 0, recorded: 0, settled: 0, noData: 0, skipped: 0, errors: 0, lastDeltaMs: null };
  }

  setLevels(levels) {
    this.levels = parseSafetyLevels(levels);
    return this.levels;
  }

  /** Registra entradas de paper: estrategias custom (sem janela) + niveis de seguranca (janela T-34..T-31,5). */
  async record(graph, snapshot) {
    this.stats.calls += 1;
    if (!this.pool?.query || !graph?.opinions || !snapshot) return;
    const expiryAt = Number(snapshot.targetExpiryAt ?? 0);
    const at = Number(snapshot.at ?? 0);
    if (!expiryAt || !at) { this.stats.noExpiry += 1; return; }
    const entryPrice = Number(snapshot.ohlc?.close);
    if (!Number.isFinite(entryPrice)) return;
    const marketKey = String(snapshot.marketKey ?? "");
    if (!marketKey) return;
    const payout = Number.isFinite(Number(snapshot.payout)) ? Number(snapshot.payout) : null;
    const rows = [];
    // Estrategias custom: entram a qualquer momento, expiracao propria, cooldown 60s por ativo/estrategia.
    for (const strategy of CUSTOM_STRATEGIES) {
      const key = marketKey + "|" + strategy.id;
      if (at - (this.customLastAt.get(key) ?? 0) < 60_000) continue;
      const side = strategy.gate({ snapshot, opinions: graph.opinions }) === true ? strategy.signal({ snapshot, opinions: graph.opinions }) : null;
      if (!side) continue;
      this.customLastAt.set(key, at);
      rows.push({ level: 0, variant: strategy.id, marketKey, side, entryPrice, payout, expiryAt: at + strategy.expirySeconds * 1000, snapshotId: graph.snapshotId ?? null, reason: strategy.label });
    }
    // Niveis de seguranca: so no fechamento da janela de entrada.
    const entryMoment = expiryAt - this.entryOffsetMs;
    const delta = at - entryMoment;
    if (Math.abs(delta) <= this.entryToleranceMs) {
      this.stats.inWindow += 1;
      for (const spec of this.levels) {
        const key = `${marketKey}|${expiryAt}|${spec.label}`;
        if (this.pending.has(key)) continue;
        const consensus = runConsensusAgent({ snapshot, opinions: graph.opinions, safetyPct: spec.safetyPct });
        if (consensus.decision !== "BUY" && consensus.decision !== "SELL") continue;
        this.pending.add(key);
        rows.push({ level: spec.safetyPct, variant: spec.variant, marketKey, side: consensus.decision, entryPrice, payout, expiryAt, snapshotId: graph.snapshotId ?? null, reason: String(consensus.reason ?? "").slice(0, 300) });
      }
    } else { this.stats.outOfWindow += 1; this.stats.lastDeltaMs = Math.round(delta); }
    for (const row of rows) {
      try {
        await this.pool.query(
          "INSERT INTO iq_shadow_trades (run_id, level, variant, market_key, side, entry_price, payout, expiry_at, snapshot_id, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0),$9,$10) ON CONFLICT (run_id, level, variant, market_key, expiry_at) DO NOTHING",
          [this.runId, row.level, row.variant, row.marketKey, row.side, row.entryPrice, row.payout, row.expiryAt, row.snapshotId, row.reason]
        );
        this.stats.recorded += 1;
      } catch (error) {
        this.stats.errors += 1;
        this.log("SAFETY_SHADOW_RECORD_FAIL", String(error?.message ?? error).slice(0, 140));
      }
    }
  }

  /** Liquida os paper trades vencidos usando o candle do feed que cobre o vencimento. */
  async settle() {
    if (!this.pool?.query || typeof this.candles !== "function") return;
    const due = await this.pool.query(
      "SELECT id, market_key AS \"marketKey\", side, entry_price AS \"entryPrice\", payout, expiry_at AS \"expiryAt\" FROM iq_shadow_trades WHERE run_id=$1 AND settled_at IS NULL AND expiry_at <= now() AND expiry_at > now() - interval '10 minutes' ORDER BY expiry_at LIMIT 60",
      [this.runId]
    ).catch(() => ({ rows: [] }));
    for (const row of due.rows ?? []) {
      try {
        const batch = await this.candles(row.marketKey, 30);
        const list = batch?.rows?.[row.marketKey] ?? [];
        const expiryMs = new Date(row.expiryAt).getTime();
        const candle = [...list].reverse().find((c) => Number(c.bucketEnd) <= expiryMs + 2_000 && Number(c.bucketEnd) >= expiryMs - 12_000);
        if (!candle) continue;
        const close = Number(candle.close);
        const entry = Number(row.entryPrice);
        if (!Number.isFinite(close) || !Number.isFinite(entry)) continue;
        const result = row.side === "BUY" ? (close > entry ? "WIN" : close < entry ? "LOSS" : "DRAW") : (close < entry ? "WIN" : close > entry ? "LOSS" : "DRAW");
        const payout = Number(row.payout ?? 0);
        const pnl = result === "WIN" ? Number((payout / 100).toFixed(4)) : result === "LOSS" ? -1 : 0;
        await this.pool.query("UPDATE iq_shadow_trades SET result=$2, pnl=$3, close_price=$4, settled_at=now() WHERE id=$1", [row.id, result, pnl, close]);
        this.stats.settled += 1;
      } catch (error) {
        this.stats.errors += 1;
        this.log("SAFETY_SHADOW_SETTLE_FAIL", String(error?.message ?? error).slice(0, 140));
      }
    }
    await this.pool.query("UPDATE iq_shadow_trades SET result='NO_DATA', settled_at=now() WHERE run_id=$1 AND settled_at IS NULL AND expiry_at < now() - interval '10 minutes'", [this.runId])
      .then((r) => { this.stats.noData += r.rowCount ?? 0; })
      .catch(() => undefined);
  }

  /** Relatorio por nivel: entradas, liquidadas, WR, PnL paper e entradas/hora. */
  async report(hours = 6) {
    if (!this.pool?.query) return { levels: [] };
    const bounded = Math.max(1, Math.min(72, Number(hours) || 6));
    const rows = (await this.pool.query(
      `SELECT level, variant,
              count(*)::int AS entries,
              count(*) FILTER (WHERE settled_at IS NOT NULL AND result IS NOT NULL AND result <> 'NO_DATA')::int AS settled,
              count(*) FILTER (WHERE result = 'WIN')::int AS wins,
              count(*) FILTER (WHERE result = 'LOSS')::int AS losses,
              count(*) FILTER (WHERE result = 'DRAW')::int AS draws,
              count(*) FILTER (WHERE result = 'NO_DATA')::int AS no_data,
              coalesce(sum(pnl) FILTER (WHERE result IN ('WIN','LOSS','DRAW')), 0)::numeric AS pnl,
              coalesce(avg(payout) FILTER (WHERE result IN ('WIN','LOSS')), 0)::numeric AS avg_payout
       FROM iq_shadow_trades
       WHERE run_id=$1 AND created_at >= now() - ($2 || ' hours')::interval
       GROUP BY level, variant ORDER BY level DESC, variant ASC`,
      [this.runId, String(bounded)]
    ).catch(() => ({ rows: [] }))).rows ?? [];
    const activeLabels = new Set([...this.levels.map((spec) => spec.label), ...CUSTOM_STRATEGIES.map((strategy) => strategy.id)]);
    const levels = rows.filter((row) => activeLabels.has(String(row.level) + String(row.variant ?? ""))).map((row) => {
      const decided = Number(row.wins) + Number(row.losses);
      const wr = decided > 0 ? Number((100 * Number(row.wins) / decided).toFixed(1)) : null;
      const breakeven = Number(row.avg_payout) > 0 ? Number((100 / (1 + Number(row.avg_payout) / 100)).toFixed(1)) : null;
      return {
        level: Number(row.level), variant: String(row.variant ?? ""), label: Number(row.level) === 0 && row.variant ? String(row.variant) : String(row.level) + String(row.variant ?? ""), entries: Number(row.entries), settled: Number(row.settled), wins: Number(row.wins), losses: Number(row.losses), draws: Number(row.draws), noData: Number(row.no_data),
        winRate: wr, breakeven: breakeven, edge: wr != null && breakeven != null ? Number((wr - breakeven).toFixed(1)) : null,
        pnl: Number(row.pnl), avgPayout: Number(Number(row.avg_payout).toFixed(1)), entriesPerHour: Number((Number(row.entries) / bounded).toFixed(1)),
      };
    });
    return { version: SAFETY_SHADOW_VERSION, runId: this.runId, hours: bounded, levels, stats: { ...this.stats }, activeLevels: this.levels.map((spec) => spec.label) };
  }
}
