import fs from "node:fs";
const S = "D:/tracecom/repo/relay/server.mjs";
const A = "D:/tracecom/repo/api/http.ts";
let srv = fs.readFileSync(S, "utf8");
let api = fs.readFileSync(A, "utf8");
const log = [];
const cut = (which, from, to, label) => {
  const target = which === "s" ? srv : api;
  const crlf = target.includes("\r\n");
  const f = crlf ? from.replace(/\n/g, "\r\n") : from;
  const t = crlf ? to.replace(/\n/g, "\r\n") : to;
  if (!target.includes(f)) { log.push("FALHOU: " + label); return; }
  const out = target.split(f).join(t);
  if (which === "s") srv = out; else api = out;
  log.push("OK: " + label);
};
// server: rota /api/iq/agents/blitz
cut("s", `  if(url.pathname === '/api/iq/agents/blitz' && req.method === 'GET') { if(req.headers['x-relay-admin'] !== admin) return reply(res,401,{error:'unauthorized'}); const payload = await wsRuntime.blitzReport(Number(url.searchParams.get('hours')) || 6); return reply(res,200, { ...payload, practiceOnly:true }); }\n`, "", "server: rota agents/blitz");
// server: rota blitz/assets
cut("s", `  if(url.pathname === '/api/iq/blitz/assets' && req.method === 'GET') {\n    if(req.headers['x-relay-admin'] !== admin) return reply(res,401,{error:'unauthorized'}); return reply(res,200,{ ...(await wsRuntime.blitzAssets()), practiceOnly:true }); }\n`, "", "server: rota blitz/assets");
// server: rota instruments/blitz
cut("s", `  if(url.pathname === '/api/iq/instruments/blitz' && req.method === 'GET') {\n    if(req.headers['x-relay-admin'] !== admin) return reply(res,401,{error:'unauthorized'}); try { return reply(res,200,{ ...(await wsRuntime.discoverBlitzInstruments()), practiceOnly:true, readOnly:true }); } catch(error) { return reply(res,400,{ ...sanitizedError(error), practiceOnly:true }); } }\n`, "", "server: rota instruments/blitz");
// api/http.ts: paths
for (const p of ['"/api/iq/agents/blitz", ', '"/api/iq/instruments/blitz", ', '"/api/iq/blitz/assets", ']) cut("a", p, "", "api getPaths " + p.trim());
cut("a", ', "/api/iq/blitz/registry-sync", "/api/iq/blitz/test-order"]', ']', "api postPaths blitz");
fs.writeFileSync(S, srv);
fs.writeFileSync(A, api);
console.log(log.join("\n"));
console.log("SERVER_BLITZ_REFS=" + (srv.match(/blitz/gi) ?? []).length + " API_BLITZ_REFS=" + (api.match(/blitz/gi) ?? []).length);
