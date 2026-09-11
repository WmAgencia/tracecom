/**
 * Testes do provedor de calendário macro (ScheduledMacroProvider).
 *
 * Foco: validar a cadência determinística (BLS/NFP/FOMC/PPI/GDP),
 * o formato dos eventos e a função deriveMacroBias.
 */
import { describe, expect, it } from "vitest";
import {
  ScheduledMacroProvider,
  deriveMacroBias,
  noopMacroProvider,
  type MacroEvent,
  type MacroProvider,
} from "../../../src/context/macro/calendar-provider";

const NOW = Date.parse("2026-09-15T12:00:00Z"); // terça-feira, 15 set 2026

function provider(now: number = NOW): ScheduledMacroProvider {
  return new ScheduledMacroProvider({ nowProvider: () => now });
}

describe("ScheduledMacroProvider — cadência BLS/NFP/FOMC", () => {
  it("Caso 1: fetchUpcoming(30) retorna ≥1 CPI e ≥1 NFP nos próximos 30 dias", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(30);
    const cpi = cal.events.filter((e) => e.event === "CPI");
    const nfp = cal.events.filter((e) => e.event === "NFP");
    expect(cpi.length).toBeGreaterThanOrEqual(1);
    expect(nfp.length).toBeGreaterThanOrEqual(1);
    // Cada evento tem scheduledAt dentro do horizonte
    const cutoff = NOW + 30 * 86_400_000;
    for (const e of cal.events) {
      expect(e.scheduledAt).toBeGreaterThanOrEqual(NOW - 1);
      expect(e.scheduledAt).toBeLessThanOrEqual(cutoff);
    }
  });

  it("Caso 2: daysUntilNext é inteiro ≥ 0", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(30);
    expect(Number.isInteger(cal.daysUntilNext)).toBe(true);
    expect(cal.daysUntilNext).toBeGreaterThanOrEqual(0);
    // Sanity: se há next, daysUntilNext é > 0
    if (cal.next) {
      expect(cal.daysUntilNext).toBeGreaterThan(0);
      expect(cal.daysUntilNext).toBeLessThanOrEqual(30);
    } else {
      expect(cal.daysUntilNext).toBe(0);
    }
  });

  it("Caso 3: fetchHistorical(\"CPI\", 12) retorna entries do passado (cadência)", async () => {
    const p = provider(NOW);
    const hist = await p.fetchHistorical("CPI", 12);
    // Pode haver até 12 CPI's passadas dentro do horizonte (3 meses atrás → 12 meses à frente = 16 meses totais)
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist.length).toBeLessThanOrEqual(12);
    // Cada evento passado tem scheduledAt ≤ now
    for (const e of hist) {
      expect(e.scheduledAt).toBeLessThanOrEqual(NOW);
      expect(e.event).toBe("CPI");
      expect(e.id).toContain("CPI-");
    }
    // Eventos históricos têm IDs marcados (sufixo "-hist")
    for (const e of hist) {
      expect(e.id.endsWith("-hist")).toBe(true);
    }
  });

  it("Caso 4: cadência CPI é na 2ª quarta-feira (UTC: weekday=3)", async () => {
    const p = provider(NOW);
    // Pega o horizonte de 12 meses para termos vários CPIs
    const cal = await p.fetchUpcoming(365);
    const cpis = cal.events.filter((e) => e.event === "CPI");
    expect(cpis.length).toBeGreaterThan(0);
    for (const c of cpis) {
      const d = new Date(c.scheduledAt);
      // 3 = quarta-feira (UTC)
      expect(d.getUTCDay()).toBe(3);
    }
  });

  it("Cadência NFP: 1ª sexta-feira (weekday=5)", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(365);
    const nfps = cal.events.filter((e) => e.event === "NFP");
    expect(nfps.length).toBeGreaterThan(0);
    for (const n of nfps) {
      const d = new Date(n.scheduledAt);
      expect(d.getUTCDay()).toBe(5);
    }
  });

  it("FOMC só aparece em meses esperados (Jan, Mar, Mai, Jun, Jul, Set, Nov, Dez)", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(365);
    const fomc = cal.events.filter((e) => e.event === "FOMC");
    expect(fomc.length).toBeGreaterThan(0);
    const expected = new Set([0, 2, 4, 5, 6, 8, 10, 11]);
    for (const f of fomc) {
      const d = new Date(f.scheduledAt);
      expect(expected.has(d.getUTCMonth())).toBe(true);
      expect(d.getUTCDay()).toBe(3); // 3ª quarta
    }
  });

  it("PPI: 3ª terça-feira (weekday=2)", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(365);
    const ppis = cal.events.filter((e) => e.event === "PPI");
    if (ppis.length > 0) {
      for (const e of ppis) {
        expect(new Date(e.scheduledAt).getUTCDay()).toBe(2);
      }
    }
  });

  it("GDP só aparece em Jan/Apr/Jul/Out (avanços do BEA)", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(365);
    const gdps = cal.events.filter((e) => e.event === "GDP");
    for (const g of gdps) {
      const m = new Date(g.scheduledAt).getUTCMonth();
      expect([0, 3, 6, 9]).toContain(m);
    }
  });

  it("Entradas nunca carregam previous/forecast/actual inventados", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(60);
    for (const e of cal.events) {
      expect(e.previous).toBeUndefined();
      expect(e.forecast).toBeUndefined();
      expect(e.actual).toBeUndefined();
      expect(e.importance === "high" || e.importance === "medium" || e.importance === "low").toBe(true);
      expect(["CPI", "NFP", "FOMC", "PPI", "GDP", "PCE", "RetailSales"]).toContain(e.event);
      expect(["US", "EU", "UK"]).toContain(e.country);
    }
  });

  it("fetchUpcoming(0) retorna apenas eventos futuros (não inclui passado)", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(0);
    // Com cutoff = NOW, podem aparecer eventos com scheduledAt <= NOW (exatos).
    // Mas não passados estritos.
    for (const e of cal.events) {
      expect(e.scheduledAt).toBeGreaterThanOrEqual(NOW - 1);
    }
  });

  it("fetchUpcoming retorna eventos ordenados por scheduledAt", async () => {
    const p = provider(NOW);
    const cal = await p.fetchUpcoming(60);
    for (let i = 1; i < cal.events.length; i++) {
      const prev = cal.events[i - 1];
      const cur = cal.events[i];
      if (!prev || !cur) continue;
      expect(cur.scheduledAt).toBeGreaterThanOrEqual(prev.scheduledAt);
    }
  });

  it("noopMacroProvider devolve calendário vazio", async () => {
    const p: MacroProvider = noopMacroProvider();
    const cal = await p.fetchUpcoming(7);
    expect(cal.events).toHaveLength(0);
    expect(cal.next).toBeNull();
    expect(cal.daysUntilNext).toBe(0);
    const hist = await p.fetchHistorical("CPI" as MacroEvent, 5);
    expect(hist).toHaveLength(0);
  });
});

