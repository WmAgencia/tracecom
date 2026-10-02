/**
 * ANÁLISE COMPLETA DE DADOS OTC
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join('D:', 'Tracecom project', 'diagnostic-results', 'data', 'iq-otc');
const OUTPUT_FILE = path.join('D:', 'Tracecom project', 'analise-otc-completa.json');

function parseCSV(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).map(line => {
      const values = line.split(',');
      if (values.length < 6) return null;
      return { timestamp: new Date(values[0]), close: parseFloat(values[5]), open: parseFloat(values[2]) };
    }).filter(Boolean);
  } catch (e) { return []; }
}

function analyzeAsset(candles, name) {
  if (candles.length < 50) return null;

  const result = { name, totalCandles: candles.length, fade3Put: { trades: 0, wins: 0 }, fade3Call: { trades: 0, wins: 0 } };

  for (let i = 3; i < candles.length - 1; i++) {
    const getDir = (idx) => candles[idx].close > candles[idx].open ? 1 : -1;
    const d1 = getDir(i-1), d2 = getDir(i-2), d3 = getDir(i-3);
    const nextDir = getDir(i);

    // Fade3 PUT: 3↑ → reversão para baixo
    if (d1 === 1 && d2 === 1 && d3 === 1) {
      result.fade3Put.trades++;
      if (nextDir === -1) result.fade3Put.wins++;
    }

    // Fade3 CALL: 3↓ → reversão para cima
    if (d1 === -1 && d2 === -1 && d3 === -1) {
      result.fade3Call.trades++;
      if (nextDir === 1) result.fade3Call.wins++;
    }
  }
  return result;
}

console.log('📊 ANÁLISE COMPLETA DE DADOS OTC\n');
console.log('='.repeat(80));

const dirs = ['turbo-options', 'binary-options'];
const allResults = [];
let totalFiles = 0, totalCandles = 0;

for (const dir of dirs) {
  const dirPath = path.join(DATA_DIR, dir);
  if (!fs.existsSync(dirPath)) continue;
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('_60s.csv'));

  for (const file of files) {
    const filepath = path.join(dirPath, file);
    const candles = parseCSV(filepath);
    const name = file.replace('--OTC-_60s.csv', '');
    const analysis = analyzeAsset(candles, name);
    if (analysis && analysis.totalCandles >= 50) {
      totalFiles++; totalCandles += candles.length;
      allResults.push(analysis);
    }
  }
}

console.log(`📁 Arquivos analisados: ${totalFiles}`);
console.log(`📊 Velas processadas: ${totalCandles.toLocaleString()}\n`);

// Função para calcular edge
function calcEdge(r, type) {
  const d = type === 'PUT' ? r.fade3Put : r.fade3Call;
  if (!d || d.trades < 50) return -999;
  return (d.wins / d.trades * 100) - 50;
}

// TOP PUTs
console.log('='.repeat(80));
console.log('📉 TOP 10 - FADE3 PUT (contra 3↑) - Mínimo 50 trades');
console.log('='.repeat(80));
console.log('Ativo'.padEnd(22) + 'Trades'.padStart(8) + 'Wins'.padStart(8) + 'WR%'.padStart(8) + 'Edge%'.padStart(10) + ' Status');
console.log('-'.repeat(80));

const topPUT = allResults.filter(r => r.fade3Put.trades >= 50).sort((a, b) => calcEdge(b, 'PUT') - calcEdge(a, 'PUT')).slice(0, 10);
topPUT.forEach(r => {
  const wr = (r.fade3Put.wins / r.fade3Put.trades * 100);
  const edge = wr - 50;
  const status = edge > 5 ? '✅ EXPLORÁVEL' : edge > 0 ? '⚠️ MARGINAL' : '❌ PREJUÍZO';
  console.log(r.name.padEnd(22) + r.fade3Put.trades.toString().padStart(8) + r.fade3Put.wins.toString().padStart(8) + wr.toFixed(1).padStart(8) + (edge >= 0 ? '+' : '') + edge.toFixed(1).padStart(9) + ' ' + status);
});

// TOP CALLs
console.log('\n' + '='.repeat(80));
console.log('📈 TOP 10 - FADE3 CALL (contra 3↓) - Mínimo 50 trades');
console.log('='.repeat(80));
console.log('Ativo'.padEnd(22) + 'Trades'.padStart(8) + 'Wins'.padStart(8) + 'WR%'.padStart(8) + 'Edge%'.padStart(10) + ' Status');
console.log('-'.repeat(80));

const topCALL = allResults.filter(r => r.fade3Call.trades >= 50).sort((a, b) => calcEdge(b, 'CALL') - calcEdge(a, 'CALL')).slice(0, 10);
topCALL.forEach(r => {
  const wr = (r.fade3Call.wins / r.fade3Call.trades * 100);
  const edge = wr - 50;
  const status = edge > 5 ? '✅ EXPLORÁVEL' : edge > 0 ? '⚠️ MARGINAL' : '❌ PREJUÍZO';
  console.log(r.name.padEnd(22) + r.fade3Call.trades.toString().padStart(8) + r.fade3Call.wins.toString().padStart(8) + wr.toFixed(1).padStart(8) + (edge >= 0 ? '+' : '') + edge.toFixed(1).padStart(9) + ' ' + status);
});

// Comparação 60s vs 300s
console.log('\n' + '='.repeat(80));
console.log('🔍 COMPARAÇÃO TIMEFRAMES (60s vs 300s)');
console.log('='.repeat(80));

const comparisons = [];
for (const r of allResults) {
  const otherPath = path.join(DATA_DIR, dirs.find(d => d !== 'turbo-options'), r.name + '--OTC-_300s.csv');
  if (fs.existsSync(otherPath)) {
    const other = analyzeAsset(parseCSV(otherPath), r.name);
    if (other && other.fade3Put.trades >= 20) {
      comparisons.push({
        name: r.name,
        wr60s: (r.fade3Put.wins / r.fade3Put.trades * 100).toFixed(1),
        n60s: r.fade3Put.trades,
        wr300s: (other.fade3Put.wins / other.fade3Put.trades * 100).toFixed(1),
        n300s: other.fade3Put.trades
      });
    }
  }
}

console.log('\nFADE3 PUT:\n');
console.log('Ativo'.padEnd(20) + '60s WR'.padStart(10) + '60s n'.padStart(8) + '300s WR'.padStart(10) + '300s n'.padStart(8) + 'Melhor');
console.log('-'.repeat(80));
comparisons.forEach(c => {
  const best = parseFloat(c.wr60s) > parseFloat(c.wr300s) ? '60s ⭐' : '300s ⭐';
  console.log(c.name.padEnd(20) + c.wr60s.padStart(10) + c.n60s.toString().padStart(8) + c.wr300s.padStart(10) + c.n300s.toString().padStart(8) + ' ' + best);
});

// Ativos explotáveis
console.log('\n' + '='.repeat(80));
console.log('🎯 ATIVOS EXPLOTÁVEIS (Edge > 5%)');
console.log('='.repeat(80));

const exploitable = allResults
  .filter(r => {
    const putEdge = (r.fade3Put.wins / r.fade3Put.trades * 100) - 50;
    const callEdge = (r.fade3Call.wins / r.fade3Call.trades * 100) - 50;
    return (r.fade3Put.trades >= 50 && putEdge > 5) || (r.fade3Call.trades >= 50 && callEdge > 5);
  })
  .map(r => {
    const putEdge = (r.fade3Put.wins / r.fade3Put.trades * 100) - 50;
    const callEdge = (r.fade3Call.wins / r.fade3Call.trades * 100) - 50;
    return { name: r.name, putEdge, callEdge, putTrades: r.fade3Put.trades, callTrades: r.fade3Call.trades };
  })
  .sort((a, b) => Math.max(a.putEdge, a.callEdge) - Math.max(b.putEdge, b.callEdge));

if (exploitable.length === 0) {
  console.log('\n❌ Nenhum ativo com edge > 5%.\n');
} else {
  exploitable.forEach(e => {
    console.log('\n📌 ' + e.name);
    if (e.putEdge > 5) console.log('   PUT:  Edge +' + e.putEdge.toFixed(1) + '% (' + e.putTrades + ' trades) ✅');
    if (e.callEdge > 5) console.log('   CALL: Edge +' + e.callEdge.toFixed(1) + '% (' + e.callTrades + ' trades) ✅');
  });
}

// Salvar JSON
const jsonOutput = {
  generatedAt: new Date().toISOString(),
  totalFiles, totalCandles,
  bestPUTs: topPUT.map(r => ({ name: r.name, trades: r.fade3Put.trades, wins: r.fade3Put.wins, wr: ((r.fade3Put.wins/r.fade3Put.trades)*100).toFixed(1), edge: (((r.fade3Put.wins/r.fade3Put.trades)*100 - 50)).toFixed(1) })),
  bestCALLs: topCALL.map(r => ({ name: r.name, trades: r.fade3Call.trades, wins: r.fade3Call.wins, wr: ((r.fade3Call.wins/r.fade3Call.trades)*100).toFixed(1), edge: (((r.fade3Call.wins/r.fade3Call.trades)*100 - 50)).toFixed(1) })),
  exploitable: exploitable.map(e => ({ name: e.name, putEdge: e.putEdge.toFixed(1), callEdge: e.callEdge.toFixed(1) }))
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jsonOutput, null, 2));
console.log('\n\n💾 Salvo em: ' + OUTPUT_FILE);
