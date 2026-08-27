/**
 * Cliente Groq padrão (tool calling).
 *
 * A Groq é a camada principal de IA, mas atua como ORQUESTRADOR de ferramentas:
 * ela recebe as instruções + descrições de tools, decide quais invocar e devolve
 * a resposta. A matemática e os dados NUNCA são produzidos pelo modelo — sempre
 * pelas ferramentas.
 */
import Groq from "groq-sdk";
import type { ToolRecord } from "../tools/registry";
import type { Logger } from "../observability/logger";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content?: string;
  readonly tool_call_id?: string;
  readonly tool_calls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: string; // JSON string
}

export interface ToolResultMessage {
  readonly tool_call_id: string;
  readonly output: string;
}

export interface ModelResponse {
  readonly content: string | null;
  readonly toolCalls: ToolCallRequest[];
}

export interface GroqClientConfig {
  readonly apiKey: string;
  readonly model: string;
}

/** Mensagens trocadas no loop do agente (acumuladas para contexto/auditoria). */
export type AgentChat = ChatMessage[];

export class GroqClient {
  private readonly client: Groq;
  private readonly modelName: string;

  constructor(config: GroqClientConfig, private readonly logger?: Logger) {
    if (!config.apiKey) {
      throw new Error("GROQ_API_KEY ausente. Defina a chave no .env para usar a Groq real.");
    }
    this.client = new Groq({ apiKey: config.apiKey });
    this.modelName = config.model;
  }

  get model(): string {
    return this.modelName;
  }

  /**
   * Envia uma rodada de mensagens + tools e devolve a resposta do modelo.
   * `tools` é opcional: quando ausente, o modelo responde texto puro.
   */
  async chat(
    messages: AgentChat,
    tools?: ToolRecord[],
  ): Promise<ModelResponse> {
    const span = this.logger?.span("groq.chat");
    try {
      const hasTools = !!tools && tools.length > 0;
      const completion = await this.client.chat.completions.create({
        model: this.modelName,
        messages: messages.map((m) => this.toWire(m)),
        tools: hasTools
          ? tools.map((t) => ({
              type: "function" as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }))
          : undefined,
        tool_choice: hasTools ? "auto" : undefined,
      });

      const choice = completion.choices[0]?.message;
      const content = choice?.content ?? null;
      const toolCalls = (choice?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments ?? "{}",
      }));
      span?.end({ contentChars: content?.length ?? 0, toolCalls: toolCalls.length });
      return { content, toolCalls };
    } catch (err) {
      span?.fail(err);
      throw err;
    }
  }

  private toWire(m: ChatMessage): Groq.Chat.Completions.ChatCompletionMessageParam {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.tool_call_id ?? "",
        content: m.content ?? "",
      } as Groq.Chat.Completions.ChatCompletionMessageParam;
    }
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: m.content ?? null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      } as Groq.Chat.Completions.ChatCompletionMessageParam;
    }
    return {
      role: m.role,
      content: m.content ?? null,
    } as Groq.Chat.Completions.ChatCompletionMessageParam;
  }
}
