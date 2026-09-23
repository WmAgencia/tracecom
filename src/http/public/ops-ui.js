/**
 * OPS UI — funcoes puras da UI operacional/observacional do TraceCom.
 * Sem dependencia de DOM: roda no browser (globalThis) e em Node (testes).
 * Nao contem logica estrategica: apenas apresentacao/filtros/agregacao.
 */
(function (root) {
  "use strict";

  const DEFAULT_RESULT_DISPLAY_MS = 15_000;
  const OPEN_STATES = ["REQUESTED", "ACKNOWLEDGED", "SUBMITTED", "PENDING_ACK", "PENDING", "UNKNOWN", "OPEN"];

  const upper = (value) => String(value ?? "").toUpperCase();

  /** Operacao estrategica da V2: strategyVersion exata, nunca testOnly/excluded. */
  const isV2Operational = (row, strategyVersion) => Boolean(row)
    && typeof strategyVersion === "string" && strategyVersion.length > 0
    && row.strategyVersion === strategyVersion
    && row.testOnly !== true
    && row.excludedFromStats !== true;

  const isOpen = (row) => OPEN_STATES.includes(upper(row?.state));

  const settledTimestamp = (row) => {
    const raw = row?.settledAt ?? row?.expirationAt ?? null;
    const ms = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(ms) ? ms : null;
  };

  const formatSigned = (value) => (Number(value) >= 0 ? "+" : "-") + Math.abs(Number(value)).toFixed(2).replace(".", ",");

  /**
   * Texto acima do card: vazio por padrao; "EM OPERACAO" aberta; PnL apenas por uma janela curta apos o settlement.
   * Nunca mostra PATH_TEST, excludedFromStats, legado, outra strategyVersion ou resultado antigo.
   */
  const cardResultFor = (row, now, { strategyVersion, displayMs = DEFAULT_RESULT_DISPLAY_MS } = {}) => {
    if (!isV2Operational(row, strategyVersion)) return { text: "", cls: "" };
    if (isOpen(row)) return { text: "EM OPERAÇÃO", cls: "op" };
    if (upper(row.state) !== "SETTLED") return { text: "", cls: "" };
    const at = settledTimestamp(row);
    if (at === null || now - at > displayMs || now < at) return { text: "", cls: "" };
    if (upper(row.brokerResult) === "DRAW") return { text: "R$ 0,00", cls: "draw" };
    return { text: formatSigned(row.profit ?? 0), cls: Number(row.profit ?? 0) >= 0 ? "win" : "loss" };
  };

  /** Botao unico: estado derivado da conta selecionada + armed real do backend. */
  const executionButtonState = ({ mode, practiceArmed, realArmed }) => {
    const selected = upper(mode) === "REAL" ? "REAL" : "PRACTICE";
    const active = selected === "REAL" ? realArmed === true : practiceArmed === true;
    return { mode: selected, active, label: active ? "DESATIVAR" : "ATIVAR" };
  };

  /** Troca de conta: desarma a conta anterior; NUNCA arma a nova automaticamente. */
  const switchDisarmPlan = ({ to, practiceArmed, realArmed }) => {
    const disarm = [];
    if (upper(to) === "REAL" && practiceArmed === true) disarm.push("PRACTICE");
    if (upper(to) === "PRACTICE" && realArmed === true) disarm.push("REAL");
    return { disarm, autoArm: false };
  };

  const round1 = (value) => Math.round(Number(value) * 10) / 10;
  const round2 = (value) => Math.round(Number(value) * 100) / 100;

  const aggregate = (rows) => {
    let n = 0; let w = 0; let l = 0; let d = 0; let pnl = 0; let stakeSum = 0; let stakeN = 0; let payoutSum = 0; let payoutN = 0;
    for (const row of rows) {
      const result = upper(row.brokerResult);
      if (result !== "WIN" && result !== "LOSS" && result !== "DRAW") continue;
      n += 1;
      if (result === "WIN") w += 1; else if (result === "LOSS") l += 1; else d += 1;
      pnl += Number(row.profit ?? 0) || 0;
      const stake = Number(row.stake); if (Number.isFinite(stake) && stake > 0) { stakeSum += stake; stakeN += 1; }
      const payout = Number(row.payout); if (Number.isFinite(payout) && payout > 0) { payoutSum += payout; payoutN += 1; }
    }
    return {
      n, w, l, d,
      wr: (w + l) > 0 ? round1((100 * w) / (w + l)) : null,
      pnl: round2(pnl),
      avgPnl: n > 0 ? round2(pnl / n) : null,
      avgStake: stakeN > 0 ? round2(stakeSum / stakeN) : null,
      avgPayout: payoutN > 0 ? round1(payoutSum / payoutN) : null,
    };
  };

  const SAMPLE_LABELS = (n) => (n < 30 ? "amostra muito pequena" : n < 100 ? "ainda limitada" : n < 300 ? "maior, mas ainda observacional" : "mais informativa");

  const directionOf = (row) => (upper(row.direction) === "CALL" || upper(row.direction) === "BUY" ? "BUY" : upper(row.direction) === "PUT" || upper(row.direction) === "SELL" ? "SELL" : "UNKNOWN");
  const hourOf = (row) => { const ms = new Date(row.requestedAt ?? row.decisionTimestamp ?? 0).getTime(); return Number.isFinite(ms) ? new Date(ms).getUTCHours() : null; };
  const featureOf = (row, path) => {
    const features = row.decisionSnapshot?.features ?? null;
    if (!features) return "(sem snapshot)";
    if (path === "regime") return String(features.regime ?? "(vazio)");
    if (path === "structure") return String(features.structure ?? "(vazio)");
    if (path === "pullback") return String(features.priceAction?.pullback?.depth ?? "(sem pullback)");
    return "(vazio)";
  };

  const groupBy = (rows, keyOf) => {
    const map = new Map();
    for (const row of rows) { const key = keyOf(row); if (key === null || key === undefined) continue; if (!map.has(key)) map.set(key, []); map.get(key).push(row); }
    return [...map.entries()].map(([key, list]) => ({ key, ...aggregate(list) }));
  };

  /**
   * Relatorio observacional da V2 (somente operacoes estrategicas reais; PATH_TEST/legado/REAL fora).
   * WR = wins / (wins + losses); DRAW separado. Nao emite juizo de edge.
   */
  const buildV2Report = (rows, { strategyVersion, strategyHash = null, now = Date.now(), resultDisplayMs = DEFAULT_RESULT_DISPLAY_MS } = {}) => {
    const all = Array.isArray(rows) ? rows : [];
    const candidates = all.filter((row) => strategyVersion && row.strategyVersion === strategyVersion);
    const operational = candidates.filter((row) => row.testOnly !== true && row.excludedFromStats !== true);
    const settled = operational.filter((row) => upper(row.state) === "SETTLED" && ["WIN", "LOSS", "DRAW"].includes(upper(row.brokerResult)));
    const byRecency = [...settled].sort((a, b) => new Date(b.requestedAt ?? 0).getTime() - new Date(a.requestedAt ?? 0).getTime());
    const rolling = (take) => aggregate(byRecency.slice(0, take));

    const issues = [];
    const seenDecisionIds = new Set();
    for (const row of candidates) {
      const decisionId = row.decisionId ?? null;
      if (decisionId) { if (seenDecisionIds.has(decisionId)) issues.push({ code: "DUPLICATE_DECISION_ID", decisionId, marketKey: row.marketKey }); seenDecisionIds.add(decisionId); }
      if (row.testOnly === true || row.excludedFromStats === true) issues.push({ code: "TEST_PATH_IN_V2_QUERY", decisionId, marketKey: row.marketKey });
      if (strategyHash && row.strategyHash && row.strategyHash !== strategyHash) issues.push({ code: "STRATEGY_HASH_MISMATCH", decisionId, marketKey: row.marketKey, detail: row.strategyHash });
      if (upper(row.accountContext) === "REAL" || upper(row.accountType) === "REAL" || upper(row.mode) === "REAL") issues.push({ code: "REAL_TRADE_DETECTED", decisionId, marketKey: row.marketKey });
      if (row.marketKey && !String(row.marketKey).endsWith(":OTC")) issues.push({ code: "INSTRUMENT_NOT_BINARY_OTC", decisionId, marketKey: row.marketKey });
      if (row.expirationAt) {
        const expSec = Math.round(new Date(row.expirationAt).getTime() / 1000);
        if (Number.isFinite(expSec) && expSec % 300 !== 0) issues.push({ code: "EXPIRY_NOT_300_BUCKET", decisionId, marketKey: row.marketKey, detail: row.expirationAt });
      }
      if (upper(row.state) === "SETTLED" && !row.decisionSnapshot) issues.push({ code: "SNAPSHOT_MISSING", decisionId, marketKey: row.marketKey });
    }

    return {
      strategyVersion: strategyVersion ?? null,
      strategyHash,
      at: now,
      sample: { ...aggregate(operational), label: SAMPLE_LABELS(settled.length), settled: settled.length, open: operational.filter(isOpen).length, excluded: all.length - operational.length },
      buy: aggregate(settled.filter((row) => directionOf(row) === "BUY")),
      sell: aggregate(settled.filter((row) => directionOf(row) === "SELL")),
      rolling: { r20: rolling(20), r50: rolling(50), r100: rolling(100) },
      byHour: groupBy(settled, hourOf).sort((a, b) => a.key - b.key),
      byAsset: groupBy(settled, (row) => row.marketKey ?? null).sort((a, b) => b.n - a.n),
      byRegime: groupBy(settled, (row) => featureOf(row, "regime")),
      byStructure: groupBy(settled, (row) => featureOf(row, "structure")),
      byPullback: groupBy(settled, (row) => featureOf(row, "pullback")),
      integrity: { ok: issues.length === 0, count: issues.length, issues: issues.slice(0, 20) },
      resultDisplayMs,
    };
  };

  root.OpsUI = {
    DEFAULT_RESULT_DISPLAY_MS,
    OPEN_STATES,
    isV2Operational,
    isOpen,
    cardResultFor,
    executionButtonState,
    switchDisarmPlan,
    buildV2Report,
    sampleLabel: SAMPLE_LABELS,
    formatSigned,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
