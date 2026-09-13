import http from 'node:http';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const admin = process.env.TOKEN_SIGNING_SECRET || '';
const pepper = process.env.API_KEY_PEPPER || '';
const staleMs = Number(process.env.LIVE_SESSION_STALE_MS || 60000);
const clients = new Set();
const scopes = ['live:session:read', 'live:events:read', 'live:frame:read', 'live:export:read'];
const hash = key => crypto.createHash('sha256').update(`${pepper}:${key}`).digest('hex');
const reply = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
async function body(req) { let raw=''; for await (const part of req) { raw += part; if(raw.length > 262144) throw Error('payload_too_large'); } return raw ? JSON.parse(raw) : {}; }
async function migrate() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS live_api_keys(id uuid primary key default gen_random_uuid(),name text,key_prefix text,key_suffix text,key_hash text unique,scopes jsonb,created_at timestamptz default now(),expires_at timestamptz,revoked_at timestamptz,last_used_at timestamptz);
CREATE TABLE IF NOT EXISTS live_sessions(id text primary key,started_at timestamptz default now(),ended_at timestamptz,status text,last_seen_at timestamptz,metadata jsonb default '{}');
CREATE TABLE IF NOT EXISTS live_events(id bigserial primary key,session_id text references live_sessions(id),event_type text,event_timestamp timestamptz default now(),payload_json jsonb,sequence_id text unique);
CREATE TABLE IF NOT EXISTS vision_market_samples(id bigserial primary key,session_id text,frame_id text,timestamp timestamptz,asset text,market_type text,timeframe text,expiration_seconds integer,detected_price numeric,detected_price_confidence numeric,observation_json jsonb,frame_hash text,chart_region_json jsonb);
CREATE TABLE IF NOT EXISTS live_decisions(id bigserial primary key,session_id text,decision_id text,timestamp timestamptz,direction text,confidence numeric,probability_source text,p_buy numeric,p_sell numeric,p_wait numeric,raw_model_scores_json jsonb);
CREATE TABLE IF NOT EXISTS live_settlements(id bigserial primary key,session_id text,decision_id text,timestamp timestamptz,result text,entry_price numeric,settlement_price numeric);
CREATE TABLE IF NOT EXISTS live_access_logs(id bigserial primary key,api_key_id uuid,endpoint text,timestamp timestamptz default now(),status integer,latency_ms integer,client_label text);`);
}
await migrate();
async function authenticate(req, scope) {
  const value = req.headers.authorization || ''; const key = value.startsWith('Bearer ') ? value.slice(7) : '';
  if(!key.startsWith('tc_live_')) return null;
  const result = await pool.query('SELECT * FROM live_api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())', [hash(key)]);
  const row = result.rows[0]; if(!row || !row.scopes.includes(scope)) return null;
  await pool.query('UPDATE live_api_keys SET last_used_at=now() WHERE id=$1', [row.id]); return row;
}
function emit(type, payload, id) { for(const client of clients) client.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); }
async function currentSnapshot() {
  const session = (await pool.query('SELECT * FROM live_sessions ORDER BY last_seen_at DESC NULLS LAST LIMIT 1')).rows[0];
  if(!session) return { connectionState: 'OFFLINE', timestamp: new Date().toISOString() };
  const age = Date.now() - new Date(session.last_seen_at).getTime();
  const decision = (await pool.query('SELECT * FROM live_decisions WHERE session_id=$1 ORDER BY timestamp DESC LIMIT 1', [session.id])).rows[0] || null;
  return { sessionId: session.id, timestamp: new Date().toISOString(), connectionState: session.ended_at ? 'ENDED' : age > staleMs ? 'STALE' : 'ONLINE', session, decision };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if(url.pathname === '/health') return reply(res, 200, { ok:true, db:true, service:'tracecom-live-relay' });
    if(url.pathname === '/api/live/keys' && req.method === 'POST') {
      if(req.headers['x-relay-admin'] !== admin) return reply(res, 401, {error:'unauthorized'});
      const input = await body(req), key = `tc_live_${crypto.randomBytes(32).toString('hex')}`;
      const r = await pool.query('INSERT INTO live_api_keys(name,key_prefix,key_suffix,key_hash,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at',[input.name||'Codex',key.slice(0,12),key.slice(-4),hash(key),input.scopes||scopes,input.expiresAt||null]);
      return reply(res, 201, {id:r.rows[0].id,key,createdAt:r.rows[0].created_at});
    }
    if(url.pathname === '/api/live/keys' && req.method === 'GET') { if(req.headers['x-relay-admin']!==admin)return reply(res,401,{error:'unauthorized'}); return reply(res,200,(await pool.query('SELECT id,name,key_prefix,key_suffix,scopes,created_at,expires_at,revoked_at,last_used_at FROM live_api_keys ORDER BY created_at DESC')).rows); }
    const keyPath = url.pathname.match(/^\/api\/live\/keys\/([^/]+)$/);
    if(keyPath && req.method === 'DELETE') { if(req.headers['x-relay-admin']!==admin)return reply(res,401,{error:'unauthorized'}); await pool.query('UPDATE live_api_keys SET revoked_at=now() WHERE id=$1',[keyPath[1]]); return reply(res,200,{revoked:true}); }
    if(url.pathname === '/api/live/ingest' && req.method === 'POST') {
      if(req.headers['x-relay-admin'] !== admin) return reply(res,401,{error:'unauthorized'});
      const input=await body(req); if(!input.sessionId||!input.type)return reply(res,400,{error:'invalid_event'});
      await pool.query("INSERT INTO live_sessions(id,status,last_seen_at,metadata) VALUES($1,'ONLINE',now(),$2) ON CONFLICT(id) DO UPDATE SET status='ONLINE',last_seen_at=now(),metadata=EXCLUDED.metadata",[input.sessionId,input.session||{}]);
      const e=(await pool.query('INSERT INTO live_events(session_id,event_type,payload_json,sequence_id) VALUES($1,$2,$3,$4) RETURNING id',[input.sessionId,input.type,input.payload||{},input.sequenceId||crypto.randomUUID()])).rows[0];
      if(input.type==='DECISION') await pool.query('INSERT INTO live_decisions(session_id,decision_id,timestamp,direction,confidence,probability_source,p_buy,p_sell,p_wait,raw_model_scores_json) VALUES($1,$2,now(),$3,$4,$5,$6,$7,$8,$9)',[input.sessionId,input.payload?.decisionId||null,input.payload?.direction||null,input.payload?.confidence||null,input.payload?.probabilitySource||null,input.payload?.pBuy||null,input.payload?.pSell||null,input.payload?.pWait||null,input.payload?.rawModelScores||{}]);
      emit(input.type,input,e.id); return reply(res,202,{eventId:e.id});
    }
    if(url.pathname === '/api/live/session') { if(!await authenticate(req,'live:session:read'))return reply(res,401,{error:'unauthorized'}); return reply(res,200,await currentSnapshot()); }
    if(url.pathname === '/api/live/stream') { if(!await authenticate(req,'live:events:read'))return reply(res,401,{error:'unauthorized'}); res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'}); res.write('retry: 3000\n\n'); clients.add(res); res.write(`event: session\ndata: ${JSON.stringify(await currentSnapshot())}\n\n`); const h=setInterval(()=>res.write(`event: heartbeat\ndata: ${JSON.stringify({timestamp:new Date().toISOString()})}\n\n`),15000); req.on('close',()=>{clients.delete(res);clearInterval(h)}); return; }
    if(url.pathname === '/api/live/export') { if(!await authenticate(req,'live:export:read'))return reply(res,401,{error:'unauthorized'}); return reply(res,200,{sessions:(await pool.query('SELECT * FROM live_sessions')).rows,events:(await pool.query('SELECT * FROM live_events ORDER BY id')).rows}); }
    return reply(res,404,{error:'not_found'});
  } catch(error) { return reply(res,error.message==='payload_too_large'?413:400,{error:error.message}); }
});
server.listen(port,()=>console.log(`tracecom-live-relay listening on ${port}`));
