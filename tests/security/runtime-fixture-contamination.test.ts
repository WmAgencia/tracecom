import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RUNTIME_ROOTS = ["api", "src", "relay"];

function runtimeFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) { if (entry === "node_modules" || entry === "fixtures") continue; files.push(...runtimeFiles(path)); }
    else if (/\.(ts|js|mjs|json|html)$/.test(entry)) files.push(path);
  }
  return files;
}

describe("runtime fixture contamination guard", () => {
  it("keeps the reported fixture value 1.38571 out of every runtime path", () => {
    const offenders = RUNTIME_ROOTS.flatMap(runtimeFiles).filter((file) => readFileSync(file, "utf8").includes("1.38571"));
    expect(offenders).toEqual([]);
  });

  it("keeps the real price-label fixture value confined to tests/fixtures", () => {
    const offenders = RUNTIME_ROOTS.flatMap(runtimeFiles).filter((file) => readFileSync(file, "utf8").includes("1.387408"));
    expect(offenders).toEqual([]);
  });

  it("never licenses fixture-derived literals as entry/settlement defaults", () => {
    const source = readFileSync("src/http/public/app.js", "utf8");
    expect(source).not.toMatch(/referencePrice\s*:\s*1\.\d+/);
    expect(source).toContain("ENTRY_PRICE_UNAVAILABLE");
    expect(source).toContain("no_causal_price_observation");
  });
});