describe("deriveMacroBias — heurística conservadora", () => {
  const sym = "BTCUSDT";
  // Injeta NOW para que os testes sejam determinísticos (independem de Date.now())
  const nowFn = () => NOW;

  it("Sem eventos próximos → null; ticker não é evidência macro", async () => {
    const emptyCal = { events: [], next: null, daysUntilNext: 0, fetchedAt: NOW, source: "test" };
    expect(deriveMacroBias(emptyCal, "BTCUSDT", nowFn)).toBeNull();
    expect(deriveMacroBias(emptyCal, "ETHUSDT", nowFn)).toBeNull();
    expect(deriveMacroBias(emptyCal, "SOLUSDT", nowFn)).toBeNull();
    expect(deriveMacroBias(emptyCal, "AAPL", nowFn)).toBeNull();
  });

  it("Evento high-importance nas próximas 24h → 'neutral'", async () => {
    const urgent = [{
      id: "u", event: "CPI" as const, country: "US" as const,
      scheduledAt: NOW + 12 * 60 * 60 * 1000, // 12h
      importance: "high" as const,
    }];
    const cal = { events: urgent, next: urgent[0]!, daysUntilNext: 1, fetchedAt: NOW, source: "test" };
    expect(deriveMacroBias(cal, sym, nowFn)).toBe("neutral");
  });

  it("Evento high-importance em 3 dias → 'neutral'", async () => {
    const upcoming = [{
      id: "u", event: "FOMC" as const, country: "US" as const,
      scheduledAt: NOW + 3 * 86_400_000,
      importance: "high" as const,
    }];
    const cal = { events: upcoming, next: upcoming[0]!, daysUntilNext: 3, fetchedAt: NOW, source: "test" };
    expect(deriveMacroBias(cal, sym, nowFn)).toBe("neutral");
  });

  it("Evento low/medium-importance distante → não inventa viés direcional", async () => {
    const low = [{
      id: "l", event: "RetailSales" as const, country: "US" as const,
      scheduledAt: NOW + 30 * 86_400_000,
      importance: "medium" as const,
    }];
    const cal = { events: low, next: null, daysUntilNext: 30, fetchedAt: NOW, source: "test" };
    expect(deriveMacroBias(cal, sym, nowFn)).toBeNull();
  });

  it("Símbolo desconhecido + calendar vazio → null", async () => {
    const emptyCal = { events: [], next: null, daysUntilNext: 0, fetchedAt: NOW, source: "test" };
    expect(deriveMacroBias(emptyCal, "XYZUSDT", nowFn)).toBeNull();
  });
});
