/**
 * WR RECOVERY STUDY (Fase 6.3) — diagnostico causal (somente t0), curva seletiva, critic, estabilidade,
 * price chase, saude e respostas as perguntas. NAO altera regras operacionais.
 *
 * Uso: node scripts/wr-recovery-study.mjs [--data audit-g2-data.json] [--no-vault]
 * Saida: docs/audits/wr-recovery-study-YYYY-MM-DD.md + TraceCom/13 - Research/WR Recovery/*.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { extractFeatures, selectiveCurve, temporalSplit, fitLogistic, criticAudit, stabilityStudy, priceChaseStudy, performanceHealth, BREAK_EVEN_WR, ARM_IDS, evaluateShadowArms } from "../relay/trade-quality.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const DATA = argOf("--data", "audit-g2-data.json");
const NO_VAULT = args.includes("--no-vault");
const raw = JSON.parse(await fs.readFile(DATA, "utf8"));

/* ------------------------------------------------- dataset (somente t0 valido) */
const executions = new Map((raw.executions ?? []).map((row) => [row.execution_id, row]));
const trades = [];
for (const row of raw.journal ?? []) {
  const payload = row.payload ?? {};
  if (payload.snapshotSource !== "T0_DECISION_SNAPSHOT") continue;
  if (!["WIN", "LOSS", "DRAW"].includes(row.result)) continue;
  const execution = executions.get(row.trade_id) ?? null;
  const snapshotPrice = Number.isFinite(Number(payload.snapshot?.price)) && payload.snapshot?.price !== null && payload.snapshot?.price !== undefined ? Number(payload.snapshot.price) : null;
  const timingCandidatePrice = payload.entryTiming?.candidatePrice !== null && payload.entryTiming?.candidatePrice !== undefined && Number.isFinite(Number(payload.entryTiming.candidatePrice)) ? Number(payload.entryTiming.candidatePrice) : null;
  const timing = {
    ...(payload.entryTiming ?? {}),
    entryPrice: Number(execution?.entry_price ?? execution?.meta?.causal?.entry ?? null),
    candidatePrice: snapshotPrice ?? timingCandidatePrice,
  };
  const features = extractFeatures({ tradeId: row.trade_id, marketKey: row.market_key, marketType: row.market_type, direction: row.direction, settlementAt: row.settlement_at ? Date.parse(row.settlement_at) : null, stake: row.stake, payout: row.payout, result: row.result, snapshot: payload.snapshot }, timing);
  const stake = Number(row.stake) || 0;
  const payoutFraction = Number(row.payout) > 1 ? Number(row.payout) / 100 : Number(row.payout) || 0;
  const pnl = row.result === "WIN" ? stake * payoutFraction : row.result === "LOSS" ? -stake : 0;
  const normalizedPnl = stake ? Number((pnl / stake).toFixed(4)) : null;
  const directionChanges = Number(payload.entryTiming?.directionChanges ?? 0);
  Object.assign(features, { stake, result: row.result, pnl: Number(pnl.toFixed(4)), normalizedPnl, directionChanges, settlementAt: row.settlement_at ? Date.parse(row.settlement_at) : null, tradeId: row.trade_id, marketKey: row.market_key, marketType: row.market_type, direction: row.direction === "CALL" ? "BUY" : row.direction === "PUT" ? "SELL" : row.direction, payout: Number(row.payout), breakEvenWR: BREAK_EVEN_WR(row.payout) });
  features.shadowArms = evaluateShadowArms(features);
  trades.push(features);
}
trades.sort((a, b) => (a.settlementAt ?? 0) - (b.settlementAt ?? 0));

