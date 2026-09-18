/**
 * OFFICE V3 — UI/UX CONTROLS (Tasks 2–6, headless com micro-DOM fake).
 *
 * Cobre: remoção do painel esquerdo, top bar (PRACTICE/conexão/ARM/AUTO/stake/
 * mercados) chamando os endpoints reais, stake por mercado com marketKey único,
 * correlação do painel direito, matemática da câmera (zoom no cursor, round-trip,
 * hitbox sincronizada), popup MESAS (busca + teclado), persistência após refresh
 * e a regressão de seleção de texto durante SPACE+drag.
 *
 * Frontend apenas. PRACTICE only. ZERO REAL. Nenhuma ordem é emitida.
 */
import { describe, expect, it, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";

/* ------------------------------------------------------------------ *
 * micro-DOM fake (createElement/createElementNS + árvore de childNodes)
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
  ownerDocument: any = null;
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
        for (const name of names) names && set.add(name);
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
    this.textContent = value;
  }

  get children(): any[] {
    return this.childNodes.filter((node: any) => node instanceof FakeElement);
  }
  get lastElementChild(): any {
    const elements = this.children;
    return elements.length ? elements[elements.length - 1] : null;
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
  setAttribute(name: string, value: any) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = value;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_m: string, letter: string) => letter.toUpperCase());
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
    for (const child of this.childNodes) {
      if (child instanceof FakeElement && child.contains(node)) return true;
    }
    return false;
  }
  querySelectorAll(selector: string): any[] {
    const match = (node: any) => {
      if (!(node instanceof FakeElement)) return false;
      if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
      if (selector.startsWith("#")) return node.getAttribute("id") === selector.slice(1);
      return node.tagName === selector.toUpperCase();
    };
    const out: any[] = [];
    const walk = (node: any) => {
      for (const child of node.childNodes ?? []) {
        if (match(child)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

class FakeDocument {
  body = new FakeElement("body");
  activeElement: any = null;
  private byId: Record<string, any> = {};
  createElement(tag: string) {
    const node = new FakeElement(tag);
    node.ownerDocument = this;
    const id = node.getAttribute("id");
    if (id) this.byId[id] = node;
    return node;
  }
  createElementNS(namespace: string, tag: string) {
    const node = new FakeElement(tag, namespace);
    node.ownerDocument = this;
    return node;
  }
  createTextNode(text: any) {
    return new FakeText(text);
  }
  getElementById(id: string) {
    return this.byId[id] ?? null;
  }
  register(id: string, node: any) {
    this.byId[id] = node;
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

function byData(root: any, key: string, value: string): any[] {
  return findAll(root, (node) => node.dataset && node.dataset[key] === value);
}

function topbarControl(root: any, key: string) {
  return byData(root, "tb", key)[0] ?? null;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ------------------------------------------------------------------ *
 * módulos reais (JS visual sem tipos) + fixtures
 * ------------------------------------------------------------------ */

let fakeDoc: FakeDocument;
let page: any;
let topbar: any;
let stakeConfig: any;
let detail: any;
let camera: any;
let world: any;
let assets: any;

beforeAll(async () => {
  fakeDoc = new FakeDocument();
  (globalThis as any).document = fakeDoc;
  // @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
  page = await import("../../src/http/public/office-v3/office-v3.js");
  // @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
  topbar = await import("../../src/http/public/office-v3/topbar.js");
  // @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
  stakeConfig = await import("../../src/http/public/office-v3/stake-config.js");
  // @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
  detail = await import("../../src/http/public/office-v3/market-detail.js");
  // @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
  camera = await import("../../src/http/public/office-v3/camera.js");
  // @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
  world = await import("../../src/http/public/office-v3/world.js");
  // @ts-expect-error - módulo visual ESM sem tipagem (validado em runtime)
  assets = await import("../../src/http/public/office-v3/assets.js");
});

function fullMarket(overrides: Record<string, unknown> = {}) {
  return {
    marketKey: "EURUSD:NORMAL",
    marketType: "NORMAL",
    canonical: "EURUSD",
    symbol: "EUR/USD",
    display: "EUR/USD",
    enabled: true,
    availability: "OPEN",
    payout: 82,
    activeId: 1,
    configuredStake: 10,
    maxStake: 100,
    ...overrides,
  };
}

function marketB() {
  return fullMarket({
    marketKey: "GBPUSD:NORMAL",
    canonical: "GBPUSD",
    symbol: "GBP/USD",
    display: "GBP/USD",
    configuredStake: null,
    payout: 78,
  });
}

function marketC() {
  return fullMarket({
    marketKey: "GBPJPY:OTC",
    marketType: "OTC",
    canonical: "GBPJPY",
    symbol: "GBP/JPY OTC",
    display: "GBP/JPY OTC",
    enabled: false,
    availability: "CLOSED",
    configuredStake: null,
    payout: null,
  });
}

function officeFixture(overrides: Record<string, unknown> = {}) {
  return {
    version: "iq-multi-runtime-v3",
    at: 1_789_600_000_000,
    mode: "PRACTICE",
    connection: { connected: true, healthy: true },
    config: { defaultStake: 10, globalMaxStake: 100, hardCap: 100, autoExecute: false },
    activeCount: 2,
    activeLimit: 55,
    aux: {
      compliance: { armState: { state: "DISARMED", armed: false }, killSwitch: { executionEnabled: true } },
      executionGate: { state: "DISARMED", armed: false },
    },
    markets: [fullMarket(), marketB(), marketC()],
    ...overrides,
  };
}

function mockFetch() {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  const impl = async (url: string, init: any = {}) => {
    let body: any = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method: init?.method ?? "GET", body });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return { calls, impl };
}

