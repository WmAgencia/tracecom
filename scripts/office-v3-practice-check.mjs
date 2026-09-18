/**
 * OFFICE V3 — PRACTICE CORRELATION + CONTROLLED OPERATIONAL TEST (Task 7/8.2).
 *
 * Two phases, both PRACTICE only, ZERO REAL:
 *
 *  1. READ-ONLY CORRELATION (always): reads GET /api/iq/office (real snapshot),
 *     builds the same procedural world the page builds and asserts that every
 *     WORKING market resolves to exactly one desk/anchor (marketKey ↔ mesa ↔
 *     hit-test ↔ derived state). No writes.
 *
 *  2. CONTROLLED OPERATIONAL TEST (only with --execute): uses the EXISTING
 *     relay mechanisms — POST /api/iq/arm then a single POST /api/iq/test-order
 *     on the FIRST market that is really WORKING (broker OPEN + enabled + fresh
 *     feed). There is NO batch trigger endpoint in the relay; a batch loop is
 *     deliberately NOT invented. AUTO is never enabled, and the script always
 *     disarms at the end.
 *
 * Usage:
 *   node scripts/office-v3-practice-check.mjs [--base=https://host] [--execute]
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUBLIC = resolve(ROOT, "src/http/public/office-v3");
const OUT = resolve(ROOT, "docs/office-v3/practice-test.report.json");

const args = process.argv.slice(2);
const argValue = (name) => {
  const hit = args.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const BASE = argValue("base") || "https://tracecom.consecom.com.br";
const EXECUTE = args.includes("--execute");

const { buildWorldState, createAnchorResolver, hitTestStation } = await import(pathToFileURL(resolve(PUBLIC, "world.js")).href);
const stateModel = await import(pathToFileURL(resolve(PUBLIC, "state-model.js")).href);

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, cache: "no-store" });
  const body = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}

async function postJson(path, payload) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, body };
}

const report = {
  at: new Date().toISOString(),
  base: BASE,
  mode: "PRACTICE",
  real: false,
  phase1: null,
  phase2: null,
  missingMechanisms: [
    "Não existe endpoint de disparo em lote (um sinal por vez apenas em /api/iq/test-order).",
    "Não existe endpoint que force um ciclo de análise/consenso sob demanda (o pipeline roda sozinho no relay).",
  ],
};

/* ---------------- Phase 1: read-only correlation ---------------- */
{
  const office = await getJson("/api/iq/office");
  if (!office.ok || !office.body) {
    report.phase1 = { ok: false, error: `GET /api/iq/office HTTP ${office.status}` };
  } else {
    const json = office.body;
    const world = buildWorldState(json);
    stateModel.attachDerivedStates(world, json);
    const resolver = createAnchorResolver(world.stations);
    const working = world.stations.filter((station) => station.derived?.state === stateModel.MARKET_STATES.WORKING);
    const keys = new Set();
    const problems = [];
    for (const station of working) {
      const key = station.marketKey;
      if (keys.has(key)) problems.push(`duplicate marketKey ${key}`);
      keys.add(key);
      const anchor = resolver.anchorFor(station, station.index);
      if (!anchor || anchor.marketKey !== key) problems.push(`anchor mismatch for ${key}`);
      const hit = hitTestStation(world, anchor.desk.x + anchor.desk.w / 2, anchor.desk.y + anchor.desk.h / 2);
      if (hit !== station) problems.push(`hit-test mismatch for ${key}`);
      if (station.derived.agentsWorking !== true) problems.push(`WORKING without agents for ${key}`);
    }
    const counts = stateModel.deriveOfficeStates(json).counts;
    report.phase1 = {
      ok: problems.length === 0,
      connection: json.connection ?? null,
      counts,
      workingMarkets: working.map((station) => station.marketKey),
      problems,
    };
  }
}

/* ---------------- Phase 2: controlled operational test ---------------- */
{
  const working = report.phase1?.workingMarkets ?? [];
  const target = working[0] ?? null;
  if (!EXECUTE) {
    report.phase2 = {
      executed: false,
      reason: "dry-run (use --execute para ARM + 1 test-order no primeiro mercado WORKING)",
      target,
      mechanism: "POST /api/iq/arm + POST /api/iq/test-order (existentes)",
    };
  } else if (!target) {
    report.phase2 = { executed: false, reason: "nenhum mercado WORKING no snapshot" };
  } else {
    const arm = await postJson("/api/iq/arm", { limitBrl: 1, confirmation: "ARM_PRACTICE" });
    const order = await postJson("/api/iq/test-order", {
      marketKey: target,
      direction: "BUY",
      stake: 1,
      horizonSeconds: 60,
      idempotencyKey: `office-v3-practice-${Date.now()}`,
    });
    const after = await getJson("/api/iq/office");
    const disarm = await postJson("/api/iq/disarm", {});
    report.phase2 = {
      executed: true,
      target,
      targetWasWorking: working.includes(target),
      arm: { status: arm.status, ok: arm.ok, body: arm.body },
      order: { status: order.status, ok: order.ok, body: order.body },
      disarm: { status: disarm.status, ok: disarm.ok, body: disarm.body },
      correlation: order.body?.marketKey === target || order.body?.marketKey === undefined ? "request marketKey == target" : `MISMATCH ${order.body?.marketKey}`,
      officeAfter: after.body ? { connection: after.body.connection ?? null, mode: after.body.mode ?? null } : null,
    };
  }
}

writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\n[practice-check] report → ${OUT}`);
