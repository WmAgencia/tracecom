/**
 * OFFICE V3 — RESULTS PANEL + LOGS OVERLAY (frontend/UX only).
 *
 * Valida o que foi prometido na rodada:
 *   - RESULTADO DO DIA legivel no DOM (dia/semana/mes) com dados reais;
 *   - campo ausente vira "N/A" (nunca NaN/undefined/numero inventado);
 *   - logs em overlay normal com as colunas exigidas e mais recente primeiro;
 *   - abrir/fechar o painel de logs funciona.
 *
 * Sem jsdom: micro-DOM fake (mesma abordagem dos testes de dashboard).
 */
import { describe, expect, it, beforeEach } from "vitest";

// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const results = await import("../../src/http/public/office-v3/results-panel.js");
// @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
const logs = await import("../../src/http/public/office-v3/logs-panel.js");

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
  private _text = "";

  constructor(tag: string, namespace: string | null = null) {
    this.tagName = String(tag).toUpperCase();
    this.namespace = namespace;
    const self = this;
    this.classList = {
      add(...names: string[]) { self._className = [...new Set([...self._className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove(...names: string[]) { self._className = [...new Set(self._className.split(/\s+/).filter(Boolean))].filter((name) => !names.includes(name)).join(" "); },
      contains(name: string) { return self._className.split(/\s+/).includes(name); },
      toggle(name: string, force?: boolean) {
        const on = force === undefined ? !self.classList.contains(name) : force;
        if (on) self.classList.add(name); else self.classList.remove(name);
        return on;
      },
    };
  }

  get className(): string { return this._className; }
  set className(value: any) { this._className = value == null ? "" : String(value); }

  get textContent(): string {
    if (this.childNodes.length) return this.childNodes.map((node: any) => node.textContent ?? "").join("");
    return this._text;
  }
  set textContent(value: any) { this._text = value == null ? "" : String(value); this.childNodes = []; }

  get children(): any[] { return this.childNodes.filter((node: any) => node instanceof FakeElement); }

  appendChild(node: any) { if (node == null) return node; node.parentNode = this; this.childNodes.push(node); return node; }
  append(...nodes: any[]) { for (const node of nodes) this.appendChild(typeof node === "string" ? { textContent: node } : node); }
  replaceChildren(...nodes: any[]) { this.childNodes = []; this._text = ""; this.append(...nodes); }
  setAttribute(name: string, value: any) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = value;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match: string, letter: string) => letter.toUpperCase());
      this.dataset[key] = String(value);
    }
  }
  getAttribute(name: string) { return name in this.attributes ? this.attributes[name] : null; }
  addEventListener(type: string, handler: Function) { (this.listeners[type] ||= []).push(handler); }
  dispatchEvent(event: any) { for (const handler of this.listeners[event?.type] || []) handler(event); return true; }
}

class FakeDocument {
  createElement(tag: string) { return new FakeElement(tag); }
  createElementNS(namespace: string, tag: string) { return new FakeElement(tag, namespace); }
}

function walk(node: any, visit: (node: any) => void) {
  visit(node);
  for (const child of node?.childNodes ?? []) walk(child, visit);
}

function byClass(root: any, className: string): any[] {
  const out: any[] = [];
  walk(root, (node) => { if (node instanceof FakeElement && node.className.split(/\s+/).includes(className)) out.push(node); });
  return out;
}

function byMetric(root: any, metric: string): any[] {
  const out: any[] = [];
  walk(root, (node) => { if (node instanceof FakeElement && node.dataset?.metric === metric) out.push(node); });
  return out;
}

function snapshot(overrides: any = {}) {
  return {
    at: 1789600000000,
    mode: "PRACTICE",
    portfolio: {
      settled: { wins: 3, losses: 1, draws: 0, pnl: 3.5, trades: 4 },
      weekly: { pnl: -2.25, trades: 11 },
      monthly: { pnl: 12.75, trades: 33 },
      equityCurve: [{ cumulative: 0.8 }, { cumulative: 2.1 }, { cumulative: 3.5 }],
    },
    markets: [
      { marketKey: "EURUSD:OTC", enabled: true, availability: "OPEN", payout: 82 },
      { marketKey: "GBPUSD:OTC", enabled: true, availability: "OPEN", payout: 84 },
      { marketKey: "USDJPY:OTC", enabled: true, availability: "CLOSED", payout: null },
    ],
    ...overrides,
  };
}

