/**
 * SHADOW PROSPECTIVO — binários REAIS da IQ Option (ZERO ordens).
 * =============================================================================
 * Registra a PREVISÃO antes de T+300s e resolve somente com preço legítimo e
 * timestamp EXATO. Nenhuma ordem PRACTICE ou REAL é enviada em nenhum caminho:
 * o allowlist do Scheduler recusa place_trade / place_market_order e afins
 * (o processo morre com ForbiddenToolError antes de qualquer chamada de escrita).
 *
 * Fluxo por ciclo (padrão 60s):
 *   1. para cada modelo CONGELADO com disponibilidade, busca candles de 1m;
 *   2. avalia o último candle FECHADO com a regra congelada (sem indicadores futuros);
 *   3. havendo sinal, grava uma previsão PENDING com instante de entrada,
 *      direção, produto, ativo, payout observado e MODEL_VERSION;
 *   4. resolve previsões vencidas usando SOMENTE o candle cujo `from` é
 *      exatamente entry_to + 300s. Se esse candle não existir, a previsão é
 *      marcada `unresolved_gap` — nunca é resolvida com preço aproximado.
 *
 * Uso:
 *   IQ_MCP_TOKEN=... node forward-paper/iq-shadow/shadow_logger.mjs
 * Variáveis: IQ_SHADOW_POLL_MS (60000), IQ_SHADOW_MAX_CYCLES (0 = infinito),
 *            IQ_SHADOW_DIR, IQ_MCP_TOKEN.
 *
 * Saída: forward-paper/iq-shadow/shadow-predictions.jsonl  (append-only)
 *        forward-paper/iq-shadow/shadow-state.json          (estado do runner)
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { Scheduler } from "../../diagnostic-results/iq_mcp_scheduler.mjs";

const DIR = process.env.IQ_SHADOW_DIR ?? "forward-paper/iq-shadow";
const FREEZE = join(DIR, "model-freeze.json");
const LOG = join(DIR, "shadow-predictions.jsonl");
const STATE = join(DIR, "shadow-state.json");
const CACHE = join(DIR, "asset-ids.json");
const POLL_MS = Number(process.env.IQ_SHADOW_POLL_MS ?? 60_000);
const MAX_CYCLES = Number(process.env.IQ_SHADOW_MAX_CYCLES ?? 0);
const PAYOUT_REFRESH_MS = 15 * 60_000;
const HORIZON_BARS = 5, SIZE_S = 60, HORIZON_S = HORIZON_BARS * SIZE_S; // 300s — horizonte do Binary V3
const ENTRY_SERVER = "binary-options"; // servidor usado apenas como FONTE DE CANDLES

if (!existsSync(FREEZE)) { console.error(`✗ congelamento ausente: ${FREEZE}. Rode primeiro npx tsx diagnostic-results/oos_validation.mts`); process.exit(1); }
const freeze = JSON.parse(readFileSync(FREEZE, "utf8"));
mkdirSync(DIR, { recursive: true });

// Verifica integridade do congelamento: o hash do spec precisa reproduzir.
for (const m of freeze.models) {
  const recomputed = createHash("sha256").update(JSON.stringify(m.MODEL_SPEC)).digest("hex");
  if (recomputed !== m.MODEL_VERSION) {
    console.error(`✗ MODEL_VERSION inconsistente para ${m.hypothesisId}: esperado ${m.MODEL_VERSION}, obtido ${recomputed}`);
    process.exit(1);
  }
}
const ACTIVE = freeze.models.filter((m) => m.market_availability);
console.log(`[shadow] modelos congelados: ${freeze.models.length} | ativos com disponibilidade confirmada: ${ACTIVE.length}`);
for (const m of freeze.models) console.log(`  ${m.market_availability ? "✓" : "✗"} ${m.hypothesisId} (${m.MODEL_VERSION.slice(0, 12)}) ${m.market_availability ? "" : "— instrumento indisponível, apenas monitorado para registro"}`);

const sched = new Scheduler({ token: process.env.IQ_MCP_TOKEN, perServerBudget: 5000, minGapMs: 1200, checkpoint: join(DIR, "scheduler-checkpoint.json") });

// ── resolução de asset_id por nome (uma vez, com cache em disco) ─────────────
let assetCache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : { resolvedAtUtc: null, byName: {} };
async function resolveAssetId(m) {
  const key = m.hypothesisId;
  if (assetCache.byName[key]?.asset_id) return assetCache.byName[key];
  // O congelamento já traz o asset_id confirmado no catálogo — evitar rede.
  if (m.asset_id !== null && m.asset_id !== undefined) {
    assetCache.byName[key] = { asset_id: m.asset_id, name: (m.asset_name_candidates ?? [])[0] ?? String(m.asset_id), product: m.candle_source_product ?? ENTRY_SERVER, payout: m.payout_execution ?? null };
    assetCache.resolvedAtUtc = new Date().toISOString();
    writeFileSync(CACHE, JSON.stringify(assetCache, null, 2));
    return assetCache.byName[key];
  }
  for (const cand of m.asset_name_candidates ?? []) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const tryLists = [m.product, ...(m.substituted_for ? ["binary-options", "turbo-options"] : [])];
    for (const server of tryLists) {
      try {
        const r = await sched.call(server, "list_assets", {});
        const arr = r.data?.assets ?? [];
        const hit = arr.find((a) => norm(a.name ?? "") === norm(cand));
        if (hit) {
          assetCache.byName[key] = { asset_id: hit.asset_id, name: hit.name, product: server, payout: hit.profit_percent ?? null, expirations: hit.expirations ?? [], expiration_sizes_s: hit.expiration_sizes_seconds ?? [] };
          assetCache.resolvedAtUtc = new Date().toISOString();
          writeFileSync(CACHE, JSON.stringify(assetCache, null, 2));
          return assetCache.byName[key];
        }
      } catch (e) { console.log(`[shadow] list_assets ${server} falhou: ${String(e.message).slice(0, 110)}`); }
    }
  }
  return null;
}

// ── regras congeladas (espelham SETUPS/DIRECTION em oos_validation.mts) ──────
function rsi(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (i <= period) { g += Math.max(d, 0); l += Math.max(-d, 0); if (i === period) { g /= period; l /= period; out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } continue; }
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l));
  }
  return out;
}
function sma(xs, i, n) { if (i < n - 1) return NaN; let s = 0; for (let k = i - n + 1; k <= i; k++) s += xs[k]; return s / n; }
function stdev(xs, i, n) { if (i < n - 1) return NaN; const m = sma(xs, i, n); let s = 0; for (let k = i - n + 1; k <= i; k++) s += (xs[k] - m) ** 2; return Math.sqrt(s / n); }

function directionFor(setup, closes, i) {
  if (i < 1) return null;
  const up = closes[i] > closes[i - 1];
  switch (setup) {
    case "fade1": return closes[i] !== closes[i - 1] ? (up ? "down" : "up") : null;
    case "fade3": {
      if (i < 3) return null;
      const a = closes[i] > closes[i - 1], b = closes[i - 1] > closes[i - 2], c = closes[i - 2] > closes[i - 3];
      if (a && b && c) return "down";
      if (!a && !b && !c) return "up";
      return null;
    }
    case "bb20": case "bb25": {
      const k = setup === "bb20" ? 2 : 2.5, m = sma(closes, i, 20), sd = stdev(closes, i, 20);
      if (!Number.isFinite(m) || !(sd > 0)) return null;
      if (closes[i] > m + k * sd) return "down";
      if (closes[i] < m - k * sd) return "up";
      return null;
    }
    case "rsi2": case "rsi2x": case "rsi14": {
      const period = setup === "rsi14" ? 14 : 2;
      const band = setup === "rsi14" ? [30, 70] : setup === "rsi2" ? [10, 90] : [5, 95];
      const r = rsi(closes, period)[i];
      if (!Number.isFinite(r)) return null;
      return r < band[0] ? "up" : r > band[1] ? "down" : null;
    }
    default: return null;
  }
}

/** Linhas cruas do log (trilha de auditoria append-only, pode conter revisões). */
function readRaw() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8").trim().split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
/**
 * Visão consolidada: uma entrada por previsão, com a ÚLTIMA revisão vencendo.
 * Sem isso, o registro de resolução (append) faria a previsão original
 * continuar "pending" e ser resolvida de novo a cada ciclo (duplicação infinita).
 */