/* ------------------------------------------------------------------ *
 * TASK 2 — painel esquerdo de resultados removido
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — painel esquerdo removido (TASK 2)", () => {
  it("HTML da raiz e da página V3 não duplicam o board de resultados", () => {
    const v3Html = readFileSync(new URL("../../src/http/public/office-v3/office-v3.html", import.meta.url), "utf8");
    const rootHtml = readFileSync(new URL("../../src/http/public/index.html", import.meta.url), "utf8");
    for (const html of [v3Html, rootHtml]) {
      expect(html).not.toContain("office-dashboard");
      expect(html).not.toContain("tc-v3-dashboard");
      expect(html).not.toContain("max-height: 62vh");
      expect(html).toContain('id="office-topbar"');
      expect(html).toContain('id="mesas-toggle"');
    }
    expect(v3Html).toContain("./office-v3.js");
    expect(v3Html).toContain("./styles-v3.css");
  });

  it("office-v3.js não monta o dashboard lateral (só consome market-detail/topbar)", () => {
    const source = readFileSync(new URL("../../src/http/public/office-v3/office-v3.js", import.meta.url), "utf8");
    expect(source.includes("mountDashboard(")).toBe(false);
    expect(source.includes('id="office-topbar"')).toBe(false);
    expect(source.includes("mountTopBar")).toBe(true);
    expect(source.includes("./topbar.js")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * TASK 5 — top bar
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — top bar operacional (TASK 5)", () => {
  it("renderiza PRACTICE, conexão, ARM, AUTO, stake e mercados do snapshot real", () => {
    const root = fakeDoc.createElement("div");
    topbar.mountTopBar(root, officeFixture(), { document: fakeDoc });
    expect(topbarControl(root, "mode").textContent).toContain("PRACTICE");
    expect(topbarControl(root, "mode").textContent).toContain("ZERO REAL");
    expect(topbarControl(root, "connection").textContent).toContain("ONLINE");
    expect(topbarControl(root, "arm").textContent).toBe("ARM");
    expect(topbarControl(root, "auto").textContent).toBe("AUTO OFF");
    expect(topbarControl(root, "stake-input").value).toBe("10");
    expect(topbarControl(root, "markets").textContent).toContain("2/3");
    expect(topbarControl(root, "gate").textContent).toContain("DISARMED");
  });

  it("ARM chama POST /api/iq/arm com limitBrl e confirmation ARM_PRACTICE", async () => {
    const { calls, impl } = mockFetch();
    const root = fakeDoc.createElement("div");
    topbar.mountTopBar(root, officeFixture(), { document: fakeDoc, fetchImpl: impl });
    topbarControl(root, "arm").dispatchEvent({ type: "click" });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/iq/arm");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ limitBrl: 10, confirmation: "ARM_PRACTICE" });
  });

  it("com sistema armado o botão desarma via POST /api/iq/disarm", async () => {
    const { calls, impl } = mockFetch();
    const office = officeFixture({
      aux: {
        compliance: { armState: { state: "ARMED", armed: true }, killSwitch: { executionEnabled: true } },
        executionGate: { state: "ARMED", armed: true },
      },
    });
    const root = fakeDoc.createElement("div");
    topbar.mountTopBar(root, office, { document: fakeDoc, fetchImpl: impl });
    expect(topbarControl(root, "arm").textContent).toBe("DESARMAR");
    topbarControl(root, "arm").dispatchEvent({ type: "click" });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/iq/disarm");
    expect(calls[0]!.body).toEqual({});
  });

  it("AUTO OFF liga via POST /api/iq/config/auto-execute {enabled:true}", async () => {
    const { calls, impl } = mockFetch();
    const root = fakeDoc.createElement("div");
    topbar.mountTopBar(root, officeFixture(), { document: fakeDoc, fetchImpl: impl });
    topbarControl(root, "auto").dispatchEvent({ type: "click" });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/iq/config/auto-execute");
    expect(calls[0]!.body).toEqual({ enabled: true });
  });

  it("AUTO ON desliga via POST /api/iq/config/auto-execute {enabled:false}", async () => {
    const { calls, impl } = mockFetch();
    const office = officeFixture({ config: { defaultStake: 10, globalMaxStake: 100, hardCap: 100, autoExecute: true } });
    const root = fakeDoc.createElement("div");
    topbar.mountTopBar(root, office, { document: fakeDoc, fetchImpl: impl });
    expect(topbarControl(root, "auto").textContent).toBe("AUTO ON");
    topbarControl(root, "auto").dispatchEvent({ type: "click" });
    await flush();
    expect(calls[0]!.url).toBe("/api/iq/config/auto-execute");
    expect(calls[0]!.body).toEqual({ enabled: false });
  });

  it("aplicar stake global chama POST /api/iq/config/global-stake só com {value}", async () => {
    const { calls, impl } = mockFetch();
    const root = fakeDoc.createElement("div");
    topbar.mountTopBar(root, officeFixture(), { document: fakeDoc, fetchImpl: impl });
    const input = topbarControl(root, "stake-input");
    input.value = "25";
    topbarControl(root, "stake-apply").dispatchEvent({ type: "click" });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/iq/config/global-stake");
    expect(calls[0]!.body).toEqual({ value: 25 });
    expect(Object.keys(calls[0]!.body)).toEqual(["value"]);
  });

  it("REAL permanece desabilitado e o módulo nunca referencia modo REAL", () => {
    const root = fakeDoc.createElement("div");
    topbar.mountTopBar(root, officeFixture(), { document: fakeDoc });
    const real = topbarControl(root, "real");
    expect(real.disabled).toBe(true);
    expect(real.getAttribute("aria-disabled")).toBe("true");
    expect(real.textContent).toBe("REAL OFF");
    const source = readFileSync(new URL("../../src/http/public/office-v3/topbar.js", import.meta.url), "utf8");
    expect(source.includes("/api/iq/mode")).toBe(false);
    expect(source.includes("/api/iq/real")).toBe(false);
  });

  it("falha de rede não quebra o top bar (fail-soft)", async () => {
    const failing = async () => ({ ok: false, status: 502, json: async () => null });
    const root = fakeDoc.createElement("div");
    topbar.mountTopBar(root, officeFixture(), { document: fakeDoc, fetchImpl: failing });
    topbarControl(root, "arm").dispatchEvent({ type: "click" });
    await flush();
    expect(topbarControl(root, "status").textContent).toContain("falha");
    expect(topbarControl(root, "arm").disabled).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * TASK 6 — stake por mercado (marketKey único)
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — stake por mercado (TASK 6)", () => {
  it("applyMarketStake envia PUT /api/iq/market apenas com o marketKey selecionado", async () => {
    const { calls, impl } = mockFetch();
    const result = await stakeConfig.applyMarketStake("GBPJPY:OTC", 20, { fetchImpl: impl, hardCap: 100, maxStake: 100 });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/iq/market");
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.body).toEqual({ marketKey: "GBPJPY:OTC", configuredStake: 20 });
    expect(Object.keys(calls[0]!.body)).toEqual(["marketKey", "configuredStake"]);
  });

  it("stake inválido (0, negativo, acima do teto) não dispara fetch", async () => {
    const { calls, impl } = mockFetch();
    expect((await stakeConfig.applyMarketStake("EURUSD:NORMAL", 0, { fetchImpl: impl })).ok).toBe(false);
    expect((await stakeConfig.applyMarketStake("EURUSD:NORMAL", -5, { fetchImpl: impl })).ok).toBe(false);
    expect((await stakeConfig.applyMarketStake("EURUSD:NORMAL", 500, { fetchImpl: impl, hardCap: 100 })).ok).toBe(false);
    expect((await stakeConfig.applyMarketStake("", 10, { fetchImpl: impl })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("bloco de stake fica vinculado ao marketKey e salva o valor digitado", async () => {
    const { calls, impl } = mockFetch();
    const root = fakeDoc.createElement("div");
    const mounted = stakeConfig.mountStakeConfig(root, marketB(), officeFixture(), { document: fakeDoc, fetchImpl: impl });
    expect(mounted.section.getAttribute("data-market-key")).toBe("GBPUSD:NORMAL");
    mounted.input.value = "20";
    mounted.applyButton.dispatchEvent({ type: "click" });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ marketKey: "GBPUSD:NORMAL", configuredStake: 20 });
    expect(mounted.status.textContent).toContain("R$ 20,00");
  });

  it("refresh/resize mantém a config persistida do servidor", async () => {
    const { impl } = mockFetch();
    const root = fakeDoc.createElement("div");
    stakeConfig.mountStakeConfig(root, fullMarket({ configuredStake: 10 }), officeFixture(), { document: fakeDoc, fetchImpl: impl });
    const refreshedMarket = fullMarket({ configuredStake: 25 });
    stakeConfig.mountStakeConfig(root, refreshedMarket, officeFixture(), { document: fakeDoc, fetchImpl: impl });
    const inputs = findAll(root, (node) => node.dataset?.stake === "input");
    expect(inputs.length).toBe(2);
    expect(inputs[1]!.value).toBe("25");
    const models = stakeConfig.buildStakeConfigModel(refreshedMarket, officeFixture());
    expect(models.configuredStake).toBe(25);
    expect(models.effectiveStake).toBe(25);
    expect(models.source).toBe("MERCADO");
  });
});

/* ------------------------------------------------------------------ *
 * TASK 6 — correlação do painel direito
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — painel correlacionado ao marketKey (TASK 6)", () => {
  it("selecionar A e depois B nunca mistura os dados de A", () => {
    const root = fakeDoc.createElement("div");
    detail.mountMarketDetail(root, officeFixture(), "EURUSD:NORMAL", { document: fakeDoc });
    detail.mountMarketDetail(root, officeFixture(), "GBPUSD:NORMAL", { document: fakeDoc });
    const panels = findAll(root, (node) => node.classList?.contains("tc-v3-detail"));
    expect(panels).toHaveLength(1);
    expect(panels[0]!.dataset.marketKey).toBe("GBPUSD:NORMAL");
    expect(root.textContent).toContain("GBP/USD");
    expect(root.textContent).not.toContain("EURUSD:NORMAL");
    expect(root.textContent).not.toContain("EUR/USD ·");
  });

  it("o painel contém o stake do marketKey selecionado e fecha devolvendo espaço", () => {
    const root = fakeDoc.createElement("div");
    detail.mountMarketDetail(root, officeFixture(), "GBPJPY:OTC", { document: fakeDoc });
    const stakeBlocks = findAll(root, (node) => node.classList?.contains("tc-stake-config"));
    expect(stakeBlocks).toHaveLength(1);
    expect(stakeBlocks[0]!.getAttribute("data-market-key")).toBe("GBPJPY:OTC");
    expect(detail.closeMarketDetail()).toBe(true);
    expect(findAll(root, (node) => node.classList?.contains("tc-v3-detail"))).toHaveLength(0);
  });

  it("marketKey ausente no snapshot fecha o painel (sem dados órfãos)", () => {
    const root = fakeDoc.createElement("div");
    detail.mountMarketDetail(root, officeFixture(), "EURUSD:NORMAL", { document: fakeDoc });
    const result = detail.mountMarketDetail(root, { markets: [marketB()] }, "EURUSD:NORMAL", { document: fakeDoc });
    expect(result.state).toBe("error");
    expect(root.textContent).toContain("Mercado não encontrado");
  });

  it("refresh do snapshot preserva a aba ativa do painel correlacionado", () => {
    const root = fakeDoc.createElement("div");
    detail.mountMarketDetail(root, officeFixture(), "EURUSD:NORMAL", { document: fakeDoc, initialTab: "technical" });
    const technicalBody = findAll(root, (node) => node.classList?.contains("tc-v3-detail-section") && node.dataset?.tab === "technical")[0];
    const identityBody = findAll(root, (node) => node.classList?.contains("tc-v3-detail-section") && node.dataset?.tab === "identity")[0];
    expect(technicalBody.hidden).toBe(false);
    expect(identityBody.hidden).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * TASK 3 — câmera: zoom no cursor, round-trip e hitbox
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — câmera (TASK 3)", () => {
  it("wheel dá zoom suave centrado exatamente no cursor", () => {
    const cam = camera.createCamera({ width: 800, height: 600 });
    const point = { x: 321, y: 219 };
    const before = camera.screenToWorld(cam, point.x, point.y);
    const zoomBefore = cam.zoom;
    camera.handleWheel(cam, { deltaY: -120, offsetX: point.x, offsetY: point.y });
    const after = camera.screenToWorld(cam, point.x, point.y);
    expect(cam.zoom).toBeGreaterThan(zoomBefore);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    camera.handleWheel(cam, { deltaY: 120, offsetX: point.x, offsetY: point.y });
    const back = camera.screenToWorld(cam, point.x, point.y);
    expect(back.x).toBeCloseTo(before.x, 6);
    expect(back.y).toBeCloseTo(before.y, 6);
  });

  it("screenToWorld/worldToScreen fazem round-trip com zoom + pan", () => {
    const cam = camera.createCamera({ width: 800, height: 600 });
    camera.handleWheel(cam, { deltaY: -100, offsetX: 200, offsetY: 150 });
    camera.handleDragStart(cam, { clientX: 100, clientY: 100 });
    camera.handleDragMove(cam, { clientX: 143, clientY: 78 });
    camera.handleDragEnd(cam, {});
    for (const point of [{ x: 321, y: 654 }, { x: 0, y: 0 }, { x: 2000, y: 1500 }]) {
      const screen = camera.worldToScreen(cam, point.x, point.y);
      const back = camera.screenToWorld(cam, screen.x, screen.y);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it("hitbox das mesas continua sincronizada após zoom no cursor + pan", () => {
    const markets = Array.from({ length: 20 }, (_, index) => ({
      marketKey: `MK${index}:NORMAL`,
      canonical: `MK${index}`,
      symbol: `MK${index}`,
      display: `MK${index}`,
      availability: "OPEN",
      enabled: true,
    }));
    const worldState = world.buildWorldState({ mode: "PRACTICE", markets });
    const cam = camera.createCamera({ width: 900, height: 640, worldState, hitTestStation: world.hitTestStation });
    camera.handleWheel(cam, { deltaY: -140, offsetX: 410, offsetY: 260 });
    camera.handleDragStart(cam, { clientX: 300, clientY: 300 });
    camera.handleDragMove(cam, { clientX: 260, clientY: 280 });
    camera.handleDragEnd(cam, {});
    const station = worldState.stations[7];
    const centerWorld = { x: station.desk.x + station.desk.w / 2, y: station.desk.y + station.desk.h / 2 };
    const screen = camera.worldToScreen(cam, centerWorld.x, centerWorld.y);
    const back = camera.screenToWorld(cam, screen.x, screen.y);
    const hit = world.hitTestStation(worldState, back.x, back.y);
    expect(hit).toBeTruthy();
    expect(hit.marketKey).toBe(station.marketKey);
  });
});

/* ------------------------------------------------------------------ *
 * TASK 4/5 — pan (SPACE + arraste) e zoom no cursor (matemática)
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — pan/zoom: matemática e captura de ponteiro (TASK 4/5)", () => {
  function freeCamera() {
    return camera.createCamera({
      width: 900,
      height: 640,
      bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 },
    });
  }

  it("zoomAt mantém o ponto do mundo fixo sob o cursor em vários níveis", () => {
    const cam = freeCamera();
    cam.x = 500;
    cam.y = 400;
    for (const [sx, sy] of [[120, 90], [450, 320], [880, 600]]) {
      for (const factor of [1.35, 1.6, 0.7]) {
        const before = camera.screenToWorld(cam, sx, sy);
        camera.zoomAt(cam, sx, sy, cam.zoom * factor);
        const after = camera.screenToWorld(cam, sx, sy);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
      }
    }
  });

  it("wheel dá preventDefault no canvas e mantém o mundo sob o cursor", () => {
    const cam = freeCamera();
    const preventDefault = vi.fn();
    const point = { x: 321, y: 219 };
    const before = camera.screenToWorld(cam, point.x, point.y);
    camera.handleWheel(cam, { deltaY: -120, offsetX: point.x, offsetY: point.y, preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    const after = camera.screenToWorld(cam, point.x, point.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(cam.zoom).toBeGreaterThan(1);
  });

  it("clamp no zoom 1 alcança as quatro bordas do mundo", () => {
    const cam = camera.createCamera({ width: 800, height: 600, worldState: { worldWidth: 2560, worldHeight: 2048 } });
    cam.zoom = 1;
    cam.x = -9999;
    cam.y = -9999;
    camera.clampToBounds(cam);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(camera.worldToScreen(cam, 0, 0)).toEqual({ x: 0, y: 0 });
    cam.x = 9999;
    cam.y = 9999;
    camera.clampToBounds(cam);
    expect(cam.x).toBe(2560 - 800);
    expect(cam.y).toBe(2048 - 600);
    expect(camera.worldToScreen(cam, 2560, 2048)).toEqual({ x: 800, y: 600 });
  });

  it("no zoom máximo ainda alcança as quatro bordas", () => {
    const cam = camera.createCamera({ width: 800, height: 600, worldState: { worldWidth: 2560, worldHeight: 2048 } });
    cam.zoom = cam.maxZoom;
    cam.x = -9999;
    cam.y = -9999;
    camera.clampToBounds(cam);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    cam.x = 9999;
    cam.y = 9999;
    camera.clampToBounds(cam);
    expect(cam.x).toBeCloseTo(2560 - 800 / cam.maxZoom, 6);
    expect(cam.y).toBeCloseTo(2048 - 600 / cam.maxZoom, 6);
    expect(camera.worldToScreen(cam, 2560, 2048).x).toBeCloseTo(800, 6);
    expect(camera.worldToScreen(cam, 2560, 2048).y).toBeCloseTo(600, 6);
  });

  it("no zoom mínimo o mundo inteiro (incl. áreas expandidas) fica visível", () => {
    const cam = camera.createCamera({ width: 1536, height: 1024, worldState: { worldWidth: 2560, worldHeight: 2048 } });
    cam.zoom = cam.minZoom;
    cam.x = -99999;
    cam.y = -99999;
    camera.clampToBounds(cam);
    const topLeft = camera.worldToScreen(cam, 0, 0);
    const bottomRight = camera.worldToScreen(cam, 2560, 2048);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(1536);
    expect(bottomRight.y).toBeLessThanOrEqual(1024);
    const range = camera.getClampRange(cam);
    expect(range.centeredX).toBe(true);
    expect(range.centeredY).toBe(true);
  });

  it("clamp recalcula a partir de bounds vivos, nunca de dimensões antigas", () => {
    const cam = camera.createCamera({ width: 800, height: 600, bounds: { minX: 0, minY: 0, maxX: 200, maxY: 150 } });
    cam.zoom = 1;
    cam.x = 9999;
    cam.y = 9999;
    camera.clampToBounds(cam);
    expect(cam.x).toBe((200 - 800) / 2);
    expect(cam.y).toBe((150 - 600) / 2);
    camera.refreshWorldBounds(cam, { worldWidth: 2560, worldHeight: 2048 });
    cam.x = 9999;
    cam.y = 9999;
    camera.clampToBounds(cam);
    expect(cam.x).toBe(2560 - 800);
    expect(cam.y).toBe(2048 - 600);
  });

  it("panBy desloca o mundo exatamente pelo delta em pixels de tela", () => {
    const cam = freeCamera();
    cam.zoom = 1.25;
    cam.x = 1000;
    cam.y = 800;
    const before = camera.worldToScreen(cam, 1234, 567);
    camera.panBy(cam, 40, -25);
    const after = camera.worldToScreen(cam, 1234, 567);
    expect(after.x - before.x).toBeCloseTo(40, 6);
    expect(after.y - before.y).toBeCloseTo(-25, 6);
  });

  it("round-trip screenToWorld/worldToScreen após zoom no cursor + pan", () => {
    const cam = freeCamera();
    camera.zoomAt(cam, 310, 220, 2.2);
    camera.panBy(cam, -73, 41);
    for (const point of [{ x: 321, y: 654 }, { x: 0, y: 0 }, { x: 2000, y: 1500 }, { x: 2559, y: 2047 }]) {
      const screen = camera.worldToScreen(cam, point.x, point.y);
      const back = camera.screenToWorld(cam, screen.x, screen.y);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it("SPACE + arraste atualiza a câmera e suprime o clique na mesa", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = new FakeElement("body");
    const target = new FakeElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });

    target.dispatchEvent({ type: "keydown", key: " ", code: "Space" });
    expect(canvasEl.classList.contains("pan-ready")).toBe(true);
    canvasEl.dispatchEvent({ type: "pointerdown", button: 0, pointerId: 3, clientX: 100, clientY: 100 });
    expect(canvasEl.classList.contains("dragging")).toBe(true);
    expect(bodyEl.classList.contains("tc-v3-panning")).toBe(true);
    const x0 = cam.x;
    target.dispatchEvent({ type: "pointermove", pointerId: 3, clientX: 170, clientY: 80 });
    expect(cam.x).not.toBe(x0);
    expect(pan.wasMoved()).toBe(true);
    target.dispatchEvent({ type: "pointerup", pointerId: 3 });
    expect(cam.dragging).toBe(false);
    expect(pan.consumeClickSuppression()).toBe(true);
    expect(pan.consumeClickSuppression()).toBe(false);
  });

  it("setPointerCapture/releasePointerCapture usam o pointerId do gesto", () => {
    const canvasEl = fakeDoc.createElement("canvas") as any;
    canvasEl.setPointerCapture = vi.fn();
    canvasEl.releasePointerCapture = vi.fn();
    const bodyEl = new FakeElement("body");
    const target = new FakeElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });

    target.dispatchEvent({ type: "keydown", key: " ", code: "Space" });
    canvasEl.dispatchEvent({ type: "pointerdown", button: 0, pointerId: 7, clientX: 10, clientY: 10 });
    expect(canvasEl.setPointerCapture).toHaveBeenCalledWith(7);
    target.dispatchEvent({ type: "pointermove", pointerId: 7, clientX: 90, clientY: 50 });
    expect(cam.x).not.toBe(0);
    target.dispatchEvent({ type: "pointerup", pointerId: 7 });
    expect(canvasEl.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(pan.isPanning()).toBe(false);
  });

  it("Space é liberado no blur da janela (nunca fica preso)", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = new FakeElement("body");
    const target = new FakeElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });

    target.dispatchEvent({ type: "keydown", key: " ", code: "Space" });
    expect(pan.isSpaceDown()).toBe(true);
    target.dispatchEvent({ type: "blur" });
    expect(pan.isSpaceDown()).toBe(false);
    expect(canvasEl.classList.contains("pan-ready")).toBe(false);
    expect(bodyEl.classList.contains("tc-v3-select-off")).toBe(false);
  });

  it("pointercancel solta o Space e encerra o pan em andamento", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = new FakeElement("body");
    const target = new FakeElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });

    target.dispatchEvent({ type: "keydown", key: " ", code: "Space" });
    canvasEl.dispatchEvent({ type: "pointerdown", button: 0, pointerId: 9, clientX: 50, clientY: 50 });
    target.dispatchEvent({ type: "pointermove", pointerId: 9, clientX: 140, clientY: 90 });
    expect(pan.isPanning()).toBe(true);
    target.dispatchEvent({ type: "pointercancel", pointerId: 9 });
    expect(pan.isSpaceDown()).toBe(false);
    expect(pan.isPanning()).toBe(false);
    expect(cam.dragging).toBe(false);
    expect(canvasEl.classList.contains("dragging")).toBe(false);
    expect(bodyEl.classList.contains("tc-v3-panning")).toBe(false);
  });

  it("sem SPACE o pointerdown não inicia pan e a câmera não se move", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = new FakeElement("body");
    const target = new FakeElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });
    canvasEl.dispatchEvent({ type: "pointerdown", button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    target.dispatchEvent({ type: "pointermove", pointerId: 1, clientX: 200, clientY: 200 });
    expect(pan.isPanning()).toBe(false);
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
  });

  it("o clique na mesa é ignorado durante/depois do pan (página consome a supressão)", () => {
    const source = readFileSync(new URL("../../src/http/public/office-v3/office-v3.js", import.meta.url), "utf8");
    expect(source).toContain("consumeClickSuppression");
    expect(source).toContain("wasMoved()");
    expect(source).toContain("setPointerCapture");
    expect(source).toContain("pointercancel");
  });

  it("eventos de mouse continuam suportados como fallback do gesto", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = new FakeElement("body");
    const target = new FakeElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });
    target.dispatchEvent({ type: "keydown", key: " ", code: "Space" });
    canvasEl.dispatchEvent({ type: "mousedown", button: 0, clientX: 20, clientY: 20 });
    target.dispatchEvent({ type: "mousemove", clientX: 90, clientY: 45 });
    expect(pan.isPanning()).toBe(true);
    expect(cam.x).not.toBe(0);
    target.dispatchEvent({ type: "mouseup" });
    expect(pan.isPanning()).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * TASK 4 — MESAS popup (busca + teclado)
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — MESAS popup (TASK 4)", () => {
  function makeMesas() {
    const toggle = fakeDoc.createElement("button");
    const panel = fakeDoc.createElement("div");
    panel.hidden = true;
    const search = fakeDoc.createElement("input");
    search.tagName = "INPUT";
    const list = fakeDoc.createElement("div");
    const selected: string[] = [];
    const controller = page.createMesasController({
      document: fakeDoc,
      toggle,
      panel,
      search,
      list,
      onSelect: (key: string) => selected.push(key),
    });
    controller.setStations([fullMarket(), marketB(), marketC()]);
    return { toggle, panel, search, list, selected, controller };
  }

  it("fechado ocupa o mínimo: painel oculto, aria-expanded=false e só o botão MESAS", () => {
    const { toggle, panel } = makeMesas();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.dispatchEvent({ type: "click" });
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("busca filtra os mercados por símbolo/canonical/marketKey", () => {
    const { search, controller } = makeMesas();
    search.value = "gbp";
    search.dispatchEvent({ type: "input" });
    const keys = controller.getVisibleKeys();
    expect(keys).toEqual(["GBPUSD:NORMAL", "GBPJPY:OTC"]);
    search.value = "jpy";
    search.dispatchEvent({ type: "input" });
    expect(controller.getVisibleKeys()).toEqual(["GBPJPY:OTC"]);
  });

  it("↑↓ + Enter continuam selecionando a mesa correta", () => {
    const { list, search, controller, selected } = makeMesas();
    list.dispatchEvent({ type: "keydown", key: "ArrowDown" });
    expect(controller.getActiveIndex()).toBe(1);
    list.dispatchEvent({ type: "keydown", key: "ArrowDown" });
    expect(controller.getActiveIndex()).toBe(2);
    list.dispatchEvent({ type: "keydown", key: "ArrowUp" });
    expect(controller.getActiveIndex()).toBe(1);
    search.value = "gbp";
    search.dispatchEvent({ type: "input" });
    search.dispatchEvent({ type: "keydown", key: "ArrowDown" });
    search.dispatchEvent({ type: "keydown", key: "Enter" });
    expect(selected).toEqual(["GBPJPY:OTC"]);
  });

  it("selecionar fecha o popup e emite o marketKey real", () => {
    const { toggle, panel, list, selected } = makeMesas();
    toggle.dispatchEvent({ type: "click" });
    expect(panel.hidden).toBe(false);
    list.dispatchEvent({ type: "keydown", key: "Enter" });
    expect(selected).toEqual(["EURUSD:NORMAL"]);
    expect(panel.hidden).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * TASK 3/regressão — SPACE + drag sem seleção de texto
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — SPACE + drag (regressão de seleção)", () => {
  it("ativa classes de cursor/pan e nenhuma seleção de texto durante o arrasto", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = fakeDoc.createElement("body");
    const target = fakeDoc.createElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({
      canvas: canvasEl,
      body: bodyEl,
      target,
      getCamera: () => cam,
      getCameraModule: () => camera,
    });

    target.dispatchEvent({ type: "keydown", key: " ", code: "Space" });
    expect(canvasEl.classList.contains("pan-ready")).toBe(true);
    expect(bodyEl.classList.contains("tc-v3-select-off")).toBe(true);

    canvasEl.dispatchEvent({ type: "mousedown", button: 0, clientX: 100, clientY: 100 });
    expect(canvasEl.classList.contains("dragging")).toBe(true);
    expect(bodyEl.classList.contains("tc-v3-panning")).toBe(true);
    expect(cam.dragging).toBe(true);

    const x0 = cam.x;
    target.dispatchEvent({ type: "mousemove", clientX: 160, clientY: 90 });
    expect(cam.x).not.toBe(x0);
    expect(pan.wasMoved()).toBe(true);

    target.dispatchEvent({ type: "mouseup" });
    expect(canvasEl.classList.contains("dragging")).toBe(false);
    expect(bodyEl.classList.contains("tc-v3-panning")).toBe(false);
    expect(cam.dragging).toBe(false);

    target.dispatchEvent({ type: "keyup", key: " ", code: "Space" });
    expect(canvasEl.classList.contains("pan-ready")).toBe(false);
    expect(bodyEl.classList.contains("tc-v3-select-off")).toBe(false);
  });

  it("sem SPACE o mousedown não inicia pan (clique normal preservado)", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = fakeDoc.createElement("body");
    const target = fakeDoc.createElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });
    canvasEl.dispatchEvent({ type: "mousedown", button: 0, clientX: 50, clientY: 50 });
    expect(canvasEl.classList.contains("dragging")).toBe(false);
    expect(cam.dragging).toBe(false);
  });

  it("CSS desabilita a seleção de texto e define cursores grab/grabbing", () => {
    const css = readFileSync(new URL("../../src/http/public/office-v3/styles-v3.css", import.meta.url), "utf8");
    expect(css).toContain("user-select: none");
    expect(css).toContain("tc-v3-select-off");
    expect(css).toContain("tc-v3-panning");
    expect(css).toContain("#office-canvas.pan-ready");
    expect(css).toContain("#office-canvas.dragging");
    expect(css).toContain("cursor: grabbing");
  });
});

/* ------------------------------------------------------------------ *
 * HOTFIX — regressões encontradas no browser real (Task 6/7)
 * ------------------------------------------------------------------ */

