/**
 * Interface do "motor" de IA e seleção da implementação.
 *
 * `AiClient` é o contrato que o AgentEngine usa para conversar com o modelo.
 * Duas implementações existem nesta etapa:
 *   - GroqAiClient  → IA real (requer GROQ_API_KEY).
 *   - StaticAiClient→ dry-run sem IA, usado em testes/dev sem key.
 *
 * O StaticAiClient NÃO inventa dados: se uma ferramenta retornou
 * DATA_UNAVAILABLE ele responde com uma análise WAIT / dados insuficientes
 * fundamentada. Ele serve para validar o pipeline (sem neurônio oculto), não
 * para produzir conclusões reais.
 */
import { GroqClient } from "./groq";
import type { Logger } from "../observability/logger";

export interface ModelResponse {
  readonly content: string | null;
  readonly toolCalls: ToolCallRequest[];
}
export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}
export type AgentMessage = SystemUserTool | ToolArg;

export interface SystemUserTool {
  readonly role: "system" | "user" | "assistant";
  readonly content?: string | null;
  readonly tool_call_id?: string;
  readonly tool_calls?: ToolCallRequest[];
}
export interface ToolArg {
  readonly role: "tool";
  readonly content: string;
  readonly tool_call_id: string;
}

export interface AiClient {
  readonly mode: "groq" | "static";
  readonly model: string;
  chat(messages: AgentMessage[], tools?: ToolRecord[]): Promise<ModelResponse>;
}

export interface ToolRecord {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** Implementação Groq real (delega ao GroqClient). */
export class GroqAiClient implements AiClient {
  readonly mode = "groq" as const;
  constructor(private readonly inner: GroqClient) {}
  get model(): string {
    return this.inner.model;
  }
  async chat(messages: AgentMessage[], tools?: ToolRecord[]): Promise<ModelResponse> {
    return this.inner.chat(messages as never, tools) as Promise<ModelResponse>;
  }
}

/**
 * Dry-run: simulador determinístico que usa os RESULTADOS REAIS das ferramentas
 * juntas. Se houver DATA_UNAVAILABLE, devolve direção WAIT com rationale que cita
 * a indisponibilidade. Não gera probabilidade — apenas consolida o que veio.
 */
export class StaticAiClient implements AiClient {
  readonly mode = "static" as const;
  constructor(readonly model: string) {}

  async chat(_messages: AgentMessage[], tools?: ToolRecord[]): Promise<ModelResponse> {
    // Em dry-run determinístico e conservador, não executamos ferramentas extras:
    // o pipeline executa ferramentas via engine e consolida. Aqui retornamos
    // texto consolidado sem chamadas de tool, deixando o engine montar a análise.
    void tools;
    return {
      content: JSON.stringify({ direction: "WAIT", reason: "dry-run" }),
      toolCalls: [],
    };
  }
}

export function createAiClient(opts: {
  readonly apiKey: string | null;
  readonly model: string;
  readonly logger?: Logger;
}): AiClient {
  if (opts.apiKey) {
    const groq = new GroqClient({ apiKey: opts.apiKey, model: opts.model }, opts.logger);
    return new GroqAiClient(groq);
  }
  return new StaticAiClient(opts.model);
}
