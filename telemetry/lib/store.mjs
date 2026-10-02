/** Caminhos e persistência do painel (JSON atômico, sem dependências). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const PANEL_DIR = path.join(ROOT, 'telemetry');
export const LEDGER_DIR = path.join(PANEL_DIR, 'ledger');
export const LOGS_DIR = path.join(PANEL_DIR, 'logs');

export const PATHS = {
  root: ROOT,
  panel: PANEL_DIR,
  engine: path.join(ROOT, 'ws-otc-v15.mjs'),
  config: path.join(ROOT, 'bot-config-v15.json'),
  results: path.join(ROOT, 'resultados-v15.json'),
  state: path.join(ROOT, 'bot-state-v15.json'),
  wsClient: path.join(ROOT, 'iqoption-ws.mjs'),
  live: path.join(PANEL_DIR, 'live.json'),
  control: path.join(PANEL_DIR, 'control.json'),
  runtime: path.join(PANEL_DIR, 'runtime.json'),
  panelConfig: path.join(PANEL_DIR, 'config.json'),
  trades: path.join(LEDGER_DIR, 'trades.json'),
  sessions: path.join(LEDGER_DIR, 'sessions.json'),
  proofBefore: path.join(PANEL_DIR, 'PROOF-ANTES.json'),
  proofAfter: path.join(PANEL_DIR, 'PROOF-DEPOIS.json'),
  logs: LOGS_DIR,
};

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function fileStat(file) {
  try {
    const s = fs.statSync(file);
    return { exists: true, mtimeMs: s.mtimeMs, size: s.size };
  } catch { return { exists: false, mtimeMs: 0, size: 0 }; }
}
