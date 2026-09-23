/**
 * V3 — TESTES DE EXPIRATION (A–J do plano) + discovery + dedup + alvo exato.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem
const timing = await import("../../relay/v3/timing.mjs");
// @ts-expect-error - relay ESM sem tipagem
const discoveryModule = await import("../../relay/v3/expiration-discovery.mjs");
// @ts-expect-error - relay ESM sem tipagem
const engineModule = await import("../../relay/v3/opportunity-engine.mjs");
const { ExpirationTargetTiming, buildV3OrderIntent, assertExactExpirationTarget, isAlignedExpiration } = timing as any;
const { ExpirationDiscovery, parseActiveExpirations } = discoveryModule as any;
const { ExpirationOpportunityEngine } = engineModule as any;

const BASE = Math.floor(Date.now() / 300_000) * 300_000;
const EXP = BASE + 300_000; // expiration alinhada
const TTE330 = EXP - 330_000;
const TTE305 = EXP - 305_000;
const TTE302 = EXP - 302_000;
const TTE299 = EXP - 299_000;

const activeWith = (expirations: number[], { deadtime = 30, id = 76, enabled = true } = {}) => ({ id, name: "EURUSD-OTC", enabled, is_suspended: false, deadtime, option: { expiration_times: expirations.map((ms) => Math.round(ms / 1000)), exp_time: Math.round(expirations[0]! / 1000), profit: { commission: 18 } } });
const durationActive = ({ deadtime = 30, id = 76, durations = [60000, 900000] } = {}) => ({ id, name: "EURUSD-OTC", enabled: true, is_suspended: false, deadtime, option: { expiration_times: durations, profit: { commission: 18 } } });

describe("V3 expiration — descoberta real (protocolo IQ)", () => {
  it("A: frente compravel derivada do relogio do broker entra em ~TTE330 => opportunity criada; B: nunca duplica", () => {
    const discovery = new ExpirationDiscovery({ now: () => TTE330 });
    discovery.ingest({ actives: [{ marketKey: "EURUSD:OTC", section: "binary", active: durationActive() }], brokerNow: TTE330 });
    const front = discovery.front("EURUSD:OTC", TTE330);
    expect(front.expirationAt).toBe(EXP);
    expect(front.tteMs).toBe(330_000);
    expect(front.deadtimeMs).toBe(30_000);
    expect(front.allowedDurationsMs).toEqual([60000, 900000]);
    const engine = new ExpirationOpportunityEngine({ now: () => TTE330 });
    const first = engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: TTE330, deadtimeMs: 30_000 });
    const second = engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: TTE330, deadtimeMs: 30_000 });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(engine.stats().opportunities).toBe(1);
    expect(engine.stats().counters.duplicatesBlocked).toBe(1);
    const early = engine.discover({ marketKey: "GBPUSD:OTC", expirationAt: EXP + 300_000, brokerNow: TTE330, deadtimeMs: 30_000 });
    expect(early.created).toBe(false);
    expect(early.error).toBe("TTE_ABOVE_DISCOVERY_WINDOW");
    // adocao tardia (TTE <= 300s) nao cria opportunity (MISSED, nunca perseguicao)
    const late = engine.discover({ marketKey: "USDJPY:OTC", expirationAt: EXP, brokerNow: EXP - 169_000, deadtimeMs: 30_000 });
    expect(late.created).toBe(false);
    expect(late.error).toBe("MISSED_5M_ENTRY_WINDOW");
  });

  it("C: nova expiration no minuto seguinte cria NOVA opportunity (ids distintos)", () => {
    const engine = new ExpirationOpportunityEngine({ now: () => TTE330 });
    const first = engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: TTE330, deadtimeMs: 30_000 });
    const tooEarly = engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP + 300_000, brokerNow: TTE330, deadtimeMs: 30_000 });
    expect(tooEarly.created).toBe(false);
    expect(tooEarly.error).toBe("TTE_ABOVE_DISCOVERY_WINDOW");
    const next = engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP + 300_000, brokerNow: EXP - 30_000, deadtimeMs: 30_000 });
    expect(next.created).toBe(true);
    expect(next.opportunity.opportunityId).not.toBe(first.opportunity.opportunityId);
    expect(engine.stats().opportunities).toBe(2);
    expect(engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP + 300_000, brokerNow: EXP - 30_000 }).created).toBe(false);
  });

  it("frente compravel ignora fronteira dentro do deadtime do broker", () => {
    const discovery = new ExpirationDiscovery({ now: () => TTE305 });
    discovery.ingest({ actives: [{ marketKey: "EURUSD:OTC", section: "binary", active: durationActive() }], brokerNow: TTE305 });
    const front = discovery.front("EURUSD:OTC", TTE305);
    // TTE305: a fronteira imediata (EXP-300s) esta a 5s => abaixo do deadtime 30s; a frente e EXP (TTE 305s)
    expect(front.expirationAt).toBe(EXP);
    expect(front.tteMs).toBe(305_000);
  });

  it("evidencia de producao: durations e deadtime ficam mensuraveis; timestamps (quando existirem) viram offers", () => {
    const discovery = new ExpirationDiscovery({ now: () => TTE330 });
    discovery.ingest({ actives: [{ marketKey: "EURUSD:OTC", section: "binary", active: durationActive() }], brokerNow: TTE330 });
    const dist = discovery.distribution();
    expect(dist.allowedDurationsMs).toEqual([60000, 900000]);
    expect(dist.deadtimeMs).toContain(30_000);
    expect(dist.offers).toBe(0);
    // payload com timestamp absoluto continua suportado (secao que publique lista real)
    const withTimestamps = new ExpirationDiscovery({ now: () => TTE330 });
    withTimestamps.ingest({ actives: [{ marketKey: "EURUSD:OTC", section: "turbo", active: activeWith([EXP]) }], brokerNow: TTE330 });
    expect(withTimestamps.distribution().offers).toBe(1);
    expect(withTimestamps.distribution().firstSeenTteMs.max).toBe(330_000);
  });

  it("parse distingue duracao (ms/s) de timestamp epoch (s/ms)", () => {
    expect(parseActiveExpirations({ option: { expiration_times: [60000, 900000] } }).allowedDurationsMs).toEqual([60000, 900000]);
    expect(parseActiveExpirations({ option: { expiration_times: [60, 900] } }).allowedDurationsMs).toEqual([60000, 900000]);
    expect(parseActiveExpirations({ option: { expiration_times: [Math.round(EXP / 1000)] } }).timestamps).toEqual([EXP]);
    expect(parseActiveExpirations({ option: { expiration_times: [EXP] } }).timestamps).toEqual([EXP]);
    expect(parseActiveExpirations({ option: { exp_time: { expiration: EXP } } }).timestamps).toEqual([EXP]);
    expect(parseActiveExpirations({ option: { expiration_times: [60000] }, deadtime: 300 }).deadtimeMs).toBe(300_000);
  });
});

describe("V3 expiration — janela estrategica (302/300)", () => {
  it("D: TTE=302 com APPROVE => intent exatamente para a expiration original", () => {
    const opportunity = { opportunityId: `EURUSD:OTC@${new Date(EXP).toISOString()}`, marketKey: "EURUSD:OTC", activeId: 76, expirationAt: EXP, targetSendAt: EXP - 302_000, hardStrategicCutoffAt: EXP - 300_000, purchaseDeadlineAt: EXP - 30_000 };
    const built = buildV3OrderIntent({ opportunity, brokerNow: TTE302, stake: 2, direction: "BUY" });
    expect(built.ok).toBe(true);
    expect(built.intent.exactExpirationAt).toBe(Math.round(EXP / 1000));
    expect(built.intent.tteMs).toBe(302_000);
    expect(assertExactExpirationTarget({ opportunity, requestedExpirationAt: EXP / 1000 }).ok).toBe(true);
  });

  it("E/F: TTE<=300 ou purchase deadline do broker => CANCEL (nunca persegue)", () => {
    const engine = new ExpirationOpportunityEngine({ now: () => TTE330 });
    engine.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: TTE330, deadtimeMs: 30_000 });
    const opportunity = engine.get(`EURUSD:OTC@${new Date(EXP).toISOString()}`);
    engine.enforceWindow(opportunity.opportunityId, TTE299);
    expect(opportunity.status).toBe("MISSED_5M_ENTRY_WINDOW");
    const built = buildV3OrderIntent({ opportunity, brokerNow: TTE299, stake: 2, direction: "BUY" });
    expect(built.ok).toBe(false);
    expect(built.code).toBe("MISSED_5M_ENTRY_WINDOW");
    // F: broker deixa de vender (purchase deadline) dentro da janela de execucao => bloqueio
    const engine2 = new ExpirationOpportunityEngine({ now: () => TTE330 });
    engine2.discover({ marketKey: "EURUSD:OTC", expirationAt: EXP, brokerNow: TTE330, deadtimeMs: 308_000 });
    const other = engine2.get(`EURUSD:OTC@${new Date(EXP).toISOString()}`);
    const window = ExpirationTargetTiming.execution({ expirationAt: EXP, brokerNow: EXP - 302_000, purchaseDeadlineAt: EXP - 302_600 });
    expect(window.ok).toBe(false);
    expect(window.code).toBe("BROKER_PURCHASE_DEADLINE_PASSED");
    engine2.enforceWindow(other.opportunityId, EXP - 306_000);
    expect(other.status).toBe("CANCELLED");
    expect(other.closedReason).toBe("BROKER_PURCHASE_DEADLINE_PASSED");
  });

  it("G/I/J: intent/guard negam expiration trocada, desalinhada (30s/60s) e bucket recalculado", () => {
    const opportunity = { opportunityId: "x", marketKey: "EURUSD:OTC", expirationAt: EXP, targetSendAt: EXP - 302_000, hardStrategicCutoffAt: EXP - 300_000, purchaseDeadlineAt: EXP - 30_000 };
    // +60s e valido NA GRADE (minuto) mas nao e o alvo => MISMATCH; +30s viola a grade => ALIGNMENT
    expect(assertExactExpirationTarget({ opportunity, requestedExpirationAt: (EXP + 60_000) / 1000 }).code).toBe("ENTRY_EXPIRATION_MISMATCH");
    expect(assertExactExpirationTarget({ opportunity, requestedExpirationAt: (EXP + 30_000) / 1000 }).code).toBe("ENTRY_EXPIRATION_ALIGNMENT");
    // bucket recalculado localmente em TTE=302 aponta para a expiration IMINENTE (TTE 2s), nao para o alvo:
    // e exatamente por isso que a V3 preserva a expiration exata e a V2 nunca deve ser reutilizada aqui.
    const recalculatedMs = (Math.floor(TTE302 / 300_000) + 1) * 300_000;
    expect(recalculatedMs).not.toBe(EXP);
    expect(assertExactExpirationTarget({ opportunity, requestedExpirationAt: recalculatedMs / 1000 }).code).toBe("ENTRY_EXPIRATION_MISMATCH");
    expect(assertExactExpirationTarget({ opportunity, requestedExpirationAt: EXP + 300_000 }).code).toBe("ENTRY_EXPIRATION_MISMATCH");
    expect(isAlignedExpiration(EXP)).toBe(true);
    expect(isAlignedExpiration(EXP + 1)).toBe(false);
  });

  it("H: ACK com expiration diferente e detectado como mismatch (contrato do broker)", async () => {
    // O runtime V2 ja publica order.expiration_mismatch quando brokerExpirationSec != pending.expirationSec.
    const runtimeSource = await import("node:fs").then((fs) => fs.readFileSync("relay/iq-multi-runtime.mjs", "utf8"));
    expect(runtimeSource).toMatch(/expirationMismatch = brokerExpirationSec !== null && brokerExpirationSec !== Number\(pending\.expirationSec\)/);
    expect(runtimeSource).toMatch(/BROKER_EXPIRATION_MISMATCH/);
    expect(runtimeSource).toMatch(/order\.expiration_mismatch/);
  });

  it("alinhamento 300s e obrigatorio na autoridade de timing", () => {
    expect(() => ExpirationTargetTiming.derive({ expirationAt: EXP + 30_000, brokerNow: TTE330 })).toThrowError(/EXPIRATION_NOT_ALIGNED/);
    expect(ExpirationTargetTiming.phase({ tteMs: 330_000 })).toBe("OPPORTUNITY_WINDOW");
    expect(ExpirationTargetTiming.phase({ tteMs: 300_000 })).toBe("MISSED_5M_ENTRY_WINDOW");
    expect(ExpirationTargetTiming.phase({ tteMs: 331_000 })).toBe("NOT_YET_OFFERED");
  });

  it("broker server time e a autoridade (sync com offset)", () => {
    const clock = { local: 1_000_000 };
    const t = new ExpirationTargetTiming({ now: () => clock.local });
    t.syncServerTime(1_000_000 + 7_000, clock.local);
    expect(t.serverNow(clock.local)).toBe(1_007_000);
    clock.local += 1_000;
    expect(t.serverNow()).toBe(1_008_000);
  });
});
