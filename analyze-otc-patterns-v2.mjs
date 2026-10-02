/**
 * ANALISADOR DE PADRÕES OTC - v2
 * Analisa dados históricos do MCP para encontrar padrões explotáveis
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = 'D:/Tracecom project/diagnostic-results/data/iq-otc';

// Todos os arquivos OTC
const files = fs.readdirSync(path.join(DATA_DIR, 'turbo-options'))
  .filter(f => f.endsWith('_60s.csv'))
  .map(f => `turbo-options/${f}`)
  .concat(
    fs.readdirSync(path.join(DATA_DIR, 'binary-options'))
      .filter(f => f.endsWith('_60s.csv'))
      .map(f => `binary-options/${f}`)
  );

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    header.forEach((col, i) => obj[col] = values[i]);
    return {
      from: new Date(obj.from),
      open: parseFloat(obj.open),
      high: parseFloat(obj.high),
      low: parseFloat(obj.low),
      close: parseFloat(obj.close)
    };
  });
}

function analyzeFile(filepath) {
  const content = fs.readFileSync(path.join(DATA_DIR, filepath), 'utf8');
  const candles = parseCSV(content);
  if (candles.length < 50) return null;

  const name = path.basename(filepath, '.csv');
  const closes = candles.map(c => c.close);
  const opens = candles.map(c => c.open);
  const results = {
    name,
    totalCandles: candles.length,
    dateRange: `${candles[0].from.toISOString().slice(0,16)}Z - ${candles[candles.length-1].from.toISOString().slice(0,16)}Z`,
    upCandles: 0, downCandles: 0,
    maxConsecutiveUp: 0, maxConsecutiveDown: 0,
    // Fade3: 3 velas para cima = PUT, 3 velas para baixo = CALL
    fade3: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
    // Fade4
    fade4: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
    // Fade5
    fade5: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
    // Follow3: a favor de 3 velas
    follow3: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
    // RSI extremes
    rsiExtreme: { rsi2: { callTrades: 0, callWins: 0, putTrades: 0, putWins: 0 } },
    // Por hora
    byHour: {}
  };

  let currentConsecUp = 0, currentConsecDown = 0;
  let maxConsecUp = 0, maxConsecDown = 0;

  for (let i = 4; i < candles.length - 1; i++) {
    // Direção da vela atual
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

    // Verificar se as 3 ANTERIORES eram todas para cima
    const prev1Up = candles[i-1].close > candles[i-1].open;
    const prev2Up = candles[i-2].close > candles[i-2].open;
    const prev3Up = candles[i-3].close > candles[i-3].open;

    // FADE3: 3 velas para cima → PUT (contra)
    if (prev1Up && prev2Up && prev3Up && !isUp) {
      results.fade3.putTrades++;
      // Próxima vela (i+1) determina se ganhou
      if (i + 1 < candles.length) {
        if (candles[i+1].close < candles[i+1].open) {
          results.fade3.putWins++;
        }
      }
    }

    // FADE3: 3 velas para baixo → CALL (contra)
    if (!prev1Up && !prev2Up && !prev3Up && isUp) {
      results.fade3.callTrades++;
      if (i + 1 < candles.length) {
        if (candles[i+1].close > candles[i+1].open) {
          results.fade3.callWins++;
        }
      }
    }

    // FADE4
    if (i >= 5) {
      const prev4Up = candles[i-4].close > candles[i-4].open;
      if (prev1Up && prev2Up && prev3Up && prev4Up && !isUp) {
        results.fade4.putTrades++;
        if (i + 1 < candles.length) {
          if (candles[i+1].close < candles[i+1].open) results.fade4.putWins++;
        }
      }
      if (!prev1Up && !prev2Up && !prev3Up && !prev4Up && isUp) {
        results.fade4.callTrades++;
        if (i + 1 < candles.length) {
          if (candles[i+1].close > candles[i+1].open) results.fade4.callWins++;
        }
      }
    }

    // FADE5
    if (i >= 6) {
      const prev5Up = candles[i-5].close > candles[i-5].open;
      if (prev1Up && prev2Up && prev3Up && prev4Up && prev5Up && !isUp) {
        results.fade5.putTrades++;
        if (i + 1 < candles.length) {
          if (candles[i+1].close < candles[i+1].open) results.fade5.putWins++;
        }
      }
      if (!prev1Up && !prev2Up && !prev3Up && !prev4Up && !prev5Up && isUp) {
        results.fade5.callTrades++;
        if (i + 1 < candles.length) {
          if (candles[i+1].close > candles[i+1].open) results.fade5.callWins++;
        }
      }
    }

    // FOLLOW3: a favor das 3 velas
    if (prev1Up && prev2Up && prev3Up && isUp) {
      results.follow3.callTrades++;
      if (i + 1 < candles.length) {
        if (candles[i+1].close > candles[i+1].open) results.follow3.callWins++;
      }
    }
    if (!prev1Up && !prev2Up && !prev3Up && !isUp) {
      results.follow3.putTrades++;
      if (i + 1 < candles.length) {
        if (candles[i+1].close < candles[i+1].open) results.follow3.putWins++;
      }
    }

    // RSI(2) Extreme - muito mais responsivo
    if (i >= 3) {
      const recentCloses = closes.slice(Math.max(0, i - 3), i + 1);
      if (recentCloses.length >= 3) {
        let avgGain = 0, avgLoss = 0;
        for (let j = 1; j < recentCloses.length; j++) {
          const diff = recentCloses[j] - recentCloses[j-1];
          if (diff > 0) avgGain += diff;
          else avgLoss += Math.abs(diff);
        }
        avgGain /= 2;
        avgLoss /= 2;
        const rsi2 = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        if (rsi2 < 15) {
          results.rsiExtreme.rsi2.callTrades++;
          if (isUp) results.rsiExtreme.rsi2.callWins++;
        }
        if (rsi2 > 85) {
          results.rsiExtreme.rsi2.putTrades++;
          if (!isUp) results.rsiExtreme.rsi2.putWins++;
        }
      }
    }
  }

  results.maxConsecutiveUp = maxConsecUp;
  results.maxConsecutiveDown = maxConsecDown;

  return results;
}

console.log('='.repeat(65));
console.log('📊 ANÁLISE DE PADRÕES OTC - 17 horas de dados');
console.log('='.repeat(65));
console.log(`Arquivos analisados: ${files.length}\n`);

const allResults = [];
for (const file of files) {
  try {
    const result = analyzeFile(file);
    if (result) allResults.push(result);
  } catch (e) {
    // Skip
  }
}

// Agregados
const totals = {
  fade3: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
  fade4: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
  fade5: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
  follow3: { putTrades: 0, putWins: 0, callTrades: 0, callWins: 0 },
  rsi2: { callTrades: 0, callWins: 0, putTrades: 0, putWins: 0 }
};

let totalUp = 0, totalDown = 0;

for (const r of allResults) {
  totalUp += r.upCandles;
  totalDown += r.downCandles;
  for (const key of ['fade3', 'fade4', 'fade5', 'follow3']) {
    totals[key].putTrades += r[key].putTrades;
    totals[key].putWins += r[key].putWins;
    totals[key].callTrades += r[key].callTrades;
    totals[key].callWins += r[key].callWins;
  }
  totals.rsi2.callTrades += r.rsiExtreme.rsi2.callTrades;
  totals.rsi2.callWins += r.rsiExtreme.rsi2.callWins;
  totals.rsi2.putTrades += r.rsiExtreme.rsi2.putTrades;
  totals.rsi2.putWins += r.rsiExtreme.rsi2.putWins;
}

console.log(`\n📈 ESTATÍSTICAS GERAIS:`);
console.log(`   Total de velas: ${totalUp + totalDown}`);
console.log(`   UP: ${totalUp} (${(totalUp/(totalUp+totalDown)*100).toFixed(1)}%)`);
console.log(`   DOWN: ${totalDown} (${(totalDown/(totalUp+totalDown)*100).toFixed(1)}%)`);
console.log(`   Ratio: ${(totalUp/totalDown).toFixed(3)}`);

console.log(`\n${'─'.repeat(65)}`);
console.log('🎯 ESTRATÉGIAS TESTADAS:');
console.log('─'.repeat(65));

function printStrategy(name, trades, wins, direction) {
  if (trades < 10) {
    console.log(`\n${name}: Amostras insuficientes (${trades})`);
    return;
  }
  const wr = (wins / trades * 100).toFixed(1);
  const edge = (wins / trades - 0.5) * 100;
  const payout = 0.90;
  const expected = edge / 100 * payout - (100 - wins) / trades * 1;
  console.log(`\n${name}:`);
  console.log(`   Trades: ${trades} | Wins: ${wins} | WR: ${wr}%`);
  console.log(`   Edge: ${edge > 0 ? '+' : ''}${edge.toFixed(1)}%`);
  console.log(`   Esperança (payout 90%): ${expected > 0 ? '+' : ''}${expected.toFixed(4)}`);

  if (edge > 2 && expected > 0) {
    console.log(`   ✅ EXPLOTÁVEL!`);
  } else if (edge < -2) {
    console.log(`   ❌ CONTRA-PRODUCRENTE`);
    console.log(`   💡 Tente o oposto: operar A FAVOR das velas`);
  } else {
    console.log(`   ⚖️ NEUTRO - sem edge detectável`);
  }
}

// FADE3
const fade3Total = totals.fade3.putTrades + totals.fade3.callTrades;
const fade3Wins = totals.fade3.putWins + totals.fade3.callWins;
printStrategy('FADE3 (contra 3 velas)', fade3Total, fade3Wins, 'both');

// Detalhe
if (totals.fade3.putTrades > 5) {
  printStrategy('  → FADE3 PUT (contra 3↑ → PUT)', totals.fade3.putTrades, totals.fade3.putWins, 'put');
}
if (totals.fade3.callTrades > 5) {
  printStrategy('  → FADE3 CALL (contra 3↓ → CALL)', totals.fade3.callTrades, totals.fade3.callWins, 'call');
}

// FADE4
const fade4Total = totals.fade4.putTrades + totals.fade4.callTrades;
const fade4Wins = totals.fade4.putWins + totals.fade4.callWins;
printStrategy('\nFADE4 (contra 4 velas)', fade4Total, fade4Wins, 'both');

if (totals.fade4.putTrades > 5) {
  printStrategy('  → FADE4 PUT (contra 4↑ → PUT)', totals.fade4.putTrades, totals.fade4.putWins, 'put');
}
if (totals.fade4.callTrades > 5) {
  printStrategy('  → FADE4 CALL (contra 4↓ → CALL)', totals.fade4.callTrades, totals.fade4.callWins, 'call');
}

// FADE5
const fade5Total = totals.fade5.putTrades + totals.fade5.callTrades;
const fade5Wins = totals.fade5.putWins + totals.fade5.callWins;
printStrategy('\nFADE5 (contra 5 velas)', fade5Total, fade5Wins, 'both');

if (totals.fade5.putTrades > 5) {
  printStrategy('  → FADE5 PUT (contra 5↑ → PUT)', totals.fade5.putTrades, totals.fade5.putWins, 'put');
}
if (totals.fade5.callTrades > 5) {
  printStrategy('  → FADE5 CALL (contra 5↓ → CALL)', totals.fade5.callTrades, totals.fade5.callWins, 'call');
}

// FOLLOW3
const follow3Total = totals.follow3.putTrades + totals.follow3.callTrades;
const follow3Wins = totals.follow3.putWins + totals.follow3.callWins;
printStrategy('\nFOLLOW3 (a favor de 3 velas)', follow3Total, follow3Wins, 'both');

// RSI2
const rsi2Total = totals.rsi2.callTrades + totals.rsi2.putTrades;
const rsi2Wins = totals.rsi2.callWins + totals.rsi2.putWins;
printStrategy('\nRSI(2) EXTREME (<15 CALL, >85 PUT)', rsi2Total, rsi2Wins, 'both');

console.log(`\n${'─'.repeat(65)}`);
console.log('📋 RESULTADOS POR ATIVO:');
console.log('─'.repeat(65));

for (const r of allResults) {
  const total = r.fade3.putTrades + r.fade3.callTrades;
  if (total > 10) {
    const wins = r.fade3.putWins + r.fade3.callWins;
    const wr = (wins / total * 100).toFixed(0);
    const edge = (wins / total - 0.5) * 100;
    const flag = edge > 2 ? '📈' : edge < -2 ? '📉' : '⚖️';
    console.log(`\n${r.name}:`);
    console.log(`   FADE3: ${total} trades, WR: ${wr}% ${flag}`);
    console.log(`   Máx consec: UP ${r.maxConsecutiveUp} / DOWN ${r.maxConsecutiveDown}`);
  }
}

console.log(`\n${'='.repeat(65)}`);
console.log('💡 CONCLUSÃO:');
console.log('='.repeat(65));

// Determinar melhor estratégia
const strategies = [
  { name: 'FADE3', trades: fade3Total, wins: fade3Wins },
  { name: 'FADE4', trades: fade4Total, wins: fade4Wins },
  { name: 'FADE5', trades: fade5Total, wins: fade5Wins },
  { name: 'FOLLOW3', trades: follow3Total, wins: follow3Wins },
  { name: 'RSI2', trades: rsi2Total, wins: rsi2Wins }
].filter(s => s.trades > 20);

if (strategies.length > 0) {
  const best = strategies.reduce((a, b) => {
    const edgeA = (a.wins / a.trades - 0.5) * 100;
    const edgeB = (b.wins / b.trades - 0.5) * 100;
    return Math.abs(edgeA) > Math.abs(edgeB) ? a : b;
  });

  const bestEdge = (best.wins / best.trades - 0.5) * 100;

  console.log(`\nMelhor estratégia: ${best.name}`);
  console.log(`   WR: ${(best.wins / best.trades * 100).toFixed(1)}%`);
  console.log(`   Edge: ${bestEdge > 0 ? '+' : ''}${bestEdge.toFixed(1)}%`);
  console.log(`   Trades: ${best.trades}`);

  if (bestEdge > 2) {
    console.log(`\n✅ ${best.name} É EXPLOTÁVEL!`);
    console.log(`\nEstratégia recomendada para o bot:`);
    if (best.name === 'FADE3') {
      console.log(`   → Quando 3 velas consecutivas no mesmo sentido:`);
      console.log(`   → Se 3↑, operar PUT na próxima vela`);
      console.log(`   → Se 3↓, operar CALL na próxima vela`);
    } else if (best.name === 'FOLLOW3') {
      console.log(`   → Quando 3 velas consecutivas no mesmo sentido:`);
      console.log(`   → Se 3↑, operar CALL na próxima vela`);
      console.log(`   → Se 3↓, operar PUT na próxima vela`);
    }
  } else if (bestEdge < -2) {
    console.log(`\n❌ O oposto de ${best.name} seria explotável!`);
    console.log(`   O algoritmo DA 3 velas consecutivas deliberadamente.`);
    console.log(`   Recomendação: operar A FAVOR das velas (não contra)`);
  } else {
    console.log(`\n⚠️ Nenhuma estratégia demonstrou edge estatisticamente significativo.`);
    console.log(`   Mais dados são necessários (24-48h de coleta).`);
  }
}
