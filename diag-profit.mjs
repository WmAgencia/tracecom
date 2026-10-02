/**
 * Diagnóstico: ver payload completo do socket-option-closed
 * pra entender o que vem no campo profit
 */
import https from 'https';
import { IqWsClient } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function login() {
  const data = JSON.stringify({ identifier: EMAIL, password: PASSWORD });
  const res = await httpRequest({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' }
  }, data);
  return (JSON.parse(res.body)).result?.ssid ?? JSON.parse(res.body).ssid;
}

async function main() {
  const ssid = await login();
  const ws = new IqWsClient({ log: () => {} });

  ws.on('ready', async () => {
    console.log('[WS] Ready!\n');

    // Escutar TODOS os eventos por 30s
    const events = {};
    ws.on('message', (m) => {
      const name = m?.name ?? 'unknown';
      events[name] = (events[name] || 0) + 1;
    });

    // Capturar socket-option-closed bruto
    ws.on('socket-option-closed', (msg) => {
      console.log('\n=== socket-option-closed RECEBIDO ===');
      console.log(JSON.stringify(msg, null, 2).slice(0, 2000));
    });

    // Imprimir TUDO que chegar após a ordem
    ws.on('message', (m) => {
      const n = m?.name;
      if (n === 'option' || n === 'binary-options.open-option' || n === 'socket-option-closed' || n === 'option-closed') {
        console.log(`\n[${n}]`);
        console.log(JSON.stringify(m, null, 2).slice(0, 2500));
      }
    });

    // Subscrever USDHKD por 30s para pegar orders
    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};
    const usd = Object.entries(turboActives).find(([_, a]) => a.name?.includes('USDHKD') && /otc/i.test(a.name));

    if (usd) {
      const [id] = usd;
      const activeId = Number(id);
      console.log(`Subscrevendo USDHKD (id=${activeId})...`);

      let candleCount = 0;
      ws.on('candle-generated', async (msg) => {
        candleCount++;
        // Após 3 candles, fazer uma ordem de teste
        if (candleCount === 5) {
          console.log('\n>>> FAZENDO ORDEM DE TESTE R$2 CALL <<<\n');
          const balances = await ws.getBalances();
          const balData = balances?.msg ?? balances;
          const conta = (Array.isArray(balData) ? balData : []).find(b => b.type === 4) || balData[0];
          // OTC expira no próximo minuto: pegar o próximo múltiplo de 60s
          const nowSec = Math.floor(Date.now() / 1000);
          const expiration = (Math.floor(nowSec / 60) + 1) * 60;
          ws.placeOrder({
            price: 2, activeId, direction: 'CALL',
            expiration, optionTypeId: 3, balanceId: conta.id
          });
        }
      });

      ws.subscribeCandles(activeId, 5);
    }

    await new Promise(r => setTimeout(r, 35_000));

    console.log('\n=== EVENTOS RECEBIDOS ===');
    for (const [name, count] of Object.entries(events)) {
      console.log(`  ${name}: ${count}`);
    }

    ws.close();
    process.exit(0);
  });

  await ws.connect({ ssid });
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });