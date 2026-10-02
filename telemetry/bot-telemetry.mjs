/**
 * TELEMETRIA DO PAINEL (ADITIVA) — o bot publica o que ele JÁ SABE.
 * =============================================================================
 * Este módulo NÃO decide nada, NÃO conhece broker, NÃO altera fluxo.
 * Ele só:
 *   1) grava um retrato do estado atual em `telemetry/live.json` (1x por segundo);
 *   2) observa `telemetry/control.json` e, se o painel pedir para parar, chama o
 *      MESMO `shutdown()` da tecla K (não existe segundo caminho de parada);
 *   3) grava um último retrato no `process.on('exit')`.
 *
 * Regras de segurança: toda operação é try/catch — uma falha de telemetria
 * (disco cheio, permissão, JSON inválido) NUNCA pode derrubar nem travar o bot.
 * Escrita atômica (tmp + rename) para o painel nunca ler arquivo pela metade.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TELEMETRY_DIR = HERE;
export const LIVE_FILE = path.join(HERE, 'live.json');
export const CONTROL_FILE = path.join(HERE, 'control.json');

const SCHEMA = 'tracecom-bot-telemetry-v1';
const PUBLISH_MS = 1_000;
const CONTROL_POLL_MS = 500;

let installed = null;

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * Instala a telemetria no processo do bot.
 * @param {{ snapshot: () => object, stop: () => void, reason?: string }} opts
 *   snapshot: função que devolve o estado atual (o bot fornece, só leitura).
 *   stop: função de parada — tem de ser o shutdown() existente (tecla K).
 * @returns {{ publish: () => object|null, dispose: () => void, stopRequested: boolean }}
 */
export function installBotTelemetry({ snapshot, stop, reason = 'PAINEL' } = {}) {
  if (installed) return installed;
  const api = {
    publish: () => publish('interval'),
    dispose: () => { clearInterval(timer); clearInterval(controlTimer); installed = null; },
    stopRequested: false,
  };
  if (typeof snapshot !== 'function') return api;

  let lastStopId = null;
  let stopping = false;
  let lastError = null;

  const base = () => ({ schema: SCHEMA, pid: process.pid, updatedAt: new Date().toISOString() });

  function publish(trigger, extra = {}) {
    try {
      const state = snapshot();
      const payload = { ...base(), phase: 'running', ...state, trigger, lastError, stopped: false, ...extra };
      writeJsonAtomic(LIVE_FILE, payload);
      return payload;
    } catch (err) {
      lastError = `${new Date().toISOString()} ${String(err?.message ?? err)}`;
      return null;
    }
  }

  function stopRequestedByPanel() {
    if (stopping || typeof stop !== 'function') return;
    const control = readJson(CONTROL_FILE);
    const id = control?.stop?.id ?? null;
    const requestedAt = control?.stop?.requestedAt ?? null;
    if (!id || !requestedAt || id === lastStopId) return;
    lastStopId = id;
    stopping = true;
    api.stopRequested = true;
    publish('stop-request', { phase: 'stopping', stopped: false, stopRequestedAt: requestedAt, stopReason: reason });
    try { stop(); } catch (err) { lastError = `${new Date().toISOString()} stop: ${String(err?.message ?? err)}`; }
  }

  try { fs.mkdirSync(TELEMETRY_DIR, { recursive: true }); } catch { /* best-effort */ }

  const timer = setInterval(() => publish('interval'), PUBLISH_MS);
  const controlTimer = setInterval(stopRequestedByPanel, CONTROL_POLL_MS);
  timer.unref?.();
  controlTimer.unref?.();

  process.on('exit', () => {
    try { publish('exit', { phase: 'stopped', stopped: true, stopReason: stopping ? reason : 'exit' }); } catch { /* nada */ }
  });

  publish('boot', { phase: 'booting' });
  installed = api;
  return api;
}
