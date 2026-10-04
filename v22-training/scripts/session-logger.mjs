/**
 * V22 Training — Session Logger
 * Grava candles, indicadores, decisões e resultados em arquivos para análise.
 * NÃO afeta a performance do bot — todas as operações são async/non-blocking.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SESSIONS_DIR = path.join(ROOT, 'sessions');
const SNAPSHOTS_DIR = path.join(ROOT, 'snapshots');
const SIGNALS_LOG = path.join(ROOT, 'signals.log');

// ─── Init dirs ───────────────────────────────────────────────────────────────
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });

// ─── Session State ───────────────────────────────────────────────────────────
let sessionId = null;
let sessionStart = null;
let sessionFile = null;
let snapshotInterval = null;
let signalsHandle = null;
let snapshotCount = 0;
let sessionData = null;

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Inicia o logger. Chamar ANTES de startBot().
 * Recebe acesso a `buf5s` (Map) e `state` (Map) do bot via polling.
 */
export function startSessionLogger(getSnapshot) {
  sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  sessionStart = Date.now();

  sessionData = {
    sessionId,
    startIso: new Date().toISOString(),
    botVersion: 'V22',
    snapshots: [],
    signals: [],
    finalResult: null,
  };

  sessionFile = path.join(SESSIONS_DIR, `session-${sessionId}.json`);
  signalsHandle = fs.openSync(SIGNALS_LOG, 'a');

  logSignal(`=== SESSION START: ${sessionId} ===`);

  // Snapshot a cada 10 segundos (não interfere no loop de 1s)
  snapshotInterval = setInterval(() => {
    try {
      const snap = getSnapshot();
      if (!snap) return;
      snapshotCount++;

      const snapRecord = {
        ts: Date.now(),
        iso: new Date().toISOString(),
        candleCount: snap.totalCandles ?? 0,
        assets: snap.assetCount ?? 0,
        openOps: snap.openOps ?? 0,
        balance: snap.balance ?? 0,
        exposure: snap.exposure ?? 0,
        sessionPL: snap.sessionPL ?? 0,
        regime15m: snap.regimeSample ?? null,
        rsiSample: snap.rsiSample ?? null,
        adxSample: snap.adxSample ?? null,
        skips: snap.skipCount ?? {},
        entrySignals: snap.entrySignals ?? 0,
      };

      sessionData.snapshots.push(snapRecord);

      // Snapshot individual por ativo (top 20)
      if (snap.topAssets) {
        const assetFile = path.join(SNAPSHOTS_DIR, `snap-${sessionId}-${String(snapshotCount).padStart(4, '0')}.json`);
        fs.writeFileSync(assetFile, JSON.stringify({
          ts: snapRecord.ts,
          iso: snapRecord.iso,
          topAssets: snap.topAssets,
          global: {
            openOps: snap.openOps,
            balance: snap.balance,
            sessionPL: snap.sessionPL,
          },
        }, null, 2));
      }

      // Append no signals log
      if (snap.latestSignals?.length) {
        for (const s of snap.latestSignals) {
          logSignal(`[${snapRecord.iso}] ${s}`);
        }
      }
    } catch (e) {
      // Não quebra o bot
    }
  }, 10_000);

  // Flush do session.json a cada 60s
  setInterval(() => {
    if (sessionData) {
      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
    }
  }, 60_000);

  return sessionId;
}

/** Loga um sinal de skip/entrada no signals.log */
export function logSignal(msg) {
  if (signalsHandle != null) {
    fs.writeSync(signalsHandle, msg + '\n');
  }
}

/**
 * Encerra o logger e grava o resultado final.
 * Chamar no graceful shutdown do bot.
 */
export function endSessionLogger(finalResult = {}) {
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
  if (signalsHandle != null) {
    logSignal(`=== SESSION END: ${sessionId} ===`);
    fs.closeSync(signalsHandle);
    signalsHandle = null;
  }
  if (sessionData) {
    sessionData.endIso = new Date().toISOString();
    sessionData.durationMs = Date.now() - sessionStart;
    sessionData.snapshotCount = snapshotCount;
    sessionData.finalResult = finalResult;
    fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
  }
  return sessionId;
}

/** Retorna o sessionId ativo */
export function getSessionId() {
  return sessionId;
}
