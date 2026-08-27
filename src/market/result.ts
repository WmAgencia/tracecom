/**
 * Helpers para construir respostas `ToolResult` sem fabricar dados.
 *
 * O `dataUnavailable` é usado sempre que um provider está ausente, é offline,
 * ou não consegue entregar o dado. Ele NÃO falha a execução (não lança erro),
 * pois a ausência de dados é um resultado legítimo que o agente deve ser capaz
 * de interpretar (e frequentemente levar a WAIT).
 */
import type { DataAvailability, DataQuality, ToolResult } from "../domain/types";

export function dataUnavailable<T>(
  tool: string,
  reason: string,
  opts: { quality?: DataQuality; source?: string } = {},
): ToolResult<T> {
  return {
    tool,
    availability: "UNAVAILABLE",
    retrievedAt: Date.now(),
    message: reason,
    quality: opts.quality ?? "unknown",
    ...(opts.source ? { source: opts.source } : {}),
  };
}

export function ok<T>(
  tool: string,
  payload: T,
  opts: {
    quality?: DataQuality;
    source?: string;
    availability?: DataAvailability;
  } = {},
): ToolResult<T> {
  return {
    tool,
    availability: opts.availability ?? "AVAILABLE",
    payload,
    retrievedAt: Date.now(),
    quality: opts.quality ?? "high",
    ...(opts.source ? { source: opts.source } : {}),
  };
}
