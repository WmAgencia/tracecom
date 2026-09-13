import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const admin = process.env.TOKEN_SIGNING_SECRET || '';
const pepper = process.env.API_KEY_PEPPER || '';
const staleMs = Number(process.env.LIVE_SESSION_STALE_MS || 60000);
const clients = new Set();
const limits = new Map();
const scopes = ['live:session:read', 'live:events:read', 'live:frame:read', 'live:export:read'];
const hash = key => crypto.createHash('sha256').update(`${pepper}:${key}`).digest('hex');
const sign = payload => { const raw=Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${raw}.${crypto.createHmac('sha256',admin).update(raw).digest('base64url')}`; };
const verify = token => { const [raw,sig]=String(token||'').split('.'), expected=raw?crypto.createHmac('sha256',admin).update(raw).digest('base64url'):''; if(!raw||!sig||sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null; const value=JSON.parse(Buffer.from(raw,'base64url').toString()); return value.exp>Date.now()&&value.scope==='telemetry:write'&&value.issuer==='tracecom'&&value.audience==='tracecom-live-relay'&&value.nonce?value:null; };
const reply = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
function rateLimit(req, bucket, ceiling, windowMs=60000) { const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim(); const key=`${bucket}:${forwarded||req.socket.remoteAddress||'unknown'}`, now=Date.now(), hit=limits.get(key)||{at:now,count:0}; if(now-hit.at>windowMs){hit.at=now;hit.count=0;} hit.count++; limits.set(key,hit); return hit.count<=ceiling; }
async function body(req) { let raw=''; for await (const part of req) { raw += part; if(raw.length > 262144) throw Error('payload_too_large'); } return raw ? JSON.parse(raw) : {}; }
async function migrate() {
  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = (await fs.readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version=$1', [file]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(directory, file), 'utf8');
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(sql); await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}
await migrate();
async function authenticate(req, scope) {
  const value = req.headers.authorization || ''; const key = value.startsWith('Bearer ') ? value.slice(7) : '';
  if(!key.startsWith('tc_live_')) return null;
  const result = await pool.query('SELECT * FROM live_api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())', [hash(key)]);
  const row = result.rows[0]; if(!row || !row.scopes.includes(scope)) return null;
   await pool.query('UPDATE live_api_keys SET last_used_at=now() WHERE id=$1', [row.id]); req._tracecomKeyId = row.id; return row;
}
async function accessLog(keyId, endpoint, status, started, clientLabel) { try { await pool.query('INSERT INTO live_access_logs(api_key_id,endpoint,status,latency_ms,client_label) VALUES($1,$2,$3,$4,$5)', [keyId, endpoint, status, Date.now()-started, String(clientLabel||'').slice(0,120)]); } catch {} }
function emit(type, payload, id) { for(const client of clients) client.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); }
async function currentSnapshot() {
  const session = (await pool.query('SELECT * FROM live_sessions ORDER BY last_seen_at DESC NULLS LAST LIMIT 1')).rows[0];
  if(!session) return { connectionState: 'OFFLINE', timestamp: new Date().toISOString() };
  const age = Date.now() - new Date(session.last_seen_at).getTime();
  const [decision, settlement, sample, counts] = await Promise.all([
    pool.query('SELECT * FROM live_decisions WHERE session_id=$1 ORDER BY timestamp DESC LIMIT 1', [session.id]),
    pool.query('SELECT * FROM live_settlements WHERE session_id=$1 ORDER BY timestamp DESC LIMIT 1', [session.id]),
    pool.query('SELECT * FROM vision_market_samples WHERE session_id=$1 ORDER BY timestamp DESC LIMIT 1', [session.id]),
    pool.query("SELECT (SELECT count(*) FROM live_events WHERE session_id=$1)::int events,(SELECT count(*) FROM vision_market_samples WHERE session_id=$1)::int samples,(SELECT count(*) FROM live_decisions WHERE session_id=$1)::int decisions,(SELECT count(*) FROM live_settlements WHERE session_id=$1)::int settlements", [session.id])
  ]);
  return { sessionId: session.id, timestamp: new Date().toISOString(), connectionState: session.ended_at ? 'ENDED' : age > staleMs ? 'STALE' : 'ONLINE', startedAt:session.started_at,endedAt:session.ended_at,lastSeenAt:session.last_seen_at,metadata:session.metadata,latestDecision:decision.rows[0]||null,latestSettlement:settlement.rows[0]||null,latestObservation:sample.rows[0]||null,counts:counts.rows[0] };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`); const requestStarted = Date.now(); res.on('finish', () => { void accessLog(req._tracecomKeyId || null, url.pathname, res.statusCode, requestStarted, req.headers['x-client-label']); });
  try {
    const allowed=(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean), origin=req.headers.origin;
    if(origin && !allowed.includes(origin) && url.pathname!=='/health') return reply(res,403,{error:'forbidden_origin'});
    if(origin && allowed.includes(origin)) res.setHeader('access-control-allow-origin',origin);
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    const bucket=url.pathname.includes('/stream')?'stream':url.pathname.includes('/frame')?'frame':url.pathname.includes('/export')?'export':url.pathname.includes('/ingest')?'ingest':url.pathname.includes('/keys')?'keys':'session';
    const ceiling=bucket==='stream'?20:bucket==='frame'?30:bucket==='ingest'?240:60;
    if(!rateLimit(req,bucket,ceiling)){res.setHeader('retry-after','60');return reply(res,429,{error:'rate_limited',bucket});}
    if(url.pathname === '/health') return reply(res, 200, { ok:true, db:true, service:'tracecom-live-relay' });
    if(url.pathname === '/api/live/keys' && req.method === 'POST') {
      if(req.headers['x-relay-admin'] !== admin) return reply(res, 401, {error:'unauthorized'});
      const input = await body(req), key = `tc_live_${crypto.randomBytes(32).toString('hex')}`;
      const requestedScopes = Array.isArray(input.scopes) ? input.scopes.filter(scope => scopes.includes(scope)) : scopes;
      const r = await pool.query('INSERT INTO live_api_keys(name,key_prefix,key_suffix,key_hash,scopes,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,created_at',[input.name||'Codex',key.slice(0,12),key.slice(-4),hash(key),JSON.stringify(requestedScopes),input.expiresAt||null]);
      return reply(res, 201, {id:r.rows[0].id,key,createdAt:r.rows[0].created_at});
    }
    if(url.pathname === '/api/live/keys' && req.method === 'GET') { if(req.headers['x-relay-admin']!==admin)return reply(res,401,{error:'unauthorized'}); return reply(res,200,(await pool.query('SELECT id,name,key_prefix,key_suffix,scopes,created_at,expires_at,revoked_at,last_used_at FROM live_api_keys ORDER BY created_at DESC')).rows); }
    if(url.pathname === '/api/live/ingest-token' && req.method === 'POST') { if(req.headers['x-relay-admin']!==admin)return reply(res,401,{error:'unauthorized'}); const input=await body(req); if(!input.sessionId)return reply(res,400,{error:'session_required'}); const now=Date.now(); return reply(res,201,{token:sign({sessionId:input.sessionId,scope:'telemetry:write',iat:now,exp:now+600000,nonce:crypto.randomUUID(),issuer:'tracecom',audience:'tracecom-live-relay'}),expiresAt:new Date(now+600000).toISOString()}); }
    const keyPath = url.pathname.match(/^\/api\/live\/keys\/([^/]+)$/);
    if(keyPath && req.method === 'DELETE') { if(req.headers['x-relay-admin']!==admin)return reply(res,401,{error:'unauthorized'}); await pool.query('UPDATE live_api_keys SET revoked_at=now() WHERE id=$1',[keyPath[1]]); return reply(res,200,{revoked:true}); }
    if(url.pathname === '/api/live/ingest' && req.method === 'POST') {
      const inputToken=verify((req.headers.authorization||'').replace(/^Bearer /,'')); if(!inputToken) return reply(res,401,{error:'unauthorized'});
      const input=await body(req); if(!input.sessionId||!input.type)return reply(res,400,{error:'invalid_event'});
      if(input.sessionId!==inputToken.sessionId)return reply(res,403,{error:'wrong_session'});
      try { await pool.query('INSERT INTO live_ingest_nonces(nonce,session_id,expires_at) VALUES($1,$2,to_timestamp($3/1000.0))',[inputToken.nonce,input.sessionId,inputToken.exp]); } catch { return reply(res,409,{error:'nonce_reused'}); }
      await pool.query("INSERT INTO live_sessions(id,status,last_seen_at,metadata) VALUES($1,'ONLINE',now(),$2) ON CONFLICT(id) DO UPDATE SET status='ONLINE',last_seen_at=now(),metadata=EXCLUDED.metadata",[input.sessionId,input.session||{}]);
      const e=(await pool.query('INSERT INTO live_events(session_id,event_type,payload_json,sequence_id) VALUES($1,$2,$3,$4) RETURNING id',[input.sessionId,input.type,input.payload||{},input.sequenceId||crypto.randomUUID()])).rows[0];
      if(input.type==='DECISION') await pool.query('INSERT INTO live_decisions(session_id,decision_id,timestamp,direction,confidence,probability_source,p_buy,p_sell,p_wait,raw_model_scores_json) VALUES($1,$2,now(),$3,$4,$5,$6,$7,$8,$9)',[input.sessionId,input.payload?.decisionId||null,input.payload?.direction||null,input.payload?.confidence||null,input.payload?.probabilitySource||null,input.payload?.pBuy||null,input.payload?.pSell||null,input.payload?.pWait||null,input.payload?.rawModelScores||{}]);
      if(input.type==='VISION_MARKET_SAMPLE') await pool.query('INSERT INTO vision_market_samples(session_id,frame_id,timestamp,asset,market_type,timeframe,expiration_seconds,detected_price,detected_price_confidence,observation_json,frame_hash,chart_region_json) VALUES($1,$2,now(),$3,$4,$5,$6,$7,$8,$9,$10,$11)',[input.sessionId,input.payload?.frameId||null,input.payload?.asset||null,input.payload?.marketType||null,input.payload?.timeframe||null,input.payload?.expirationSeconds||null,input.payload?.detectedPrice||null,input.payload?.detectedPriceConfidence||null,input.payload?.observation||{},input.payload?.frameHash||null,input.payload?.chartRegion||null]);
      if(input.type==='SETTLEMENT') await pool.query('INSERT INTO live_settlements(session_id,decision_id,timestamp,result,entry_price,settlement_price) VALUES($1,$2,now(),$3,$4,$5)',[input.sessionId,input.payload?.decisionId||null,input.payload?.result||null,input.payload?.entryPrice||null,input.payload?.settlementPrice||null]);
      if(input.type==='SESSION_ENDED') await pool.query("UPDATE live_sessions SET ended_at=now(),status='ENDED' WHERE id=$1",[input.sessionId]);
      emit(input.type,input,e.id); return reply(res,202,{eventId:e.id});
    }
    if(url.pathname === '/api/live/session') { const started=Date.now(), key=await authenticate(req,'live:session:read'); if(!key)return reply(res,401,{error:'unauthorized'}); const out=await currentSnapshot(); await accessLog(key.id,url.pathname,200,started,req.headers['x-client-label']); return reply(res,200,out); }
    if(url.pathname === '/api/live/frame/latest' && (req.method === 'GET' || req.method === 'PUT')) { const started=Date.now(), ingest=req.method==='PUT'?verify((req.headers.authorization||'').replace(/^Bearer /,'')):null, key=req.method==='GET'?await authenticate(req,'live:frame:read'):null; if(req.method==='GET'&&!key)return reply(res,401,{error:'unauthorized'}); if(req.method==='PUT'&&!ingest)return reply(res,401,{error:'unauthorized'}); if(req.method==='PUT'){const input=await body(req),p=input.payload||input,valid=p&&p.captureType==='crop'&&typeof p.data==='string'&&p.data.length<=2000000&&Number.isFinite(p.width)&&Number.isFinite(p.height)&&p.width>0&&p.height>0&&p.width<=1600&&p.height<=1200&&!('screen' in p)&&!('desktop' in p);if(input.sessionId!==ingest.sessionId)return reply(res,403,{error:'wrong_session'});if(!valid){await accessLog(null,url.pathname,400,started,req.headers['x-client-label']);return reply(res,400,{error:'crop_only_required'});}if(!input.sessionId||!input.frameId)return reply(res,400,{error:'session_and_frame_required'});await pool.query('INSERT INTO live_frames(session_id,frame_id,payload_json) VALUES($1,$2,$3) ON CONFLICT(session_id,frame_id) DO UPDATE SET payload_json=EXCLUDED.payload_json,created_at=now()',[input.sessionId,input.frameId,p]);await accessLog(null,url.pathname,201,started,req.headers['x-client-label']);return reply(res,201,{stored:true,sessionId:input.sessionId,frameId:input.frameId});}const sessionId=url.searchParams.get('sessionId');if(!sessionId)return reply(res,400,{error:'session_required'});const row=(await pool.query('SELECT session_id,frame_id,payload_json,created_at FROM live_frames WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1',[sessionId])).rows[0]||null;await accessLog(key.id,url.pathname,200,started,req.headers['x-client-label']);return reply(res,200,{frame:row}); }
     if(url.pathname === '/api/live/stream') { const started=Date.now(), streamKey=await authenticate(req,'live:events:read'); if(!streamKey)return reply(res,401,{error:'unauthorized'}); res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'}); res.write('retry: 3000\n\n'); const after=Number(req.headers['last-event-id']||0); if(Number.isFinite(after)&&after>0){const missed=(await pool.query('SELECT id,event_type,payload_json FROM live_events WHERE id>$1 ORDER BY id ASC LIMIT 500',[after])).rows; for(const event of missed)res.write(`id: ${event.id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event.payload_json)}\n\n`);} clients.add(res); res.write(`event: session\ndata: ${JSON.stringify(await currentSnapshot())}\n\n`); const h=setInterval(()=>res.write(`event: heartbeat\ndata: ${JSON.stringify({timestamp:new Date().toISOString()})}\n\n`),15000); req.on('close',()=>{clients.delete(res);clearInterval(h);void accessLog(streamKey.id,url.pathname,200,started,req.headers['x-client-label'])}); return; }
    // Filtered export API (kept before the legacy route for compatibility).
    if(url.pathname === '/api/live/export' && req.method === 'GET') { const key=await authenticate(req,'live:export:read'); if(!key)return reply(res,401,{error:'unauthorized'}); const format=url.searchParams.get('format')||'json'; if(!['json','csv'].includes(format))return reply(res,400,{error:'invalid_format'}); const sid=url.searchParams.get('sessionId'), asset=url.searchParams.get('asset'), from=url.searchParams.get('from'), to=url.searchParams.get('to'); const filters=(col,assetCol=false)=>{const c=[],a=[];if(sid){a.push(sid);c.push(`session_id=$${a.length}`);}if(from){a.push(from);c.push(`${col}>=$${a.length}`);}if(to){a.push(to);c.push(`${col}<=$${a.length}`);}if(asset&&assetCol){a.push(asset);c.push(`asset=$${a.length}`);}return {where:c.length?` WHERE ${c.join(' AND ')}`:'',args:a};}; const q=async(table,col,assetCol=false)=>{const f=filters(col,assetCol);return (await pool.query(`SELECT * FROM ${table}${f.where} ORDER BY ${col}`,f.args)).rows;}; const sessions=sid?(await pool.query('SELECT * FROM live_sessions WHERE id=$1',[sid])).rows:(await pool.query('SELECT * FROM live_sessions')).rows; const [events,samples,decisions,settlements]=await Promise.all([q('live_events','event_timestamp'),q('vision_market_samples','timestamp',true),q('live_decisions','timestamp'),q('live_settlements','timestamp')]); const output={sessions,events,samples,decisions,settlements,filters:{sessionId:sid,from,to,asset}};if(format==='csv'){const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;const rows=[['table','id','session_id','timestamp','payload'],...events.map(x=>['event',x.id,x.session_id,x.event_timestamp,JSON.stringify(x.payload_json)]),...samples.map(x=>['sample',x.id,x.session_id,x.timestamp,JSON.stringify(x)]),...decisions.map(x=>['decision',x.id,x.session_id,x.timestamp,JSON.stringify(x)]),...settlements.map(x=>['settlement',x.id,x.session_id,x.timestamp,JSON.stringify(x)])];res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="tracecom-live-export.csv"'});return res.end(rows.map(r=>r.map(esc).join(',')).join('\n'));}return reply(res,200,output); }
    if(url.pathname === '/api/live/export') { if(!await authenticate(req,'live:export:read'))return reply(res,401,{error:'unauthorized'}); const sessionId=url.searchParams.get('sessionId'), where=sessionId?' WHERE session_id=$1':'', args=sessionId?[sessionId]:[]; const sessions=sessionId?(await pool.query('SELECT * FROM live_sessions WHERE id=$1',args)).rows:(await pool.query('SELECT * FROM live_sessions')).rows, events=(await pool.query(`SELECT * FROM live_events${where} ORDER BY id`,args)).rows, samples=(await pool.query(`SELECT * FROM vision_market_samples${where} ORDER BY id`,args)).rows, decisions=(await pool.query(`SELECT * FROM live_decisions${where} ORDER BY id`,args)).rows, settlements=(await pool.query(`SELECT * FROM live_settlements${where} ORDER BY id`,args)).rows; const output={sessions,events,samples,decisions,settlements}; if(url.searchParams.get('format')==='csv'){const esc=v=>`"${String(v??'').replaceAll('"','""')}"`; const rows=[['table','id','session_id','timestamp','payload'],...events.map(x=>['event',x.id,x.session_id,x.event_timestamp,JSON.stringify(x.payload_json)]),...decisions.map(x=>['decision',x.id,x.session_id,x.timestamp,JSON.stringify(x)])]; res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="tracecom-live-export.csv"'});return res.end(rows.map(r=>r.map(esc).join(',')).join('\n')); } if(url.searchParams.get('format')&&url.searchParams.get('format')!=='json')return reply(res,400,{error:'invalid_format'}); return reply(res,200,output); }
    return reply(res,404,{error:'not_found'});
  } catch(error) { return reply(res,error.message==='payload_too_large'?413:400,{error:error.message}); }
});
server.listen(port,()=>console.log(`tracecom-live-relay listening on ${port}`));
