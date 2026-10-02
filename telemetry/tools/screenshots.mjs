#!/usr/bin/env node
/**
 * SCREENSHOTS + AUDITORIA VISUAL DO PAINEL
 * =============================================================================
 *   node telemetry/tools/screenshots.mjs                 → servidor de FIXTURE (dados de
 *                                                          exemplo; nenhum broker envolvido)
 *   node telemetry/tools/screenshots.mjs --base <url>    → painel REAL já rodando
 *
 * Usa o Playwright que já existe no projeto. Além dos PNGs, roda uma auditoria
 * em cima do DOM renderizado (contraste WCAG, overflow, texto invisível, radius)
 * e grava tudo em telemetry/screenshots/AUDIT.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PATHS, writeJsonAtomic, readJson } from '../lib/store.mjs';
import { createRuntime } from '../lib/runtime.mjs';
import { createPanelServer } from '../server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'screenshots');

const SHOTS = [
  { name: 'desktop-parado', theme: 'dark', w: 1600, h: 1000, state: 'stopped' },
  { name: 'desktop-parado-light', theme: 'light', w: 1600, h: 1000, state: 'stopped' },
  { name: 'desktop-ativo', theme: 'dark', w: 1600, h: 1000, state: 'running' },
  { name: 'desktop-ativo-light', theme: 'light', w: 1600, h: 1000, state: 'running' },
  { name: 'tablet-ativo', theme: 'dark', w: 834, h: 1112, state: 'running' },
  { name: 'tablet-ativo-light', theme: 'light', w: 834, h: 1112, state: 'running' },
  { name: 'mobile-ativo', theme: 'dark', w: 414, h: 896, state: 'running' },
  { name: 'mobile-ativo-light', theme: 'light', w: 414, h: 896, state: 'running' },
  { name: 'mobile-parado', theme: 'dark', w: 414, h: 896, state: 'stopped' },
  { name: 'configuracoes', theme: 'dark', w: 1280, h: 900, state: 'running', open: 'settings' },
  { name: 'configuracoes-light', theme: 'light', w: 1280, h: 900, state: 'running', open: 'settings' },
  { name: 'historico', theme: 'dark', w: 1280, h: 900, state: 'running', open: 'history' },
  { name: 'historico-light', theme: 'light', w: 1280, h: 900, state: 'running', open: 'history' },
];

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const H = 3_600_000, D = 86_400_000;

/** Retrato de uma sessão real (números plausíveis) — só para o modo fixture. */
function fixtureFiles(dir) {
  const sessionStart = NOW - (1_42 * 60_000 + 37_000);       // 01:42:37 de sessão
  const sessionId = 's-fixture-20261002-091500-ab12';
  writeJsonAtomic(path.join(dir, 'live.json'), {
    schema: 'tracecom-bot-telemetry-v1', pid: process.pid, updatedAt: new Date().toISOString(),
    phase: 'running', accountType: 'DEMO', currencySymbol: 'US$', balanceId: 1250741747,
    initialBalance: 51.4, balance: 39.3, sessionStartBalance: 51.4,
    startedAt: sessionStart, warmupDone: true, closedCandles: 12_845,
    sessionLossLimit: 10.28, exposureLimit: 19.65, openStake: 5.5,
    openPositions: [{ key: 'ARBUSD', asset: 'ARBUSD', direction: 'CALL', kind: 'reversalGale', stake: 5.5, expiration: Math.floor(NOW / 1000) + 96 }],
    paused: [], stats: { settled: 11, wins: 4, losses: 7, draws: 0, early: 3, earlyPos: 1, earlyNeg: 2, profit: -12.1, wr: 36.36 },
    universe: { size: 62, min: 170, max: 200 },
    config: { baseStake: 2, expiryMinutes: 2, maxOpsPerAsset: 3, maxStake: 30, payout: 0.86, maxExposurePct: 50, sessionLossPct: 20 },
    resultsCount: 11, rev: 'V16', codeHash: '7ba59bd0', stopped: false,
  });
  writeJsonAtomic(path.join(dir, 'runtime.json'), {
    schema: 'tracecom-runtime-v1', sessionId, pid: process.pid, account: 'demo',
    requestedAt: iso(sessionStart), stop: null,
  });

  const trades = [
    ['COTTON', 'PUT', 'entrada', 2, 'loss', -2, 35 * 60_000],
    ['ARBUSD', 'PUT', 'reversalGale', 5.5, 'win', 4.51, 68 * 60_000],
    ['ARBUSD', 'CALL', 'entrada', 2, 'early', -1.93, 92 * 60_000],
    ['ONDOUSD', 'CALL', 'reversalGale', 5.5, 'early', -5.29, 118 * 60_000],
    ['ONDOUSD', 'PUT', 'entrada', 2, 'early', -1.85, 121 * 60_000],
    ['PENUSD', 'CALL', 'entrada', 2, 'win', 1.64, 26 * H],
    ['PENUSD', 'CALL', 'pyramid', 2, 'win', 1.64, 25 * H],
    ['SHIBUSD', 'PUT', 'entrada', 2, 'loss', -2, 27 * H],
    ['WIFUSD', 'CALL', 'entrada', 2, 'win', 1.64, 3 * D],
    ['SUIUSD', 'PUT', 'entrada', 2, 'loss', -2, 4 * D],
    ['HYPE', 'CALL', 'entrada', 2, 'win', 1.64, 12 * D],
    ['RENDERUSD', 'PUT', 'entrada', 2, 'draw', 0, 20 * D],
  ].map(([asset, direction, kind, stake, outcome, profit, ago], i) => ({
    id: `order:${14200000000 + i}`,
    orderId: 14200000000 + i,
    requestId: `fx${i}`,
    sessionId: i < 5 ? sessionId : `s-fixture-antiga-${i}`,
    assetId: 2000 + i,
    asset, direction, kind, stake,
    outcome: profit > 0 ? 'win' : profit < 0 ? 'loss' : 'draw',
    result: outcome === 'early' ? 'early' : profit > 0 ? 'win' : profit < 0 ? 'loss' : 'draw',
    profit,
    earlySell: outcome === 'early',
    sellReturn: outcome === 'early' ? Math.round((stake + profit) * 100) / 100 : null,
    sentAt: iso(NOW - ago - 120_000),
    settledAt: iso(NOW - ago),
    entryPrice: 1.2345 + i / 1000,
    currency: 'US$',
  }));
  writeJsonAtomic(path.join(dir, 'ledger', 'trades.json'), {
    schema: 'tracecom-trade-ledger-v1', updatedAt: new Date().toISOString(), trades,
  });

  const done = (id, endedAgo, durMin, ops, wins, losses, profit, reason) => ({
    id, requestedAt: iso(NOW - endedAgo - durMin * 60_000), startedAt: iso(NOW - endedAgo - durMin * 60_000),
    endedAt: iso(NOW - endedAgo), endReason: reason, exitCode: 0, state: 'STOPPED', source: 'panel',
    account: { type: 'DEMO', currency: 'USD' }, stakeApplied: 2, startBalance: 40, endBalance: 40 + profit,
    stats: { ops, wins, losses, draws: 0, earlySells: 0, profit, stake: ops * 2, wr: wins + losses ? Math.round((wins / (wins + losses)) * 10_000) / 100 : 0, firstAt: null, lastAt: null },
    botStats: null, tradeIds: [], error: null,
  });
  writeJsonAtomic(path.join(dir, 'ledger', 'sessions.json'), {
    schema: 'tracecom-session-ledger-v1', updatedAt: new Date().toISOString(),
    sessions: [
      {
        id: sessionId, requestedAt: iso(sessionStart), startedAt: iso(sessionStart), endedAt: null, endReason: null,
        exitCode: null, state: 'RUNNING', source: 'panel', pid: process.pid, logFile: null,
        account: { type: 'DEMO', currency: 'USD' }, stakeApplied: 2, startBalance: 51.4, endBalance: null,
        stats: { ops: 11, wins: 4, losses: 7, draws: 0, earlySells: 3, profit: -12.1, stake: 24, wr: 36.36, firstAt: null, lastAt: null },
        botStats: null, tradeIds: [], error: null,
      },
      done('s-fixture-20261001-154000-cd34', 26 * H, 92, 27, 11, 16, -18.4, 'K'),
      done('s-fixture-20261001-101500-ef56', 32 * H, 141, 44, 21, 23, 6.7, 'WS'),
      done('s-fixture-20260930-221000-gh78', 3 * D - 6 * H, 63, 18, 9, 9, 2.35, 'META'),
    ],
  });
  return { sessionId, sessionStart, sessionProfit: -12.1 };
}

