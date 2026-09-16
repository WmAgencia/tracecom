/** Contrato UI -> API do Escritório (Fase 4.2): todo controle principal tem handler e endpoint real.
 * Garante que nenhum botao e decorativo e que a UI usa os endpoints existentes no proxy/relay. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexHtml = readFileSync(new URL("../../src/http/public/index.html", import.meta.url), "utf8");
const officeJs = readFileSync(new URL("../../src/http/public/office.js", import.meta.url), "utf8");
const fixtureHtml = readFileSync(new URL("../../src/http/public/office-fixture.html", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../../api/http.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../../relay/server.mjs", import.meta.url), "utf8");

const CONTROL_IDS = [
  "officeAccountPractice", "officeAccountReal", "officeSystemStart", "officeSystemStop", "officeEmergency",
  "officeLimitInput", "officeApplyLimit", "officeChooseMarkets", "officeAdvanced", "officeActivityTech",
  "officeZoomIn", "officeZoomOut", "officeCameraReset", "officeFocus", "officeCanvas", "officeOverlay", "officeAux", "officeActivity",
];

describe("Escritório — contrato de controles (nenhum botão decorativo)", () => {
  it("todos os controles principais existem no HTML e são tratados no office.js", () => {
    for (const id of CONTROL_IDS) {
      expect(indexHtml, `controle ausente no HTML: ${id}`).toContain(`id="${id}"`);
    }
    const handlerSelector = officeJs.slice(officeJs.indexOf("const target = event.target.closest("), officeJs.indexOf(");", officeJs.indexOf("const target = event.target.closest(")));
    for (const id of CONTROL_IDS.filter((value) => !["officeLimitInput", "officeCanvas", "officeOverlay", "officeAux", "officeActivity"].includes(value))) {
      expect(handlerSelector, `controle sem handler: ${id}`).toContain(`#${id}`);
    }
    for (const hook of ["data-market-toggle", "data-market-pause", "data-market-stake", "data-market-strategy-save", "data-choose-toggle", "data-toggle-details", "data-aux", "data-close"]) {
      expect(handlerSelector, `hook sem handler: ${hook}`).toContain(hook);
    }
    expect(officeJs).toContain("data-market-stake-input");
    expect(officeJs).toContain("data-market-strategy");
  });
  it("UI chama apenas endpoints reais (presentes no proxy Vercel e no relay)", () => {
    const endpoints = ["/api/iq/office", "/api/iq/events", "/api/iq/mode", "/api/iq/kill-switch", "/api/iq/config/global-stake", "/api/iq/config/auto-execute", "/api/iq/arm", "/api/iq/disarm", "/api/iq/market", "/api/iq/real/confirm", "/api/iq/real/revoke", "/api/iq/stress/run"];
    for (const endpoint of endpoints) {
      expect(officeJs, `UI nao usa ${endpoint}`).toContain(endpoint);
      expect(proxy, `proxy sem ${endpoint}`).toContain(endpoint);
      expect(server, `relay sem ${endpoint}`).toContain(endpoint);
    }
  });
  it("anti-race de configuracao presente (revisoes) e variantes congeladas limitadas", () => {
    expect(officeJs).toContain("mergePinned");
    expect(officeJs).toContain("state.pinned");
    expect(officeJs).toContain("revision");
    for (const variant of ["V3-45", "V3-60", "V3-120", "V3-180", "V3-300", "V8-45", "V8-60", "V2-60", "V2-120", "V1-300"]) expect(officeJs).toContain(variant);
    expect(officeJs).not.toContain("\"V9-");
    expect(officeJs).not.toContain("V5-");
  });
  it("fixture visual cobre 15 estacoes, estados de sono/desativado e ajuste de valor", () => {
    const keys = ["EURUSD:OTC", "GBPUSD:OTC", "USDJPY:OTC", "EURGBP:OTC", "GBPJPY:OTC", "EURUSD:NORMAL", "USDJPY:NORMAL", "GBPUSD:NORMAL", "EURJPY:NORMAL", "USDCHF:NORMAL", "AUDUSD:NORMAL", "USDCAD:NORMAL", "AUDJPY:NORMAL", "EURGBP:NORMAL", "GBPJPY:NORMAL"];
    for (const key of keys) expect(fixtureHtml, `fixture sem ${key}`).toContain(key);
    for (const marker of ["NOT_FOUND", "UNAVAILABLE", "paused", "SIGNAL", "ORDERING", "IN_POSITION", "FAVORABLE", "UNFAVORABLE", "WIN", "LOSS"]) expect(fixtureHtml).toContain(marker);
    expect(fixtureHtml).toContain("stakeAdjustment");
    expect(officeJs).toContain("MERCADO FECHADO");
    expect(officeJs).toContain("DESATIVADO");
    expect(officeJs).toContain("drawZzz");
    expect(officeJs).toContain("MERCADO NORMAL");
    expect(officeJs).toContain("MERCADO OTC");
  });
  it("a UI nunca mostra configuracao diferente do runtime: salva e sincroniza com o backend", () => {
    expect(officeJs).toContain("configuredStake");
    expect(officeJs).toContain("strategyVariantId");
    expect(officeJs).toContain("Estratégia salva");
    expect(officeJs).toContain("Não foi possível salvar");
    expect(officeJs).toContain("valem para a próxima operação");
    expect(indexHtml).toContain("VALOR POR OPERAÇÃO");
  });
});
