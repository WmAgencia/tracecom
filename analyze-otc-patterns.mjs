/**
 * ANALISADOR DE PADRÕES OTC
 * ==========================
 * Analisa dados históricos do MCP para encontrar padrões explotáveis
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'D:/Tracecom project/diagnostic-results/data/iq-otc';

// Arquivos disponíveis
const files = [
  // Turbo options OTC
  'turbo-options/USD-ZAR--OTC-_60s.csv',
  'turbo-options/ETH-USD--OTC-_60s.csv',
  'turbo-options/SOL-USD--OTC-_60s.csv',
  'turbo-options/Ripple--OTC-_60s.csv',
  // Binary options OTC
  'binary-options/Cosmos--OTC-_60s.csv',
  'binary-options/Pepe--OTC-_60s.csv',
  'binary-options/Polkadot--OTC-_60s.csv',
];

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    header.forEach((col, i) => obj[col] = values[i]);
    return {
      from: new Date(obj.from),
      to: new Date(obj.to),
      open: parseFloat(obj.open),
      high: parseFloat(obj.high),
      low: parseFloat(obj.low),
      close: parseFloat(obj.close)
    };
  });
}

// RSI(14) Wilder
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;
  if (avgLoss === 0) return 100;
  let rsi = 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function analyzeFile(filepath) {
  const content = fs.readFileSync(path.join(DATA_DIR, filepath), 'utf8');
  const candles = parseCSV(content);
  if (candles.length < 50) return null;

  const name = path.basename(filepath, '.csv');
  const closes = candles.map(c => c.close);
  const results = {
    name,
    totalCandles: candles.length,
    dateRange: `${candles[0].from.toISOString().slice(0,16)} - ${candles[candles.length-1].from.toISOString().slice(0,16)}`,

    // Análise básica
    upCandles: 0, downCandles: 0,
    maxConsecutiveUp: 0, maxConsecutiveDown: 0,

    // Padrões de reversão
    reversalAfterN: { up: {}, down: {} },

    // RSI stats
    rsiValues: [],

    // Análise por hora
    byHour: {}
  };

  let consec = 0;
  let lastDir = null;
  let currentConsecUp = 0, currentConsecDown = 0;
  let maxConsecUp = 0, maxConsecDown = 0;

  for (let i = 1; i < candles.length; i++) {
    const dir = candles[i].close > candles[i].open ? 'up' : 'down';
    const prevDir = candles[i-1].close > candles[i-1].open ? 'up' : 'down';

    // Contagem básica
    if (dir === 'up') results.upCandles++;
    else results.downCandles++;

    // Máximas consecutivas
    if (dir === 'up') {
      currentConsecUp++;
      currentConsecDown = 0;
      maxConsecUp = Math.max(maxConsecUp, currentConsecUp);
    } else {
      currentConsecDown++;
      currentConsecUp = 0;
      maxConsecDown = Math.max(maxConsecDown, currentConsecDown);
    }

    // Reversão após N velas de alta (fade3)
    if (prevDir === 'up' && dir === 'down') {
      // Reversão para baixo após alta
      const n = Math.min(currentConsecUp, 5);
      if (!results.reversalAfterN.up[n]) results.reversalAfterN.up[n] = { reversions: 0, total: 0 };
      // Próxima vela?
      if (i + 1 < candles.length) {
        results.reversalAfterN.up[n].total++;
        if (candles[i+1].close < candles[i+1].open) results.reversalAfterN.up[n].reversions++;
      }
    }

    // Reversão após N velas de baixa
    if (prevDir === 'down' && dir === 'up') {
      const n = Math.min(currentConsecDown, 5);
      if (!results.reversalAfterN.down[n]) results.reversalAfterN.down[n] = { reversions: 0, total: 0 };
      if (i + 1 < candles.length) {
        results.reversalAfterN.down[n].total++;
        if (candles[i+1].close > candles[i+1].open) results.reversalAfterN.down[n].reversions++;
      }
    }

    // RSI
    if (i >= 14) {
      const rsi = calcRSI(closes.slice(0, i + 1));
      if (rsi !== null) results.rsiValues.push(rsi);
    }

    // Por hora
    const hour = candles[i].from.getUTCHours();
    if (!results.byHour[hour]) results.byHour[hour] = { up: 0, down: 0, total: 0 };
    results.byHour[hour].total++;
    if (dir === 'up') results.byHour[hour].up++;
    else results.byHour[hour].down++;
  }

  results.maxConsecutiveUp = maxConsecUp;
  results.maxConsecutiveDown = maxConsecDown;

  // RSI stats
  if (results.rsiValues.length > 0) {
    results.rsiAvg = results.rsiValues.reduce((a, b) => a + b, 0) / results.rsiValues.length;
    results.rsiMin = Math.min(...results.rsiValues);
    results.rsiMax = Math.max(...results.rsiValues);
    // Quantas vezes RSI < 30 ou > 70
    results.rsiOversold = results.rsiValues.filter(r => r < 30).length;
    results.rsiOverbought = results.rsiValues.filter(r => r > 70).length;
  }

  return results;
}

console.log('='.repeat(60));
console.log('📊 ANÁLISE DE PADRÕES OTC');
console.log('='.repeat(60));
console.log('');

const allResults = [];
for (const file of files) {
  try {
    const result = analyzeFile(file);
    if (result) allResults.push(result);
  } catch (e) {
    console.log(`❌ Erro em ${file}: ${e.message}`);
  }
}

console.log(`\n📈 RESULTADOS POR ATIVO:\n`);

for (const r of allResults) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 ${r.name}`);
  console.log(`   Período: ${r.dateRange}`);
  console.log(`   Velas: ${r.totalCandles}`);
  console.log(`   UP: ${r.upCandles} | DOWN: ${r.downCandles} | Ratio: ${(r.upCandles/r.downCandles).toFixed(2)}`);
  console.log(`   Máx. consec. UP: ${r.maxConsecutiveUp} | DOWN: ${r.maxConsecutiveDown}`);

  if (r.rsiAvg !== undefined) {
    console.log(`\n   📉 RSI Stats:`);
    console.log(`      Média: ${r.rsiAvg.toFixed(1)} | Min: ${r.rsiMin.toFixed(1)} | Max: ${r.rsiMax.toFixed(1)}`);
    console.log(`      Oversold (<30): ${r.rsiOversold} | Overbought (>70): ${r.rsiOverbought}`);
  }

  // Reversões após N velas
  const hasReversions = Object.keys(r.reversalAfterN.up).length > 0 || Object.keys(r.reversalAfterN.down).length > 0;
  if (hasReversions) {
    console.log(`\n   🔄 Reversão (fade contra N velas):`);

    for (const n of [2, 3, 4, 5]) {
      const upStats = r.reversalAfterN.up[n];
      const downStats = r.reversalAfterN.down[n];

      if (upStats && upStats.total > 0) {
        const rate = (upStats.reversions / upStats.total * 100).toFixed(1);
        const edge = (upStats.reversions / upStats.total - 0.5) * 100;
        console.log(`      ${n}↑ → reversão para baixo: ${rate}% (n=${upStats.total}, edge=${edge > 0 ? '+' : ''}${edge.toFixed(1)}%)`);
      }

      if (downStats && downStats.total > 0) {
        const rate = (downStats.reversions / downStats.total * 100).toFixed(1);
        const edge = (downStats.reversions / downStats.total - 0.5) * 100;
        console.log(`      ${n}↓ → reversão para cima: ${rate}% (n=${downStats.total}, edge=${edge > 0 ? '+' : ''}${edge.toFixed(1)}%)`);
      }
    }
  }
}

// Análise agregada
console.log(`\n${'='.repeat(60)}`);
console.log('📊 ANÁLISE AGREGADA');
console.log('='.repeat(60));

// Vencedor de reversão
let totalReversionsUp = 0, totalReversionsDown = 0;
let totalUpConsec = 0, totalDownConsec = 0;

for (const r of allResults) {
  for (const n of [2, 3, 4, 5]) {
    if (r.reversalAfterN.up[n]) {
      totalUpConsec += r.reversalAfterN.up[n].total;
      totalReversionsUp += r.reversalAfterN.up[n].reversions;
    }
    if (r.reversalAfterN.down[n]) {
      totalDownConsec += r.reversalAfterN.down[n].total;
      totalReversionsDown += r.reversalAfterN.down[n].reversions;
    }
  }
}

if (totalUpConsec > 0) {
  const upRate = (totalReversionsUp / totalUpConsec * 100).toFixed(1);
  const upEdge = (totalReversionsUp / totalUpConsec - 0.5) * 100;
  console.log(`\n🎯 Fade3 (contra 3 velas de alta → PUT):`);
  console.log(`   Total samples: ${totalUpConsec}`);
  console.log(`   Taxa de acerto: ${upRate}%`);
  console.log(`   Edge: ${upEdge > 0 ? '+' : ''}${upEdge.toFixed(1)}%`);
  console.log(`   ${upEdge > 2 ? '✅ EXPLOTÁVEL!' : upEdge < -2 ? '❌ CONTRA-INDICADO' : '⚠️ NEUTRO'}`);
}

if (totalDownConsec > 0) {
  const downRate = (totalReversionsDown / totalDownConsec * 100).toFixed(1);
  const downEdge = (totalReversionsDown / totalDownConsec - 0.5) * 100;
  console.log(`\n🎯 Fade3 (contra 3 velas de baixa → CALL):`);
  console.log(`   Total samples: ${totalDownConsec}`);
  console.log(`   Taxa de acerto: ${downRate}%`);
  console.log(`   Edge: ${downEdge > 0 ? '+' : ''}${downEdge.toFixed(1)}%`);
  console.log(`   ${downEdge > 2 ? '✅ EXPLOTÁVEL!' : downEdge < -2 ? '❌ CONTRA-INDICADO' : '⚠️ NEUTRO'}`);
}

// Análise de horário
console.log(`\n🕐 PADRÕES POR HORA (UTC):`);
const hourStats = {};
for (const r of allResults) {
  for (const [hour, stats] of Object.entries(r.byHour)) {
    if (!hourStats[hour]) hourStats[hour] = { up: 0, down: 0 };
    hourStats[hour].up += stats.up;
    hourStats[hour].down += stats.down;
  }
}

const hours = Object.keys(hourStats).sort((a, b) => parseInt(a) - parseInt(b));
for (const hour of hours) {
  const stats = hourStats[hour];
  const total = stats.up + stats.down;
  if (total >= 20) {
    const upRate = (stats.up / total * 100).toFixed(0);
    const edge = (stats.up / total - 0.5) * 100;
    const flag = edge > 2 ? '📈' : edge < -2 ? '📉' : '⚖️';
    console.log(`   ${hour}h: ${stats.up}↑ / ${stats.down}↓ (${upRate}% UP) edge: ${edge > 0 ? '+' : ''}${edge.toFixed(1)}% ${flag}`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log('💡 RECOMENDAÇÕES:');
console.log('='.repeat(60));

// Veredicto
if (totalUpConsec > 50 || totalDownConsec > 50) {
  const avgEdge = totalUpConsec > totalDownConsec
    ? (totalReversionsUp / totalUpConsec - 0.5) * 100
    : (totalReversionsDown / totalDownConsec - 0.5) * 100;

  if (avgEdge > 2) {
    console.log(`\n✅ Fade3 é EXPLOTÁVEL no OTC!`);
    console.log(`   Edge médio: ${avgEdge > 0 ? '+' : ''}${avgEdge.toFixed(1)}%`);
    console.log(`   Recomendação: OPERAR contra 3 velas consecutivas`);
    console.log(`\n   Com payout de 90%:`);
    console.log(`   - Kelly criterion: ${(2 * avgEdge / 100).toFixed(1)}% do bankroll`);
    console.log(`   - Esperança matemática: ${(avgEdge/100 * 0.9 - (100-avgEdge)/100).toFixed(3)} por trade`);
  } else if (avgEdge < -2) {
    console.log(`\n❌ Fade3 é CONTRA-PRODUCRENTE no OTC!`);
    console.log(`   O algoritmo FAZ 3 velas consecutivas deliberadamente.`);
    console.log(`   Recomendação: OPERAR A FAVOR das 3 velas (com o trend)`);
  } else {
    console.log(`\n⚠️ Fade3 é NEUTRO no OTC.`);
    console.log(`   Padrão é aleatório - sem edge detectável.`);
  }
} else {
  console.log(`\n⚠️ Dados insuficientes para conclusão definitiva.`);
  console.log(`   Amostras: ${totalUpConsec + totalDownConsec}`);
  console.log(`   Coletar mais dados é recomendado.`);
}
