/**
 * HF56 fixed historical research. Read-only. No trading API, no credentials.
 * Run: node research/hf56/backtest.mjs
 */
import {readFileSync} from 'node:fs';
const assets=['US-100','US-2000','US-30','US-500','JP-225'];
const folder='diagnostic-results/data/iq-real/binary-options/';
const horizon=15, cap=10, minute=60000;
function stats(rows){const wins=rows.filter(x=>x.win).length;return{signals:rows.length,wins,losses:rows.length-wins,wr:rows.length?Number((100*wins/rows.length).toFixed(2)):null};}
function load(asset){
 const csv=readFileSync(folder+asset+'_60s.csv','utf8').trim().split(/\r?\n/);
 const by=new Map();
 for(const line of csv.slice(1)){const [from,to,open,high,low,close]=line.split(',');
  const t=Date.parse(from),u=Date.parse(to),o=Number(open),h=Number(high),l=Number(low),c=Number(close);
  if(!Number.isFinite(t)||u-t!==minute||![o,h,l,c].every(Number.isFinite)||h<Math.max(o,c)||l>Math.min(o,c))continue;
  if(!by.has(t))by.set(t,new Map());by.get(t).set([o,h,l,c].join(','),{t,o,c});
 }
 return [...by].filter(([_,v])=>v.size===1).map(([_,v])=>v.values().next().value).sort((a,b)=>a.t-b.t);
}
const rows=[];
for(const asset of assets){const bars=load(asset),n=bars.length;const gap=[0];
 for(let i=1;i<n;i++)gap[i]=gap[i-1]+Number(bars[i].t-bars[i-1].t!==minute);
 const t1=Math.floor(n*.5),t2=Math.floor(n*.75);
 for(let i=40;i<n-horizon;i++){
  const stage=i<t1?'train':i<t2?'validation':'test';
  const lo=stage==='train'?0:stage==='validation'?t1:t2,hi=stage==='train'?t1:stage==='validation'?t2:n;
  if(i<lo+horizon||i+horizon>=hi||gap[i]-gap[i-25]||gap[i+horizon]-gap[i])continue;
  if(bars[i].c<=bars[i-5].c)continue;
  const result=bars[i+horizon].c-bars[i+1].o;if(result===0)continue;
  rows.push({asset,stage,t:bars[i].t,win:result<0});
 }
}
function limitPositions(rows){let perAsset=new Map(),out=[];
 for(const r of rows.slice().sort((a,b)=>a.t-b.t||a.asset.localeCompare(b.asset))){
  const open=(perAsset.get(r.asset)??[]).filter(t=>t>r.t);
  if(open.length>=cap){perAsset.set(r.asset,open);continue;}
  open.push(r.t+horizon*minute);perAsset.set(r.asset,open);out.push(r);
 }return out;
}
const output={status:'HISTORICAL_EXPLORATORY_ONLY',rule:'PUT if close[i] > close[i-5]; enter next 1m open; exit 15th 1m close',assets,cap,horizonMin:horizon,stages:{}};
for(const stage of ['train','validation','test']){
 const list=rows.filter(x=>x.stage===stage),capped=limitPositions(list);
 const sorted=list.slice().sort((a,b)=>a.t-b.t),hours=sorted.length?(sorted.at(-1).t-sorted[0].t)/3600000:0;
 const days=[...new Set(list.map(x=>new Date(x.t).toISOString().slice(0,10)))];
 output.stages[stage]={unlimited:stats(list),max10OpenPerAsset:stats(capped),signalsPerHour:hours?Number((capped.length/hours).toFixed(1)):0,days:days.map(day=>({day,...stats(list.filter(x=>new Date(x.t).toISOString().startsWith(day)))}))};
}
console.log(JSON.stringify(output,null,2));
