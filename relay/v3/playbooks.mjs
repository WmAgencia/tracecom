/**
 * V3 — PLAYBOOK REGISTRY (conhecimento profissional estruturado).
 *
 * Cada playbook separa explicitamente:
 *  - SOURCE-BACKED: conceito documentado em fonte original/reconhecida (sourceIds);
 *  - TRACECOM OPERATIONAL DEFINITION: regra interna objetiva (marcada com tracecomDefined).
 * A prosa completa vive em docs/research/v3-*-playbook.md; aqui ficam os contratos
 * executaveis consumidos pelos especialistas (mesmos ids nos dois lugares).
 */
export const V3_PLAYBOOKS_VERSION = "v3-playbooks-v1";

export const SOURCES = Object.freeze({
  WILDER_1978: { id: "WILDER_1978", author: "J. Welles Wilder Jr.", title: "New Concepts in Technical Trading Systems", publisher: "Trend Research", year: 1978, isbn: "978-0-89459-027-6", type: "LIVRO_PRIMARIO" },
  BOLLINGER_2001: { id: "BOLLINGER_2001", author: "John Bollinger", title: "Bollinger on Bollinger Bands", publisher: "McGraw-Hill", year: 2001, type: "LIVRO_AUTOR" },
  BOLLINGER_OFFICIAL_RULES: { id: "BOLLINGER_OFFICIAL_RULES", author: "John Bollinger", title: "Bollinger Band Rules / Knowledge Center", publisher: "bollingerbands.com", type: "MATERIAL_OFICIAL_AUTOR", url: "https://www.bollingerbands.com/bollinger-band-rules" },
  CMT_ASSOCIATION: { id: "CMT_ASSOCIATION", author: "CMT Association", title: "CMT Program Body of Knowledge", publisher: "cmtassociation.org", type: "CURRICULO_PROFISSIONAL", url: "https://cmtassociation.org" },
  EDWARDS_MAGEE_2018: { id: "EDWARDS_MAGEE_2018", author: "Robert D. Edwards, John Magee, W.H.C. Bassetti", title: "Technical Analysis of Stock Trends (11th ed.)", publisher: "CRC Press", year: 2018, doi: "10.4324/9781315115719", type: "LIVRO_CLASSICO" },
  KIRKPATRICK_DAHLQUIST_2016: { id: "KIRKPATRICK_DAHLQUIST_2016", author: "Charles D. Kirkpatrick, Julie R. Dahlquist", title: "Technical Analysis: The Complete Resource for Financial Market Technicians (3rd ed.)", publisher: "Pearson", year: 2016, type: "LIVRO_PROFISSIONAL" },
  TRACECOM_V3_OPS: { id: "TRACECOM_V3_OPS", author: "TraceCom", title: "Definicoes operacionais internas da V3", publisher: "TraceCom", year: 2026, type: "DEFINICAO_INTERNA" },
});

/** Defaults de dominio: cobrem WHEN NOT RELEVANT / CAUSALITY quando o playbook nao detalha. */
const DOMAIN_DEFAULTS = Object.freeze({
  RSI: { whenNotRelevant: ["Series curtas ou em transicao brusca (crossbacks frequentes)"], causalityRisks: ["Calcular RSI com o candle em formacao (usa dado futuro dentro do candle)"] },
  DMI: { whenNotRelevant: ["ADX < 15: slope e dominancia viram ruido"], causalityRisks: ["Tratar ADX como contemporaneo — ele e suavizado e lagging por construcao"] },
  BOLLINGER: { whenNotRelevant: ["Series menores que o periodo ou sem volatilidade mensuravel"], causalityRisks: ["Assumir normalidade estatistica (o autor explicitamente nao recomenda)"] },
  ATR: { whenNotRelevant: ["Horizontes muito menores que o periodo do ATR"], causalityRisks: ["Normalizar com ATR que inclui o candle ainda aberto"] },
  PRICE_ACTION: { whenNotRelevant: ["Estrutura indefinida ou sem swings confirmados"], causalityRisks: ["Rotular BOS/CHoCH por pavio ou antes da confirmacao do pivot (repaint)"] },
});

const pb = (entry) => {
  const defaults = DOMAIN_DEFAULTS[entry.domain] ?? {};
  const merged = { ...entry };
  for (const key of ["whenNotRelevant", "causalityRisks"]) {
    if (!Array.isArray(merged[key]) || merged[key].length === 0) merged[key] = defaults[key] ?? merged[key];
  }
  if (merged.tracecomDefined === true && !merged.sources.includes("TRACECOM_V3_OPS")) merged.sources = [...merged.sources, "TRACECOM_V3_OPS"];
  return Object.freeze(merged);
};

