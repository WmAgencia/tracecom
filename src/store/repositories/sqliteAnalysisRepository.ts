/**
 * Implementação SQLite do `AnalysisRepository`.
 *
 * A serialização/deserialização de `Analysis` fica isolada aqui. Nenhuma outra
 * camada precisa saber como o documento é persistido, o que mantém o domínio
 * independente da persistência (multi-tenancy-ready).
 */
import type { Analysis } from "../../domain/types";
import type { Logger } from "../../observability/logger";
import type { Datastore } from "../db";
import type { AnalysisRepository, ListAnalysisFilter } from "./analysisRepository";

interface Row {
  id: string;
  symbol: string;
  label: string;
  kind: string;
  quote: string;
  provider_id: string;
  timeframe: string;
  horizon: string;
  direction: string;
  rationale: string;
  confidence: number | null;
  technical_score: number | null;
  market_regime: string | null;
  risk_level: string | null;
  favorable: string;
  counter: string;
  invalidators: string;
  sources: string;
  quality: string;
  incomplete: number;
  engine_version: string;
  model: string;
  prompt_version: string;
  agent_version: string;
  trail: string;
  created_at: number;
}

function rowToAnalysis(r: Row): Analysis {
  const trail = JSON.parse(r.trail) as Analysis["trail"];
  return {
    id: r.id,
    instrument: {
      symbol: r.symbol,
      label: r.label,
      kind: r.kind as Analysis["instrument"]["kind"],
      quote: r.quote,
      providerId: r.provider_id,
    },
    timeframe: r.timeframe as Analysis["timeframe"],
    horizon: r.horizon,
    decision: {
      direction: r.direction as Analysis["decision"]["direction"],
      rationale: r.rationale,
    },
    confidence: r.confidence ?? undefined,
    technicalScore: r.technical_score ?? undefined,
    marketRegime: r.market_regime ?? undefined,
    risk: r.risk_level
      ? { score: 0, level: r.risk_level as "low" | "medium" | "high", factors: [], unknown: false }
      : undefined,
    favorableFactors: JSON.parse(r.favorable),
    counterFactors: JSON.parse(r.counter),
    invalidators: JSON.parse(r.invalidators),
    sources: JSON.parse(r.sources),
    quality: r.quality as Analysis["quality"],
    trail,
    version: {
      engine: r.engine_version,
      version: r.engine_version,
      model: r.model,
      promptVersion: r.prompt_version,
      agentVersion: r.agent_version,
    },
    createdAt: r.created_at,
    incomplete: r.incomplete === 1,
  };
}

export class SqliteAnalysisRepository implements AnalysisRepository {
  constructor(
    private readonly store: Datastore,
    private readonly logger?: Logger,
  ) {}

  async save(a: Analysis): Promise<void> {
    const stmt = this.store.db.prepare(`
      INSERT OR REPLACE INTO analyses (
        id, symbol, label, kind, quote, provider_id, timeframe, horizon,
        direction, rationale, confidence, technical_score, market_regime, risk_level,
        favorable, counter, invalidators, sources, quality, incomplete,
        engine_version, model, prompt_version, agent_version, trail, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    stmt.run(
      a.id,
      a.instrument.symbol,
      a.instrument.label,
      a.instrument.kind,
      a.instrument.quote,
      a.instrument.providerId,
      a.timeframe,
      a.horizon,
      a.decision.direction,
      a.decision.rationale,
      a.confidence ?? null,
      a.technicalScore ?? null,
      a.marketRegime ?? null,
      a.risk?.level ?? null,
      JSON.stringify(a.favorableFactors),
      JSON.stringify(a.counterFactors),
      JSON.stringify(a.invalidators),
      JSON.stringify(a.sources),
      a.quality,
      a.incomplete ? 1 : 0,
      a.version.engine,
      a.version.model,
      a.version.promptVersion,
      a.version.agentVersion,
      JSON.stringify(a.trail),
      a.createdAt,
    );
    this.logger?.debug("analysis.saved", { analysisId: a.id });
  }

  async findById(id: string): Promise<Analysis | null> {
    const stmt = this.store.db.prepare("SELECT * FROM analyses WHERE id = ?");
    const row = stmt.get(id) as Row | undefined;
    return row ? rowToAnalysis(row) : null;
  }

  async list(filter: ListAnalysisFilter = {}): Promise<Analysis[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.symbol) {
      where.push("symbol = ?");
      params.push(filter.symbol);
    }
    if (filter.timeframe) {
      where.push("timeframe = ?");
      params.push(filter.timeframe);
    }
    if (filter.from) {
      where.push("created_at >= ?");
      params.push(filter.from);
    }
    if (filter.to) {
      where.push("created_at <= ?");
      params.push(filter.to);
    }
    const limit = filter.limit ?? 100;
    const sql = `SELECT * FROM analyses ${
      where.length ? "WHERE " + where.join(" AND ") : ""
    } ORDER BY created_at DESC LIMIT ?`;
    const stmt = this.store.db.prepare(sql);
    const rows = stmt.all(...params, limit) as unknown as Row[];
    return rows.map(rowToAnalysis);
  }

  async delete(id: string): Promise<boolean> {
    const stmt = this.store.db.prepare("DELETE FROM analyses WHERE id = ?");
    const info = stmt.run(id);
    return Number(info.changes) > 0;
  }

  async count(): Promise<number> {
    const stmt = this.store.db.prepare("SELECT COUNT(*) AS n FROM analyses");
    const row = stmt.get() as { n: number };
    return Number(row.n);
  }
}
