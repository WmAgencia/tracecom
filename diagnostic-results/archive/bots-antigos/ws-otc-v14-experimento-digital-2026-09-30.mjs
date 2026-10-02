/**
 * OTC BOT v14 - TODOS OS OTCs 24H
 * ================================
 * Usa TODOS os 178 ativos OTC disponíveis
 * Técnicas da v13: Fade4 + RSI + Martingale + Auto-flip + Learning
 * Funciona 24 horas (OTC aberto sempre)
 */
import https from 'https';
import fs from 'fs';
import CONFIG from './bot-config-v13.json' with { type: 'json' };
import { IqWsClient, computeExpiration, normalizeCandle } from './iqoption-ws.mjs';

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────
const LOGIN = CONFIG.login;
const LR = { minOps: 10, confidenceLevel: 0.55 };
const EX = { expirationMinutes: 2, reportIntervalMs: 300_000 };
const ES = { checkIntervalMs: 15_000, minProfit: 0.3, minHoldSeconds: 30, peakProfitWindowMs: 120_000 };
const C = { maxConcurrentOps: 3 };
const RSI = { period: 14, callThreshold: 35, putThreshold: 65 };

// ─────────────────────────────────────────────
// WHITELIST - TODOS OS 178 OTICs
// ─────────────────────────────────────────────
const ALL_OTCS = [
  { key: 'EURUSD', name: 'front.EURUSD-OTC', id: 76 },
  { key: 'EURGBP', name: 'front.EURGBP-OTC', id: 77 },
  { key: 'USDCHF', name: 'front.USDCHF-OTC', id: 78 },
  { key: 'EURJPY', name: 'front.EURJPY-OTC', id: 79 },
  { key: 'NZDUSD', name: 'front.NZDUSD-OTC', id: 80 },
  { key: 'GBPUSD', name: 'front.GBPUSD-OTC', id: 81 },
  { key: 'GBPJPY', name: 'front.GBPJPY-OTC', id: 84 },
  { key: 'USDJPY', name: 'front.USDJPY-OTC', id: 85 },
  { key: 'AUDCAD', name: 'front.AUDCAD-OTC', id: 86 },
  { key: 'USDZAR', name: 'front.USDZAR-OTC', id: 1380 },
  { key: 'USDSGD', name: 'front.USDSGD-OTC', id: 1381 },
  { key: 'USDHKD', name: 'front.USDHKD-OTC', id: 1382 },
  { key: 'XAUUSD', name: 'front.XAUUSD-OTC', id: 1857 },
  { key: 'XAGUSD', name: 'front.XAGUSD-OTC', id: 1858 },
  { key: 'USOUSD', name: 'front.USOUSD-OTC', id: 1859 },
  { key: 'XNGUSD', name: 'front.XNGUSD-OTC', id: 1863 },
  { key: 'UKOUSD', name: 'front.UKOUSD-OTC', id: 1931 },
  { key: 'GOOGLE', name: 'front.GOOGLE-OTC', id: 1933 },
  { key: 'AMAZON', name: 'front.AMAZON-OTC', id: 1935 },
  { key: 'TESLA', name: 'front.TESLA-OTC', id: 1936 },
  { key: 'FB', name: 'front.FB-OTC', id: 1937 },
  { key: 'APPLE', name: 'front.APPLE-OTC', id: 1938 },
  { key: 'ETHUSD', name: 'front.ETHUSD-OTC', id: 1941 },
  { key: 'SP500', name: 'front.SP500-OTC', id: 1971 },
  { key: 'USNDAQ100', name: 'front.USNDAQ100-OTC', id: 1972 },
  { key: 'US30', name: 'front.US30-OTC', id: 1973 },
  { key: 'CARDANO', name: 'front.CARDANO-OTC', id: 1974 },
  { key: 'SHIBUSD', name: 'front.SHIBUSD-OTC', id: 1975 },
  { key: 'TRON', name: 'front.TRON-OTC', id: 1976 },
  { key: 'DOGECOIN', name: 'front.DOGECOIN-OTC', id: 1977 },
  { key: 'SOLUSD', name: 'front.SOLUSD-OTC', id: 1978 },
  { key: 'SP35', name: 'front.SP35-OTC', id: 2044 },
  { key: 'FR40', name: 'front.FR40-OTC', id: 2045 },
  { key: 'GER30', name: 'front.GER30-OTC', id: 2046 },
  { key: 'UK100', name: 'front.UK100-OTC', id: 2047 },
  { key: 'AUS200', name: 'front.AUS200-OTC', id: 2048 },
  { key: 'HK33', name: 'front.HK33-OTC', id: 2049 },
  { key: 'EU50', name: 'front.EU50-OTC', id: 2050 },
  { key: 'JP225', name: 'front.JP225-OTC', id: 2051 },
  { key: 'US30/JP225', name: 'front.US30/JP225-OTC', id: 2079 },
  { key: 'US100/JP225', name: 'front.US100/JP225-OTC', id: 2080 },
  { key: 'US500/JP225', name: 'front.US500/JP225-OTC', id: 2081 },
  { key: 'AMZN/ALIBABA', name: 'front.AMZN/ALIBABA-OTC', id: 2082 },
  { key: 'AMZN/EBAY', name: 'front.AMZN/EBAY-OTC', id: 2083 },
  { key: 'NVDA/AMD', name: 'front.NVDA/AMD-OTC', id: 2084 },
  { key: 'GOOGLE/MSFT', name: 'front.GOOGLE/MSFT-OTC', id: 2085 },
  { key: 'XAU/XAG', name: 'front.XAU/XAG-OTC', id: 2086 },
  { key: 'TESLA/FORD', name: 'front.TESLA/FORD-OTC', id: 2087 },
  { key: 'MSFT/AAPL', name: 'front.MSFT/AAPL-OTC', id: 2088 },
  { key: 'INTEL/IBM', name: 'front.INTEL/IBM-OTC', id: 2089 },
  { key: 'NFLX/AMZN', name: 'front.NFLX/AMZN-OTC', id: 2090 },
  { key: 'GER30/UK100', name: 'front.GER30/UK100-OTC', id: 2093 },
  { key: 'META/GOOGLE', name: 'front.META/GOOGLE-OTC', id: 2094 },
  { key: 'BIDU', name: 'front.BIDU-OTC', id: 2097 },
  { key: 'INTEL', name: 'front.INTEL-OTC', id: 2098 },
  { key: 'MSFT', name: 'front.MSFT-OTC', id: 2099 },
  { key: 'CITI', name: 'front.CITI-OTC', id: 2100 },
  { key: 'COKE', name: 'front.COKE-OTC', id: 2101 },
  { key: 'JPM', name: 'front.JPM-OTC', id: 2102 },
  { key: 'MCDON', name: 'front.MCDON-OTC', id: 2103 },
  { key: 'MORSTAN', name: 'front.MORSTAN-OTC', id: 2104 },
  { key: 'NIKE', name: 'front.NIKE-OTC', id: 2105 },
  { key: 'ALIBABA', name: 'front.ALIBABA-OTC', id: 2106 },
  { key: 'XRPUSD', name: 'front.XRPUSD-OTC', id: 2107 },
  { key: 'US2000', name: 'front.US2000-OTC', id: 2108 },
  { key: 'AIG', name: 'front.AIG-OTC', id: 2109 },
  { key: 'GS', name: 'front.GS-OTC', id: 2110 },
  { key: 'AUDUSD', name: 'front.AUDUSD-OTC', id: 2111 },
  { key: 'USDCAD', name: 'front.USDCAD-OTC', id: 2112 },
  { key: 'AUDJPY', name: 'front.AUDJPY-OTC', id: 2113 },
  { key: 'GBPCAD', name: 'front.GBPCAD-OTC', id: 2114 },
  { key: 'GBPCHF', name: 'front.GBPCHF-OTC', id: 2115 },
  { key: 'GBPAUD', name: 'front.GBPAUD-OTC', id: 2116 },
  { key: 'EURCAD', name: 'front.EURCAD-OTC', id: 2117 },
  { key: 'CHFJPY', name: 'front.CHFJPY-OTC', id: 2118 },
  { key: 'CADCHF', name: 'front.CADCHF-OTC', id: 2119 },
  { key: 'EURAUD', name: 'front.EURAUD-OTC', id: 2120 },
  { key: 'USDNOK', name: 'front.USDNOK-OTC', id: 2121 },
  { key: 'EURNZD', name: 'front.EURNZD-OTC', id: 2122 },
  { key: 'USDSEK', name: 'front.USDSEK-OTC', id: 2123 },
  { key: 'USDTRY', name: 'front.USDTRY-OTC', id: 2124 },
  { key: 'SNAP', name: 'front.SNAP-OTC', id: 2125 },
  { key: 'LTCUSD', name: 'front.LTCUSD-OTC', id: 2126 },
  { key: 'EOSUSD', name: 'front.EOSUSD-OTC', id: 2127 },
  { key: 'USDPLN', name: 'front.USDPLN-OTC', id: 2128 },
  { key: 'AUDCHF', name: 'front.AUDCHF-OTC', id: 2129 },
  { key: 'AUDNZD', name: 'front.AUDNZD-OTC', id: 2130 },
  { key: 'EURCHF', name: 'front.EURCHF-OTC', id: 2131 },
  { key: 'GBPNZD', name: 'front.GBPNZD-OTC', id: 2132 },
  { key: 'CADJPY', name: 'front.CADJPY-OTC', id: 2136 },
  { key: 'NZDCAD', name: 'front.NZDCAD-OTC', id: 2137 },
  { key: 'NZDJPY', name: 'front.NZDJPY-OTC', id: 2138 },
  { key: 'ICPUSD', name: 'front.ICPUSD-OTC', id: 2139 },
  { key: 'IMXUSD', name: 'front.IMXUSD-OTC', id: 2140 },
  { key: 'JUPUSD', name: 'front.JUPUSD-OTC', id: 2141 },
  { key: 'BONKUSD', name: 'front.BONKUSD-OTC', id: 2142 },
  { key: 'LINKUSD', name: 'front.LINKUSD-OTC', id: 2143 },
  { key: 'WIFUSD', name: 'front.WIFUSD-OTC', id: 2144 },
  { key: 'PEPEUSD', name: 'front.PEPEUSD-OTC', id: 2145 },
  { key: 'FLOKIUSD', name: 'front.FLOKIUSD-OTC', id: 2146 },
  { key: 'BCHUSD', name: 'front.BCHUSD-OTC', id: 2148 },
  { key: 'DOTUSD', name: 'front.DOTUSD-OTC', id: 2149 },
  { key: 'ATOMUSD', name: 'front.ATOMUSD-OTC', id: 2150 },
  { key: 'INJUSD', name: 'front.INJUSD-OTC', id: 2151 },
  { key: 'SEIUSD', name: 'front.SEIUSD-OTC', id: 2152 },
  { key: 'IOTAUSD', name: 'front.IOTAUSD-OTC', id: 2153 },
  { key: 'DASHUSD', name: 'front.DASHUSD-OTC', id: 2155 },
  { key: 'ARBUSD', name: 'front.ARBUSD-OTC', id: 2156 },
  { key: 'WLDUSD', name: 'front.WLDUSD-OTC', id: 2157 },
  { key: 'ORDIUSD', name: 'front.ORDIUSD-OTC', id: 2158 },
  { key: 'SATSUSD', name: 'front.SATSUSD-OTC', id: 2159 },
  { key: 'PYTHUSD', name: 'front.PYTHUSD-OTC', id: 2160 },
  { key: 'RONINUSD', name: 'front.RONINUSD-OTC', id: 2161 },
  { key: 'TIAUSD', name: 'front.TIAUSD-OTC', id: 2162 },
  { key: 'MANAUSD', name: 'front.MANAUSD-OTC', id: 2163 },
  { key: 'SANDUSD', name: 'front.SANDUSD-OTC', id: 2164 },
  { key: 'GRTUSD', name: 'front.GRTUSD-OTC', id: 2165 },
  { key: 'STXUSD', name: 'front.STXUSD-OTC', id: 2166 },
  { key: 'MATICUSD', name: 'front.MATICUSD-OTC', id: 2167 },
  { key: 'NEARUSD', name: 'front.NEARUSD-OTC', id: 2168 },
  { key: 'EURTHB', name: 'front.EURTHB-OTC', id: 2181 },
  { key: 'USDTHB', name: 'front.USDTHB-OTC', id: 2182 },
  { key: 'JPYTHB', name: 'front.JPYTHB-OTC', id: 2183 },
  { key: 'USDARS', name: 'front.USDARS-OTC', id: 2186 },
  { key: 'USDDOP', name: 'front.USDDOP-OTC', id: 2188 },
  { key: 'TRUMPUSD', name: 'front.TRUMPUSD-OTC', id: 2265 },
  { key: 'MELANIAUSD', name: 'front.MELANIAUSD-OTC', id: 2267 },
  { key: 'BTCUSD-op', name: 'front.BTCUSD-OTC-op', id: 2270 },
  { key: 'ONDOUSD', name: 'front.ONDOUSD-OTC', id: 2276 },
  { key: 'DYDXUSD', name: 'front.DYDXUSD-OTC', id: 2277 },
  { key: 'ONYXCOINUSD', name: 'front.ONYXCOINUSD-OTC', id: 2278 },
  { key: 'FARTCOINUSD', name: 'front.FARTCOINUSD-OTC', id: 2279 },
  { key: 'PENGUUSD', name: 'front.PENGUUSD-OTC', id: 2280 },
  { key: 'RAYDIUMUSD', name: 'front.RAYDIUMUSD-OTC', id: 2286 },
  { key: 'SUIUSD', name: 'front.SUIUSD-OTC', id: 2287 },
  { key: 'HBARUSD', name: 'front.HBARUSD-OTC', id: 2288 },
  { key: 'FETUSD', name: 'front.FETUSD-OTC', id: 2289 },
  { key: 'RENDERUSD', name: 'front.RENDERUSD-OTC', id: 2290 },
  { key: 'TAOUSD', name: 'front.TAOUSD-OTC', id: 2291 },
  { key: 'USDBRL', name: 'front.USDBRL-OTC', id: 2298 },
  { key: 'USDCOP', name: 'front.USDCOP-OTC', id: 2299 },
  { key: 'USDMXN', name: 'front.USDMXN-OTC', id: 2300 },
  { key: 'PENUSD', name: 'front.PENUSD-OTC', id: 2301 },
  { key: 'LABUBUUSD', name: 'front.LABUBUUSD-OTC', id: 2304 },
  { key: 'KLARNA', name: 'front.KLARNA-OTC', id: 2311 },
  { key: 'FWONA', name: 'front.FWONA-OTC', id: 2312 },
  { key: 'PLTR', name: 'front.PLTR-OTC', id: 2313 },
  { key: 'MAGNIFICENT7', name: 'front.MAGNIFICENT7-OTC', id: 2319 },
  { key: 'AIRLINES', name: 'front.AIRLINES-OTC', id: 2320 },
  { key: 'CASINOS', name: 'front.CASINOS-OTC', id: 2321 },
  { key: 'CANNABIS', name: 'front.CANNABIS-OTC', id: 2322 },
  { key: 'URANIUM', name: 'front.URANIUM-OTC', id: 2323 },
  { key: 'XPTUSD', name: 'front.XPTUSD-OTC', id: 2327 },
  { key: 'XPDUSD', name: 'front.XPDUSD-OTC', id: 2328 },
  { key: 'MU', name: 'front.MU-OTC', id: 2402 },
  { key: 'NVDA', name: 'front.NVDA-OTC', id: 2403 },
  { key: 'GEV', name: 'front.GEV-OTC', id: 2404 },
  { key: 'SNDK', name: 'front.SNDK-OTC', id: 2407 },
  { key: 'WDC', name: 'front.WDC-OTC', id: 2408 },
  { key: 'USDIDR', name: 'front.USDIDR-OTC', id: 2409 },
  { key: 'COCOA', name: 'front.COCOA-OTC', id: 2414 },
  { key: 'COFFEE', name: 'front.COFFEE-OTC', id: 2415 },
  { key: 'COTTON', name: 'front.COTTON-OTC', id: 2416 },
  { key: 'SUGAR', name: 'front.SUGAR-OTC', id: 2417 },
  { key: 'LUNA', name: 'front.LUNA-OTC', id: 2430 },
  { key: 'USDSAR', name: 'front.USDSAR-OTC', id: 2431 },
  { key: 'USDMYR', name: 'front.USDMYR-OTC', id: 2432 },
  { key: 'USDAED', name: 'front.USDAED-OTC', id: 2433 },
  { key: 'USDVND', name: 'front.USDVND-OTC', id: 2434 },
  { key: 'USDNGN', name: 'front.USDNGN-OTC', id: 2435 },
  { key: 'USDPHP', name: 'front.USDPHP-OTC', id: 2436 },
  { key: 'USDBOB', name: 'front.USDBOB-OTC', id: 2437 },
  { key: 'USDCLP', name: 'front.USDCLP-OTC', id: 2438 },
  { key: 'USDBDT', name: 'front.USDBDT-OTC', id: 2439 },
  { key: 'SpaceX', name: 'front.SpaceX-OTC', id: 2443 },
  { key: 'HYPE', name: 'front.HYPE-OTC', id: 2448 },
  { key: 'Anthropic', name: 'front.Anthropic-OTC', id: 2451 },
  { key: 'OpenAI', name: 'front.OpenAI-OTC', id: 2452 },
];

