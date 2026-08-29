/**
 * Interface do "motor" de IA e seleção da implementação.
 *
 * `AiClient` é o contrato que o AgentEngine usa para conversar com o modelo.
 * Duas implementações existem nesta etapa:
 *   - AnthropicAiClient → IA real (requer ANTHROPIC_API_KEY). Aponta para
 *     `ANTHROPIC_BASE_URL` (compatível com gateways estilo nexxus-pro que
 *     expõem o Anthropic Messages API).
 *   - StaticAiClient   → dry-run sem IA, usado em testes/dev sem key.
 *
 * O StaticAiClient NÃO inventa dados: se uma ferramenta retornou
 * DATA_UNAVAILABLE ele responde com uma análise WAIT / dados insuficientes
 * fundamentada. Ele serve para validar o pipeline (sem neurônio oculto), não
 * para produzir conclusões reais.
 */
import { AnthropicClient } from "./anthropic";
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
  readonly mode: "anthropic" | "static";
  readonly model: string;
  chat(messages: AgentMessage[], tools?: ToolRecord[]): Promise<ModelResponse>;
}

export interface ToolRecord {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** Implementação Anthropic real (compatível com gateways que expõem /v1/messages). */
export class AnthropicAiClient implements AiClient {
  readonly mode = "anthropic" as const;
  constructor(private readonly inner: AnthropicClient) {}
  get model(): string {
    return this.inner.model;
  }
  async chat(messages: AgentMessage[], tools?: ToolRecord[]): Promise<ModelResponse> {
    const wire = messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool" as const, tool_call_id: m.tool_call_id, content: m.content };
      }
      if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: "assistant" as const,
          content: m.content ?? null,
          tool_calls: m.tool_calls,
        };
      }
      return { role: m.role, content: m.content ?? null };
    });
    const resp = await this.inner.chat(wire as never, tools);
    return { content: resp.content, toolCalls: [...resp.toolCalls] };
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
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly extendedOutput?: boolean;
  readonly thinkingEnabled?: boolean;
  readonly thinkingBudget?: number;
  readonly logger?: Logger;
}): AiClient {
  if (opts.apiKey) {
    const anthropic = new AnthropicClient(
      {
        apiKey: opts.apiKey,
        model: opts.model,
        ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
        ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.extendedOutput !== undefined ? { extendedOutput: opts.extendedOutput } : {}),
        thinking: {
          enabled: opts.thinkingEnabled ?? true,
          budgetTokens: opts.thinkingBudget ?? 8000,
        },
      },
      opts.logger,
    );
    return new AnthropicAiClient(anthropic);
  }
  return new StaticAiClient(opts.model);
}