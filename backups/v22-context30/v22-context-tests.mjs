import test from 'node:test';
import assert from 'node:assert/strict';
import {context30,entryPullback,validWindow,rsiWilder,zones,expirationAllowed,dmi} from '../v22-context.mjs';
const now=1800000000000;
function bars(n,size=5000){return Array.from({length:n},(_,i)=>{const p=100+i*.03;return {atMs:now-(n-i)*size,open:p,close:p+.02,high:p+.03,low:p-.01};});}
function fixture(){
 const ticks=bars(360);let p=ticks[347].close;
 for(let i=348;i<359;i++){const open=p;p-=.03;ticks[i]={...ticks[i],open,close:p,high:open+.002,low:p-.002};}
 ticks[359]={...ticks[359],open:p,close:p+.27,high:p+.272,low:p-.002};
 const context={ready:true,direction:'alta15m',recentDirection:'CALL',lastClosedAt:now,atr:.4,zones:[{kind:'support',price:p,confirmedAt:now-120000}]};
 return {ticks,context,now};
}
test('360 candles fechados contínuos requeridos; gap, futuro, stale e OHLC inválido bloqueados',()=>{
 assert(validWindow(bars(360),5000,360,now));assert(!validWindow(bars(359),5000,360,now));
 for(const change of [b=>b[120].atMs+=1,b=>b.at(-1).atMs=now,b=>b.forEach(x=>x.atMs-=20000),b=>b[200].high=0]){const b=bars(360);change(b);assert(!validWindow(b,5000,360,now));}
});
test('RSI flat=50, alta=100, baixa=0 e DMI direcional',()=>{const b=bars(60);assert.equal(rsiWilder(b),100);assert.equal(rsiWilder(b.map(x=>({...x,close:1}))),50);assert.equal(rsiWilder(b.map(x=>({...x,close:300-x.close}))),0);assert(dmi(b).plusDI>dmi(b).minusDI);});
test('contexto usa 30 barras e exige 60 para aquecimento; muda com dados novos',()=>{const b=bars(60,60000),ctx=context30(b,now);assert.equal(ctx.direction,'alta15m');assert.equal(ctx.candles,30);assert.equal(ctx.recentDirection,'CALL');assert(!context30(b.slice(1),now).ready);const down=b.map(x=>({...x,open:300-x.open,close:300-x.close,high:300-x.low,low:300-x.high}));assert.equal(context30(down,now).direction,'baixa15m');assert(!context30(b,now+180000).ready);});
test('pivô só existe após dois candles de confirmação',()=>{const b=bars(6,60000);b[3].low=90;assert(!zones(b.slice(0,5)).some(z=>z.price===90));assert(zones(b).some(z=>z.price===90&&z.confirmedAt===now));});
test('CALL aprovado somente após reação em suporte',()=>{const f=fixture(),r=entryPullback(f);assert.equal(r.skip,null,JSON.stringify(r));assert.equal(r.direction,'CALL');});
test('PUT simétrico após reação em resistência',()=>{const f=fixture();f.ticks=f.ticks.map(x=>({...x,open:300-x.open,close:300-x.close,high:300-x.low,low:300-x.high}));f.context={...f.context,direction:'baixa15m',recentDirection:'PUT',zones:f.context.zones.map(z=>({...z,kind:'resistance',price:300-z.price}))};const r=entryPullback(f);assert.equal(r.skip,null,JSON.stringify(r));assert.equal(r.direction,'PUT');});
test('regime baixa nunca autoriza PUT se tendência 5s sobe',()=>{const f=fixture();f.context.direction='baixa15m';f.context.recentDirection='PUT';assert.equal(entryPullback(f).skip,'tendencia5sContraOuLateral');});
test('1m independente veta contradição ou lateral',()=>{for(const direction of ['PUT',null]){const f=fixture();f.context.recentDirection=direction;assert.equal(entryPullback(f).skip,'tendencia1mContraOuLateral');}});
test('cache velho ou timestamp ausente bloqueados',()=>{for(const at of [now-120001,undefined,now+1]){const f=fixture();f.context.lastClosedAt=at;assert.equal(entryPullback(f).skip,'contextoIncompletoOuStale');}});
test('sem suporte anterior confirmado não entra',()=>{for(const zones of [[],[{kind:'support',price:110,confirmedAt:now}]]){const f=fixture();f.context.zones=zones;assert.equal(entryPullback(f).skip,'semZonaConfirmadaOuRompida');}});
test('sem retomada não entra; posição oposta veta',()=>{const f=fixture();f.ticks.at(-1).close=f.ticks.at(-1).open;assert(entryPullback(f).skip);assert.equal(entryPullback({...fixture(),open:[{direction:'PUT'}]}).skip,'ladoOposto');});
test('contrato precisa 240–300 segundos, sem expiração curta',()=>{assert(expirationAllowed(1300,1000));assert(expirationAllowed(1300,1060));assert(!expirationAllowed(1300,1061));assert(!expirationAllowed(1300,1299));assert(!expirationAllowed(1400,1000));});