function stopFixture(dir) {
  writeJsonAtomic(path.join(dir, 'live.json'), {
    schema: 'tracecom-bot-telemetry-v1', pid: null, updatedAt: new Date().toISOString(), phase: 'stopped',
    accountType: 'DEMO', currencySymbol: 'US$', balanceId: 1250741747, initialBalance: 51.4, balance: 39.3,
    sessionStartBalance: 51.4, startedAt: 0, warmupDone: false, closedCandles: 0, openStake: 0, openPositions: [],
    paused: [], stats: { settled: 0, wins: 0, losses: 0, draws: 0, early: 0, earlyPos: 0, earlyNeg: 0, profit: 0, wr: 0 },
    universe: { size: 0, min: 170, max: 200 },
    config: { baseStake: 2, expiryMinutes: 2, maxOpsPerAsset: 3, maxStake: 30, payout: 0.86, maxExposurePct: 50, sessionLossPct: 20 },
    resultsCount: 0, rev: 'V16', codeHash: '7ba59bd0', stopped: true, stopReason: 'PAINEL',
  });
  const runtimeDoc = readJson(path.join(dir, 'runtime.json'), {});
  writeJsonAtomic(path.join(dir, 'runtime.json'), { ...runtimeDoc, pid: null, sessionId: null, stoppedAt: new Date().toISOString() });
  const doc = readJson(path.join(dir, 'ledger', 'sessions.json'), { sessions: [] });
  doc.sessions[0] = { ...doc.sessions[0], endedAt: new Date().toISOString(), endReason: 'PAINEL', state: 'STOPPED', endBalance: 39.3 };
  writeJsonAtomic(path.join(dir, 'ledger', 'sessions.json'), doc);
}

