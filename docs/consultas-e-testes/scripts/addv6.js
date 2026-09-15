const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const r = (await c.query("SELECT experiment_id, frozen_strategy_versions::text AS f FROM shadow_experiments ORDER BY created_at ASC LIMIT 1")).rows[0];
  const arr = JSON.parse(r.f);
  const names = arr.map((x) => x.strategyVersion);
  if (!names.includes("shadow-reversion-v6")) {
    arr.push({ strategyVersion: "shadow-reversion-v6", n: 0, wins: 0, wilson: null, ownerOverride: true });
    const upd = await c.query("UPDATE shadow_experiments SET frozen_strategy_versions=$1::jsonb, updated_at=now() WHERE experiment_id=$2", [JSON.stringify(arr), r.experiment_id]);
    console.log("updated=" + upd.rowCount + " finalists=" + arr.map((x) => x.strategyVersion.replace("shadow-", "")).join(","));
  } else {
    console.log("v6 already frozen");
  }
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });