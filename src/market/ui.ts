/**
 * Plain HTTP market status server (UI mínima técnica).
 *
 * Serve uma página HTML que exibe: provider, status, symbol, timeframe,
 * último preço, último candle, última atualização, latência, qualidade e
 * status do streaming. Controles: Conectar, Desconectar, Inscrever, Cancelar.
 *
 * Sem dados reais, a UI mostra claramente "sem dados" (PROVIDER_NOT_CONFIGURED
 * / aguardando) — nunca valores falsos.
 */
import { createServer } from "node:http";
import type { EnvConfig } from "../config/env";
import type { MarketRuntime } from "./runtime";

const HTML = String.raw`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<title>TRACECON · Market Data</title>
<style>
body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0e1117;color:#e6e6e6;margin:0;padding:24px}
h1{font-size:18px;margin:0 0 4px}.sub{color:#7a8494;font-size:12px;margin-bottom:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.card{background:#161b24;border:1px solid #232b38;border-radius:10px;padding:14px}
.label{color:#7a8494;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.value{font-size:22px;margin-top:6px;font-weight:600}
.ok{color:#3fb950}.warn{color:#d29922}.err{color:#f85149}.dim{color:#7a8494}
.btns{display:flex;gap:8px;margin:20px 0;flex-wrap:wrap}
button{background:#1f6feb;color:#fff;border:none;border-radius:8px;padding:8px 14px;font:inherit;cursor:pointer}
button.sec{background:#21262d;border:1px solid #30363d;color:#c9d1d9}
select,input{background:#0d1117;color:#e6e6e6;border:1px solid #30363d;border-radius:8px;padding:8px;font:inherit}
#log{background:#0d1117;border:1px solid #232b38;border-radius:8px;padding:12px;height:180px;overflow:auto;font-size:12px;white-space:pre}
#noData{color:#f85149;font-weight:600;margin-top:8px}
</style></head><body>
<h1>TRACECON · Market Data (técnico)</h1>
<div class="sub">Pipeline real-time. Sem dados reais ⇒ nada é exibido como se fosse dado.</div>
<div class="cards">
  <div class="card"><div class="label">Provider</div><div class="value" id="provider">—</div><div id="providerState" class="sub">disconnected</div></div>
  <div class="card"><div class="label">Último preço</div><div class="value" id="price">—</div></div>
  <div class="card"><div class="label">Último candle (fechado)</div><div class="value" id="lastClose">—</div><div class="sub" id="lastCloseTs">—</div></div>
  <div class="card"><div class="label">Qualidade</div><div class="value" id="quality">—</div></div>
  <div class="card"><div class="label">Freshness</div><div class="value" id="freshness">—</div></div>
  <div class="card"><div class="label">Latência (último tick)</div><div class="value" id="latency">—</div></div>
  <div class="card"><div class="label">Volume</div><div class="value" id="volume">—</div></div>
</div>
<div id="noData" style="display:none">Aguardando dados reais… (nenhum dado é estimado)</div>

<div class="btns">
  <button onclick="op('connect')">Conectar</button>
  <button class="sec" onclick="op('disconnect')">Desconectar</button>
  <select id="symbol" onchange="setSymbol()"><option>BTCUSDT</option><option>ETHUSDT</option><option>SOLUSDT</option><option>BNBUSDT</option></select>
  <select id="timeframe"><option>1m</option><option>3m</option><option>5m</option><option>15m</option><option>1h</option><option>4h</option><option>1d</option></select>
  <button onclick="subscribe()">Assinar</button>
  <button class="sec" onclick="unsubscribe()">Cancelar assinatura</button>
</div>
<div class="label" style="margin:8px 0">Log</div><div id="log"></div>
<script>
const $=id=>document.getElementById(id);
function log(m){const d=document.createElement('div');d.textContent=new Date().toISOString()+'  '+m;$('log').prepend(d);}
function setSymbol(){$('symbol').value=$('symbol').value;}
async function op(a){try{const r=await fetch('/api/'+a,{method:'POST'});const j=await r.json();log(a+' → '+JSON.stringify(j));refresh();}catch(e){log('op '+a+' err '+e);}}
async function subscribe(){const b=await fetch('/api/subscribe?symbol='+$('symbol').value+'&timeframe='+$('timeframe').value,{method:'POST'});log('subscribe → '+JSON.stringify(await b.json()));refresh();}
async function unsubscribe(){const b=await fetch('/api/unsubscribe?symbol='+$('symbol').value,{method:'POST'});log('unsubscribe → '+JSON.stringify(await b.json()));}
function fz(v){return v===null||v===undefined?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:4});}
async function refresh(){try{const r=await fetch('/api/status');const j=await r.json();
 $('provider').textContent=j.provider||'—';$('providerState').textContent=j.state||'—';
 $('price').textContent=j.currentPrice!=null?fz(j.currentPrice):'—';
 $('lastClose').textContent=j.lastClose!=null?fz(j.lastClose):'—';
 $('lastCloseTs').textContent=j.lastCloseTs?new Date(j.lastCloseTs).toISOString():'—';
 $('quality').textContent=j.quality||'—';$('freshness').textContent=j.freshness||'—';
 $('latency').textContent=j.latency!=null?(j.latency+' ms'):'—';$('volume').textContent=j.volume!=null?fz(j.volume):'—';
 $('noData').style.display=j.available?'none':'block';
}catch(e){log('refresh err '+e);}}
setInterval(refresh,1500);refresh();
</script></body></html>`;