describe("OFFICE V3 RESULTS — modelo (dia/semana/mes, sem inventar)", () => {
  it("dia/semana/mes vem do snapshot real com sinal e casas corretas", () => {
    const model = results.buildResultsModel(snapshot());
    expect(model.day.pnlText).toBe("+R$ 3,50");
    expect(model.week.pnlText).toBe("-R$ 2,25");
    expect(model.month.pnlText).toBe("+R$ 12,75");
    expect(model.day.winRateText).toBe("75,0%");
    expect(model.day.subText).toContain("4 operações · 3W / 1L / 0D");
    expect(model.payoutText).toBe("83,0%");
    expect(model.payoutSamples).toBe(2);
    expect(model.equityPlaceholder).toBe(false);
  });

  it("dados ausentes viram N/A (nunca NaN/undefined)", () => {
    const model = results.buildResultsModel({ markets: [], portfolio: {} });
    for (const value of [model.day.pnlText, model.week.pnlText, model.month.pnlText, model.winRateText, model.payoutText]) {
      expect(value).toBe("N/A");
    }
    expect(JSON.stringify(model).includes("undefined")).toBe(false);
    expect(JSON.stringify(model).includes("NaN")).toBe(false);
  });

  it("serie de equity com menos de 2 pontos mostra placeholder explicito", () => {
    const model = results.buildResultsModel(snapshot({ portfolio: { ...snapshot().portfolio, equityCurve: [{ cumulative: 1 }] } }));
    expect(model.equityPlaceholder).toBe(true);
  });

  it("monta RESULTADO DO DIA, periodos e estatisticas no DOM", () => {
    (globalThis as any).document = new FakeDocument();
    const root = new FakeElement("div");
    results.mountResultsPanel(root, snapshot());
    const board = byClass(root, "tc-results-board")[0];
    expect(board).toBeTruthy();
    expect(byClass(root, "tc-results-hero-label")[0].textContent).toBe("RESULTADO DO DIA");
    expect(byClass(root, "tc-results-hero-value")[0].textContent).toBe("+R$ 3,50");
    expect(byMetric(root, "hoje")[0].textContent).toContain("+R$ 3,50");
    expect(byMetric(root, "semana")[0].textContent).toContain("-R$ 2,25");
    expect(byMetric(root, "mes")[0].textContent).toContain("+R$ 12,75");
    expect(byClass(root, "tc-results-stats")[0].textContent).toContain("WR OBSERVADO");
    expect(byClass(root, "tc-results-stats")[0].textContent).toContain("75,0%");
    expect(byClass(root, "tc-results-chart-line").length).toBe(1);
    expect(root.hidden).toBe(false);
  });
});

describe("OFFICE V3 LOGS — overlay legivel", () => {
  beforeEach(() => { (globalThis as any).document = new FakeDocument(); });

  const entry = (overrides: any = {}) => ({
    time: "12:34:56",
    marketKey: "GBPUSD:OTC",
    asset: "GBP/USD OTC",
    text: "ORDEM ACEITA · BUY",
    tone: "POSITIVE",
    agent: "RSI_REVERSAL_STRICT:GBPUSD:OTC",
    strategy: "RSI_REVERSAL_STRICT",
    skill: "RSI_REVERSAL_STRICT_V1",
    decision: "BUY",
    reason: "confluencia RSI_REVERSAL_STRICT_V1",
    orderId: "998877",
    executionId: "exec-42",
    result: "WIN",
    profit: 0.82,
    error: null,
    type: "order.ack",
    ...overrides,
  });

  it("linha traz as colunas exigidas e '—' quando o campo nao existe", () => {
    const full = logs.logRowModel(entry());
    expect(full.time).toBe("12:34:56");
    expect(full.agent).toContain("RSI_REVERSAL_STRICT");
    expect(full.market).toBe("GBPUSD:OTC");
    expect(full.strategy).toBe("RSI_REVERSAL_STRICT");
    expect(full.event).toBe("ORDEM ACEITA · BUY");
    expect(full.decision).toBe("BUY");
    expect(full.reason).toContain("confluencia");
    expect(full.order).toContain("ord 998877");
    expect(full.order).toContain("exec exec-42");
    expect(full.outcome).toContain("WIN");
    expect(full.outcome).toContain("+R$ 0,82");
    const sparse = logs.logRowModel({ time: "00:00:01" });
    expect(sparse.agent).toBe("—");
    expect(sparse.market).toBe("—");
    expect(sparse.strategy).toBe("—");
    expect(sparse.decision).toBe("—");
    expect(sparse.order).toBe("—");
    expect(sparse.outcome).toBe("—");
  });

  it("renderiza mais recente primeiro, limitado, com tone WIN/LOSS", () => {
    const doc = new FakeDocument();
    const list = doc.createElement("div");
    const entries = Array.from({ length: 250 }, (_value, index) => entry({ seq: index, text: `EVENTO ${index}`, tone: index % 2 === 1 ? "POSITIVE" : "NEGATIVE" }));
    const count = logs.renderLogRows(doc, list, entries, 200);
    expect(count).toBe(200);
    expect(list.childNodes[0].textContent).toContain("EVENTO 249");
    expect(list.childNodes[list.childNodes.length - 1].textContent).toContain("EVENTO 50");
    expect(byClass(list, "is-positive").length).toBeGreaterThan(0);
    expect(byClass(list, "is-negative").length).toBeGreaterThan(0);
  });

  it("estado vazio e explicito (sem inventar eventos)", () => {
    const doc = new FakeDocument();
    const list = doc.createElement("div");
    expect(logs.renderLogRows(doc, list, [])).toBe(0);
    expect(list.textContent).toContain("SEM EVENTOS AINDA");
  });

  it("botao abre/fecha o painel e mantem aria-expanded", () => {
    const doc = new FakeDocument();
    const toggle = doc.createElement("button");
    const panel = doc.createElement("section");
    panel.hidden = true;
    const list = doc.createElement("div");
    const meta = doc.createElement("span");
    const close = doc.createElement("button");
    const controller = logs.createLogsPanel({ document: doc, toggle, panel, list, meta, close });
    expect(controller.isOpen()).toBe(false);
    toggle.dispatchEvent({ type: "click" });
    expect(controller.isOpen()).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    controller.render([entry()]);
    expect(list.textContent).toContain("ORDEM ACEITA");
    expect(meta.textContent).toContain("1 evento");
    close.dispatchEvent({ type: "click" });
    expect(controller.isOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});