// ─────────────────────────────────────────────
// HTTP HELPERS
// ─────────────────────────────────────────────
function httpReq(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function loginIQ() {
  const data = JSON.stringify({ identifier: LOGIN.email, password: LOGIN.password });
  const res = await httpReq({
    hostname: 'api.iqoption.com', path: '/v2/login', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Origin': 'https://iqoption.com', 'Referer': 'https://iqoption.com/' },
  }, data);
  const j = JSON.parse(res.body);
  return j.ssid ?? j.result?.ssid;
}

// ─────────────────────────────────────────────
// RSI CALCULATION
// ─────────────────────────────────────────────
function calcRSI(ticks, period = RSI.period) {
  if (ticks.length < period + 1) return 50;
  const closes = ticks.map(t => t.close);
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) gains += delta;
    else losses += Math.abs(delta);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

// ─────────────────────────────────────────────
// WILSON SCORE for confidence interval
// ─────────────────────────────────────────────
function wilsonCI(wins, total, z = 1.645) {
  if (total === 0) return { wr: 50, lower: 0, upper: 100 };
  const p = wins / total;
  const n = total;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  const lower = Math.max(0, (center - margin) / denom);
  const upper = Math.min(1, (center + margin) / denom);
  return { wr: p * 100, lower: lower * 100, upper: upper * 100 };
}

// ─────────────────────────────────────────────
// FADE4 PATTERN
// ─────────────────────────────────────────────
function getFade4Signal(ticks) {
  if (ticks.length < 5) return null;
  const last5 = ticks.slice(-5);
  const closes = last5.map(t => t.close);

  // Verificar se 4 velas são no mesmo sentido
  const moves = [];
  for (let i = 1; i < closes.length; i++) {
    moves.push(closes[i] > closes[i - 1] ? 1 : -1);
  }

  // Contar sequência的一致
  let consecutive = 1;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i] === moves[i - 1]) consecutive++;
    else consecutive = 1;
  }

  // Se 4 velas seguidas no mesmo sentido
  if (consecutive >= 4) {
    return moves[moves.length - 1] === 1 ? 'PUT' : 'CALL';
  }
  return null;
}

