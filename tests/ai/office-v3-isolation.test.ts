/**
 * OFFICE V3 — ISOLAMENTO MULTI-MERCADO (T12) + badge real (T7) + IQ OPTION (T2).
 *
 * Prova, com os módulos reais e um micro-DOM, que trocar rapidamente de ativo
 * (EURUSD → GBPJPY:OTC → GOLD → USDJPY → EURUSD), ou ter 55 mercados WORKING
 * simultâneos, NUNCA mistura painel, stake, logs, agentes, feed, candles ou
 * estado do Brain de outro marketKey.
 *
 * Frontend apenas. PRACTICE only. ZERO REAL. Nenhuma ordem é emitida.
 */
import { describe, expect, it, beforeAll } from "vitest";

/* ------------------------------------------------------------------ *
 * micro-DOM fake (mesmo contrato do micro-DOM de office-v3-ui-controls)
 * ------------------------------------------------------------------ */

class FakeText {
  nodeType = 3;
  private _text: string;
  constructor(text: unknown) {
    this._text = String(text);
  }
  get textContent(): string {
    return this._text;
  }
  set textContent(value: unknown) {
    this._text = value === null || value === undefined ? "" : String(value);
  }
}

class FakeElement {
  tagName: string;
  childNodes: any[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, Function[]> = {};
  hidden = false;
  disabled = false;
  value = "";
  placeholder = "";
  tabIndex = 0;
  isContentEditable = false;
  ownerDocument: any = null;
  parentNode: any = null;
  classList: any;
  private _className = "";

  constructor(tag: string) {
    this.tagName = String(tag).toUpperCase();
    const self = this;
    this.classList = {
      add(...names: string[]) {
        const set = new Set(self._className.split(/\s+/).filter(Boolean));
        for (const name of names) name && set.add(name);
        self._className = [...set].join(" ");
      },
      remove(...names: string[]) {
        const set = new Set(self._className.split(/\s+/).filter(Boolean));
        for (const name of names) set.delete(name);
        self._className = [...set].join(" ");
      },
      contains(name: string) {
        return self._className.split(/\s+/).includes(name);
      },
      toggle(name: string, force?: boolean) {
        const on = force === undefined ? !self.classList.contains(name) : force;
        if (on) self.classList.add(name);
        else self.classList.remove(name);
        return on;
      },
    };
  }

  get className(): string {
    return this._className;
  }
  set className(value: unknown) {
    this._className = value === null || value === undefined ? "" : String(value);
  }
  get textContent(): string {
    return this.childNodes.map((node: any) => node.textContent ?? "").join("");
  }
  set textContent(value: unknown) {
    const text = value === null || value === undefined ? "" : String(value);
    this.childNodes = text === "" ? [] : [new FakeText(text)];
  }
  set innerHTML(value: unknown) {
    this.textContent = value;
  }
  appendChild(node: any) {
    if (node === null || node === undefined) return node;
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes: any[]) {
    for (const node of nodes) this.appendChild(typeof node === "string" ? new FakeText(node) : node);
  }
  replaceChildren(...nodes: any[]) {
    this.childNodes = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode && Array.isArray(this.parentNode.childNodes)) {
      this.parentNode.childNodes = this.parentNode.childNodes.filter((node: any) => node !== this);
    }
    this.parentNode = null;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = value as string;
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
    if (event && event.target === undefined) event.target = this;
    if (event && typeof event.preventDefault !== "function") event.preventDefault = () => {};
    for (const handler of this.listeners[event?.type] || []) handler(event);
    return true;
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  contains(node: any): boolean {
    if (!node) return false;
    if (node === this) return true;
    for (const child of this.childNodes) if (child instanceof FakeElement && child.contains(node)) return true;
    return false;
  }
}

class FakeDocument {
  activeElement: any = null;
  createElement(tag: string) {
    const node = new FakeElement(tag);
    node.ownerDocument = this;
    return node;
  }
  createElementNS(_namespace: string, tag: string) {
    const node = new FakeElement(tag);
    node.ownerDocument = this;
    return node;
  }
}

function walk(node: any, visit: (node: any) => void) {
  visit(node);
  for (const child of node?.childNodes ?? []) walk(child, visit);
}

function findAll(root: any, predicate: (node: any) => boolean): any[] {
  const out: any[] = [];
  walk(root, (node) => {
    if (node instanceof FakeElement && predicate(node)) out.push(node);
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * módulos reais
 * ------------------------------------------------------------------ */

let detail: any;
let stateModel: any;
let world: any;
let life: any;
let topbar: any;
let fakeDoc: FakeDocument;

beforeAll(async () => {
  fakeDoc = new FakeDocument();
  (globalThis as any).document = fakeDoc;
  // @ts-expect-error - ESM visual sem tipos
  detail = await import("../../src/http/public/office-v3/market-detail.js");
  // @ts-expect-error - ESM visual sem tipos
  stateModel = await import("../../src/http/public/office-v3/state-model.js");
  // @ts-expect-error - ESM visual sem tipos
  world = await import("../../src/http/public/office-v3/world.js");
  // @ts-expect-error - ESM visual sem tipos
  life = await import("../../src/http/public/office-v3/life.js");
  // @ts-expect-error - ESM visual sem tipos
  topbar = await import("../../src/http/public/office-v3/topbar.js");
});

const NAMES = [
  { key: "EURUSD:NORMAL", canonical: "EURUSD", display: "EUR/USD", type: "NORMAL", stake: 11 },
  { key: "GBPJPY:OTC", canonical: "GBPJPY", display: "GBP/JPY OTC", type: "OTC", stake: 22 },
  { key: "GOLD:NORMAL", canonical: "GOLD", display: "GOLD", type: "NORMAL", stake: 33 },
  { key: "USDJPY:NORMAL", canonical: "USDJPY", display: "USD/JPY", type: "NORMAL", stake: 44 },
];

function marketFixture(index: number, overrides: Record<string, unknown> = {}) {
  const base = NAMES[index % NAMES.length]!;
  return {
    marketKey: base.key,
    canonical: base.canonical,
    symbol: base.display,
    display: base.display,
    marketType: base.type,
    enabled: true,
    availability: "OPEN",
    payout: 80 + index,
    configuredStake: base.stake,
    maxStake: 100,
    activeId: 1000 + index,
    candles5s: 10 + index,
    lastTick: { ageMs: 100 + index, price: 1.1 + index },
    featureState: { fresh: true, freshnessReason: "OK", rsi14: 40 + index, regime: `REGIME_${index}` },
    decisionState: { action: index % 2 === 0 ? "BUY" : "WAIT", regime: `REGIME_${index}`, setup: `SETUP_${index}`, trigger: `TRIGGER_${index}` },
    agents: {
      trader: { action: index % 2 === 0 ? "BUY" : "WAIT", confidence: 0.5 + index / 100, regime: `REGIME_${index}`, setup: `SETUP_${index}` },
      critic: { verdict: index % 3 === 0 ? "CONTEST" : "CONFIRM", finalRecommendation: index % 2 === 0 ? "BUY" : "WAIT", contradictions: [], riskFlags: [] },
      consensus: { action: index % 2 === 0 ? "BUY" : "WAIT", status: index % 3 === 0 ? "CONTESTED" : "CONFIRMED", reason: `REASON_${index}` },
    },
    settlementState: { lastResult: index % 2 === 0 ? "WIN" : "LOSS", lastProfit: index % 2 === 0 ? 1.5 + index : -(1 + index), lastAt: Date.now() - 1000, daily: { wins: index, losses: index + 1, draws: 0, settledPnl: 5 * index, trades: 2 * index + 1 } },
    ...overrides,
  };
}

function officeOf(markets: any[]) {
  return {
    version: "isolation-fixture",
    at: Date.now(),
    mode: "PRACTICE",
    connection: { connected: true, healthy: true },
    config: { defaultStake: 10, globalMaxStake: 100, hardCap: 100, autoExecute: false },
    portfolio: { settled: { wins: 0, losses: 0, draws: 0, pnl: 0, trades: 0 } },
    markets,
  };
}

function eventFor(market: any) {
  return [{ time: "12:00:00", marketKey: market.marketKey, text: `${market.display} · TRADER ${market.agents.trader.action}`, tone: null }];
}

/* ------------------------------------------------------------------ *
 * T12 — troca rápida de ativo
 * ------------------------------------------------------------------ */

describe("OFFICE V3 — isolamento: troca rápida de ativo (T12)", () => {
  it("EURUSD → GBPJPY:OTC → GOLD → USDJPY → EURUSD nunca mistura painel/stake/log/estado", () => {
    const markets = NAMES.map((_, index) => marketFixture(index));
    const office = officeOf(markets);
    const root = fakeDoc.createElement("div");
    const seen: string[] = [];

    const select = (key: string) => {
      const market = markets.find((candidate) => candidate.marketKey === key)!;
      detail.mountMarketDetail(root, office, key, { document: fakeDoc, eventLog: eventFor(market) });
      seen.push(key);
      const panel = findAll(root, (node) => node.classList?.contains("tc-v3-detail"))[0];
      const title = findAll(root, (node) => node.classList?.contains("tc-v3-detail-title"))[0];
      const stakeInput = findAll(root, (node) => node.classList?.contains("tc-stake-config-input"))[0];
      const activity = findAll(root, (node) => node.classList?.contains("tc-v3-activity-line"));
      const stateRow = findAll(root, (node) => node.dataset?.field === "state")[0];
      const stateValue = findAll(stateRow, (node) => node.tagName === "B")[0];
      expect(panel.dataset.marketKey, `painel de ${key}`).toBe(key);
      expect(title.textContent, `título de ${key}`).toBe(market.display);
      expect(stakeInput.value, `stake de ${key}`).toBe(String(market.configuredStake));
      expect(stateValue.textContent, `estado de ${key}`).toBe("MERCADO ABERTO · OPERANDO");
      expect(activity, `log de ${key}`).toHaveLength(1);
      expect(activity[0]!.dataset.marketKey, `log marketKey de ${key}`).toBe(key);
      expect(activity[0]!.textContent).toContain(market.display);
      expect(root.textContent).not.toContain("REASON_99");
      for (const other of NAMES) {
        if (other.key === key) continue;
        expect(root.textContent, `${key} não pode conter ${other.display}`).not.toContain(`${other.display} ·`);
      }
    };

    for (const key of ["EURUSD:NORMAL", "GBPJPY:OTC", "GOLD:NORMAL", "USDJPY:NORMAL", "EURUSD:NORMAL"]) select(key);
    expect(seen).toEqual(["EURUSD:NORMAL", "GBPJPY:OTC", "GOLD:NORMAL", "USDJPY:NORMAL", "EURUSD:NORMAL"]);
    const panels = findAll(root, (node) => node.classList?.contains("tc-v3-detail"));
    expect(panels).toHaveLength(1);
    expect(panels[0]!.dataset.marketKey).toBe("EURUSD:NORMAL");
  });

  it("cada estação tem feed/candles/Brain próprios (sem cross-market contamination)", () => {
    const markets = NAMES.map((_, index) => marketFixture(index));
    const office = officeOf(markets);
    const worldState = world.buildWorldState(office);
    stateModel.attachDerivedStates(worldState, office);
    const byKey = new Map<string, any>(worldState.stations.map((station: any) => [String(station.marketKey), station]));
    for (const market of markets) {
      const derived = byKey.get(market.marketKey)!.derived;
      expect(derived.marketKey).toBe(market.marketKey);
      expect(derived.candles5s).toBe(market.candles5s);
      expect(derived.tickAgeMs).toBe(market.lastTick.ageMs);
      expect(derived.feedStatus).toBe("FRESH");
      const otherKeys = markets.filter((candidate) => candidate.marketKey !== market.marketKey).map((candidate) => candidate.candles5s);
      expect(otherKeys).not.toContain(derived.candles5s);
    }
    const identities = new Set(worldState.stations.map((station: any) => station.derived));
    expect(identities.size).toBe(worldState.stations.length);
  });

  it("55 mercados WORKING simultâneos → 55 pares trader+critic, cada um no seu desk", () => {
    const markets = Array.from({ length: 55 }, (_, index) =>
      marketFixture(index, {
        marketKey: `MK${index}:NORMAL`,
        canonical: `MK${index}`,
        symbol: `MK/${index}`,
        display: `MK/${index}`,
        configuredStake: null,
      }),
    );
    const office = officeOf(markets);
    const worldState = world.buildWorldState(office);
    stateModel.attachDerivedStates(worldState, office);
    life.bindWorld(world);
    const system = life.createLifeSystem(worldState, { seed: "isolation-55" });
    for (const station of worldState.stations) life.setPresence(system, station.id, station.derived.agentsWorking === true);
    life.updateLife(system, 16);

    const states = life.getAgentStates(system);
    const working = states.filter((agent: any) => agent.working === true);
    expect(working).toHaveLength(110);
    expect(working.every((agent: any) => agent.atDesk === true && agent.location === "desk")).toBe(true);
    const registry = life.getAgentRegistry(system);
    expect(Object.keys(registry)).toHaveLength(55);
    const ids = new Set<string>();
    for (const [key, entry] of Object.entries<any>(registry)) {
      expect(entry.traderAgentId).toBeTruthy();
      expect(entry.criticAgentId).toBeTruthy();
      expect(entry.currentLocation).toBe("desk");
      expect(entry.traderAgentId).not.toBe(entry.criticAgentId);
      expect(ids.has(entry.traderAgentId)).toBe(false);
      expect(ids.has(entry.criticAgentId)).toBe(false);
      ids.add(entry.traderAgentId);
      ids.add(entry.criticAgentId);
      const pair = working.filter((agent: any) => agent.marketKey === key);
      expect(pair).toHaveLength(2);
      expect(pair.filter((agent: any) => agent.role === "trader")).toHaveLength(1);
      expect(pair.filter((agent: any) => agent.role === "critic")).toHaveLength(1);
    }
    expect(life.validateLifeInvariants(system).ok).toBe(true);
    const stats = system.stats;
    expect(stats.working).toBe(110);
    expect(stats.atDesk).toBe(110);
    expect(stats.desksEmpty).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * T7 — badge de settlement real com janela de ~12s
 * ------------------------------------------------------------------ */

describe("OFFICE V3 — badge WIN/LOSS/DRAW real (T7)", () => {
  it("mostra apenas settlement real e desaparece depois de 12s", () => {
    const now = Date.now();
    const markets = [
      marketFixture(0, { settlementState: { lastResult: "WIN", lastProfit: 8.5, lastAt: now - 500, daily: {} } }),
      marketFixture(1, { settlementState: { lastResult: "LOSS", lastProfit: -4.2, lastAt: now - 500, daily: {} } }),
      marketFixture(2, { settlementState: { lastResult: "DRAW", lastProfit: 0, lastAt: now - 500, daily: {} } }),
      marketFixture(3, { settlementState: { lastResult: "WIN", lastProfit: 9.9, lastAt: now - 20_000, daily: {} } }),
    ];
    const worldState = world.buildWorldState(officeOf(markets));
    const station = (index: number) => worldState.stations[index];
    expect(station(0).badge).toMatchObject({ visible: true, tone: "POSITIVE", text: "+R$ 8,50" });
    expect(station(1).badge).toMatchObject({ visible: true, tone: "NEGATIVE", text: "−R$ 4,20" });
    expect(station(2).badge).toMatchObject({ visible: true, tone: "ZERO", text: "R$ 0,00" });
    expect(world.settlementBadgeVisible(station(0), now)).toBe(true);
    expect(world.settlementBadgeVisible(station(3), now)).toBe(false);
    expect(world.settlementBadgeVisible(station(0), now + 12_001)).toBe(false);
  });

  it("nunca vira badge com dado incompleto/mock (sem lastAt, profit não finito, cancelada)", () => {
    const now = Date.now();
    const markets = [
      marketFixture(0, { settlementState: { lastResult: "WIN", lastProfit: 5 } }),
      marketFixture(1, { settlementState: { lastResult: "WIN", lastProfit: null, lastAt: now } }),
      marketFixture(2, { settlementState: { lastResult: "CANCELLED", lastProfit: 5, lastAt: now } }),
      marketFixture(3, { settlementState: { lastResult: "WIN", lastProfit: Number.NaN, lastAt: now }, indicative: { indicativePnl: 99 }, positionState: { status: "OPEN" } }),
    ];
    const worldState = world.buildWorldState(officeOf(markets));
    for (const index of [0, 1, 2, 3]) {
      expect(worldState.stations[index].badge.visible).toBe(false);
      expect(world.settlementBadgeVisible(worldState.stations[index], now)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * T2 — IQ OPTION model sem credenciais
 * ------------------------------------------------------------------ */

describe("OFFICE V3 — IQ OPTION (T2)", () => {
  const office = officeOf([marketFixture(0)]);
  (office as any).legacy = {
    account: { type: "PRACTICE", currency: "BRL", balance: 1234.56, verified: true, hasReal: false },
    marketData: { connected: true, healthy: true, host: "iqoption.com" },
  };

  it("deriva conexão, modo, conta, saldo, WS e MCP do snapshot real", () => {
    const model = topbar.buildIqOptionModel(office, null);
    expect(model.connected).toBe(true);
    expect(model.practice).toBe(true);
    expect(model.accountType).toBe("PRACTICE");
    expect(model.balanceText).toBe("BRL 1234.56");
    expect(model.wsText).toBe("ONLINE");
    expect(model.mcpKnown).toBe(false);
    expect(model.mcpStatus).toBe("SEM STATUS NO SNAPSHOT");
    expect(model.realBlocked).toBe(true);
  });

  it("nunca serializa senha/token/ssid/cookie/secret/apiKey", () => {
    const model = topbar.buildIqOptionModel(office, { state: "CONNECTED_READ_ONLY", email: "t***@x.com" });
    const json = JSON.stringify(model);
    for (const forbidden of ["password", "ssid", "token", "cookie", "secret", "apiKey", "api_key", "authorization"]) {
      expect(json.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("status do relay preenche WS/saldo quando o snapshot não traz legacy", () => {
    const bare = officeOf([marketFixture(0)]);
    const status = {
      state: "CONNECTED_READ_ONLY",
      mode: "PRACTICE",
      hasSession: true,
      marketData: { connected: true, healthy: true, host: "iqoption.com" },
      account: { type: "PRACTICE", currency: "BRL", balance: 999.5, verified: true, hasReal: false },
    };
    const model = topbar.buildIqOptionModel(bare, status);
    expect(model.connected).toBe(true);
    expect(model.balanceText).toBe("BRL 999.50");
    expect(model.accountType).toBe("PRACTICE");
  });
});
