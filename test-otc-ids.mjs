// Teste simples: descobrir IDs corretos para ativos OTC
import https from 'https';
import fs from 'fs';
import CONFIG from './bot-config-v13.json' with { type: 'json' };
import { IqWsClient } from './iqoption-ws.mjs';

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

async function login() {
  const data = JSON.stringify({ identifier: CONFIG.login.email, password: CONFIG.login.password });
  const res = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' },
  }, data);
  const j = JSON.parse(res.body);
  return j.ssid ?? j.result?.ssid;
}

async function main() {
  console.log('🔐 Fazendo login...');
  const ssid = await login();
  console.log('✅ Logado!');

  console.log('🔌 Conectando WebSocket...');
  const ws = new IqWsClient({ log: (m) => console.log('[WS]', m) });

  // Captura todos os eventos
  ws.on('candle-generated', (msg) => {
    console.log('[CANDLE!]', JSON.stringify(msg).slice(0, 200));
  });

  await ws.connect({ ssid, timeoutMs: 20000 });
  console.log('✅ Conectado!');

  // Tenta obter initialization data para ver todos os ativos
  console.log('Buscando initialization data...');
  try {
    const initData = await ws.getInitializationData();
    console.log('Init data keys:', Object.keys(initData));

    // Procura símbolos OTC
    if (initData.msg) {
      const msg = initData.msg;
      if (msg.actives) {
        // Filtra apenas OTC
        const otcActives = {};
        for (const [key, val] of Object.entries(msg.actives)) {
          if (key.includes('OTC') || key.includes('otc')) {
            otcActives[key] = val;
          }
        }
        console.log(`\n📊 Ativos OTC encontrados: ${Object.keys(otcActives).length}`);
        for (const [key, val] of Object.entries(otcActives).slice(0, 15)) {
          console.log(`  ${key}: name=${val.name}, id=${val.id}`);
        }
      }
    }
  } catch (e) {
    console.log('Erro ao buscar init data:', e.message);
  }

  // Tenta subscribe com diferentes formatos
  console.log('\n🔍 Testando subscriptions...');

  const testFormats = [
    'front.RENDERUSD-OTC',
    'RENDERUSD-OTC',
    'RENDERUSD',
    7,  // ID numérico comum
  ];

  for (const id of testFormats) {
    console.log(`\nTestando: ${id}`);
    ws.send("subscribeMessage", {
      name: "candle-generated",
      params: { routingFilters: { active_id: String(id), size: 5 } }
    });
  }

  // Aguarda 10 segundos para ver se chega algum candle
  console.log('\n⏳ Aguardando candles por 10s...');
  await new Promise(r => setTimeout(r, 10000));

  ws.close();
  console.log('Fim do teste');
}

main().catch(e => { console.error(e.message); process.exit(1); });
