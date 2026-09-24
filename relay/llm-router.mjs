/**
 * V3 — LLM ROUTER: pool de provider/model por role com saude real.
 *
 * - Cada (provider, model) tem: recent429, recent5xx, latency EMA, schemaSuccessRate, inflight, cooldownUntil.
 * - choose(role) retorna somente modelos aprovados e fora de cooldown.
 * - Fallback: max 1 por role (quem chama tenta a proxima entrada).
 * - Labels reais: "OpenCode Go" | "OpenCode Zen" | "Groq" (nunca generico quando a call veio do Zen Free).
 * - Nao usa modelos Go pagos (deepseek-v4-flash / deepseek-v4.1-flash / qwen3.8-max) nesta rota.
 */
export const LLM_ROUTER_VERSION = "v3-llm-router-v1";

const PROVIDER_LABELS = Object.freeze({ openCodeGo: "OpenCode Go", zen: "OpenCode Zen", groq: "Groq" });

export function providerLabel(provider) {
  return PROVIDER_LABELS[provider] ?? String(provider ?? "unknown");
}

export const FREE_ROLES_CONFIG = Object.freeze({
  RSI: [{ provider: "deterministic", model: "code" }],
  DMI_ADX: [{ provider: "deterministic", model: "code" }],
  BOLLINGER: [{ provider: "deterministic", model: "code" }],
  ATR: [{ provider: "deterministic", model: "code" }],
  PRICE_ACTION: [{ provider: "deterministic", model: "code" }],
  ASSET: [{ provider: "deterministic", model: "code" }],
  CONSENSUS_FINAL: [
    { provider: "alibaba", model: null },
    { provider: "groq", model: "openai/gpt-oss-120b" },
  ],
});

export function createLlmRouter({ roles = FREE_ROLES_CONFIG, now = () => Date.now() } = {}) {
  const state = new Map();

  const keyOf = (provider, model) => `${provider}:${model}`;

  function entry(provider, model) {
    const key = keyOf(provider, model);
    if (!state.has(key)) state.set(key, { provider, model, recent429: 0, recent5xx: 0, last429At: null, last5xxAt: null, latencyMs: null, ok: 0, fail: 0, schemaOk: 0, inflight: 0, cooldownUntil: 0 });
    return state.get(key);
  }

  for (const list of Object.values(roles)) for (const item of list) entry(item.provider, item.model);

  function isUsable(entryValue) {
    const t = now();
    if (t < entryValue.cooldownUntil) return false;
    if (entryValue.recent429 > 0 && t - Number(entryValue.last429At ?? 0) < 60_000) return false;
    if (entryValue.recent5xx > 0 && t - Number(entryValue.last5xxAt ?? 0) < 60_000) return false;
    return true;
  }

  function choose(role, { skipKey = null } = {}) {
    const list = roles[role] ?? [];
    const usable = list.filter((item) => keyOf(item.provider, item.model) !== skipKey && isUsable(entry(item.provider, item.model)));
    if (!usable.length) return null;
    const candidates = usable.map((item) => ({ ...item, entry: entry(item.provider, item.model) }));
    candidates.sort((a, b) => {
      const aScore = a.entry.schemaOk + a.entry.ok - a.entry.fail * 2;
      const bScore = b.entry.schemaOk + b.entry.ok - b.entry.fail * 2;
      return bScore - aScore;
    });
    return { provider: candidates[0].provider, model: candidates[0].model };
  }

  function report({ provider, model, httpStatus = null, status = null, schemaValid = false, latencyMs = null }) {
    const e = entry(provider, model);
    e.inflight = Math.max(0, e.inflight - 1);
    const t = now();
    if (Number(httpStatus) === 429) { e.recent429 += 1; e.last429At = t; e.cooldownUntil = t + 60_000; }
    if (Number(httpStatus) >= 500 || [401, 402, 403].includes(Number(httpStatus))) { e.recent5xx += 1; e.last5xxAt = t; e.cooldownUntil = t + 60_000; }
    if (status === "OK") { e.ok += 1; if (schemaValid) e.schemaOk += 1; if (Number.isFinite(Number(latencyMs))) e.latencyMs = e.latencyMs === null ? Number(latencyMs) : e.latencyMs * 0.7 + Number(latencyMs) * 0.3; }
    else if (status) e.fail += 1;
  }

  function stats() {
    const out = {};
    for (const e of state.values()) out[keyOf(e.provider, e.model)] = { provider: e.provider, model: e.model, label: providerLabel(e.provider), recent429: e.recent429, recent5xx: e.recent5xx, latencyMs: e.latencyMs, schemaOk: e.schemaOk, ok: e.ok, fail: e.fail, inflight: e.inflight, cooldownUntil: e.cooldownUntil };
    return out;
  }

  return { choose, report, stats, version: LLM_ROUTER_VERSION };
}