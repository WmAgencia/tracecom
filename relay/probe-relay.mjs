/** probe-relay.mjs — diagnostico do elo relay->OpenCode Go. Nunca imprime a key. */
import pg from "pg";
import { runVisionProvider, runTextProvider } from "./opencode-go.mjs";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tinyImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=";
try {
  const vision = await runVisionProvider(pool, { imageDataUrl: tinyImage, frameId: "probe", requestId: "probe-vision" });
  console.log("VISION", JSON.stringify({ status: vision?.provenance?.status, availability: vision?.availability, model: vision?.provenance?.model, latencyMs: vision?.provenance?.latencyMs, sessionId: vision?.provenance?.sessionId, notes: vision?.notes }));
  const text = await runTextProvider(pool, { prompt: 'Responda SOMENTE com JSON: {"status":"ok"}', maxTokens: 32, requestId: "probe-text" });
  console.log("TEXT", JSON.stringify({ status: text.status, model: text.model, latencyMs: text.latencyMs, reason: text.reason, parsed: text.parsed }));
} finally { await pool.end(); }