export function startMarketServer(runtime: MarketRuntime, config: Pick<EnvConfig, "nodeEnv">, port = 8787): { close(): void } {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const path = url.pathname;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    serveJson(res, () => route(runtime, path, url));
  });

  function route(rt: MarketRuntime, path: string, url: URL) {
    if (path === "/" || path === "/index.html") {
      return { text: HTML, contentType: "text/html" };
    }
    if (path === "/api/connect") {
      return rt.start().then(() => ({ ok: true }));
    }
    if (path === "/api/disconnect") {
      rt.stop();
      return { ok: true };
    }
    if (path === "/api/subscribe") {
      const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
      const timeframe = (url.searchParams.get("timeframe") ?? "1m") as "1m";
      return rt.start().then(() => ({ ok: true, symbol, timeframe }));
    }
    if (path === "/api/unsubscribe") {
      rt.stop();
      return { ok: true };
    }
    if (path === "/api/status") {
      return statusFor(rt).catch(() => statusOffline(rt));
    }
    return { error: "not_found", status: 404 };
  }

  function statusFor(rt: MarketRuntime) {
    if (!rt.configured || !rt.pipeline) {
      return Promise.resolve({
        provider: rt.provider?.id ?? "none",
        state: "PROVIDER_NOT_CONFIGURED",
        available: false, currentPrice: null, lastClose: null, lastCloseTs: null,
        quality: "unknown", freshness: "unavailable", latency: null, volume: null,
      });
    }
    const symbolMap = rt.pipeline.state;
    const sym = symbolMap.getCandles("BTCUSDT", "1m").at(-1);
    return rt.service.getMarketData({ symbol: "BTCUSDT", timeframe: "1m" }).then((md) => {
      const tick = rt.pipeline!.state.getSymbol(rt.provider!.id, "BTCUSDT", "1m")?.lastTick;
      return {
        provider: md.provider,
        state: rt.provider!.getStatus(),
        available: md.available,
        currentPrice: md.currentPrice,
        lastClose: md.latestClosedCandle?.close ?? null,
        lastCloseTs: md.latestClosedCandle?.timestamp ?? null,
        quality: md.quality,
        freshness: md.freshness,
        latency: tick ? tick.receivedAt - tick.timestamp : null,
        volume: md.volume,
      };
      void sym;
    });
  }
  function statusOffline(rt: MarketRuntime) {
    return {
      provider: rt.provider?.id ?? "none",
      state: "disconnected",
      available: false, currentPrice: null, lastClose: null, lastCloseTs: null,
      quality: "unknown", freshness: "unavailable", latency: null, volume: null,
    };
  }

  server.listen(port, () => {
    console.log(`[market-ui] http://localhost:${port}  (env=${config.nodeEnv})`);
  });
  return { close: () => server.close() };
}

function serveJson(res: import("node:http").ServerResponse, fn: () => unknown | Promise<unknown>): void {
  Promise.resolve(fn())
    .then((obj) => {
      if (obj && typeof obj === "object" && "text" in (obj as object)) {
        const o = obj as { text: string; contentType: string };
        res.setHeader("Content-Type", o.contentType);
        res.end(o.text);
        return;
      }
      const o = obj as { status?: number };
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.statusCode = o?.status ?? 200;
      res.end(JSON.stringify(obj));
    })
    .catch((e) => {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    });
}
