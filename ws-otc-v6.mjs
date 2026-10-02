/**
 * OTC BOT v6 - PROBABILISTIC MULTI-ENTRY (PME)
 * =============================================
 *
 * PRESERVADO DO v5:
 * - Estratégia Fade3
 * - 5 ativos validados
 * - Regras de entrada
 *
 * NOVO: Sistema PME
 * - R$2 por operação
 * - Máximo 3 entradas por ativo
 * - Análise probabilística contínua
 * - Sem Martingale/Soros
 */
import https from 'https';
import fs from 'fs';
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

const EMAIL = 'Anaalaura2008@gmail.com';
const PASSWORD = 'Eqvpanp.32';

// ========== CONFIGURAÇÕES PME ==========
const PME = {
  enabled: true,
  maxEntries: 3,           // Máximo 3 entradas por ativo
  minEntry: 2,              // R$2 por operação
  maxExposurePerAsset: 6,   // R$6 por ativo (3 x R$2)
  minProbability: 50,       // Probabilidade mínima para entrada (%)
  recalcInterval: 1000,    // Recalcular a cada 1s
};

const EXPIRATION = 1; // 1 minuto

const VALIDATED_ASSETS = [
  { names: ['SEIUSD', 'Sei'], direction: 'PUT', wr: 62.7, edge: 12.7 },
  { names: ['USDHKD', 'USD-HKD'], direction: 'CALL', wr: 57.4, edge: 7.4 },
  { names: ['LTCUSD', 'Litecoin'], direction: 'PUT', wr: 56.6, edge: 6.6 },
  { names: ['DOTUSD', 'Polkadot'], direction: 'PUT', wr: 55.5, edge: 5.5 },
  { names: ['USDZAR', 'USD-ZAR'], direction: 'PUT', wr: 55.1, edge: 5.1 },
];

// ========== ESTADO GLOBAL ==========
const candleBuffer = new Map();
const activePositions = new Map(); // aid → { entries: [], pattern, asset }
const resultados = [];
let balanceId = null;
let warmupEndTime = null;
let serverNow = null;

// ========== ESTRATÉGIA FADE3 (PRESERVADA) ==========
function getValidatedPattern(assetName) {
  for (const va of VALIDATED_ASSETS) {
    for (const name of va.names) {
      if (assetName.toUpperCase().includes(name.toUpperCase())) {
        return va;
      }
    }
  }
  return null;
}

function getSignal(candles, assetName) {
  if (!candles || candles.length < 5) return null;

  const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
  if (closes.length < 5) return null;

  const validated = getValidatedPattern(assetName);
  if (!validated) return null;

  const a = closes[closes.length - 1] > closes[closes.length - 2];
  const b = closes[closes.length - 2] > closes[closes.length - 3];
  const c = closes[closes.length - 3] > closes[closes.length - 4];

  if (a && b && c && validated.direction === 'PUT') {
    return { signal: 'PUT', strategy: 'FADE3', expected: validated.wr, edge: validated.edge };
  }
  if (!a && !b && !c && validated.direction === 'CALL') {
    return { signal: 'CALL', strategy: 'FADE3', expected: validated.wr, edge: validated.edge };
  }
  return null;
}

// ========== MOTOR PROBABILÍSTICO ==========
function calculateProbability(candles, direction, assetName) {
  // Usar WR histórico como base
  const validated = getValidatedPattern(assetName);
  if (!validated) return 50;

  let baseProb = validated.wr;

  if (candles && candles.length >= 10) {
    const closes = candles.map(c => c.close).filter(v => typeof v === 'number' && isFinite(v));
    if (closes.length >= 10) {
      // Volatilidade
      const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
      const variance = closes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / closes.length;
      const volatility = Math.sqrt(variance) / mean * 100;

      // Força da tendência atual
      const last3 = closes.slice(-3);
      const trendStrength = last3.every(c => c > last3[0]) ? 1 : last3.every(c => c < last3[0]) ? -1 : 0;

      // Ajustar por volatilidade
      if (volatility > 1) baseProb -= (volatility - 1) * 2;
      else if (volatility < 0.5) baseProb += (0.5 - volatility) * 5;

      // Ajustar por força da tendência (contra tendência = melhor)
      if (trendStrength === 1 && direction === 'PUT') baseProb += 5;
      if (trendStrength === -1 && direction === 'CALL') baseProb += 5;
    }
  }

  return Math.max(40, Math.min(85, baseProb));
}