describe("OFFICE V3 UI — regressões do browser real (HOTFIX)", () => {
  it("cursor inline do hover não bloqueia o cursor grab/grabbing do Space", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = new FakeElement("body");
    const target = new FakeElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });
    canvasEl.style.cursor = "pointer";
    target.dispatchEvent({ type: "keydown", key: " ", code: "Space" });
    expect(canvasEl.style.cursor).toBe("");
    expect(canvasEl.classList.contains("pan-ready")).toBe(true);
    target.dispatchEvent({ type: "keyup", key: " ", code: "Space" });
    expect(canvasEl.style.cursor).toBe("");
    expect(pan.isSpaceDown()).toBe(false);
  });

  it("wasMoved não fica preso depois do pan (clique normal volta a valer)", () => {
    const canvasEl = fakeDoc.createElement("canvas");
    const bodyEl = new FakeElement("body");
    const target = new FakeElement("div");
    const cam = camera.createCamera({ width: 800, height: 600 });
    const pan = page.bindPanNavigation({ canvas: canvasEl, body: bodyEl, target, getCamera: () => cam, getCameraModule: () => camera });
    target.dispatchEvent({ type: "keydown", key: " ", code: "Space" });
    canvasEl.dispatchEvent({ type: "pointerdown", button: 0, pointerId: 4, clientX: 20, clientY: 20 });
    target.dispatchEvent({ type: "pointermove", pointerId: 4, clientX: 120, clientY: 60 });
    expect(pan.wasMoved()).toBe(true);
    target.dispatchEvent({ type: "pointerup", pointerId: 4 });
    expect(pan.wasMoved()).toBe(false);
    expect(pan.consumeClickSuppression()).toBe(true);
    expect(pan.consumeClickSuppression()).toBe(false);
  });

  it("FECHAR do painel notifica o shell (onClose) e não reabre no próximo poll", () => {
    const root = fakeDoc.createElement("div");
    const closed: string[] = [];
    detail.mountMarketDetail(root, officeFixture(), "EURUSD:NORMAL", { document: fakeDoc, onClose: (key: string) => closed.push(String(key)) });
    const closeButton = findAll(root, (node) => node.classList?.contains("tc-v3-detail-close"))[0];
    expect(closeButton).toBeTruthy();
    closeButton.dispatchEvent({ type: "click" });
    expect(closed).toEqual(["EURUSD:NORMAL"]);
    expect(findAll(root, (node) => node.classList?.contains("tc-v3-detail"))).toHaveLength(0);
    expect(detail.closeMarketDetail()).toBe(false);
    expect(closed).toEqual(["EURUSD:NORMAL"]);
  });

  it("refresh do poll (re-mount do MESMO mercado) não dispara onClose nem perde a seleção", () => {
    const root = fakeDoc.createElement("div");
    const closed: string[] = [];
    detail.mountMarketDetail(root, officeFixture(), "EURUSD:NORMAL", { document: fakeDoc, onClose: (key: string) => closed.push(String(key)) });
    detail.mountMarketDetail(root, officeFixture(), "EURUSD:NORMAL", { document: fakeDoc, onClose: (key: string) => closed.push(String(key)) });
    expect(closed).toEqual([]);
    expect(findAll(root, (node) => node.classList?.contains("tc-v3-detail"))).toHaveLength(1);
    const closeButton = findAll(root, (node) => node.classList?.contains("tc-v3-detail-close"))[0];
    closeButton.dispatchEvent({ type: "click" });
    expect(closed).toEqual(["EURUSD:NORMAL"]);
  });
});

/* ------------------------------------------------------------------ *
 * reservado: assets não utilizados diretamente são carregados para
 * garantir que o bundle V3 completo segue importável em Node.
 * ------------------------------------------------------------------ */

it("todos os módulos V3 carregam sem DOM real", () => {
  expect(typeof assets.drawCharacter).toBe("function");
  expect(typeof world.buildWorldState).toBe("function");
  expect(typeof topbar.buildTopBarModel).toBe("function");
  expect(typeof stakeConfig.buildStakeConfigModel).toBe("function");
});