// ─────────────────────────────────────────────
// MARTINGALE
// ─────────────────────────────────────────────
function getStake(consecutiveLosses, baseStake = 2) {
  if (consecutiveLosses === 0) return baseStake;
  if (consecutiveLosses === 1) return Math.ceil(baseStake * 1.5);
  return 0; // 2 losses = para
}

// ─────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────
let _ws = null;
let _balanceId = null;
let sessionStartBalance = 60;
let activeOps = new Map();
let state = {};
let learning = {};
let opCount = 0;

function loadLearning() {
  try {
    if (fs.existsSync('learning-v14.json')) {
      learning = JSON.parse(fs.readFileSync('learning-v14.json', 'utf8'));
    }
  } catch { learning = {}; }
}

function saveLearning() {
  fs.writeFileSync('learning-v14.json', JSON.stringify(learning, null, 2));
}

// ─────────────────────────────────────────────
// STATE HELPERS
// ─────────────────────────────────────────────
function getOrCreateState(key, name) {
  if (!state[key]) {
    const lr = learning[key] ?? {};
    state[key] = {
      key,
      name,
      direction: lr.direction ?? (Math.random() > 0.5 ? 'CALL' : 'PUT'),
      observedWins: lr.observedWins ?? 0,
      observedTotal: lr.observedTotal ?? 0,
      consecutiveLosses: 0,
      lastSignalAt: 0,
      estimatedWR: lr.observedTotal > 0 ? (lr.observedWins / lr.observedTotal * 100) : 50,
    };
  }
  return state[key];
}

