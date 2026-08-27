/**
 * Regras de segurança do agente.
 *
 * O agente deve produzir análises rápido sem virar um loop infinito nem fazer
 * consultas desnecessárias a cada candle. Este módulo impõe limites duros:
 *   - número máximo de rodadas (rounds) do loop de tool calling;
 *   - número máximo de chamadas de ferramenta por análise;
 *   - barreiras de dissuasão de ações proibidas (execução de ordens, etc.).
 */
export interface SafetyLimits {
  readonly maxAgentRounds: number;
  readonly maxToolCalls: number;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxAgentRounds: 8,
  maxToolCalls: 12,
};

/** Ações explicitamente proibidas para o modelo (a Tracecon não executa ordens). */
export const PROHIBITED_ACTIONS = [
  "buy",
  "sell",
  "place_order",
  "execute_trade",
  "submit_order",
  "order_execution",
] as const;

/** Verifica se o modelo tentou uma ação proibida em um argumento/texto. */
export function hasProhibitedAction(input: string): boolean {
  return PROHIBITED_ACTIONS.some((a) => input.toLowerCase().includes(a));
}

/** Validar o número de rounds / tool calls antes de prosseguir. */
export function canContinue(
  current: { readonly rounds: number; readonly toolCalls: number },
  limits: SafetyLimits = DEFAULT_SAFETY_LIMITS,
): boolean {
  return current.rounds < limits.maxAgentRounds && current.toolCalls < limits.maxToolCalls;
}
