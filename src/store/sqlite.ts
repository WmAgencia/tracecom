/**
 * Shim que carrega o built-in experimental `node:sqlite` via `createRequire`,
 * fora do transform do runner de teste (Vite/Vitest não o reconhece como
 * built-in). A superfície exposta usa os tipos reais do módulo para que os
 * call-sites permaneçam totalmente tipados.
 */
import { createRequire } from "node:module";
import type { DatabaseSync as SqliteDatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);

const mod = require("node:sqlite") as {
  DatabaseSync: typeof SqliteDatabaseSync;
  StatementSync: typeof import("node:sqlite").StatementSync;
  constants: typeof import("node:sqlite").constants;
  backup: typeof import("node:sqlite").backup;
};

export const { DatabaseSync, StatementSync, constants, backup } = mod;
export type { SqliteDatabaseSync };
