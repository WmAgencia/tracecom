/**
 * AgentEngine: orquestra a investigação por trás de uma análise.
 *
 * Ciclo:
 *   1. Recebe a solicitação do usuário (ativo, timeframe, horizonte).
 *   2. Monta o prompt de sistema com as regras do produto (não inventar dados,
 *      buscar contraponto, poder responder WAIT).
 *   3. Loop de tool calling: a IA (Groq) decide a próxima ferramenta; o engine
 *      valida (registry), executa e devolve o resultado, com limites de
 *      segurança que impedem loop excessivo.
 *   4. Consolida o resultado em uma `Analysis` com rastro de auditoria completo.
 *
 * A IA é um ORQUESTRADOR de ferramentas — não calcula nem inventa nada.
 */
import type { AiClient } from "../ai/client";
import type { EnvConfig } from "../config/env";
import type {
  Analysis,
  DataAvailability,
  Instrument,
  Timeframe,
} from "../domain/types";
import type { Logger } from "../observability/logger";
import { ToolRegistry } from "../tools/registry";
import { AnalysisBuilder, VERSION } from "../analysis/model";
import { canContinue, DEFAULT_SAFETY_LIMITS } from "./safety";
import type { SafetyLimits } from "./safety";

export interface AgentRequest {
  readonly instrument: Instrument;
  readonly timeframe: Timeframe;
  readonly horizon: string;
  readonly input: string;
}

const SYSTEM_PROMPT = `Você é o agente de investigação da TRACECON.

OBJETIVO
Você investiga um cenário de mercado que o usuário está vendo em uma corretora
real. Você reúne evidências quantitativas e contextuais ANTES de concluir.

REGRAS INEGOCIÁVEIS
1. NUNCA invente dados (preços, candles, volume, notícias, eventos, fontes,
   probabilidades, resultados históricos, métricas). Se uma informação não
   estiver disponível, sinalize-a como indisponível.
2. Use as ferramentas fornecidas para obter dados. Você é um ORQUESTRADOR de
   ferramentas — não calcule nem invente por conta própria.
3. SEJA PARCIMONIOSO. Só consulte o necessário. Não repita consultas; aproveite
   resultados já obtidos. Pré-cálculos e dados contínuos já vêm das ferramentas.
4. BUSQUE CONTRAPROVA. Quando encontrar evidências favoráveis a uma operação,
   procure ativamente fatores que a invalidem. Pergunte sempre: "o que faria
   esta análise estar errada?".
5. NUNCA afirme probabilidade sem base numérica observada. Se não houver
   amostra/cálculo que a sustente, diga explicitamente que é desconhecida.
6. Não tenha medo de concluir WAIT. É uma decisão válida e frequentemente a
   mais correta quando há dados insuficientes ou conflitos.
7. TRACECON NUNCA executa ordens, compra, vende ou custodia ativos. Você é um
   sistema de inteligência e análise. Não proponha executar transações.
8. Justifique cada conclusão citando as fontes e ferramentas usadas.`;

export interface AgentEngineOptions {
  readonly config: Pick<EnvConfig, "nodeEnv">;
  readonly ai: AiClient;
  readonly tools: ToolRegistry;
  readonly logger?: Logger;
  readonly limits?: SafetyLimits;
  readonly model?: string;
}

export class AgentEngine {
  readonly #ai: AiClient;
  readonly #tools: ToolRegistry;
  readonly #logger?: Logger;
  readonly #limits: SafetyLimits;
  readonly #model: string;
  #hadValidData = false;

  constructor(opts: AgentEngineOptions) {
    this.#ai = opts.ai;
    this.#tools = opts.tools;
    this.#logger = opts.logger;
    this.#limits = opts.limits ?? DEFAULT_SAFETY_LIMITS;
    this.#model = opts.model ?? opts.ai.model;
  }

