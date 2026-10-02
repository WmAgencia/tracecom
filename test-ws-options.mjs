// Abre opção + mostra profit via WS
import { IqWsClient } from './iqoption-ws.mjs';
import https from 'https';

function httpReq(options, postData = null) {
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

async function main() {
  const AUTH_HOST = 'api.iqoption.com';
  const loginData = JSON.stringify({ identifier: 'Anaalaura2008@gmail.com', password: 'Eqvpanp.32' });
  const loginRes = await httpReq({
    hostname: AUTH_HOST, path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginData), 'Origin': 'https://iqoption.com' },
  }, loginData);
  const ssid = JSON.parse(loginRes.body).result?.ssid ?? JSON.parse(loginRes.body).ssid;
  console.log('[✅] Login OK');

  const ws = new IqWsClient('wss://iqoption.com/prizmjsapi/optimized');

  ws.on('ready', async () => {
    console.log('[WS] Ready');

    // Escuta mensagens relevantes
    ws.on('message', (msg) => {
      const name = msg?.name ?? msg?.msg?.name ?? '?';
      const body = msg?.msg ?? msg;
      const isRelevant = name.includes('option') || name.includes('position') ||
                         name.includes('profit') || name.includes('balance') ||
                         name.includes('socket') || name.includes('changed') ||
                         JSON.stringify(body).includes('profit') ||
                         JSON.stringify(body).includes('current_price');
      if (isRelevant) {
        const str = JSON.stringify(body).slice(0, 300);
        console.log(`[${name}] ${str}`);
      }
    });

    setTimeout(async () => {
      try {
        const init = await ws.getInitializationData();
        const data = init?.msg ?? init;
        console.log('\n[INIT] Usando turbo actives...');

        // Pega o primeiro ativo OTC disponível
        const actives = data?.turbo?.actives ?? data?.binary?.actives ?? {};
        const otcActives = Object.entries(actives)
          .filter(([, a]) => a?.Name?.includes('OTC'))
          .map(([id, a]) => ({ id: Number(id), name: a.Name }))
          .slice(0, 3);
        console.log('OTC ativos disponíveis:', otcActives.map(a => `${a.id}:${a.name}`).join(', '));

        const balData = await ws.getBalances();
        const balances = balData?.result ?? [];
        console.log('\n[💰] Balances:');
        for (const b of balances) {
          console.log(`  id=${b.id} type=${b.type} ${b.currency} R$${b.amount}`);
        }

        // Usa o primeiro ativo OTC com um balance que tenha saldo
        const balance = balances.find(b => Number(b.amount) > 0);
        if (!balance) {
          console.log('[❌] Nenhum balance com saldo > 0');
          // Usa o primeiro balance disponível
          const b = balances[0];
          console.log(`[⚠️] Usando balance id=${b.id} type=${b.type} R$${b.amount} mesmo assim`);
          return;
        }
        console.log(`[💰] Usando balance id=${balance.id} ${balance.currency} R$${balance.amount}`);

        const activeId = otcActives[0]?.id;
        if (!activeId) { console.log('[❌] Sem ativo OTC'); return; }

        console.log(`\n[📍] Abrindo CALL R$2 em ${otcActives[0].name}...`);
        const reqId = ws.placeOrder({
          price: 2,
          activeId,
          direction: 'CALL',
          expiration: 60,
          optionTypeId: 3,
          balanceId: balance.id,
        });
        console.log(`[📍] Request ID: ${reqId}`);

        console.log('[...] Aguardando profit via WS...');
      } catch (e) {
        console.error('[❌]', e.message);
      }
    }, 5000);
  });

  ws.on('error', e => console.error('[WS ERR]', e.message));

  await ws.connect({ ssid, timeoutMs: 30000 });
  setTimeout(() => {
    console.log('[⏹] Fim do teste');
    ws.close();
    process.exit(0);
  }, 120000);
}

main().catch(e => { console.error(e.message); process.exit(1); });
