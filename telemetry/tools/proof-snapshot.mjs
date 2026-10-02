/**
 * PROVA DE NÃO-REGRESSÃO DO MOTOR (ENGINE BEHAVIOR UNCHANGED)
 * =============================================================================
 * Captura um retrato do MOTOR do bot (o que decide, não o que exibe) e compara
 * dois retratos. É a evidência objetiva de que o painel/telemetria não mexeu em
 * estratégia, feeds, stake, settlement, contas, gates ou fluxos de start/stop.
 *
 * Uso:
 *   node telemetry/tools/proof-snapshot.mjs --write telemetry/PROOF-ANTES.json
 *   node telemetry/tools/proof-snapshot.mjs --write telemetry/PROOF-DEPOIS.json
 *   node telemetry/tools/proof-snapshot.mjs --compare telemetry/PROOF-ANTES.json telemetry/PROOF-DEPOIS.json
 *
 * O que conta como MOTOR: código fora dos blocos marcados com [TELEMETRIA].
 * Definição executável em `engineSource()` (strip + sha256).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

export const ENGINE_FILE = path.join(ROOT, 'ws-otc-v15.mjs');
export const CONFIG_FILE = path.join(ROOT, 'bot-config-v15.json');
export const WS_FILE = path.join(ROOT, 'iqoption-ws.mjs');
export const BEFORE_FILE = path.join(ROOT, 'telemetry', 'proof', 'engine-before-v16-panel.mjs');

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Remove TODAS as linhas marcadas como telemetria:
 *   - linhas com o selo `[TELEMETRIA:LINE]`
 *   - blocos entre `[TELEMETRIA:BEGIN]` e `[TELEMETRIA:END]`
 * O resultado tem de ser byte-a-byte igual ao motor original.
 */
export function stripTelemetry(source) {
  const out = [];
  let inside = false;
  for (const line of source.split('\n')) {
    if (line.includes('[TELEMETRIA:BEGIN]')) { inside = true; continue; }
    if (line.includes('[TELEMETRIA:END]')) { inside = false; continue; }
    if (inside) continue;
    if (line.includes('[TELEMETRIA:LINE]')) continue;
    out.push(line);
  }
  return out.join('\n');
}

export function engineSource(file = ENGINE_FILE) {
  return stripTelemetry(fs.readFileSync(file, 'utf8'));
}

export function engineFingerprint(file = ENGINE_FILE) {
  return sha256(engineSource(file));
}

// Constantes que decidem a operação. O valor é a LINHA crua do código: qualquer
// mudança de número aparece na comparação.
const CONST_PATTERN = /^const\s+([A-Z][A-Z0-9_]*)\s*=/;
function extractConstants(source) {
  const map = {};
  for (const line of source.split('\n')) {
    const m = CONST_PATTERN.exec(line.trim());
    if (m) map[m[1]] = line.trim();
  }
  return map;
}

// Funções exportadas = superfície que os testes e outros módulos usam.
function extractExports(source) {
  return [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]).sort();
}

// Marcadores de fluxo: presença/ausência prova que os caminhos não mudaram.
const MARKERS = [
  'binary-options.open-option',      // ordem (fronteira única de broker)
  'sellOption(',                     // venda antecipada
  'parseSettlement',                 // settlement normal
  'finalizeEarly',                   // settlement da venda
  'computeExpiration',               // expiração
  'process.on(\'SIGINT\'',           // parada (K/Ctrl+C/SIGINT)
  'process.on(\'SIGTERM\'',
  'shutdown(',                       // kill switch único
  'sendMessage',
  'subscribeCandles',
  'getCandlesHistory',
  'refreshBalance',
  'evaluateGuards',
  'planTrade',
  'maybeTrade',
  'monitorOperations',
  'v2/login',
  'type === 4',                      // conta DEMO
  'type === 1',                      // conta REAL
  'maxOpsPerAsset',
  'martingaleMultiplier',
  'pyramidAdxMin',
  'reversalGale',
  'applyUniverse',
  'rebalanceUniverse',
];

function countMarkers(source) {
  const counts = {};
  for (const m of MARKERS) counts[m] = source.split(m).length - 1;
  return counts;
}

