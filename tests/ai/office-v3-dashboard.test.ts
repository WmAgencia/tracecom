/**
 * OFFICE V3 — DASHBOARD + MARKET DETAIL (frontend/UX only).
 *
 * jsdom não está disponível neste repositório, então os testes montam um
 * micro-DOM fake (createElement/createElementNS/createTextNode + árvore de
 * childNodes) e afirmam estrutura, textos e tokens do design system.
 *
 * Regra de ouro: nenhum número inventado. Os valores afirmados são exatamente
 * os do fixture, e campos ausentes viram "—".
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const dashboard = await import("../../src/http/public/office-v3/dashboard.js");
// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const detail = await import("../../src/http/public/office-v3/market-detail.js");

/* ------------------------------------------------------------------ *
 * micro-DOM fake
 * ------------------------------------------------------------------ */

class FakeText {
  nodeType = 3;
  parentNode: any = null;
  private _text: string;
  constructor(text: any) {
    this._text = String(text);
  }
  get textContent(): string {
    return this._text;
  }
  set textContent(value: any) {
    this._text = value === null || value === undefined ? "" : String(value);
  }
}

class FakeElement {
  tagName: string;
  namespace: string | null;
  childNodes: any[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, Function[]> = {};
  hidden = false;
  parentNode: any = null;
  classList: any;
  private _className = "";

  constructor(tag: string, namespace: string | null = null) {
    this.tagName = String(tag).toUpperCase();
    this.namespace = namespace;
    const self = this;
    this.classList = {
      add(...names: string[]) {
        const set = new Set(self._className.split(/\s+/).filter(Boolean));
        for (const name of names) set.add(name);
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
  set className(value: any) {
    this._className = value === null || value === undefined ? "" : String(value);
  }

  get textContent(): string {
    return this.childNodes.map((node: any) => node.textContent ?? "").join("");
  }
  set textContent(value: any) {
    const text = value === null || value === undefined ? "" : String(value);
    this.childNodes = text === "" ? [] : [new FakeText(text)];
  }
  set innerHTML(value: any) {
    const text = value === null || value === undefined ? "" : String(value);
    this.childNodes = text === "" ? [] : [new FakeText(text)];
  }

  get children(): any[] {
    return this.childNodes.filter((node: any) => node instanceof FakeElement);
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
  setAttribute(name: string, value: any) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = value;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name: string) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
  }
  addEventListener(type: string, handler: Function) {
    (this.listeners[type] ||= []).push(handler);
  }
  removeEventListener(type: string, handler: Function) {
    this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler);
  }
  dispatchEvent(event: any) {
    for (const handler of this.listeners[event?.type] || []) handler(event);
    return true;
  }
  remove() {
    if (this.parentNode && Array.isArray(this.parentNode.childNodes)) {
      this.parentNode.childNodes = this.parentNode.childNodes.filter((node: any) => node !== this);
    }
    this.parentNode = null;
  }
}

class FakeDocument {
  createElement(tag: string) {
    return new FakeElement(tag);
  }
  createElementNS(namespace: string, tag: string) {
    return new FakeElement(tag, namespace);
  }
  createTextNode(text: any) {
    return new FakeText(text);
  }
}

/* ------------------------------------------------------------------ *
 * DOM query helpers (tree walk; no querySelector needed)
 * ------------------------------------------------------------------ */

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

function byClass(root: any, className: string): any[] {
  return findAll(root, (node) => node.className.split(/\s+/).includes(className));
}

function byData(root: any, key: string, value: string): any[] {
  return findAll(root, (node) => node.dataset && node.dataset[key] === value);
}

function textOf(root: any, className: string): string | null {
  const node = byClass(root, className)[0];
  return node ? node.textContent : null;
}

function mount(office: any) {
  const root = new FakeElement("div");
  const result = dashboard.mountDashboard(root, office);
  return { root, result };
}

function cardValueElement(root: any, metric: string) {
  const card = byData(root, "metric", metric)[0];
  return card.childNodes.find((node: any) => node.className && node.className.split(/\s+/).includes("tc-v3-card-value"));
}

/* ------------------------------------------------------------------ *
 * fixtures — shaped exactly like the production office snapshot
 * ------------------------------------------------------------------ */

function fullMarket() {
  return {
    marketKey: "EURUSD:NORMAL",
    marketType: "NORMAL",
    canonical: "EURUSD",
    symbol: "EUR/USD",
    display: "EUR/USD",
    enabled: true,
    paused: false,
    maxStake: 10,
    activeId: 1,
    instrumentTypes: ["binary", "turbo"],
    availability: "OPEN",
    payout: 82,
    agentState: "WAIT",
    candles5s: 120,
    lastTick: { ageMs: 220 },
    featureState: { fresh: true, freshnessReason: "OK", rsi14: 61.2, adx14: 27.4, plusDi14: 31.1, minusDi14: 18.7, atr14: 0.00123, donchianPosition: 0.42 },
    decisionState: { action: "BUY", reason: "CONSENSUS_CONFIRMED", setup: "TREND_PULLBACK", regime: "TREND_UP", trigger: "pullback concluído", qualityScore: 0.71, failedChecks: [] },
    agents: {
      trader: { action: "BUY", confidence: 0.62, regime: "TREND_UP" },
      critic: { verdict: "CONFIRM", finalRecommendation: "BUY", contradictions: [], riskFlags: [] },
    },
    entryTiming: { stage: "REVALIDANDO", secondsToRevalidation: 2, secondsToEntry: 4, revalidatedAt: 1789600000000, candidateChangedBeforeEntry: false },
    positionState: { status: "IDLE", direction: null, stake: 2 },
    settlementState: { lastResult: "WIN", lastProfit: 1.7, daily: { wins: 1, losses: 0, draws: 0, settledPnl: 1.7, trades: 1 } },
    lastTrade: { direction: "CALL", result: "WIN", profit: 1.7, at: 1789600000000 },
    journal: [{ at: 1789600000000, result: "WIN" }],
  };
}

function sparseMarket() {
  return {
    marketKey: "EURUSD:OTC",
    marketType: "OTC",
    canonical: "EURUSD",
    symbol: "EUR/USD OTC",
    display: "EUR/USD OTC",
    enabled: false,
    availability: "CLOSED",
  };
}

function secondOpenMarket() {
  return {
    marketKey: "GBPUSD:NORMAL",
    marketType: "NORMAL",
    canonical: "GBPUSD",
    symbol: "GBP/USD",
    display: "GBP/USD",
    enabled: true,
    availability: "OPEN",
    payout: 78,
  };
}

function fixtureOffice() {
  return {
    version: "iq-multi-runtime-v2",
    at: 1789600000000,
    mode: "PRACTICE",
    connection: { connected: true, healthy: true },
    activeCount: 2,
    activeLimit: 10,
    config: { defaultStake: 10, globalMaxStake: 100 },
    brokerAutomation: "WS_ONLY_PRACTICE",
    journal: { trades: 26, decisions: 104 },
    portfolio: {
      settled: { wins: 14, losses: 11, draws: 1, pnl: 0.48, trades: 26 },
      weekly: { pnl: 1842.3 },
      monthly: { pnl: 6721.55 },
      equityCurve: [{ at: 1, cumulative: -1 }, { at: 2, cumulative: 0.2 }, { at: 3, cumulative: 0.48 }],
      openPositions: [],
    },
    markets: [fullMarket(), sparseMarket(), secondOpenMarket()],
  };
}

beforeEach(() => {
  (globalThis as any).document = new FakeDocument();
});

/* ------------------------------------------------------------------ *
 * dashboard — states
 * ------------------------------------------------------------------ */

describe("OFFICE V3 — estados do dashboard", () => {
  it("renderiza loading quando o snapshot é nulo", () => {
    const { root, result } = mount(null);
    expect(result.state).toBe("loading");
    expect(root.getAttribute("data-state")).toBe("loading");
    expect(textOf(root, "tc-v3-state-title")).toContain("Carregando");
  });

  it("renderiza empty quando não há mercados nem resultado", () => {
    const { root, result } = mount({});
    expect(result.state).toBe("empty");
    expect(root.getAttribute("data-state")).toBe("empty");
    expect(textOf(root, "tc-v3-state-title")).toContain("Sem dados");
  });

  it("renderiza error com a mensagem real", () => {
    const { root, result } = mount({ error: "HTTP 500" });
    expect(result.state).toBe("error");
    expect(root.getAttribute("data-state")).toBe("error");
    expect(textOf(root, "tc-v3-state-msg")).toContain("HTTP 500");
  });
});

/* ------------------------------------------------------------------ *
 * dashboard — resultado do dia e cards
 * ------------------------------------------------------------------ */

describe("OFFICE V3 — resultado do dia e cards", () => {
  it("RESULTADO DO DIA é o maior elemento e traz o valor real liquidado", () => {
    const { root } = mount(fixtureOffice());
    const value = textOf(root, "tc-v3-hero-value");
    expect(value).toBe("+R$ 0,48");
    const hero = byClass(root, "tc-v3-hero")[0];
    expect(hero.dataset.metric).toBe("daily-result");
    expect(textOf(root, "tc-v3-hero-label")).toBe("RESULTADO DO DIA");
  });

  it("colore o resultado (verde/vermelho) conforme o sinal real", () => {
    const negative = fixtureOffice();
    negative.portfolio.settled.pnl = -3;
    const { root } = mount(negative);
    const value = byClass(root, "tc-v3-hero-value")[0];
    expect(value.textContent).toBe("-R$ 3,00");
    expect(value.classList.contains("tc-v3-neg")).toBe(true);
    const { root: positiveRoot } = mount(fixtureOffice());
    expect(byClass(positiveRoot, "tc-v3-hero-value")[0].classList.contains("tc-v3-pos")).toBe(true);
  });

  it("cards WIN/LOSS/DRAW/Operações usam os valores reais do fixture", () => {
    const { root } = mount(fixtureOffice());
    expect(cardValueElement(root, "win").textContent).toBe("14");
    expect(cardValueElement(root, "loss").textContent).toBe("11");
    expect(cardValueElement(root, "draw").textContent).toBe("1");
    expect(cardValueElement(root, "operations").textContent).toBe("26");
  });

  it("card WR calcula a taxa real (14 / 25 = 56.0%)", () => {
    const { root } = mount(fixtureOffice());
    expect(textOf(root, "tc-v3-card-value")).toBeDefined();
    expect(cardValueElement(root, "winrate").textContent).toBe("56.0%");
  });

  it("card Mercados expõe abertos/fechados/total do fixture", () => {
    const { root } = mount(fixtureOffice());
    const card = byData(root, "metric", "markets")[0];
    expect(card.dataset.open).toBe("2");
    expect(card.dataset.closed).toBe("1");
    expect(card.dataset.total).toBe("3");
  });

  it("card Estado do sistema mostra modo, automação, conexão e stake", () => {
    const { root } = mount(fixtureOffice());
    const card = byData(root, "metric", "system")[0];
    expect(card.textContent).toContain("PRACTICE");
    expect(card.textContent).toContain("WS_ONLY_PRACTICE");
    expect(card.textContent).toContain("ONLINE");
    expect(card.textContent).toContain("R$ 10,00");
  });

  it("campos ausentes mostram — sem inventar números", () => {
    const office = { mode: "PRACTICE", markets: [sparseMarket()] };
    const { root } = mount(office);
    expect(textOf(root, "tc-v3-hero-value")).toBe("—");
    expect(cardValueElement(root, "winrate").textContent).toBe("—");
    expect(textOf(root, "tc-v3-hero-value")).not.toContain("R$");
  });
});

/* ------------------------------------------------------------------ *
 * dashboard — gráfico e progressividade
 * ------------------------------------------------------------------ */

describe("OFFICE V3 — gráfico e divulgação progressiva", () => {
  it("sem série de resultado mostra estado vazio explícito", () => {
    const office = fixtureOffice();
    office.portfolio.equityCurve = [];
    const { root } = mount(office);
    expect(textOf(root, "tc-v3-chart-empty")).toContain("Sem série");
    expect(byClass(root, "tc-v3-chart-svg").length).toBe(0);
  });

  it("com série real desenha a linha SVG", () => {
    const { root } = mount(fixtureOffice());
    const svg = byClass(root, "tc-v3-chart-svg")[0];
    expect(svg).toBeDefined();
    expect(svg.tagName).toBe("SVG");
    const line = byClass(root, "tc-v3-chart-line")[0];
    expect(line.getAttribute("points")).toContain(",");
    expect(line.getAttribute("points").split(" ")).toHaveLength(3);
  });

  it("toggle de detalhes revela a seção progressiva", () => {
    const { root } = mount(fixtureOffice());
    const button = byClass(root, "tc-v3-disclosure-toggle").find((node: any) => node.textContent.includes("Detalhes"));
    const panel = byClass(root, "tc-v3-disclosure")[0];
    expect(panel.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.dispatchEvent({ type: "click" });
    expect(panel.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(panel.textContent).toContain("+R$ 1.842,30");
    expect(panel.textContent).toContain("+R$ 6.721,55");
  });

  it("clicar numa mesa emite tracecom:market-select com o marketKey real", () => {
    const { root } = mount(fixtureOffice());
    const captured: string[] = [];
    root.addEventListener("tracecom:market-select", (event: any) => captured.push(event.detail.marketKey));
    const row = byData(root, "marketKey", "EURUSD:NORMAL")[0];
    row.dispatchEvent({ type: "click" });
    expect(captured).toEqual(["EURUSD:NORMAL"]);
  });
});

/* ------------------------------------------------------------------ *
 * dashboard — modelo puro e design system
 * ------------------------------------------------------------------ */

describe("OFFICE V3 — modelo puro e design system", () => {
  it("buildDashboardModel deriva apenas do snapshot", () => {
    const model = dashboard.buildDashboardModel(fixtureOffice());
    expect(model.pnl).toBeCloseTo(0.48);
    expect(model.pnlText).toBe("+R$ 0,48");
    expect(model.wins).toBe(14);
    expect(model.winRateText).toBe("56.0%");
    expect(model.openMarkets).toBe(2);
    expect(model.closedMarkets).toBe(1);
    expect(model.totalMarkets).toBe(3);
    expect(model.mode).toBe("PRACTICE");
    const empty = dashboard.buildDashboardModel({});
    expect(empty.pnl).toBeNull();
    expect(empty.pnlText).toBe("—");
    expect(empty.hasAnyData).toBe(false);
  });

  it("aplica a classe responsiva e o CSS contém tokens e breakpoints", () => {
    const { root } = mount(fixtureOffice());
    expect(root.classList.contains("tc-v3-dashboard")).toBe(true);
    expect(root.getAttribute("data-tc-v3")).toBe("dashboard");
    const css = readFileSync(new URL("../../src/http/public/office-v3/styles-v3.css", import.meta.url), "utf8");
    expect(css).toContain("--tc-v3-space-");
    expect(css).toContain("--tc-v3-amber");
    expect(css).toContain(".tc-v3-dashboard");
    expect(css).toContain(".tc-v3-hero-value");
    expect(css).toContain("@media");
    expect(css).toContain("1024px");
    expect(css).toContain("768px");
    expect(css).toContain("480px");
  });
});

/* ------------------------------------------------------------------ *
 * market detail
 * ------------------------------------------------------------------ */

describe("OFFICE V3 — detalhe de mercado", () => {
  it("mostra todos os campos obrigatórios exigidos", () => {
    const root = new FakeElement("div");
    detail.mountMarketDetail(root, fixtureOffice(), "EURUSD:NORMAL");
    const labels = findAll(root, (node) => node.className === "tc-v3-row-label").map((node) => node.textContent);
    const required = [
      "Ativo", "Símbolo", "Canônico", "Market key", "Tipo", "Produto", "Active ID", "Status", "Disponibilidade", "Payout", "Habilitado",
      "Feed freshness", "Candles 5s", "Último tick",
      "Trader ação", "Trader confiança", "Trader regime", "Critic veredito", "Critic recomendação", "Contradições", "Risk flags",
      "Regime", "Estrutura", "Setup", "Gatilho", "Quality Score", "Failed checks",
      "RSI", "ADX", "+DI", "-DI", "ATR", "Donchian",
      "JIT estágio", "JIT revalidação", "JIT entrada", "Final Revalidation", "Drift na janela",
      "Posição", "Direção", "Stake", "Última execução", "Settlement", "P&L",
      "Journal",
    ];
    for (const label of required) expect(labels, `campo ausente: ${label}`).toContain(label);
  });

  it("valores do detalhe são exatamente os do fixture (sem invenção)", () => {
    const root = new FakeElement("div");
    detail.mountMarketDetail(root, fixtureOffice(), "EURUSD:NORMAL");
    const rowValue = (field: string) => {
      const row = byData(root, "field", field)[0];
      return findAll(row, (node) => node.tagName === "B")[0].textContent;
    };
    expect(rowValue("marketKey")).toBe("EURUSD:NORMAL");
    expect(rowValue("marketType")).toBe("NORMAL");
    expect(rowValue("payout")).toBe("82%");
    expect(rowValue("rsi")).toBe("61,20");
    expect(rowValue("adx")).toBe("27,40");
    expect(rowValue("atr")).toBe("0,00123");
    expect(rowValue("stake")).toBe("R$ 2,00");
    expect(rowValue("pnl")).toBe("+R$ 1,70");
    expect(rowValue("traderConfidence")).toBe("62%");
  });

  it("campo ausente vira — com dica explícita não disponível", () => {
    const root = new FakeElement("div");
    detail.mountMarketDetail(root, fixtureOffice(), "EURUSD:OTC");
    const rsiRow = byData(root, "field", "rsi")[0];
    expect(findAll(rsiRow, (node) => node.tagName === "B")[0].textContent).toBe("—");
    const hint = findAll(rsiRow, (node) => node.className === "tc-v3-na")[0];
    expect(hint).toBeDefined();
    expect(hint.textContent).toBe("não disponível");
    const structureRow = byData(root, "field", "structure")[0];
    expect(findAll(structureRow, (node) => node.tagName === "B")[0].textContent).toBe("—");
  });

  it("marketKey desconhecido gera estado de erro explícito", () => {
    const root = new FakeElement("div");
    const result = detail.mountMarketDetail(root, fixtureOffice(), "NOPE:OTC");
    expect(result.state).toBe("error");
    expect(byClass(root, "tc-v3-detail")[0].getAttribute("data-state")).toBe("error");
    expect(root.textContent).toContain("Mercado não encontrado");
  });

  it("abas alternam as seções sem perder os campos do DOM", () => {
    const root = new FakeElement("div");
    detail.mountMarketDetail(root, fixtureOffice(), "EURUSD:NORMAL");
    const technicalTab = byData(root, "tab", "technical").find((node) => node.className.split(/\s+/).includes("tc-v3-tab"));
    const technicalBody = byData(root, "tab", "technical").find((node) => node.className.split(/\s+/).includes("tc-v3-detail-section"));
    const identityBody = byData(root, "tab", "identity").find((node) => node.className.split(/\s+/).includes("tc-v3-detail-section"));
    expect(technicalBody.hidden).toBe(true);
    expect(identityBody.hidden).toBe(false);
    technicalTab.dispatchEvent({ type: "click" });
    expect(technicalBody.hidden).toBe(false);
    expect(identityBody.hidden).toBe(true);
    expect(technicalTab.getAttribute("aria-selected")).toBe("true");
  });

  it("closeMarketDetail remove o painel montado", () => {
    const root = new FakeElement("div");
    detail.mountMarketDetail(root, fixtureOffice(), "EURUSD:NORMAL");
    expect(byClass(root, "tc-v3-detail")).toHaveLength(1);
    const closed = detail.closeMarketDetail();
    expect(closed).toBe(true);
    expect(byClass(root, "tc-v3-detail")).toHaveLength(0);
  });
});