export const PLAYBOOKS = Object.freeze({
  /* ---------------------------------- RSI ---------------------------------- */
  RSI_ZONE_CONTEXT: pb({
    id: "RSI_ZONE_CONTEXT", domain: "RSI", concept: "Zona de RSI como contexto relativo, nunca sinal isolado",
    definition: "RSI mede a razao entre a magnitude media das altas e das baixas recentes (periodo 14 padrao de Wilder), em escala 0-100. 70/30 sao referencias classicas de sobrecompra/sobrevenda, nao gatilhos.",
    sources: ["WILDER_1978"], tracecomDefined: false,
    whenRelevant: ["Leitura inicial de contexto em qualquer ciclo"], whenNotRelevant: ["Nunca usar tag de zona como decisao; zonas extremas persistem em tendencia"],
    requiredInputs: ["closedCandles"], measurements: ["rsi.value", "rsi.zone", "rsi.series"],
    interpretation: { supporting: ["RSI em zona compativel com a tese estrutural"], counter: ["RSI extremo contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Sobrecomprado = vender", "Sobrevendido = comprar sem estrutura"],
    causalityRisks: ["Calcular RSI com candle em formacao"], implementationNotes: "reutiliza rsi() do features.mjs (Wilder smoothing)", testCases: ["rsi 14 deterministico", "zona LOW/NEUTRAL/HIGH"],
  }),
  RSI_TRAJECTORY: pb({
    id: "RSI_TRAJECTORY", domain: "RSI", concept: "Trajetoria, inclinacao e aceleracao do RSI",
    definition: "Sequencia de valores de RSI em candles fechados; slope = variacao media por candle na janela; acceleration = mudanca do slope entre janelas sobrepostas.",
    sources: ["WILDER_1978", "KIRKPATRICK_DAHLQUIST_2016"], tracecomDefined: false,
    whenRelevant: ["Diferenciar recuperacao de momentum de simples ruido"], whenNotRelevant: ["Series curtas (< lookback)"],
    requiredInputs: ["closedCandles >= 20"], measurements: ["rsi.slope", "rsi.acceleration", "rsi.momentum"],
    interpretation: { supporting: ["Slope a favor da tese e acelerando"], counter: ["Slope contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Tratar 1 candle como trajetoria"], causalityRisks: ["Lookahead no smoothing"], implementationNotes: "rsiSeries() causal por candle fechado", testCases: ["slope positivo", "aceleracao negativa"],
  }),
  RSI_CROSSBACK: pb({
    id: "RSI_CROSSBACK", domain: "RSI", concept: "Crossback da linha 50 (recuperacao/perda de momentum)",
    definition: "Cruzamento do RSI de volta pela linha 50 apos leitura do lado oposto, indicando troca de lado do momentum.",
    sources: ["WILDER_1978"], tracecomDefined: false,
    whenRelevant: ["Cenario de pullback buscando retomada"], whenNotRelevant: ["Mercado sem direcao definida (crossback frequente)"],
    requiredInputs: ["closedCandles"], measurements: ["rsi.crossback"],
    interpretation: { supporting: ["Crossback a favor da estrutura"], counter: ["Crossback contra a estrutura"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Crossback isolado como entrada"], causalityRisks: ["Usar o candle atual ainda aberto"], implementationNotes: "detecta nos ultimos 3 candles fechados", testCases: ["crossback UP", "crossback DOWN"],
  }),
  RSI_PERSISTENCE: pb({
    id: "RSI_PERSISTENCE", domain: "RSI", concept: "Persistencia de um lado da linha 50",
    definition: "Numero de candles fechados consecutivos com RSI do mesmo lado de 50.",
    sources: ["WILDER_1978", "CMT_ASSOCIATION"], tracecomDefined: false,
    whenRelevant: ["Medir consistencia do momentum"], whenNotRelevant: ["Regimes de transicao"],
    requiredInputs: ["closedCandles"], measurements: ["rsi.persistence"],
    interpretation: { supporting: ["Persistencia longa do lado da tese"], counter: ["Persistencia curta/enfraquecendo"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Confundir persistencia com forca de tendencia (isso e ADX)"], causalityRisks: [], implementationNotes: "contagem causal", testCases: ["persistence >= 3"],
  }),
  RSI_FAILURE_SWING: pb({
    id: "RSI_FAILURE_SWING", domain: "RSI", concept: "Failure swing (Wilder)",
    definition: "Padrao de topo/fundo no RSI descrito por Wilder: RSI atinge extremo, retrocede, falha em superar o extremo anterior e perde o fundo/topo intermediario. Wilder: 'failure swings acima de 70 ou abaixo de 30 sao indicacoes muito fortes de reversao'.",
    sources: ["WILDER_1978"], tracecomDefined: false,
    whenRelevant: ["Zonas extremas (>70 / <30) com perda de continuidade"], whenNotRelevant: ["RSI em zona neutra"],
    requiredInputs: ["closedCandles >= 40"], measurements: ["rsi.failureSwing"],
    interpretation: { supporting: ["Failure swing na direcao da tese de reversao"], counter: ["Failure swing contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Tratar qualquer retracao como failure swing"], causalityRisks: ["Detectar padrao com dados futuros"], implementationNotes: "implementacao simplificada e documentada (retrace minimo 5 pontos)", testCases: ["bearish failure swing", "ausencia em serie neutra"],
  }),
  RSI_DIVERGENCE: pb({
    id: "RSI_DIVERGENCE", domain: "RSI", concept: "Divergencia regular e oculta (RSI x preco)",
    definition: "Regular bearish: preco faz topo mais alto com RSI em topo mais baixo. Regular bullish: fundo mais baixo com RSI em fundo mais alto. Oculta (hidden): continuacao — preco faz topo mais baixo com RSI em topo mais alto (bearish oculta) ou fundo mais alto com RSI em fundo mais baixo (bullish oculta).",
    sources: ["WILDER_1978", "KIRKPATRICK_DAHLQUIST_2016"], tracecomDefined: false,
    whenRelevant: ["Comparar swings confirmados de preco e RSI"], whenNotRelevant: ["Sem dois pivots confirmados do mesmo tipo"],
    requiredInputs: ["closedCandles", "causalPivots"], measurements: ["rsi.divergence"],
    interpretation: { supporting: ["Divergencia de continuacao na direcao da tese"], counter: ["Divergencia regular contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Usar pivots nao confirmados (repaint)"], causalityRisks: ["Pivot so existe apos k candles; nunca antes"], implementationNotes: "pivots causais k=2; ultimos 2 topos/2 fundos", testCases: ["regular bearish", "hidden bullish", "sem divergencia"],
  }),

  /* ------------------------------- DMI / ADX ------------------------------- */
  DMI_STRENGTH_VS_DIRECTION: pb({
    id: "DMI_STRENGTH_VS_DIRECTION", domain: "DMI", concept: "ADX mede forca; +DI/-DI medem direcao",
    definition: "ADX quantifica a forca da tendencia (sem direcao); +DI/-DI comparam pressao compradora/vendedora. Wilder usa ADX > 25 como referencia de tendencia estabelecida.",
    sources: ["WILDER_1978"], tracecomDefined: false,
    whenRelevant: ["Todo ciclo: separar forca de direcao"], whenNotRelevant: ["Series curtas"],
    requiredInputs: ["closedCandles >= 16"], measurements: ["dmi.adx", "dmi.plusDi", "dmi.minusDi", "dmi.strength"],
    interpretation: { supporting: ["Forca e dominancia alinhadas a estrutura"], counter: ["Forca sem dominancia ou contra"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Usar ADX para direcao", "Ler +DI/-DI sem ADX"], causalityRisks: [], implementationNotes: "dmiAdx() do features.mjs (Wilder)", testCases: ["ADX forte com PLUS", "ADX fraco balanceado"],
  }),
  DMI_SLOPE_STRENGTHENING: pb({
    id: "DMI_SLOPE_STRENGTHENING", domain: "DMI", concept: "ADX subindo = tendencia fortalecendo; caindo = enfraquecendo",
    definition: "Comparacao do ADX atual com o ADX de N candles fechados atras (adxSlope).",
    sources: ["WILDER_1978", "CMT_ASSOCIATION"], tracecomDefined: false,
    whenRelevant: ["Distinguir continuacao de exaustao"], whenNotRelevant: ["ADX muito baixo (<15) onde o slope e ruido"],
    requiredInputs: ["closedCandles"], measurements: ["dmi.adxSlope", "dmi.trendState"],
    interpretation: { supporting: ["ADX fortalecendo na direcao da tese"], counter: ["ADX enfraquecendo"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["ADX caindo = reversao garantida"], causalityRisks: [], implementationNotes: "lookback 5 candles", testCases: ["STRENGTHENING", "WEAKENING"],
  }),
  DMI_TAKEOVER_RESUME: pb({
    id: "DMI_TAKEOVER_RESUME", domain: "DMI", concept: "Tomada de dominancia e retomada apos contracao",
    definition: "Takeover: sinal do spread (+DI - -DI) inverte com magnitude relevante. Resume: apos contracao do spread, o lado original volta a dominar.",
    sources: ["WILDER_1978"], tracecomDefined: false,
    whenRelevant: ["Transicoes de regime"], whenNotRelevant: ["Spread oscilando perto de zero"],
    requiredInputs: ["closedCandles"], measurements: ["dmi.takeover", "dmi.spread", "dmi.pressureChange"],
    interpretation: { supporting: ["Takeover/resume a favor da tese"], counter: ["Takeover contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Takeover sem magnitude como reversao"], causalityRisks: [], implementationNotes: "magnitude minima de 3 pontos no spread", testCases: ["MINUS_TOOK_OVER", "sem takeover"],
  }),
  DMI_LIMITATIONS: pb({
    id: "DMI_LIMITATIONS", domain: "DMI", concept: "Limitacoes do DMI/ADX",
    definition: "ADX e lagging por construcao (medias suavizadas); em ranges o ADX permanece baixo e os DI cruzam com frequencia, gerando leituras sem valor preditivo.",
    sources: ["WILDER_1978", "KIRKPATRICK_DAHLQUIST_2016"], tracecomDefined: false,
    whenRelevant: ["Sempre que ADX < 20 ou DI cruzando repetidamente"], whenNotRelevant: [],
    requiredInputs: ["closedCandles"], measurements: ["dmi.adx", "dmi.spread"],
    interpretation: { supporting: [], counter: [], blockers: ["ADX fraco: nao tratar DI como direcao"], invalidations: [] },
    commonMisinterpretations: ["Operar cruzamento de DI em range"], causalityRisks: [], implementationNotes: "blocker informativo para o Asset", testCases: ["blocker em ADX < 20"],
  }),

  /* -------------------------------- Bollinger ------------------------------- */
  BOLLINGER_RELATIVE_DEFINITION: pb({
    id: "BOLLINGER_RELATIVE_DEFINITION", domain: "BOLLINGER", concept: "Definicao relativa de caro/barato",
    definition: "Bollinger Bands (20,2) dao definicao relativa: preco e alto na banda superior e baixo na inferior. Tags NAO sao sinais (regra oficial do autor).",
    sources: ["BOLLINGER_OFFICIAL_RULES", "BOLLINGER_2001"], tracecomDefined: false,
    whenRelevant: ["Todo ciclo como contexto de posicao relativa"], whenNotRelevant: ["Nunca tratar tag como sinal"],
    requiredInputs: ["closedCandles >= 21"], measurements: ["bollinger.percentB", "bollinger.bandWalk"],
    interpretation: { supporting: ["Posicao relativa compativel com a tese"], counter: ["Posicao relativa contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Tag na banda = reversao"], causalityRisks: [], implementationNotes: "bollinger() do features.mjs", testCases: ["percentB > 1", "percentB em 0.5"],
  }),
  BOLLINGER_WALK: pb({
    id: "BOLLINGER_WALK", domain: "BOLLINGER", concept: "Band walk (caminhada pela banda)",
    definition: "Em tendencia, o preco 'caminha' pela banda superior/inferior com fechamentos sucessivos fora ou tocando a banda (regra oficial).",
    sources: ["BOLLINGER_OFFICIAL_RULES", "BOLLINGER_2001"], tracecomDefined: false,
    whenRelevant: ["Tendencia com ADX >= 20"], whenNotRelevant: ["Range"],
    requiredInputs: ["closedCandles"], measurements: ["bollinger.bandWalk"],
    interpretation: { supporting: ["Walk na direcao da tese"], counter: ["Walk contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Tratar walk como sobrecompra"], causalityRisks: [], implementationNotes: "classificacao por posicao do fechamento na banda", testCases: ["UPPER_HALF", "ABOVE_UPPER"],
  }),
  BOLLINGER_REENTRY_REJECTION: pb({
    id: "BOLLINGER_REENTRY_REJECTION", domain: "BOLLINGER", concept: "Retorno as bandas e rejeicao",
    definition: "Reentry: fechou fora da banda e voltou para dentro (sinal de perda de forca do extremo). Rejection: extremo da banda tocado com wick e fechamento de volta para dentro.",
    sources: ["BOLLINGER_OFFICIAL_RULES", "BOLLINGER_2001"], tracecomDefined: false,
    whenRelevant: ["Apos fechamento fora da banda"], whenNotRelevant: ["Sem toque/fechamento fora"],
    requiredInputs: ["closedCandles"], measurements: ["bollinger.reentry", "bollinger.rejection"],
    interpretation: { supporting: ["Rejeicao/reentry a favor da tese de reversao ao miolo"], counter: ["Reentry contra a tese de continuacao"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Confundir reentry com reversao confirmada"], causalityRisks: [], implementationNotes: "comparacao com candle -lookback", testCases: ["reentry de cima", "rejection inferior"],
  }),
  BOLLINGER_SQUEEZE_EXPANSION: pb({
    id: "BOLLINGER_SQUEEZE_EXPANSION", domain: "BOLLINGER", concept: "Squeeze, expansao e contracao (BandWidth)",
    definition: "BandWidth = (banda superior - inferior) / banda media. O autor define The Squeeze como BandWidth na minima de 125 periodos; expansao/contracao descrevem o ciclo de volatilidade.",
    sources: ["BOLLINGER_OFFICIAL_RULES", "BOLLINGER_2001"], tracecomDefined: false,
    whenRelevant: ["Antes de rompimentos", "Fim de tendencia (bulge)"], whenNotRelevant: [],
    requiredInputs: ["closedCandles >= 40"], measurements: ["bollinger.squeeze", "bollinger.expansion", "bollinger.measurements.bandwidthPercentile"],
    interpretation: { supporting: ["Squeeze precedendo expansao na direcao da tese"], counter: ["Expansao exaurida contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Squeeze como direcao"], causalityRisks: [], implementationNotes: "percentil de BandWidth na janela disponivel (proxy do 125-period low, documentado)", testCases: ["SQUEEZE em contracao", "EXPANDED"],
  }),
  BOLLINGER_CONTEXT_MIDLINE: pb({
    id: "BOLLINGER_CONTEXT_MIDLINE", domain: "BOLLINGER", concept: "Linha media como contexto de tendencia intermediaria",
    definition: "O autor recomenda que a media movel (banda media) reflita a tendencia de intermediario prazo; sua inclinacao e referencia de contexto.",
    sources: ["BOLLINGER_OFFICIAL_RULES"], tracecomDefined: false,
    whenRelevant: ["Todo ciclo"], whenNotRelevant: [],
    requiredInputs: ["closedCandles"], measurements: ["bollinger.midlineSlope"],
    interpretation: { supporting: ["Midline inclinada a favor da tese"], counter: ["Midline contra"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Ignorar a inclinacao da midline"], causalityRisks: [], implementationNotes: "diferenca da midline vs lookback candles", testCases: ["slope positivo", "slope negativo"],
  }),

  /* ----------------------------------- ATR ---------------------------------- */
  ATR_NORMALIZATION: pb({
    id: "ATR_NORMALIZATION", domain: "ATR", concept: "Normalizacao por ATR (Wilder)",
    definition: "ATR e a media suavizada do true range (Wilder). Movimentos, pullbacks e distancias de zona devem ser medidos em multiplos de ATR, nunca em valores absolutos.",
    sources: ["WILDER_1978"], tracecomDefined: false,
    whenRelevant: ["Todo ciclo"], whenNotRelevant: [],
    requiredInputs: ["closedCandles >= 16"], measurements: ["atr.atr", "atr.atrPct", "atr.normalizedRange", "atr.normalizedImpulse", "atr.normalizedPullback"],
    interpretation: { supporting: ["Movimentos em escala compativel com a tese"], counter: ["Movimento anormal (>3 ATR) contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Comparar moedas com escalas diferentes sem ATR"], causalityRisks: [], implementationNotes: "computeAtr() (Wilder) do asset-context", testCases: ["normalizedRange ~1", "impulso >= 1.5 ATR"],
  }),
  ATR_VOLATILITY_REGIME: pb({
    id: "ATR_VOLATILITY_REGIME", domain: "ATR", concept: "Regimes de volatilidade (expansao/contracao)",
    definition: "Razao entre ATR curto (5) e ATR padrao (14): expansao quando > 1.15, anormal quando > 1.6, baixa informacao quando < 0.7.",
    sources: ["WILDER_1978", "CMT_ASSOCIATION"], tracecomDefined: true,
    whenRelevant: ["Classificar contexto de volatilidade do ciclo"], whenNotRelevant: [],
    requiredInputs: ["closedCandles"], measurements: ["atr.volRatio", "atr.regime"],
    interpretation: { supporting: ["Volatilidade compativel com o horizonte de 300s"], counter: ["ABNORMAL_EXPANSION ou LOW_INFORMATION_VOLATILITY"], blockers: ["LOW_INFORMATION_VOLATILITY: movimento sem informacao"], invalidations: [] },
    commonMisinterpretations: ["Operar volatilidade anormal como se fosse normal"], causalityRisks: [], implementationNotes: "limiares TRACECOM definidos sobre razao ATR curto/longo (justificados em docs)", testCases: ["VOLATILITY_COMPATIBLE", "ABNORMAL_EXPANSION"],
  }),
  ATR_ZONE_TOLERANCE: pb({
    id: "ATR_ZONE_TOLERANCE", domain: "ATR", concept: "Tolerancia de zona em ATR",
    definition: "Uma zona (suporte/resistencia) so e considerada 'testada' quando a distancia preco-zona e mensuravel em ATR; distancias absolutas nao transferem entre ativos.",
    sources: ["WILDER_1978", "EDWARDS_MAGEE_2018"], tracecomDefined: true,
    whenRelevant: ["Avaliar proximidade de suporte/resistencia"], whenNotRelevant: [],
    requiredInputs: ["closedCandles", "structure.zones"], measurements: ["zoneDistance[].distanceAtr"],
    interpretation: { supporting: ["Preco dentro de ~0.5 ATR da zona relevante"], counter: ["Preco a > 2 ATR da zona (sem localizacao)"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Usar pips/pontos fixos"], causalityRisks: [], implementationNotes: "TRACECOM: zona ativa <= 0.75 ATR", testCases: ["distanceAtr 0.4", "distanceAtr 3.0"],
  }),
  ATR_WICK_ASSESSMENT: pb({
    id: "ATR_WICK_ASSESSMENT", domain: "ATR", concept: "Normalizacao de pavios e corpo",
    definition: "Pavios e corpo medidos como fracao do range do candle e normalizados por ATR para comparar rejeicao entre ativos.",
    sources: ["KIRKPATRICK_DAHLQUIST_2016"], tracecomDefined: true,
    whenRelevant: ["Candle de rejeicao/indecisao"], whenNotRelevant: [],
    requiredInputs: ["closedCandles"], measurements: ["atr.wickNormalization", "micro.upperWickRatio", "micro.lowerWickRatio"],
    interpretation: { supporting: ["Pavio de rejeicao na direcao da tese"], counter: ["Pavio oposto dominante"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Superestimar um unico pavio"], causalityRisks: [], implementationNotes: "combinar com estrutura e localizacao", testCases: ["wickNormalization > 1", "corpo decisivo"],
  }),

  /* ----------------------------- PRICE ACTION ------------------------------- */
  PA_TREND_STRUCTURE: pb({
    id: "PA_TREND_STRUCTURE", domain: "PRICE_ACTION", concept: "Estrutura de tendencia por swing points",
    definition: "Sequencia de topos e fundos confirmados: HH/HL = tendencia de alta; LH/LL = baixa; misto = transicao/range (base classica de Dow Theory / Edwards & Magee).",
    sources: ["EDWARDS_MAGEE_2018", "CMT_ASSOCIATION"], tracecomDefined: false,
    whenRelevant: ["Todo ciclo"], whenNotRelevant: [],
    requiredInputs: ["closedCandles", "causalPivots"], measurements: ["structure.trend", "structure.swingLegs"],
    interpretation: { supporting: ["Estrutura alinhada a tese"], counter: ["Estrutura contra"], blockers: [], invalidations: ["Quebra da estrutura de referencia invalida a tese"] },
    commonMisinterpretations: ["Ler estrutura com pivots nao confirmados"], causalityRisks: ["Pivot confirmado apenas k candles depois"], implementationNotes: "pivots causais k=2", testCases: ["UPTREND HH/HL", "DOWNTREND LH/LL", "TRANSITION"],
  }),
  PA_ZONES_SR: pb({
    id: "PA_ZONES_SR", domain: "PRICE_ACTION", concept: "Suporte e resistencia por swings",
    definition: "Zonas derivadas de topos/fundos confirmados recentes; S/R sao regioes, nao linhas exatas (Edwards & Magee).",
    sources: ["EDWARDS_MAGEE_2018"], tracecomDefined: false,
    whenRelevant: ["Localizacao de entrada/pullback"], whenNotRelevant: [],
    requiredInputs: ["closedCandles", "causalPivots"], measurements: ["structure.zones", "zoneDistance"],
    interpretation: { supporting: ["Preco reage na zona a favor da tese"], counter: ["Perda da zona contra a tese"], blockers: [], invalidations: ["Fechamento do outro lado da zona invalida o cenario de defesa"] },
    commonMisinterpretations: ["Exigir preco exato na linha"], causalityRisks: [], implementationNotes: "zonas por ultimo swing high/low + tolerancia ATR", testCases: ["SUPPORT/RESISTANCE presentes"],
  }),
  PA_BREAKOUT_RETEST: pb({
    id: "PA_BREAKOUT_RETEST", domain: "PRICE_ACTION", concept: "Rompimento e reteste",
    definition: "Rompimento: fechamentos alem da zona. Reteste: retorno a zona rompida com defesa (fechamento de volta no lado do rompimento).",
    sources: ["EDWARDS_MAGEE_2018", "KIRKPATRICK_DAHLQUIST_2016"], tracecomDefined: false,
    whenRelevant: ["Apos rompimento de zona relevante"], whenNotRelevant: ["Sem rompimento valido"],
    requiredInputs: ["closedCandles", "structure.zones"], measurements: ["breakoutRetest.breakout", "breakoutRetest.retest", "breakoutRetest.breakdown"],
    interpretation: { supporting: ["Reteste defensavel na direcao do rompimento"], counter: ["Reteste perdendo a zona"], blockers: [], invalidations: ["Fechamento de volta ao range invalida o rompimento"] },
    commonMisinterpretations: ["Rompimento intrabar sem fechamento"], causalityRisks: [], implementationNotes: "exige >= 2 fechamentos alem da zona", testCases: ["breakout true", "retest true", "sem rompimento"],
  }),
  PA_FAILED_BREAKOUT: pb({
    id: "PA_FAILED_BREAKOUT", domain: "PRICE_ACTION", concept: "Rompimento falho (false breakout)",
    definition: "Preco rompe a zona e retorna para dentro do range; armadilha classica de continuacao (Edwards & Magee: 'false moves').",
    sources: ["EDWARDS_MAGEE_2018"], tracecomDefined: false,
    whenRelevant: ["Apos rompimento sem sustentacao"], whenNotRelevant: [],
    requiredInputs: ["closedCandles", "structure.zones"], measurements: ["breakoutRetest.failed"],
    interpretation: { supporting: ["Falha de rompimento na direcao da tese de reversao ao range"], counter: ["Falha contra a tese"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Chamar de falha sem fechamento de volta"], causalityRisks: [], implementationNotes: "janela lookback 30", testCases: ["FAILED_BREAKOUT", "FAILED_BREAKDOWN"],
  }),
  PA_PULLBACK_DEPTH: pb({
    id: "PA_PULLBACK_DEPTH", domain: "PRICE_ACTION", concept: "Pullback: profundidade e distancia em ATR",
    definition: "Correcao contra a tendencia apos impulso; profundidade classificada pela distancia do extremo em ATR (SHALLOW <= 0.5, NORMAL <= 1.5, DEEP > 1.5).",
    sources: ["EDWARDS_MAGEE_2018", "CMT_ASSOCIATION"], tracecomDefined: true,
    whenRelevant: ["Cenario de continuacao apos correcao"], whenNotRelevant: ["Range sem impulso previo"],
    requiredInputs: ["closedCandles", "causalPivots", "atr"], measurements: ["pullback.active", "pullback.depth", "pullback.distanceAtr"],
    interpretation: { supporting: ["Pullback NORMAL com estrutura intacta"], counter: ["DEEP pullback ameacando a estrutura"], blockers: [], invalidations: ["Perda do swing de referencia invalida continuacao"] },
    commonMisinterpretations: ["Tratar todo recuo como pullback operavel"], causalityRisks: [], implementationNotes: "limiares TRACECOM documentados", testCases: ["SHALLOW/NORMAL/DEEP"],
  }),
  PA_BOS_CHOCH: pb({
    id: "PA_BOS_CHOCH", domain: "PRICE_ACTION", concept: "BOS e CHoCH (definicao operacional interna)",
    definition: "Termos de origem comunitaria/SMC sem definicao academica padronizada (documentado). Definicao TRACECOM operacional: BOS = fechamento de candle alem do ultimo swing confirmado na direcao da tendencia; CHoCH = fechamento alem do swing que definia o fim da tendencia (contra a tendencia). Ambos exigem candle FECHADO e pivot confirmado.",
    sources: ["TRACECOM_V3_OPS", "EDWARDS_MAGEE_2018"], tracecomDefined: true,
    whenRelevant: ["Avaliar continuacao vs quebra de estrutura"], whenNotRelevant: ["Estrutura indefinida"],
    requiredInputs: ["closedCandles", "causalPivots"], measurements: ["structure.lastBOS", "structure.lastCHoCH"],
    interpretation: { supporting: ["BOS na direcao da tese"], counter: ["CHoCH contra a tese"], blockers: [], invalidations: ["CHoCH contra a tese mata cenario de continuacao"] },
    commonMisinterpretations: ["Rotular rompimento interno como BOS", "Usar pavio em vez de fechamento", "CHoCH como reversao confirmada"],
    causalityRisks: ["Pivot confirmado apenas k candles depois; nunca rotular antes"], implementationNotes: "definicao formal em docs/research/v3-price-action-playbook.md", testCases: ["BULLISH_BOS", "BEARISH_CHOCH", "sem evento"],
  }),
  PA_MICRO_STRUCTURE: pb({
    id: "PA_MICRO_STRUCTURE", domain: "PRICE_ACTION", concept: "Micro price action (corpo, pavios, sequencia)",
    definition: "Leitura do candle fechado: corpo/range, posicao do fechamento no range, pavios e sequencia de candles na mesma direcao.",
    sources: ["KIRKPATRICK_DAHLQUIST_2016", "EDWARDS_MAGEE_2018"], tracecomDefined: false,
    whenRelevant: ["Refinar timing e qualidade do candle de decisao"], whenNotRelevant: [],
    requiredInputs: ["closedCandles"], measurements: ["micro.bodyRatio", "micro.closeInRange", "micro.streak", "micro.character"],
    interpretation: { supporting: ["Candle decisivo na direcao da tese"], counter: ["Candle indeciso/contra"], blockers: [], invalidations: [] },
    commonMisinterpretations: ["Decidir por 1 candle"], causalityRisks: [], implementationNotes: "usar junto de estrutura e localizacao", testCases: ["DECISIVE", "INDECISIVE"],
  }),
});

export const PLAYBOOK_IDS = Object.freeze(Object.keys(PLAYBOOKS));

export function playbooksFor(domain) {
  return Object.values(PLAYBOOKS).filter((playbook) => playbook.domain === domain);
}

/** Contrato minimo: um playbook sem qualquer campo obrigatorio e invalido (teste de schema). */
export const REQUIRED_PLAYBOOK_FIELDS = Object.freeze([
  "id", "domain", "concept", "definition", "sources", "whenRelevant", "whenNotRelevant",
  "requiredInputs", "measurements", "interpretation", "commonMisinterpretations", "causalityRisks", "implementationNotes", "testCases",
]);

export function validatePlaybooks() {
  const errors = [];
  for (const playbook of Object.values(PLAYBOOKS)) {
    for (const field of REQUIRED_PLAYBOOK_FIELDS) {
      const value = playbook[field];
      const empty = value === undefined || value === null || (Array.isArray(value) && value.length === 0);
      if (empty) errors.push(`${playbook.id ?? "?"}.${field}`);
    }
    if (playbook.sources.some((sourceId) => !SOURCES[sourceId])) errors.push(`${playbook.id}.sources_unknown`);
    if (typeof playbook.tracecomDefined !== "boolean") errors.push(`${playbook.id}.tracecomDefined`);
    if (playbook.tracecomDefined !== true && playbook.sources.includes("TRACECOM_V3_OPS")) errors.push(`${playbook.id}.tracecom_source_mislabeled`);
  }
  return { ok: errors.length === 0, errors, count: Object.keys(PLAYBOOKS).length };
}
