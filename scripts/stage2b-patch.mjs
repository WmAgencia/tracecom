import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
const TESTS = "D:/tracecom/repo/scripts/agentic-tests.mjs";
let src = fs.readFileSync(RT, "utf8");
let tests = fs.readFileSync(TESTS, "utf8");
const cuts = [];
const apply = (file, from, to, label) => {
  const target = file === "rt" ? src : tests;
  const crlf = target.includes("\r\n");
  const f = crlf ? from.replace(/\n/g, "\r\n") : from;
  const t = crlf ? to.replace(/\n/g, "\r\n") : to;
  if (!target.includes(f)) { cuts.push("FALHOU: " + label); return; }
  const out = target.split(f).join(t);
  if (file === "rt") src = out; else tests = out;
  cuts.push("OK: " + label);
};
// 1) import do side-preference
apply("rt", 'import { pickPreferredSide, wilsonLower, SIDE_PREFERENCE_VERSION } from "./agents/side-preference.mjs";\n', "", "import side-preference");
// 2) bloco blitz do construtor (lastEntryAt/shadow/cache/run)
apply("rt", `    this.blitzLastEntryAt = new Map();
    try {
      this.blitzShadow = agenticEnabled === true ? new SafetyShadow({ pool, now: this.now, log: this.log, levels: parseSafetyLevels(agenticShadowLevels ?? "50"), entryOffsetMs: 31_500, entryToleranceMs: 500, runId: "agentic-blitz-shadow-v1", candles: (marketKey, limit) => this.candlesBatch([marketKey], limit) }) : null;
    } catch (error) { this.blitzShadow = null; this.#safe(() => this.log("BLITZ_SHADOW_INIT_FAIL", String(error?.message ?? error).slice(0, 120))); }
    this.blitzSnapshotCache = new Map();
    try {
      this.blitzRun = agenticEnabled === true ? new LabRunner({ runtime: this, pool, now: this.now, log: this.log, enabled: true, runId: "agentic-blitz-45s", stake: labStake, strategies: [AGENTIC_BLITZ_STRATEGY_ID], cap: 1000, reportRootDir: "estrategias/experiments/agentic-blitz", evaluate: (snapshot) => { this.lastEvaluationAt = this.now(); const graph = runAgentGraph(snapshot, { safetyPct: this.agentSafetyPctBlitz ?? this.agentSafetyPct, filters: this.agentFiltersBlitz }); if (this.blitzShadow) void this.blitzShadow.record(graph, snapshot).catch(() => undefined); const base = agentGraphToStrategyResult(graph); if (!base) return []; const customBlitz = this.agentCustomStrategyBlitz; if (customBlitz) { const side = customBlitz.gate({ snapshot, opinions: graph.opinions }) === true ? customBlitz.signal({ snapshot, opinions: graph.opinions }) : null; return [{ ...base, strategyId: AGENTIC_BLITZ_STRATEGY_ID, decision: side ?? "WAIT", side: side ?? null }]; } return [{ ...base, strategyId: AGENTIC_BLITZ_STRATEGY_ID, strategyVersion: "agentic-blitz-45s-v1" }]; }, entryWindowOpenMs: 32_000, entryWindowCloseMs: 31_000 }) : null;
      if (this.blitzRun) void this.blitzRun.start().catch(() => undefined);
    } catch (error) { this.blitzRun = null; this.#safe(() => this.log("BLITZ_RUN_INIT_FAIL", String(error?.message ?? error).slice(0, 120))); }
`, "", "construtor: blitzRun/blitzShadow/caches");
// 3) submit: auto-switch + branch BLITZ
apply("rt", `    // Troca automatica binario x blitz: com os dois ativos, so o lado de melhor WR (com constancia) envia.
    if (this.agentExecBinary === true && this.agentExecBlitz === true) {
      const preferred = this.sidePreference?.preferred ?? "BLITZ";
      const isBlitz = String(strategyId ?? "").toUpperCase().includes("BLITZ");
      if ((preferred === "BLITZ") !== isBlitz) return { state: "DRY_RUN", dryRun: true, dryRunReason: "AUTO_SWITCH_" + preferred, brokerOrderId: null, executionId: null, stake: Number(stake) > 0 ? Number(stake) : (Number(this.config?.defaultStake) > 0 ? Number(this.config.defaultStake) : 2), mode: "PRACTICE" };
    }
    if (String(strategyId ?? "").includes("BLITZ")) {
      if (this.armState.armed !== true) throw new IqWsError("BLITZ_NOT_ARMED");
      if (this.config.autoExecute !== true) throw new IqWsError("BLITZ_AUTO_EXECUTE_OFF");
      if (this.killSwitch.status().executionEnabled !== true) throw new IqWsError("BLITZ_KILL_SWITCH");
      const blitzStake = Number(stake) > 0 ? Number(stake) : (Number(this.config?.defaultStake) > 0 ? Number(this.config.defaultStake) : 2);
      this.blitzLastEntryAt.set(marketKey, this.now()); // cooldown por ativo em TODA tentativa (evita retentativa por segundo)
      // Mesmo caminho do binario (WS turbo 60s) - o produto Blitz nao esta disponivel de forma confiavel.
      return this.requestOrder({ marketKey, direction, stake: blitzStake, horizonSeconds: 60, decisionId: strategyTradeId, idempotencyKey: strategyTradeId, source: "lab:" + strategyId });
    }
`, "", "submit: auto-switch + branch BLITZ");
// 4) refreshSidePreference
apply("rt", `  /** Escolha automatica do lado (binario x blitz) pelo melhor WR com constancia (Wilson 95%). */
  async refreshSidePreference() {
    if (!this.pool?.query) return this.sidePreference;
    try {
      const rawQuery = (text, params) => (typeof this.pool.__rawQuery === "function" ? this.pool.__rawQuery(text, params) : this.pool.query(text, params));
      const epoch = (await rawQuery("SELECT perf_since FROM iq_perf_epoch WHERE id=1").catch(() => ({ rows: [] }))).rows?.[0]?.perf_since ?? null;
      const binaryRun = this.agentic?.runId ?? "agentic-rsi-fib-20260921";
      const blitzRun = this.blitzRun?.runId ?? "agentic-blitz-45s";
      const rows = (await rawQuery("SELECT run_id, count(*) FILTER (WHERE result='WIN')::int AS w, count(*) FILTER (WHERE result IN ('WIN','LOSS'))::int AS n FROM iq_lab_trades WHERE run_id = ANY($1::text[]) AND entry_at >= coalesce($2::timestamptz, '1970-01-01'::timestamptz) GROUP BY run_id", [[binaryRun, blitzRun], epoch])).rows ?? [];
      const statOf = (runId) => { const row = rows.find((r) => r.run_id === runId); const n = Number(row?.n ?? 0); const w = Number(row?.w ?? 0); return { n, wins: w, wr: n ? Number((100 * w / n).toFixed(1)) : null, low: wilsonLower(w, n) }; };
      const binary = statOf(binaryRun); const blitz = statOf(blitzRun);
      const preferred = pickPreferredSide(binary, blitz);
      this.sidePreference = { version: SIDE_PREFERENCE_VERSION, preferred, at: this.now(), binary, blitz };
    } catch (error) { this.#safe(() => this.log("SIDE_PREFERENCE_FAIL", String(error?.message ?? error).slice(0, 140))); }
    return this.sidePreference;
  }

`, "", "metodo refreshSidePreference");
// 5) tick blitz
apply("rt", `    if (this.blitzRun?.enabled === true) {
      let blitzRecent = 0;
      for (const t of this.blitzLastEntryAt.values()) if (now - t < 60_000) blitzRecent += 1;
      for (const ctx of this.markets.values()) {
        if (blitzRecent >= 6) break;
        if (!this.#marketTradable(ctx)) continue;
        if (now - (this.blitzLastEntryAt.get(ctx.marketKey) ?? 0) < 60_000) continue;
        const list = this.#candleList(ctx);
        if (list.length < 3) continue;
        const cacheKey = String(list[list.length - 1]?.bucketEnd ?? 0) + "|" + String(ctx.lastTickAt ?? 0);
        let entry = this.blitzSnapshotCache.get(ctx.marketKey) ?? null;
        const targetExpiryAt = Math.ceil((this.client?.serverNow?.() ?? now) / 60_000) * 60_000;
        if (!entry || entry.key !== cacheKey) {
          const snapshot = buildMarketSnapshot({ marketKey: ctx.marketKey, marketType: ctx.marketType, candles: list, now, payout: ctx.payout, targetExpiryAt, livePrice: Number.isFinite(Number(ctx.lastTick?.price)) ? Number(ctx.lastTick.price) : null });
          if (!snapshot) continue;
          entry = { key: cacheKey, snapshot };
          this.blitzSnapshotCache.set(ctx.marketKey, entry);
        }
        void this.blitzRun.observeMarket({ snapshot: entry.snapshot, marketKey: ctx.marketKey, targetExpiryAt, payout: ctx.payout });
      }
    }
`, "", "tick: bloco blitz");
// 6) agentConfigState: campo autoSwitch
apply("rt", `, autoSwitch: { preferred: this.sidePreference?.preferred ?? "BLITZ", binary: this.sidePreference?.binary ?? null, blitz: this.sidePreference?.blitz ?? null, updatedAt: this.sidePreference?.at ?? null } }`, " }", "agentConfigState: autoSwitch");
// 7) hook lastSidePrefAt (se existir)
const hookRe = /[^\n]*lastSidePrefAt[^\n]*\n/;
if (hookRe.test(src)) { src = src.replace(hookRe, ""); cuts.push("OK: hook lastSidePrefAt"); } else cuts.push("AUSENTE: hook lastSidePrefAt");
// 8) campo sidePreference no construtor (se ainda houver)
const fieldRe = /[^\n]*this\.sidePreference = \{[^\n]*\n/;
if (fieldRe.test(src)) { src = src.replace(fieldRe, ""); cuts.push("OK: campo sidePreference"); } else cuts.push("AUSENTE: campo sidePreference");
// 9) testes: import + checks 34-36
apply("tests", 'import { pickPreferredSide } from "../relay/agents/side-preference.mjs";\n', "", "tests: import side-preference");
const checks = [
  '  check(34, "troca automatica: binario com melhor WR/constancia vence", pickPreferredSide({ n: 20, wins: 12, low: 0.4 }, { n: 20, wins: 10, low: 0.3 }) === "BINARY");\n',
  '  check(35, "troca automatica: blitz com melhor WR/constancia vence", pickPreferredSide({ n: 20, wins: 10, low: 0.3 }, { n: 20, wins: 12, low: 0.4 }) === "BLITZ");\n',
  '  check(36, "troca automatica: sem amostra minima fica no blitz", pickPreferredSide({ n: 2, wins: 2, low: 0.3 }, { n: 3, wins: 1, low: 0.1 }) === "BLITZ");\n',
];
for (const c of checks) apply("tests", c, "", "tests: check " + c.slice(8, 11));
fs.writeFileSync(RT, src);
fs.writeFileSync(TESTS, tests);
console.log(cuts.join("\n"));
console.log("BLITZ_REFS_RESTANTES=" + (src.match(/blitz/gi) ?? []).length + " linhas=" + (src.match(/[^\n]*blitz[^\n]*\n/gi) ?? []).length);
