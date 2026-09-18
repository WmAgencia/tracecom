/**
 * OFFICE V3 — SINGLE DERIVED STATE (TASK 3).
 *
 * Prova que existe UMA derivação explícita (`state-model.js`) usada por todos
 * os consumidores: desk/overlay, popup MESAS, painel direito e agentes. O bug
 * OPEN × OFFLINE (broker OPEN, feed offline, Habilitado=NÃO) nunca pode fazer
 * o desk "trabalhar" nem o popup mostrar OPEN puro sem explicação.
 *
 * Frontend apenas. PRACTICE only. ZERO REAL. Nenhuma ordem é emitida.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const model = await import("../../src/http/public/office-v3/state-model.js");
// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const page = await import("../../src/http/public/office-v3/office-v3.js");
// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const detail = await import("../../src/http/public/office-v3/market-detail.js");
// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const overlay = await import("../../src/http/public/office-v3/overlay.js");
// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const dashboard = await import("../../src/http/public/office-v3/dashboard.js");
// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const world = await import("../../src/http/public/office-v3/world.js");
// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const life = await import("../../src/http/public/office-v3/life.js");

const READ = (name: string) => readFileSync(new URL(`../../src/http/public/office-v3/${name}`, import.meta.url), "utf8");

/* ------------------------------------------------------------------ *
 * micro-DOM mínimo (só o necessário para o popup MESAS)
 * ------------------------------------------------------------------ */

class FakeNode {
  tagName: string;
  hidden = false;
  parentNode: any = null;
  childNodes: any[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners: Record<string, Function[]> = {};
  classList: any;
  private _classes = new Set<string>();

  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    const self = this;
    this.classList = {
      add(...names: string[]) {
        for (const name of names) name && self._classes.add(name);
      },
      remove(...names: string[]) {
        for (const name of names) self._classes.delete(name);
      },
      contains(name: string) {
        return self._classes.has(name);
      },
      toggle(name: string, force?: boolean) {
        const on = force === undefined ? !self._classes.has(name) : force;
        if (on) self._classes.add(name);
        else self._classes.delete(name);
        return on;
      },
    };
  }

  get className(): string {
    return [...this._classes].join(" ");
  }
  set className(value: any) {
    this._classes = new Set(String(value ?? "").split(/\s+/).filter(Boolean));
  }

  get textContent(): string {
    return this.childNodes.map((node: any) => node.textContent ?? "").join("");
  }
  set textContent(value: any) {
    this.childNodes = value === "" || value === null || value === undefined ? [] : [{ textContent: String(value) }];
  }

