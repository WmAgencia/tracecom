/* TRACECON content script — tenta identificar a plataforma/ativo/timeframe
 * da corretora real quando tecnicamente possível. Detecta apenas padrões
 * verificáveis (marcadores no DOM da plataforma) — nunca "adivinha".
 * Se não detectar, o usuário confirma/ajusta manualmente no side panel. */

function detect() {
  const url = location.hostname;
  let platform = null;

  if (/tradingview\.com$/i.test(url)) platform = "TradingView";
  else if (/binance\.com$/i.test(url) || /binance\.com/i.test(url)) platform = "Binance";
  else if (/exodus\.com$/i.test(url)) platform = "Exodus";

  // Símbolo: procura em URIs/elementos conhecidos da plataforma.
  let symbol = null;
  let timeframe = null;

  // Binance klines URL: /en/trade/BTCUSDT ... /pair/BTC_USDT
  const m = location.pathname.match(/\/(?:trade|pair)\/([A-Z0-9_]{4,20})/i);
  if (m) symbol = m[1].replace("_", "");

  // TradingView symbol query (ex.: ?symbol=BINANCE:BTCUSDT&interval=60)
  const params = new URLSearchParams(location.search);
  const tvSym = params.get("symbol");
  if (tvSym) symbol = tvSym.split(":").pop();
  const tvIv = params.get("interval");
  if (tvIv) timeframe = tvIntervalToTracecon(tvIv);

  // Marcadores de DOM (TradingView).
  if (!symbol) {
    const chartEl = document.querySelector('[data-symbol]');
    if (chartEl) symbol = chartEl.getAttribute("data-symbol");
  }

  return { platform, symbol, timeframe };
}

function tvIntervalToTracecon(interval) {
  // TradingView intervals: 1, 3, 5, 15, 60, 240, 1D, 1W
  const map = { "1": "1m", "3": "3m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "1D": "1d", "1W": "1w" };
  const k = String(interval);
  return (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : k);
}

// Envia a detecção ao lado da extensão quando solicitado.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "TRACECON_DETECT") {
    sendResponse(detect());
  }
  return true;
});
