import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
let src = fs.readFileSync(RT, "utf8");
const crlf = src.includes("\r\n");
const nl = crlf ? "\r\n" : "\n";
const log = [];
const rep = (from, to, label) => {
  const f = crlf ? from.replace(/\n/g, "\r\n") : from;
  const t = crlf ? to.replace(/\n/g, "\r\n") : to;
  const c = src.split(f).length - 1;
  if (!c) { log.push("FALHOU: " + label); return; }
  src = src.split(f).join(t);
  log.push(`OK(${c}): ` + label);
};
rep("scenarioShadowEnabled = true", "scenarioShadowEnabled = false", "default scenarioShadow=false");
rep("scenarioTimingIntersectionEnabled = true", "scenarioTimingIntersectionEnabled = false", "default scenarioTiming=false");
rep("agentsV4Enabled = true", "agentsV4Enabled = false", "default agentsV4=false");
rep("dualReasoningEnabled = true", "dualReasoningEnabled = false", "default dualReasoning=false");
rep("soloReasoningEnabled = true", "soloReasoningEnabled = false", "default soloReasoning=false");
rep("indicator5mEnabled = true", "indicator5mEnabled = false", "default indicator5m=false");
rep("rsiReversalEnabled = true", "rsiReversalEnabled = false", "default rsiReversal=false");
rep("rsiVariantsEnabled = true", "rsiVariantsEnabled = false", "default rsiVariants=false");
rep("rsiAgentsV3Enabled = true", "rsiAgentsV3Enabled = false", "default rsiAgentsV3=false");
rep("Math.ceil(serverNow / 60_000) * 60_000; // mesma expiracao Turbo 1m", "nextOperationalExpiryAt(serverNow);", "turbo1m com comentario");
const turboBefore = src.split("Math.ceil(serverNow / 60_000) * 60_000").length - 1;
rep("Math.ceil(serverNow / 60_000) * 60_000", "nextOperationalExpiryAt(serverNow)", `turbo1m restantes (${turboBefore})`);
if (!src.includes('from "./execution/binary300.mjs"')) {
  const anchor = 'import { EventEmitter } from "node:events";';
  const f = crlf ? anchor : anchor;
  if (src.includes(f)) {
    src = src.replace(f, f + nl + 'import { nextOperationalExpiryAt } from "./execution/binary300.mjs";');
    log.push("OK: import nextOperationalExpiryAt");
  } else {
    log.push("FALHOU: anchor de import nao encontrado");
  }
} else log.push("OK: import ja presente");
fs.writeFileSync(RT, src);
console.log(log.join("\n"));
console.log("TURBO_RESTANTE=" + (src.split("Math.ceil(serverNow / 60_000)").length - 1));
console.log("DEFAULTS_TRUE_RESTANTE=" + (src.match(/Enabled = true/g) ?? []).length);
