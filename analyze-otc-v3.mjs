/**
 * ANALISADOR DE PADRÕES OTC - v3 (corrigido)
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join('D:', 'Tracecom project', 'diagnostic-results', 'data', 'iq-otc');

// Listar arquivos
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

console.log(`Arquivos encontrados: ${files.length}`);

function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return {
      from: new Date(values[0]),
      open: parseFloat(values[2]),
      high: parseFloat(values[3]),
      low: parseFloat(values[4]),
      close: parseFloat(values[5])
    };
  });
}

function analyzeFile(filepath) {
  const candles = parseCSV(filepath);
  if (candles.length < 50) return null;

  const name = path.basename(filepath);
  const results = {
    name,
    totalCandles: candles.length,
    upCandles: 0, downCandles: 0,
    maxConsecutiveUp: 0, maxConsecutiveDown: 0,
    // Fade3: contra 3 velas
    fade3: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
    // Follow3: a favor de 3 velas
    follow3: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
    // RSI(2) Extreme
    rsi2: { callTrades: 0, callWins: 0, putTrades: 0, putWins: 0 },
    byHour: {}
  };

  let currentConsecUp = 0, currentConsecDown = 0;
  let maxConsecUp = 0, maxConsecDown = 0;

  for (let i = 4; i < candles.length - 1; i++) {
    const isUp = candles[i].close > candles[i].open;
    const dir = isUp ? 1 : -1;

    // Contagem básica
    if (isUp) results.upCandles++;
    else results.downCandles++;

    // Consecutivas
    if (dir === 1) {
      currentConsecUp++;
      currentConsecDown = 0;
      maxConsecUp = Math.max(maxConsecUp, currentConsecUp);
    } else {
      currentConsecDown++;
      currentConsecUp = 0;
      maxConsecDown = Math.max(maxConsecDown, currentConsecDown);
    }

    // Hora
    const hour = candles[i].from.getUTCHours();
    if (!results.byHour[hour]) results.byHour[hour] = { up: 0, down: 0 };
    if (isUp) results.byHour[hour].up++;
    else results.byHour[hour].down++;

    // Verificar as 3 ANTERIORES
    const prev1Up = candles[i-1].close > candles[i-1].open;
    const prev2Up = candles[i-2].close > candles[i-2].open;
    const prev3Up = candles[i-3].close > candles[i-3].open;

    // FADE3: 3 velas para cima + reversão → PUT
    if (prev1Up && prev2Up && prev3Up && !isUp) {
      results.fade3.putTrades++;
      if (i + 1 < candles.length && candles[i+1].close < candles[i+1].open) {
        results.fade3.putWins++;
      }
    }

    // FADE3: 3 velas para baixo + reversão → CALL
    if (!prev1Up && !prev2Up && !prev3Up && isUp) {
      results.fade3.callTrades++;
      if (i + 1 < candles.length && candles[i+1].close > candles[i+1].open) {
        results.fade3.callWins++;
      }
    }

    // FOLLOW3: 3 velas para cima + continua → CALL
    if (prev1Up && prev2Up && prev3Up && isUp) {
      results.follow3.callTrades++;
      if (i + 1 < candles.length && candles[i+1].close > candles[i+1].open) {
        results.follow3.callWins++;
      }
    }

    // FOLLOW3: 3 velas para baixo + continua → PUT
    if (!prev1Up && !prev2Up && !prev3Up && !isUp) {
      results.follow3.putTrades++;
      if (i + 1 < candles.length && candles[i+1].close < candles[i+1].open) {
        results.follow3.putWins++;
      }
    }

    // RSI(2)
    if (i >= 3) {
      const closes = candles.slice(Math.max(0, i - 2), i + 1).map(c => c.close);
      if (closes.length >= 3) {
        let avgGain = 0, avgLoss = 0;
        for (let j = 1; j < closes.length; j++) {
          const diff = closes[j] - closes[j-1];
          if (diff > 0) avgGain += diff;
          else avgLoss += Math.abs(diff);
        }
        avgGain /= 2;
        avgLoss /= 2;
        const rsi2 = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        if (rsi2 < 15) {
          results.rsi2.callTrades++;
          if (isUp) results.rsi2.callWins++;
        }
        if (rsi2 > 85) {
          results.rsi2.putTrades++;
          if (!isUp) results.rsi2.putWins++;
        }
      }
    }
  }

  results.maxConsecutiveUp = maxConsecUp;
  results.maxConsecutiveDown = maxConsecDown;

  return results;
}

// Executar análise
const allResults = [];
for (const file of files) {
  try {
    const result = analyzeFile(file);
    if (result) allResults.push(result);
  } catch (e) {
    console.log(`Erro em ${file}: ${e.message}`);
  }
}

console.log(`Resultados processados: ${allResults.length}\n`);

// Agregados
const totals = {
  fade3: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
  follow3: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
  rsi2: { callTrades: 0, callWins: 0, putTrades: 0, putWins: 0 }
};

let totalUp = 0, totalDown = 0;

for (const r of allResults) {
  totalUp += r.upCandles;
  totalDown += r.downCandles;
  totals.fade3.putTrades += r.fade3.putTrades;
  totals.fade3.putWins += r.fade3.putWins;
  totals.fade3.callTrades += r.fade3.callTrades;
  totals.fade3.callWins += r.fade3.callWins;
  totals.follow3.putTrades += r.follow3.putTrades;
  totals.follow3.putWins += r.follow3.putWins;
  totals.follow3.callTrades += r.follow3.callTrades;
  totals.follow3.callWins += r.follow3.callWins;
  totals.rsi2.callTrades += r.rsi2.callTrades;
  totals.rsi2.callWins += r.rsi2.callWins;
  totals.rsi2.putTrades += r.rsi2.putTrades;
  totals.rsi2.putWins += r.rsi2.putWins;
}

console.log('='.repeat(65));
console.log('📊 ANÁLISE DE PADRÕES OTC - 17 horas de dados');
console.log('='.repeat(65));

console.log(`\n📈 ESTATÍSTICAS GERAIS:`);
console.log(`   Total de velas: ${totalUp + totalDown}`);
console.log(`   UP: ${totalUp} (${((totalUp/(totalUp+totalDown))*100).toFixed(1)}%)`);
console.log(`   DOWN: ${totalDown} (${((totalDown/(totalUp+totalDown))*100).toFixed(1)}%)`);

function printStrategy(name, trades, wins) {
  if (trades < 5) {
    console.log(`\n${name}: ${trades} trades (amostra insuficiente)`);
    return;
  }
  const wr = (wins / trades * 100).toFixed(1);
  const edge = (wins / trades - 0.5) * 100;
  console.log(`\n${name}:`);
  console.log(`   Trades: ${trades} | Wins: ${wins} | WR: ${wr}%`);
  console.log(`   Edge: ${edge > 0 ? '+' : ''}${edge.toFixed(1)}%`);
  if (edge > 2) {
    console.log(`   ✅ EXPLOTÁVEL!`);
  } else if (edge < -2) {
    console.log(`   ❌ CONTRA-PRODUCRENTE (tente o oposto)`);
  } else {
    console.log(`   ⚖️ NEUTRO`);
  }
}

console.log(`\n${'─'.repeat(65)}`);
console.log('🎯 ESTRATÉGIAS:');
console.log('─'.repeat(65));

// Fade3 PUT
printStrategy('FADE3 PUT (contra 3↑ → PUT)', totals.fade3.putTrades, totals.fade3.putWins);
// Fade3 CALL
printStrategy('FADE3 CALL (contra 3↓ → CALL)', totals.fade3.callTrades, totals.fade3.callWins);
// Follow3 CALL
printStrategy('FOLLOW3 CALL (3↑ → CALL)', totals.follow3.callTrades, totals.follow3.callWins);
// Follow3 PUT
printStrategy('FOLLOW3 PUT (3↓ → PUT)', totals.follow3.putTrades, totals.follow3.putWins);
// RSI2
const rsi2Total = totals.rsi2.callTrades + totals.rsi2.putTrades;
const rsi2Wins = totals.rsi2.callWins + totals.rsi2.putWins;
printStrategy('RSI(2) EXTREME', rsi2Total, rsi2Wins);

console.log(`\n${'─'.repeat(65)}`);
console.log('📋 POR ATIVO (Fade3):');
console.log('─'.repeat(65));

for (const r of allResults) {
  const putTotal = r.fade3.putTrades;
  const callTotal = r.fade3.callTrades;
  if (putTotal + callTotal > 5) {
    const putWr = putTotal > 0 ? (r.fade3.putWins / putTotal * 100).toFixed(0) : '-';
    const callWr = callTotal > 0 ? (r.fade3.callWins / callTotal * 100).toFixed(0) : '-';
    console.log(`${r.name}: PUT ${putWr}% (${putTotal}), CALL ${callWr}% (${callTotal})`);
  }
}

console.log(`\n${'='.repeat(65)}`);
console.log('💡 CONCLUSÃO:');
console.log('='.repeat(65));

// Melhor estratégia
const best = [
  { name: 'FADE3 PUT', trades: totals.fade3.putTrades, wins: totals.fade3.putWins },
  { name: 'FADE3 CALL', trades: totals.fade3.callTrades, wins: totals.fade3.callWins },
  { name: 'FOLLOW3 CALL', trades: totals.follow3.callTrades, wins: totals.follow3.callWins },
  { name: 'FOLLOW3 PUT', trades: totals.follow3.putTrades, wins: totals.follow3.putWins },
  { name: 'RSI2', trades: rsi2Total, wins: rsi2Wins }
].filter(s => s.trades >= 5)
 .sort((a, b) => {
   const edgeA = Math.abs((a.wins / a.trades - 0.5) * 100);
   const edgeB = Math.abs((b.wins / b.trades - 0.5) * 100);
   return edgeB - edgeA;
 })[0];

if (best) {
  const edge = ((best.wins / best.trades) - 0.5) * 100;
  console.log(`\nMelhor estratégia: ${best.name}`);
  console.log(`   WR: ${(best.wins / best.trades * 100).toFixed(1)}%`);
  console.log(`   Edge: ${edge > 0 ? '+' : ''}${edge.toFixed(1)}%`);

  if (edge > 2) {
    console.log(`\n✅ ${best.name} É EXPLOTÁVEL!`);
  } else if (edge < -2) {
    console.log(`\n❌ Oposto de ${best.name} é explotável!`);
  } else {
    console.log(`\n⚠️ Edge não significativo (precisa de mais dados)`);
  }
}
