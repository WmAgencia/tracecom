import { Binary300Timing, OPERATIONAL_EXPIRY_SECONDS, OPERATIONAL_BUCKET_MS, assertOperationalExpiry, isOperationalExpiry } from "../relay/execution/binary300.mjs";
let pass = 0; let fail = 0;
const ok = (label, condition) => { if (condition) { pass += 1; console.log(`PASS ${String(pass).padStart(2, "0")} ${label}`); } else { fail += 1; console.log(`FAIL ${label}`); } };
const throwsCode = (fn, code) => { try { fn(); return false; } catch (error) { return error?.code === code; } };

ok("fonte unica 300s", OPERATIONAL_EXPIRY_SECONDS === 300 && OPERATIONAL_BUCKET_MS === 300_000);
ok("assert aceita 300", assertOperationalExpiry(300) === 300);
ok("assert rejeita 60", throwsCode(() => assertOperationalExpiry(60), "EXPIRY_NOT_300S"));
ok("assert rejeita 180", throwsCode(() => assertOperationalExpiry(180), "EXPIRY_NOT_300S"));
ok("assert rejeita null", throwsCode(() => assertOperationalExpiry(null), "EXPIRY_NOT_300S"));
ok("isOperationalExpiry", isOperationalExpiry(300) === true && isOperationalExpiry(60) === false);

const timing = new Binary300Timing({ minLeadMs: 5_000 });
ok("sem sync serverNow lanca NO_SERVER_TIME", throwsCode(() => timing.serverNow(), "NO_SERVER_TIME"));
ok("sem sync canSubmit fail-closed", timing.canSubmit({ expirySeconds: 300 }).ok === false && timing.canSubmit({ expirySeconds: 300 }).reason === "NO_SERVER_TIME");

const base = 1_700_000_000_000;
timing.syncServerTime(base + 1_234, 500);
ok("sync offset aplicado", timing.serverNow(500) === base + 1_234 && timing.serverNow(1_500) === base + 2_234);
ok("bucketStart alinha 5min", timing.bucketStart(base + 1_234) === Math.floor(base / 300_000) * 300_000 && timing.bucketStart(base + 1_234) % 300_000 === 0);
ok("bucketEnd = start+300s", timing.bucketEnd(base + 1_234) === timing.bucketStart(base + 1_234) + 300_000);
ok("targetExpiryAt em fronteira exata pula para a proxima", timing.targetExpiryAt(300_000) === 600_000);
ok("targetExpiryAt no meio = fim do bucket corrente", timing.targetExpiryAt(300_001) === 600_000 && timing.targetExpiryAt(599_999) === 600_000);

const inside = timing.canSubmit({ expirySeconds: 300, serverTimeMs: 300_000 + 1_000 });
ok("canSubmit aberto no inicio do bucket", inside.ok === true && inside.expiryAt === 600_000 && inside.deadlineAt === 595_000);
ok("canSubmit sem modo REAL no resultado", !("mode" in inside) && !("real" in inside));
ok("canSubmit janela fechada no deadline", timing.canSubmit({ expirySeconds: 300, serverTimeMs: 595_000 }).ok === false && timing.canSubmit({ expirySeconds: 300, serverTimeMs: 595_000 }).reason === "ENTRY_WINDOW_CLOSED");
ok("canSubmit janela aberta 1ms antes do deadline", timing.canSubmit({ expirySeconds: 300, serverTimeMs: 594_999 }).ok === true);
ok("canSubmit rejeita 60s", timing.canSubmit({ expirySeconds: 60, serverTimeMs: 300_001 }).reason === "EXPIRY_NOT_300S");
ok("canSubmit rejeita 180s", timing.canSubmit({ expirySeconds: 180, serverTimeMs: 300_001 }).reason === "EXPIRY_NOT_300S");
ok("secondsToExpiry coerente", timing.secondsToExpiry(301_000) === 299 && timing.secondsToExpiry(599_000) === 1);
const snap = timing.snapshot();
ok("snapshot reflete politica", snap.expirySeconds === 300 && snap.hasServerTime === true && snap.offsetMs !== null && snap.syncCount === 1);

console.log(fail === 0 ? `BINARY300_TESTS ALL_PASS (${pass}/${pass})` : `BINARY300_TESTS FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
