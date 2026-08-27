import { defineConfig } from "vitest/config";

/**
 * Configuração do Vitest.
 *
 * O built-in experimental `node:sqlite` não é reconhecido pelo runner do Vite,
 * então um alias direciona o import para um shim local (`src/store/sqlite.ts`)
 * que o carrega via `node:module/createRequire`, fora do transform do Vite.
 */
export default defineConfig({
  resolve: {
    alias: {
      "node:sqlite": new URL("./src/store/sqlite.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    pool: "forks",
  },
});