// ─────────────────────────────────────────────
// SIGNAL GENERATION
// ─────────────────────────────────────────────
function generateSignals() {
  const eligible = [];
  const now = Date.now();

  for (const otc of ALL_OTCS) {
    const s = state[otc.key];
    if (!s) continue;
    if (activeOps.size >= C.maxConcurrentOps) break;
    if (s.consecutiveLosses >= 2) continue;
    if (now - s.lastSignalAt < 30000) continue;

    const ticks = _ws._candles?.[otc.id] ?? [];
    if (ticks.length < 20) continue;

    const rsi = calcRSI(ticks);
    const fadeSignal = getFade4Signal(ticks);
    if (!fadeSignal) continue;

    // RSI filter
    if (fadeSignal === 'CALL' && rsi >= RSI.callThreshold) continue;
    if (fadeSignal === 'PUT' && rsi <= RSI.putThreshold) continue;

    // Learning gate
    const { lower } = wilsonCI(s.observedWins, s.observedTotal);
    if (s.observedTotal >= LR.minOps && lower < LR.confidenceLevel * 100) continue;

    const expectedWR = s.estimatedWR;
    eligible.push({ otc, s, fadeSignal, rsi, expectedWR });
  }

  // Ordena por WR
  eligible.sort((a, b) => b.expectedWR - a.expectedWR);

  if (eligible.length > 0) {
    const best = eligible[0];
    console.log(`[🎯 SINAL] ${best.otc.key} | ${best.fadeSignal} | RSI:${best.rsi.toFixed(1)} | WR:${best.expectedWR.toFixed(1)}%`);
    placeOrder(best.otc.key, best.otc.id, best.fadeSignal);
  }
}