function evaluateEntry(candles, direction, position, existingEntries, assetName) {
  if (!PME.enabled) return { approved: false, reason: 'PME desabilitado' };

  const entries = existingEntries || [];
  if (entries.length >= PME.maxEntries) {
    return { approved: false, reason: `Máximo de ${PME.maxEntries} entradas atingido` };
  }

  // Calcular exposição total
  const totalExposure = entries.reduce((s, e) => s + e.price, 0) + PME.minEntry;
  if (totalExposure > PME.maxExposurePerAsset) {
    return { approved: false, reason: 'Limite de exposição atingido' };
  }

  // Calcular probabilidade atual usando WR histórico como base
  const probability = calculateProbability(candles, direction, assetName);

  if (probability < PME.minProbability) {
    return { approved: false, reason: `Probabilidade ${probability.toFixed(1)}% < mínimo ${PME.minProbability}%` };
  }

  // Verificar correlação com entradas existentes
  const sameDirection = entries.filter(e => e.direction === direction).length;
  const oppositeDirection = entries.length - sameDirection;

  // Se já tem entradas na mesma direção, aumentar confiança necessária
  if (sameDirection > 0 && probability < PME.minProbability + 5) {
    return { approved: false, reason: `Correlação: já tem ${sameDirection} entrada(s) na mesma direção` };
  }

  // Se tem entradas na direção oposta, não entrar
  if (oppositeDirection > 0) {
    return { approved: false, reason: 'Direção conflitante com posição aberta' };
  }

  // Calcular retorno esperado
  const payout = 0.82; // 82% típico
  const expectedReturn = (probability / 100) * payout - ((100 - probability) / 100);

  if (expectedReturn < 0) {
    return { approved: false, reason: `Retorno esperado negativo: ${(expectedReturn * 100).toFixed(1)}%` };
  }

  return {
    approved: true,
    probability,
    expectedReturn,
    reason: `Prob: ${probability.toFixed(1)}%, Retorno: ${(expectedReturn * 100).toFixed(1)}%`,
    entryNumber: entries.length + 1
  };
}

// ========== CONTROLE DE RISCO ==========
function getTotalExposure() {
  let total = 0;
  for (const [, pos] of activePositions) {
    total += pos.entries.reduce((s, e) => s + e.price, 0);
  }
  return total;
}

function getAssetExposure(aid) {
  const pos = activePositions.get(aid);
  if (!pos) return 0;
  return pos.entries.reduce((s, e) => s + e.price, 0);
}

// ========== COMUNICAÇÃO HTTP ==========
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
  const ssid = json.result?.ssid ?? json.ssid;
  if (!ssid) throw new Error('Login falhou');
  return ssid;
}

