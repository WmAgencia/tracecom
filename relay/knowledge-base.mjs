/**
 * TRADING KNOWLEDGE RETRIEVER (Fase 6) — RAG deterministico e point-in-time sobre o namespace TraceCom/.
 *
 * - Indice leve (keywords + metadata), sem embeddings obrigatorios; escalavel e auditavel.
 * - Point-in-time: availableAt <= decisionAt (nunca informacao futura).
 * - Escopo: somente notas do namespace TraceCom (cross-project bloqueado por construcao).
 * - Hot path: consulta a cache em memoria (nenhuma IO/bloqueio durante candles).
 * - Provenance: cada trecho retornado informa origem (CORE_BRAIN/OBSIDIAN_KNOWLEDGE/VALIDATED_LESSON/...).
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { PROVENANCE_TYPES, normalizeScopePath } from "./second-brain.mjs";

export const RETRIEVER_VERSION = "trading-knowledge-retriever-v1";
export const KNOWLEDGE_NAMESPACE = "TraceCom";

const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "e", "em", "o", "a", "os", "as", "um", "uma", "para", "com", "no", "na", "por", "que", "se", "the", "of", "and", "to", "in", "is", "it", "on", "or"]);
export const tokenize = (text) => String(text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !STOPWORDS.has(token));

/** Frontmatter simples (key: value) + body. */
export function parseNote(raw) {
  const text = String(raw ?? "");
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const entry = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!entry) continue;
    const [, key, rawValue] = entry;
    const value = rawValue.trim();
    meta[key] = value.startsWith("[") ? value.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim()).filter(Boolean) : value;
  }
  return { meta, body: match[2] };
}

export class TradingKnowledgeRetriever {
  constructor({ rootDir = path.join(process.cwd(), "knowledge"), secondBrain = null, now = () => Date.now(), log = () => {} } = {}) {
    this.rootDir = rootDir;
    this.secondBrain = secondBrain;
    this.now = now;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.notes = new Map();
    this.version = null;
    this.builtAt = null;
    this.lastError = null;
    this.cache = new Map(); // marketKey -> { key, at, ids, expiresAt, latencyMs }
  }

