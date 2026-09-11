/**
 * Macro Calendar Provider — eventos econômicos (CPI, NFP, FOMC, PPI, GDP, PCE,
 * RetailSales) com base em schedule conhecido (cadência BLS / Fed).
 *
 * FONTE: NÃO usamos APIs pagas. Geramos os próximos eventos de forma
 * determinística a partir da cadência pública do Bureau of Labor Statistics
 * (BLS) e do Federal Reserve. Cada evento carrega:
 *   - `scheduledAt`: unix ms (13:30 UTC para BLS, 19:00 UTC para FOMC)
 *   - `previous`/`forecast`/`actual`: null (não inventamos números)
 *   - `importance`: "high" | "medium" | "low"
 *
 * Cache: TTL configurável (default 6h, alinhado com a cadência semanal).
 */
import type { Direction } from "../../backtest/types";

export type MacroEvent = "CPI" | "NFP" | "FOMC" | "PPI" | "GDP" | "PCE" | "RetailSales";

export interface MacroEventEntry {
  readonly id: string;
  readonly event: MacroEvent;
  readonly country: "US" | "EU" | "UK";
  readonly scheduledAt: number; // unix ms (UTC)
  readonly previous?: number;
  readonly forecast?: number;
  readonly actual?: number; // null até o evento
  readonly importance: "high" | "medium" | "low";
}

export interface MacroCalendar {
  readonly events: readonly MacroEventEntry[];
  readonly next: MacroEventEntry | null;
  readonly daysUntilNext: number;
  readonly fetchedAt: number;
  readonly source: string;
}

export interface MacroProvider {
  readonly id: string;
  fetchUpcoming(daysAhead: number): Promise<MacroCalendar>;
  fetchHistorical(event: MacroEvent, limit: number): Promise<readonly MacroEventEntry[]>;
}

interface ScheduledMacroProviderOptions {
  readonly cacheTtlMs?: number;
  readonly nowProvider?: () => number;
}

// Horários de publicação canônicos em UTC (BLS/Fed):
//   CPI/NFP/PPI/RetailSales: 13:30 UTC (8:30 ET; ignora DST, simplificado)
//   GDP: 13:30 UTC
//   FOMC: 19:00 UTC
//   PCE: 13:30 UTC
const BLS_HOUR_UTC = 13;
const BLS_MINUTE_UTC = 30;
const FOMC_HOUR_UTC = 19;
const FOMC_MINUTE_UTC = 0;

const DAY_MS = 86_400_000;

/**
 * Encontra a N-ésima ocorrência de `weekday` (0=Sun..6=Sat) dentro do mês UTC
 * de `reference`. `weekday` é o desejado, `nth` é 1..5 (1 = 1ª ocorrência).
 * Retorna Date UTC ou null se não existir.
 */
function nthWeekdayOfMonth(reference: Date, weekday: number, nth: number): Date | null {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstWeekday = firstOfMonth.getUTCDay();
  // Offset para a primeira ocorrência do weekday alvo dentro do mês
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  // Garante que ainda está no mesmo mês
  const candidate = new Date(Date.UTC(year, month, day));
  if (candidate.getUTCMonth() !== month) return null;
  return candidate;
}

/** Retorna o último dia útil (Mon-Fri) do mês UTC de `reference`. */
function lastBusinessDayOfMonth(reference: Date): Date {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  // Começa no último dia do mês e anda para trás até weekday ≤ 5 (Seg-Sex)
  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
  let day = lastOfMonth.getUTCDate();
  while (day > 0) {
    const d = new Date(Date.UTC(year, month, day));
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) return d;
    day--;
  }
  return lastOfMonth;
}

function atBLS(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), BLS_HOUR_UTC, BLS_MINUTE_UTC);
}
function atFOMC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), FOMC_HOUR_UTC, FOMC_MINUTE_UTC);
}

/**
 * Provider macro baseado em cadência conhecida:
 *  - CPI: 2ª ou 3ª quarta-feira (BLS agenda mensal — usamos 2ª para
 *    previsibilidade; cobre a janela usual).
 *  - NFP: 1ª sexta-feira.
 *  - FOMC: 3ª quarta-feira de meses selecionados (8 meetings/ano).
 *  - PPI: 3ª terça-feira.
 *  - GDP: último dia útil de Jan/Apr/Jul/Out (advance+preliminary, simplificado).
 *  - PCE: última sexta-feira do mês.
 *  - RetailSales: ~17ª do mês (dia 17 calendário, próximo dia útil).
 */