  appendChild(node: any) {
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes: any[]) {
    for (const node of nodes) this.appendChild(node);
  }
  setAttribute(name: string, value: any) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_m: string, letter: string) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name: string) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  addEventListener(type: string, handler: Function) {
    (this.listeners[type] ||= []).push(handler);
  }
  dispatchEvent(event: any) {
    if (event.target === undefined) event.target = this;
    for (const handler of this.listeners[event?.type] || []) handler(event);
    return true;
  }
  focus() {}
  querySelectorAll(selector: string): any[] {
    const out: any[] = [];
    const match = (node: any) => selector.startsWith(".") && node?.classList?.contains?.(selector.slice(1));
    for (const child of this.childNodes) {
      if (match(child)) out.push(child);
      if (child?.querySelectorAll) out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
}

function fakeDocument() {
  return { createElement: (tag: string) => new FakeNode(tag) };
}

/* ------------------------------------------------------------------ *
 * fixtures
 * ------------------------------------------------------------------ */

function market(overrides: Record<string, unknown> = {}) {
  return {
    marketKey: "EURUSD:NORMAL",
    marketType: "NORMAL",
    canonical: "EURUSD",
    symbol: "EUR/USD",
    display: "EUR/USD",
    enabled: true,
    paused: false,
    availability: "OPEN",
    payout: 82,
    agentState: "WAIT",
    candles5s: 120,
    lastTick: { ageMs: 220 },
    featureState: { fresh: true, freshnessReason: "OK" },
    ...overrides,
  };
}

function officeFixture(markets: Array<Record<string, unknown>> = [market()]) {
  return {
    version: "iq-multi-runtime-v3",
    at: 1_789_600_000_000,
    mode: "PRACTICE",
    connection: { connected: true, healthy: true },
    markets,
  };
}

const feedOffline = (overrides: Record<string, unknown> = {}) => market({
  marketKey: "GBPUSD:NORMAL",
  canonical: "GBPUSD",
  symbol: "GBP/USD",
  display: "GBP/USD",
  agentState: "OFFLINE",
  candles5s: 0,
  lastTick: null,
  featureState: null,
  ...overrides,
});

/* ------------------------------------------------------------------ *
 * TASK 3 — derivação explícita
 * ------------------------------------------------------------------ */

describe("OFFICE V3 state-model — estados explícitos", () => {
  it("broker OPEN + enabled + feed fresco → WORKING com agentes no desk", () => {
    const state = model.deriveMarketState(market(), null, { connected: true });
    expect(state.state).toBe("WORKING");
    expect(state.agentsWorking).toBe(true);
    expect(state.deskState).toBe("WORKING");
    expect(state.socialEligible).toBe(false);
    expect(state.feedStatus).toBe("FRESH");
    expect(state.label).toBe("MERCADO ABERTO · OPERANDO");
  });

  it("broker OPEN + feed offline → OPEN_BUT_FEED_OFFLINE com label exato e sem trabalho", () => {
    const state = model.deriveMarketState(feedOffline(), null, { connected: true });
    expect(state.state).toBe("OPEN_BUT_FEED_OFFLINE");
    expect(state.label).toBe("MERCADO ABERTO · FEED OFFLINE");
    expect(state.agentsWorking).toBe(false);
    expect(state.deskState).toBe("EMPTY");
    expect(state.socialEligible).toBe(true);
    expect(state.feedStatus).toBe("OFFLINE");
  });

  it("broker OPEN + feed stale (featureState.fresh=false) → feed offline, não trabalha", () => {
    const state = model.deriveMarketState(market({ featureState: { fresh: false, freshnessReason: "STALE_ANALYSIS" } }), null, null);
    expect(state.state).toBe("OPEN_BUT_FEED_OFFLINE");
    expect(state.feedStatus).toBe("STALE");
    expect(state.agentsWorking).toBe(false);
  });

  it("broker OPEN + tick velho (>15s) → feed offline, não trabalha", () => {
    const state = model.deriveMarketState(market({ lastTick: { ageMs: 60_000 }, featureState: null, agentState: "WAIT" }), null, null);
    expect(state.state).toBe("OPEN_BUT_FEED_OFFLINE");
    expect(state.feedStatus).toBe("STALE");
    expect(state.agentsWorking).toBe(false);
  });

  it("broker OPEN + conexão do office offline → feed offline, não trabalha", () => {
    const state = model.deriveMarketState(market({ featureState: null, lastTick: null, candles5s: null, agentState: "WAIT" }), null, { connected: false });
    expect(state.state).toBe("OPEN_BUT_FEED_OFFLINE");
    expect(state.feedStatus).toBe("OFFLINE");
    expect(state.feedReason).toBe("OFFICE_CONNECTION_OFFLINE");
  });

  it("broker OPEN + Habilitado=NÃO → DISABLED com explicação, mesa vazia", () => {
    const state = model.deriveMarketState(market({ enabled: false, availability: "OPEN" }), null, null);
    expect(state.state).toBe("DISABLED");
    expect(state.enabled).toBe(false);
    expect(state.label).toBe("MERCADO ABERTO · DESABILITADO");
    expect(state.explanation).toContain("Habilitado=NÃO");
    expect(state.agentsWorking).toBe(false);
    expect(state.deskState).toBe("EMPTY");
  });

  it("cobre CLOSED, SUSPENDED, DISABLED, NOT_OFFERED e UNKNOWN", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [market({ availability: "CLOSED" }), "CLOSED"],
      [market({ availability: "SUSPENDED" }), "SUSPENDED"],
      [market({ availability: "OPEN", paused: true }), "SUSPENDED"],
      [market({ availability: "DISABLED" }), "DISABLED"],
      [market({ availability: "NOT_FOUND" }), "NOT_OFFERED"],
      [market({ availability: "WEIRD" }), "UNKNOWN"],
      [market({ availability: null }), "UNKNOWN"],
    ];
    for (const [input, expected] of cases) {
      const state = model.deriveMarketState(input, null, null);
      expect(state.state, JSON.stringify(input)).toBe(expected);
      expect(state.agentsWorking).toBe(false);
      expect(state.deskState).toBe("EMPTY");
      expect(state.socialEligible).toBe(true);
    }
    const missing = model.deriveMarketState(null, null, null);
    expect(missing.state).toBe("UNKNOWN");
    expect(missing.marketKey).toBeNull();
  });

  it("feed explícito tem precedência sobre os campos do mercado", () => {
    const stale = market({ featureState: { fresh: false, freshnessReason: "STALE" } });
    const state = model.deriveMarketState(stale, { fresh: true, ageMs: 50 }, { connected: true });
    expect(state.state).toBe("WORKING");
    expect(state.feedSource).toBe("FEED");
    const offline = model.deriveMarketState(market(), { feedStatus: "OFFLINE" }, { connected: true });
    expect(offline.state).toBe("OPEN_BUT_FEED_OFFLINE");
  });

  it("candles5s=0 + último tick indisponível → nunca WORKING", () => {
    const state = model.deriveMarketState(market({ agentState: "WAIT", candles5s: 0, lastTick: null, featureState: null }), null, { connected: true });
    expect(state.state).toBe("OPEN_BUT_FEED_OFFLINE");
    expect(state.feedStatus).toBe("MISSING");
    expect(state.agentsWorking).toBe(false);
  });

  it("resolveMarketFeed normaliza modos online/stale/offline/missing", () => {
    expect(model.resolveMarketFeed(null, { status: "ONLINE" }, null).feedStatus).toBe("FRESH");
    expect(model.resolveMarketFeed(null, { status: "LAGGING" }, null).feedStatus).toBe("STALE");
    expect(model.resolveMarketFeed(null, { status: "DISCONNECTED" }, null).feedStatus).toBe("OFFLINE");
    expect(model.resolveMarketFeed(null, { status: "NO_FEED" }, null).feedStatus).toBe("MISSING");
    expect(model.resolveMarketFeed(null, { status: "???" }, null).feedStatus).toBe("UNKNOWN");
  });
});