/** Auditoria no DOM renderizado: contraste WCAG, overflow, texto invisível, radius. */
const AUDIT_SCRIPT = `(() => {
  const parse = (c) => {
    c = String(c).trim();
    if (c.startsWith('#')) {
      const h = c.slice(1);
      const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
      return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).concat([full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1]);
    }
    if (!/^rgba?\\(/.test(c)) return [0, 0, 0, 0];        // cor não resolvida (color-mix): conta como transparente
    const p = (c.match(/[\\d.]+/g) ?? []).map(Number);
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
  };
  const composite = (fg, bg) => [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg, bg) => {
    const a = lum(fg), b = lum(bg);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  // Fundos reais do elemento: gradientes contam (pior stop) e camadas translúcidas
  // são compostas sobre o que está atrás — o mesmo que o olho vê.
  // Devolve os fundos que o texto REALMENTE tem atrás: a primeira camada que cobre
  // (gradiente do botão ou superfície sólida) + as tintas translúcidas na frente dela.
  const backgroundsOf = (el) => {
    const pageBg = parse(getComputedStyle(document.body).backgroundColor);
    const chain = [];
    let n = el;
    while (n) {
      const cs = getComputedStyle(n);
      const stops = [...String(cs.backgroundImage).matchAll(/rgba?\\([^)]*\\)|#[0-9a-fA-F]{3,8}/g)].map((m) => parse(m[0]));
      const base = parse(cs.backgroundColor);
      chain.push({ stops, base });
      if (base[3] === 1) break;
      n = n.parentElement;
    }
    const fallback = pageBg[3] === 1 ? pageBg.slice(0, 3) : (document.documentElement.dataset.theme === 'light' ? [243, 245, 249] : [11, 14, 19]);
    const behinds = new Array(chain.length);
    let behind = fallback;
    for (let i = chain.length - 1; i >= 0; i--) {
      behinds[i] = behind;
      const { stops, base } = chain[i];
      if (base[3] > 0) behind = composite(base, behind);
      else if (stops.length) behind = composite(stops[stops.length - 1], behind);
    }
    for (let i = 0; i < chain.length; i++) {
      const { stops, base } = chain[i];
      const resolves = stops.length ? stops : (base[3] > 0 ? [base] : []);
      const opaque = resolves.find((c) => c[3] === 1) ?? (base[3] === 1 ? base : null);
      if (!resolves.length || !opaque) continue;
      return resolves.map((c) => {
        let out = composite(c, behinds[i]);
        for (let j = i - 1; j >= 0; j--) {
          if (chain[j].base[3] > 0) out = composite(chain[j].base, out);
          for (const s of chain[j].stops) out = composite(s, out);
        }
        return out;
      });
    }
    return [fallback];
  };
  const worstRatio = (fg, backgrounds) => Math.min(...backgrounds.map((bg) => ratio(fg.slice(0, 3), bg)));
  const bgOf = (el) => backgroundsOf(el)[0] ?? [255, 255, 255];
  const targets = [
    ['#profit-day', 'lucro hoje (números gigantes)'],
    ['#m-ops', 'métrica operações'],
    ['#m-wins', 'métrica wins'],
    ['#m-loss', 'métrica loss'],
    ['#m-wr', 'métrica WR'],
    ['#session-profit', 'resultado da sessão'],
    ['#session-timer', 'cronômetro'],
    ['#profit-week', 'lucro semana'],
    ['#profit-month', 'lucro mês'],
    ['#exposure', 'exposição'],
    ['#stake-note', 'aviso do valor fixo'],
    ['#power-label', 'rótulo ATIVAR/DESATIVAR'],
    ['#chip-account', 'chip da conta'],
    ['#chip-feed', 'chip IQ/feed'],
    ['#chip-engine', 'chip da prova do motor'],
    ['#events li .txt', 'atividade ao vivo'],
    ['#positions li', 'posições abertas'],
    ['.box-label', 'rótulos das caixas'],
    ['#history-summary', 'resumo do histórico'],
    ['.table th', 'cabeçalho da tabela'],
    ['.table td', 'célula da tabela'],
    ['#confirm-text', 'texto do modal'],
    ['.hint', 'texto de apoio'],
    ['.seg[aria-checked="true"]', 'aba selecionada'],
  ];
  const contrast = [];
  for (const [sel, label] of targets) {
    const el = document.querySelector(sel);
    if (!el) { contrast.push({ sel, label, missing: true }); continue; }
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize) || 14;
    const weight = Number(cs.fontWeight) || 400;
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const bgs = backgroundsOf(el);
    const r = worstRatio(parse(cs.color), bgs);
    contrast.push({ sel, label, ratio: r, need, ok: r >= need, fontSize: size, color: cs.color, bg: bgs.map((b) => 'rgb(' + b.join(',') + ')').join(' | ') });
  }
  const overflow = [];
  for (const el of document.querySelectorAll('.card, .taskbar-inner, .list li, .table-wrap, .kv, .row, .btn, .stake-box')) {
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && (cs.overflowX === 'visible' || cs.overflowX === 'hidden')) {
      overflow.push({ el: el.id || el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
  }
  const invisible = [];
  for (const el of document.querySelectorAll('button, td, th, .box-label, .metric b, .hint, .chip, .seg, .list li')) {
    if (!el.textContent.trim() || !el.offsetParent) continue;
    const fg = parse(getComputedStyle(el).color);
    if (worstRatio(fg, backgroundsOf(el)) < 2) invisible.push(el.id || el.className || el.tagName);
  }
  const squared = [];
  for (const el of document.querySelectorAll('.card, .btn, button, input, .chip, .seg, .list li, .kv, .table-wrap, .gauge, .brand-mark')) {
    const r = getComputedStyle(el).borderRadius;
    if (!r || r === '0px' || r === '0px 0px 0px 0px') squared.push(el.id || el.className || el.tagName);
  }
  const wide = [];
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.right > window.innerWidth + 1) {
      wide.push({ el: el.id || el.className || el.tagName, right: Math.round(rect.right), width: Math.round(rect.width) });
    }
  }
  return {
    theme: document.documentElement.dataset.theme,
    profitText: document.getElementById('profit-day')?.textContent ?? null,
    powerText: document.getElementById('power-label')?.textContent ?? null,
    timerText: document.getElementById('session-timer')?.textContent ?? null,
    docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 2,
    wide: wide.slice(0, 6),
    contrast, overflow, invisible, squared,
  };
})()`;

