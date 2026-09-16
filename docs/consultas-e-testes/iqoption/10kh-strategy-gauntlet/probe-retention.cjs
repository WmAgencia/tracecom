// probe-retention.cjs — quanto historico o endpoint publico realmente serve?
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function q(active, from, to) { const key = Math.floor(Date.now() / 1000 / 300) * 300; const url = `https://api.iqoption.com/v3/quotes?active_id=${active}&from=${from}&to=${to}&only_round=false&_key=${key}`; const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, credentials: "omit" }); if (!r.ok) return { status: r.status, n: 0 }; const j = await r.json(); const arr = (j.quotes || []).sort((a, b) => a.ts - b.ts); return { status: 200, n: arr.length, first: arr.length ? new Date(arr[0].ts).toISOString() : null, last: arr.length ? new Date(arr[arr.length - 1].ts).toISOString() : null }; }
(async () => {
  const now = Date.now(); const MIN = 5 * 60 * 1000;
  for (const active of [1, 76]) {
    console.log(`=== active ${active} ===`);
    for (const days of [0.5, 1, 2, 3, 5, 6, 6.8, 6.95]) {
      const to = now - days * 86400000; const from = to - MIN;
      const r = await q(active, from, to);
      console.log(`  age=${days}d -> ${r.status} n=${r.n} ${r.first || ""} .. ${r.last || ""}`);
      await new Promise((x) => setTimeout(x, 250));
    }
  }
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
