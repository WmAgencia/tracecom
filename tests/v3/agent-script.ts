/** Scripts de agentes (contratos compactos v2) para testes. */

export const specialistOutput = (role: string, extra: Record<string, unknown> = {}) => ({
  assessment: `${role} estado do dominio`,
  facts: [{ code: `${role}_FACT`, direction: "UP", strength: "MODERATE", detail: "curto" }],
  blockers: [],
  invalidations: [],
  changed: [],
  watch: ["proximo candle"],
  playbooks: [],
  sources: ["WILDER_1978"],
  ...extra,
});

export const bilateralOutput = (extra: Record<string, unknown> = {}) => ({
  scenario: "TREND_CONTINUATION",
  direction: "UP",
  evidenceFamilies: [{ family: "STRUCTURE", supports: "BOS de alta" }, { family: "MOMENTUM", supports: "crossback" }],
  bestCaseForUp: ["estrutura HH/HL"],
  bestCaseAgainstUp: ["CHoCH bearish invalidaria"],
  bestCaseForDown: ["perda do swing"],
  bestCaseAgainstDown: ["BOS bullish recente"],
  blockers: [],
  invalidations: [],
  marketAmbiguities: [],
  ...extra,
});

export const approveScript = (): Record<string, any> => ({
  RSI: specialistOutput("RSI"),
  DMI_ADX: specialistOutput("DMI_ADX"),
  BOLLINGER: specialistOutput("BOLLINGER"),
  ATR: specialistOutput("ATR", { facts: [{ code: "VOL_REGIME", direction: "NONE", strength: "MODERATE", detail: "compativel" }] }),
  PRICE_ACTION: specialistOutput("PRICE_ACTION"),
  ASSET: {
    scenario: "TREND_CONTINUATION", direction: "UP", state: "BUY_CANDIDATE",
    bestCounterCase: "CHoCH bearish invalidaria a continuacao", blockers: [], invalidations: [], changed: [], watch: ["novo BOS"],
  },
  CONSENSUS_BILATERAL: bilateralOutput(),
});

export const cancelScript = (): Record<string, any> => ({
  ...approveScript(),
  ASSET: { scenario: "TRANSITION", direction: "NONE", state: "WAIT", bestCounterCase: "sem tese", blockers: [], invalidations: [], changed: [], watch: [] },
  CONSENSUS_BILATERAL: bilateralOutput({ direction: "NONE", evidenceFamilies: [{ family: "STRUCTURE", supports: "mista" }] }),
});
