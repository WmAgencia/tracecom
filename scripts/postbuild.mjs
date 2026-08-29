/* Copia os assets estáticos da web app para:
 *   - dist/http/public (backend Node local: `npm run serve`)
 *   - dist/ raiz (Vercel: serve como estático automático com outputDirectory=dist)
 */
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src", "http", "public");

if (!existsSync(src)) {
  console.log("[postbuild] sem assets em src/http/public — pulando");
  process.exit(0);
}

const targets = ["dist/http/public", "dist"];
for (const rel of targets) {
  const dst = join(here, "..", rel);
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`[postbuild] assets copiados para ${rel}`);
}