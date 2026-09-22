import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
const SV = "D:/tracecom/repo/relay/server.mjs";
const FE = "D:/tracecom/repo/src/http/public/strategy-console.js";
const APPLY = process.argv.includes("--apply");
const run = (file, repls) => {
  let s = fs.readFileSync(file, "utf8");
  const log = [];
  for (const [re, to, label] of repls) {
    const before = s;
    s = s.replace(re, to);
    log.push((s !== before ? "OK: " : "FALHOU: ") + label);
  }
  if (APPLY) fs.writeFileSync(file, s);
  return log;
};
const logs = [
  ...run(RT, [
    [/this\.agentExpirySeconds = 60;/, "this.agentExpirySeconds = 300;", "agentExpirySeconds 60->300 (alinhado a observacao 300s)"],
    [/    return this\.requestOrder\(\{ marketKey, direction, stake, decisionId, idempotencyKey, source: `experiment:[^\n]*\n/, '    throw new IqWsError("EXPERIMENT_LEGACY_BROKER_PATH_DISABLED", "experiment submit legado desativado na reconstrucao");\n', "experiment: -> fail-closed"],
    [/\n      const result = await this\.requestOrder\(\{ marketKey: ctx\.marketKey, direction: action,[^\n]*\n/, '\n      throw new IqWsError("AUTO_LEGACY_BROKER_PATH_DISABLED", "auto path legado desativado na reconstrucao");\n', "auto path -> fail-closed"],
  ]),
  ...run(SV, [
    [/const input = await body\(req, 2000\); try \{ const office = wsRuntime\.office\(\);/, "const input = await body(req, 2000); try { if (wsRuntime.config.mode === 'REAL') return reply(res,403,{error:'TEST_ORDER_PRACTICE_ONLY'}); const office = wsRuntime.office();", "/test-order: guard PRACTICE-only"],
    [/horizonSeconds: Number\(input\.horizonSeconds\) \|\| 60,/, "horizonSeconds: 300,", "/test-order: 300s fixo"],
    [/armState: wsRuntime\.armState\.snapshot\(\), practiceOnly:true, brokerAutomation:'WS_ONLY_PRACTICE' \}/, "armState: wsRuntime.armState.snapshot(), practiceOnly:true, testOnly:true, excludedFromStats:true, brokerAutomation:'WS_ONLY_PRACTICE' }", "/test-order: marcadores test-only"],
  ]),
  ...run(FE, [
    [/horizonSeconds: 60/, "horizonSeconds: 300", "front test-order 60->300"],
  ]),
];
console.log(logs.join("\n"));
console.log(APPLY ? "APPLIED" : "DRY_RUN");
