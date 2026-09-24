/**
 * V3 — PREFILTER (deterministico): so candidatos fortes seguem para o CONSENSUS (Groq).
 *
 * Regras (configuraveis por env):
 * - V3_PREFILTER_MIN_ALIGN (default 2): minimo de especialistas direcionais alinhados com o Asset.
 * - V3_PREFILTER_REQUIRE_ASSET (default true): Asset precisa estar em BUY_CANDIDATE/SELL_CANDIDATE.
 * - V3_PREFILTER_BLOCK_CRITICAL (default true): qualquer blocker de ATR/volatilidade ou PA range reprova.
 * Reprovar NAO chama LLM: result = CANCEL com reason PREFILTER_REJECTED (fail-closed, custo zero).
 */
export const V3_PREFILTER_VERSION = "v3-prefilter-v1";

const DIRECTIONAL_ROLES = Object.freeze(["RSI", "DMI_ADX", "BOLLINGER", "PRICE_ACTION"]);

function directionOf(call) {
  const facts = call?.output?.facts ?? [];
  const directional = facts.find((item) => item && (item.direction === "UP" || item.direction === "DOWN"));
  return directional?.direction ?? "NONE";
}

function criticalBlockers(calls) {
  const out = [];
  for (const call of calls) {
    for (const blocker of call?.output?.blockers ?? []) {
      if (/range|transicao|indisponivel/i.test(String(blocker))) out.push({ role: call.role, blocker: String(blocker).slice(0, 160) });
    }
  }
  return out;
}

export function prefilterWave1({ calls = [], asset = null, env = process.env } = {}) {
  const minAlign = Number(env.V3_PREFILTER_MIN_ALIGN) || 2;
  const requireAsset = env.V3_PREFILTER_REQUIRE_ASSET !== "false";
  const blockCritical = env.V3_PREFILTER_BLOCK_CRITICAL !== "false";
  const assetDirection = asset?.output?.direction ?? "NONE";
  const assetState = asset?.output?.state ?? "NO_SETUP";
  const aligned = DIRECTIONAL_ROLES.filter((role) => { const call = calls.find((item) => item.role === role); return call && directionOf(call) !== "NONE" && directionOf(call) === assetDirection; });
  const critical = criticalBlockers(calls);
  if (requireAsset && (assetState !== "BUY_CANDIDATE" && assetState !== "SELL_CANDIDATE")) return { pass: false, reason: "PREFILTER_NO_ASSET_CANDIDATE", alignment: aligned.length, direction: assetDirection, criticalBlockers: critical };
  if (aligned.length < minAlign) return { pass: false, reason: "PREFILTER_WEAK_ALIGNMENT", alignment: aligned.length, direction: assetDirection, criticalBlockers: critical };
  if (blockCritical && critical.length > 0) return { pass: false, reason: "PREFILTER_CRITICAL_BLOCKER", alignment: aligned.length, direction: assetDirection, criticalBlockers: critical };
  return { pass: true, reason: null, alignment: aligned.length, direction: assetDirection, criticalBlockers: critical };
}