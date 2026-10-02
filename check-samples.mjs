/**
 * Verificar amostra exata por ativo
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join('D:', 'Tracecom project', 'diagnostic-results', 'data', 'iq-otc');

function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.trim().split('\n');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return {
      from: new Date(values[0]),
      open: parseFloat(values[2]),
      close: parseFloat(values[5])
    };
  });
}

const turboPath = path.join(DATA_DIR, 'turbo-options');
const binaryPath = path.join(DATA_DIR, 'binary-options');

const files = [];
if (fs.existsSync(turboPath)) {
  files.push(...fs.readdirSync(turboPath)
    .filter(f => f.endsWith('_60s.csv'))
    .map(f => path.join(turboPath, f)));
}
if (fs.existsSync(binaryPath)) {
  files.push(...fs.readdirSync(binaryPath)
    .filter(f => f.endsWith('_60s.csv'))
    .map(f => path.join(binaryPath, f)));
}

function analyzeFile(filepath) {
  const candles = parseCSV(filepath);
  if (candles.length < 50) return null;

  const name = path.basename(filepath, '.csv');
  let fade3PutTrades = 0, fade3PutWins = 0;
  let fade3CallTrades = 0, fade3CallWins = 0;

  for (let i = 4; i < candles.length - 1; i++) {
    const isUp = candles[i].close > candles[i].open;

    const prev1Up = candles[i-1].close > candles[i-1].open;
    const prev2Up = candles[i-2].close > candles[i-2].open;
    const prev3Up = candles[i-3].close > candles[i-3].open;

    // FADE3: 3 velas para cima + reversão → PUT
    if (prev1Up && prev2Up && prev3Up && !isUp) {
      fade3PutTrades++;
      if (i + 1 < candles.length && candles[i+1].close < candles[i+1].open) {
        fade3PutWins++;
      }
    }

    // FADE3: 3 velas para baixo + reversão → CALL
    if (!prev1Up && !prev2Up && !prev3Up && isUp) {
      fade3CallTrades++;
      if (i + 1 < candles.length && candles[i+1].close > candles[i+1].open) {
        fade3CallWins++;
      }
    }
  }

  return { name, candles: candles.length, fade3PutTrades, fade3PutWins, fade3CallTrades, fade3CallWins };
}

const results = files.map(f => analyzeFile(f)).filter(Boolean);

// Ordenar por WR de PUT
console.log('='.repeat(70));
console.log('📊 DETALHE POR ATIVO - FADE3');
console.log('='.repeat(70));

// PUTs
console.log('\n📉 FADE3 PUT (contra 3↑ → PUT):');
console.log('-'.repeat(70));
results
  .filter(r => r.fade3PutTrades >= 20)
  .sort((a, b) => (b.fade3PutWins/b.fade3PutTrades) - (a.fade3PutWins/a.fade3PutTrades))
  .forEach(r => {
    const wr = (r.fade3PutWins / r.fade3PutTrades * 100).toFixed(1);
    const edge = ((r.fade3PutWins / r.fade3PutTrades) - 0.5) * 100;
    console.log(`${r.name.padEnd(35)} | ${r.fade3PutTrades} trades | WR: ${wr.padStart(5)}% | Edge: ${edge > 0 ? '+' : ''}${edge.toFixed(1)}%`);
  });

// CALLs
console.log('\n📈 FADE3 CALL (contra 3↓ → CALL):');
console.log('-'.repeat(70));
results
  .filter(r => r.fade3CallTrades >= 20)
  .sort((a, b) => (b.fade3CallWins/b.fade3CallTrades) - (a.fade3CallWins/a.fade3CallTrades))
  .forEach(r => {
    const wr = (r.fade3CallWins / r.fade3CallTrades * 100).toFixed(1);
    const edge = ((r.fade3CallWins / r.fade3CallTrades) - 0.5) * 100;
    console.log(`${r.name.padEnd(35)} | ${r.fade3CallTrades} trades | WR: ${wr.padStart(5)}% | Edge: ${edge > 0 ? '+' : ''}${edge.toFixed(1)}%`);
  });

console.log('\n' + '='.repeat(70));
console.log('⚠️ FILTRO: Apenas ativos com >= 20 trades de sinal');
console.log('💡 Para ser estatisticamente significativo, recomendo >= 100 trades');
