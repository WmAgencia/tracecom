/**
 * Observabilidade da TRACECON.
 *
 * Registra a execução de ferramentas, timestamps, latência, erros, versões
 * do motor/prompts/modelo e custo aproximado, de forma a permitir responder:
 * "Por que a Tracecon tomou essa decisão?".
 *
 * Nenhuma secret é impressa. O `redact` remove chaves de API do output.
 */
import type { EnvConfig } from "../config/env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

interface TraceContext {
  readonly analysisId?: string;
  readonly tool?: string;
  readonly model?: string;
  readonly engineVersion?: string;
}

/** Remove chaves de API e secrets de qualquer objeto antes de logar. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Campos de credenciais → redigidos.
      if (/key|token|secret|password|authorization|apikey/i.test(k)) {
        out[k] = "[REDACTED]";
        continue;
      }
      // Envelopes de rede (headers/cookies/request) nunca são logados na íntegra:
      // carregam data, cookies e detalhes internos, sem valor para auditoria.
      if (/^(headers|request|cookies|set-cookie|_headers)$/i.test(k)) {
        out[k] = "[WIRE_REDACTED]";
        continue;
      }
      out[k] = redact(v);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, context?: TraceContext, meta?: unknown): void;
  info(msg: string, context?: TraceContext, meta?: unknown): void;
  warn(msg: string, context?: TraceContext, meta?: unknown): void;
  error(msg: string, context?: TraceContext, meta?: unknown): void;
  /** Registra um span de execução (ex.: chamada de ferramenta) com latência. */
  span(name: string): SpanLogger;
}

export interface SpanLogger {
  end(meta?: Record<string, unknown>): void;
  fail(error: unknown): void;
}

export function createLogger(config: Pick<EnvConfig, "logLevel" | "nodeEnv">): Logger {
  const threshold = LEVEL_RANK[config.logLevel];

  const emit = (
    level: LogLevel,
    msg: string,
    context?: TraceContext,
    meta?: unknown,
  ): void => {
    if (LEVEL_RANK[level] < threshold) return;
    const record = {
      ts: Date.now(),
      level,
      msg,
      context: context ?? {},
      meta: meta !== undefined ? redact(meta) : undefined,
    };
    const line = JSON.stringify(record);
    if (level === "error") process.stderr.write(line + "\n");
    else process.stdout.write(line + "\n");
  };

  return {
    debug: (m, c, x) => emit("debug", m, c, x),
    info: (m, c, x) => emit("info", m, c, x),
    warn: (m, c, x) => emit("warn", m, c, x),
    error: (m, c, x) => emit("error", m, c, x),
    span: (name) => {
      const start = Date.now();
      const running = { name, start, result: undefined as unknown };
      return {
        end: (meta) => {
          const durationMs = Date.now() - running.start;
          emit("debug", `span:${name}`, undefined, {
            durationMs,
            ...(meta ? redact(meta) as Record<string, unknown> : {}),
          });
        },
        fail: (error) => {
          const durationMs = Date.now() - running.start;
          emit("error", `span:${name}`, undefined, {
            durationMs,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      };
    },
  };
}
