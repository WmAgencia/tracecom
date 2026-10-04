// Funções puras: timestamps de abertura em ms, somente OHLC fechado.
export const STRATEGY_VERSION = 'V22_CONTEXT30_PULLBACK_5M';
const time = b => b.atMs ?? b.at;
export function validWindow(ticks, sizeMs, count, now) {
  if (!Array.isArray(ticks) || ticks.length < count) return false;
  const bars = ticks.slice(-count);
  return bars.every((b, i) => [b.open,b.high,b.low,b.close,time(b)].every(Number.isFinite)
    && b.low > 0 && b.high >= Math.max(b.open,b.close) && b.low <= Math.min(b.open,b.close)
    && time(b) + sizeMs <= now && (!i || time(b)-time(bars[i-1]) === sizeMs))
    && now - (time(bars.at(-1)) + sizeMs) <= sizeMs * 2;
}
export function ema(values, n) {
  return values.reduce((a,v) => a === null ? v : a + 2/(n+1)*(v-a), null);
}
export function rsiWilder(ticks, n=14) {
  if (ticks.length <= n) return null;
  let gain=0,loss=0;
  for(let i=1;i<ticks.length;i++) {
    const d=ticks[i].close-ticks[i-1].close, g=Math.max(d,0), l=Math.max(-d,0);
    if(i<=n){gain+=g/n;loss+=l/n;}else{gain=(gain*(n-1)+g)/n;loss=(loss*(n-1)+l)/n;}
  }
  return loss===0 ? (gain===0?50:100) : 100-100/(1+gain/loss);
}
export function dmi(ticks,n=14) {
  let tr=0,up=0,down=0,adx=null;const dx=[];
  for(let i=1;i<ticks.length;i++) {
    const b=ticks[i],p=ticks[i-1],u=b.high-p.high,d=p.low-b.low;
    const t=Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close));
    const plus=u>0&&u>d?u:0,minus=d>0&&d>u?d:0;
    if(i<=n){tr+=t;up+=plus;down+=minus;}else{tr=tr-tr/n+t;up=up-up/n+plus;down=down-down/n+minus;}
    if(i>=n){const sum=up+down;dx.push(sum?100*Math.abs(up-down)/sum:0);}
  }
  if(dx.length>=n){adx=dx.slice(0,n).reduce((a,b)=>a+b,0)/n;for(const x of dx.slice(n))adx=(adx*(n-1)+x)/n;}
  return {atr:tr/n,plusDI:tr?100*up/tr:0,minusDI:tr?100*down/tr:0,adx};
}
export function trend(bars, minSpread=.01) {
  const c=bars.map(b=>b.close),fast=ema(c,8),slow=ema(c,21);
  const spreadPct=slow ? (fast-slow)/slow*100 : 0;
  return {direction:spreadPct>=minSpread?'CALL':spreadPct<=-minSpread?'PUT':null,spreadPct};
}
export function zones(bars) {
  const result=[];
  // Dois candles posteriores já fechados confirmam cada pivô.
  for(let i=2;i<bars.length-2;i++) {
    const others=bars.slice(i-2,i+3).filter((_,j)=>j!==2),b=bars[i];
    if(others.every(x=>b.low<x.low))result.push({kind:'support',price:b.low,at:time(b),confirmedAt:time(bars[i+2])+60000});
    if(others.every(x=>b.high>x.high))result.push({kind:'resistance',price:b.high,at:time(b),confirmedAt:time(bars[i+2])+60000});
  }
  return result;
}
export function context30(ticks,now=Date.now(),settings={}) {
  const empty={direction:'lateral15m',source:'context30-1m',spreadPct:0,candles:0,ready:false,zones:[]};
  if(!validWindow(ticks,60000,60,now))return {...empty,skip:'contextoIncompletoOuStale'};
  const bars=ticks.slice(-30), broad=trend(bars,settings.contextMinSpreadPct??.01);
  const recent=trend(ticks.slice(-10),settings.recentMinSpreadPct??.005);
  const old=ema(bars.slice(0,-3).map(b=>b.close),8),current=ema(bars.map(b=>b.close),8);
  const direction=broad.direction==='CALL'&&current>old?'alta15m':broad.direction==='PUT'&&current<old?'baixa15m':'lateral15m';
  return {...empty,ready:true,direction,recentDirection:recent.direction,spreadPct:broad.spreadPct,candles:30,
    computedAt:now,lastClosedAt:time(ticks.at(-1))+60000,zones:zones(bars),atr:dmi(ticks).atr};
}
export function entryPullback({ticks,open=[],context,now=Date.now(),settings={}}) {
  const skip=reason=>({skip:reason});
  if(!validWindow(ticks,5000,360,now))return skip('historico5sIncompletoOuStale');
  if(!context?.ready || !Number.isFinite(context.lastClosedAt) || now-context.lastClosedAt>120000 || context.lastClosedAt>now)return skip('contextoIncompletoOuStale');
  const direction=context.direction==='alta15m'?'CALL':context.direction==='baixa15m'?'PUT':null;
  if(!direction)return skip('contextoLateral');
  if(context.recentDirection!==direction)return skip('tendencia1mContraOuLateral');
  const local=trend(ticks.slice(-50),settings.trendMinEmaSpreadPct??.01);
  if(local.direction!==direction)return skip('tendencia5sContraOuLateral');
  if(open.some(o=>o.direction!==direction))return skip('ladoOposto');
  const indicators=dmi(ticks),rsi=rsiWilder(ticks),prevRsi=rsiWilder(ticks.slice(0,-1));
  if(indicators.adx===null||indicators.adx<(settings.adxMin??20))return skip('adxFraco');
  const call=direction==='CALL';
  if(call ? indicators.plusDI<=indicators.minusDI : indicators.minusDI<=indicators.plusDI)return skip('diContra');
  const last=ticks.at(-1),prev=ticks.at(-2),pull=ticks.slice(-13,-1);
  const recentRsi=pull.map((_,i)=>rsiWilder(ticks.slice(0,ticks.length-13+i+1)));
  if(!recentRsi.some(x=>call?x<=(settings.pullbackRsiCall??45):x>=(settings.pullbackRsiPut??55)))return skip('semPullbackRSI');
  if(call ? !(rsi>prevRsi&&rsi>45&&rsi<70) : !(rsi<prevRsi&&rsi<55&&rsi>30))return skip('semRetomadaRSI');
  if(call ? !(last.close>last.open&&last.close>prev.high) : !(last.close<last.open&&last.close<prev.low))return skip('semRetomadaPreco');
  const atr=context.atr;
  if(!Number.isFinite(atr)||atr<=0)return skip('atrInvalido');
  const relevant=(context.zones??[]).filter(z=>z.kind===(call?'support':'resistance')&&z.confirmedAt<=time(pull[0]));
  const zone=relevant.find(z=>pull.some(b=>Math.abs((call?b.low:b.high)-z.price)<=atr*.35)
    && pull.concat(last).every(b=>call?b.close>=z.price-atr*.5:b.close<=z.price+atr*.5)
    && Math.abs(last.close-z.price)<=atr*1.5);
  if(!zone)return skip('semZonaConfirmadaOuRompida');
  const obstacle=(context.zones??[]).some(z=>z.kind===(call?'resistance':'support')&&(call?z.price>last.close&&z.price-last.close<atr*.5:z.price<last.close&&last.close-z.price<atr*.5));
  if(obstacle)return skip('obstaculoProximo');
  return {skip:null,direction,reason:`${STRATEGY_VERSION}|context=${context.direction}|recent=${context.recentDirection}|trend5s=${local.direction}|RSI=${rsi.toFixed(2)}|ADX=${indicators.adx.toFixed(2)}|zone=${zone.price}`,snapshot:{strategy:STRATEGY_VERSION,context,rsi,prevRsi,...indicators,zone,signalAt:time(last)}};
}
export function expirationAllowed(expiration,nowSec,minSeconds=240){return Number.isFinite(expiration)&&expiration-nowSec>=minSeconds&&expiration-nowSec<=300;}
