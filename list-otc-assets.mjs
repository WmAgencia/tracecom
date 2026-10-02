/**
 * LISTAR ATIVOS OTC DISPONÍVEIS
 */
import https from 'https';

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
  const json = JSON.parse(res.body);
  return json.result?.ssid ?? json.ssid;
}

async function main() {
  const ssid = await login();
  console.log('Login OK\n');

  // Buscar initialization data
  const res = await httpRequest({
    hostname: 'iqoption.com', path: '/api/ initializationData', method: 'GET',
    headers: { 'Cookie': `ssid=${ssid}`, 'Accept': 'application/json' }
  });

  // Ou usar WS para pegar os nomes
  const { IqWsClient } = await import('./iqoption-ws.mjs');
  const ws = new IqWsClient({ log: console.log });

  ws.on('ready', async () => {
    const initMsg = await ws.getInitializationData();
    const initData = initMsg?.msg ?? initMsg;
    const turboActives = initData?.turbo?.actives ?? {};

    console.log('📋 ATIVOS OTC DISPONÍVEIS:\n');

    const otcAssets = Object.entries(turboActives)
      .filter(([_, a]) => a.name && /otc/i.test(a.name))
      .sort((a, b) => a[1].name.localeCompare(b[1].name));

    for (const [id, act] of otcAssets) {
      console.log(`ID: ${id.padEnd(6)} | ${act.name}`);
    }

    console.log(`\nTotal: ${otcAssets.length} ativos OTC`);

    ws.close();
    process.exit(0);
  });

  await ws.connect({ ssid });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
