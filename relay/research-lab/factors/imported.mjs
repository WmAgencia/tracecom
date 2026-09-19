/**
 * IMPORTED FACTORS — subconjunto portado do Vibe-Trading (commit e5f7195, MIT) para operadores
 * TIME-SERIES do TraceCom. Apenas formulas price-only (sem volume/fundamental/cross-sectional).
 *
 * Atribuicao:
 * - qlib158: adaptado de microsoft/qlib (pin d5379c520f66a39953bad76234a7019a72796fd0), Apache-2.0.
 * - alpha101: formulas de Kakushadze (2015), arXiv:1601.00991.
 * - gtja191: formulas do relatorio GTJA 2014 (conteudo matematico factual).
 * O codigo JS abaixo foi escrito do zero sobre `relay/research-lab/ops.mjs` (nenhum codigo Python copiado).
 */
import { last, pctChange, tsArgMax, tsArgMin, tsCorr, tsMax, tsMean, tsMin, tsQuantile, tsRank, tsResidual, tsRSquare, tsSlope, tsStd, tsSum } from "../ops.mjs";

export const IMPORTED_FACTORS_VERSION = "vibe-imported-subset-v1";
export const IMPORTED_SOURCE = Object.freeze({
  repo: "HKUDS/Vibe-Trading", commit: "e5f719567a0a8c943c08276b0295b95c572891fb", license: "MIT",
  qlib: { repo: "microsoft/qlib", commit: "d5379c520f66a39953bad76234a7019a72796fd0", license: "Apache-2.0" },
});
export const IMPORTED_NOTICE = "Subconjunto portado manualmente; formulas sao conteudo matematico factual. Ver docs/research/quant-lab/factor-lab.md e NOTICE do Vibe para atribuicao completa.";

const closes = (candles) => candles.map((candle) => candle.close);
const highs = (candles) => candles.map((candle) => candle.high);
const lows = (candles) => candles.map((candle) => candle.low);
const opens = (candles) => candles.map((candle) => candle.open);
const safeDiv = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null);
const clip = (value) => (Number.isFinite(value) ? value : null);

function qlibFactor({ id, name, category, formula, window, warmup, compute }) {
  return {
    factorId: `vibe:${id}`, name, category, nativeOrDerived: "DERIVED", imported: true,
    requiredData: ["CANDLE_5S"], formula, availableAtSemantics: "close do candle 5s fechado (janela causal)",
    source: IMPORTED_SOURCE.repo, sourceCommit: IMPORTED_SOURCE.commit, license: IMPORTED_SOURCE.qlib.license,
    upstream: "microsoft/qlib Alpha158", window, warmup, compute,
  };
}

function qlibFamily({ family, label, category, formula, windows = [5, 10, 20], warmupOf = (w) => w, compute }) {
  return windows.map((window) => qlibFactor({
    id: `qlib158_${family}${window}`, name: `${label} ${window}`, category,
    formula: formula.replaceAll("{n}", String(window)), window, warmup: warmupOf(window), compute: (ctx, candles) => compute(ctx, candles, window),
  }));
}

