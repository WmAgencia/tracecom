import fs from "node:fs";
import { execSync } from "node:child_process";
const root = "D:/tracecom/repo";
const read = (p) => fs.readFileSync(`${root}/${p}`, "utf8");
const server = read("relay/server.mjs");
const rt = read("relay/iq-multi-runtime.mjs");
const grep = (s, re) => (s.match(re) ?? []).length;

const routes = [...server.matchAll(/url\.pathname === '([^']+)'/g)].map((m) => m[1]);
console.log("API_ROUTES=" + routes.length);

const removedHandlers = [(server + rt).match(/submitAgentV3Order|submitAgentV4Order|submitAgentV2LiveOrder|submitAgentBlitzOrder/g) ?? []];
console.log("REFS_METODOS_REMOVIDOS=" + removedHandlers[0].length);

const orderCapable = [...rt.matchAll(/(requestOrder|placeTrade)\s*\(/g)].map((m) => m[1]);
console.log("RUNTIME_ORDER_CALLS=" + orderCapable.length + " [" + [...new Set(orderCapable)].join(",") + "]");
console.log("RUNTIME_ORDER_FUNCS=" + (rt.match(/async (requestOrder|submitLabPracticeOrder|submitBinaryOrder)/g) ?? []).join(" | "));

const front = fs.readdirSync(`${root}/src/http/public`).filter((f) => /\.(html|js)$/.test(f)).map((f) => ({ f, s: read(`src/http/public/${f}`) }));
const deadEndpoints = ["/api/iq/research/experiment/four-way/arm", "/api/iq/research/experiment/four-way/prepare", "/api/iq/research/experiment/four-way/stop"];
const frontDead = front.flatMap(({ f, s }) => deadEndpoints.filter((e) => s.includes(e)).map((e) => `${f}:${e}`));
console.log("FRONT_CHAMANDO_ENDPOINTS_MORTOS=" + (frontDead.length ? frontDead.join(",") : "NENHUM"));

const armRoutes = routes.filter((r) => /arm|prepare|stop/.test(r));
console.log("ROTAS_ARM_RESTANTES=" + (armRoutes.length ? armRoutes.join(",") : "NENHUMA") + " (kinds: " + [...new Set(armRoutes.map((r) => (server.match(new RegExp("url\\.pathname === '" + r.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&") + "'[\\s\\S]{0,400}?req\\.method === '(\\w+)'")) ?? [])[1]))].join(",") + ")");

const legacyInstances = ["shadowLab", "timingShadow", "scenarioShadow", "scenarioTimingIntersection", "scenarioSettlement", "agentsV4", "agentsV4Persistence", "agentsV4Settlement", "dualObserver", "dual", "solo", "fourWay", "indicator5m", "rsiReversal", "rsiVariants", "rsiAgents", "rsiAgentsV2", "rsiAgentsV3", "rsiAgentsV4", "rsiAgentsV2Live"];
const residual = legacyInstances.filter((n) => new RegExp("this\\." + n + "\\s*=\\s*new ").test(rt));
console.log("INSTANCIAS_LEGADAS_RESIDUAIS=" + (residual.length ? residual.join(",") : "NENHUMA"));
const nullSafe = legacyInstances.map((n) => ({ n, unsafe: rt.split("\n").filter((l) => new RegExp("this\\." + n + "(?![\\w.?])|this\\." + n + "\\.(?!\\?)").test(l)).length })).filter((x) => x.unsafe > 0);
console.log("REFS_NAO_NULLSAFE=" + (nullSafe.length ? nullSafe.map((x) => `${x.n}:${x.unsafe}`).join(",") : "NENHUMA"));

const run = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8", env: { ...process.env, PATH: "C:\\Users\\junin\\AppData\\Local\\Temp\\opencode\\tools\\minigit\\cmd;" + process.env.PATH } }).trim();
const before = run('git show eec8f73:relay/iq-multi-runtime.mjs').split("\n").length;
const after = rt.split("\n").length;
const serverBefore = run('git show eec8f73:relay/server.mjs').split("\n").length;
const serverAfter = server.split("\n").length;
console.log(`METRICAS_RUNTIME antes=${before} depois=${after} delta=${after - before}`);
console.log(`METRICAS_SERVER antes=${serverBefore} depois=${serverAfter} delta=${serverAfter - serverBefore}`);
const turbo = grep(rt, /60_000\)\s*\*\s*60_000|Math\.ceil\([^)]*\/\s*60_000/g);
console.log("TURBO_1M_RESIDUAL=" + turbo);
