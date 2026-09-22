import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
const APPLY = process.argv.includes("--apply");
let s = fs.readFileSync(RT, "utf8");
const eol = s.includes("\r\n") ? "\r\n" : "\n";
const log = [];
const rep = (re, to, label) => {
  const before = s;
  s = s.replace(re, to);
  log.push((s !== before ? "OK: " : "FALHOU: ") + label);
};

rep(/import \{ runAgentGraph, agentGraphToStrategyResult, AGENTIC_STRATEGY_ID \} from "\.\/agents\/graph\.mjs";/, 'import { runAgentGraph, agentGraphToStrategyResult, AGENTIC_STRATEGY_ID } from "./agents/graph.mjs";\nimport { RuntimeIntelligence } from "./intelligence/runtime-adapter.mjs";', "import RuntimeIntelligence");

rep(/    this\.secondBrain = new SecondBrainAdapter\(\{ log: this\.log \}\);/, `    this.secondBrain = new SecondBrainAdapter({ log: this.log });
    this.assetIntelligence = null;
    this.assetIntelligenceError = null;
    try {
      this.assetIntelligence = new RuntimeIntelligence({ now: this.now, strategy: { version: "PULLBACK_4060_300_AGENTIC_V2", status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: null } });
      void this.assetIntelligence.start().then((report) => { this.#safe(() => this.log("ASSET_INTELLIGENCE_START", JSON.stringify(report ?? {}))); }).catch((error) => { this.assetIntelligenceError = String(error?.message ?? error).slice(0, 140); this.#safe(() => this.log("ASSET_INTELLIGENCE_START_FAIL", this.assetIntelligenceError)); });
    } catch (error) { this.assetIntelligence = null; this.assetIntelligenceError = String(error?.message ?? error).slice(0, 140); this.#safe(() => this.log("ASSET_INTELLIGENCE_INIT_FAIL", this.assetIntelligenceError)); }`, "instanciar RuntimeIntelligence (1 registry) + start explicito");

rep(/evaluate: \(snapshot\) => \{[\s\S]*?return \[base\]; \}, entryWindowOpenMs: 32_000,/, "evaluate: (snapshot) => { this.lastEvaluationAt = this.now(); return []; }, entryWindowOpenMs: 32_000,", "deswire grafo antigo (evaluate -> sem candidatos)");

rep(/\n(\s*)#ingestCandle\(ctx, raw, \{ receivedAt, serverTimestamp, connectionId, batch = false \}\) \{/, "\n$1#ingestCandle(ctx, raw, { receivedAt, serverTimestamp, connectionId, batch = false }) {\n$1  this.#pipeClosedCandle(ctx, raw);", "hook de feed em #ingestCandle");

rep(/  intelligenceStatus\(\) \{ return \{ version: this\.intelligence\.status\(\),/, `  #pipeClosedCandle(ctx, raw) {
    try {
      if (!this.assetIntelligence || !ctx?.marketKey || !raw || Array.isArray(raw)) return;
      const at = Number(raw.at ?? raw.time ?? raw.ts ?? raw.timestamp ?? raw.t);
      const open = Number(raw.open ?? raw.o); const high = Number(raw.high ?? raw.h);
      const low = Number(raw.low ?? raw.l); const close = Number(raw.close ?? raw.c);
      if (![at, open, high, low, close].every(Number.isFinite) || at <= 0) return;
      this.assetIntelligence.onClosedCandle(ctx.marketKey, { at: at < 1_000_000_000_000 ? at * 1000 : at, open, high, low, close });
    } catch (error) { this.#safe(() => this.log("PIPE_FEED_FAIL", String(error?.message ?? error).slice(0, 120))); }
  }

  intelligenceStatus() { return { assetIntelligence: (this.assetIntelligence?.health?.() ?? { intelligenceReady: false, degraded: true, initError: this.assetIntelligenceError ?? "NOT_INSTANTIATED", assetsTotal: 0, assetsReady: 0, assetsPartial: 0, assetsFailed: 0, lastPipelineUpdateAt: null }), version: this.intelligence.status(),`, "helper de feed + health.assetIntelligence");

fs.writeFileSync(RT, s.endsWith("\n") ? s : s + "\n");
console.log(log.join("\n"));
console.log(APPLY ? "APPLIED" : "DRY_RUN");