export class ScheduledMacroProvider implements MacroProvider {
  readonly id = "scheduled-macro";

  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cache: { at: number; events: MacroEventEntry[] } | null = null;

  constructor(opts?: ScheduledMacroProviderOptions) {
    this.cacheTtlMs = opts?.cacheTtlMs ?? 6 * 60 * 60 * 1000;
    this.now = opts?.nowProvider ?? (() => Date.now());
  }

  /**
   * Retorna todas as entradas (próximas e passadas dentro do horizonte).
   * Sempre filtra entradas com `scheduledAt > now` se direção for "upcoming".
   */
  private buildAll(now: number): MacroEventEntry[] {
    const entries: MacroEventEntry[] = [];
    const nowD = new Date(now);
    const startMonth = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - 3, 1));
    const endMonth = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + 13, 1));

    // Para cada mês no intervalo, gera entradas
    for (let m = new Date(startMonth); m <= endMonth; m.setUTCMonth(m.getUTCMonth() + 1)) {
      const y = m.getUTCFullYear();
      const mo = m.getUTCMonth();
      const monthRef = new Date(Date.UTC(y, mo, 1));

      // CPI: 2ª quarta-feira
      const cpi2 = nthWeekdayOfMonth(monthRef, 3, 2);
      if (cpi2) {
        const ts = atBLS(cpi2);
        entries.push({
          id: `CPI-${y}-${String(mo + 1).padStart(2, "0")}-2ndWed`,
          event: "CPI",
          country: "US",
          scheduledAt: ts,
          importance: "high",
        });
      }

      // NFP: 1ª sexta-feira
      const nfp1 = nthWeekdayOfMonth(monthRef, 5, 1);
      if (nfp1) {
        entries.push({
          id: `NFP-${y}-${String(mo + 1).padStart(2, "0")}-1stFri`,
          event: "NFP",
          country: "US",
          scheduledAt: atBLS(nfp1),
          importance: "high",
        });
      }

      // FOMC: 3ª quarta-feira dos meses com meeting (8/ano):
      //   Jan, Mar, Mai, Jun, Jul, Set, Nov, Dez
      const fomcMonths = [0, 2, 4, 5, 6, 8, 10, 11];
      if (fomcMonths.includes(mo)) {
        const w = nthWeekdayOfMonth(monthRef, 3, 3);
        if (w) {
          entries.push({
            id: `FOMC-${y}-${String(mo + 1).padStart(2, "0")}-3rdWed`,
            event: "FOMC",
            country: "US",
            scheduledAt: atFOMC(w),
            importance: "high",
          });
        }
      }

      // PPI: 3ª terça-feira (mês seguinte à referência; BLS schedule)
      const ppi3 = nthWeekdayOfMonth(monthRef, 2, 3);
      if (ppi3) {
        entries.push({
          id: `PPI-${y}-${String(mo + 1).padStart(2, "0")}-3rdTue`,
          event: "PPI",
          country: "US",
          scheduledAt: atBLS(ppi3),
          importance: "medium",
        });
      }

      // GDP: último dia útil de Jan/Apr/Jul/Out (avanço/preliminar)
      if ([0, 3, 6, 9].includes(mo)) {
        const lastBiz = lastBusinessDayOfMonth(monthRef);
        entries.push({
          id: `GDP-${y}-${String(mo + 1).padStart(2, "0")}-lastBiz`,
          event: "GDP",
          country: "US",
          scheduledAt: atBLS(lastBiz),
          importance: "high",
        });
      }

      // PCE: última sexta-feira do mês (relatório BEA)
      const lastFri = nthWeekdayOfMonth(new Date(Date.UTC(y, mo + 1, 0)), 5, 5) // pode incluir 5ª = null fallback
        ?? nthWeekdayOfMonth(new Date(Date.UTC(y, mo + 1, 0)), 5, 4)
        ?? (() => {
            // Fallback: última sexta do mês via iteração
            const last = new Date(Date.UTC(y, mo + 1, 0));
            let d = new Date(last);
            while (d.getUTCDay() !== 5 && d >= monthRef) d = new Date(d.getTime() - DAY_MS);
            return d;
          })();
      entries.push({
        id: `PCE-${y}-${String(mo + 1).padStart(2, "0")}-lastFri`,
        event: "PCE",
        country: "US",
        scheduledAt: atBLS(lastFri),
        importance: "medium",
      });

      // RetailSales: mid-mês (~15º, próximo dia útil)
      const midRef = new Date(Date.UTC(y, mo, 15));
      const midWd = midRef.getUTCDay();
      const midDelta = midWd === 0 ? 1 : midWd === 6 ? 2 : 0;
      const retailDate = new Date(Date.UTC(y, mo, 15 + midDelta));
      entries.push({
        id: `RetailSales-${y}-${String(mo + 1).padStart(2, "0")}-mid`,
        event: "RetailSales",
        country: "US",
        scheduledAt: atBLS(retailDate),
        importance: "medium",
      });
    }
    return entries;
  }

  private getCache(now: number): MacroEventEntry[] {
    if (this.cache && now - this.cache.at < this.cacheTtlMs) {
      return this.cache.events;
    }
    const events = this.buildAll(now);
    this.cache = { at: now, events };
    return events;
  }

  async fetchUpcoming(daysAhead: number): Promise<MacroCalendar> {
    const now = this.now();
    const all = this.getCache(now);
    const cutoff = now + daysAhead * DAY_MS;
    const upcoming = all.filter((e) => e.scheduledAt >= now && e.scheduledAt <= cutoff);
    // Ordena por scheduledAt crescente; o próximo é o primeiro
    const sorted = [...upcoming].sort((a, b) => a.scheduledAt - b.scheduledAt);
    const next = sorted[0] ?? null;
    const daysUntilNext = next ? Math.max(0, Math.ceil((next.scheduledAt - now) / DAY_MS)) : 0;
    return {
      events: sorted,
      next,
      daysUntilNext,
      fetchedAt: now,
      source: this.id,
    };
  }

  async fetchHistorical(event: MacroEvent, limit: number): Promise<readonly MacroEventEntry[]> {
    const now = this.now();
    const all = this.getCache(now);
    const past = all
      .filter((e) => e.event === event && e.scheduledAt <= now)
      .sort((a, b) => b.scheduledAt - a.scheduledAt) // mais recentes primeiro
      .slice(0, limit)
      // Marca como "actual=0" apenas para satisfazer o tipo (não inventamos números;
      // representamos 'passado não temos o valor exato' como null)
      .map((e) => ({
        ...e,
        id: `${e.id}-hist`,
        // Mantém previous/forecast/actual null — só o calendário é conhecido
      }));
    return past;
  }
}