test('integração: wrapper real aprova sinal na janela e veta contrato curto',async()=>{
 const {evaluateEntry,ClosedCandles}=await import('../ws-otc-v21.mjs');const f=fixture();
 const buffer=new ClosedCandles(5);
 for(const b of f.ticks)buffer.ingest({from:b.atMs/1000,open:b.open,close:b.close,max:b.high,min:b.low},now);
 assert.equal(buffer.ticks.length,360);
 assert.equal(evaluateEntry({ticks:buffer.ticks,open:[],regime15m:f.context,now}).skip,null);
 const shifted=f.ticks.map(b=>({...b,atMs:b.atMs+90000}));
 assert.equal(evaluateEntry({ticks:shifted,open:[],regime15m:{...f.context,lastClosedAt:now+90000},now:now+90000}).skip,'janelaExpiracaoMenor240s');
});

test('pipeline maybeTrade envia exatamente as gêmeas, com snapshot e prazo válido',async()=>{
 const fs=await import('node:fs'),vm=await import('node:vm');
 const {evaluateEntry}=await import('../ws-otc-v21.mjs');const {computeExpiration}=await import('../iqoption-ws.mjs');
 const source=fs.readFileSync(new URL('../ws-otc-v21.mjs',import.meta.url),'utf8');
 const start=source.indexOf('function maybeTrade('),body=source.slice(start,source.indexOf('\n}',start)+2);
 const f=fixture(),decision=evaluateEntry({ticks:f.ticks,open:[],regime15m:f.context,now});
 const orders=[],s={name:'Teste',key:'TEST',cycleOps:0};
 const ctx={warmupDone:true,running:new Map([[1,{bootstrapStatus:'READY'}]]),state:{TEST:s},buf5s:new Map([[1,{key:'TEST'}]]),
 planTrade:()=>({...decision,kind:'signal'}),BASE_STAKE:2,MAX_STAKE:30,canTrade:()=>s,nowMs:()=>now,computeExpiration,EXPIRATION_MIN:5,expirationAllowed,nextCycleId:()=>1,
 ws:{uuid:()=>String(orders.length+1)},sendOrder:(...args)=>{orders.push(args);return {};},shortName:x=>x,currencySymbol:'$',logLine:()=>{},sessionLog:()=>{},fmt:x=>x,cycleStats:{cycles:{total:0}},saveResults:()=>{}};
 vm.createContext(ctx);vm.runInContext(body,ctx);ctx.maybeTrade(1);
 assert.equal(orders.length,2);assert.deepEqual(orders.map(o=>o[6]),['cash','runner']);assert(orders.every(o=>o[1]==='CALL'&&o[2]===2));
 assert.equal(s.entrySnapshot.strategy,'V22_CONTEXT30_PULLBACK_5M');assert.equal(s.entrySnapshot.durationSeconds,300);
 ctx.maybeTrade(1);assert.equal(orders.length,2,'mesmo candle não reenvia');
});
