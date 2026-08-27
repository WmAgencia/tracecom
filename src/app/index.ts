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
import { providerFromConfig } from "../market/registry";
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
  const provider = providerFromConfig(config);
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
    apiKey: config.groq.apiKey,
    model: config.groq.model,
    logger,
  });

  const engine = new AgentEngine({
    config: { nodeEnv: config.nodeEnv },
    ai,
    tools,
    logger,
    model: config.groq.model,
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
