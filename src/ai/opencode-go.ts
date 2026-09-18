/**
 * Cliente OpenCode Go (HTTP) para TRACECON — provider PADRÃO.
 *
 * Implementa o subconjunto necessário da API OpenAI-compatible exposta em
 * `https://opencode.ai/zen/go/v1/chat/completions`. Usa fetch nativo do
 * Node 22+ — sem dependências extras.
 *
 * Headers:
 *   authorization: Bearer <OPENCODE_GO_API_KEY>
 *   x-opencode-session: <id derivado, nunca a chave>
 *   content-type: application/json
 *
 * A chave é lida SOMENTE de `OPENCODE_GO_API_KEY` (via src/config/env.ts) e
 * NUNCA é logada/serializada: erros passam por `redactSecrets`.
 *
 * Tool calling (formato OpenAI):
 *   - tools: [{ type: "function", function: { name, description, parameters } }]
 *   - O modelo devolve `finish_reason: "tool_calls"` com blocos `tool_calls`.
 */
import { createHash, randomUUID } from "node:crypto";
import type { ToolRecord } from "../tools/registry";
import type { Logger } from "../observability/logger";
import { redactSecrets } from "../observability/logger";

export const OPENCODE_GO_DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_GO_DEFAULT_MODEL = "deepseek-v4.1-flash";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 60_000;

/** Mensagens no formato interno do agente (mesmo shape do adaptador Anthropic). */
export type OpenCodeGoChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{ id: string; name: string; arguments: string }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpenCodeGoToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface OpenCodeGoResponse {
  readonly content: string | null;
  readonly toolCalls: OpenCodeGoToolCall[];
  /** `finish_reason` bruto do provider (ex.: "stop", "tool_calls"). */
  readonly finishReason: string | null;
  readonly usage?: { input_tokens: number; output_tokens: number };
}

export interface OpenCodeGoClientConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  /** Id de correlação opcional; nunca deve conter segredos. */
  readonly sessionId?: string;
}

/** Deriva um session id estável e sem segredos (mesma convenção do relay). */
export function sessionForOpenCodeGo(basis?: string): string {
  return `tc-${createHash("sha256").update(basis || randomUUID()).digest("hex").slice(0, 16)}`;
}

export class OpenCodeGoClient {
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly sessionId: string;

  constructor(config: OpenCodeGoClientConfig, private readonly logger?: Logger) {
    if (!config.apiKey) {
      throw new Error("OPENCODE_GO_API_KEY ausente. Defina a chave no .env para usar o agente IA.");
    }
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? OPENCODE_GO_DEFAULT_BASE_URL).replace(/\/$/, "");
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sessionId = sessionForOpenCodeGo(config.sessionId);
  }

  async chat(messages: OpenCodeGoChatMessage[], tools?: ToolRecord[]): Promise<OpenCodeGoResponse> {
    const span = this.logger?.span("opencode_go.chat");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const request = this.buildRequest(messages, tools);
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      const bodyText = await response.text().catch(() => "");
      if (!response.ok) {
        const err = new Error(
          `OpenCode Go API ${response.status} ${response.statusText}: ${redactSecrets(bodyText).slice(0, 500)}`,
        );
        span?.fail(err);
        throw err;
      }
      const parsed = this.parseResponse(JSON.parse(bodyText) as OpenAiChatCompletion);
      span?.end({
        contentChars: parsed.content?.length ?? 0,
        toolCalls: parsed.toolCalls.length,
        finishReason: parsed.finishReason ?? "unknown",
        in: parsed.usage?.input_tokens ?? null,
        out: parsed.usage?.output_tokens ?? null,
      });
      return parsed;
    } catch (err) {
      span?.fail(err);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildRequest(
    messages: OpenCodeGoChatMessage[],
    tools: ToolRecord[] | undefined,
  ): { body: Record<string, unknown>; headers: Record<string, string> } {
    const wire = messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool" as const, tool_call_id: m.tool_call_id, content: m.content };
      }
      if (m.role === "assistant") {
        if (m.tool_calls && m.tool_calls.length > 0) {
          return {
            role: "assistant" as const,
            content: m.content ?? null,
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.arguments },
            })),
          };
        }
        return { role: "assistant" as const, content: m.content ?? null };
      }
      return { role: m.role, content: m.content };
    });
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: wire,
    };
    if (tools && tools.length > 0) {
      body.tools = tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
      "x-opencode-session": this.sessionId,
    };
    return { body, headers };
  }

  private parseResponse(json: OpenAiChatCompletion): OpenCodeGoResponse {
    const choice = json.choices?.[0];
    const message = choice?.message;
    const rawContent = message?.content;
    const content =
      typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.map((part) => (typeof part?.text === "string" ? part.text : "")).join("")
          : null;
    const toolCalls: OpenCodeGoToolCall[] = Array.isArray(message?.tool_calls)
      ? message.tool_calls
          .map((call) => ({
            id: String(call?.id ?? ""),
            name: String(call?.function?.name ?? ""),
            arguments:
              typeof call?.function?.arguments === "string"
                ? call.function.arguments
                : JSON.stringify(call?.function?.arguments ?? {}),
          }))
          .filter((call) => call.name.length > 0)
      : [];
    return {
      content: content && content.length > 0 ? content : null,
      toolCalls,
      finishReason: choice?.finish_reason ?? null,
      usage: json.usage
        ? {
            input_tokens: Number(json.usage.prompt_tokens ?? 0),
            output_tokens: Number(json.usage.completion_tokens ?? 0),
          }
        : undefined,
    };
  }
}

interface OpenAiChatCompletion {
  readonly choices?: Array<{
    readonly message?: {
      readonly content?: string | Array<{ readonly text?: string }> | null;
      readonly tool_calls?: Array<{
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: unknown };
      }>;
    };
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}