// ========== MOTOR PRINCIPAL ==========
async function main() {
  try {
    const ssid = await login();
    console.log('[LOGIN] OK!\n');

    const ws = new IqWsClient({
      log: () => {},
      onHeartbeat: (ts) => { serverNow = ts; }
    });

    ws.on('ready', async () => {
      console.log('[WS] Ready!');

      const balMsg = await ws.getBalances();
      const balData = balMsg?.msg ?? balMsg;
      const balances = [...(Array.isArray(balData) ? balData : [])].sort((a, b) => b.amount - a.amount);
      const conta = balances.find(b => b.type === 4) || balances[0];

      if (!conta || conta.amount <= 0) {
        console.error('[ERRO] Sem saldo'); ws.close(); return;
      }

      balanceId = conta.id;
      console.log(`[💼 CONTA] DEMO | Saldo: R$${conta.amount.toFixed(2)}\n`);

      const initMsg = await ws.getInitializationData();
      const initData = initMsg?.msg ?? initMsg;
      const turboActives = initData?.turbo?.actives ?? {};

      console.log('='.repeat(60));
      console.log('📊 BOT v6 - PME (Probabilistic Multi-Entry)');
      console.log('='.repeat(60));
      console.log('\n⚙️ CONFIGURAÇÕES PME:');
      console.log(`   Entradas máx: ${PME.maxEntries}`);
      console.log(`   Valor/op: R$${PME.minEntry}`);
      console.log(`   Exposição máx/ativo: R$${PME.maxExposurePerAsset}`);
      console.log(`   Probabilidade mín: ${PME.minProbability}%`);

      console.log('\n📋 Ativos validados:');
      for (const va of VALIDATED_ASSETS) {
        console.log(`   ${va.names[0].padEnd(15)} → ${va.direction.padEnd(4)} (WR: ${va.wr}%)`);
      }

      const allAssets = Object.entries(turboActives)
        .filter(([_, a]) => a.name && /otc/i.test(a.name))
        .map(([id, act]) => ({ activeId: Number(id), name: act.name }));

      let foundCount = 0;
      for (const asset of allAssets) {
        const pattern = getValidatedPattern(asset.name);
        if (pattern) {
          candleBuffer.set(asset.activeId, { candles: [], asset, pattern });
          activePositions.set(asset.activeId, { entries: [], pattern, asset, lastSignal: null });
          ws.subscribeCandles(asset.activeId, 60);
          foundCount++;
          console.log(`[✅] ${asset.name} → ${pattern.direction}`);
        }
      }

      console.log(`\n[📋] ${foundCount}/5 ativos encontrados`);
      console.log('[⏳] Warmup 60s...\n');

      await new Promise(r => setTimeout(r, 60_000));
      warmupEndTime = Date.now();
      console.log('[✅] INICIADO! PME ativo.\n');

      // Loop de análise contínua
      setInterval(() => {
        if (!warmupEndTime || Date.now() < warmupEndTime) return;
        analyzeAllAssets();

        // Status periódico
        let totalCandles = 0;
        for (const [aid, buf] of candleBuffer) {
          totalCandles += buf.candles.length;
        }
        if (totalCandles === 0) {
          console.log('[⚠️] ATENÇÃO: Nenhum candle recebido após warmup!');
        }
      }, PME.recalcInterval);
    });

    ws.on('candle-generated', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId ?? raw.id ?? raw.aid;
      if (!aid || !candleBuffer.has(aid)) return;

      const buf = candleBuffer.get(aid);
      try {
        const c = normalizeCandle(raw, { activeId: aid, serverTimestamp: ws?.serverNow(), connectionId: ws?.connectionId });
        const idx = buf.candles.findIndex(x => x.segmentId === c.segmentId);
        if (idx >= 0) buf.candles[idx] = c;
        else buf.candles.push(c);
        if (buf.candles.length > 100) buf.candles.shift();

        // Log periódico de candles
        if (!buf._lastLog || Date.now() - buf._lastLog > 10000) {
          console.log(`[📊 ${buf.asset.name}] ${buf.candles.length} candles | último: ${c.close}`);
          buf._lastLog = Date.now();
        }

        // Debug: mostrar candles e detecção
        if (warmupEndTime && Date.now() >= warmupEndTime && buf.candles.length >= 5) {
          const closes = buf.candles.slice(-5).map(x => x.close);
          const a = closes[4] > closes[3];
          const b = closes[3] > closes[2];
          const cc = closes[2] > closes[1];
          const validated = getValidatedPattern(buf.asset.name);
          if (validated) {
            const expectedDir = validated.direction;
            const wouldSignal = (a && b && cc && expectedDir === 'PUT') || (!a && !b && !cc && expectedDir === 'CALL');
            if (wouldSignal) {
              console.log(`[🔍] ${buf.asset.name}: 3 velas detectadas para ${expectedDir}`);
            }
          }
        }
      } catch (e) {
        console.log(`[ERRO] candle: ${e.message}`);
        return;
      }

      // Verificar sinais imediatamente ao receber candle
      if (warmupEndTime && Date.now() >= warmupEndTime) {
        const pos = activePositions.get(aid);
        if (pos && pos.entries.length < PME.maxEntries) {
          const result = getSignal(buf.candles, buf.asset.name);
          if (result) {
            const sameDir = pos.entries.filter(e => e.direction === result.signal);
            if (sameDir.length === 0) {
              const evaluation = evaluateEntry(buf.candles, result.signal, pos, pos.entries, buf.asset.name);
              console.log(`[🎯] ${buf.asset.name}: Sinal ${result.signal} | Avaliação: ${evaluation.approved ? 'APROVADO' : 'REPROVADO - ' + evaluation.reason}`);
              if (evaluation.approved) {
                placePMEEntry(ws, aid, result.signal, evaluation);
              }
            }
          }
        }
      }
    });

    // Função de análise contínua
    function analyzeAllAssets() {
      for (const [aid, buf] of candleBuffer) {
        const pos = activePositions.get(aid);
        if (!pos || pos.entries.length >= PME.maxEntries) continue;

        const result = getSignal(buf.candles, buf.asset.name);
        if (!result) continue;

        // Verificar se já tem entrada nessa direção
        const sameDir = pos.entries.filter(e => e.direction === result.signal);
        if (sameDir.length > 0) continue;

        // Avaliar probabilisticamente
        const evaluation = evaluateEntry(buf.candles, result.signal, pos, pos.entries, buf.asset.name);

        if (evaluation.approved) {
          placePMEEntry(ws, aid, result.signal, evaluation);
        } else if (result.signal !== pos.entries[0]?.direction) {
          // Sinal novo, verificar se pode entrar
          const newEval = evaluateEntry(buf.candles, result.signal, pos, [], buf.asset.name);
          if (newEval.approved) {
            placePMEEntry(ws, aid, result.signal, newEval);
          }
        }
      }
    }

    async function placePMEEntry(ws, aid, direction, evaluation) {
      const pos = activePositions.get(aid);
      if (!pos) return;
      if (pos.entries.length >= PME.maxEntries) return;

      const { expiration, optionTypeId } = computeExpiration(
        Math.floor((ws.serverNow() ?? Date.now()) / 1000),
        EXPIRATION
      );

      const entry = {
        price: PME.minEntry,
        direction,
        expiration,
        expected: evaluation.probability,
        openedAt: Date.now(),
        entryNumber: pos.entries.length + 1
      };

      ws.placeOrder({
        price: PME.minEntry,
        activeId: aid,
        direction,
        expiration,
        optionTypeId,
        balanceId
      });

      pos.entries.push(entry);

      const entryWord = evaluation.entryNumber > 1 ? ` (${evaluation.entryNumber}ª entrada)` : '';
      console.log(`[📊 PME${entryWord}] ${pos.asset.name} ${direction} | R$${PME.minEntry} | ${evaluation.reason}`);

      resultados.push({
        active: pos.asset.name,
        direction,
        price: PME.minEntry,
        entryNumber: entry.entryNumber,
        expected: evaluation.probability,
        timestamp: new Date().toISOString()
      });
    }

    ws.on('socket-option-closed', (msg) => {
      const raw = msg?.msg ?? msg;
      if (!raw) return;

      const aid = raw.active_id ?? raw.activeId;
      const pos = activePositions.get(aid);
      if (!pos) return;

      const profit = raw.profit ?? 0;
      const result = profit > 0 ? 'win' : 'loss';
      const emoji = result === 'win' ? '✅' : '❌';

      // Encontrar a entrada correspondente
      const entry = pos.entries.find(e =>
        e.direction === (raw.direction === 'call' ? 'CALL' : 'PUT') &&
        Math.abs(e.openedAt - (raw.open_time * 1000)) < 120000
      );

      if (entry) {
        console.log(`[${emoji}] ${pos.asset.name} | ${entry.direction} | Entrada ${entry.entryNumber} | ${profit > 0 ? '+' : ''}R$${profit.toFixed(2)}`);

        // Atualizar resultado
        const res = resultados.find(r =>
          r.active === pos.asset.name &&
          !r.result &&
          r.direction === entry.direction
        );
        if (res) {
          res.result = result;
          res.profit = profit;
        }

        // Remover entrada fechada
        pos.entries = pos.entries.filter(e => e !== entry);
        fs.writeFileSync('D:/Tracecom project/resultados-v6.json', JSON.stringify(resultados, null, 2));
      }

      // Estatísticas
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      const exposure = getTotalExposure();

      if (total > 0) {
        const wr = ((wins / total) * 100).toFixed(1);
        const profitTotal = resultados.reduce((s, r) => s + (r.profit || 0), 0);
        console.log(`[📈] Total: ${total} | WR: ${wr}% | Lucro: R$${profitTotal.toFixed(2)} | Exposição: R$${exposure.toFixed(2)}\n`);
      }
    });

    await ws.connect({ ssid });

    while (true) {
      await new Promise(r => setTimeout(r, 5000));
      const wins = resultados.filter(r => r.result === 'win').length;
      const total = resultados.filter(r => r.result).length;
      const exposure = getTotalExposure();

      if (total > 0) {
        process.stdout.write(`\r[⏱️ ${new Date().toLocaleTimeString()}] Ops: ${total} | WR: ${((wins/total)*100).toFixed(0)}% | Expo: R$${exposure.toFixed(2)}   `);
      }
    }

  } catch (err) {
    console.error('[FATAL]', err);
    process.exit(1);
  }
}