const decided = trades.filter((row) => row.result === "WIN" || row.result === "LOSS");
const overall = {
  n: trades.length, decided: decided.length, wins: decided.filter((row) => row.result === "WIN").length, losses: decided.filter((row) => row.result === "LOSS").length, draws: trades.filter((row) => row.result === "DRAW").length,
  wr: decided.length ? Number((decided.filter((row) => row.result === "WIN").length / decided.length).toFixed(4)) : null,
  normalizedPnl: Number(trades.reduce((sum, row) => sum + (row.normalizedPnl ?? 0), 0).toFixed(4)),
  expectancy: decided.length ? Number((trades.reduce((sum, row) => sum + (row.normalizedPnl ?? 0), 0) / decided.length).toFixed(4)) : null,
  avgPayout: trades.length ? Number((trades.reduce((sum, row) => sum + row.payout, 0) / trades.length).toFixed(2)) : null,
  breakEvenWR: trades.length ? BREAK_EVEN_WR(trades.reduce((sum, row) => sum + row.payout, 0) / trades.length) : null,
  candidates: (raw.audit ?? []).filter((row) => row.stage === "CANDIDATE_CREATED").length,
  cancellations: (raw.audit ?? []).filter((row) => row.stage === "CANDIDATE_CANCELLED").length,
};

/* ------------------------------------------------- win vs loss por feature */
const FEATURES = [
  ["rsi", "RSI"], ["rsiSlope", "RSI slope"], ["adx", "ADX"], ["adxSlope", "ADX slope"], ["diSpread", "DI spread"], ["diSpreadSlope", "DI spread slope"],
  ["atrRatio", "ATR ratio"], ["atrSlope", "ATR slope"], ["donchianPosition", "Donchian position"], ["distanceUpperATR", "Dist. topo (ATR)"], ["distanceLowerATR", "Dist. fundo (ATR)"],
  ["bodyRatio", "Corpo do candle"], ["upperWick", "Pavio superior"], ["lowerWick", "Pavio inferior"], ["velocity", "Velocidade"], ["acceleration", "Aceleração"], ["streak", "Streak micro"], ["traderConfidence", "Confiança trader"], ["evidenceCount", "Evidências"], ["contradictionCount", "Contraevidências"], ["directionChanges", "Mudanças de direção"], ["entryDisplacementATR", "Displacement entrada (ATR)"], ["payout", "Payout"],
];
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const std = (values) => { if (values.length < 2) return null; const m = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1)); };
const featureStudy = FEATURES.map(([key, label]) => {
  const wins = decided.filter((row) => row.result === "WIN").map((row) => row[key]).filter((value) => Number.isFinite(value));
  const losses = decided.filter((row) => row.result === "LOSS").map((row) => row[key]).filter((value) => Number.isFinite(value));
  const pooled = wins.length && losses.length ? Math.sqrt(((std(wins) ** 2) * (wins.length - 1) + (std(losses) ** 2) * (losses.length - 1)) / Math.max(1, wins.length + losses.length - 2)) : null;
  const effect = pooled ? Number(((mean(wins) - mean(losses)) / pooled).toFixed(3)) : null;
  return { key, label, winMean: mean(wins) === null ? null : Number(mean(wins).toFixed(4)), lossMean: mean(losses) === null ? null : Number(mean(losses).toFixed(4)), winN: wins.length, lossN: losses.length, effectSize: effect };
});
const ranked = featureStudy.filter((row) => row.winN >= 5 && row.lossN >= 5 && row.effectSize !== null).sort((a, b) => Math.abs(b.effectSize) - Math.abs(a.effectSize));
const topFactors = ranked.slice(0, 10);
const noPower = featureStudy.filter((row) => row.effectSize !== null && Math.abs(row.effectSize) < 0.2);

/* ------------------------------------------------- split temporal + modelo (research) */
const split = temporalSplit(trades, { discovery: 0.5, validation: 0.25, gapMs: 120_000 });
const MODEL_FEATURES = ["rsi", "adx", "atrRatio", "donchianPosition", "bodyRatio", "acceleration", "directionChanges", "entryDisplacementATR", "traderConfidence", "evidenceCount", "contradictionCount"];
const model = fitLogistic(split.discovery, MODEL_FEATURES, {});
const scoreOf = (row) => {
  if (!model.ok) return null;
  let z = model.bias;
  for (const name of MODEL_FEATURES) {
    const raw = Number(row[name]); if (!Number.isFinite(raw)) return null;
    z += ((raw - model.mean[name]) / (model.std[name] || 1)) * model.weights[name];
  }
  return Number((100 / (1 + Math.exp(-z))).toFixed(2));
};
for (const row of trades) row.qualityScore = scoreOf(row);
const validationCurve = selectiveCurve(split.validation.length >= 8 ? split.validation : trades, [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]);

