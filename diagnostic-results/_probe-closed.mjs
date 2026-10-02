// Sonda READ-ONLY: dumpa os registros de opções FECHADAS (closed_options do get-options)
// para conferir a contabilidade real da venda antecipada. NÃO abre/vende nada.
import fs from 'fs';
import https from 'https';
import { IqWsClient } from '../iqoption-ws.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../bot-config-v15.json', import.meta.url), 'utf8'));

async function login() {
  const postData = JSON.stringify({ identifier: CONFIG.login.email, password: CONFIG.login.password });
  const body = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' },
    }, (res) => { let text = ''; res.on('data', (d) => text += d); res.on('end', () => resolve(text)); });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
  const parsed = JSON.parse(body);
  const ssid = parsed.result?.ssid ?? parsed.ssid;
  if (!ssid) throw new Error('LOGIN_SEM_SSID');
  return ssid;
}

const client = new IqWsClient({ log: () => {} });
const ssid = await login();
await client.connect({ ssid });
const bals = await client.getBalances();
const demo = (Array.isArray(bals?.msg) ? bals.msg : []).find((b) => Number(b.type) === 4);
console.log(`[1] saldo demo = ${demo?.amount} ${demo?.currency} id=${demo?.id}`);

const resp = await client.getOptions({ limit: 50, balanceId: Number(demo.id) });
const closed = resp?.msg?.closed_options ?? [];
console.log(`[2] fechadas = ${closed.length}`);

const wanted = new Set(['14315713333', '14315729732', '14315730638']);
const rows = closed.filter((r) => wanted.has(String(r.id)));
console.log(`[3] encontradas ${rows.length} das procuradas:`);
for (const row of rows) console.log(JSON.stringify(row));

// Mais recentes por 'created' (string ISO) — dump das 5 últimas.
const latest = [...closed].sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? ''))).slice(0, 5);
console.log('[4] 5 mais recentes:');
for (const row of latest) console.log(JSON.stringify(row));

// Calibração: como a IQ classifica cada resultado (win/equal/loose) e o que devolve.
const byWin = {};
for (const r of closed) {
  const key = String(r.win ?? '?');
  byWin[key] = byWin[key] ?? { count: 0, samples: [] };
  byWin[key].count++;
  if (byWin[key].samples.length < 4) byWin[key].samples.push({ id: r.id, active: r.active, amount: r.amount, win_amount: r.win_amount });
}
console.log('[5] por resultado:', JSON.stringify(byWin));

client.close();
process.exit(0);