  async rebuild() {
    const started = this.now();
    const notes = new Map();
    const root = path.join(this.rootDir, KNOWLEDGE_NAMESPACE);
    const walk = async (directory) => {
      const rows = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const row of rows) {
        const absolute = path.join(directory, row.name);
        if (row.isDirectory()) { await walk(absolute); continue; }
        if (!row.name.endsWith(".md")) continue;
        const raw = await fs.readFile(absolute, "utf8").catch(() => null);
        if (raw === null) continue;
        const relative = path.relative(this.rootDir, absolute).replaceAll("\\", "/");
        const { meta, body } = parseNote(raw);
        const id = relative.replace(/\.md$/, "");
        notes.set(id, {
          id, relative, title: meta.title ?? path.basename(row.name, ".md"), category: meta.category ?? null, topic: meta.topic ?? null,
          sourceIds: Array.isArray(meta.sourceIds) ? meta.sourceIds : meta.sourceIds ? [meta.sourceIds] : [], sourceTier: meta.sourceTier ?? null,
          regimes: toList(meta.regimes), setups: toList(meta.setups), indicators: toList(meta.indicators), markets: toList(meta.markets), timeframes: toList(meta.timeframes), tags: toList(meta.tags),
          tracecomApplicability: meta.tracecomApplicability ?? "RESEARCH_ONLY", confidence: meta.confidence ?? null, status: meta.status ?? "SOURCE_KNOWLEDGE",
          availableAt: Number(meta.availableAt ?? meta.retrievedAt ?? meta.publishedAt ?? 0) || 0,
          createdAt: Number(meta.createdAt ?? meta.retrievedAt ?? 0) || 0, validTo: meta.validTo ? Number(meta.validTo) : null,
          tokens: tokenize(`${meta.title ?? ""} ${meta.topic ?? ""} ${body}`),
        });
      }
    };
    try { await walk(root); this.lastError = null; }
    catch (error) { this.lastError = String(error?.message ?? error).slice(0, 120); }
    this.notes = notes;
    this.version = `kb_${crypto.createHash("sha256").update([...notes.keys()].sort().join("|")).digest("hex").slice(0, 12)}`;
    this.builtAt = this.now();
    this.cache.clear();
    this.log("IQ_KNOWLEDGE_INDEX_BUILT", JSON.stringify({ notes: notes.size, version: this.version, ms: this.now() - started }));
    return { notes: notes.size, version: this.version, latencyMs: this.now() - started };
  }

  /** Busca point-in-time (availableAt <= atMs), escopada ao namespace e com score auditavel. */
  search({ query = "", regime = null, setup = null, marketKey = null, indicators = [], limit = 6, atMs = null, includeCandidate = true } = {}) {
    const started = this.now();
    const at = atMs === null ? this.now() : Number(atMs);
    const queryTokens = new Set(tokenize(query));
    const rows = [];
    for (const note of this.notes.values()) {
      if (note.availableAt && note.availableAt > at) continue; // point-in-time
      if (note.validTo && note.validTo <= at) continue;
      if (!includeCandidate && note.status === "CANDIDATE_KNOWLEDGE") continue;
      let score = 0;
      if (regime && note.regimes.includes(regime)) score += 3;
      if (setup && note.setups.includes(setup)) score += 3;
      if (marketKey && note.markets.includes(marketKey)) score += 2;
      for (const indicator of indicators) if (note.indicators.map((value) => value.toLowerCase()).includes(String(indicator).toLowerCase())) score += 1.5;
      let overlap = 0;
      for (const token of queryTokens) if (note.tokens.includes(token)) overlap += 1;
      score += Math.min(4, overlap * 0.6);
      if (note.status === "VALIDATED_KNOWLEDGE" || note.status === "VALIDATED_LESSON") score += 1.5;
      if (note.status === "CANDIDATE_KNOWLEDGE") score -= 0.5;
      if (note.tracecomApplicability === "NOT_APPLICABLE") score -= 5;
      if (note.tracecomApplicability === "RESEARCH_ONLY") score -= 0.2;
      if (score <= 0) continue;
      rows.push({ id: note.id, title: note.title, category: note.category, status: note.status, provenance: note.status === "VALIDATED_KNOWLEDGE" || note.status === "VALIDATED_LESSON" ? "VALIDATED_LESSON" : "OBSIDIAN_KNOWLEDGE", tracecomApplicability: note.tracecomApplicability, score: Number(score.toFixed(2)) });
    }
    const results = rows.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(20, limit)));
    return { results, knowledgeIds: results.map((row) => row.id), knowledgeVersion: this.version, retrievalLatencyMs: this.now() - started, atMs: at, scope: "TRACECOM" };
  }

  /** Cache por marketKey (pre-carregada quando regime/setup muda) — hot path sem IO. */
  contextForMarket(marketKey, { regime = null, setup = null, atMs = null } = {}) {
    const started = this.now();
    const key = `${regime ?? "-"}:${setup ?? "-"}`;
    const cached = this.cache.get(marketKey);
    if (cached && cached.key === key && cached.expiresAt > this.now()) return { used: true, cached: true, knowledgeIds: cached.ids, knowledgeVersion: this.version, retrievalLatencyMs: this.now() - started, provenance: cached.provenance };
    const search = this.search({ query: `${setup ?? ""} ${regime ?? ""}`, regime, setup, marketKey, limit: 5, atMs });
    const context = { used: search.knowledgeIds.length > 0, cached: false, knowledgeIds: search.knowledgeIds, knowledgeVersion: this.version, retrievalLatencyMs: this.now() - started, provenance: "OBSIDIAN_KNOWLEDGE" };
    this.cache.set(marketKey, { key, ids: context.knowledgeIds, provenance: context.provenance, expiresAt: this.now() + 5 * 60_000 });
    return context;
  }

  /** Pre-carrega conhecimento relevante (chamado quando regime/setup muda) — assincrono, nunca no hot path. */
  preload(marketKey, { regime, setup, atMs = null } = {}) {
    const search = this.search({ query: `${setup ?? ""} ${regime ?? ""}`, regime, setup, marketKey, limit: 5, atMs });
    this.cache.set(marketKey, { key: `${regime ?? "-"}:${setup ?? "-"}`, ids: search.knowledgeIds, provenance: "OBSIDIAN_KNOWLEDGE", expiresAt: this.now() + 5 * 60_000 });
    return search;
  }

  status() {
    const categories = {};
    for (const note of this.notes.values()) categories[note.category ?? "SEM_CATEGORIA"] = (categories[note.category ?? "SEM_CATEGORIA"] ?? 0) + 1;
    return { version: RETRIEVER_VERSION, knowledgeVersion: this.version, notes: this.notes.size, builtAt: this.builtAt, lastError: this.lastError, categories, provenanceTypes: PROVENANCE_TYPES, secondBrain: this.secondBrain?.status?.() ?? null, scope: normalizeScopePath("TraceCom/") };
  }

  get(id) { return this.notes.get(String(id)) ?? null; }
}

function toList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}