function readLog() {
  const byKey = new Map();
  for (const r of readRaw()) {
    if (r.kind !== "prediction") continue;
    byKey.set(`${r.hypothesisId}|${r.entryBarFrom}`, r);
  }
  return [...byKey.values()].sort((a, b) => new Date(a.entryBarFrom) - new Date(b.entryBarFrom));
}
function appendRecords(recs) { for (const r of recs) appendFileSync(LOG, JSON.stringify(r) + "\n"); }

let payoutCache = { at: 0, byProduct: {} };
async function refreshPayouts(m) {
  if (Date.now() - payoutCache.at < PAYOUT_REFRESH_MS && payoutCache.byProduct[m.hypothesisId]) return payoutCache.byProduct[m.hypothesisId];
  try {
    // Payout relevante = o do PRODUTO DE EXECUÇÃO (onde o vencimento de 300s existe).
    const server = m.execution_product ?? ENTRY_SERVER;
    const r = await sched.call(server, "list_assets", {});
    const arr = r.data?.assets ?? [];
    const info = assetCache.byName[m.hypothesisId];
    const hit = arr.find((a) => a.asset_id === info?.asset_id);
    if (hit) {
      payoutCache.byProduct[m.hypothesisId] = { payout: hit.profit_percent ?? null, is_open: hit.is_open === true, expirations: hit.expirations ?? [], expiration_sizes_seconds: hit.expiration_sizes_seconds ?? [] };
      payoutCache.at = Date.now();
    }
  } catch (e) { console.log(`[shadow] payout refresh falhou: ${String(e.message).slice(0, 110)}`); }
  return payoutCache.byProduct[m.hypothesisId] ?? { payout: null, is_open: null, expirations: [], expiration_sizes_seconds: [] };
}

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { startedAtUtc: null, cycles: 0, predictions: 0, resolved: 0, unresolved: 0, lastCycleUtc: null };
state.startedAtUtc ??= new Date().toISOString();
writeFileSync(STATE, JSON.stringify(state, null, 2));