// ─────────────────────────────────────────────
// PLACE ORDER
// ─────────────────────────────────────────────
async function placeOrder(key, aid, direction) {
  const s = state[key];
  if (!s) return;

  const stake = getStake(s.consecutiveLosses);
  if (stake === 0) return;

  const ticks = _ws._candles?.[aid] ?? [];
  const rsi = calcRSI(ticks);
  const expectedWR = s.estimatedWR;
  const openedAt = Date.now();

  try {
    // Usar digital-options API (binary-options foi descontinuada)
    const orderRes = await _ws.placeDigitalOrderAndWait({
      price: stake,
      activeId: aid,
      direction,
      expiration: EX.expirationMinutes * 60, // segundos
      balanceId: _balanceId,
      timeoutMs: 30_000,
    });

    if (orderRes.optionId) {
      activeOps.set(aid, {
        opId: orderRes.optionId,
        requestId: orderRes.requestId,
        key,
        name: s.name,
        direction,
        stake,
        rsi,
        expectedWR,
        openedAt,
        isEarlySold: false,
        peakProfit: 0,
      });
      s.lastSignalAt = Date.now();
      opCount++;
      console.log(`[📍 ENTRADA] ${key} | ${direction} | $${stake} | RSI:${rsi.toFixed(1)} | WR:${expectedWR.toFixed(1)}% | #${opCount}`);
    } else {
      const errMsg = orderRes.raw?.msg?.message ?? '';
      console.log(`[⚠️] ${key}: ${errMsg || 'sem resposta'}`);
    }
  } catch (e) {
    console.log(`[⚠️] ${key}: ${e.message}`);
  }
}