// ---------------------------------------------------------------------------
// Integração com FusionService — keep this DI-friendly.
// ---------------------------------------------------------------------------

/** Helper para construir um `noop` (no events) usado como fallback. */
export function noopMacroProvider(): MacroProvider {
  return {
    id: "noop",
    async fetchUpcoming(): Promise<MacroCalendar> {
      return {
        events: [],
        next: null,
        daysUntilNext: 0,
        fetchedAt: Date.now(),
        source: "noop",
      };
    },
    async fetchHistorical(): Promise<readonly MacroEventEntry[]> {
      return [];
    },
  };
}

/**
 * Heurística simples: produz um viés macro conservador baseado em eventos
 * known upcoming. Usado pelo FusionService — não afirma causalidade.
 *
 *  - Sem eventos futuros relevantes → null. O ticker, por si só, não
 *    estabelece um viés macro verificável.
 *  - 1+ evento(s) high-importance nas próximas 24h → WAIT (neutral).
 *  - 1+ evento(s) high-importance em 1-7 dias → conservative (neutral).
 */
export function deriveMacroBias(
  calendar: MacroCalendar,
  symbol: string,
  nowProvider: () => number = () => Date.now(),
): Direction | "neutral" | null {
  void symbol;
  const now = nowProvider();
  const high = (calendar.events ?? []).filter((e) => e.importance === "high");
  const veryUrgent = high.some((e) => {
    const d = e.scheduledAt - now;
    return d >= 0 && d <= 24 * 60 * 60 * 1000;
  });
  const upcomingWeek = high.some((e) => {
    const d = e.scheduledAt - now;
    return d >= 0 && d <= 7 * 24 * 60 * 60 * 1000;
  });

  // Heurística primária: eventos iminentes zeram viés direcional (conservadorismo)
  if (veryUrgent) return "neutral";
  if (upcomingWeek) return "neutral";

  // Sem eventos próximos → sem viés. A fonte apenas estima agenda e não
  // traz actual/forecast/surprise para sustentar uma direção.
  return null;
}