async function main() {
  const args = process.argv.slice(2);
  const baseArg = args.indexOf('--base');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let base = baseArg >= 0 ? args[baseArg + 1] : null;
  let fixture = null;
  if (!base) {
    const dir = path.join(os.tmpdir(), `tracecom-shots-${Date.now()}`);
    fs.mkdirSync(path.join(dir, 'ledger'), { recursive: true });
    fixtureFiles(dir);
    const fxConfig = path.join(dir, 'bot-config.json');
    fs.copyFileSync(PATHS.config, fxConfig);
    const runtime = createRuntime({
      dir, resultsFile: path.join(dir, 'resultados.json'), configFile: fxConfig, engineFile: PATHS.engine,
      panelConfigFile: path.join(dir, 'panel-config.json'), isAliveImpl: (pid) => Number(pid) === process.pid,
      tickMs: 60_000, log: () => {},
    });
    runtime.adopt();
    runtime.ingestFromResults({ sessionId: runtime.snapshot().sessionId, force: true });
    runtime.tick();
    const { server } = createPanelServer({ runtime });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    fixture = {
      server, dir, runtime, state: 'running',
      setState(state) {
        if (state === 'stopped') stopFixture(dir);
        else fixtureFiles(dir);
        fixture.state = state;
      },
    };
    console.log(`[SHOTS] painel de fixture em ${base} (dados de exemplo, nenhum broker)`);
  } else {
    // Painel REAL: só tira as poses do estado em que ele está agora e marca os arquivos
    // com `live-` para não se confundirem com o conjunto determinístico.
    const stateRes = await fetch(`${base}/api/runtime`).then((r) => r.json()).catch(() => null);
    const liveState = stateRes?.state === 'RUNNING' || stateRes?.state === 'DEGRADED' || stateRes?.state === 'STARTING' ? 'running' : 'stopped';
    const keep = SHOTS.filter((s) => s.state === liveState);
    SHOTS.length = 0;
    SHOTS.push(...keep.map((s) => ({ ...s, name: `live-${s.name}` })));
    console.log(`[SHOTS] painel real em ${base} (estado ${liveState.toUpperCase()}) → ${SHOTS.map((s) => s.name).join(', ')}`);
  }

  const browser = await chromium.launch();
  const audits = [];
  const results = [];
  const touchLive = (dir) => {
    const live = readJson(path.join(dir, 'live.json'), null);
    if (live && live.pid) writeJsonAtomic(path.join(dir, 'live.json'), { ...live, updatedAt: new Date().toISOString() });
  };
  for (const shot of SHOTS) {
    if (fixture && shot.state !== fixture.state) fixture.setState(shot.state);
    if (fixture && shot.state === 'running') touchLive(fixture.dir);   // telemetria fresca como no bot de verdade
    const url = `${base}/?theme=${shot.theme}${shot.open ? `&open=${shot.open}` : ''}`;
    const context = await browser.newContext({ viewport: { width: shot.w, height: shot.h }, locale: 'pt-BR', colorScheme: shot.theme });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(2_600);                       // deixa o 1º ciclo de polling terminar
    const outFile = path.join(OUT_DIR, `${shot.name}.png`);
    await page.screenshot({ path: outFile });
    const audit = await page.evaluate(AUDIT_SCRIPT);
    audits.push({ shot: shot.name, ...audit, errors });
    await context.close();
    const size = fs.statSync(outFile).size;
    const worst = audit.contrast.filter((c) => c.ok === false);
    const bad = worst.length + audit.overflow.length + audit.invisible.length + audit.squared.length + (audit.docOverflowX ? 1 : 0) + errors.length;
    results.push({ ...shot, size, audit, bad });
    console.log(`  ${bad === 0 ? '✅' : '❌'} ${shot.name.padEnd(22)} ${shot.state.padEnd(8)} ${shot.theme.padEnd(5)} ${shot.w}x${shot.h}  ${Math.round(size / 1024)}kB  contraste_min=${Math.min(...audit.contrast.filter((c) => !c.missing).map((c) => c.ratio)).toFixed(2)}${bad ? `  problemas=${bad}` : ''}`);
    if (errors.length) console.log(`      erros JS: ${errors.slice(0, 3).join(' | ')}`);
    for (const c of worst) console.log(`      contraste ${c.ratio} < ${c.need} em ${c.label}`);
    if (audit.squared.length) console.log(`      sem radius: ${audit.squared.slice(0, 5).join(', ')}`);
    if (audit.overflow.length) console.log(`      overflow: ${JSON.stringify(audit.overflow.slice(0, 3))}`);
    if (audit.invisible.length) console.log(`      texto invisível: ${audit.invisible.slice(0, 5).join(', ')}`);
    if (audit.docOverflowX) console.log(`      página com scroll horizontal: ${JSON.stringify(audit.wide)}`);
  }
  await browser.close();

  writeJsonAtomic(path.join(OUT_DIR, 'AUDIT.json'), {
    schema: 'tracecom-panel-audit-v1', at: new Date().toISOString(), mode: fixture ? 'fixture' : 'real',
    base, audits,
  });
  if (fixture) { fixture.server.close(); fs.rmSync(fixture.dir, { recursive: true, force: true }); }
  const bad = results.filter((r) => r.bad > 0);
  console.log(`\n[SHOTS] ${results.length - bad.length}/${results.length} sem nenhum problema visual · PNGs + AUDIT.json em ${path.relative(process.cwd(), OUT_DIR)}`);
  if (bad.length) process.exitCode = 1;
}

void main();
