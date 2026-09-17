/** Catalogo completo da sessao IQ (Fase 7 Etapa A): TODOS os ativos expostos, todos os produtos. */
import { Pool } from "pg";
import { loadSession } from "../relay/iq-session-vault.mjs";
import { IqWsClient, IQ_WS_CANDIDATE_HOSTS } from "../relay/iqoption-ws.mjs";
import fs from "node:fs";

const secret = process.env.TOKEN_SIGNING_SECRET || "";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const out = { at: new Date().toISOString(), sections: [], catalog: [], errors: [] };
try {
  const session = await loadSession(pool, secret);
  if (!session?.ssid) throw new Error("SSID_REQUIRED");
  const client = new IqWsClient({ hosts: IQ_WS_CANDIDATE_HOSTS });
  await client.connect({ ssid: session.ssid });
  const init = await client.getInitializationData();
  const source = init?.response?.msg?.result ?? init?.response?.msg ?? {};
  out.sections = Object.keys(source).filter((key) => source?.[key]?.actives && typeof source[key].actives === "object");
  for (const section of out.sections) {
    const actives = source[section]?.actives ?? {};
    for (const [id, active] of Object.entries(actives)) {
      const option = active?.option ?? {};
      out.catalog.push({
        section, id: Number(id), name: String(active?.name ?? ""), enabled: active?.enabled === true, suspended: active?.is_suspended === true,
        payout: option?.profit?.commission !== undefined ? Number((100 - Number(option.profit.commission)).toFixed(2)) : null,
        expirations: Array.isArray(option?.expiration_times) ? option.expiration_times.slice(0, 6) : (option?.exp_time ?? null),
        optionKeys: Object.keys(option).slice(0, 10),
      });
    }
  }
  try { client.close("CATALOG_DONE"); } catch { /* noop */ }
} catch (error) { out.errors.push(String(error?.message ?? error).slice(0, 140)); }
await pool.end();
fs.writeFileSync("iq-catalog.json", JSON.stringify(out, null, 1), "utf8");
const bySection = {};
for (const row of out.catalog) bySection[row.section] = (bySection[row.section] ?? 0) + 1;
console.log(JSON.stringify({ at: out.at, sections: out.sections, counts: bySection, total: out.catalog.length, errors: out.errors }));
