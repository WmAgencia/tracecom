/**
 * Cliente Anthropic (HTTP) para TRACECON.
 *
 * Implementa o subconjunto necessário do Anthropic Messages API
 * (https://docs.anthropic.com/en/api/messages) sobre qualquer base_url
 * compatível. Usamos fetch nativo do Node 20+ — sem dependências extras.
 *
 * Endpoints exercidos:
 *   POST {baseUrl}/v1/messages  — chat (texto + tool_use + tool_result)
 *
 * Headers padrão:
 *   x-api-key: <ANTHROPIC_API_KEY>
 *   anthropic-version: 2023-06-01
 *   content-type: application/json
 *
 * Headers opcionais (ativados por config):
 *   anthropic-beta: extended-output-...    — libera output > 8k tokens
 *   extra-allow-large-output-tokens: true   — alternativa mais portável
 *
 * Recursos avançados (com fallback gracioso se o gateway não suportar):
 *   - thinking: { type: "enabled", budget_tokens } — raciocínio profundo
 *     antes da resposta visível. Default OFF aqui para não aumentar latência
 *     sem o usuário pedir explicitamente; ativado via `thinking: { enabled }`.
 *   - max_tokens > 8192 — exige header beta de extended output; se o gateway
 *     rejeitar, o cliente re-tenta sem thinking e/ou com max_tokens=8192.
 *
 * Tool calling:
 *   - tools: [{ name, description, input_schema }]
 *   - O modelo devolve `stop_reason: "tool_use"` com blocos `tool_use`.
 *   - Fornecemos os resultados na próxima rodada via bloco `tool_result`.
 *
 * Esta camada é estritamente um ORQUESTRADOR: a matemática e os dados vêm
 * das ferramentas; o modelo apenas decide o que chamar em seguida.
 */
import type { ToolRecord } from "../tools/registry";
import type { Logger } from "../observability/logger";

/** Mensagens no formato interno do agente (independente do provedor). */
export type AnthropicChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: Array<{ id: string; name: string; arguments: string }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AnthropicToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface AnthropicResponse {
  readonly content: string | null;
  readonly toolCalls: AnthropicToolCall[];
  readonly stopReason: string | null;
  readonly usage?: { input_tokens: number; output_tokens: number };
  /** Texto bruto do bloco `thinking` se o gateway expôs. Não exibido por padrão. */
  readonly thinking?: string | null;
}

export interface AnthropicThinkingConfig {
  readonly enabled: boolean;
  /** Tokens reservados para raciocínio. Default 8000. */
  readonly budgetTokens: number;
}

export interface AnthropicClientConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  /** Solicita output estendido via header `extra-allow-large-output-tokens`. */
  readonly extendedOutput?: boolean;
  /** Thinking blocks (raciocínio profundo). Veja AnthropicThinkingConfig. */
  readonly thinking?: AnthropicThinkingConfig;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_THINKING_BUDGET = 8000;
const ANTHROPIC_VERSION = "2023-06-01";
const EXTENDED_OUTPUT_HEADER_VALUE = "true";

export class AnthropicClient {
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly extendedOutput: boolean;
  private readonly thinking: AnthropicThinkingConfig;
  /** Memória de fallback: uma vez que o gateway rejeita thinking, não tenta mais. */
  private thinkingDisabledByGateway = false;
  /** Memória de fallback: uma vez que o gateway rejeita extended output, não tenta mais. */
  private extendedOutputDisabledByGateway = false;

  constructor(config: AnthropicClientConfig, private readonly logger?: Logger) {
    if (!config.apiKey) {
      throw new Error("ANTHROPIC_API_KEY ausente. Defina a chave no .env para usar o agente IA.");
    }
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.extendedOutput = config.extendedOutput ?? true;
    this.thinking = {
      enabled: config.thinking?.enabled ?? false,
      budgetTokens: config.thinking?.budgetTokens ?? DEFAULT_THINKING_BUDGET,
    };
  }

  /**
   * Executa uma rodada de chat. Se houver tools, o modelo pode responder com
   * `tool_use` blocks; nós normalizamos para `{id, name, arguments}`.
   *
   * Comportamento de fallback:
   *   1. Se thinking estiver ativo e o gateway rejeitar, re-tenta sem thinking.
   *   2. Se max_tokens > 8192 e o gateway rejeitar, re-tenta com 8192.
   */
  async chat(messages: AnthropicChatMessage[], tools?: ToolRecord[]): Promise<AnthropicResponse> {
    const span = this.logger?.span("anthropic.chat");
    try {
      const hasTools = !!tools && tools.length > 0;
      const { system, wire } = this.toWire(messages);

      // 1ª tentativa com thinking+extended (se habilitados)
      let attempt = this.buildRequest(system, wire, hasTools, tools, {
        thinking: this.thinking.enabled && !this.thinkingDisabledByGateway,
        extendedOutput: this.extendedOutput && !this.extendedOutputDisabledByGateway,
      });

      let { res, bodyText } = await this.dispatch(attempt);
      let degraded = false;

      // Fallback: thinking rejeitado
      if (
        !res.ok &&
        this.thinking.enabled &&
        !this.thinkingDisabledByGateway &&
        /thinking|400|invalid/i.test(bodyText)
      ) {
        this.thinkingDisabledByGateway = true;
        this.logger?.warn("anthropic.thinking.disabled_by_gateway", {});
        attempt = this.buildRequest(system, wire, hasTools, tools, {
          thinking: false,
          extendedOutput: !this.extendedOutputDisabledByGateway,
        });
        ({ res, bodyText } = await this.dispatch(attempt));
        degraded = true;
      }

      // Fallback: extended output rejeitado
      if (
        !res.ok &&
        this.extendedOutput &&
        !this.extendedOutputDisabledByGateway &&
        this.maxTokens > 8192 &&
        /max_tokens|extended|too large|invalid|400/i.test(bodyText)
      ) {
        this.extendedOutputDisabledByGateway = true;
        this.logger?.warn("anthropic.extended_output.disabled_by_gateway", {});
        attempt = this.buildRequest(system, wire, hasTools, tools, {
          thinking: this.thinking.enabled && !this.thinkingDisabledByGateway,
          extendedOutput: false,
          forceMaxTokens: 8192,
        });
        ({ res, bodyText } = await this.dispatch(attempt));
        degraded = true;
      }

      if (!res.ok) {
        const err = new Error(
          `Anthropic API ${res.status} ${res.statusText}: ${bodyText.slice(0, 500)}`,
        );
        span?.fail(err);
        throw err;
      }

      const json = JSON.parse(bodyText) as AnthropicMessagesResponse;
      const parsed = this.parseResponse(json);
      span?.end({
        contentChars: parsed.content?.length ?? 0,
        toolCalls: parsed.toolCalls.length,
        stopReason: parsed.stopReason ?? "unknown",
        in: parsed.usage?.input_tokens ?? null,
        out: parsed.usage?.output_tokens ?? null,
        degraded,
      });
      return parsed;
    } catch (err) {
      span?.fail(err);
      throw err;
    }
  }

