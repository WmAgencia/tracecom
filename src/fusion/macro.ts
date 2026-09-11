/**
 * Macro bias derivation — puro / sem efeitos colaterais.
 *
 * IMPORTANTE: este módulo NÃO inventa dados. Apenas consome um
 * `MacroCalendar` (que carrega apenas `scheduledAt`, `importance`) e
 * devolve um viés direcional OU null. A causalidade "macro → direção"
 * nunca é afirmada: o viés é uma heurística conservadora.
 */
import type { Direction } from "../backtest/types";
import type { MacroCalendar, MacroEventEntry } from "../context/macro/calendar-provider";

/**
 * Deriva viés macro a partir do calendário econômico.
 *
 * Heurística (conservadora):
 *  - Evento high-importance nas próximas 24h → "neutral" (WAIT é prudente).
 *  - Evento high-importance em 1..7 dias → "neutral".
 *  - Sem evento high-importance próximo → null. Um calendário sem
 *    surpresa/consenso/resultado não contém evidência direcional.
 *  - Sem eventos no calendário → null.
 */
export function deriveMacroBias(
  calendar: MacroCalendar,
  symbol: string,
  nowProvider: () => number = () => Date.now(),
): Direction | "neutral" | null {
  // Mantemos o argumento `symbol` por compatibilidade com a interface de
  // FusionService. Ele não é usado para inferir direção: ticker não é
  // uma fonte macro verificável.
  void symbol;
  const now = nowProvider();
  const high = (calendar.events ?? []).filter((e: MacroEventEntry) => e.importance === "high");

  const veryUrgent = high.some((e) => {
    const d = e.scheduledAt - now;
    return d >= 0 && d <= 24 * 60 * 60 * 1000;
  });
  const upcomingWeek = high.some((e) => {
    const d = e.scheduledAt - now;
    return d >= 0 && d <= 7 * 24 * 60 * 60 * 1000;
  });

  if (veryUrgent) return "neutral";
  if (upcomingWeek) return "neutral";

  return null;
}
