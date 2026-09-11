/**
 * Smoke test: validates Round 6 P-F (Forex Universe + Sessions) actually runs.
 * NOT a unit test — calls real functions and prints diagnostics.
 */
import {
  DEFAULT_FOREX_UNIVERSE,
  parseForexPair,
  validateQuote,
  sessionAt,
  sessionPhaseAt,
  FOREX_TIMEFRAMES,
} from "../src/market/forex/types";

console.log("=== P-F Smoke Test ===");
console.log("");

// 1. Universe
console.log("1. Universe size:", DEFAULT_FOREX_UNIVERSE.length);
const majors = DEFAULT_FOREX_UNIVERSE.filter((p) => p.classification === "MAJOR");
const crosses = DEFAULT_FOREX_UNIVERSE.filter((p) => p.classification === "CROSS");
const exotics = DEFAULT_FOREX_UNIVERSE.filter((p) => p.classification === "EXOTIC");
console.log("   - MAJOR:", majors.length, "(expected 8)");
console.log("   - CROSS:", crosses.length, "(expected ~12)");
console.log("   - EXOTIC:", exotics.length, "(expected ~6)");
console.log("");

// 2. parseForexPair
console.log("2. parseForexPair:");
console.log("   EURUSD:", parseForexPair("EURUSD")?.canonical ?? "FAILED");
console.log("   EUR/USD:", parseForexPair("EUR/USD")?.canonical ?? "FAILED");
console.log("   eur_usd:", parseForexPair("eur_usd")?.canonical ?? "FAILED");
console.log("   USD/JPY:", parseForexPair("USD/JPY")?.canonical ?? "FAILED");
console.log("   INVALID:", parseForexPair("INVALID") ?? "returns null (correct)");
console.log("");

// 3. validateQuote
console.log("3. validateQuote (EURUSD 1.0850, spread 0.0001):");
const valid = validateQuote({
  symbol: "EURUSD",
  base: "EUR",
  quote: "USD",
  bid: 1.0849,
  ask: 1.0851,
  spreadPct: 0.0184,
  timestamp: Date.now(),
});
console.log("   - valid:", valid.valid, "reason:", valid.reason);
console.log("");

// 4. Session detection
console.log("4. sessionAt:");
// 14:30 UTC = London + NY overlap
const ts1 = Date.UTC(2026, 0, 15, 14, 30, 0);
console.log("   2026-01-15 14:30 UTC:", sessionAt(ts1));
// 03:00 UTC = Sydney + Tokyo
const ts2 = Date.UTC(2026, 0, 15, 3, 0, 0);
console.log("   2026-01-15 03:00 UTC:", sessionAt(ts2));
// 22:00 UTC = closed (between NY close and Sydney open)
const ts3 = Date.UTC(2026, 0, 15, 22, 0, 0);
console.log("   2026-01-15 22:00 UTC:", sessionAt(ts3));
console.log("");

// 5. Session phase
console.log("5. sessionPhaseAt:");
console.log("   London at 08:00 UTC:", sessionPhaseAt(Date.UTC(2026, 0, 15, 8, 0, 0), "LONDON"));
console.log("   London at 12:00 UTC:", sessionPhaseAt(Date.UTC(2026, 0, 15, 12, 0, 0), "LONDON"));
console.log("   London at 17:00 UTC:", sessionPhaseAt(Date.UTC(2026, 0, 15, 17, 0, 0), "LONDON"));
console.log("");

// 6. Timeframes
console.log("6. FOREX_TIMEFRAMES:", FOREX_TIMEFRAMES.length, "entries:", FOREX_TIMEFRAMES.join(", "));
console.log("");

console.log("=== Smoke test complete ===");
