/**
 * Shim que carrega o built-in experimental `node:sqlite` via `createRequire`.
 *
 * Acesso LAZY e tolerante: em runtimes/bundlers onde `node:sqlite` não está
 * disponível, o import deste módulo NÃO lança — apenas a abertura efetiva do
 * banco (`openDatabaseSync`) pode falhar, sinalizando corretamente a ausência
 * de cold store persistente (sem inventar dados).
 */
import { createRequire } from "node:module";
import type { DatabaseSync as SqliteDatabaseSync } from "node:sqlite";

export type { SqliteDatabaseSync };

export function openDatabaseSync(): typeof SqliteDatabaseSync {
  const require = createRequire(import.meta.url);
  const mod = require("node:sqlite") as {
    DatabaseSync: typeof SqliteDatabaseSync;
    StatementSync: typeof import("node:sqlite").StatementSync;
    constants: typeof import("node:sqlite").constants;
    backup: typeof import("node:sqlite").backup;
  };
  return mod.DatabaseSync;
}
