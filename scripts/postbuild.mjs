/* Copia os assets estáticos da web app para dist/http/public após o build. */
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src", "http", "public");
const dst = join(here, "..", "dist", "http", "public");

if (!existsSync(src)) {
  console.log("[postbuild] sem assets em src/http/public — pulando");
  process.exit(0);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log("[postbuild] assets copiados para dist/http/public");