  /**
   * Constrói o body + headers para uma tentativa. `flags.controla` quais
   * recursos avançados enviar.
   */
  private buildRequest(
    system: string | null,
    wire: Array<Record<string, unknown>>,
    hasTools: boolean,
    tools: ToolRecord[] | undefined,
    flags: {
      thinking: boolean;
      extendedOutput: boolean;
      forceMaxTokens?: number;
    },
  ): { body: Record<string, unknown>; headers: Record<string, string> } {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: flags.forceMaxTokens ?? this.maxTokens,
      messages: wire,
    };
    if (system) body.system = system;
    if (hasTools && tools) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    if (flags.thinking) {
      // Thinking exige temperature=1 e max_tokens > budget_tokens.
      body.thinking = { type: "enabled", budget_tokens: this.thinking.budgetTokens };
      body.temperature = 1;
      if ((body.max_tokens as number) <= this.thinking.budgetTokens) {
        body.max_tokens = this.thinking.budgetTokens + 4096;
      }
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
    if (flags.extendedOutput && (body.max_tokens as number) > 8192) {
      headers["extra-allow-large-output-tokens"] = EXTENDED_OUTPUT_HEADER_VALUE;
      headers["anthropic-beta"] = "extended-output-2025-01-01";
    }
    return { body, headers };
  }

  private async dispatch(req: {
    body: Record<string, unknown>;
    headers: Record<string, string>;
  }): Promise<{ res: Response; bodyText: string }> {
    const url = `${this.baseUrl}/v1/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(req.body),
    });
    const bodyText = await res.text().catch(() => "");
    return { res, bodyText };
  }

  /**
   * Converte mensagens internas para o wire format do Anthropic.
   * - `system` vira campo separado
   * - `assistant` com tool_calls vira assistant content com blocos tool_use
   * - `tool` (result) vira bloco user com tool_result
   * - `user` vira bloco user com text
   */
  private toWire(messages: AnthropicChatMessage[]): {
    system: string | null;
    wire: Array<Record<string, unknown>>;
  } {
    let system: string | null = null;
    const wire: Array<Record<string, unknown>> = [];
    for (const m of messages) {
      if (m.role === "system") {
        system = system ? `${system}\n\n${m.content}` : m.content;
        continue;
      }
      if (m.role === "user") {
        wire.push({ role: "user", content: [{ type: "text", text: m.content }] });
        continue;
      }
      if (m.role === "assistant") {
        const blocks: Array<Record<string, unknown>> = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.tool_calls) {
          let input: unknown = {};
          try {
            input = tc.arguments ? JSON.parse(tc.arguments) : {};
          } catch {
            input = {};
          }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input });
        }
        wire.push({ role: "assistant", content: blocks });
        continue;
      }
      if (m.role === "tool") {
        wire.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }],
        });
        continue;
      }
    }
    return { system, wire };
  }

  private parseResponse(json: AnthropicMessagesResponse): AnthropicResponse {
    let content: string | null = null;
    let thinking: string | null = null;
    const toolCalls: AnthropicToolCall[] = [];
    for (const block of json.content ?? []) {
      const type = block.type as string;
      if (type === "text") {
        const text = block.text as string;
        content = content ? `${content}${text}` : text;
        continue;
      }
      if (type === "thinking") {
        const t = (block.thinking as string) ?? (block.text as string) ?? "";
        thinking = thinking ? `${thinking}${t}` : t;
        continue;
      }
      if (type === "tool_use") {
        toolCalls.push({
          id: block.id as string,
          name: block.name as string,
          arguments: JSON.stringify((block.input as Record<string, unknown>) ?? {}),
        });
      }
    }
    return {
      content,
      toolCalls,
      stopReason: (json.stop_reason as string | null) ?? null,
      usage: json.usage
        ? {
            input_tokens: json.usage.input_tokens as number,
            output_tokens: json.usage.output_tokens as number,
          }
        : undefined,
      thinking,
    };
  }
}

interface AnthropicMessagesResponse {
  readonly id?: string;
  readonly type?: string;
  readonly role?: string;
  readonly model?: string;
  readonly stop_reason?: string | null;
  readonly content?: Array<Record<string, unknown>>;
  readonly usage?: Record<string, unknown>;
}