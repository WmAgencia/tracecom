const fs=require('fs');const OUT=__dirname;const REF='cladmauwmuoeqongxzwb';const TOK=process.env.SUPABASE_ACCESS_TOKEN;
async function sqlq(q){for(let a=0;a<3;a++){const r=await fetch('https://api.supabase.com/v1/projects/'+REF+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+TOK,'Content-Type':'application/json'},body:JSON.stringify({query:q})});if(r.ok)return await r.json();if(a===2)throw new Error('SQL fail: '+(await r.text()).slice(0,200));await new Promise(x=>setTimeout(x,1500));}}
(async()=>{
const dir=OUT+'/tr/p3raw';const files=fs.readdirSync(dir).sort();const byN=new Map();
for(const f of files){const j=JSON.parse(fs.readFileSync(dir+'/'+f,'utf8'));for(const q of (j.payload.quotes||[]))byN.set(q.n,q);}
const ticks=[...byN.values()].sort((a,b)=>a.ts-b.ts);
const cmap=new Map();for(const t of ticks){const b=Math.floor(t.ts/5000)*5000;const p=t.value!=null?t.value:(t.bid+t.ask)/2;const c=cmap.get(b);if(!c)cmap.set(b,{bucket:b,open:p,high:p,low:p,close:p,n:1});else{c.high=Math.max(c.high,p);c.low=Math.min(c.low,p);c.close=p;c.n+=1;}}
const cd=[...cmap.values()].sort((a,b)=>a.bucket-b.bucket);
console.log('ticks='+ticks.length+' candles='+cd.length);
await sqlq(`DELETE FROM iqopt_raw_ticks WHERE dataset_id='IQOPTION_EURUSD_BINARY_P3';`);
await sqlq(`DELETE FROM iqopt_candles_5s WHERE dataset_id='IQOPTION_EURUSD_BINARY_P3';`);
await sqlq(`INSERT INTO iqopt_datasets (dataset_id, instrument, contract_type, otc, source, status, window_from, window_to) VALUES ('IQOPTION_EURUSD_BINARY_P3','EUR/USD','BINARY',false,'IQ_OPTION','INSERTING','${new Date(cd[0].bucket).toISOString()}','${new Date(cd[cd.length-1].bucket).toISOString()}') ON CONFLICT (dataset_id) DO UPDATE SET status='INSERTING', window_from=EXCLUDED.window_from, window_to=EXCLUDED.window_to;`);
const tv=ticks.map(t=>{const iso=new Date(t.ts).toISOString();return `('IQOPTION_EURUSD_BINARY_P3','IQ_OPTION','EUR/USD','BINARY',false,'${iso}',${t.bid},${t.ask},${t.value},${t.value},'${iso}',NULL,'{}'::jsonb,'{}'::jsonb)`;});
for(let i=0;i<tv.length;i+=5000)await sqlq(`INSERT INTO iqopt_raw_ticks (dataset_id,source,instrument,contract_type,otc,ts,bid,ask,mid,raw_price,source_timestamp,received_at,provenance,raw) VALUES ${tv.slice(i,i+5000).join(',')};`);
const cv=cd.map((x,idx)=>`('IQOPTION_EURUSD_BINARY_P3','${new Date(x.bucket).toISOString()}',${x.open},${x.high},${x.low},${x.close},${x.n},${idx+1<cd.length&&cd[idx+1].bucket-x.bucket>5000?'true':'false'},${x.close})`);
for(let i=0;i<cv.length;i+=5000)await sqlq(`INSERT INTO iqopt_candles_5s (dataset_id,bucket,open,high,low,close,tick_count,gap,mid_close) VALUES ${cv.slice(i,i+5000).join(',')};`);
await sqlq(`UPDATE iqopt_datasets SET status='READY' WHERE dataset_id='IQOPTION_EURUSD_BINARY_P3';`);
const chk=await sqlq(`SELECT (SELECT count(*)::int FROM iqopt_raw_ticks WHERE dataset_id='IQOPTION_EURUSD_BINARY_P3') AS ticks, (SELECT count(*)::int FROM iqopt_candles_5s WHERE dataset_id='IQOPTION_EURUSD_BINARY_P3') AS candles;`);
console.log('PERSIST OK', JSON.stringify(chk));
})().catch(e=>{console.error('ERR '+e.message);process.exit(1);});
