import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
const SV = "D:/tracecom/repo/relay/server.mjs";
const APPLY = process.argv.includes("--apply");
let src = fs.readFileSync(RT, "utf8");
let srv = fs.readFileSync(SV, "utf8");
const eol = src.includes("\r\n") ? "\r\n" : "\n";
const nl = (s) => (s.includes("\r\n") ? "\r\n" : "\n");
const rep = (target, from, to, label, must = true) => {
  const f = from.replace(/\n/g, nl(target));
  const t = to.replace(/\n/g, nl(target));
  if (!target.includes(f)) { console.log("FALHOU: " + label); return target; }
  console.log("OK: " + label);
  return target.split(f).join(t);
};

src = rep(src, '      return this.submitAgentV2LiveOrder({ marketKey, direction: direction === "SELL" ? "SELL" : "BUY", strategyId, skill: strategyId, stake: amount, expectedStake: amount, entryMode: "AGENTIC_REAL", idempotencyKey: strategyTradeId });', '      throw new IqWsError("REAL_LEGACY_V2_PATH_DISABLED", "REAL fail-closed: caminho legado V2Live removido na reconstrucao");', "caller REAL do lab -> fail-closed");
srv = rep(srv, "(wsRuntime.config.mode === 'REAL') ? await wsRuntime.submitAgentV2LiveOrder({ marketKey: String(input.marketKey ?? 'EURUSD:OTC'), direction: input.direction === 'SELL' || input.direction === 'PUT' ? 'SELL' : 'BUY', strategyId: testStrategyId, skill: testStrategyId, stake: uiStake, expectedStake: uiStake, entryMode: testEntryMode }) : ", "", "path-test sem branch REAL");
srv = rep(srv, "horizonSeconds: 60, idempotencyKey: 'engine-path-test:'", "horizonSeconds: 300, idempotencyKey: 'engine-path-test:'", "path-test pratica 300s");

let lines = src.split(eol);
const sigRe = /^  (async )?[a-zA-Z#][\w#]*\s*\(/;
const findRange = (name) => {
  const start = lines.findIndex((l) => new RegExp("^  async " + name + "\\(").test(l));
  if (start < 0) return null;
  let c = start - 1;
  while (c >= 0 && /^\s*(\/\*\*|\*|\*\/)/.test(lines[c])) c -= 1;
  let j = start + 1;
  while (j < lines.length && !sigRe.test(lines[j])) j += 1;
  let t = j - 1;
  while (t > start && (lines[t].trim() === "" || /^\s*(\/\*\*|\*|\*\/)/.test(lines[t]))) t -= 1;
  return { from: c + 1, to: t, start, end: j };
};
const r1 = findRange("submitAgentV2LiveOrder");
const r2 = findRange("submitAgentBlitzOrder");
console.log("RANGE V2Live=" + JSON.stringify(r1 ? { from: r1.from + 1, to: r1.to + 1, linhas: r1.to - r1.from + 1 } : null));
console.log("RANGE Blitz=" + JSON.stringify(r2 ? { from: r2.from + 1, to: r2.to + 1, linhas: r2.to - r2.from + 1 } : null));
if (r1) console.log("  V2Live inicio: " + (lines[r1.start] ?? "").trim().slice(0, 80) + " | fim: " + (lines[r1.to] ?? "").trim().slice(0, 80));
if (r2) console.log("  Blitz inicio: " + (lines[r2.start] ?? "").trim().slice(0, 80) + " | fim: " + (lines[r2.to] ?? "").trim().slice(0, 80));
if (!APPLY) { console.log("DRY_RUN"); process.exit(0); }
if (!r1 || !r2) { console.log("ABORTADO: range nao encontrado"); process.exit(1); }
const del = new Set();
for (let k = r1.from; k <= r1.to; k += 1) del.add(k);
for (let k = r2.from; k <= r2.to; k += 1) del.add(k);
src = lines.filter((_, i) => !del.has(i)).join(eol);
fs.writeFileSync(RT, src); fs.writeFileSync(SV, srv);
const restV2 = (src.match(/submitAgentV2LiveOrder/g) ?? []).length;
const restBlitz = (src.match(/submitAgentBlitzOrder/g) ?? []).length;
const restPlace = (src.match(/placeTrade/g) ?? []).length;
console.log(`APPLIED deletions=${del.size} refsV2Live=${restV2} refsBlitz=${restBlitz} placeTrade=${restPlace}`);
console.log("srv refs submitAgentV2LiveOrder=" + (srv.match(/submitAgentV2LiveOrder/g) ?? []).length + " submitAgentBlitzOrder=" + (srv.match(/submitAgentBlitzOrder/g) ?? []).length);
