/**
 * ABLATION LAB — remove componentes do V4 EXPERIMENTALMENTE, sem tocar no V4 implantado.
 *
 * Copia o bundle de features e zera os campos pedidos, rodando os MESMOS especialistas/sintese
 * importados (puros). Nada de alterar o engine em producao.
 */
import { buildAgentFeatures } from "../agents-v4/features.mjs";
import { analyzeMarketRegime } from "../agents-v4/specialists/regime.mjs";
import { analyzeMarketStructure } from "../agents-v4/specialists/structure.mjs";
import { analyzeTrend } from "../agents-v4/specialists/trend.mjs";
import { analyzeLocation } from "../agents-v4/specialists/location.mjs";
import { analyzeMomentum } from "../agents-v4/specialists/momentum.mjs";
import { analyzeVolatility } from "../agents-v4/specialists/volatility.mjs";
import { analyzePriceAction } from "../agents-v4/specialists/price-action.mjs";
import { analyzeMicrostructure } from "../agents-v4/specialists/microstructure.mjs";
import { analyzeScenario } from "../agents-v4/specialists/scenario.mjs";
import { synthesize } from "../agents-v4/synthesis.mjs";

export const ABLATION_LAB_VERSION = "agents-v4-ablation-lab-v1";

export const ABLATION_COMPONENTS = Object.freeze({
  RSI: ["rsi", "rsiSlope"],
  ADX: ["adx", "adxSlope", "plusDI", "minusDI", "diSpread", "diSpreadSlope", "diAlignedUp"],
  STRUCTURE: ["structureLabel", "structure1m", "higherHigh", "higherLow", "lowerHigh", "lowerLow", "bosUp", "bosDown", "bosType"],
  LOCATION: ["donchianPosition", "distanceToUpperATR", "distanceToLowerATR", "overextended", "midLocation"],
  MICROSTRUCTURE: ["ticksAvailable", "tickCount", "tickDirection", "tickPressure", "tickVelocity", "tickAcceleration", "tickArrivalRate", "tickDirectionChanges", "tickBursts", "tickShortTermVol"],
  HTF: ["structure1m", "structure1mHH", "structure1mHL", "structure1mLH", "structure1mLL", "context5m", "context5mAvailable"],
  VELOCITY: ["velocity", "velocityATR"],
  ACCELERATION: ["acceleration", "accelerationATR"],
  VOLATILITY: ["atr", "atrRatio", "atrSlope", "realizedVol", "bollingerWidthATR", "compressionState", "compressed", "expanded"],
  PRICE_ACTION: ["bodyRatio", "upperWick", "lowerWick", "closeLocation", "candleDirection", "streak", "candleSequence"],
});

function maskFeatures(features, components) {
  const masked = { ...features };
  for (const component of components) for (const field of ABLATION_COMPONENTS[component] ?? []) masked[field] = null;
  return masked;
}

export function evaluateAblation({ t0, dataQuality = "HEALTHY", riskState = "ELIGIBLE", components = [] } = {}) {
  const features = maskFeatures(buildAgentFeatures(t0), components);
  const specialists = {
    MARKET_REGIME_AGENT: analyzeMarketRegime({ features, t0, dataQuality }),
    MARKET_STRUCTURE_AGENT: analyzeMarketStructure({ features, dataQuality }),
    TREND_AGENT: analyzeTrend({ features, dataQuality }),
    LOCATION_AGENT: analyzeLocation({ features, dataQuality }),
    MOMENTUM_AGENT: analyzeMomentum({ features, dataQuality }),
    VOLATILITY_AGENT: analyzeVolatility({ features, dataQuality }),
    PRICE_ACTION_AGENT: analyzePriceAction({ features, dataQuality }),
    MICROSTRUCTURE_AGENT: analyzeMicrostructure({ features, t0, dataQuality }),
  };
  specialists.SCENARIO_AGENT = analyzeScenario({ features, specialists, dataQuality });
  const synthesis = synthesize({ features, specialists, scenario: specialists.SCENARIO_AGENT, riskState, dataQualityState: dataQuality });
  return {
    components: [...components],
    action: synthesis.action,
    scenario: synthesis.primaryScenario,
    regime: specialists.MARKET_REGIME_AGENT.state,
    triggerState: synthesis.triggerState,
    whyNow: synthesis.whyNow,
    confidenceClass: synthesis.confidenceClass,
    researchOnly: true,
  };
}

export function ablationMatrix({ t0, dataQuality = "HEALTHY", riskState = "ELIGIBLE", components = Object.keys(ABLATION_COMPONENTS) } = {}) {
  const full = evaluateAblation({ t0, dataQuality, riskState, components: [] });
  const rows = [full, ...components.map((component) => evaluateAblation({ t0, dataQuality, riskState, components: [component] }))];
  const changed = rows.filter((row) => row.components.length && row.action !== full.action);
  return {
    version: ABLATION_LAB_VERSION,
    full,
    rows,
    sensitivity: {
      examined: rows.length - 1,
      actionChanged: changed.length,
      changedComponents: changed.map((row) => ({ components: row.components, from: full.action, to: row.action })),
    },
    researchOnly: true,
    deployedV4Untouched: true,
  };
}
