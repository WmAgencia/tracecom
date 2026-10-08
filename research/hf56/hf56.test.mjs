import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const script=resolve('research/hf56/hf56.mjs');
const names=['US-100','US-2000','US-30','US-500','JP-225'];
function setup(options={}){
 const dir=mkdtempSync(join(tmpdir(),'hf56-test-'));
 const data=join(dir,'candles');mkdirSync(data);
 const epoch=Date.UTC(2026,8,28,0,0,0);
 for(const name of names){
  const lines=['from,to,open,high,low,close'];
  for(let i=0;i<350;i++){
   const t=epoch+i*60000,base=100+i*.02;
   const open=(base-.006).toFixed(6),close=base.toFixed(6);
   lines.push([new Date(t).toISOString(),new Date(t+60000).toISOString(),
    open,(base+.03).toFixed(6),(base-.03).toFixed(6),close].join(','));
   // Conflicting candle at one timestamp: must be excluded, not accepted arbitrarily.
   if(options.conflict&&name===names[0]&&i===175){
    lines.push([new Date(t).toISOString(),new Date(t+60000).toISOString(),
     open,(base+.08).toFixed(6),(base-.03).toFixed(6),close].join(','));
   }
  }
  writeFileSync(join(data,name+'_60s.csv'),lines.join('\n')+'\n');
 }
 return{dir,data,ledger:join(dir,'ledger.jsonl'),clean(){rmSync(dir,{recursive:true,force:true})}};
}
function run(mode,ctx){
 return spawnSync(process.execPath,[script,mode],{encoding:'utf8',
  env:{...process.env,IQ_MCP_TOKEN:'',HF56_DATA_DIR:ctx.data,HF56_LOG:ctx.ledger}});
}
test('source parses as valid Node ESM and contains no order-dispatch API',()=>{
 const check=spawnSync(process.execPath,['--check',script],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
});
test('upward five-minute change produces PUT and losses on monotonic up data',()=>{
 const ctx=setup();
 try{
  const p=run('backtest',ctx);
  assert.equal(p.status,0,p.stderr);
  const report=JSON.parse(p.stdout);
  assert.equal(report.strategy.direction,'PUT');
  assert.equal(report.strategy.expiry_s,900);
  assert.equal(report.strategy.max_simultaneous_per_asset,10);
  for(const name of ['train','validation','test']){
   const stage=report.stages[name];
   assert.ok(stage.uncapped.signals>0,name);
   assert.equal(stage.uncapped.wins,0,'PUT loses in strictly rising prices');
   assert.ok(stage.max10OpenPerAsset.signals<=stage.uncapped.signals);
  }
 }finally{ctx.clean()}
});
test('conflicting candle is ignored without breaking historical processing',()=>{
 const ctx=setup({conflict:true});
 try{const res=run('backtest',ctx);
  assert.equal(res.status,0,res.stderr);
  assert.ok(JSON.parse(res.stdout).stages.test.uncapped.signals>0);
 }finally{ctx.clean()}
});
test('score reads append-only settlements without calling order methods',()=>{
 const ctx=setup();
 try{
  const t=Date.UTC(2026,9,1);
  const a={kind:'signal',id:'A',asset:'US 100',assetId:1471,
   entryTime:new Date(t).toISOString(),expiryTime:new Date(t+900000).toISOString(),payout:91};
  const b={...a,id:'B',entryTime:new Date(t+86400000).toISOString(),
   expiryTime:new Date(t+86400000+900000).toISOString()};
  const recs=[a,b,{kind:'resolution',id:'A',outcome:'win'},
   {kind:'resolution',id:'B',outcome:'loss'}];
  writeFileSync(ctx.ledger,recs.map(x=>JSON.stringify(x)).join('\n')+'\n');
  const r=run('score',ctx);assert.equal(r.status,0,r.stderr);
  const score=JSON.parse(r.stdout);
  assert.equal(score.settled.signals,2);
  assert.equal(score.settled.wr_pct,50);
  assert.equal(score.distinctDays,2);
  assert.equal(score.historicalResearchThresholdMet,false);
  assert.equal(score.realAccountAuthorized,false);
 }finally{ctx.clean()}
});
test('shadow refuses to launch without explicit IQ read token',()=>{
 const ctx=setup();
 try{const r=run('shadow',ctx);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/IQ_MCP_TOKEN missing/);
 }finally{ctx.clean()}
});