function configSnapshot() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const { login, ...rest } = cfg;                       // credenciais nunca entram no snapshot
  return JSON.parse(JSON.stringify(rest));
}

export function captureSnapshot() {
  const engineText = fs.readFileSync(ENGINE_FILE, 'utf8');
  const engine = engineSource();
  const config = configSnapshot();
  const ws = fs.readFileSync(WS_FILE, 'utf8');
  let gitHead = null;
  try {
    gitHead = fs.readFileSync(path.join(ROOT, '.git', 'HEAD'), 'utf8').trim();
  } catch { /* sem git: campo fica null */ }

  return {
    schema: 'tracecom-engine-proof-v1',
    capturedAt: new Date().toISOString(),
    gitHead,
    engine: {
      file: 'ws-otc-v15.mjs',
      fullFileSha256: sha256(engineText),
      engineSha256: sha256(engine),
      engineBytes: Buffer.byteLength(engine),
      constants: extractConstants(engine),
      exports: extractExports(engine),
      markers: countMarkers(engine),
      codeRev: /const CODE_REV = '([^']+)'/.exec(engine)?.[1] ?? null,
    },
    config,
    wsClient: {
      file: 'iqoption-ws.mjs',
      sha256: sha256(ws),
      exports: extractExports(ws),
    },
  };
}

const VOLATILE = new Set(['capturedAt', 'gitHead']);
const BY_DESIGN = new Set(['fullFileSha256']);   // muda porque a telemetria é aditiva

function diffObjects(a, b, prefix, out) {
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    if (VOLATILE.has(key)) continue;
    const pa = `${prefix}${prefix ? '.' : ''}${key}`;
    const va = a?.[key];
    const vb = b?.[key];
    const bothPlain = va && vb && typeof va === 'object' && typeof vb === 'object' && !Array.isArray(va) && !Array.isArray(vb);
    if (bothPlain) { diffObjects(va, vb, pa, out); continue; }
    const sa = JSON.stringify(va);
    const sb = JSON.stringify(vb);
    if (sa !== sb) {
      const ignored = [...BY_DESIGN].some((suffix) => pa.endsWith(suffix));
      out.push({ field: pa, before: va, after: vb, ignored });
    }
  }
}

export function compareSnapshots(before, after) {
  const diffs = [];
  diffObjects(before, after, '', diffs);
  const hard = diffs.filter((d) => !d.ignored);
  return {
    ok: hard.length === 0,
    diffs,
    hard,
    engineFingerprint: { before: before?.engine?.engineSha256, after: after?.engine?.engineSha256 },
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === '--write') {
    const target = path.resolve(ROOT, args[1] ?? 'telemetry/PROOF.json');
    const snap = captureSnapshot();
    fs.writeFileSync(target, JSON.stringify(snap, null, 2));
    console.log(`[PROOF] escrito ${path.relative(ROOT, target)}`);
    console.log(`[PROOF] motor sha256:${snap.engine.engineSha256.slice(0, 16)} (arquivo ${snap.engine.fullFileSha256.slice(0, 8)})`);
    console.log(`[PROOF] constantes=${Object.keys(snap.engine.constants).length} exports=${snap.engine.exports.length} marcadores=${Object.keys(snap.engine.markers).length}`);
  } else if (args[0] === '--compare') {
    const before = JSON.parse(fs.readFileSync(path.resolve(ROOT, args[1]), 'utf8'));
    const after = JSON.parse(fs.readFileSync(path.resolve(ROOT, args[2]), 'utf8'));
    const res = compareSnapshots(before, after);
    if (res.ok) {
      console.log(`[PROOF] PASSOU — motor idêntico (sha256:${res.engineFingerprint.after.slice(0, 16)})`);
    } else {
      console.log('[PROOF] FALHOU — diferenças no motor:');
      for (const d of res.hard) console.log(`  - ${d.field}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`);
      process.exitCode = 1;
    }
    for (const d of res.diffs.filter((x) => x.ignored)) console.log(`  (esperado) ${d.field} mudou (telemetria aditiva)`);
  } else {
    console.log('uso: --write <arquivo> | --compare <antes> <depois>');
    process.exitCode = 2;
  }
}
