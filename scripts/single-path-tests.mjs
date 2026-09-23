import { SinglePath } from "../relay/execution/single-path.mjs";
import { assertParity } from "../relay/execution/account-router.mjs";
let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const WALL = 1_700_000_500_000;
const SERVER = 1_700_000_060_000;
let clock = WALL;
const path = new SinglePath({ now: () => clock });
path.timing.syncServerTime(SERVER, WALL);

const strategy = { status: "ACTIVE", executable: true, strategyHash: "sha256:abc", version: "v2" };
const decision = { marketKey: "EURUSD-OTC", side: "BUY", strategyId: "PULLBACK_4060_300", strategyVersion: "v2", strategyHash: "sha256:abc", snapshotId: "snap-1", decidedAt: WALL };
const base = { decision, strategy };
const expectedExpiry = (Math.floor(SERVER / 300_000) + 1) * 300_000;

const practice = path.evaluate({ ...base, accountMode: "PRACTICE" });
ok("PRACTICE permitido no caminho unico", practice.entry.allowed === true && practice.entry.code === "SINGLE_PATH_ALLOWED");
ok("expiracao canonica 300s no plano", practice.entry.expiryAt === expectedExpiry && practice.timing.expirySeconds === 300);
ok("conta roteada = PRACTICE", practice.entry.account === "PRACTICE" && practice.route.requiresConfirmation === false);
ok("composicao completa presente", practice.gate.allowed === true && practice.revalidation.code === "REVALIDATED" && practice.route.routed === true);

const real = path.evaluate({ ...base, accountMode: "REAL", realArmed: true, accountContext: { mode: "REAL" } });
ok("REAL armado permitido", real.entry.allowed === true && real.entry.account === "REAL" && real.route.requiresConfirmation === true);
ok("mesma inteligencia nas duas contas (paridade)", assertParity({ ...base, accountMode: "PRACTICE" }.decision, real.decision ?? decision).ok === true && practice.entry.fingerprint === real.entry.fingerprint);
ok("mesma expiracao nas duas contas", practice.entry.expiryAt === real.entry.expiryAt && practice.entry.deadlineAt === real.entry.deadlineAt);

const v2 = path.evaluate({ ...base, strategy: { status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:abc" } });
ok("V2 pendente negada (PRACTICE)", v2.entry.allowed === false && v2.entry.code === "STRATEGY_NOT_ACTIVE");
const v2real = path.evaluate({ ...base, strategy: { status: "PENDING_IMPLEMENTATION", executable: false, strategyHash: "sha256:abc" }, accountMode: "REAL", realArmed: true, accountContext: { mode: "REAL" } });
ok("V2 pendente negada (REAL)", v2real.entry.allowed === false && v2real.entry.code === "STRATEGY_NOT_ACTIVE");

ok("Turbo 60s negado", path.evaluate({ ...base, expirySeconds: 60 }).entry.code === "EXPIRY_NOT_300S");
ok("instrumento nao-BINARY negado", path.evaluate({ ...base, instrumentType: "TURBO" }).entry.code === "BINARY_ONLY");
ok("researchOnly negado", path.evaluate({ ...base, researchOnly: true }).entry.code === "RESEARCH_ONLY_DENY");
ok("kill switch negado", path.evaluate({ ...base, killSwitchEngaged: true }).entry.code === "KILL_SWITCH_ENGAGED");
ok("decisao velha negada (Revalidation)", path.evaluate({ ...base, decision: { ...decision, decidedAt: WALL - 6_000 } }).entry.code === "DECISION_STALE");
ok("lado WAIT negado", path.evaluate({ ...base, decision: { ...decision, side: "WAIT" } }).entry.code === "DECISION_SIDE_INVALID");
ok("REAL sem arm negado", path.evaluate({ ...base, accountMode: "REAL" }).entry.code === "REAL_FAIL_CLOSED");
ok("PRACTICE com contexto REAL negado", path.evaluate({ ...base, accountContext: { mode: "REAL" } }).entry.code === "ACCOUNT_CONTEXT_MISMATCH");
ok("negacao nao expoe conta", v2.entry.account === undefined && v2.route === null && v2.entry.allowed === false);

const cold = new SinglePath({ now: () => WALL });
ok("sem serverTime sincronizado nega", cold.evaluate({ ...base }).entry.code === "NO_SERVER_TIME");

console.log(fail === 0 ? `SINGLE_PATH_TESTS ALL_PASS (${pass}/${pass})` : `SINGLE_PATH_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