// Handler de encerramento
process.on('SIGINT', () => {
  console.log('\n\n🛑 RESULTADO FINAL:\n');

  const wins = resultados.filter(r => r.result === 'win').length;
  const total = resultados.filter(r => r.result).length;
  const profitTotal = resultados.reduce((s, r) => s + (r.profit || 0), 0);
  const invested = resultados.reduce((s, r) => s + (r.price || PME.minEntry), 0);

  console.log('='.repeat(60));
  console.log('📊 RESULTADO PME');
  console.log('='.repeat(60));
  console.log(`\n📈 Geral:`);
  console.log(`   Operações: ${total}`);
  console.log(`   Vitórias: ${wins}`);
  console.log(`   Win Rate: ${total > 0 ? ((wins/total)*100).toFixed(1) : 0}%`);
  console.log(`   Lucro: R$${profitTotal.toFixed(2)}`);
  console.log(`   Investido: R$${invested.toFixed(2)}`);
  console.log(`   ROI: ${invested > 0 ? ((profitTotal/invested)*100).toFixed(1) : 0}%`);

  // Por ativo
  console.log(`\n📋 Por ativo:`);
  const byActive = {};
  for (const r of resultados.filter(r => r.result)) {
    if (!byActive[r.active]) byActive[r.active] = { wins: 0, total: 0, profit: 0, entries: 0 };
    byActive[r.active].total++;
    byActive[r.active].entries++;
    if (r.result === 'win') byActive[r.active].wins++;
    byActive[r.active].profit += r.profit || 0;
  }
  for (const [name, stats] of Object.entries(byActive)) {
    const wr = (stats.wins/stats.total*100).toFixed(0);
    console.log(`   ${name}: ${stats.wins}/${stats.total} (${wr}%) | R$${stats.profit.toFixed(2)}`);
  }

  // Por número de entrada
  console.log(`\n📋 Por posição no ciclo:`);
  const byEntry = {};
  for (const r of resultados.filter(r => r.result)) {
    const n = r.entryNumber || 1;
    if (!byEntry[n]) byEntry[n] = { wins: 0, total: 0 };
    byEntry[n].total++;
    if (r.result === 'win') byEntry[n].wins++;
  }
  for (const [n, stats] of Object.entries(byEntry).sort((a,b) => a[0]-b[0])) {
    const wr = (stats.wins/stats.total*100).toFixed(0);
    console.log(`   ${n}ª entrada: ${stats.wins}/${stats.total} (${wr}%)`);
  }

  fs.writeFileSync('D:/Tracecom project/resultados-v6-final.json', JSON.stringify(resultados, null, 2));
  console.log('\n💾 Salvo em: resultados-v6-final.json');
  process.exit(0);
});

main();
