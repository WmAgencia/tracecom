#!/usr/bin/env node
/**
 * V3 — HASH DA ESTRATEGIA (autoridade de congelamento da V3).
 *
 * Cobre TUDO que muda decisao na V3:
 *  - modulo de oportunidade/expiration policy (v3/timing, v3/expiration-discovery, v3/opportunity-engine);
 *  - contratos de medicao deterministica (v3/measurements + math reutilizada do features/asset-context);
 *  - specialists, Asset, Consensus/Final Challenge, scenario library, playbooks;
 *  - snapshot e runtime (integracao observe-only);
 *  - policy de expiracao (binary300.mjs como referencia de 300s).
 *
 * Uso:
 *   node scripts/v3-strategy-hash.mjs          # imprime o hash e a lista de arquivos
 *   node scripts/v3-strategy-hash.mjs --write  # grava strategyHash/newStrategyHash no manifesto V3
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const V3_MANIFEST_PATH = path.join(ROOT, "estrategias", "strategy-versions", "PULLBACK_4060_300_AGENTIC_V3.json");

export const V3_DECISION_FILES = Object.freeze([
  "relay/v3/timing.mjs",
  "relay/v3/expiration-grid.mjs",
  "relay/v3/expiration-discovery.mjs",
  "relay/v3/opportunity-engine.mjs",
  "relay/v3/measurements.mjs",
  "relay/v3/playbooks.mjs",
  "relay/v3/scenarios.mjs",
  "relay/v3/specialists.mjs",
  "relay/v3/asset-agent.mjs",
  "relay/v3/consensus.mjs",
  "relay/v3/decision-snapshot.mjs",
  "relay/v3/scheduler.mjs",
  "relay/v3/runtime.mjs",
  "relay/v3/feed-guard.mjs",
  "relay/v3/final-gate.mjs",
  "relay/v3/agents/schemas.mjs",
  "relay/v3/agents/prompts.mjs",
  "relay/v3/agents/llm-client.mjs",
  "relay/v3/agents/team.mjs",
  "relay/v3/agents/fact-packets.mjs",
  "relay/v3/agents/capabilities.mjs",
  "relay/llm-rate-limiter.mjs",
  "relay/intelligence/features.mjs",
  "relay/intelligence/asset-context.mjs",
  "relay/execution/binary300.mjs",
]);

export function v3Policy() {
  return Object.freeze({
    operationalExpirySeconds: 300,
    discoveryMaxTteMs: 330_000,
    targetHoldSeconds: 300,
    entryLeadMs: 2_000,
    hardCutoffTteMs: 300_000,
    candleIntervalMs: 5_000,
    contextMs: 10_800_000,
    scenarioLibraryVersion: "v3-scenario-library-v1",
    finalChallengeResults: ["APPROVE_BUY", "APPROVE_SELL", "CANCEL"],
  });
}

const normalize = (text) => String(text).replace(/\r\n/g, "\n");

export function computeV3StrategyHash({ overrides = null } = {}) {
  const policy = { ...v3Policy(), ...(overrides ?? {}) };
  const files = V3_DECISION_FILES.map((relative) => {
    const absolute = path.join(ROOT, relative);
    const content = normalize(fs.readFileSync(absolute, "utf8"));
    return { file: relative, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  });
  const payload = normalize(JSON.stringify({ solver: "tracecom-v3-strategy-hash-v1", policy, files }, null, 2));
  return { strategyHash: `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`, files, policy };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const computed = computeV3StrategyHash();
  if (process.argv.includes("--write")) {
    const manifest = JSON.parse(fs.readFileSync(V3_MANIFEST_PATH, "utf8"));
    const next = {
      ...manifest,
      strategyHash: computed.strategyHash,
      newStrategyHash: computed.strategyHash,
      decisionFiles: computed.files.map((row) => row.file),
      policy: computed.policy,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(V3_MANIFEST_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`V3_HASH_WRITTEN ${computed.strategyHash}`);
  } else {
    console.log(`V3_STRATEGY_HASH ${computed.strategyHash}`);
    for (const row of computed.files) console.log(`  ${row.file} ${row.sha256.slice(0, 16)}`);
  }
}
