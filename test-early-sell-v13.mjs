// Teste: login + early sell API — verifica campos corretos
// Uso: node test-early-sell-v13.mjs

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
  const API_HOST  = 'iqoption.com';

  // ── Login ──
  console.log('[1] Login...');
  const loginData = JSON.stringify({
    identifier: 'Anaalaura2008@gmail.com',
    password: 'Eqvpanp.32',
  });
  const loginRes = await httpReq({
    hostname: AUTH_HOST, path: '/v2/login', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginData),
      'Origin': 'https://iqoption.com',
      'Referer': 'https://iqoption.com/',
    },
  }, loginData);

  let ssid;
  try {
    const j = JSON.parse(loginRes.body);
    ssid = j.result?.ssid ?? j.ssid;
  } catch { ssid = null; }
  if (!ssid) {
    console.error('[❌] Login falhou:', loginRes.body.slice(0, 300));
    process.exit(1);
  }
  console.log('[✅] Login OK, SSID:', ssid.slice(0, 15) + '...');

  // ── Active Options ──
  console.log('[2] Buscando /api/options/active...');
  const activeRes = await httpReq({
    hostname: API_HOST, path: '/api/options/active', method: 'GET',
    headers: { 'Authorization': `Bearer ${ssid}`, 'Origin': 'https://iqoption.com' },
  });
  console.log('[raw]', activeRes.body.slice(0, 800));

  let parsed;
  try { parsed = JSON.parse(activeRes.body); } catch { parsed = {}; }
  const options = parsed?.result ?? parsed?.data ?? parsed?.msg ?? [];
  console.log(`\n[3] ${options.length} opção(ões) ativa(s)`);

  if (options.length === 0) {
    console.log('\n⚠️  Nenhuma opção ativa.');
    console.log('   Abra uma operação manual na IQ Option para testar.');
    process.exit(0);
  }

  console.log('\n── Primeira opção: campos ──');
  const opt = options[0];
  console.log('Keys:', Object.keys(opt));
  for (const [k, v] of Object.entries(opt)) {
    if (typeof v === 'object') console.log(`  ${k}: ${JSON.stringify(v)}`);
    else console.log(`  ${k}: ${v}`);
  }

  // Qual campo usar para lucro?
  const profitField = opt.profit ?? opt.current_profit ?? opt.close_profit ?? opt.price ?? opt.current_price;
  const idField = opt.id ?? opt.option_id ?? opt.optionId;
  console.log(`\n── Early Sell: profitField = ${profitField}, idField = ${idField}`);

  if (profitField !== undefined && profitField !== null && idField) {
    console.log(`\n✅ Campo "profit" encontrado: ${profitField}`);
    console.log(`   Se profit ≥ 0.15 → vende! Current: ${profitField >= 0.15 ? 'SIM ✅' : 'não'}`);
  } else {
    console.log('\n❌ profit não encontrado. Campos disponíveis:', Object.keys(opt));
  }
}

main().catch(e => { console.error('[ERRO]', e.message); process.exit(1); });