let cycles = 0;
for (;;) {
  cycles++;
  state.cycles = cycles;
  state.lastCycleUtc = new Date().toISOString();
  const newRecords = [];
  const log = readLog();
  const existing = new Set(log.map((x) => `${x.hypothesisId}|${x.entryBarFrom}`));
  const pendingCount = log.filter((x) => x.resolvedOutcome === "pending").length;

  for (const m of ACTIVE) {
    try {
      const info = await resolveAssetId(m);
      if (!info) { console.log(`[shadow] ${m.hypothesisId}: asset_id não resolvido`); continue; }
      const r = await sched.call(ENTRY_SERVER, "get_candles", { asset_id: info.asset_id, size: SIZE_S, count: 40 });
      const candles = (r.data?.candles ?? []).slice().sort((a, b) => new Date(a.from) - new Date(b.from));
      if (candles.length < 30) { console.log(`[shadow] ${m.hypothesisId}: candles insuficientes (${candles.length})`); continue; }
      const nowMs = Date.now();
      // último candle FECHADO (to <= agora)
      const closedIdx = candles.map((c) => new Date(c.to).getTime() <= nowMs).lastIndexOf(true);
      if (closedIdx < 20) continue;
      const closes = candles.map((c) => c.close);
      const dir = directionFor(m.MODEL_SPEC.setup, closes, closedIdx);

      // 1) nova previsão (apenas se o bar fechado gerou sinal e ainda não foi registrado)
      const entry = candles[closedIdx];
      if (dir && !existing.has(`${m.hypothesisId}|${entry.from}`)) {
        const payoutInfo = await refreshPayouts(m);
        newRecords.push({
          kind: "prediction",
          hypothesisId: m.hypothesisId,
          MODEL_VERSION: m.MODEL_VERSION,
          product: m.candle_source_product ?? m.product,
          execution_product: m.execution_product ?? null,
          asset_id: info.asset_id,
          assetName: info.name,
          setup: m.MODEL_SPEC.setup,
          resolution_s: SIZE_S,
          horizon_bars: HORIZON_BARS,
          operational_horizon_s: HORIZON_S,
          direction: dir,
          entryBarFrom: entry.from,
          entryBarTo: entry.to,
          entryClose: entry.close,
          loggedAtUtc: new Date().toISOString(),
          loggedBeforeExpiryMs: new Date(entry.to).getTime() + HORIZON_S * 1000 - nowMs,
          payoutAtSignal: payoutInfo.payout,
          assetOpenAtSignal: payoutInfo.is_open,
          offered_expiration_sizes_s: payoutInfo.expiration_sizes_seconds,
          expiryTargetUtc: new Date(new Date(entry.to).getTime() + HORIZON_S * 1000).toISOString(),
          resolvedOutcome: "pending",
          ordersPlaced: false,
        });
        console.log(`[shadow] + previsão ${m.hypothesisId} ${dir} @${entry.to} payout=${payoutInfo.payout ?? "?"}`);
      }

      // 2) resolução de previsões vencidas deste modelo
      const pending = log.filter((x) => x.kind === "prediction" && x.hypothesisId === m.hypothesisId && x.resolvedOutcome === "pending");
      for (const p of pending) {
        const target = new Date(p.expiryTargetUtc).getTime();
        if (nowMs < target) continue;
        const exit = candles.find((c) => new Date(c.from).getTime() === target); // timestamp EXATO
        if (!exit) {
          if (nowMs - target > 45 * 60_000) {
            newRecords.push({ ...p, resolvedOutcome: "unresolved_gap", resolvedAtUtc: new Date().toISOString(), resolutionNote: "candle de vencimento ausente (gap de mercado); não resolvido com preço aproximado" });
            state.unresolved++;
            console.log(`[shadow] ~ ${m.hypothesisId} ${p.entryBarFrom} SEM candle em ${p.expiryTargetUtc} → unresolved_gap`);
          }
          continue;
        }
        const hit = p.direction === "up" ? exit.close > p.entryClose : exit.close < p.entryClose;
        newRecords.push({ ...p, resolvedOutcome: hit ? "hit" : "miss", resolvedAtUtc: new Date().toISOString(), exitBarFrom: exit.from, exitClose: exit.close, payoutAtSignal: p.payoutAtSignal });
        state.resolved++;
        console.log(`[shadow] = ${m.hypothesisId} ${p.entryBarFrom} → ${hit ? "HIT" : "MISS"} (${p.entryClose} → ${exit.close})`);
      }
    } catch (e) {
      console.log(`[shadow] ${m.hypothesisId}: ERRO ${String(e.message).slice(0, 160)}`);
    }
  }

  if (newRecords.length) {
    appendRecords(newRecords);
    state.predictions += newRecords.filter((r) => r.kind === "prediction").length;
    // Pendentes que viraram resolução neste ciclo (a revisão é append; o estado consolida).
    for (const r of newRecords) if (r.kind === "prediction" && r.resolvedOutcome !== "pending") state.pendingResolved = (state.pendingResolved ?? 0) + 1;
  }
  writeFileSync(STATE, JSON.stringify(state, null, 2));

  const all = readLog();
  const resolved = all.filter((x) => x.resolvedOutcome === "hit" || x.resolvedOutcome === "miss");
  const hits = resolved.filter((x) => x.resolvedOutcome === "hit").length;
  console.log(`[shadow] ciclo ${cycles} · previsões ${all.length} · pendentes ${pendingCount} · resolvidas ${resolved.length} · WR ${resolved.length ? ((hits / resolved.length) * 100).toFixed(1) + "%" : "n/a"} · ${sched.report().requests} req`);

  if (MAX_CYCLES && cycles >= MAX_CYCLES) break;
  await new Promise((r) => setTimeout(r, POLL_MS));
}
console.log("[shadow] fim");
