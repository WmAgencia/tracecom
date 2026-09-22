import fs from "node:fs";
const RT = "D:/tracecom/repo/relay/iq-multi-runtime.mjs";
let src = fs.readFileSync(RT, "utf8");
const log = [];
const cut = (from, to, label) => {
  if (!src.includes(from)) { log.push("FALHOU: " + label); return; }
  src = src.split(from).join(to);
  log.push("OK: " + label);
};
// remove instanciacoes lab + labS04 (referencias restantes sao null-safe)
const labRe = /    try \{ this\.lab = new LabRunner\(\{[\s\S]*?\r?\n/;
const s04Re = /    try \{ this\.labS04 = new LabRunner\(\{[\s\S]*?\r?\n/;
if (labRe.test(src)) { src = src.replace(labRe, ""); log.push("OK: instanciacao lab"); } else log.push("FALHOU: instanciacao lab");
if (s04Re.test(src)) { src = src.replace(s04Re, ""); log.push("OK: instanciacao labS04"); } else log.push("FALHOU: instanciacao labS04");
// params do construtor: lab/labS04
cut("labEnabled = process.env.LAB6_ENABLED === \"true\", labRunId = null, labStake = null, labS04Enabled = process.env.S04_50_ENABLED === \"true\", labS04RunId = process.env.S04_50_RUN_ID ?? null, ", "", "params lab/labS04");
fs.writeFileSync(RT, src);
console.log(log.join("\n"));
// scan de null-safety dos demais runners legados
const names = ["consensus", "shadowLab", "timingShadow", "fourWay", "agentsV4", "dualReasoning", "soloReasoning", "indicator5m", "rsiAgentsV2", "rsiAgentsV3", "rsiAgentsV4", "rsiAgentsV2Live", "iqMcp", "scenarioShadow", "scenarioTiming", "frozen", "experiment"];
for (const n of names) {
  const uses = [...src.matchAll(new RegExp("this\\." + n + "(?!\\w)", "g"))];
  const unsafe = [...src.matchAll(new RegExp("this\\." + n + "(?!\\w)(?!\\?\\.)(?!\\s*=[^=])", "g"))];
  // unsafe = uso sem optional chain e sem atribuicao
  const bad = src.split("\n").filter((l) => new RegExp("this\\." + n + "(?!\\w)").test(l) && !new RegExp("this\\." + n + "\\?\\.|this\\." + n + "\\s*=").test(l));
  if (uses.length) console.log(n.padEnd(16) + " usos=" + uses.length + " linhas_sem_?\\.=" + bad.length + (bad.length ? " -> " + bad.slice(0, 2).map((l) => l.trim().slice(0, 90)).join(" | ") : ""));
}