export const IMPORTED_FACTORS = [
  /* qlib158 — anatomia de candle (warmup 1) */
  qlibFactor({ id: "qlib158_klen", name: "KLEN (range/open)", category: "PRICE_ACTION", formula: "(high-low)/open", warmup: 1, compute: (ctx, candles) => { const c = candles.at(-1); return safeDiv(c.high - c.low, c.open); } }),
  qlibFactor({ id: "qlib158_kmid", name: "KMID (corpo/open)", category: "PRICE_ACTION", formula: "(close-open)/open", warmup: 1, compute: (ctx, candles) => { const c = candles.at(-1); return safeDiv(c.close - c.open, c.open); } }),
  qlibFactor({ id: "qlib158_kup", name: "KUP (pavio sup/open)", category: "PRICE_ACTION", formula: "(high-max(open,close))/open", warmup: 1, compute: (ctx, candles) => { const c = candles.at(-1); return safeDiv(c.high - Math.max(c.open, c.close), c.open); } }),
  qlibFactor({ id: "qlib158_klow", name: "KLOW (pavio inf/open)", category: "PRICE_ACTION", formula: "(min(open,close)-low)/open", warmup: 1, compute: (ctx, candles) => { const c = candles.at(-1); return safeDiv(Math.min(c.open, c.close) - c.low, c.open); } }),
  qlibFactor({ id: "qlib158_ksft", name: "KSFT (posicao do close)", category: "PRICE_ACTION", formula: "(2*close-high-low)/open", warmup: 1, compute: (ctx, candles) => { const c = candles.at(-1); return safeDiv(2 * c.close - c.high - c.low, c.open); } }),

  /* familias TS */
  ...qlibFamily({ family: "roc", label: "ROC", category: "MOMENTUM", formula: "close/close_{t-{n}}-1", compute: (ctx, candles, w) => clip(pctChange(closes(candles), w)) }),
  ...qlibFamily({ family: "ma", label: "MA ratio", category: "TREND", formula: "mean(close,{n})/close", compute: (ctx, candles, w) => { const ma = tsMean(closes(candles), w); return safeDiv(ma, last(closes(candles))); } }),
  ...qlibFamily({ family: "std", label: "STD ratio", category: "VOLATILITY", formula: "std(close,{n})/close", compute: (ctx, candles, w) => safeDiv(tsStd(closes(candles), w), last(closes(candles))) }),
  ...qlibFamily({ family: "beta", label: "BETA (slope/close)", category: "TREND", formula: "slope(close,{n})/close", compute: (ctx, candles, w) => safeDiv(tsSlope(closes(candles), w), last(closes(candles))) }),
  ...qlibFamily({ family: "rsqr", label: "RSQR", category: "TREND", formula: "r2(close,{n})", compute: (ctx, candles, w) => clip(tsRSquare(closes(candles), w)) }),
  ...qlibFamily({ family: "resi", label: "RESI/close", category: "TREND", formula: "residual(close,{n})/close", compute: (ctx, candles, w) => safeDiv(tsResidual(closes(candles), w), last(closes(candles))) }),
  ...qlibFamily({ family: "max", label: "MAX(high)/close", category: "STRUCTURE", formula: "max(high,{n})/close", compute: (ctx, candles, w) => safeDiv(tsMax(highs(candles), w), last(closes(candles))) }),
  ...qlibFamily({ family: "min", label: "MIN(low)/close", category: "STRUCTURE", formula: "min(low,{n})/close", compute: (ctx, candles, w) => safeDiv(tsMin(lows(candles), w), last(closes(candles))) }),
  ...qlibFamily({ family: "qtlu", label: "QTLU(0.8)/close", category: "VOLATILITY", formula: "quantile(close,0.8,{n})/close", compute: (ctx, candles, w) => safeDiv(tsQuantile(closes(candles), 0.8, w), last(closes(candles))) }),
  ...qlibFamily({ family: "qtld", label: "QTLD(0.2)/close", category: "VOLATILITY", formula: "quantile(close,0.2,{n})/close", compute: (ctx, candles, w) => safeDiv(tsQuantile(closes(candles), 0.2, w), last(closes(candles))) }),
  ...qlibFamily({ family: "rank", label: "RANK(close,{n})", category: "MOMENTUM", formula: "rank(close,{n})", compute: (ctx, candles, w) => clip(tsRank(closes(candles), w)) }),
  ...qlibFamily({ family: "rsv", label: "RSV", category: "MOMENTUM", formula: "(close-min(low,{n}))/(max(high,{n})-min(low,{n}))", compute: (ctx, candles, w) => safeDiv(last(closes(candles)) - tsMin(lows(candles), w), tsMax(highs(candles), w) - tsMin(lows(candles), w)) }),
  ...qlibFamily({ family: "imax", label: "IMAX (argmax high/{n})", category: "PRICE_ACTION", formula: "argmax(high,{n})/{n}", compute: (ctx, candles, w) => safeDiv(tsArgMax(highs(candles), w), w) }),
  ...qlibFamily({ family: "imin", label: "IMIN (argmin low/{n})", category: "PRICE_ACTION", formula: "argmin(low,{n})/{n}", compute: (ctx, candles, w) => safeDiv(tsArgMin(lows(candles), w), w) }),
  ...qlibFamily({ family: "imxd", label: "IMXD (argmax-argmin)/{n}", category: "PRICE_ACTION", formula: "(argmax(high,{n})-argmin(low,{n}))/{n}", compute: (ctx, candles, w) => safeDiv(tsArgMax(highs(candles), w) - tsArgMin(lows(candles), w), w) }),
  ...qlibFamily({ family: "cntp", label: "CNTP (fracao de altas)", category: "MOMENTUM", formula: "mean(close>ref(close,1),{n})", compute: (ctx, candles, w) => { const c = closes(candles); const ref = c.slice(-w - 1, -1); const cur = c.slice(-w); if (ref.length < w || cur.length < w) return null; let ups = 0; for (let i = 0; i < w; i += 1) if (cur[i] > ref[i]) ups += 1; return ups / w; } }),
  ...qlibFamily({ family: "cntn", label: "CNTN (fracao de baixas)", category: "MOMENTUM", formula: "mean(close<ref(close,1),{n})", compute: (ctx, candles, w) => { const c = closes(candles); const ref = c.slice(-w - 1, -1); const cur = c.slice(-w); if (ref.length < w || cur.length < w) return null; let downs = 0; for (let i = 0; i < w; i += 1) if (cur[i] < ref[i]) downs += 1; return downs / w; } }),
  ...qlibFamily({ family: "cntd", label: "CNTD (altas-baixas)", category: "MOMENTUM", formula: "CNTP-CNTN", compute: (ctx, candles, w) => { const c = closes(candles); const ref = c.slice(-w - 1, -1); const cur = c.slice(-w); if (ref.length < w || cur.length < w) return null; let ups = 0, downs = 0; for (let i = 0; i < w; i += 1) { if (cur[i] > ref[i]) ups += 1; else if (cur[i] < ref[i]) downs += 1; } return (ups - downs) / w; } }),
  ...qlibFamily({ family: "sump", label: "SUMP (soma de ganhos normalizada)", category: "MOMENTUM", formula: "sum(max(close-ref,0),{n})/sum(|close-ref|,{n})", compute: (ctx, candles, w) => momentumSum(closes(candles), w, true) }),
  ...qlibFamily({ family: "sumn", label: "SUMN (soma de perdas normalizada)", category: "MOMENTUM", formula: "sum(max(ref-close,0),{n})/sum(|close-ref|,{n})", compute: (ctx, candles, w) => momentumSum(closes(candles), w, false) }),
  ...qlibFamily({ family: "sumd", label: "SUMD (SUMP-SUMN)", category: "MOMENTUM", formula: "SUMP-SUMN", compute: (ctx, candles, w) => { const up = momentumSum(closes(candles), w, true), down = momentumSum(closes(candles), w, false); return up === null || down === null ? null : up - down; } }),

  /* alpha101 (price-only) */
  {
    factorId: "vibe:alpha101_101", name: "Kakushadze Alpha #101", category: "PRICE_ACTION", nativeOrDerived: "DERIVED", imported: true,
    requiredData: ["CANDLE_5S"], formula: "(close - open) / ((high - low) + 0.001)", availableAtSemantics: "candle 5s fechado",
    source: IMPORTED_SOURCE.repo, sourceCommit: IMPORTED_SOURCE.commit, license: "formulas (arXiv:1601.00991)",
    upstream: "alpha101", compute: (ctx, candles) => { const c = candles.at(-1); return safeDiv(c.close - c.open, (c.high - c.low) + 0.001); },
  },
  {
    factorId: "vibe:alpha101_053", name: "Kakushadze Alpha #53", category: "PRICE_ACTION", nativeOrDerived: "DERIVED", imported: true,
    requiredData: ["CANDLE_5S"], formula: "-1*delta(((close-low)-(high-close))/(close-low),9)", availableAtSemantics: "candle 5s fechado",
    source: IMPORTED_SOURCE.repo, sourceCommit: IMPORTED_SOURCE.commit, license: "formulas (arXiv:1601.00991)", upstream: "alpha101",
    compute: (ctx, candles) => {
      if (candles.length < 10) return null;
      const value = (c) => safeDiv((c.close - c.low) - (c.high - c.close), c.close - c.low);
      const current = value(candles.at(-1)), previous = value(candles.at(-10));
      return current === null || previous === null ? null : -1 * (current - previous);
    },
  },
  {
    factorId: "vibe:alpha101_054", name: "Kakushadze Alpha #54", category: "PRICE_ACTION", nativeOrDerived: "DERIVED", imported: true,
    requiredData: ["CANDLE_5S"], formula: "-1*((low-close)*(open^5))/((low-high)*(close^5))", availableAtSemantics: "candle 5s fechado",
    source: IMPORTED_SOURCE.repo, sourceCommit: IMPORTED_SOURCE.commit, license: "formulas (arXiv:1601.00991)", upstream: "alpha101",
    compute: (ctx, candles) => { const c = candles.at(-1); const den = (c.low - c.high) * c.close ** 5; return safeDiv(-1 * (c.low - c.close) * c.open ** 5, den); },
  },
  {
    factorId: "vibe:alpha101_023", name: "Kakushadze Alpha #23", category: "STRUCTURE", nativeOrDerived: "DERIVED", imported: true,
    requiredData: ["CANDLE_5S"], formula: "((sum(high,20)/20) < high) ? (-1*delta(high,2)) : 0", availableAtSemantics: "candle 5s fechado",
    source: IMPORTED_SOURCE.repo, sourceCommit: IMPORTED_SOURCE.commit, license: "formulas (arXiv:1601.00991)", upstream: "alpha101",
    compute: (ctx, candles) => {
      const avg = tsMean(highs(candles), 20);
      if (avg === null || candles.length < 3) return 0;
      const currentHigh = candles.at(-1).high;
      return avg < currentHigh ? -1 * (currentHigh - candles.at(-3).high) : 0;
    },
  },

  /* gtja191 (price-only) */
  gtja({ id: "gtja191_002", name: "GTJA #2", category: "PRICE_ACTION", formula: "-1*DELTA(((CLOSE-LOW)-(HIGH-CLOSE))/(HIGH-LOW),1)", warmup: 2, compute: (ctx, candles) => { if (candles.length < 2) return null; const val = (c) => safeDiv((c.close - c.low) - (c.high - c.close), c.high - c.low); const current = val(candles.at(-1)), previous = val(candles.at(-2)); return current === null || previous === null ? null : -1 * (current - previous); } }),
  gtja({ id: "gtja191_014", name: "GTJA #14", category: "MOMENTUM", formula: "CLOSE-DELAY(CLOSE,5)", warmup: 6, compute: (ctx, candles) => clip(candles.length < 6 ? null : candles.at(-1).close - candles.at(-6).close) }),
  gtja({ id: "gtja191_015", name: "GTJA #15", category: "PRICE_ACTION", formula: "OPEN/DELAY(CLOSE,1)-1", warmup: 2, compute: (ctx, candles) => { if (candles.length < 2) return null; return safeDiv(candles.at(-1).open, candles.at(-2).close) - 1; } }),
  gtja({ id: "gtja191_018", name: "GTJA #18", category: "MOMENTUM", formula: "CLOSE/DELAY(CLOSE,5)", warmup: 6, compute: (ctx, candles) => clip(candles.length < 6 ? null : safeDiv(candles.at(-1).close, candles.at(-6).close)) }),
  gtja({ id: "gtja191_020", name: "GTJA #20", category: "MOMENTUM", formula: "((CLOSE-DELAY(CLOSE,6))/DELAY(CLOSE,6))*100", warmup: 7, compute: (ctx, candles) => { if (candles.length < 7) return null; const base = candles.at(-7).close; return base ? ((candles.at(-1).close - base) / base) * 100 : null; } }),
  gtja({ id: "gtja191_031", name: "GTJA #31", category: "MOMENTUM", formula: "(CLOSE-MEAN(CLOSE,12))/MEAN(CLOSE,12)*100", warmup: 13, compute: (ctx, candles) => { const avg = tsMean(closes(candles), 12); return avg ? ((candles.at(-1).close - avg) / avg) * 100 : null; } }),
  gtja({ id: "gtja191_034", name: "GTJA #34", category: "TREND", formula: "MEAN(CLOSE,12)/CLOSE", warmup: 13, compute: (ctx, candles) => safeDiv(tsMean(closes(candles), 12), candles.at(-1).close) }),
  gtja({ id: "gtja191_038", name: "GTJA #38", category: "STRUCTURE", formula: "((SUM(HIGH,20)/20)<HIGH)?(-1*DELTA(HIGH,2)):0", warmup: 21, compute: (ctx, candles) => { const avg = tsMean(highs(candles), 20); if (avg === null || candles.length < 3) return 0; return avg < candles.at(-1).high ? -1 * (candles.at(-1).high - candles.at(-3).high) : 0; } }),
  gtja({ id: "gtja191_046", name: "GTJA #46", category: "TREND", formula: "(MEAN(CLOSE,3)+MEAN(CLOSE,6)+MEAN(CLOSE,12)+MEAN(CLOSE,24))/(4*CLOSE)", warmup: 25, compute: (ctx, candles) => { const c = closes(candles); const sum = [3, 6, 12, 24].map((w) => tsMean(c, w)); if (sum.some((value) => value === null)) return null; const close = c.at(-1); return safeDiv(sum.reduce((a, b) => a + b, 0), 4 * close); } }),
  gtja({ id: "gtja191_047", name: "GTJA #47", category: "MOMENTUM", formula: "SMA((TSMAX(HIGH,6)-CLOSE)/(TSMAX(HIGH,6)-TSMIN(LOW,6))*100,9,1)", warmup: 15, compute: (ctx, candles) => { const c = closes(candles); const series = []; for (let index = 6; index <= c.length; index += 1) { const slice = candles.slice(0, index); const max6 = tsMax(highs(slice), 6), min6 = tsMin(lows(slice), 6); const close = c[index - 1]; series.push(safeDiv(max6 - close, max6 - min6) * 100); } return sma(series.filter((value) => value !== null), 9); } }),
  gtja({ id: "gtja191_051", name: "GTJA #51", category: "MOMENTUM", formula: "SUM(up_move,12)/(SUM(up_move,12)+SUM(dn_move,12))", warmup: 13, compute: (ctx, candles) => { const c = closes(candles); if (c.length < 13) return null; let up = 0, down = 0; for (let index = c.length - 12; index < c.length; index += 1) { const delta = c[index] - c[index - 1]; if (delta > 0) up += delta; else down += -delta; } return up + down > 0 ? up / (up + down) : 0.5; } }),
];

function gtja({ id, name, category, formula, warmup, compute }) {
  return {
    factorId: `vibe:${id}`, name, category, nativeOrDerived: "DERIVED", imported: true,
    requiredData: ["CANDLE_5S"], formula, availableAtSemantics: "candle 5s fechado (janela causal)",
    source: IMPORTED_SOURCE.repo, sourceCommit: IMPORTED_SOURCE.commit, license: "formulas (GTJA 2014 report)",
    upstream: "gtja191", warmup, compute,
  };
}

function momentumSum(closesList, window, positive) {
  if (closesList.length < window + 1) return null;
  let part = 0, total = 0;
  for (let index = closesList.length - window; index < closesList.length; index += 1) {
    const delta = closesList[index] - closesList[index - 1];
    total += Math.abs(delta);
    if (positive ? delta > 0 : delta < 0) part += Math.abs(delta);
  }
  return total > 0 ? part / total : null;
}

function sma(values, window, weight = 1) {
  if (!Array.isArray(values) || values.length < window) return null;
  let current = values[values.length - window];
  for (let index = values.length - window + 1; index < values.length; index += 1) current = (values[index] * weight + current * (window - weight)) / window;
  return current;
}
