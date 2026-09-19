/**
 * SCENARIO ENGINE V3 — testes determinísticos do motor puro (shadow/observacional).
 *
 * Cobre: os 8 playbooks, concorrentes (pullback x reversal, breakout x failed, range x breakout,
 * continuation x transition), RANGE com prova de bordas, compressão sem direção, transição = WAIT,
 * indicadores isolados (RSI/ADX/ATR nunca definem direção sozinhos), divergência Trader/Critic,
 * mudança de cenário candidate→final, cancelamento de tese, zero leakage (settlement/post/futuro),
 * isolamento NORMAL x OTC (sem volume/order book sintéticos), disponibilidade explícita e
 * determinismo byte a byte. NÃO envia ordens, NÃO altera produção, NÃO ajusta nada por WIN/LOSS.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const engine = await import("../../relay/scenario-engine.mjs");
const {
  analyzeScenario, extractContext, classifyRegime, classifyScenario, evaluatePlaybook,
  SCENARIO_ENGINE_VERSION, REGIMES, SCENARIOS, PLAYBOOK_DEFINITIONS,
} = engine as unknown as Record<string, any>;

type AnyRecord = Record<string, any>;
type Candle = { open: number; high: number; low: number; close: number };

const MODULE_SOURCE: string = readFileSync("relay/scenario-engine.mjs", "utf8");
const MODULE_CODE: string = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function features(over: AnyRecord = {}): AnyRecord {
  return {
    structureLabel: null, rsi14: null, adx14: null, plusDI: null, minusDI: null,
    velocity: null, acceleration: null, atr: 0.001, atrRatio: 1,
    donchianPosition: null, channelHigh: null, channelLow: null,
    distanceToUpperATR: null, distanceToLowerATR: null,
    bodyRatio: null, upperWick: null, lowerWick: null,
    fresh: true, tickAgeMs: 500, ...over,
  };
}

function input(over: AnyRecord = {}): AnyRecord {
  return { marketKey: "EURUSD:OTC", marketType: "OTC", features: features(), snapshot: { events: {} }, ...over };
}

function run(over: AnyRecord = {}): AnyRecord {
  return analyzeScenario(input(over));
}

function candlesFromCloses(closes: number[], wick = 0.0002): Candle[] {
  return closes.map((close, index) => {
    const previous = index === 0 ? close : (closes[index - 1] as number);
    return { open: previous, high: Math.max(previous, close) + wick, low: Math.min(previous, close) - wick, close };
  });
}

const RANGE_WAVE = [1.095, 1.097, 1.099, 1.101, 1.103, 1.105, 1.103, 1.101, 1.099, 1.097];

function rangeCandles(kind: "BASE" | "TOP" | "MID"): Candle[] {
  const closes: number[] = [];
  for (let index = 0; index < 40; index += 1) closes.push(RANGE_WAVE[index % RANGE_WAVE.length] as number);
  if (kind === "BASE") {
    closes[39] = 1.0955;
    const list = candlesFromCloses(closes);
    list[39] = { open: 1.0957, high: 1.0961, low: 1.0945, close: 1.0961 };
    return list;
  }
  if (kind === "TOP") {
    closes[39] = 1.1045;
    const list = candlesFromCloses(closes);
    list[39] = { open: 1.1043, high: 1.1055, low: 1.1041, close: 1.1042 };
    return list;
  }
  closes[39] = 1.1;
  const list = candlesFromCloses(closes);
  list[39] = { open: 1.0999, high: 1.1004, low: 1.0996, close: 1.1 };
  return list;
}

const bullishTrend = () => features({
  structureLabel: "UP", adx14: 30, plusDI: 28, minusDI: 12, velocity: 0.0004, acceleration: 0.0001,
  donchianPosition: 0.72, bodyRatio: 0.62, upperWick: 0.15, lowerWick: 0.23, rsi14: 62,
});
const bearishTrend = () => features({
  structureLabel: "DOWN", adx14: 30, plusDI: 12, minusDI: 28, velocity: -0.0004, acceleration: -0.0001,
  donchianPosition: 0.28, bodyRatio: 0.62, upperWick: 0.23, lowerWick: 0.15, rsi14: 38,
});
const pullbackBull = () => input({
  features: features({ structureLabel: "UP", adx14: 25, plusDI: 24, minusDI: 14, velocity: -0.0001, acceleration: -0.00001, donchianPosition: 0.45, bodyRatio: 0.4, rsi14: 48 }),
  snapshot: { events: { pullbackUp: true }, multiTimeframe: { higher: "UP", primary: "UP" } },
});
const pullbackBear = () => input({
  features: features({ structureLabel: "DOWN", adx14: 25, plusDI: 14, minusDI: 24, velocity: 0.0001, acceleration: 0.00001, donchianPosition: 0.55, bodyRatio: 0.4, rsi14: 52 }),
  snapshot: { events: { pullbackDown: true }, multiTimeframe: { higher: "DOWN", primary: "DOWN" } },
});
const breakoutBull = () => input({
  features: features({ structureLabel: "RANGE", donchianPosition: 0.98, distanceToUpperATR: -0.4, atrRatio: 1.5, bodyRatio: 0.7, upperWick: 0.05, velocity: 0.0004, adx14: 24, plusDI: 26, minusDI: 12 }),
  snapshot: { events: { breakoutUp: true } },
  ticks: [1.1, 1.1005, 1.101, 1.1015, 1.102, 1.1025, 1.103],
});
const failedBreakoutUp = () => input({
  features: features({ structureLabel: "RANGE", donchianPosition: 0.78, distanceToUpperATR: 0.2, atrRatio: 1.1, bodyRatio: 0.3, upperWick: 0.6, velocity: -0.0002, adx14: 18, plusDI: 15, minusDI: 15, rsi14: 58, rsiPrev: 62 }),
  snapshot: { events: { failedBreakoutUp: true, rejectionUp: true } },
  ticks: [1.1, 1.0998, 1.0995, 1.0993, 1.0992],
});

describe("1. contrato congelado, pureza e determinismo", () => {
  it("versao SCENARIO_ENGINE_V3 e enums congelados com os 7 regimes e 8 cenarios", () => {
    expect(SCENARIO_ENGINE_VERSION).toBe("SCENARIO_ENGINE_V3");
    expect(Object.keys(REGIMES)).toEqual(["TREND_UP", "TREND_DOWN", "RANGE", "COMPRESSION", "EXPANSION", "TRANSITION", "UNCERTAIN"]);
    expect(Object.keys(SCENARIOS)).toEqual(["TREND_CONTINUATION", "TREND_PULLBACK", "BREAKOUT", "FAILED_BREAKOUT", "RANGE_MEAN_REVERSION", "REVERSAL", "COMPRESSION_EXPANSION", "TRANSITION_NO_TRADE"]);
    expect(Object.isFrozen(REGIMES)).toBe(true);
    expect(Object.isFrozen(SCENARIOS)).toBe(true);
  });

  it("exporta as 5 funcoes do contrato e nao importa nem toca IO/relogio/random", () => {
    for (const fn of [extractContext, classifyRegime, classifyScenario, evaluatePlaybook, analyzeScenario]) expect(typeof fn).toBe("function");
    expect(MODULE_CODE).not.toMatch(/Date\.now|Math\.random|fetch\(|require\(|node:fs|node:http|process\.env/);
    expect(MODULE_CODE).not.toMatch(/^\s*import\s/m);
    expect(MODULE_CODE).not.toMatch(/placeOrder|requestOrder|buyOption|executionGate|stake/i);
  });

  it("mesmo input produz saida byte a byte identica (motor e contextos)", () => {
    const build = () => input({ features: bullishTrend(), snapshot: { events: {} }, ticks: [1.1, 1.1001, 1.1002, 1.1001, 1.1003] });
    expect(JSON.stringify(analyzeScenario(build()))).toBe(JSON.stringify(analyzeScenario(build())));
    expect(JSON.stringify(extractContext(build()))).toBe(JSON.stringify(extractContext(build())));
    expect(JSON.stringify(classifyRegime(extractContext(build())))).toBe(JSON.stringify(classifyRegime(extractContext(build()))));
  });

  it("extractContext entrega o contrato: multiTimeframe/trend/volatility/structure/location/SR/candle/tick/velocity/acceleration/feedQuality/unavailable", () => {
    const context = extractContext(input({ features: bullishTrend() }));
    for (const key of ["multiTimeframe", "trendMajor", "trendRecent", "volatility", "structure", "location", "supportResistance", "candleBehavior", "tickBehavior", "velocity", "acceleration", "feedQuality"]) {
      expect(context).toHaveProperty(key);
    }
    expect(Array.isArray(context.unavailable)).toBe(true);
    expect(context.unavailable.every((entry: unknown) => typeof entry === "string")).toBe(true);
  });

  it("classifyRegime retorna o shape congelado com confianca LOW|MEDIUM|HIGH", () => {
    const regime = classifyRegime(extractContext(input({ features: bullishTrend() })));
    expect(Object.keys(regime)).toEqual(["regime", "subRegime", "evidenceFor", "evidenceAgainst", "confidence"]);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(regime.confidence);
    expect(Array.isArray(regime.evidenceFor)).toBe(true);
    expect(Array.isArray(regime.evidenceAgainst)).toBe(true);
  });

  it("classifyScenario retorna o shape congelado com competitorEvidence e winnerRationale", () => {
    const context = extractContext(input({ features: bullishTrend() }));
    const regime = classifyRegime(context);
    const scenario = classifyScenario(context, regime);
    expect(Object.keys(scenario)).toEqual(["primaryScenario", "secondaryScenario", "primaryEvidenceFor", "primaryEvidenceAgainst", "competitorEvidence", "winnerRationale", "ambiguous"]);
    expect(typeof scenario.ambiguous).toBe("boolean");
    expect(typeof scenario.winnerRationale).toBe("string");
    expect(Array.isArray(scenario.competitorEvidence)).toBe(true);
  });

  it("evaluatePlaybook desconhecido e conservador (WAIT, sem entrada)", () => {
    const result = evaluatePlaybook("PB_QUE_NAO_EXISTE", extractContext(input({ features: bullishTrend() })), {});
    expect(result.applicable).toBe(false);
    expect(result.action).toBe("WAIT");
    expect(result.entryEligible).toBe(false);
    expect(result.invalidations).toContain("UNKNOWN_PLAYBOOK");
  });

  it("analyzeScenario entrega o contrato completo consumido pelo shadow", () => {
    const analysis = run({ features: bullishTrend() });
    for (const key of ["scenarioEngineVersion", "marketRegime", "primaryScenario", "secondaryScenario", "competing", "scenarioEvidenceFor", "scenarioEvidenceAgainst", "structureState", "locationState", "trendState", "momentumState", "volatilityState", "microstructureState", "triggerState", "invalidations", "action", "confidence", "featuresUsed", "unavailable", "ambiguous"]) {
      expect(analysis).toHaveProperty(key);
    }
    expect(analysis.scenarioEngineVersion).toBe("SCENARIO_ENGINE_V3");
    expect(["BUY", "SELL", "WAIT"]).toContain(analysis.action);
    expect(typeof analysis.confidence).toBe("number");
  });
});

describe("2. tendencia: continuacao, pullback e RSI extremo", () => {
  it("continuacao bull: TREND_UP + TREND_CONTINUATION + BUY", () => {
    const result = run({ features: bullishTrend() });
    expect(result.marketRegime).toBe("TREND_UP");
    expect(result.primaryScenario).toBe("TREND_CONTINUATION");
    expect(result.action).toBe("BUY");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("continuacao bear: TREND_DOWN + TREND_CONTINUATION + SELL", () => {
    const result = run({ features: bearishTrend() });
    expect(result.marketRegime).toBe("TREND_DOWN");
    expect(result.primaryScenario).toBe("TREND_CONTINUATION");
    expect(result.action).toBe("SELL");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("pullback bull: TREND_PULLBACK + BUY com swing mantido", () => {
    const result = analyzeScenario(pullbackBull());
    expect(result.marketRegime).toBe("TREND_UP");
    expect(result.primaryScenario).toBe("TREND_PULLBACK");
    expect(result.action).toBe("BUY");
    expect(result.scenarioEvidenceFor).toContain("PULLBACK_RETRACE_ZONE");
    expect(result.scenarioEvidenceFor).toContain("PULLBACK_EVENT");
  });

  it("pullback bear: TREND_PULLBACK + SELL com swing mantido", () => {
    const result = analyzeScenario(pullbackBear());
    expect(result.marketRegime).toBe("TREND_DOWN");
    expect(result.primaryScenario).toBe("TREND_PULLBACK");
    expect(result.action).toBe("SELL");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("pullback NAO e reversal: competidor REVERSAL explica NO_STRUCTURE_BREAK", () => {
    const result = analyzeScenario(pullbackBull());
    expect(result.primaryScenario).toBe("TREND_PULLBACK");
    expect(result.competing).toContain("REVERSAL");
    const reversal = result.playbook.competing.includes("REVERSAL");
    expect(reversal).toBe(true);
    const competitor = engine.classifyScenario(extractContext(pullbackBull()), classifyRegime(extractContext(pullbackBull())));
    const reversalEvidence = competitor.competitorEvidence.find((entry: AnyRecord) => entry.scenario === "REVERSAL");
    expect(reversalEvidence.against).toContain("NO_STRUCTURE_BREAK");
    expect(competitor.primaryScenario).toBe("TREND_PULLBACK");
  });

  it("reversal bull: BOS UP apos tendencia de baixa + rejeicao na base -> REVERSAL + BUY", () => {
    const result = run({
      features: features({ structureLabel: "UP", atrRatio: 1.4, velocity: 0.0004, acceleration: 0.0001, donchianPosition: 0.12, rsi14: 28, rsiPrev: 24, bodyRatio: 0.35, lowerWick: 0.6 }),
      snapshot: { structure: { breakOfStructure: "UP" }, events: { rejectionDown: true, failedBreakoutDown: true }, multiTimeframe: { higher: "DOWN", primary: "DOWN" } },
    });
    expect(result.primaryScenario).toBe("REVERSAL");
    expect(result.action).toBe("BUY");
    expect(result.scenarioEvidenceFor).toContain("BREAK_OF_STRUCTURE_CONFIRMED");
    expect(result.scenarioEvidenceFor).toContain("MOMENTUM_DIVERGENCE");
  });

  it("reversal bear: BOS DOWN apos tendencia de alta + rejeicao no topo -> REVERSAL + SELL", () => {
    const result = run({
      features: features({ structureLabel: "DOWN", atrRatio: 1.5, velocity: -0.0004, acceleration: -0.0001, donchianPosition: 0.85, rsi14: 72, rsiPrev: 76, bodyRatio: 0.35, upperWick: 0.6 }),
      snapshot: { structure: { breakOfStructure: "DOWN" }, events: { rejectionUp: true, failedBreakoutUp: true } },
    });
    expect(result.primaryScenario).toBe("REVERSAL");
    expect(result.action).toBe("SELL");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("RSI extremo sozinho NAO gera reversal (indicador e evidencia, nao gatilho)", () => {
    const result = run({ features: features({ structureLabel: "UP", adx14: 30, plusDI: 28, minusDI: 12, velocity: 0.0004, donchianPosition: 0.7, rsi14: 78, rsiPrev: 74, bodyRatio: 0.6 }) });
    expect(result.primaryScenario).not.toBe("REVERSAL");
    expect(result.action).toBe("BUY");
    expect(result.playbook.entryEligible).toBe(true);
  });
});

describe("3. breakout e failed breakout", () => {
  it("breakout bull valido: fechamento alem + corpo + expansao + ticks -> BREAKOUT BUY", () => {
    const result = analyzeScenario(breakoutBull());
    expect(result.primaryScenario).toBe("BREAKOUT");
    expect(result.action).toBe("BUY");
    expect(result.playbook.entryEligible).toBe(true);
    expect(result.scenarioEvidenceFor).toContain("CLOSE_BEYOND_LEVEL");
  });

  it("breakout bear valido: fechamento abaixo + corpo + expansao -> BREAKOUT SELL", () => {
    const result = analyzeScenario(input({
      features: features({ structureLabel: "RANGE", donchianPosition: 0.02, distanceToLowerATR: -0.4, atrRatio: 1.5, bodyRatio: 0.7, lowerWick: 0.05, velocity: -0.0004, adx14: 24, plusDI: 12, minusDI: 26 }),
      snapshot: { events: { breakoutDown: true } },
      ticks: [1.1, 1.0995, 1.099, 1.0985, 1.098, 1.0975, 1.097],
    }));
    expect(result.primaryScenario).toBe("BREAKOUT");
    expect(result.action).toBe("SELL");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("breakout fraco (wick grande, corpo pequeno, sem extensao) -> WAIT sem entrada", () => {
    const weak = input({
      features: features({ structureLabel: "RANGE", donchianPosition: 0.9, distanceToUpperATR: 0.05, atrRatio: 1, bodyRatio: 0.35, upperWick: 0.4, velocity: 0.00005, adx14: 18, plusDI: 15, minusDI: 15 }),
      snapshot: { events: { breakoutUp: true } },
    });
    const result = analyzeScenario(weak);
    expect(result.action).toBe("WAIT");
    const playbook = evaluatePlaybook("PB_BREAKOUT", extractContext(weak), weak.features);
    expect(playbook.entryEligible).toBe(false);
    expect(playbook.triggerState).not.toBe("CONFIRMED");
  });

  it("failed breakout up -> FAILED_BREAKOUT SELL com rejeicao confirmada", () => {
    const result = analyzeScenario(failedBreakoutUp());
    expect(result.primaryScenario).toBe("FAILED_BREAKOUT");
    expect(result.action).toBe("SELL");
    expect(result.scenarioEvidenceFor).toContain("REJECTION_CONFIRMED");
    expect(result.scenarioEvidenceFor).toContain("CLOSE_BACK_INSIDE_RANGE");
  });

  it("failed breakout down -> FAILED_BREAKOUT BUY com rejeicao confirmada", () => {
    const result = analyzeScenario(input({
      features: features({ structureLabel: "RANGE", donchianPosition: 0.22, distanceToLowerATR: 0.2, atrRatio: 1.1, bodyRatio: 0.3, lowerWick: 0.6, velocity: 0.0002, adx14: 18, plusDI: 15, minusDI: 15, rsi14: 42, rsiPrev: 38 }),
      snapshot: { events: { failedBreakoutDown: true, rejectionDown: true } },
      ticks: [1.1, 1.1002, 1.1005, 1.1007, 1.1008],
    }));
    expect(result.primaryScenario).toBe("FAILED_BREAKOUT");
    expect(result.action).toBe("BUY");
  });

  it("retest NAO e failed breakout (retest defende o nivel)", () => {
    const retest = input({
      features: features({ structureLabel: "UP", donchianPosition: 0.85, distanceToUpperATR: -0.05, atrRatio: 1.2, bodyRatio: 0.55, velocity: 0.0003, adx14: 26, plusDI: 28, minusDI: 12, rsi14: 60 }),
      snapshot: { events: { breakoutUp: true, retestUp: true } },
    });
    const result = analyzeScenario(retest);
    expect(result.primaryScenario).not.toBe("FAILED_BREAKOUT");
    const failed = evaluatePlaybook("PB_FAILED_BREAKOUT", extractContext(retest), retest.features);
    expect(failed.evidenceAgainst).toContain("NO_FAILED_BREAKOUT_EVENT");
    expect(failed.entryEligible).toBe(false);
  });
});

describe("4. RANGE_MEAN_REVERSION: prova de range e bordas", () => {
  const base = () => analyzeScenario(input({
    features: features({ structureLabel: "RANGE", adx14: 14, plusDI: 14, minusDI: 15, rsi14: 33, rsiPrev: 29, atr: 0.0005, atrRatio: 0.95 }),
    candles: rangeCandles("BASE"),
  }));
  const top = () => analyzeScenario(input({
    features: features({ structureLabel: "RANGE", adx14: 14, plusDI: 15, minusDI: 14, rsi14: 68, rsiPrev: 72, atr: 0.0005, atrRatio: 0.95 }),
    candles: rangeCandles("TOP"),
  }));
  const mid = () => analyzeScenario(input({
    features: features({ structureLabel: "RANGE", adx14: 14, plusDI: 14, minusDI: 15, rsi14: 50, rsiPrev: 50, atr: 0.0005, atrRatio: 0.95 }),
    candles: rangeCandles("MID"),
  }));

  it("range na base inferior com rejeicao/retorno -> RANGE_MEAN_REVERSION BUY", () => {
    const result = base();
    expect(result.marketRegime).toBe("RANGE");
    expect(result.primaryScenario).toBe("RANGE_MEAN_REVERSION");
    expect(result.action).toBe("BUY");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("range no topo superior com rejeicao -> RANGE_MEAN_REVERSION SELL", () => {
    const result = top();
    expect(result.primaryScenario).toBe("RANGE_MEAN_REVERSION");
    expect(result.action).toBe("SELL");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("MID do range reduz muito a validade: WAIT com invalidation MID_LOCATION", () => {
    const result = mid();
    expect(result.primaryScenario).toBe("RANGE_MEAN_REVERSION");
    expect(result.action).toBe("WAIT");
    expect(result.invalidations).toContain("MID_LOCATION");
    expect(result.playbook.entryEligible).toBe(false);
  });

  it("prova de range expoe rangeHigh/Low/Mid/Width, posicao normalizada e estabilidade das bordas", () => {
    const context = extractContext(input({ features: features({ structureLabel: "RANGE", adx14: 14, plusDI: 14, minusDI: 15, atr: 0.0005, atrRatio: 0.95 }), candles: rangeCandles("BASE") }));
    expect(context.range.available).toBe(true);
    expect(context.range.rangeHigh).toBeGreaterThan(context.range.rangeLow);
    expect(context.range.rangeWidth).toBeGreaterThan(0);
    expect(context.range.rangeMid).toBeCloseTo((context.range.rangeHigh + context.range.rangeLow) / 2, 6);
    expect(context.range.position).toBeGreaterThanOrEqual(0);
    expect(context.range.position).toBeLessThanOrEqual(1);
    expect(typeof context.range.edgeStabilityLow).toBe("boolean");
  });

  it("range rompendo invalida MR (rompimento em curso nao e fade)", () => {
    const breaking = input({
      features: features({ structureLabel: "RANGE", donchianPosition: 0.9, distanceToUpperATR: 0.02, atrRatio: 1.5, bodyRatio: 0.25, upperWick: 0.3, velocity: 0.0001, adx14: 18, plusDI: 15, minusDI: 15 }),
      snapshot: { events: { breakoutUp: true } },
    });
    const result = analyzeScenario(breaking);
    expect(result.primaryScenario).not.toBe("RANGE_MEAN_REVERSION");
    expect(result.action).toBe("WAIT");
    const mr = evaluatePlaybook("PB_RANGE_MEAN_REVERSION", extractContext(breaking), breaking.features);
    expect(mr.entryEligible).toBe(false);
    expect(mr.invalidations).toContain("RANGE_BREAK_IN_PROGRESS");
  });

  it("MR competidor e BREAKOUT/COMPRESSION_EXPANSION e o winner rational explica a borda", () => {
    const scenario = classifyScenario(extractContext(input({ features: features({ structureLabel: "RANGE", adx14: 14, plusDI: 14, minusDI: 15, rsi14: 33, rsiPrev: 29, atr: 0.0005, atrRatio: 0.95 }), candles: rangeCandles("BASE") })), { regime: "RANGE" });
    expect(["BREAKOUT", "COMPRESSION_EXPANSION", "FAILED_BREAKOUT"]).toContain(scenario.competitorEvidence[0].scenario);
    expect(scenario.winnerRationale).toContain("RANGE_MEAN_REVERSION");
  });
});

describe("5. COMPRESSION_EXPANSION: compressao nao escolhe direcao", () => {
  it("compressao identificada sem direcao: COMPRESSION_EXPANSION + WAIT + ambiguous", () => {
    const result = run({
      features: features({ structureLabel: "RANGE", atrRatio: 0.55, donchianPosition: 0.5, adx14: 12, plusDI: 14, minusDI: 15, bodyRatio: 0.3 }),
      snapshot: { events: { compression: true }, volatility: { compression: true } },
      ticks: [1.1, 1.1001, 1.0999, 1.1002, 1.0998],
    });
    expect(result.marketRegime).toBe("COMPRESSION");
    expect(result.primaryScenario).toBe("COMPRESSION_EXPANSION");
    expect(result.action).toBe("WAIT");
    expect(result.ambiguous).toBe(true);
    expect(result.scenarioEvidenceFor.join(" ")).not.toMatch(/BUY|SELL/);
  });

  it("compression expansion bull: expansao com fechamento define BUY", () => {
    const result = run({
      features: features({ structureLabel: "RANGE", atrRatio: 0.6, donchianPosition: 0.95, distanceToUpperATR: -0.3, bodyRatio: 0.75, velocity: 0.0003, adx14: 16, plusDI: 18, minusDI: 12 }),
      snapshot: { events: { compression: true, expansion: true, breakoutUp: true }, volatility: { compression: true, expansion: true } },
      ticks: [1.1, 1.1004, 1.1009, 1.1013, 1.1018, 1.1022],
    });
    expect(result.primaryScenario).toBe("COMPRESSION_EXPANSION");
    expect(result.action).toBe("BUY");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("compression expansion bear: expansao com fechamento define SELL", () => {
    const result = run({
      features: features({ structureLabel: "RANGE", atrRatio: 0.6, donchianPosition: 0.05, distanceToLowerATR: -0.3, bodyRatio: 0.75, velocity: -0.0003, adx14: 16, plusDI: 12, minusDI: 18 }),
      snapshot: { events: { compression: true, expansion: true, breakoutDown: true }, volatility: { compression: true, expansion: true } },
      ticks: [1.1, 1.0996, 1.0991, 1.0987, 1.0982, 1.0978],
    });
    expect(result.primaryScenario).toBe("COMPRESSION_EXPANSION");
    expect(result.action).toBe("SELL");
    expect(result.playbook.entryEligible).toBe(true);
  });

  it("false expansion (wick sem fechamento/direcao) -> WAIT sem entrada", () => {
    const fake = input({
      features: features({ structureLabel: "RANGE", atrRatio: 1.5, donchianPosition: 0.55, bodyRatio: 0.2, upperWick: 0.6, adx14: 16, plusDI: 15, minusDI: 15 }),
      snapshot: { events: { expansion: true } },
    });
    const result = analyzeScenario(fake);
    expect(result.action).toBe("WAIT");
    const cb = evaluatePlaybook("PB_COMPRESSION_EXPANSION", extractContext(fake), fake.features);
    expect(cb.entryEligible).toBe(false);
    expect(cb.evidenceAgainst.join(" ")).toMatch(/FALSE_EXPANSION|COMPRESSION_NOT_CONFIRMED|EXPANSION_WITHOUT_DIRECTION/);
  });
});

describe("6. TRANSITION, indicadores isolados e divergencia", () => {
  it("transicao (estrutura x momentum discordando) -> TRANSITION_NO_TRADE WAIT", () => {
    const result = run({ features: features({ structureLabel: "UP", velocity: -0.0003, acceleration: -0.00005, donchianPosition: 0.5, adx14: 26, plusDI: 24, minusDI: 8, rsi14: 50 }) });
    expect(result.marketRegime).toBe("TRANSITION");
    expect(result.primaryScenario).toBe("TRANSITION_NO_TRADE");
    expect(result.action).toBe("WAIT");
    expect(result.playbook.entryEligible).toBe(false);
  });

  it("ADX sozinho nao define direcao (sem estrutura = sem trade)", () => {
    const result = run({ features: features({ adx14: 40, plusDI: 35, minusDI: 5, atrRatio: 1 }) });
    expect(result.action).toBe("WAIT");
    expect(result.direction).toBeNull();
    expect(result.marketRegime).not.toBe("TREND_UP");
    expect(result.marketRegime).not.toBe("TREND_DOWN");
  });

  it("ATR/expansao sozinha nao define direcao", () => {
    const result = run({ features: features({ atrRatio: 2 }) });
    expect(result.action).toBe("WAIT");
    expect(result.direction).toBeNull();
    expect(result.primaryScenario).toBe("TRANSITION_NO_TRADE");
  });

  it("divergencia Trader/Critic pode retornar WAIT (nunca vira voto)", () => {
    const result = run({ features: bullishTrend(), trader: { action: "BUY" }, critic: { action: "WAIT" } });
    expect(result.action).toBe("WAIT");
    expect(result.ambiguous).toBe(true);
    expect(result.invalidations.some((reason: string) => reason.includes("TRADER_CRITIC_DIVERGENCE"))).toBe(true);
  });
});

describe("7. mudanca de cenario e cancelamento de tese", () => {
  it("o cenario pode mudar entre candidate e final (estrutura nova muda a leitura)", () => {
    const candidate = run({ features: bullishTrend() });
    const finalResult = run({
      features: features({ structureLabel: "DOWN", atrRatio: 1.5, velocity: -0.0004, acceleration: -0.0001, donchianPosition: 0.85, rsi14: 72, rsiPrev: 76, bodyRatio: 0.35, upperWick: 0.6 }),
      snapshot: { structure: { breakOfStructure: "DOWN" }, events: { rejectionUp: true, failedBreakoutUp: true } },
    });
    expect(candidate.primaryScenario).toBe("TREND_CONTINUATION");
    expect(finalResult.primaryScenario).toBe("REVERSAL");
    expect(finalResult.primaryScenario).not.toBe(candidate.primaryScenario);
    expect(finalResult.action).toBe("SELL");
  });

  it("mudanca que invalida a tese cancela o candidato (sem BUY e com invalidacao)", () => {
    const candidate = analyzeScenario(breakoutBull());
    expect(candidate.action).toBe("BUY");
    const invalidated = analyzeScenario(failedBreakoutUp());
    expect(invalidated.primaryScenario).toBe("FAILED_BREAKOUT");
    expect(invalidated.action).not.toBe("BUY");
    expect(invalidated.action).toBe("SELL");
    expect(invalidated.playbook.entryEligible).toBe(true);
    const failedPlaybook = evaluatePlaybook("PB_FAILED_BREAKOUT", extractContext(failedBreakoutUp()), failedBreakoutUp().features);
    expect(failedPlaybook.entryEligible).toBe(true);
    expect(failedPlaybook.action).toBe("SELL");
    expect(failedPlaybook.evidenceFor).toContain("REJECTION_CONFIRMED");
  });
});

describe("8. leakage, isolamento NORMAL x OTC e disponibilidade", () => {
  it("settlement/result/postWindow/future sao ignorados com marca de leakage", () => {
    const dirty = run({
      features: bullishTrend(),
      marketType: "NORMAL",
      marketKey: "EURUSD:NORMAL",
      settlement: "WIN",
      result: "WIN",
      postWindow: { close: 9.99 },
      futureCandles: [{ open: 1, high: 9, low: 1, close: 9 }],
    });
    const marks = dirty.unavailable.filter((entry: string) => entry.startsWith("leakageIgnored:"));
    expect(marks).toContain("leakageIgnored:input.settlement");
    expect(marks).toContain("leakageIgnored:input.futureCandles");
    expect(marks).toContain("leakageIgnored:input.result");
    expect(marks).toContain("leakageIgnored:input.postWindow");
    expect(dirty.primaryScenario).toBe("TREND_CONTINUATION");
    expect(dirty.action).toBe("BUY");
  });

  it("WIN x LOSS e futuro oposto nao mudam a classificacao byte a byte", () => {
    const base = { features: bullishTrend(), marketType: "NORMAL", marketKey: "EURUSD:NORMAL" };
    const dirtyA = run({ ...base, settlement: "WIN", futureCandles: [{ open: 1, high: 9, low: 1, close: 9 }] });
    const dirtyB = run({ ...base, settlement: "LOSS", futureCandles: [{ open: 9, high: 9, low: 0, close: 0 }] });
    expect(JSON.stringify(dirtyA)).toBe(JSON.stringify(dirtyB));
    const clean = run(base);
    expect(dirtyA.marketRegime).toBe(clean.marketRegime);
    expect(dirtyA.primaryScenario).toBe(clean.primaryScenario);
    expect(dirtyA.action).toBe(clean.action);
  });

  it("dados futuros nao criam eventos/estrutura no contexto", () => {
    const context = extractContext(input({
      features: features({ structureLabel: "RANGE", atrRatio: 1 }),
      futureCandles: [{ open: 1, high: 99, low: 0.5, close: 99 }],
      settlement: "WIN",
    }));
    expect(context.events.breakoutUp).toBe(false);
    expect(context.events.breakoutDown).toBe(false);
    expect(context.structure.label).toBe("RANGE");
  });

  it("NORMAL x OTC isolados: mesma leitura de mercado, sem contaminacao cruzada", () => {
    const strip = ({ unavailable, otc, ...rest }: AnyRecord) => rest;
    const otc = analyzeScenario({ features: bullishTrend(), snapshot: {}, marketType: "OTC", marketKey: "EURUSD:OTC" });
    const normal = analyzeScenario({ features: bullishTrend(), snapshot: {}, marketType: "NORMAL", marketKey: "EURUSD:NORMAL" });
    expect(JSON.stringify(strip(otc))).toBe(JSON.stringify(strip(normal)));
    expect(otc.otc).toBe(true);
    expect(normal.otc).toBe(false);
  });

  it("OTC marca volume/order book indisponiveis e nunca simula esses dados", () => {
    const context = extractContext(input({ features: bullishTrend(), marketType: "OTC" }));
    expect(context.unavailable).toContain("volume:OTC_NOT_OBSERVABLE");
    expect(context.unavailable).toContain("orderBook:OTC_NOT_OBSERVABLE");
    expect(context.unavailable).toContain("marketDepth:OTC_NOT_OBSERVABLE");
    expect(JSON.stringify(context)).not.toContain("\"volume\"");
    expect(JSON.stringify(context)).not.toContain("\"orderBook\"");
    expect(context.volatility.realizedVol).toBeNull();
    expect(context.volatility.bbw).toBeNull();
    expect(context.unavailable).toContain("ticks:NOT_PROVIDED");
  });
});

describe("9. playbooks: regimes validos, evidencia e competidores", () => {
  it("os 8 playbooks existem com as secoes obrigatorias do TraceCom", () => {
    expect(Object.keys(PLAYBOOK_DEFINITIONS)).toHaveLength(8);
    for (const definition of Object.values(PLAYBOOK_DEFINITIONS) as AnyRecord[]) {
      for (const key of ["id", "scenario", "definition", "validRegimes", "invalidRegimes", "structure", "location", "momentum", "volatility", "microstructure", "trigger", "invalidation", "competing", "traderLogic", "criticAttack", "waitConditions", "featuresUsed", "source", "traceHypothesis"]) {
        expect(definition).toHaveProperty(key);
      }
      expect(definition.traceHypothesis).toContain("HYPOTHESIS TraceCom");
      expect(definition.source.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("evaluatePlaybook aceita { id } e retorna o shape congelado com acao coerente", () => {
    const source = input({ features: bullishTrend() });
    const result = evaluatePlaybook({ id: "PB_TREND_CONTINUATION" }, extractContext(source), source.features);
    for (const key of ["applicable", "validRegimes", "evidenceFor", "evidenceAgainst", "locationState", "structureState", "momentumState", "volatilityState", "microstructureState", "triggerState", "invalidations", "entryEligible", "action", "waitConditions", "competing"]) {
      expect(result).toHaveProperty(key);
    }
    expect(result.applicable).toBe(true);
    expect(result.action).toBe("BUY");
    expect(result.entryEligible).toBe(true);
    expect(result.competing).toContain("TREND_PULLBACK");
  });

  it("playbook fora do regime valido nunca libera entrada", () => {
    const context = extractContext(input({ features: bullishTrend() }));
    const result = evaluatePlaybook({ id: "PB_RANGE_MEAN_REVERSION" }, context, {});
    expect(result.applicable).toBe(false);
    expect(result.action).toBe("WAIT");
    expect(result.entryEligible).toBe(false);
    expect(result.invalidations.some((reason: string) => reason.startsWith("REGIME_NOT_VALID"))).toBe(true);
  });

  it("competitorEvidence e winnerRationale explicam por que X venceu Y", () => {
    const scenario = classifyScenario(extractContext(pullbackBull()), classifyRegime(extractContext(pullbackBull())));
    expect(scenario.primaryScenario).toBe("TREND_PULLBACK");
    expect(scenario.secondaryScenario).toBeTruthy();
    expect(scenario.winnerRationale).toContain("TREND_PULLBACK");
    expect(scenario.competitorEvidence.length).toBeGreaterThan(0);
    for (const competitor of scenario.competitorEvidence) {
      expect(Array.isArray(competitor.for)).toBe(true);
      expect(Array.isArray(competitor.against)).toBe(true);
      expect(Object.keys(competitor)).toEqual(["scenario", "for", "against"]);
    }
  });
});
