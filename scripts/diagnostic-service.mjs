/* Local-only DEV service. API credentials stay in this process environment. */
import http from "node:http";

const port = Number(process.env.TRACECON_DIAGNOSTIC_PORT || 8789);
const baseUrl = String(process.env.NEXXUS_BASE_URL || "").replace(/\/$/, "");
const apiKey = process.env.NEXXUS_API_KEY;
const REQUEST_TIMEOUT_MS = 8_000;
const bad = /(token|auth|cookie|session|ssid|pass|email|phone|account|wallet|balance|profile|user|credential|secret|key)/i;
const sanitize = (value, depth = 0) => {
  if (depth > 6) return "[depth-limited]";
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return typeof value === "string" ? value.slice(0, 240) : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !bad.test(key)).map(([key, item]) => [key, sanitize(item, depth + 1)]));
};
const json = (res, code, payload) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(sanitize(payload))); };
async function boundedFetch(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function resolveFable() {
  if (!baseUrl || !apiKey) throw new Error("DIAGNOSTIC_SERVICE_NOT_CONFIGURED");
  const response = await boundedFetch(`${baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`MODEL_DISCOVERY_HTTP_${response.status}`);
  const catalog = await response.json();
  const models = Array.isArray(catalog?.data) ? catalog.data : Array.isArray(catalog) ? catalog : [];
  const model = models.find((item) => /fable\s*5/i.test(`${item?.id || ""} ${item?.display_name || item?.name || ""}`));
  if (!model?.id) throw new Error("FABLE_5_NOT_AVAILABLE_FOR_KEY");
  return { provider: "NEXXUS", displayName: model.display_name || model.name || "Fable 5", modelId: model.id };
}
const diagnosticPrompt = "Return JSON only with status, issueClass, severity, confidence, rootCause, evidence, affectedFiles, recommendedChanges and validation. Do not provide chain of thought.";
const traderPrompt = 'You are the TraceCon short-horizon forex analyst. Analyze only the supplied causal market snapshot and optional cropped chart image for a 60-second shadow outcome. Evaluate price action, HH/HL, LH/LL, BOS, CHoCH, support/resistance, breakout, false breakout, retest, liquidity sweep proxy, wick rejection, momentum, ROC, RSI, stochastic, ATR, volatility expansion/compression, EMA slope, trend strength, mean reversion, exhaustion, tick imbalance, acceleration, intraday regime and multi-timeframe context. WAIT is valid for insufficient or conflicting evidence. Never claim certainty. Never provide trading instructions, order execution steps, stake sizes, or broker actions. Return JSON only: {decision:"BUY"|"SELL"|"WAIT",confidence:0..1,dataQuality:0..1,regime:string,supportingFactors:string[],opposingFactors:string[],summary:string,imageUsed:boolean,riskFlags:string[],horizonSeconds:60}.';
const parseJsonResponse = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{"); const end = trimmed.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed);
};
async function askFable(profile, snapshot, chartImage = null) {
  const model = await resolveFable();
  const content = [{ type: "text", text: JSON.stringify(snapshot) }];
  if (chartImage) content.push({ type: "image_url", image_url: { url: chartImage } });
  const response = await boundedFetch(`${baseUrl}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model: model.modelId, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: profile === "FABLE_TRADER" ? traderPrompt : diagnosticPrompt }, { role: "user", content }] }) });
  if (!response.ok) throw new Error(`${profile}_HTTP_${response.status}`);
  const data = await response.json(); const text = data?.choices?.[0]?.message?.content;
  return { model, result: sanitize(typeof text === "string" ? parseJsonResponse(text) : data) };
}
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, configured: !!(baseUrl && apiKey) });
  if (req.method !== "POST" || !["/diagnose", "/trade", "/vision-probe"].includes(req.url)) return json(res, 404, { error: "NOT_FOUND" });
  let body = ""; for await (const chunk of req) body += chunk; if (body.length > 300_000) return json(res, 413, { error: "DIAGNOSTIC_TOO_LARGE" });
  try {
    const decoded = JSON.parse(body); const chartImage = typeof decoded?.chartImage === "string" && /^data:image\/(?:jpeg|png);base64,/i.test(decoded.chartImage) && decoded.chartImage.length <= 2_000_000 ? decoded.chartImage : null;
    delete decoded.chartImage; const snapshot = sanitize(decoded); const profile = req.url === "/diagnose" ? "FABLE_DIAGNOSTIC" : "FABLE_TRADER"; const answer = await askFable(profile, snapshot, chartImage);
    if (req.url === "/vision-probe") return json(res, 200, { status: "VISION_ENABLED", model: answer.model, imageUsed: !!chartImage });
    return json(res, 200, profile === "FABLE_TRADER" ? { status: "ANALYZED", model: answer.model, analysis: { ...answer.result, imageUsed: !!chartImage } } : { status: "DIAGNOSED", model: answer.model, diagnosis: answer.result });
  } catch (error) { return json(res, 503, { status: "UNAVAILABLE", error: String(error?.message || error) }); }
});
server.listen(port, "127.0.0.1", () => console.log(`TraceCon diagnostic service listening on http://127.0.0.1:${port}`));
