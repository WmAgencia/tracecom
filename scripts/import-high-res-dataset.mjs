#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const usage = 'node scripts/import-high-res-dataset.mjs <input.{csv,csv.gz,zip,json}> [--out <dir>] [--start <ms|ISO>] [--end <ms|ISO>]';
const args = process.argv.slice(2);
if (!args[0] || args.includes('--help')) { console.error(usage); process.exit(args.includes('--help') ? 0 : 2); }
const input = path.resolve(args[0]);
const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const outDir = path.resolve(value('--out') ?? path.join(path.dirname(input), 'normalized'));
const parseTime = (v) => { if (v == null || v === '') return NaN; if (/^-?\d+(\.\d+)?$/.test(String(v).trim())) { const n = Number(v); return n < 1e11 ? n * 1000 : n; } const n = Date.parse(String(v)); return Number.isFinite(n) ? n : NaN; };
const parseNum = (v) => { if (v == null || String(v).trim() === '') return NaN; const n = Number(String(v).trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
function csv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean); if (!lines.length) return [];
  const split = (line) => { const a=[]; let s='', q=false; for (const c of line) { if(c==='"') q=!q; else if(c===','&&!q){a.push(s);s='';} else s+=c; } a.push(s); return a; };
  const headers = split(lines[0]).map(x=>x.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_'));
  return lines.slice(1).map(line => Object.fromEntries(split(line).map((v,i)=>[headers[i],v])));
}
function zipEntries(buf) {
  const out=[]; let p=0;
  while ((p=buf.indexOf(Buffer.from([0x50,0x4b,0x03,0x04]),p)) >= 0) { const method=buf.readUInt16LE(p+8), csize=buf.readUInt32LE(p+18), n=buf.readUInt16LE(p+26), e=buf.readUInt16LE(p+28); const name=buf.subarray(p+30,p+30+n).toString(); const data=buf.subarray(p+30+n+e,p+30+n+e+csize); if(!name.endsWith('/')) out.push({name,data:method===8?zlib.inflateRawSync(data):data}); p += 30+n+e+csize; }
  return out;
}
function sourceRows() {
  let buf=fs.readFileSync(input), ext=input.toLowerCase();
  if (ext.endsWith('.gz')) { buf=zlib.gunzipSync(buf); ext=ext.slice(0,-3); }
  if (ext.endsWith('.zip')) { const entries=zipEntries(buf).filter(x=>/\.(csv|json)$/i.test(x.name)); if(!entries.length) throw Error('ZIP contains no CSV/JSON entry'); const e=entries[0]; buf=e.data; ext=e.name.toLowerCase(); }
  const text=buf.toString('utf8'); if(ext.endsWith('.json')) { const j=JSON.parse(text); return Array.isArray(j)?j:(j.rows ?? j.data ?? j.ticks ?? []); } return csv(text);
}
function normalize(row, index) {
  const pick=(names)=>names.map(n=>row[n] ?? row[n.toUpperCase()] ?? row[n.replaceAll('_','')]).find(v=>v!==undefined);
  const timestamp=parseTime(pick(['timestamp','time','ts','datetime','date']));
  const bid=parseNum(pick(['bid','bid_price'])), ask=parseNum(pick(['ask','ask_price']));
  const rawPrice=parseNum(pick(['price','last','close','mid'])); const price=Number.isFinite(rawPrice)?rawPrice:(Number.isFinite(bid)&&Number.isFinite(ask)?(bid+ask)/2:NaN);
  return { timestamp, price, ...(Number.isFinite(bid)?{bid}:{}), ...(Number.isFinite(ask)?{ask}:{}), sourceRow:index };
}
const raw=sourceRows(), rows=raw.map(normalize).filter(r=>Number.isFinite(r.timestamp)&&Number.isFinite(r.price)).sort((a,b)=>a.timestamp-b.timestamp);
const start=value('--start') ? parseTime(value('--start')) : rows[0]?.timestamp, end=value('--end') ? parseTime(value('--end')) : rows.at(-1)?.timestamp;
const selected=rows.filter(r=>r.timestamp>=start&&r.timestamp<=end); const dup=new Set(), gaps=[]; for(let i=1;i<selected.length;i++){if(selected[i].timestamp===selected[i-1].timestamp)dup.add(selected[i].timestamp); if(selected[i].timestamp<selected[i-1].timestamp){} const d=selected[i].timestamp-selected[i-1].timestamp; if(d>60000)gaps.push({from:selected[i-1].timestamp,to:selected[i].timestamp,ms:d});}
const hasQuotes=selected.some(r=>r.bid!==undefined&&r.ask!==undefined), quality=selected.length&&selected.every(r=>r.price>0)&&!dup.size?'PASS':'FAIL';
const metadata={schemaVersion:1,format:'TRACE_TICK_V1',sourceFile:path.basename(input),sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),importedAt:new Date().toISOString(),coverage:{start,end,rows:selected.length},fields:{price:true,bid:hasQuotes,ask:hasQuotes},quality:{status:quality,monotonic:true,duplicateTimestamps:dup.size,gaps,gapCount:gaps.length,invalidRows:raw.length-rows.length},temporalClass:hasQuotes?'VALID_TICK_CANDIDATE':'VALID_HIGH_RES_PRICE_CANDIDATE',notes:'No interpolation, synthetic ticks, credentials, or strategy transformations were applied.'};
fs.mkdirSync(outDir,{recursive:true}); fs.writeFileSync(path.join(outDir,'dataset.json'),JSON.stringify({metadata,rows:selected},null,2)); fs.writeFileSync(path.join(outDir,'quality-report.json'),JSON.stringify(metadata,null,2));
console.log(JSON.stringify(metadata,null,2));
