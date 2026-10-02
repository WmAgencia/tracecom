// Teste: conecta WS + loga TUDO que vem, focado em encontrar o evento de option close
// Para testar: abra uma opção na IQ Option manualmente e espere o evento
import { IqWsClient } from './iqoption-ws.mjs';
import https from 'https';

function httpReq(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = ''; res.on('data', d => body += d);
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
  const j = JSON.parse(loginRes.body);
  const ssid = j.ssid ?? j.result?.ssid;
  console.log('Login OK, SSID:', ssid?.slice(0, 8) + '...');

  const ws = new IqWsClient({ log: () => {} });

  // Hook no emit doIqWsClient para ver todos os eventos
  const origEmit = IqWsClient.prototype.emit;
  IqWsClient.prototype.emit = function(name, data) {
    // Só loga eventos "importantes" (não timeSync/heartbeat)
    if (!['timeSync','heartbeat','message'].includes(name)) {
      console.log(`[EVENTO] ${name}`);
      if (data) console.log('  payload:', JSON.stringify(data).slice(0, 500));
    }
    return origEmit.call(this, name, data);
  };

  ws.on('ready', () => {
    console.log('\n[✅] WS Ready!');
    console.log('[...] Deixe uma opção aberta na IQ Option para ver os eventos...');
    console.log('[...] Ou clique em "Abrir" para ver o evento de order\n');
  });

  await ws.connect({ ssid, timeoutMs: 30000 });

  // Mostra mensagem a cada 20s para lembrar o usuário
  setInterval(() => {
    console.log('[💡] Mantenha uma opção aberta na IQ Option — espere o evento...');
  }, 20000);

  setTimeout(() => {
    console.log('[FIM]');
    ws.close();
    process.exit(0);
  }, 300000); // 5 min
}

main().catch(e => { console.error(e.message); process.exit(1); });
