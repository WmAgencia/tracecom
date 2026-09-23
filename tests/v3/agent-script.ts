/** Scripts de agentes para testes (mesma interface do client real). */

export const specialistOutput = (role: string, extra: Record<string, unknown> = {}) => ({
  domainAssessment: `${role} state`,
  observations: [`${role} observation`],
  deterministicFacts: [{ family: role === "PRICE_ACTION" ? "STRUCTURE" : "MOMENTUM", code: `${role}_FACT`, direction: "UP", detail: null }],
  counterFacts: [],
  blockers: [],
  invalidations: [],
  changedSincePreviousCycle: [],
  nextEvidenceToWatch: ["next candle"],
  playbooksUsed: [],
  sourcesUsed: ["WILDER_1978"],
  ...extra,
});

export const approveScript = (): Record<string, any> => ({
  RSI: specialistOutput("RSI"),
  DMI_ADX: specialistOutput("DMI_ADX"),
  BOLLINGER: specialistOutput("BOLLINGER"),
  ATR: specialistOutput("ATR", { deterministicFacts: [{ family: "VOLATILITY", code: "VOL", direction: null, detail: null }] }),
  PRICE_ACTION: specialistOutput("PRICE_ACTION"),
  ASSET: {
    scenario: "TREND_CONTINUATION", direction: "UP", state: "BUY_CANDIDATE",
    supportingEvidence: ["BULLISH_BOS", "PLUS_DOMINANCE"], counterEvidence: [], blockers: [], invalidations: [],
    bestCounterCase: "um CHoCH bearish invalidaria a continuacao", changedSincePreviousCycle: [], nextEvidenceToWatch: ["novo BOS"],
  },
  CONSENSUS_INDEPENDENT: { scenario: "TREND_CONTINUATION", direction: "UP", evidence: ["BULLISH_BOS"], reasoningSummary: "estrutura de alta com BOS" },
  CONSENSUS_FINAL: { agreement: "AGREE", result: "APPROVE_BUY", bestCounterCase: "CHoCH bearish", challengeSteps: ["sem invalidations", "duas familias"], reasons: [] },
});

export const cancelScript = (): Record<string, any> => ({
  ...approveScript(),
  ASSET: { scenario: "TRANSITION", direction: null, state: "WAIT", supportingEvidence: [], counterEvidence: ["sinais conflitantes"], blockers: [], invalidations: [], bestCounterCase: "sem tese definida", changedSincePreviousCycle: [], nextEvidenceToWatch: [] },
  CONSENSUS_INDEPENDENT: { scenario: "TRANSITION", direction: null, evidence: ["mista"], reasoningSummary: "transicao" },
  CONSENSUS_FINAL: { agreement: "DISAGREE", result: "CANCEL", bestCounterCase: "asset sem tese", challengeSteps: ["disagreement"], reasons: ["DISAGREE"] },
});
