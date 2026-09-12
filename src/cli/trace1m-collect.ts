import { loadConfig } from "../config/env";
import { OandaForexProvider } from "../market/forex/oanda-provider";
import { parseForexPair } from "../market/forex/types";
import { Datastore } from "../store/db";
import { Trace1mLedger } from "../trace1m/ledger";

const config = loadConfig();
if (!config.oanda.apiKey || !config.oanda.accountId) {
  console.error("DATA_PROVIDER_LIMITATION: configure OANDA_API_KEY and OANDA_ACCOUNT_ID; no synthetic quotes will be generated.");
  process.exitCode = 2;
} else {
  const store = new Datastore({ path: config.database.path });
  if (!store.available) throw new Error("SQLite persistence is unavailable");
  const ledger = new Trace1mLedger(store);
  const provider = new OandaForexProvider({ apiKey: config.oanda.apiKey, accountId: config.oanda.accountId, baseUrl: config.oanda.baseUrl });
  let running = false;
  const poll = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const pairName of config.trace1m.pairs) {
        const pair = parseForexPair(pairName);
        if (!pair) { console.error(`Invalid pair ignored: ${pairName}`); continue; }
        try {
          const quote = await provider.fetchQuote(pair);
          const receivedAt = Date.now();
          const result = ledger.collect({
            quote: { pair: pair.canonical, provider: provider.id, providerRole: "PRIMARY", providerTimestamp: quote.timestamp, receivedAt, bid: quote.bid, ask: quote.ask, pipSize: pair.pipSize, providerVersion: "oanda-v20-rest-pricing-v1" },
            context: { session: "", candleState: "NOT_AVAILABLE", candles1m: [], context5m: [], context15m: [], professional: "NOT_AVAILABLE", microstructure: null, news: null, macro: null, modelVersion: "trace1m-research-v1", featureVersion: "trace1m-features-v1", historySufficient: false, newsFresh: false, calendarFresh: false },
            researchDecision: "WAIT", productionGatePassed: false,
          });
          console.log(`${new Date().toISOString()} ${pair.canonical} ${result.snapshotId} ${result.waitReason}`);
        } catch (error) { console.error(`${pair.canonical}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    } finally { running = false; }
  };
  await poll();
  const timer = setInterval(() => void poll(), config.trace1m.pollIntervalMs);
  const stop = (): void => { clearInterval(timer); store.close(); };
  process.once("SIGINT", () => { stop(); process.exit(0); });
  process.once("SIGTERM", () => { stop(); process.exit(0); });
}
