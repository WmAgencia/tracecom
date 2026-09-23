/** Scripts de agentes (arquitetura hibrida final: Wave 1 = 5 specialists + Asset; Wave 2 = Consensus Final). */

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

export const assetOutput = (extra: Record<string, unknown> = {}) => ({
  scenario: "TREND_CONTINUATION",
  direction: "UP",
  state: "BUY_CANDIDATE",
  thesis: "estrutura de alta intacta com pullback normal",
  bestCounterCase: "CHoCH bearish invalidaria a continuacao",
  blockers: [],
  invalidations: [],
  changed: [],
  watch: ["novo BOS"],
  ...extra,
});

export const consensusFinalOutput = (extra: Record<string, unknown> = {}) => ({
  independentAssessment: "estrutura HH/HL com BOS recente e momentum alinhado",
  assetComparison: "asset concorda com a leitura independente (mesma direcao)",
  scenario: "TREND_CONTINUATION",
  direction: "UP",
  agreement: "AGREE",
  supportingEvidence: ["BOS bullish recente", "DI dominance positiva"],
  counterEvidence: ["squeeze de bandas"],
  bestCaseForUp: ["estrutura HH/HL", "BOS recente"],
  bestCaseAgainstUp: ["CHoCH bearish invalidaria"],
  bestCaseForDown: ["perda do swing"],
  bestCaseAgainstDown: ["BOS bullish recente"],
  blockers: [],
  invalidations: [],
  marketAmbiguities: [],
  reasons: ["estrutura e momentum alinhados"],
  result: "APPROVE_BUY",
  ...extra,
});

export const approveScript = (): Record<string, any> => ({
  RSI: specialistOutput("RSI"),
  DMI_ADX: specialistOutput("DMI_ADX"),
  BOLLINGER: specialistOutput("BOLLINGER"),
  ATR: specialistOutput("ATR", { facts: [{ code: "VOL_REGIME", direction: "NONE", strength: "MODERATE", detail: "compativel" }] }),
  PRICE_ACTION: specialistOutput("PRICE_ACTION"),
  ASSET: assetOutput(),
  CONSENSUS_FINAL: consensusFinalOutput(),
});

export const cancelScript = (): Record<string, any> => ({
  ...approveScript(),
  ASSET: assetOutput({ scenario: "TRANSITION", direction: "NONE", state: "WAIT", thesis: "sem tese direcional", bestCounterCase: "sem tese" }),
  CONSENSUS_FINAL: consensusFinalOutput({ independentAssessment: "evidencia mista", assetComparison: "asset sem direcao", scenario: "TRANSITION", direction: "NONE", agreement: "PARTIAL", result: "CANCEL", reasons: ["sem confirmacao estrutural"] }),
});