/* ------------------------------------------------- bracos shadow (mesma oportunidade causal) */
const armScoreboard = ARM_IDS.map((arm) => {
  const accepted = trades.filter((row) => row.shadowArms?.[arm]?.decision === "ACCEPT" && (row.result === "WIN" || row.result === "LOSS"));
  const wins = accepted.filter((row) => row.result === "WIN").length;
  const losses = accepted.length - wins;
  const pnl = accepted.reduce((sum, row) => sum + (row.normalizedPnl ?? 0), 0);
  return { arm, accepted: accepted.length, coverage: trades.length ? Number((accepted.length / trades.length).toFixed(4)) : null, wins, losses, wr: accepted.length ? Number((wins / accepted.length).toFixed(4)) : null, normalizedPnl: Number(pnl.toFixed(4)), expectancy: accepted.length ? Number((pnl / accepted.length).toFixed(4)) : null };
});

/* ------------------------------------------------- estudos */
const confirmedLosses = decided.filter((row) => row.result === "LOSS");
const critic = criticAudit(confirmedLosses.map((row) => ({ tradeId: row.tradeId, marketKey: row.marketKey, features: row })));
const stability = stabilityStudy(trades);
const priceChase = priceChaseStudy(trades);
const health = performanceHealth({ trades, coverage: overall.candidates ? trades.length / overall.candidates : null });

