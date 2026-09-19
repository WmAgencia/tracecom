/** Contrato de roteamento da raiz: `/` serve o Office V3 e o dashboard legado fica a um URL estável.
 *  Frontend apenas — nenhuma lógica de trading, stake ou ordem é tocada por este contrato. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const rootHtml = readFileSync(new URL("../../src/http/public/index.html", import.meta.url), "utf8");
const classicHtml = readFileSync(new URL("../../src/http/public/classic.html", import.meta.url), "utf8");
const v3Html = readFileSync(new URL("../../src/http/public/office-v3/office-v3.html", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  rewrites: Array<{ source: string; destination: string }>;
};

describe("root shell — Office V3 em / com rollback estável", () => {
  it("a raiz monta o shell V3 com assets absolutos e base /office-v3/", () => {
    expect(rootHtml).toContain("office-canvas");
    expect(rootHtml).toContain("/office-v3/office-v3.js");
    expect(rootHtml).toContain("/office-v3/styles-v3.css");
    expect(rootHtml).toContain('<base href="/office-v3/"');
    expect(rootHtml).not.toContain("page-operational");
  });
  it("o dashboard legado permanece em /classic.html e a página V3 direta continua intacta", () => {
    expect(classicHtml).toContain("page-operational");
    expect(classicHtml).toContain("/app.js");
    expect(v3Html).toContain("./office-v3.js");
    expect(v3Html).toContain("./styles-v3.css");
  });
  it("a raiz e a página direta montam top bar + resultados legiveis + MESAS/LOGS e não duplicam o dashboard legado", () => {
    for (const html of [rootHtml, v3Html]) {
      expect(html).toContain('id="office-topbar"');
      expect(html).toContain('id="mesas-toggle"');
      expect(html).toContain('id="logs-toggle"');
      expect(html).toContain('id="logs-panel"');
      expect(html).toContain('id="office-results"');
      expect(html).not.toContain("office-dashboard");
      expect(html).not.toContain("tc-v3-dashboard");
    }
  });
  it("rota secundária do legado declarada no vercel.json", () => {
    for (const source of ["/dashboard", "/classic"]) {
      const rewrite = vercel.rewrites.find((entry) => entry.source === source);
      expect(rewrite?.destination).toBe("/classic.html");
    }
  });
});