// ─────────────────────────────────────────────
// EARLY SELL
// ─────────────────────────────────────────────
async function checkAndSellActiveOps() {
  if (activeOps.size === 0) return;

  const now = Date.now();
  for (const [aid, op] of activeOps) {
    if (op.isEarlySold) continue;

    const elapsed = now - op.openedAt;
    if (elapsed < ES.minHoldSeconds * 1000) continue;

    // Buscar profit atual
    const res = await getOptionInfo(op.opId);
    if (!res) continue;

    const profit = Number(res.profit ?? 0);
    const currentPrice = Number(res.current_price ?? 0);
    const entryPrice = Number(res.open_price ?? 0);

    if (profit > op.peakProfit) op.peakProfit = profit;

    const holdSecs = Math.round(elapsed / 1000);
    const profitPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2) : '0';

    if (profit >= ES.minProfit || (elapsed >= ES.peakProfitWindowMs && profit >= op.peakProfit * 0.9)) {
      _ws.sellOption(op.opId);
      op.isEarlySold = true;
      console.log(`[💰 EARLY SELL] ${op.key} | ${profit > 0 ? '+' : ''}$${profit.toFixed(2)} | ${holdSecs}s | profit%:${profitPct}`);
    }
  }
}

async function getOptionInfo(optionId) {
  try {
    const res = await _ws.getOption(_balanceId, optionId);
    return res;
  } catch { return null; }
}

