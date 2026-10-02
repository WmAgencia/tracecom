/**
 * bot-setup.mjs — Setup interativo do bot
 * ========================================
 * Na primeira execução: wizard completo (email, senha, conta, stake, meta, etc.)
 * Nas próximas execuções: menu rápido para rodar, trocar conta ou atualizar config.
 *
 * Uso:
 *   node bot-setup.mjs              → menu (ou wizard se for primeira vez)
 *   node bot-setup.mjs --wizard     → força o wizard completo
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import { spawn } from 'child_process';
import readline from 'readline';
import tls from 'node:tls';
import crypto from 'node:crypto';

// ─── Caminhos ────────────────────────────────────────────────────────────────
function resolveBaseDir() {
  // __filename não existe em ESM, usa-se import.meta.url
  // import.meta.url pode vir com %20 para espaços — decodifica antes de usar path
  const metaUrl = import.meta.url;
  if (metaUrl && metaUrl.startsWith('file://')) {
    // Ex: file:///D:/Tracecom%20project/Consecom%20Bot/bot-setup.mjs
    const raw = metaUrl.replace('file://', '');
    // Decodifica %20 → espaços, remove leading slash se presente
    let dir = decodeURIComponent(raw).replace(/\\/g, '/');
    // /D:/Tracecom project/Consecom Bot/bot-setup.mjs → /D:/Tracecom project/Consecom Bot
    dir = dir.replace(/[/][^/]*$/, ''); // remove nome do arquivo
    // /D:/Tracecom project/Consecom Bot
    if (dir.match(/[\\/]Consecom Bot$/i)) {
      dir = dir.replace(/[\\/]Consecom Bot$/i, '');
    }
    // /D:/Tracecom project  →  D:/Tracecom project  (remove leading / pra Windows)
    return dir.replace(/^\//, '');
  }
  // Fallback: usa process.argv[1]
  const scriptPath = process.argv[1] || '.';
  const scriptDir = path.dirname(scriptPath);
  const normalized = scriptDir.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized.match(/[\\/]Consecom Bot$/i)) {
    return path.dirname(scriptDir);
  }
  return scriptDir;
}
const BASE_DIR   = resolveBaseDir();
const CREDS_FILE = path.join(BASE_DIR, 'bot-credentials.json');
const CONFIG_FILE = path.join(BASE_DIR, 'bot-config-v15.json');
const BOT_FILE = path.join(BASE_DIR, 'ws-otc-v15.mjs');

// ─── rl factory ────────────────────────────────────────────────────────────
const rl = () => readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (r, q) => new Promise((res) => r.question(q, res));
const clear = () => process.stdout.write('\x1b[2J\x1b[H');

const print = (lines) => lines.forEach((l) => console.log(l));
const header = () => print([
  '',
  ' ╔══════════════════════════════════════════════╗',
  ' ║          🤖  OTC BOT v15 — SETUP            ║',
  ' ╚══════════════════════════════════════════════╝',
  '',
]);

// ─── Persistência ──────────────────────────────────────────────────────────
function loadCreds() {
  try {
    if (fs.existsSync(CREDS_FILE)) {
      return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function saveCreds(data) {
  fs.writeFileSync(CREDS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function updateConfig(creds) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    console.error('[SETUP] Não encontrou bot-config-v15.json — abortando.');
    process.exit(1);
  }

  cfg.login = { email: creds.email, password: creds.password };
  cfg.trading = cfg.trading ?? {};
  cfg.trading.baseStake = creds.stake;
  cfg.trading.expirationMinutes = 5;  // fixo em 5 min

  cfg.stop = cfg.stop ?? {};
  cfg.stop.profitTarget = creds.profitTarget ?? 50;
  cfg.stop.stopAfterLosses = cfg.stop.stopAfterLosses ?? 3;

  cfg.risk = cfg.risk ?? {};
  cfg.risk.maxExposurePct = creds.maxExposurePct ?? 50;
  cfg.risk.maxStake = cfg.risk.maxStake ?? 20;

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return cfg;
}

// ─── WebSocket mínimo para buscar saldos ─────────────────────────────────────────
function wsBalanceRequest(ssid, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    let socket;
    let resolved = false;
    const settle = (val) => { if (resolved) return; resolved = true; clearTimeout(timer); try { socket.destroy(); } catch {} resolve(val); };

    const timer = setTimeout(() => settle(null), timeoutMs);

    try {
      socket = tls.connect(
        { host: 'iqoption.com', port: 443, servername: 'iqoption.com', rejectUnauthorized: false },
        () => {
          const key = crypto.randomBytes(16).toString('base64');
          socket.write(
            `GET /echo/websocket HTTP/1.1\r\n` +
            `Host: iqoption.com\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `Origin: https://iqoption.com\r\n` +
            `Cookie: ssid=${ssid}\r\n` +
            `User-Agent: Mozilla/5.0\r\n\r\n`
          );
        }
      );
    } catch { settle(null); return; }

    let buf = Buffer.alloc(0);
    let authDone = false;

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const text = buf.toString('utf8');
      if (!authDone && text.includes('HTTP/1.1 101')) { authDone = true; buf = Buffer.alloc(0); }
      if (!authDone) return;

      let off = 0;
      while (off + 2 <= buf.length) {
        const b1 = buf[off], b2 = buf[off + 1];
        const masked = (b2 & 0x80) !== 0;
        let len = b2 & 0x7f, hdr = 2;
        if (len === 126) { if (off + 4 > buf.length) break; len = buf.readUInt16BE(off + 2); hdr = 4; }
        else if (len === 127) { if (off + 10 > buf.length) break; len = Number(buf.readBigUInt64BE(off + 2)); hdr = 10; }
        if (off + hdr + len > buf.length) break;
        let payload = buf.subarray(off + hdr, off + hdr + len);
        if (masked) {
          const maskKey = buf.subarray(off + hdr, off + hdr + 4);
          for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
        }
        off += hdr + len;
        if ((b1 & 0x0f) === 1) {
          try {
            const parsed = JSON.parse(payload.toString('utf8'));
            if (parsed.name === 'balances' && parsed.msg) {
              settle(parsed.msg);
              return;
            }
          } catch {}
        }
      }
      buf = buf.subarray(off);
    });

    socket.on('error', () => settle(null));
    socket.on('close', () => settle(null));

    // Envia mensagens após handshake
    setTimeout(() => {
      if (resolved) return;
      const encodeFrame = (data) => {
        const body = Buffer.from(JSON.stringify(data), 'utf8');
        const len = body.length;
        let hdr;
        if (len < 126) {
          hdr = Buffer.from([0x81, len]);
        } else if (len < 65536) {
          hdr = Buffer.alloc(4);
          hdr[0] = 0x81; hdr[1] = 126; hdr.writeUInt16BE(len, 2);
        } else {
          hdr = Buffer.alloc(10);
          hdr[0] = 0x81; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2);
        }
        return Buffer.concat([hdr, body]);
      };
      socket.write(encodeFrame({ name: 'subscribe', version: '1.0', body: { name: 'profile' } }));
      socket.write(encodeFrame({ name: 'sendMessage', version: '1.0', body: { name: 'get-balances', version: '1.0' } }));
    }, 800);
  });
}

// ─── Login na IQ + buscar saldos via WebSocket ───────────────────────────────
async function iqLogin(email, password) {
  // 1. Login HTTP para pegar o ssid
  const httpResult = await new Promise((resolve) => {
    const postData = JSON.stringify({ identifier: email, password });
    const req = https.request({
      hostname: 'iqoption.com',
      path: '/api/v2/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Origin': 'https://iqoption.com',
        'Referer': 'https://iqoption.com/',
      },
    }, (res) => {
      let text = '';
      res.on('data', (d) => text += d);
      res.on('end', () => {
        try { resolve(JSON.parse(text)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(postData);
    req.end();
  });

  const ssid = httpResult?.result?.ssid ?? httpResult?.ssid;
  if (!ssid) {
    return { httpResult, demoBalance: null, realBalance: null, demoCurrency: 'USD', realCurrency: 'BRL' };
  }

  // 2. WebSocket mínimo para buscar saldos reais
  let demoBalance = null, realBalance = null;
  let demoCurrency = 'USD', realCurrency = 'BRL';

  try {
    const balMsg = await wsBalanceRequest(ssid, 12_000);
    const list = balMsg?.balances ?? balMsg ?? [];
    const rows = Array.isArray(list) ? list : [];
    for (const b of rows) {
      if (b.type === 4) {
        demoBalance = Number(b.amount);
        demoCurrency = b.currency ?? 'USD';
      } else if (b.type === 1) {
        realBalance = Number(b.amount);
        realCurrency = b.currency ?? 'BRL';
      }
    }
  } catch {}

  return { httpResult, demoBalance, realBalance, demoCurrency, realCurrency };
}

function fmtBalance(amount, currency) {
  const sym = currency === 'USD' ? 'US$' : currency === 'BRL' ? 'R$' : '';
  return `${sym}${(amount ?? 0).toFixed(2)}`;
}

// ─── Validação ─────────────────────────────────────────────────────────────
function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v ?? '').trim());
}

// ─── Rodar o bot ───────────────────────────────────────────────────────────
function runBot() {
  console.log('\n ▶  Iniciando o bot...\n');
  spawn('node', ['ws-otc-v15.mjs'], {
    cwd: BASE_DIR,
    stdio: 'ignore',
    detached: true,
    shell: true,
  }).unref();
  // Pai morre; filho continua rodando em background
  process.exit(0);
}

// ─── Wizard ────────────────────────────────────────────────────────────────
async function runWizard() {
  const r = rl();
  clear();
  header();
  print([
    ' 📌  Primeira execução — configure tudo uma vez só.',
    '    Suas informações são salvas localmente e nunca saem desta pasta.',
    '',
  ]);

  // E-mail
  let email;
  while (true) {
    email = (await ask(r, '  E-mail da IQ Option: ')).trim();
    if (isValidEmail(email)) break;
    print(['  ❌  E-mail inválido. Tente novamente.']);
  }

  // Senha
  let password;
  while (true) {
    password = (await ask(r, '  Senha da IQ Option: ')).trim();
    if (password.length >= 4) break;
    print(['  ❌  Senha muito curta.']);
  }

  // Login + buscar saldos
  print(['', '  🔑  Verificando contas...']);
  const { demoBalance, realBalance, demoCurrency, realCurrency } = await iqLogin(email, password);

  // Escolha da conta com saldo visível
  clear();
  header();
  print(['  Qual conta quer usar?\n']);
  print(['  ┌──────────────────────────────────────────────────┐']);
  const demoLine = `  │  1  —  CONTA DEMO   ${demoBalance !== null ? fmtBalance(demoBalance, demoCurrency).padEnd(20) : '(verificando...)'.padEnd(20)} │`;
  const realLine = `  │  2  —  CONTA REAL   ${realBalance !== null ? fmtBalance(realBalance, realCurrency).padEnd(20) : '(verificando...)'.padEnd(20)} │`;
  print([demoLine]);
  print([realLine]);
  print(['  └──────────────────────────────────────────────────┘']);

  let accountType;
  while (true) {
    const ans = (await ask(r, '\n  Digite 1 ou 2: ')).trim();
    if (ans === '1') { accountType = 'DEMO'; break; }
    if (ans === '2') { accountType = 'REAL'; break; }
    print(['  ❌  Digite 1 ou 2.']);
  }

  // Stake
  clear();
  header();
  print([`  Conta: ${accountType === 'DEMO' ? 'DEMO' : 'REAL'}`]);
  print(['']);
  print(['  Valor fixo por operação (stake base):']);
  print([`  (mínimo: R$ 2,00)`]);
  let stake;
  while (true) {
    const raw = (await ask(r, '\n  Stake base (R$): ')).trim();
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 2) { stake = Math.round(n * 100) / 100; break; }
    print(['  ❌  Valor inválido. Digite um número >= 2.']);
  }

  // Exposição máxima
  clear();
  header();
  print([`  Stake: R$ ${stake.toFixed(2)}`]);
  print(['']);
  print(['  Exposição máxima simultânea (% do saldo inicial):']);
  print([`  (padrão: 50% — se começou com R$ 60,00, máximo em aberto é R$ 30,00)`]);
  let maxExposurePct;
  while (true) {
    const raw = (await ask(r, '\n  % de exposição máxima [Enter = 50]: ')).trim();
    if (raw === '') { maxExposurePct = 50; break; }
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 0 && n <= 100) { maxExposurePct = n; break; }
    print(['  ❌  Valor inválido. Digite um número entre 1 e 100.']);
  }

  // Meta de lucro
  clear();
  header();
  print([`  Exposição máxima: ${maxExposurePct}%`]);
  print(['']);
  print(['  Meta de lucro — quando bater, o bot para sozinho:']);
  print([`  (ex: 30 → para ao atingir R$ 30,00 de lucro)`]);
  let profitTarget;
  while (true) {
    const raw = (await ask(r, '\n  Meta de lucro (R$) [Enter = 30]: ')).trim();
    if (raw === '') { profitTarget = 30; break; }
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n > 0) { profitTarget = Math.round(n * 100) / 100; break; }
    print(['  ❌  Valor inválido. Digite um número positivo.']);
  }

  // Expiração: sempre 5 minutos (padrão do V15)
  const expirationMinutes = 5;

  r.close();

  const creds = {
    email, password,
    accountType,
    stake,
    maxExposurePct,
    profitTarget,
    expirationMinutes: 5,
    setupAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };

  saveCreds(creds);
  updateConfig(creds);

  clear();
  print([
    '',
    ' ✅  Configuração salva!',
    '',
    `    Conta:  ${accountType}`,
    `    Stake:  R$ ${stake.toFixed(2)}`,
    `    Expo:   ${maxExposurePct}% do saldo`,
    `    Meta:   R$ ${profitTarget.toFixed(2)}`,
    `    Expira: 5 min`,
    '',
  ]);

  // Inicia o bot automaticamente
  runBot();
}

// ─── Menu rápido ────────────────────────────────────────────────────────────
async function runMenu() {
  const creds = loadCreds();
  if (!creds) return runWizard();

  const r = rl();
  clear();
  header();
  print([
    `  E-mail:   ${creds.email}`,
    `  Conta:    ${creds.accountType}`,
    `  Stake:    R$ ${(creds.stake ?? 2).toFixed(2)}`,
    `  Expo:     ${creds.maxExposurePct ?? 50}% do saldo`,
    `  Meta:     R$ ${(creds.profitTarget ?? 30).toFixed(2)}`,
    `  Expira:   5 min`,
    '',
    '  O que deseja fazer?',
    '',
    '  ┌──────────────────────────────────────────────────────┐',
    '  │  1  —  RODAR AGORA (mesma conta)                     │',
    '  │  2  —  TROCAR DE CONTA (demo ↔ real)                │',
    '  │  3  —  ATUALIZAR CONFIGURAÇÕES (stake, meta, etc)   │',
    '  │  4  —  FAZER LOGIN COM OUTRA CONTA                  │',
    '  │  5  —  SAIR                                          │',
    '  └──────────────────────────────────────────────────────┘',
  ]);

  let choice;
  while (true) {
    const ans = (await ask(r, '\n  Digite o número: ')).trim();
    if (['1','2','3','4','5'].includes(ans)) { choice = ans; break; }
    print(['  ❌  Digite 1, 2, 3, 4 ou 5.']);
  }
  r.close();

  if (choice === '1') {
    creds.lastUsedAt = new Date().toISOString();
    saveCreds(creds);
    updateConfig(creds);
    runBot(); // nunca retorna
  }

  if (choice === '2') {
    const newType = creds.accountType === 'DEMO' ? 'REAL' : 'DEMO';
    creds.accountType = newType;
    creds.lastUsedAt = new Date().toISOString();
    saveCreds(creds);
    updateConfig(creds);
    clear();
    print(['', ` ✅  Conta alterada para: ${newType}`, '']);
    print([' ▶  Rode: node ws-otc-v15.mjs', '']);
    return;
  }

  if (choice === '3') {
    return runPartialUpdate(creds);
  }

  if (choice === '4') {
    return runWizard();
  }

  // choice === '5'
  clear();
  print(['', '  👋  Até logo!', '']);
  process.exit(0);
}

// ─── Update parcial ────────────────────────────────────────────────────────
async function runPartialUpdate(creds) {
  const r = rl();
  clear();
  header();
  print(['  Atualize os campos que quiser mudar (Enter = mantém o atual)', '']);

  let newStake = creds.stake;
  const rawStake = (await ask(r, `  Stake base (R$) [Enter = ${creds.stake?.toFixed(2) ?? 2}]: `)).trim();
  if (rawStake !== '') {
    const n = parseFloat(rawStake);
    if (Number.isFinite(n) && n >= 2) newStake = Math.round(n * 100) / 100;
    else print(['  ❌  Valor inválido — mantido o anterior.']);
  }

  let newExpo = creds.maxExposurePct ?? 50;
  const rawExpo = (await ask(r, `  Exposição máxima % [Enter = ${creds.maxExposurePct ?? 50}]: `)).trim();
  if (rawExpo !== '') {
    const n = parseFloat(rawExpo);
    if (Number.isFinite(n) && n > 0 && n <= 100) newExpo = n;
    else print(['  ❌  Valor inválido — mantido o anterior.']);
  }

  let newMeta = creds.profitTarget ?? 30;
  const rawMeta = (await ask(r, `  Meta de lucro (R$) [Enter = ${(creds.profitTarget ?? 30).toFixed(2)}]: `)).trim();
  if (rawMeta !== '') {
    const n = parseFloat(rawMeta);
    if (Number.isFinite(n) && n > 0) newMeta = Math.round(n * 100) / 100;
    else print(['  ❌  Valor inválido — mantido o anterior.']);
  }

  r.close();

  const updated = { ...creds, stake: newStake, maxExposurePct: newExpo, profitTarget: newMeta, expirationMinutes: 5 };
  updated.lastUsedAt = new Date().toISOString();
  saveCreds(updated);
  updateConfig(updated);

  clear();
  print([
    '',
    ' ✅  Configurações atualizadas!',
    '',
    `    Stake:  R$ ${newStake.toFixed(2)}`,
    `    Expo:   ${newExpo}% do saldo`,
    `    Meta:   R$ ${newMeta.toFixed(2)}`,
    '',
  ]);

  // Volta ao menu para o usuário escolher o próximo passo
  await runMenu();
}

// ─── entry point ──────────────────────────────────────────────────────────
const MODE = process.argv[2]?.toLowerCase();
const creds = loadCreds();

if (!creds || MODE === '--wizard') {
  await runWizard();
} else {
  await runMenu();
}
