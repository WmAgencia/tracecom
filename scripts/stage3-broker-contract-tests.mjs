import { computeExpiration } from "file:///D:/tracecom/repo/relay/iqoption-ws.mjs";
import { Binary300Timing, OPERATIONAL_EXPIRY_SECONDS, nextOperationalExpiryAt } from "file:///D:/tracecom/repo/relay/execution/binary300.mjs";

let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };

const base = Math.floor(1_800_000_000_000 / 1000);
const cases = [base + 1, base + 59, base + 61, base + 149, base + 151, base + 299, base + 301, base + 899];
const rows = cases.map((sec) => ({ sec, exp: computeExpiration(sec, 5) }));
ok("300s: expiracao sempre no bucket de 5 minutos (multiplo de 300s)", rows.every((r) => r.exp.expiration % 300 === 0));
ok("300s: expiracao e a PROXIMA fronteira de 5 min do serverTime", rows.every((r) => r.exp.expiration === nextOperationalExpiryAt(r.sec * 1000) / 1000 && r.exp.expiration > r.sec));
ok("300s: contrato turbo com duracao exata de 5 minutos", rows.every((r) => r.exp.optionTypeId === 3 && r.exp.optionKind === "turbo" && r.exp.durationMinutes === 5));
ok("300s: referencia explicita do bucket (tracecom/binary300-bucket)", rows.every((r) => r.exp.reference === "tracecom/binary300-bucket"));

const oneMinute = computeExpiration(base + 10, 1);
ok("helper legado de 1 minuto nao regride (contrato por minuto)", oneMinute.durationMinutes === 1 && oneMinute.optionKind === "turbo" && oneMinute.expiration % 60 === 0);

const timing = new Binary300Timing({ now: () => base * 1000 });
timing.syncServerTime(base * 1000, base * 1000);
const target = timing.targetExpiryAt();
const window = timing.canSubmit({ expirySeconds: OPERATIONAL_EXPIRY_SECONDS });
ok("Binary300Timing e computeExpiration apontam para a MESMA expiracao (autoridade unica)", target / 1000 === computeExpiration(base, 5).expiration && window.expiryAt === target);
ok("janela de compra fecha no deadline (expiracao - 5s), fail-closed", window.deadlineAt === target - 5_000 && timing.canSubmit({ expirySeconds: 300, serverTimeMs: window.deadlineAt }).ok === false && timing.canSubmit({ expirySeconds: 300, serverTimeMs: window.deadlineAt - 1 }).ok === true);
ok("duracao operacional unica = 300s (nunca 60/180)", OPERATIONAL_EXPIRY_SECONDS === 300 && timing.canSubmit({ expirySeconds: 60 }).ok === false && timing.canSubmit({ expirySeconds: 180 }).ok === false);

console.log(fail === 0 ? `BROKER_CONTRACT_TESTS ALL_PASS (${pass}/${pass})` : `BROKER_CONTRACT_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