// ─────────────────────────────────────────────
// HANDLE RESULTS
// ─────────────────────────────────────────────
function handleResult(msg) {
  const payload = msg?.msg ?? msg;
  const id = payload?.option_id ?? payload?.id;
  if (!id) return;

  const op = Array.from(activeOps.values()).find(o => o.opId === id);
  if (!op) return;

  activeOps.delete(op.opId);

  const profit = Number(payload?.profit ?? 0);
  const isWin = profit > 0;

  const s = state[op.key];
  if (s) {
    s.observedTotal++;
    if (isWin) {
      s.observedWins++;
      s.consecutiveLosses = 0;
    } else {
      s.consecutiveLosses++;
    }
    s.estimatedWR = s.observedTotal > 0 ? (s.observedWins / s.observedTotal * 100) : 50;
    learning[op.key] = {
      direction: s.direction,
      observedWins: s.observedWins,
      observedTotal: s.observedTotal,
    };
    saveLearning();
  }

  const emoji = isWin ? '✅' : '❌';
  const direction = op.direction.padEnd(4);
  console.log(`[${emoji}] ${op.key} | ${direction} | ${isWin ? '+' : ''}$${profit.toFixed(2)} | WR:${s?.estimatedWR.toFixed(1)}%`);
}

// ─────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────
function saveReport() {
  const results = { ops: [], summary: {} };
  try {
    if (fs.existsSync('resultados-v14.json')) {
      results.ops = JSON.parse(fs.readFileSync('resultados-v14.json', 'utf8')).ops ?? [];
    }
  } catch { results.ops = []; }

  const totalWins = results.ops.filter(o => o.profit > 0).length;
  const totalLosses = results.ops.filter(o => o.profit <= 0).length;
  const total = totalWins + totalLosses;
  const wr = total > 0 ? (totalWins / total * 100) : 0;
  const totalProfit = results.ops.reduce((sum, o) => sum + (o.profit ?? 0), 0);

  return { ops: results.ops, totalWins, totalLosses, total, wr, totalProfit };
}

