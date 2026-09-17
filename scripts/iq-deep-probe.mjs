/** Probe profundo (local via railway run): catalogo IQ por produto + verify do relay em producao. */
import { Pool } from "pg";
import { loadSession } from "../relay/iq-session-vault.mjs";
import { IqWsClient, IQ_WS_CANDIDATE_HOSTS } from "../relay/iqoption-ws.mjs";

const base = "https://tracecom-live-relay-production.up.railway.app";
const admin = process.env.TOKEN_SIGNING_SECRET || "";
const out = { relay: {}, iq: {}, errors: [] };

// 1) verifica o marker deep direto no relay (sem passar pelo proxy)
try {
  const r = await fetch(`${base}/api/iq/broker-audit?live=1&deep=1`, { headers: { "x-relay-admin": admin }, signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  out.relay = { status: r.status, version: j.version ?? null, deepPresent: Boolean(j.deep), sections: j.evidence?.sections ?? null, probeError: j.probeError ?? null, instruments: j.deep?.instruments ?? null, optionsLiveness: j.deep?.optionsLiveness ?? null };
} catch (error) { out.errors.push(`RELAY:${String(error?.message ?? error).slice(0, 100)}`); }

// 2) probe IQ direto (SSID do vault)
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const session = await loadSession(pool, admin);
  out.iq.sessionRestored = Boolean(session?.ssid);
  if (session?.ssid) {
    const client = new IqWsClient({ hosts: IQ_WS_CANDIDATE_HOSTS });
    await client.connect({ ssid: session.ssid });
    out.iq.host = client.host ?? IQ_WS_CANDIDATE_HOSTS[0];
    const init = await client.getInitializationData().catch((error) => ({ error }));
    const source = init?.response?.msg?.result ?? init?.response?.msg ?? {};
    out.iq.initSections = Object.keys(source).filter((key) => source?.[key]?.actives && typeof source[key].actives === "object");
    const ourNames = /^(front\.)?(EURUSD|USDJPY|GBPUSD|AUDUSD|USDCAD|USDCHF|EURJPY|EURGBP|AUDJPY|GBPJPY)(-OTC)?$/i;
    const catalog = {};
    for (const section of out.iq.initSections) {
      const actives = source[section]?.actives ?? {};
      catalog[section] = Object.entries(actives).filter(([, active]) => ourNames.test(String(active?.name ?? "").trim())).map(([id, active]) => ({ id: Number(id), name: active?.name ?? null, enabled: active?.enabled ?? null, suspended: active?.is_suspended ?? null, optionKeys: active?.option ? Object.keys(active.option).slice(0, 8) : null, expiration: active?.option?.expiration ?? active?.expiration ?? null }));
    }
    out.iq.catalogBySection = catalog;
    const products = ["turbo-option", "binary-option", "digital-option", "blitz-option"];
    out.iq.instruments = {};
    for (const type of products) {
      try {
        const response = await client.getInstruments({ type });
        const msg = response?.response?.msg ?? {};
        const rows = Array.isArray(msg) ? msg : (msg.instruments ?? msg.instruments_list ?? msg.data ?? []);
        out.iq.instruments[type] = { count: rows.length, msgKeys: Object.keys(msg).slice(0, 8), matches: rows.filter((row) => ourNames.test(String(row?.name ?? row?.instrument ?? "").trim())).slice(0, 20).map((row) => ({ name: row?.name ?? row?.instrument ?? null, id: row?.id ?? row?.active_id ?? row?.instrument_id ?? null, enabled: row?.enabled ?? null, suspended: row?.is_suspended ?? null, expiration: row?.expiration ?? row?.expirations ?? null })) };
      } catch (error) { out.iq.instruments[type] = { error: String(error?.code ?? error?.message ?? error).slice(0, 80) }; }
    }
    out.iq.optionsLiveness = {};
    for (const instrumentType of ["turbo", "binary", "digital", "blitz"]) {
      try { const response = await client.getOptions({ limit: 20, instrumentType }); out.iq.optionsLiveness[instrumentType] = { msgKeys: Object.keys(response?.response?.msg ?? {}).slice(0, 8), openOptions: (response?.response?.msg?.open_options ?? []).length }; }
      catch (error) { out.iq.optionsLiveness[instrumentType] = { error: String(error?.code ?? error?.message ?? error).slice(0, 80) }; }
    }
    try { client.close("PROBE_DONE"); } catch { /* noop */ }
  }
} catch (error) { out.errors.push(`IQ:${String(error?.message ?? error).slice(0, 120)}`); }
await pool.end();
console.log(JSON.stringify(out, null, 1));
