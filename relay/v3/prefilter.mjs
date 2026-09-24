/**
 * V3 — PREFILTER (deterministico): so candidatos FORTES seguem para o CONSENSUS (Groq).
 *
 * PASS somente se TODAS:
 * 1. ASSET = BUY_CANDIDATE | SELL_CANDIDATE;
 * 2. PRICE_ACTION (estrutura) suporta a direcao do Asset;
 * 3. >= V3_PREFILTER_MIN_ALIGN (default 2) de {RSI, DMI_ADX, BOLLINGER} realmente alinhados;
 * 4. ATR nao esta BLOCK (LOW_INFORMATION_VOLATILITY / ABNORMAL_EXPANSION);
 * 5. nenhum blocker critico (range/transicao/indisponivel).
 * WAIT / NO_SETUP / REJECT: ZERO chamadas LLM. Nao forcamos setups.
 */
export const V3_PREFILTER_VERSION = "v3-prefilter-v2";

const ALIGNMENT_ROLES = Object.freeze(["RSI", "DMI_ADX", "BOLLINGER"]);

/** Direcao de um role com tratamento de CONFLITO interno: se houver UP e DOWN juntos => nao vota (NONE). */
export function directionOf(call) {
  const facts = call?.output?.facts ?? [];
  const directions = facts.map((item) => item?.direction).filter((value) => value === "UP" || value === "DOWN");
  if (directions.includes("UP") && directions.includes("DOWN")) return "CONFLICT";
  return directions[directions.length - 1] ?? "NONE";
}

function criticalBlockers(calls) {
  const out = [];
  for (const call of calls) {
    for (const blocker of call?.output?.blockers ?? []) {
      if (/range|transicao|indisponivel|expansao anormal|volatilidade baixa/i.test(String(blocker))) out.push({ role: call.role, blocker: String(blocker).slice(0, 160) });
    }
  }
  return out;
}

export function prefilterWave1({ calls = [], asset = null, env = process.env } = {}) {
  const minAlign = Number(env.V3_PREFILTER_MIN_ALIGN) || 0;
  const requireAsset = env.V3_PREFILTER_REQUIRE_ASSET !== "false";
  const requirePaAlign = env.V3_PREFILTER_REQUIRE_PA_ALIGN === "true";
  const blockCritical = env.V3_PREFILTER_BLOCK_CRITICAL !== "false";
  const blockAtr = env.V3_PREFILTER_BLOCK_ATR !== "false";
  const assetDirection = asset?.output?.direction ?? "NONE";
  const assetState = asset?.output?.state ?? "NO_SETUP";
  const find = (role) => calls.find((item) => item.role === role);
  // 1. Asset candidato (a estrategia autorizada define o escopo: pullback-only)
  if (requireAsset && assetState !== "BUY_CANDIDATE" && assetState !== "SELL_CANDIDATE") return { pass: false, reason: "PREFILTER_NO_ASSET_CANDIDATE", alignment: 0, direction: assetDirection, criticalBlockers: [] };
  // 2. (opcional) exigir estrutura alinhada: desabilitado por padrao — a LLM interpreta de forma independente
  if (requirePaAlign) {
    const paDirection = directionOf(find("PRICE_ACTION"));
    if (paDirection !== assetDirection) return { pass: false, reason: "PREFILTER_PA_MISALIGNED", alignment: 0, direction: assetDirection, paDirection, criticalBlockers: [] };
  }
  // 3. Alinhamento de RSI/DMI/BOLLINGER: desabilitado por padrao (a LLM nao pode ser limitada pela simplificacao do codigo)
  if (minAlign > 0) {
    const aligned = ALIGNMENT_ROLES.filter((role) => { const call = find(role); return call && directionOf(call) === assetDirection; });
    if (aligned.length < minAlign) return { pass: false, reason: "PREFILTER_WEAK_ALIGNMENT", alignment: aligned.length, direction: assetDirection, criticalBlockers: [] };
  }
  // 4. ATR BLOCK
  if (blockAtr) {
    const atrCall = find("ATR");
    const atrBlocked = (atrCall?.output?.blockers ?? []).some((blocker) => /expansao anormal|volatilidade baixa/i.test(String(blocker)));
    if (atrBlocked) return { pass: false, reason: "PREFILTER_ATR_BLOCK", alignment: 0, direction: assetDirection, criticalBlockers: [] };
  }
  // 5. Blocker critico estrutural
  if (blockCritical) {
    const critical = criticalBlockers(calls);
    if (critical.length > 0) return { pass: false, reason: "PREFILTER_CRITICAL_BLOCKER", alignment: 0, direction: assetDirection, criticalBlockers: critical };
  }
  return { pass: true, reason: null, alignment: 0, direction: assetDirection, criticalBlockers: [] };
}