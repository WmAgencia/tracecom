import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateOfficeAssets } from "../scripts/office-assets/check.mjs";

const ROOT = resolve(__dirname, "..", "src", "http", "public", "assets", "office");

function readIndex(): { categories: Record<string, string[]> } {
  return JSON.parse(readFileSync(resolve(ROOT, "manifests", "office-assets.json"), "utf8"));
}

function readManifests(paths: string[]): Array<Record<string, unknown>> {
  return paths.map((path) => JSON.parse(readFileSync(resolve(ROOT, path.replace("/assets/office/", "")), "utf8")));
}

describe("office assets (pixel art)", () => {
  it("pacote gerado existe", () => {
    expect(existsSync(ROOT)).toBe(true);
    expect(existsSync(resolve(ROOT, "manifests", "office-assets.json"))).toBe(true);
  });

  it("todos os manifests, PNGs, anchors e animações são válidos", () => {
    const result = validateOfficeAssets(ROOT);
    expect(result.errors).toEqual([]);
    expect(result.count).toBeGreaterThan(30);
    expect(result.categories).toEqual(expect.arrayContaining(["agents", "furniture", "props", "floors", "walls", "decor", "ui"]));
  });

  it("agentes cobrem os papéis e estados mínimos", () => {
    const manifests = readManifests(readIndex().categories.agents ?? []);
    const roles = [...new Set(manifests.map((manifest) => manifest.role))];
    expect(roles).toEqual(expect.arrayContaining(["trader", "critic", "supervisor", "social"]));
    for (const manifest of manifests) {
      const animations = manifest.animations as Record<string, unknown>;
      for (const state of ["idle", "walk", "work", "sit", "observe"]) expect(animations[state]).toBeTruthy();
      expect(manifest.directions).toEqual(["front", "side", "back"]);
    }
  });

  it("móveis prioritários existem", () => {
    const index = readIndex();
    const ids = new Set(
      [...(index.categories.furniture ?? []), ...(index.categories.props ?? []), ...(index.categories.decor ?? [])].map((path) => path.split("/")[4]),
    );
    for (const id of ["desk_trading", "chair_office", "sofa", "coffee_table", "bookshelf", "cabinet", "whiteboard", "meeting_table", "pool_table", "counter", "sink", "fridge", "plant", "floor_lamp", "partition"]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
