/**
 * V3 — GRADE REAL DAS EXPIRATIONS (prova dos exemplos da UI) e janelas analysis/execution.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const grid = await import("../../relay/v3/expiration-grid.mjs");
// @ts-expect-error - relay ESM sem tipagem
const timing = await import("../../relay/v3/timing.mjs");
const { derivedExpirationAt, availableShortExpirations, isGridAligned, EXPIRY_GRID_MS, TARGET_HOLD_MS } = grid as any;
const { ExpirationTargetTiming } = timing as any;

const AT_112454 = Date.UTC(2026, 8, 23, 11, 24, 54);
const AT_112530 = Date.UTC(2026, 8, 23, 11, 25, 30);
const at = (hours: number, minutes: number, seconds = 0) => Date.UTC(2026, 8, 23, hours, minutes, seconds);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const tte = (expirationAt: number, now: number) => Math.round((expirationAt - now) / 1000);

describe("V3 grade de expirations — evidencia reproduzida", () => {
  it("grade e MINUTO (60s) e o hold alvo e ~300s (coisas diferentes)", () => {
    expect(EXPIRY_GRID_MS).toBe(60_000);
    expect(TARGET_HOLD_MS).toBe(300_000);
    expect(isGridAligned(at(11, 30))).toBe(true);
    expect(isGridAligned(at(11, 30, 30))).toBe(false);
    expect(isGridAligned(at(11, 30), 300_000)).toBe(true);
  });

  it("brokerNow=11:24:54 => lista 11:26..11:30 e candidato 11:30 com TTE 306s", () => {
    const available = availableShortExpirations(AT_112454, { deadtimeMs: 30_000, horizonMs: 330_000 });
    expect(available.map(hhmm)).toEqual(["11:26", "11:27", "11:28", "11:29", "11:30"]);
    const candidate = derivedExpirationAt(AT_112454);
    expect(candidate).toBe(at(11, 30));
    expect(tte(candidate, AT_112454)).toBe(306);
  });

  it("brokerNow=11:25:30 => nova expiration 11:31 (TTE 330s) entra como candidata", () => {
    const available = availableShortExpirations(AT_112530, { deadtimeMs: 30_000, horizonMs: 330_000 });
    expect(available.map(hhmm)).toEqual(["11:27", "11:28", "11:29", "11:30", "11:31"]);
    const candidate = derivedExpirationAt(AT_112530);
    expect(candidate).toBe(at(11, 31));
    expect(tte(candidate, AT_112530)).toBe(330);
  });

  it("cadencia: ~1 nova opportunity/min/ativo (candidato avanca 60s a cada ~minuto)", () => {
    const first = derivedExpirationAt(at(11, 24, 30));
    const second = derivedExpirationAt(at(11, 25, 30));
    const third = derivedExpirationAt(at(11, 26, 30));
    expect(second - first).toBe(60_000);
    expect(third - second).toBe(60_000);
    expect(tte(first, at(11, 24, 30))).toBe(330);
  });

  it("deadtime respeitado: expiration dentro do deadtime nao aparece na lista", () => {
    const available = availableShortExpirations(AT_112454, { deadtimeMs: 30_000, horizonMs: 330_000 });
    expect(available.map(hhmm)).not.toContain("11:25");
    const withDeadtime300s = availableShortExpirations(AT_112454, { deadtimeMs: 300_000, horizonMs: 330_000 });
    expect(withDeadtime300s.map(hhmm)).toEqual(["11:30"]);
  });
});

describe("V3 timing — ANALYSIS x EXECUTION (nunca a mesma funcao)", () => {
  const expirationAt = at(11, 30);

  it("analysis aceita (300s,330s]; execution so proximo do alvo 302s", () => {
    const analysis = ExpirationTargetTiming.analysis({ expirationAt, brokerNow: at(11, 24, 54) });
    expect(analysis.ok).toBe(true);
    expect(analysis.code).toBe("ANALYSIS_WINDOW_OPEN");
    const beforeTarget = ExpirationTargetTiming.execution({ expirationAt, brokerNow: at(11, 24, 54) });
    expect(beforeTarget.ok).toBe(false);
    expect(beforeTarget.code).toBe("BEFORE_TARGET_SEND");
    const atTarget = ExpirationTargetTiming.execution({ expirationAt, brokerNow: at(11, 24, 58) });
    expect(atTarget.ok).toBe(true);
    expect(atTarget.code).toBe("EXECUTION_WINDOW_OPEN");
    expect(tte(expirationAt, at(11, 24, 58))).toBe(302);
  });

  it("hard cutoff em TTE<=300s vale para analysis e execution", () => {
    const cutoff = ExpirationTargetTiming.analysis({ expirationAt, brokerNow: at(11, 25, 0) });
    expect(cutoff.ok).toBe(false);
    expect(cutoff.code).toBe("MISSED_5M_ENTRY_WINDOW");
    const execution = ExpirationTargetTiming.execution({ expirationAt, brokerNow: at(11, 25, 0) });
    expect(execution.ok).toBe(false);
    expect(execution.code).toBe("MISSED_5M_ENTRY_WINDOW");
    expect(ExpirationTargetTiming.cutoffPassed({ expirationAt, brokerNow: at(11, 25, 0) })).toBe(true);
  });

  it("board de fases: NOT_YET_OFFERED / OPPORTUNITY_WINDOW / MISSED", () => {
    expect(ExpirationTargetTiming.phase({ tteMs: 331_000 })).toBe("NOT_YET_OFFERED");
    expect(ExpirationTargetTiming.phase({ tteMs: 330_000 })).toBe("OPPORTUNITY_WINDOW");
    expect(ExpirationTargetTiming.phase({ tteMs: 301_000 })).toBe("OPPORTUNITY_WINDOW");
    expect(ExpirationTargetTiming.phase({ tteMs: 300_000 })).toBe("MISSED_5M_ENTRY_WINDOW");
  });
});