function printReport(r) {
  console.log('\n═══════════════════════════════════════');
  console.log('  RELATÓIO v14');
  console.log('═══════════════════════════════════════');
  console.log(`  Operações: ${r.total} | Wins: ${r.totalWins} | Losses: ${r.totalLosses}`);
  console.log(`  WR: ${r.wr.toFixed(1)}% | Lucro: $${r.totalProfit.toFixed(2)}`);
  console.log('═══════════════════════════════════════\n');
}

// ─────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  OTC BOT v14 — TODOS OS 178 OTICS');
  console.log('  Fade4 + RSI + Martingale + Learning');
  console.log('═══════════════════════════════════════\n');

  console.log('[...] Login...');
  const ssid = await loginIQ();
  console.log('[✅] Logado com sucesso');

  loadLearning();

  // Inicializar state para todos os OTCs
  for (const otc of ALL_OTCS) {
    getOrCreateState(otc.key, otc.name);
  }

  const ws = new IqWsClient({ log: (m) => console.log('[IQ-WS]', m) });
  _ws = ws;

  ws.on('profile', (msg) => {
    const p = msg?.msg ?? msg;
    const balances = p?.balances ?? [];
    const mainBal = balances.find(b => Number(b.amount) > 0) ?? balances[0];
    _balanceId = mainBal?.id ?? null;
    sessionStartBalance = Number(mainBal?.amount ?? 60);
    console.log(`[💰] Saldo: ${mainBal?.currency ?? 'USD'} $${sessionStartBalance} (balanceId: ${_balanceId})\n`);
  });

  ws.on('option-closed', handleResult);

  // Handler para capturar candles 5s
  ws.on('candle-generated', (msg) => {
    const m = msg?.msg ?? msg;
    const aid = Number(m?.active_id ?? m?.activeId);
    const candle = normalizeCandle(m);
    if (!aid || !candle || !ws._candles?.[aid]) return;
    ws._candles[aid].push(candle);
    // Manter apenas últimos 25 candles
    if (ws._candles[aid].length > 25) {
      ws._candles[aid].shift();
    }
  });

  await ws.connect({ ssid, timeoutMs: 20_000 });
  console.log('[WS] Pronto');

  // AGUARDAR profile ANTES de iniciar - sem balanceId não pode operar
  console.log('[⏳] Aguardando dados da conta...');
  while (_balanceId === null) {
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('[✅] Conta pronta\n');

  // Subscrever TODOS os OTCs
  console.log(`[📡] Subscrevendo ${ALL_OTCS.length} OTCs...`);
  ws._candles = {};

  for (const otc of ALL_OTCS) {
    try {
      await ws.subscribeCandles(otc.id);
      ws._candles[otc.id] = [];
    } catch (e) {
      // Ignora erros individuais
    }
  }
  console.log(`[📡] ${ALL_OTCS.length} OTCs subscritos\n`);

  console.log('[🚀] Bot rodando. Ctrl+C para pausar.\n');

  // Status a cada 2 min
  setInterval(() => {
    const ops = Array.from(activeOps.entries()).map(([k, v]) => v.key).join(', ') || 'nenhuma';
    console.log(`[📊] Status: ${activeOps.size} ops | ${ops}`);
  }, 120_000);

  // Loop principal: sinais
  setInterval(generateSignals, 5000);

  // Loop early sell
  setInterval(async () => {
    await checkAndSellActiveOps().catch(() => {});
  }, ES.checkIntervalMs);

  // Relatório periódico
  setInterval(() => {
    const r = saveReport();
    printReport(r);
  }, EX.reportIntervalMs);
}

main().catch(e => {
  console.error('[❌] Erro fatal:', e.message);
  process.exit(1);
});

// Graceful exit
process.on('SIGINT', () => {
  console.log('\n[🛑] Parando bot...');
  const r = saveReport();
  printReport(r);
  _ws?.close();
  process.exit(0);
});
