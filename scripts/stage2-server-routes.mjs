import fs from "node:fs";
const SV = "D:/tracecom/repo/relay/server.mjs";
const APPLY = process.argv.includes("--apply");
const LEGACY = /^\/api\/iq\/research\/(shadow-lab|scenario|agents-v4|rsi-variants|rsi-reversal|indicator-5m|five-way|four-way|rsi-agents|dual|solo|frozen)/;
let text = fs.readFileSync(SV, "utf8");
const eol = text.includes("\r\n") ? "\r\n" : "\n";
const nl = (s) => (s.includes("\r\n") ? "\r\n" : "\n");
const rep = (from, to, label) => { const f = from.replace(/\n/g, eol); const t = to.replace(/\n/g, eol); if (!text.includes(f)) { console.log("FALHOU: " + label); return; } text = text.split(f).join(t); console.log("OK: " + label); };
rep("(wsRuntime.config.mode === 'REAL') ? await wsRuntime.submitAgentV2LiveOrder({ marketKey: String(input.marketKey ?? 'EURUSD:OTC'), direction: input.direction === 'SELL' || input.direction === 'PUT' ? 'SELL' : 'BUY', strategyId: testStrategyId, skill: testStrategyId, stake: uiStake, expectedStake: uiStake, entryMode: testEntryMode }) : ", "", "path-test sem branch REAL");
rep("horizonSeconds: 60, idempotencyKey: 'engine-path-test:'", "horizonSeconds: 300, idempotencyKey: 'engine-path-test:'", "path-test pratica 300s");

const lines = text.split(eol);
const del = new Set();
const paths = [];
lines.forEach((line, i) => {
  const m = line.match(/if\(url\.pathname === '([^']+)'/);
  if (!m || !LEGACY.test(m[1])) return;
  paths.push(m[1]);
  let depth = 0;
  let j = i;
  do {
    for (const ch of lines[j]) { if (ch === "{") depth += 1; else if (ch === "}") depth -= 1; }
    if (depth <= 0) break;
    j += 1;
  } while (j < lines.length);
  for (let k = i; k <= j; k += 1) del.add(k);
  if (j > i) console.log(`  multi-linha ${m[1]}: ${i + 1}-${j + 1}`);
});
console.log("ROTAS_LEGADAS=" + paths.length + " LINHAS=" + del.size + " [" + paths.join(" ") + "]");
if (!APPLY) { console.log("DRY_RUN"); process.exit(0); }
text = lines.filter((_, i) => !del.has(i)).join(eol);
fs.writeFileSync(SV, text);
const rest = [...text.matchAll(/\/api\/iq\/research\/(shadow-lab|scenario|agents-v4|rsi-variants|rsi-reversal|indicator-5m|five-way|four-way|rsi-agents|dual|solo|frozen)[^'"]*/g)].length;
console.log("APPLIED refs legados restantes=" + rest);