const byGroup = (pick) => {
  const map = new Map();
  for (const row of trades) { const key = pick(row) ?? "UNKNOWN"; if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
  return [...map.entries()].map(([key, rows]) => { const dec = rows.filter((row) => row.result === "WIN" || row.result === "LOSS"); const wins = dec.filter((row) => row.result === "WIN").length; return { key, n: rows.length, wins, losses: dec.length - wins, wr: dec.length ? Number((wins / dec.length).toFixed(4)) : null, normalizedPnl: Number(rows.reduce((sum, row) => sum + (row.normalizedPnl ?? 0), 0).toFixed(4)) }; }).sort((a, b) => b.n - a.n);
};
const matrix = (() => {
  const map = new Map();
  for (const row of trades) { const key = `${row.setup ?? "?"} x ${row.regime ?? "?"}`; if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
  return [...map.entries()].map(([key, rows]) => { const dec = rows.filter((row) => row.result === "WIN" || row.result === "LOSS"); const wins = dec.filter((row) => row.result === "WIN").length; return { key, n: rows.length, wins, losses: dec.length - wins, wr: dec.length ? Number((wins / dec.length).toFixed(4)) : null, normalizedPnl: Number(rows.reduce((sum, row) => sum + (row.normalizedPnl ?? 0), 0).toFixed(4)) }; }).sort((a, b) => b.n - a.n);
})();

const markdown = renderStudy();
console.log(JSON.stringify({ ok: true, trades: trades.length, decided: decided.length, wr: overall.wr, normalizedPnl: overall.normalizedPnl, breakEvenWR: overall.breakEvenWR, model: model.ok ? { auc: model.auc, weights: model.weights } : model, topFactors: topFactors.map((row) => `${row.key}:${row.effectSize}`), armScoreboard, critic: critic.counts, stability, priceChase: priceChase.buckets, health, hypothesesTested: FEATURES.length }, null, 2));
await writeOutputs(markdown);

function renderStudy() {
  const lines = [];
  lines.push(`# WR RECOVERY — ESTUDO DE QUALIDADE (Fase 6.3)`);
  lines.push("");
  lines.push(`> Somente trades com T0_DECISION_SNAPSHOT + FinalEntrySnapshot. Resultado nunca usado como feature.`);
  lines.push(`> Amostra: **N=${overall.n} decididos** (${overall.wins}W/${overall.losses}L, WR ${overall.wr === null ? "—" : (overall.wr * 100).toFixed(1)}%) · PnL normalizado ${overall.normalizedPnl} · expectancy/trade ${overall.expectancy ?? "—"} · payout medio ${overall.avgPayout ?? "—"} · break-even WR ${overall.breakEvenWR ?? "—"}`);
  lines.push("");
  lines.push(`## 1. Amostra e cobertura`);
  lines.push(`- candidates: ${overall.candidates} · cancelamentos: ${overall.cancellations} · executadas com t0: ${overall.n}`);
  lines.push("");
  lines.push(`## 2. WIN vs LOSS por feature (effect size = diferenca de medias / desvio combinado)`);
  lines.push(`| feature | media WIN | media LOSS | N W/L | effect size |`);
  lines.push(`|---|---:|---:|---|---:|`);
  for (const row of featureStudy) lines.push(`| ${row.label} | ${row.winMean ?? "—"} | ${row.lossMean ?? "—"} | ${row.winN}/${row.lossN} | ${row.effectSize ?? "—"} |`);
  lines.push("");
  lines.push(`**Top 10 fatores (por |effect size|, N>=5 por lado):** ${topFactors.map((row) => `${row.label} (${row.effectSize})`).join(", ") || "INSUFICIENTE"}`);
  lines.push(`**Sem poder discriminativo (|d|<0.2):** ${noPower.map((row) => row.label).join(", ") || "—"}`);
  lines.push("");
  lines.push(`## 3. Split temporal (sem embaralhar; gap 120s)`);
  lines.push(`- discovery ${split.sizes.discovery} · validation ${split.sizes.validation} · future ${split.sizes.future}`);
  lines.push(`- modelo logistico (research) em discovery: ${model.ok ? `AUC=${model.auc} n=${model.n}` : model.reason}`);
  if (model.ok) lines.push(`- pesos: ${Object.entries(model.weights).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  lines.push("");
  lines.push(`## 4. Curva seletiva (score do modelo aplicado fora do treino)`);
  lines.push(`| threshold | accepted | coverage | W | L | WR | PnL norm |`);
  lines.push(`|---:|---:|---:|---:|---:|---:|---:|`);
  for (const row of validationCurve) lines.push(`| >=${row.threshold} | ${row.accepted} | ${row.coverage === null ? "—" : (row.coverage * 100).toFixed(1) + "%"} | ${row.wins} | ${row.losses} | ${row.wr === null ? "—" : (row.wr * 100).toFixed(1) + "%"} | ${row.normalizedPnl} |`);
  lines.push("");
  lines.push(`## 5. Bracos SHADOW (mesma oportunidade causal; regras congeladas por hipotese)`);
  lines.push(`| braco | accepted | coverage | W | L | WR | PnL norm | expectancy |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const row of armScoreboard) lines.push(`| ${row.arm} | ${row.accepted} | ${row.coverage === null ? "—" : (row.coverage * 100).toFixed(1) + "%"} | ${row.wins} | ${row.losses} | ${row.wr === null ? "—" : (row.wr * 100).toFixed(1) + "%"} | ${row.normalizedPnl} | ${row.expectancy ?? "—"} |`);
  lines.push("");
  lines.push(`## 6. Critic — losses confirmados e evidencias t0 nao capturadas`);
  lines.push(`- losses confirmados: ${critic.confirmedLosses}`);
  lines.push(`- categorias: ${Object.entries(critic.counts).map(([key, value]) => `${key}=${value}`).join(", ") || "nenhuma"}`);
  lines.push("");
  lines.push(`## 7. Direcao / estabilidade`);
  lines.push(`| bucket | N | W | L | WR | PnL norm |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const row of stability) lines.push(`| ${row.key} | ${row.n} | ${row.wins} | ${row.losses} | ${row.wr === null ? "—" : (row.wr * 100).toFixed(1) + "%"} | ${row.pnl} |`);
  lines.push("");
  lines.push(`## 8. Price chase (displacement candidato→entrada em ATR)`);
  for (const [key, value] of Object.entries(priceChase.buckets)) lines.push(`- ${key}: N=${value.n} W=${value.wins} L=${value.losses} WR=${value.wr ?? "—"} PnL=${value.pnl}`);
  lines.push("");
  lines.push(`## 9. Matriz setup x regime (top)`);
  lines.push(`| setup x regime | N | W | L | WR | PnL norm |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const row of matrix) lines.push(`| ${row.key} | ${row.n} | ${row.wins} | ${row.losses} | ${row.wr === null ? "—" : (row.wr * 100).toFixed(1) + "%"} | ${row.normalizedPnl} |`);
  lines.push("");
  lines.push(`## 10. Por mercado / direcao / regime`);
  for (const [title, groups] of [["Mercado", byGroup((row) => row.marketKey)], ["Direcao", byGroup((row) => row.direction)], ["Regime", byGroup((row) => row.regime)]]) {
    lines.push(`### ${title}`); lines.push(`| chave | N | W | L | WR | PnL norm |`); lines.push(`|---|---:|---:|---:|---:|---:|`);
    for (const row of groups) lines.push(`| ${row.key} | ${row.n} | ${row.wins} | ${row.losses} | ${row.wr === null ? "—" : (row.wr * 100).toFixed(1) + "%"} | ${row.normalizedPnl} |`);
    lines.push("");
  }
  lines.push(`## 11. Saude / monitor`);
  lines.push(`- status: ${health.status} · razoes: ${health.reasons.join(", ") || "—"} · max sequencia de losses: ${health.maxSequentialLosses}`);
  lines.push("");
  lines.push(`## 12. Respostas explicitas`);
  lines.push(`1. **Por que o WR esta baixo?** ${overall.wr !== null && overall.wr < overall.breakEvenWR ? `WR observado ${(overall.wr * 100).toFixed(1)}% abaixo do break-even ${(overall.breakEvenWR * 100).toFixed(1)}% do payout medio ${overall.avgPayout}.` : "WR proximo/acima do break-even na amostra atual."} Fatores: ${topFactors.slice(0, 3).map((row) => `${row.label} (d=${row.effectSize})`).join(", ") || "amostra insuficiente"}.`);
  lines.push(`2. **O que realmente diferencia WIN/LOSS?** ${topFactors.length ? topFactors.map((row) => row.label).join(", ") : "NAO HA EVIDENCIA SUFICIENTE (N pequeno)."}`);
  lines.push(`3. **O que NAO diferencia?** ${noPower.map((row) => row.label).join(", ") || "—"}`);
  lines.push(`4. **Estamos operando demais?** cobertura JIT = ${overall.candidates ? ((overall.n / overall.candidates) * 100).toFixed(1) : "—"}% dos candidates; ${overall.candidates ? (overall.n / overall.candidates < 0.2 ? "nao; o filtro JIT ja e restritivo" : "sim; cobertura alta") : "sem dados"}.`);
  lines.push(`5. **Qual % dos candidates deveria virar WAIT?** braços abstenham ${armScoreboard[5] ? ((1 - armScoreboard[5].coverage) * 100).toFixed(1) : "—"}% (F) — valor SHADOW, nao operacional.`);
  lines.push(`6. **O Critic permite entradas que deveria vetar?** losses confirmados com risco t0: ${critic.confirmedLosses} (categorias: ${Object.keys(critic.counts).join(", ") || "—"}).`);
  lines.push(`7. **Instabilidade direcional preve LOSS?** ${stability.find((row) => row.key === "STABLE") ? `STABLE WR=${(stability.find((row) => row.key === "STABLE").wr * 100).toFixed(1)}% vs CHANGED ${stability.filter((row) => row.key.startsWith("CHANGED")).map((row) => `${row.key} WR=${row.wr === null ? "—" : (row.wr * 100).toFixed(1)}%`).join(", ")}` : "amostra insuficiente"}.`);
  lines.push(`8. **Entramos depois do movimento?** buckets de displacement: ${Object.entries(priceChase.buckets).map(([key, value]) => `${key} WR=${value.wr ?? "—"}`).join("; ")}`);
  lines.push(`9. **Microestrutura do ultimo segundo evitaria losses?** braço E: ${JSON.stringify(armScoreboard.find((row) => row.arm === "E_MICROSTRUCTURE"))} — SHADOW.`);
  lines.push(`10. **Melhor configuracao em dados FUTUROS?** Sem dados futuros reais de braços ainda: as decisoes SHADOW passaram a ser registradas nesta fase; a cauda final desta amostra e apenas in-sample.`);
  lines.push(`11. **Existe evidencia prospectiva de ganho?** **NAO HA EVIDENCIA PROSPECTIVA AINDA.** Os bracos B–F foram congelados agora; o ganho aparente (E: WR ${armScoreboard.find((row) => row.arm === "E_MICROSTRUCTURE")?.wr ?? "—"}, F: N=${armScoreboard.find((row) => row.arm === "F_COMBINED")?.accepted ?? 0}) e in-sample e NAO deve ser promovido.`);
  lines.push("");
  lines.push(`## 13. Multiple testing`);
  lines.push(`- hipoteses testadas: ${FEATURES.length} features + ${ARM_IDS.length} bracos. Interpretar com correcao (Bonferroni ~ p*${FEATURES.length}); nenhum resultado e conclusivo com N=${overall.n}.`);
  return lines.join("\n") + "\n";
}

async function writeOutputs(markdown) {
  const day = new Date().toISOString().slice(0, 10);
  await fs.mkdir(path.join("docs", "audits"), { recursive: true });
  await fs.writeFile(path.join("docs", "audits", `wr-recovery-study-${day}.md`), markdown, "utf8");
  await fs.writeFile(path.join("docs", "audits", "wr-recovery-study-latest.md"), markdown, "utf8");
  if (NO_VAULT) return;
  let vault = process.env.SECOND_BRAIN_VAULT_PATH;
  if (!vault) { const content = await fs.readFile(".env.local", "utf8").catch(() => null); if (content) { const line = content.replace(/^\uFEFF/, "").split(/\r?\n/).find((row) => row.trim().startsWith("SECOND_BRAIN_VAULT_PATH=")); if (line) vault = line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, ""); } }
  if (!vault) return;
  const write = async (relative, body) => { const absolute = path.join(vault, relative.replaceAll("/", path.sep)); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, body, "utf8"); };
  const section = (title, body) => `---\ntitle: ${title}\ntype: entity\ncategory: RESEARCH\nstatus: CANDIDATE_KNOWLEDGE\navailableAt: ${Date.now()}\n---\n\n${body}`;
  await write(`TraceCom/13 - Research/WR Recovery/Selective Trading Study.md`, section("Selective Trading Study", markdown));
  await write(`TraceCom/13 - Research/WR Recovery/Win vs Loss Feature Study.md`, section("Win vs Loss Feature Study", `# Win vs Loss\n\n${topFactors.map((row) => `- ${row.label}: WIN ${row.winMean} vs LOSS ${row.lossMean} (d=${row.effectSize}, N ${row.winN}/${row.lossN})`).join("\n") || "INSUFICIENTE"}\n\nSem poder: ${noPower.map((row) => row.label).join(", ") || "—"}\n`));
  await write(`TraceCom/13 - Research/WR Recovery/Critic Failure Study.md`, section("Critic Failure Study", `# Critic\n\n- losses confirmados: ${critic.confirmedLosses}\n- categorias: ${Object.entries(critic.counts).map(([key, value]) => `${key}=${value}`).join(", ") || "—"}\n`));
  await write(`TraceCom/13 - Research/WR Recovery/JIT Stability Study.md`, section("JIT Stability Study", `# JIT Estabilidade\n\n${stability.map((row) => `- ${row.key}: N=${row.n} WR=${row.wr ?? "—"} PnL=${row.pnl}`).join("\n") || "INSUFICIENTE"}\n`));
  await write(`TraceCom/13 - Research/WR Recovery/Microstructure Veto Study.md`, section("Microstructure Veto Study", `# Microstructure Veto\n\n${JSON.stringify(priceChase, null, 2)}\n\nBraço E: ${JSON.stringify(armScoreboard.find((row) => row.arm === "E_MICROSTRUCTURE"))}\n`));
  const strong = ranked.filter((row) => Math.abs(row.effectSize) >= 0.8 && Math.min(row.winN, row.lossN) >= 8);
  for (const factor of strong) {
    const id = `hyp_wr_${day.replaceAll("-", "")}_${factor.key.toLowerCase()}`;
    await write(`TraceCom/14 - Hypotheses/${id}.md`, section(id, `# ${factor.label} difere entre WIN e LOSS (exploratorio)\n\n- WIN media ${factor.winMean} vs LOSS ${factor.lossMean} (d=${factor.effectSize}, N ${factor.winN}/${factor.lossN})\n- amostra total ${overall.n}; validar em dados futuros ANTES de qualquer regra.\n`));
  }
}
