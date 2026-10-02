// Script para descobrir todos os OTCs disponíveis na IQ Option via WS
import https from 'https';
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
  const ws = new IqWsClient({ log: () => {} });

  ws.on('ready', async () => {
    console.log('[WS] Pronto');

    try {
      const initData = await ws.getInitializationData();
      console.log('[📡] Initialization data recebida');

      const msg = initData?.msg ?? initData;

      // Verificar estrutura
      console.log('\n[DEBUG] Estrutura:');
      console.log('- turbo keys:', Object.keys(msg?.turbo ?? {}).slice(0, 5));
      console.log('- binary keys:', Object.keys(msg?.binary ?? {}).slice(0, 5));

      // Buscar em todas as seções
      const otcMap = new Map();

      function searchOTC(obj, section) {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
          if (!v || typeof v !== 'object') continue;
          const name = v.name ?? '';
          // OTCs podem ter nomes como "USD-HKD-OTC" ou estar em keys com "OTC"
          if (name.includes('OTC') || String(k).includes('OTC')) {
            const cleanName = name.replace('front.', '').replace('-OTC', '');
            if (cleanName && !otcMap.has(cleanName)) {
              otcMap.set(cleanName, {
                name,
                id: Number(k),
                section
              });
            }
          }
          // Busca recursiva
          if (section !== 'turbo' && section !== 'binary') {
            searchOTC(v, section);
          }
        }
      }

      // Buscar em todas as seções
      for (const section of Object.keys(msg)) {
        searchOTC(msg[section], section);
      }

      console.log(`\n\n📊 ATIVOS OTC ENCONTRADOS: ${otcMap.size}\n`);
      console.log('═'.repeat(70));
      console.log('ID       | Nome'.padEnd(45) + '| Seção');
      console.log('─'.repeat(70));

      for (const [cleanName, info] of otcMap) {
        console.log(`${String(info.id).padStart(8)} | ${cleanName.padEnd(45)} | ${info.section}`);
      }

      // Gerar código config
      console.log('\n\n📋 CÓDIGO PARA BOT v14:\n');
      console.log('const OTC_WHITELIST = [');
      for (const [cleanName, info] of otcMap) {
        console.log(`  { key: '${cleanName}', name: '${info.name}', id: ${info.id} },`);
      }
      console.log('];');

      ws.close();
      process.exit(0);

    } catch (e) {
      console.error('[❌] Erro:', e.message);
      ws.close();
      process.exit(1);
    }
  });

  await ws.connect({ ssid, timeoutMs: 20000 });
}

main().catch(e => { console.error(e.message); process.exit(1); });