/* ------------------------------------------------------------------ *
 * TASK 3 — regressão OPEN × OFFLINE
 * ------------------------------------------------------------------ */

describe("OFFICE V3 state-model — OPEN × OFFLINE impossível", () => {
  it("para todo OPEN sem trabalho há explicação explícita (feed ou enabled) e desk EMPTY", () => {
    const inputs = [
      feedOffline(),
      market({ enabled: false }),
      market({ featureState: { fresh: false } }),
      market({ availability: "OPEN", paused: true }),
    ];
    for (const input of inputs) {
      const state = model.deriveMarketState(input, null, { connected: true });
      expect(state.agentsWorking).toBe(false);
      const explicit = state.label.includes("FEED OFFLINE") || state.label.includes("DESABILITADO") || state.label.includes("SUSPENSO");
      expect(explicit, `sem explicação: ${state.label}`).toBe(true);
      expect(state.explanation.length).toBeGreaterThan(10);
    }
  });

  it("nunca existe label de operando sem agentsWorking=true", () => {
    const states = [
      model.deriveMarketState(feedOffline()),
      model.deriveMarketState(market({ enabled: false })),
      model.deriveMarketState(market()),
      model.deriveMarketState(market({ availability: "CLOSED" })),
    ];
    for (const state of states) {
      if (state.label.includes("OPERANDO")) expect(state.agentsWorking).toBe(true);
      if (state.agentsWorking) expect(state.state).toBe("WORKING");
    }
  });

  it("é impossível o popup mostrar OPEN puro com o desk fechado sem explicação", () => {
    const json = officeFixture([market(), feedOffline(), market({ marketKey: "USDJPY:NORMAL", display: "USD/JPY", enabled: false })]);
    const worldState = world.buildWorldState(json);
    model.attachDerivedStates(worldState, json);
    const toggle = new FakeNode("button");
    const panel = new FakeNode("div");
    panel.hidden = true;
    const search = new FakeNode("input");
    const list = new FakeNode("div");
    const doc = fakeDocument();
    const controller = page.createMesasController({ document: doc, toggle, panel, search, list });
    controller.setStations(worldState.stations);

    const options = list.childNodes.filter((node: any) => node.className.includes("station-option"));
    expect(options).toHaveLength(3);
    for (const [index, station] of worldState.stations.entries()) {
      const optionText = options[index]!.textContent as string;
      const derived = station.derived;
      expect(optionText).toBe(page.formatStationOption(station));
      expect(optionText).toContain(derived.label);
      if (!derived.agentsWorking) {
        expect(optionText.includes("MERCADO ABERTO · OPERANDO")).toBe(false);
      }
    }
    const off = worldState.stations[1]!.derived;
    expect(off.state).toBe("OPEN_BUT_FEED_OFFLINE");
    expect(off.label).toBe("MERCADO ABERTO · FEED OFFLINE");
    expect(options[1]!.dataset.state).toBe("OPEN_BUT_FEED_OFFLINE");
  });
});

