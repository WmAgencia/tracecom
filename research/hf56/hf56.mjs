#!/usr/bin/env node
/**
 * TraceCom HF56_PUT_R5_H15_V1 — BACKTEST and IQ broker-feed SHADOW ONLY.
 * No order methods, stake commands, or account switching.
 * node research/hf56/hf56.mjs backtest|shadow|score
 */
import {readFileSync,appendFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ASSETS=Object.freeze([
 ['US 100',1471,'US-100'],['US 2000',1473,'US-2000'],['US 30',1472,'US-30'],
 ['US 500',1470,'US-500'],['JP 225',1476,'JP-225']
]);
const RULE=Object.freeze({id:'HF56_PUT_R5_H15_V1',direction:'PUT',resolution_s:60,
 lookback_bars:5,expiry_s:900,max_simultaneous_per_asset:10,min_payout_pct:89,
 account_mode:'SHADOW_ONLY'});
const HASH=createHash('sha256').update(JSON.stringify({RULE,ASSETS})).digest('hex');
const BASE=dirname(fileURLToPath(import.meta.url)),MINUTE=60000;
const DATA_DIR=process.env.HF56_DATA_DIR??join(BASE,'../../diagnostic-results/data/iq-real/binary-options');
const LOG=process.env.HF56_LOG??join(BASE,'hf56-prospective.jsonl');
const iso=(t)=>new Date(t).toISOString();
function canonicalCandles(raw){
 const times=new Map();
 for(const row of raw){
  const t=Date.parse(row.from),end=Date.parse(row.to);
  const o=Number(row.open),h=Number(row.high),l=Number(row.low),c=Number(row.close);
  if(!Number.isFinite(t)||end-t!==MINUTE||![o,h,l,c].every(Number.isFinite)
     ||h<Math.max(o,c)||l>Math.min(o,c)||h<l)continue;
  const signature=[o,h,l,c].join('|');
  if(!times.has(t))times.set(t,new Map());
  times.get(t).set(signature,{t,o,h,l,c});
 }
 return [...times].filter(([t,m])=>m.size===1)
  .map(([t,m])=>m.values().next().value).sort((a,b)=>a.t-b.t);
}
function parseCSV(path){
 const lines=readFileSync(path,'utf8').trim().split(/\r?\n/),header=lines.shift().split(',');
 return canonicalCandles(lines.map(line=>{
  const parts=line.split(',');return Object.fromEntries(header.map((field,i)=>[field,parts[i]]));
 }));
}
function stats(rows){
 const wins=rows.filter(x=>x.win===true).length,losses=rows.filter(x=>x.win===false).length;
 return {signals:wins+losses,wins,losses,wr_pct:wins+losses?+(100*wins/(wins+losses)).toFixed(2):null};
}
function positionCap(records,max=RULE.max_simultaneous_per_asset){
 const open=new Map(),accepted=[];
 for(const x of records.slice().sort((a,b)=>a.t-b.t||a.asset.localeCompare(b.asset))){
  const active=(open.get(x.asset)??[]).filter(expiry=>expiry>x.t);
  if(active.length>=max){open.set(x.asset,active);continue;}
  active.push(x.t+RULE.expiry_s*1000);open.set(x.asset,active);accepted.push(x);
 }
 return accepted;
}
function backtest(){
 const rows=[];
 for(const [name,id,file] of ASSETS){
  const candles=parseCSV(join(DATA_DIR,file+'_60s.csv')),n=candles.length;
  const gaps=[0];for(let i=1;i<n;i++)gaps[i]=gaps[i-1]+Number(candles[i].t-candles[i-1].t!==MINUTE);
  const train=Math.floor(n*.5),val=Math.floor(n*.75),h=RULE.expiry_s/60;
  for(let i=40;i<n-h;i++){
   const stage=i<train?'train':i<val?'validation':'test';
   const lo=stage==='train'?0:stage==='validation'?train:val;
   const hi=stage==='train'?train:stage==='validation'?val:n;
   // Purge at every split boundary: no result label crosses partitions.
   if(i<lo+h||i+h>=hi||gaps[i]-gaps[i-25]||gaps[i+h]-gaps[i])continue;
   if(candles[i].c<=candles[i-RULE.lookback_bars].c)continue;
   const priceDiff=candles[i+h].c-candles[i+1].o;
   if(priceDiff===0)continue;
   rows.push({asset:name,t:candles[i].t,stage,win:priceDiff<0});
  }
 }
 const result={strategy:RULE,hash:HASH,status:'EXPLORATORY_ONLY',
  caveat:'OHLC price proxies, overlapping bets and correlated indices; not broker settlements',
  stages:{}};
 for(const stage of ['train','validation','test']){
  const selected=rows.filter(x=>x.stage===stage).sort((a,b)=>a.t-b.t);
  const capped=positionCap(selected);
  const hours=selected.length?(selected.at(-1).t-selected[0].t)/3600000:0;
  const days=[...new Set(selected.map(x=>iso(x.t).slice(0,10)))];
  result.stages[stage]={uncapped:stats(selected),max10OpenPerAsset:stats(capped),
   cappedSignalsPerHour:hours?+(capped.length/hours).toFixed(1):0,
   distinctSignalMinutes:new Set(selected.map(x=>x.t)).size,
   calendarDays:days.map(day=>({day,...stats(selected.filter(x=>iso(x.t).startsWith(day)))}))};
 }
 return result;
}
// Append-only original predictions and later outcome records.
function ledger(){
 const all=new Map();
 if(!existsSync(LOG))return all;
 for(const line of readFileSync(LOG,'utf8').split(/\r?\n/).filter(Boolean)){
  let r;try{r=JSON.parse(line)}catch{continue;}
  if(r.kind==='signal')all.set(r.id,{...r});
  if(r.kind==='resolution'&&all.has(r.id))Object.assign(all.get(r.id),r);
 }
 return all;
}
function append(record){
 mkdirSync(dirname(LOG),{recursive:true});
 appendFileSync(LOG,JSON.stringify(record)+'\n');
}
function score(){
 const items=[...ledger().values()];
 const settled=items.filter(x=>x.outcome==='win'||x.outcome==='loss')
  .map(x=>({...x,t:Date.parse(x.entryTime),win:x.outcome==='win'}));
 const days=[...new Set(settled.map(x=>iso(x.t).slice(0,10)))];
 const byDay=days.map(d=>settled.filter(x=>iso(x.t).startsWith(d)));
 let state=20261008;
 const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296};
 const boot=[];
 if(days.length>=2)for(let i=0;i<1500;i++){
  let wins=0,n=0;
  for(let j=0;j<days.length;j++){
   const sample=byDay[Math.floor(random()*days.length)];n+=sample.length;wins+=sample.filter(x=>x.win).length;
  }
  boot.push(100*wins/n);
 }
 boot.sort((a,b)=>a-b);
 const lower=boot.length?+boot[Math.floor(boot.length*.025)].toFixed(2):null;
 const ev=settled.length?settled.reduce((s,x)=>s+(x.win?x.payout/100:-1),0)/settled.length:null;
 const uniqueQuarterHours=new Set(settled.map(x=>Math.floor(x.t/900000))).size;
 const freq=new Map();
 for(const x of items){const t=Date.parse(x.entryTime);if(!Number.isFinite(t))continue;
  const k=iso(Math.floor(t/1800000)*1800000);freq.set(k,(freq.get(k)??0)+1);
 }
 console.log(JSON.stringify({strategy:RULE,hash:HASH,status:'SHADOW_PROXY_ONLY',
  observations:items.length,settled:stats(settled),distinctDays:days.length,
  distinctQuarterHours:uniqueQuarterHours,dayBootstrap95LowerPct:lower,
  theoreticalNetUnitsPerStake:ev,
  signalsByHalfHour:[...freq].sort().map(([time,signals])=>({time,signals})),
  historicalResearchThresholdMet:settled.length>=900&&days.length>=10
   &&uniqueQuarterHours>=150&&lower>56&&ev>0,
  executableBrokerWR:'NOT_MEASURED',realAccountAuthorized:false},null,2));
}
async function shadow(){
 if(!process.env.IQ_MCP_TOKEN)throw new Error('IQ_MCP_TOKEN missing; never commit credentials');
 // Scheduler allows read calls only; market-order methods are forbidden.
 const {Scheduler}=await import('../../diagnostic-results/iq_mcp_scheduler.mjs');
 const sched=new Scheduler({token:process.env.IQ_MCP_TOKEN,perServerBudget:5000,minGapMs:1200,
  checkpoint:join(BASE,'hf56-scheduler-checkpoint.json')});
 const maxCycles=Number(process.env.HF56_MAX_CYCLES??0);
 const poll=Math.max(30000,Number(process.env.HF56_POLL_MS??60000));
 let offered={at:0,byId:new Map()},cycle=0;
 async function getOfferings(){
  if(Date.now()-offered.at<5*MINUTE)return offered.byId;
  const response=await sched.call('blitz-options','list_assets',{});
  offered={at:Date.now(),byId:new Map((response.data?.assets??[])
   .map(x=>[Number(x.asset_id),x]))};
  return offered.byId;
 }
 for(;;){
  cycle++;const started=Date.now();let available;
  try{available=await getOfferings()}catch(e){
   console.error('[HF56] blitz catalog unavailable:',e.message);available=new Map();
  }
  const book=ledger();
  for(const [name,assetId] of ASSETS){
   try{
    const r=await sched.call('binary-options','get_candles',{asset_id:assetId,size:60,count:75});
    const bars=canonicalCandles(r.data?.candles??[])
     .filter(c=>c.t+MINUTE<=Date.now());
    const i=bars.length-1;if(i<25)continue;
    const now=Date.now(),entryTime=bars[i].t+MINUTE;
    const lagMs=now-entryTime,offer=available.get(assetId);
    const rawSizes=offer?.expiration_sizes_seconds??[];
    const validOffer=offer?.is_open===true
      &&Number(offer.profit_percent)>=RULE.min_payout_pct
      &&rawSizes.map(Number).includes(RULE.expiry_s);
    const continuous=bars.slice(i-25,i+1).every((x,j,v)=>j===0||x.t-v[j-1].t===MINUTE);
    const id=HASH.slice(0,12)+'|'+assetId+'|'+iso(entryTime);
    if(validOffer&&continuous&&lagMs>=0&&lagMs<60000
       &&bars[i].c>bars[i-RULE.lookback_bars].c&&!book.has(id)){
     const active=[...book.values()].filter(x=>x.assetId===assetId
      &&Date.parse(x.entryTime)<=entryTime&&Date.parse(x.expiryTime)>entryTime).length;
     if(active<RULE.max_simultaneous_per_asset){
      const rec={kind:'signal',id,strategyHash:HASH,asset:name,assetId,
       observedAt:iso(now),signalCandleFrom:iso(bars[i].t),
       entryTime:iso(entryTime),expiryTime:iso(entryTime+RULE.expiry_s*1000),
       direction:'PUT',payout:Number(offer.profit_percent),
       lagMs,entryProxy:'NEXT_CANDLE_OPEN_NOT_YET_KNOWN',mode:'SHADOW_ONLY',
       ordersPlaced:false};
      append(rec);book.set(id,rec);
      console.log('[HF56] proxy PUT',name,rec.entryTime,'payout',rec.payout);
     }
    }
    for(const prediction of book.values()){
     if(prediction.assetId!==assetId||prediction.outcome)continue;
     const entry=Date.parse(prediction.entryTime),expiry=Date.parse(prediction.expiryTime);
     if(Date.now()<expiry)continue;
     const entryBar=bars.find(x=>x.t===entry);
     const exitBar=bars.find(x=>x.t===expiry-MINUTE);
     if(!entryBar||!exitBar){
      if(Date.now()-expiry>45*MINUTE){
       const resolution={kind:'resolution',id:prediction.id,outcome:'unresolved_gap',
        resolvedAt:iso(Date.now())};append(resolution);Object.assign(prediction,resolution);
      }
      continue;
     }
     const outcome=exitBar.c<entryBar.o?'win':exitBar.c>entryBar.o?'loss':'tie';
     const resolution={kind:'resolution',id:prediction.id,outcome,
      entryPriceProxy:entryBar.o,expiryPriceProxy:exitBar.c,
      resolvedAt:iso(Date.now()),pricing:'CANDLE_PROXY_NOT_EXECUTED_FILL'};
     append(resolution);Object.assign(prediction,resolution);
     console.log('[HF56] resolved',name,outcome);
    }
   }catch(error){console.error('[HF56]',name,String(error?.message??error).slice(0,180))}
  }
  console.log('[HF56] cycle',cycle,'observations',ledger().size,'READ ONLY');
  if(maxCycles&&cycle>=maxCycles)break;
  await new Promise(resolve=>setTimeout(resolve,Math.max(1000,poll-(Date.now()-started))));
 }
}
const mode=process.argv[2]??'backtest';
if(mode==='backtest')console.log(JSON.stringify(backtest(),null,2));
else if(mode==='score')score();
else if(mode==='shadow')await shadow();
else throw new Error('usage: backtest | score | shadow');
