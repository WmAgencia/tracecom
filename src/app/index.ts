/**
 * Composição da aplicação Tracecon (Etapa 1).
 *
 * Este módulo junta as peças: config, logger, provider de mercado, registry de
 * ferramentas, cliente de IA e o motor de agente. Serve como o ponto único de
 * injeção e também como referência de como montar a aplicação. Para testes,
 * os componentes podem ser injetados individualmente (ver testes).
 */
import { createAiClient } from "../ai/client";
import type { AiClient } from "../ai/client";
import { AgentEngine } from "../agent/engine";
import { loadConfig } from "../config/env";
import type { EnvConfig } from "../config/env";
import type { Instrument } from "../domain/types";
import { resolveProvider as resolveV2Provider } from "../market/registryV2";
import { providerFromConfig as resolveLegacyProvider } from "../market/registry";
import type { MarketDataProvider as LegacyProvider } from "../market/provider";
import type { MarketDataProvider as V2Provider } from "../market/providerV2";
import type { MarketDataProvider } from "../market/provider";
import { createLogger } from "../observability/logger";
import type { Logger } from "../observability/logger";
import { Datastore } from "../store/db";
import { SqliteAnalysisRepository } from "../store/repositories/sqliteAnalysisRepository";
import { ToolRegistry } from "../tools/registry";
import { registerMarketDataTools } from "../tools/definitions/marketData";

export interface TraceconApp {
  readonly config: EnvConfig;
  readonly logger: Logger;
  readonly provider: MarketDataProvider;
  readonly tools: ToolRegistry;
  readonly ai: AiClient;
  readonly engine: AgentEngine;
  readonly store: Datastore;
  readonly repo: SqliteAnalysisRepository;
  resolveInstrument(symbol: string): Instrument;
  close(): void;
}

export function createApp(env: NodeJS.ProcessEnv = process.env): TraceconApp {
  const config = loadConfig(env);
  const logger = createLogger(config);
  // P-AN: usar registry V2 quando disponível (Forex/crypto real conforme o
  // modo). Fallback ao
  // legado se V2 não resolver. Interfaces V1 e V2 têm shapes diferentes;
  // o resto do pipeline ainda depende de V1 — por isso o cast explícito
  // com log para diagnosticar.
  const v2Raw = resolveV2Provider(config);
  const v2 = v2Raw as V2Provider | null;
  const v1 = v2 ? null : resolveLegacyProvider(config);
  const provider = (v1 ?? v2) as LegacyProvider;
  if (v2) {
    logger.info("market.provider.v2.active", undefined, { id: (v2 as unknown as { id: string }).id });
  } else {
    logger.warn("market.provider.legacy.active", undefined, { reason: "v2 returned null" });
  }
  const tools = new ToolRegistry({ maxConcurrentTools: 4, maxToolCalls: 12 });

  const resolveInstrument = (symbol: string): Instrument => ({
    symbol: symbol.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    label: symbol,
    kind: symbol.includes("USDT") ? "spot" : "spot",
    quote: symbol.toUpperCase().includes("USDT") ? "USDT" : "USD",
    providerId: provider.id,
  });

  registerMarketDataTools(tools, provider, resolveInstrument);

  const ai = createAiClient({
    apiKey: config.anthropic.apiKey,
    baseUrl: config.anthropic.baseUrl,
    model: config.anthropic.model,
    maxTokens: config.anthropic.maxTokens,
    extendedOutput: config.anthropic.extendedOutput,
    thinkingEnabled: config.anthropic.thinkingEnabled,
    thinkingBudget: config.anthropic.thinkingBudget,
    logger,
  });

  const engine = new AgentEngine({
    config: { nodeEnv: config.nodeEnv },
    ai,
    tools,
    logger,
    model: config.anthropic.model,
  });

  const store = new Datastore({ path: config.database.path, logger });
  const repo = new SqliteAnalysisRepository(store, logger);

  return {
    config,
    logger,
    provider,
    tools,
    ai,
    engine,
    store,
    repo,
    resolveInstrument,
    close: () => store.close(),
  };
}