/* ------------------------------------------------------------------ *
 * TASK 3 — uma única fonte para popup, desk, painel e agentes
 * ------------------------------------------------------------------ */

describe("OFFICE V3 state-model — fonte única compartilhada", () => {
  it("attachDerivedStates liga cada station exatamente ao mesmo objeto do byKey", () => {
    const json = officeFixture([market(), feedOffline()]);
    const worldState = world.buildWorldState(json);
    const states = model.attachDerivedStates(worldState, json);
    for (const station of worldState.stations) {
      expect(station.derived).toBe(states.byKey[station.marketKey]);
      expect(station.agentsWorking).toBe(station.derived.agentsWorking);
    }
    expect(states.byKey["EURUSD:NORMAL"].state).toBe("WORKING");
    expect(states.byKey["EURUSD:NORMAL"].agentsWorking).toBe(true);
  });

  it("painel direito usa a mesma derivação do station.derived (labels idênticos)", () => {
    const json = officeFixture([feedOffline()]);
    const worldState = world.buildWorldState(json);
    model.attachDerivedStates(worldState, json);
    const stationDerived = worldState.stations[0]!.derived;
    const panel = detail.buildMarketDetailModel(json.markets[0], json);
    expect(panel.state.label).toBe(stationDerived.label);
    expect(panel.state.state).toBe(stationDerived.state);
    expect(panel.state.agentsWorking).toBe(false);
    const stateRow = panel.sections.find((section: any) => section.id === "identity").rows.find((row: any) => row.key === "state");
    expect(stateRow.value).toBe("MERCADO ABERTO · FEED OFFLINE");
  });

  it("overlay obedece station.derived mesmo quando station.active=true", () => {
    const json = officeFixture([feedOffline()]);
    const worldState = world.buildWorldState(json);
    model.attachDerivedStates(worldState, json);
    expect(worldState.stations[0]!.active).toBe(true);
    const drawn: any[] = [];
    const ctx = fakeCtx();
    const stats = overlay.drawDynamicOverlay(ctx, worldState, null, null, {
      drawCharacter: (...args: any[]) => drawn.push(args),
      drawSupervisor: false,
    });
    expect(stats.open).toBe(0);
    expect(stats.agents).toBe(0);
    expect(stats.feedOffline).toBe(1);
    expect(drawn).toHaveLength(0);
  });

  it("desk e popup nunca divergem: a página anexa a derivação e o overlay a consome", () => {
    const pageSource = READ("office-v3.js");
    expect(pageSource).toContain('from "./state-model.js"');
    expect(pageSource).toContain("attachDerivedStates(worldState, json)");
    expect(pageSource).toContain("derived.agentsWorking");
    expect(pageSource).toContain("formatStationOption");
    const overlaySource = READ("overlay.js");
    expect(overlaySource).toContain("station.derived");
    expect(overlaySource).toContain("derived.agentsWorking");
    expect(READ("market-detail.js")).toContain("deriveMarketState");
    expect(READ("dashboard.js")).toContain("deriveOfficeStates");
  });

  it("agentes usam a presença derivada: OPEN com feed offline vai para social/idle", () => {
    const json = officeFixture([market(), feedOffline()]);
    const worldState = world.buildWorldState(json);
    model.attachDerivedStates(worldState, json);
    const system = life.createLifeSystem(worldState, { seed: "derived-presence" });
    for (const station of worldState.stations) {
      expect(life.setPresence(system, station.id, page.stationWorkingPresence(station))).toBe(true);
    }
    expect(page.stationWorkingPresence(worldState.stations[0])).toBe(true);
    expect(page.stationWorkingPresence(worldState.stations[1])).toBe(false);
    life.updateLife(system, 16);
    expect(system.stats.openStations).toBe(1);
    expect(system.stats.working).toBe(2);
    const offlineAgents = life.getAgentStates(system).filter((state: any) => state.stationId === worldState.stations[1]!.id);
    expect(offlineAgents).toHaveLength(2);
    for (const state of offlineAgents) {
      expect(state.working).toBe(false);
      expect(state.atDesk).toBe(false);
      expect(state.assignment).toBe("SOCIAL");
    }
  });

  it("dashboard conta WORKING (derivado) e separa feed offline", () => {
    const json = officeFixture([market(), feedOffline(), market({ marketKey: "USDJPY:NORMAL", availability: "CLOSED" })]);
    const modelDashboard = dashboard.buildDashboardModel(json);
    expect(modelDashboard.openMarkets).toBe(1);
    expect(modelDashboard.feedOfflineMarkets).toBe(1);
    expect(modelDashboard.closedMarkets).toBe(1);
    expect(modelDashboard.totalMarkets).toBe(3);
    const states = model.deriveOfficeStates(json);
    expect(states.counts).toMatchObject({ working: 1, openButFeedOffline: 1, closed: 1, total: 3 });
  });
});