  async analyze(req: AgentRequest): Promise<Analysis> {
    const start = Date.now();
    const builder = new AnalysisBuilder({
      instrument: req.instrument,
      timeframe: req.timeframe,
      horizon: req.horizon,
      input: req.input,
      version: {
        ...VERSION,
        model: this.#model,
        promptVersion: "v0",
        agentVersion: "0.1.0",
      },
    });

    builder.addStep("identify_instrument");
    builder.addStep("identify_market");
    builder.addStep("identify_timeframe");
    builder.addStep("identify_horizon");

    const toolList = this.#tools.listForModel();
    const messages: Parameters<AiClient["chat"]>[0] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: req.input },
    ];

    let rounds = 0;
    let toolCalls = 0;

    // Em modo estático (sem chave Groq), a IA não chama ferramentas por conta
    // própria. Para o pipeline ainda ser exercitado (e NÃO inventar dados),
    // executamos um conjunto mínimo e determinístico de leituras defensivas.
    const useStaticProbe = this.#ai.mode === "static";
    const probeTools = ["get_candles", "get_volume", "get_liquidity_metrics"] as const;

    try {
      if (useStaticProbe) {
        for (const tool of probeTools) {
          if (toolCalls >= this.#limits.maxToolCalls) break;
          await this.#invokeTool(builder, messages, {
            id: `static-${tool}`,
            name: tool,
            arguments: JSON.stringify({ symbol: req.instrument.symbol }),
          });
          toolCalls++;
        }
        return this.#finalize(builder, start);
      }

      while (canContinue({ rounds, toolCalls }, this.#limits)) {
        if (rounds >= this.#limits.maxAgentRounds || toolCalls >= this.#limits.maxToolCalls) break;
        rounds++;

        const response = await this.#ai.chat(messages, toolList);
        if (response.content) builder.addObservation(response.content);

        if (!response.toolCalls || response.toolCalls.length === 0) {
          break;
        }

        for (const call of response.toolCalls) {
          if (toolCalls >= this.#limits.maxToolCalls) break;
          toolCalls++;
          await this.#invokeTool(builder, messages, call);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.#logger?.error("agent.error", {}, { message: msg });
      builder.addObservation(`Erro no ciclo do agente: ${err instanceof Error ? err.message : String(err)}`);
      builder.addCounter(`Erro de execução: ${err instanceof Error ? err.message : String(err)}`);
    }

    return this.#finalize(builder, start);
  }

  /** Executa uma ferramenta, registra auditoria e devolve o resultado ao modelo. */
  async #invokeTool(
    builder: AnalysisBuilder,
    messages: Parameters<AiClient["chat"]>[0],
    call: { id: string; name: string; arguments: string },
  ): Promise<void> {
    const t0 = Date.now();
    let parsedArgs: Record<string, unknown> = {};
    if (call.arguments) {
      try {
        parsedArgs = JSON.parse(call.arguments);
      } catch {
        parsedArgs = {};
      }
    }

    let availability: DataAvailability = "UNAVAILABLE";
    let result: unknown;
    let error: string | undefined;
    try {
      result = await this.#tools.invoke(call.name, parsedArgs);
      const r = result as { availability?: DataAvailability } | undefined;
      if (r?.availability) availability = r.availability;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const t1 = Date.now();

    if (availability === "AVAILABLE") {
      this.#hadValidData = true;
      builder.addSource(call.name);
    }
    builder.recordToolCall({
      tool: call.name,
      arguments: parsedArgs,
      startedAt: t0,
      finishedAt: t1,
      availability,
      ...(error ? { error } : {}),
    });
    builder.addStep(`tool:${call.name}`);

    const output = error
      ? JSON.stringify({ error })
      : JSON.stringify(result ?? { availability: "UNAVAILABLE", message: "Sem resultado." });
    messages.push(
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: call.id, name: call.name, arguments: call.arguments }],
      },
      { role: "tool", content: output, tool_call_id: call.id },
    );
  }

  #finalize(builder: AnalysisBuilder, start: number): Analysis {
    builder.addCalculation(`analysis.durationMs=${Date.now() - start}`);
    return builder.build({ quality: "unknown", incomplete: !this.#hadValidData });
  }
}
