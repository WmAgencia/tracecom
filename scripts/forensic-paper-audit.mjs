import fs from 'node:fs';

const results = JSON.parse(fs.readFileSync('paper-usdcad-1000-results.json', 'utf8'));
const dataset = JSON.parse(fs.readFileSync('data/real/usdcad-1m-8d.json', 'utf8'));
const rows = new Map(dataset.rows.map(r => [Number(r.timestamp), r]));
const trades = results.trades;
const outcome = (direction, a, b) => b > a ? (direction === 'BUY' ? 'WIN' : 'LOSS') : b < a ? (direction === 'SELL' ? 'WIN' : 'LOSS') : 'DRAW';
const audited = trades.map(t => {
  const a = rows.get(Date.parse(t.timestamp));
  const b = rows.get(Date.parse(t.expiryTimestamp));
  const independent = a && b ? outcome(t.direction, a.close, b.close) : 'UNKNOWN';
  return { ordinal:t.ordinal, phase:t.phase, direction:t.direction, probability:t.probability, recorded:t.outcome, independent, entryClose:a?.close ?? null, exitClose:b?.close ?? null, delta:a&&b ? b.close-a.close : null, timestamp:t.timestamp, expiryTimestamp:t.expiryTimestamp, session:t.session, regime:t.regime };
});
const count = xs => xs.reduce((m,x)=>(m[x]=(m[x]||0)+1,m),{});
const wr = xs => { const e=xs.filter(x=>x==='WIN'||x==='LOSS'); return e.length ? e.filter(x=>x==='WIN').length/e.length : null; };
const confusion = count(audited.map(x=>`${x.recorded}->${x.independent}`));
const invert = audited.map(x=>x.independent==='UNKNOWN'?'UNKNOWN':x.independent==='DRAW'?'DRAW':x.independent==='WIN'?'LOSS':'WIN');
const always = d => audited.map(x=>x.independent==='UNKNOWN'?'UNKNOWN':outcome(d,x.entryClose,x.exitClose));
const randomExpected = audited.filter(x=>x.independent==='WIN'||x.independent==='LOSS').length/2;
const gaps=[]; for(let i=1;i<dataset.rows.length;i++){const dt=dataset.rows[i].timestamp-dataset.rows[i-1].timestamp;if(dt!==60000)gaps.push({from:dataset.rows[i-1].timestamp,to:dataset.rows[i].timestamp,minutes:dt/60000});}
const report = {schemaVersion:1,source:'paper-usdcad-1000-results.json',datasetRows:dataset.rows.length,tradeCount:trades.length,matchingEntryRows:audited.filter(x=>x.entryClose!=null).length,matchingExpiryRows:audited.filter(x=>x.exitClose!=null).length,independentOutcomeCounts:count(audited.map(x=>x.independent)),recordedOutcomeCounts:count(audited.map(x=>x.recorded)),confusion,recordedVsIndependentAgreement:audited.filter(x=>x.recorded===x.independent).length/audited.length,invertedDirection:{counts:count(invert),wr:wr(invert)},alwaysBuy:{counts:count(always('BUY')),wr:wr(always('BUY'))},alwaysSell:{counts:count(always('SELL')),wr:wr(always('SELL'))},randomBaseline:{evaluated:randomExpected*2,expectedWins:randomExpected,expectedWr:.5},movement:{min:Math.min(...audited.filter(x=>x.delta!==null).map(x=>x.delta)),max:Math.max(...audited.filter(x=>x.delta!==null).map(x=>x.delta)),mean:audited.filter(x=>x.delta!==null).reduce((s,x)=>s+x.delta,0)/audited.filter(x=>x.delta!==null).length,positive:audited.filter(x=>x.delta>0).length,negative:audited.filter(x=>x.delta<0).length,flat:audited.filter(x=>x.delta===0).length},temporal:{first:dataset.rows[0].timestamp,last:dataset.rows.at(-1).timestamp,gaps,count:gaps.length,monotonic:dataset.rows.every((r,i)=>i===0||r.timestamp>dataset.rows[i-1].timestamp)},sample:audited.slice(0,100)};
fs.writeFileSync('diagnostic-results/paper/forensic-audit.json', JSON.stringify(report,null,2)+'\n');
const pct=x=>x==null?'N/A':`${(x*100).toFixed(2)}%`;
const md=`# Forensic audit — USD/CAD paper replay\n\nIndependent settlement uses only dataset rows matching each trade timestamp and expiry timestamp, comparing close-to-close. No production code or strategy was modified.\n\n- Trades audited: ${trades.length}; sample exported: first 100\n- Entry/expiry matches: ${report.matchingEntryRows}/${trades.length}, ${report.matchingExpiryRows}/${trades.length}\n- Recorded vs independent agreement: ${pct(report.recordedVsIndependentAgreement)}\n- Independent outcomes: ${JSON.stringify(report.independentOutcomeCounts)}\n- Confusion: ${JSON.stringify(confusion)}\n- Inverted direction WR: ${pct(report.invertedDirection.wr)}\n- Always BUY WR: ${pct(report.alwaysBuy.wr)}; always SELL WR: ${pct(report.alwaysSell.wr)}\n- Random 50% baseline expectation: ${report.randomBaseline.expectedWins} wins / ${report.randomBaseline.evaluated} evaluated\n- Movement: min ${report.movement.min}, max ${report.movement.max}, mean ${report.movement.mean}, positive ${report.movement.positive}, negative ${report.movement.negative}, flat ${report.movement.flat}\n- Temporal: monotonic=${report.temporal.monotonic}; ${report.temporal.count} gaps in source (preserved, not imputed)\n\nInterpretation: the independent audit is a consistency check, not evidence of predictive validity. Recorded outcomes that disagree with close-to-close settlement require investigation before any promotion.\n`;
fs.writeFileSync('diagnostic-results/paper/forensic-audit.md',md);
console.log(JSON.stringify({agreement:report.recordedVsIndependentAgreement, independent:report.independentOutcomeCounts, confusion, sample:100, gaps:report.temporal.count},null,2));