/* ------------------------------------------------------------------ *
 * TASK 3 — badge só em evento real
 * ------------------------------------------------------------------ */

describe("OFFICE V3 state-model — badge só em evento real", () => {
  it("WORKING sem settlement não gera badge", () => {
    const state = model.deriveMarketState(market(), null, null);
    expect(state.agentsWorking).toBe(true);
    expect(state.badge.visible).toBe(false);
    expect(state.badge.text).toBe("");
  });

  it("resultado WIN/LOSS/DRAW real gera badge com texto e tom corretos", () => {
    const win = model.deriveMarketState(market({ settlementState: { lastResult: "WIN", lastProfit: 1.7 } }), null, null);
    expect(win.badge).toMatchObject({ visible: true, tone: "POSITIVE", text: "+R$ 1,70" });
    const loss = model.deriveMarketState(market({ settlementState: { lastResult: "LOSS", lastProfit: -4.2 } }), null, null);
    expect(loss.badge).toMatchObject({ visible: true, tone: "NEGATIVE", text: "−R$ 4,20" });
    const draw = model.deriveMarketState(market({ settlementState: { lastResult: "DRAW", lastProfit: 0 } }), null, null);
    expect(draw.badge).toMatchObject({ visible: true, tone: "ZERO", text: "R$ 0,00" });
  });

  it("settlement sem profit finito ou posição aberta não gera badge", () => {
    expect(model.realSettlementEvent(market({ settlementState: { lastResult: "WIN", lastProfit: null } }))).toBeNull();
    expect(model.realSettlementEvent(market({ lastTrade: { result: "ABERTA", profit: null } }))).toBeNull();
    expect(model.deriveMarketState(market(), null, null).badge.visible).toBe(false);
  });

  it("overlay só desenha badge em mesa WORKING com evento real", () => {
    const working = model.deriveMarketState(market({ settlementState: { lastResult: "WIN", lastProfit: 1.7 } }), null, null);
    const json = officeFixture([market({ settlementState: { lastResult: "WIN", lastProfit: 1.7 } }), feedOffline()]);
    const worldState = world.buildWorldState(json);
    model.attachDerivedStates(worldState, json);
    expect(worldState.stations[0]!.derived.badge.visible).toBe(true);
    const drawn: any[] = [];
    const ctx = fakeCtx();
    const stats = overlay.drawDynamicOverlay(ctx, worldState, null, null, {
      drawCharacter: (...args: any[]) => drawn.push(args),
      drawSupervisor: false,
    });
    expect(stats.badges).toBe(1);
    expect(working.badge.text).toBe("+R$ 1,70");
    expect(stats.feedOffline).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * fake canvas 2d só o suficiente para o overlay
 * ------------------------------------------------------------------ */

function fakeCtx() {
  const calls: any[] = [];
  const method = (name: string) => (...args: any[]) => calls.push([name, ...args]);
  return {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
    save: method("save"),
    restore: method("restore"),
    fillRect: method("fillRect"),
    strokeRect: method("strokeRect"),
    fillText: method("fillText"),
    strokeText: method("strokeText"),
    beginPath: method("beginPath"),
    moveTo: method("moveTo"),
    lineTo: method("lineTo"),
    stroke: method("stroke"),
  };
}
