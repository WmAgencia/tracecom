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
const scopes = ['live:session:read', 'live:events:read', 'live:frame:read', 'live:export:read', 'debug:read', 'logs:read', 'traces:read', 'agents:read', 'config:read', 'research:read', 'research:run', 'replay:run', 'shadow:read', 'shadow:run', 'training:read'];
const hash = key => crypto.createHash('sha256').update(`${pepper}:${key}`).digest('hex');
const sign = payload => { const raw=Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${raw}.${crypto.createHmac('sha256',admin).update(raw).digest('base64url')}`; };
const verify = token => { const [raw,sig]=String(token||'').split('.'), expected=raw?crypto.createHmac('sha256',admin).update(raw).digest('base64url'):''; if(!raw||!sig||sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null; const value=JSON.parse(Buffer.from(raw,'base64url').toString()); return value.exp>Date.now()&&value.scope==='telemetry:write'&&value.issuer==='tracecom'&&value.audience==='tracecom-live-relay'&&value.nonce?value:null; };
const reply = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
function rateLimit(req, bucket, ceiling, windowMs=60000) { const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim(); const key=`${bucket}:${forwarded||req.socket.remoteAddress||'unknown'}`, now=Date.now(), hit=limits.get(key)||{at:now,count:0}; if(now-hit.at>windowMs){hit.at=now;hit.count=0;} hit.count++; limits.set(key,hit); return hit.count<=ceiling; }
async function body(req, limit = 262144) { let raw=''; for await (const part of req) { raw += part; if(raw.length > limit) throw Error('payload_too_large'); } return raw ? JSON.parse(raw) : {}; }
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
    const bucket=url.pathname.includes('/stream')?'stream':url.pathname.includes('/frame')?'frames':url.pathname.includes('/export')?'export':url.pathname.includes('/logs')?'logs':url.pathname.includes('/traces')?'traces':url.pathname.includes('/debug')?'debug':url.pathname.includes('/ingest')?'ingest':url.pathname.includes('/keys')?'keys':'session';
    const ceiling=bucket==='stream'?20:bucket==='frames'?30:bucket==='logs'?120:bucket==='traces'?120:bucket==='debug'?120:bucket==='export'?30:bucket==='ingest'?240:bucket==='keys'?60:60;
    if(!rateLimit(req,bucket,ceiling)){res.setHeader('retry-after','60');return reply(res,429,{error:'rate_limited',bucket});}
    if(url.pathname === '/health') return reply(res, 200, { ok:true, db:true, service:'tracecom-live-relay' });
    if(url.pathname === '/api/live/keys' && req.method === 'POST') {
      if(req.headers['x-relay-admin'] !== admin) return reply(res, 401, {error:'unauthorized'});
      const input = await body(req), key = `tc_live_${crypto.randomBytes(32).toString('hex')}`;
      const presetScopes = input.preset === 'OPENCODE_FULL_DIAGNOSTIC' ? scopes : null;
      const requestedScopes = presetScopes || (Array.isArray(input.scopes) ? input.scopes.filter(scope => scopes.includes(scope)) : scopes);
      const r = await pool.query('INSERT INTO live_api_keys(name,key_prefix,key_suffix,key_hash,scopes,expires_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id,created_at',[input.name||'Codex',key.slice(0,12),key.slice(-4),hash(key),JSON.stringify(requestedScopes),input.expiresAt||null]);
      return reply(res, 201, {id:r.rows[0].id,key,createdAt:r.rows[0].created_at});
    }
    if(url.pathname === '/api/live/keys' && req.method === 'GET') { if(req.headers['x-relay-admin']!==admin)return reply(res,401,{error:'unauthorized'}); return reply(res,200,(await pool.query('SELECT id,name,key_prefix,key_suffix,scopes,created_at,expires_at,revoked_at,last_used_at FROM live_api_keys ORDER BY created_at DESC')).rows); }
    if(url.pathname === '/api/live/ingest-token' && req.method === 'POST') { if(req.headers['x-relay-admin']!==admin)return reply(res,401,{error:'unauthorized'}); const input=await body(req); if(!input.sessionId)return reply(res,400,{error:'session_required'}); const now=Date.now(); return reply(res,201,{token:sign({sessionId:input.sessionId,scope:'telemetry:write',iat:now,exp:now+600000,nonce:crypto.randomUUID(),issuer:'tracecom',audience:'tracecom-live-relay'}),expiresAt:new Date(now+600000).toISOString()}); }
    const trainingSessionPath = url.pathname.match(/^\/api\/training\/sessions\/([^/]+)$/);
    if(trainingSessionPath && (req.method === 'GET' || req.method === 'PUT')) {
      if(req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const id = decodeURIComponent(trainingSessionPath[1]);
      if(req.method === 'GET') { const row = (await pool.query('SELECT payload_json FROM training_sessions WHERE id=$1',[id])).rows[0]; if(!row) return reply(res, 404, { error: 'training_session_not_found' }); return reply(res, 200, { session: row.payload_json }); }
      const input = await body(req, 1500000); if(!input.session || typeof input.session !== 'object') return reply(res, 400, { error: 'session_required' });
      await pool.query("INSERT INTO training_sessions(id,status,payload_json,updated_at) VALUES($1,$2,$3::jsonb,now()) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,payload_json=EXCLUDED.payload_json,updated_at=now()",[id,String(input.session.status||'ACTIVE').slice(0,20),JSON.stringify(input.session)]);
      return reply(res, 200, { stored: true, sessionId: id });
    }
    const sessionLogs = url.pathname.match(/^\/api\/live\/sessions\/([^/]+)\/logs$/);
    if(sessionLogs) {
      const sid = decodeURIComponent(sessionLogs[1]);
      if(req.method === 'POST') {
        const ingest = verify((req.headers.authorization||'').replace(/^Bearer /,''));
        if(req.headers['x-relay-admin'] !== admin && !(ingest && ingest.sessionId === sid)) return reply(res, 401, { error: 'unauthorized' });
        const input = await body(req, 1500000); const rows = Array.isArray(input.logs) ? input.logs.slice(0, 200) : [];
        for(const row of rows) await pool.query('INSERT INTO diagnostic_logs(session_id,log_id,component,level,event,message,structured_data,request_id,trace_id,span_id,frame_id,candle_id,signal_id,trade_id,evaluation_id,market_event_id,code_version) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',[sid,String(row.logId||crypto.randomUUID()).slice(0,80),String(row.component||'browser').slice(0,32),String(row.level||'info').slice(0,12),String(row.event||'LOG').slice(0,64),String(row.message||'').slice(0,600),JSON.stringify(row.structuredData||{}),row.requestId||null,row.traceId||null,row.spanId||null,row.frameId||null,row.candleId||null,row.signalId||null,row.tradeId||null,row.evaluationId||null,row.marketEventId||null,String(row.codeVersion||'').slice(0,64)||null]);
        return reply(res, 202, { stored: rows.length });
      }
      const key = await authenticate(req, 'logs:read'); if(!key && req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const filters=[], args=[sid]; const add=(col,value)=>{ if(value){ args.push(value); filters.push(`${col}=$${args.length}`); } };
      add('level', url.searchParams.get('level')); add('component', url.searchParams.get('component')); add('event', url.searchParams.get('eventType')); add('request_id', url.searchParams.get('requestId')); add('trace_id', url.searchParams.get('traceId')); add('signal_id', url.searchParams.get('signalId')); add('evaluation_id', url.searchParams.get('evaluationId')); add('frame_id', url.searchParams.get('frameId')); add('candle_id', url.searchParams.get('candleId')); add('market_event_id', url.searchParams.get('marketEventId'));
      const from=url.searchParams.get('from'), to=url.searchParams.get('to'); if(from){args.push(from);filters.push(`logged_at>=$${args.length}`);} if(to){args.push(to);filters.push(`logged_at<=$${args.length}`);}
      const where = ' WHERE session_id=$1' + (filters.length?` AND ${filters.join(' AND ')}`:'');
      const logs=(await pool.query(`SELECT log_id as "logId",logged_at as timestamp,component,level,event,message,structured_data as "structuredData",request_id as "requestId",trace_id as "traceId",span_id as "spanId",frame_id as "frameId",candle_id as "candleId",signal_id as "signalId",trade_id as "tradeId",evaluation_id as "evaluationId",market_event_id as "marketEventId",code_version as "codeVersion" FROM diagnostic_logs${where} ORDER BY logged_at DESC LIMIT 500`,args)).rows;
      if(key) await accessLog(key.id,url.pathname,200,Date.now(),req.headers['x-client-label']);
      return reply(res, 200, { sessionId: sid, logs });
    }
    const sessionAgentRuns = url.pathname.match(/^\/api\/live\/sessions\/([^/]+)\/agent-runs$/);
    if(sessionAgentRuns) {
      const sid = decodeURIComponent(sessionAgentRuns[1]);
      if(req.method === 'PUT' || req.method === 'POST') {
        const ingest = verify((req.headers.authorization||'').replace(/^Bearer /,''));
        if(req.headers['x-relay-admin'] !== admin && !(ingest && ingest.sessionId === sid)) return reply(res, 401, { error: 'unauthorized' });
        const input = await body(req, 1500000); const rows = Array.isArray(input.runs) ? input.runs.slice(0, 100) : [];
        for(const run of rows) await pool.query('INSERT INTO agent_runs(session_id,agent_run_id,agent_id,agent_name,agent_role,agent_version,model,provider,prompt_version,config_version,started_at,completed_at,latency_ms,status,structured_input,structured_output,confidence,evidence,warnings,error,fallback_used,trace_id,market_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11/1000.0),to_timestamp($12/1000.0),$13,$14,$15::jsonb,$16::jsonb,$17,$18::jsonb,$19::jsonb,$20,$21,$22,$23) ON CONFLICT(agent_run_id) DO NOTHING',[sid,String(run.agentRunId||crypto.randomUUID()).slice(0,80),String(run.agentId||'').slice(0,64),String(run.agentName||'').slice(0,64),String(run.agentRole||'').slice(0,32),String(run.agentVersion||'v1').slice(0,32),String(run.model||'').slice(0,64)||null,String(run.provider||'').slice(0,32)||null,String(run.promptVersion||'').slice(0,32)||null,String(run.configVersion||'').slice(0,32)||null,Number(run.startedAt)||Date.now(),Number(run.completedAt)||Date.now(),Number(run.latencyMs)||null,String(run.status||'COMPLETED').slice(0,24),JSON.stringify(run.structuredInput||{}),JSON.stringify(run.structuredOutput||{}),Number.isFinite(Number(run.confidence))?Number(run.confidence):null,JSON.stringify(run.evidence||[]),JSON.stringify(run.warnings||[]),run.error?String(run.error).slice(0,300):null,run.fallbackUsed===true,run.traceId||null,run.marketEventId||null]);
        return reply(res, 202, { stored: rows.length });
      }
      const key = await authenticate(req, 'agents:read'); if(!key && req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const columns='agent_run_id as "agentRunId",agent_id as "agentId",agent_name as "agentName",agent_role as "agentRole",agent_version as "agentVersion",model,provider,prompt_version as "promptVersion",config_version as "configVersion",started_at as "startedAt",completed_at as "completedAt",latency_ms as "latencyMs",status,structured_input as "structuredInput",structured_output as "structuredOutput",confidence,evidence,warnings,error,fallback_used as "fallbackUsed",trace_id as "traceId",market_event_id as "marketEventId",frame_id as "frameId",candle_id as "candleId",decision_id as "decisionId"';
      const runDetail = url.pathname.match(/^\/api\/live\/sessions\/([^/]+)\/agent-runs\/([^/]+)$/);
      if(runDetail && req.method === 'GET') {
        const row=(await pool.query(`SELECT ${columns} FROM agent_runs WHERE session_id=$1 AND agent_run_id=$2`,[decodeURIComponent(runDetail[1]),decodeURIComponent(runDetail[2])])).rows[0];
        if(!row) return reply(res, 404, { error: 'agent_run_not_found' });
        return reply(res, 200, row);
      }
      const agentId=url.searchParams.get('agentId'), runId=url.searchParams.get('agentRunId');
      const where=['session_id=$1']; const args=[sid];
      if(agentId){args.push(agentId);where.push(`agent_id=$${args.length}`);}
      if(runId){args.push(runId);where.push(`agent_run_id=$${args.length}`);}
      const runs=(await pool.query(`SELECT ${columns} FROM agent_runs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 300`,args)).rows;
      return reply(res, 200, { sessionId: sid, runs });
    }
    if(url.pathname === '/api/debug/spans' && req.method === 'POST') {
      const ingest = verify((req.headers.authorization||'').replace(/^Bearer /,''));
      if(req.headers['x-relay-admin'] !== admin && !ingest) return reply(res, 401, { error: 'unauthorized' });
      const input = await body(req, 1500000); const rows = Array.isArray(input.spans) ? input.spans.slice(0, 300) : [];
      for(const span of rows) await pool.query('INSERT INTO trace_spans(span_id,parent_span_id,trace_id,session_id,component,operation,started_at,completed_at,latency_ms,status,error_code,related_ids) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),to_timestamp($8/1000.0),$9,$10,$11,$12::jsonb) ON CONFLICT(span_id) DO NOTHING',[String(span.spanId||crypto.randomUUID()).slice(0,80),span.parentSpanId||null,String(span.traceId||'').slice(0,80)||null,span.sessionId||input.sessionId||null,String(span.component||'').slice(0,32),String(span.operation||'').slice(0,64),Number(span.startedAt)||Date.now(),Number(span.completedAt)||Date.now(),Number(span.latencyMs)||null,String(span.status||'OK').slice(0,16),span.errorCode?String(span.errorCode).slice(0,64):null,JSON.stringify(span.relatedIds||{})]);
      return reply(res, 202, { stored: rows.length });
    }
    if(url.pathname === '/api/debug/network-hops' && req.method === 'POST') {
      const ingest = verify((req.headers.authorization||'').replace(/^Bearer /,''));
      if(req.headers['x-relay-admin'] !== admin && !ingest) return reply(res, 401, { error: 'unauthorized' });
      const input = await body(req, 1500000); const rows = Array.isArray(input.hops) ? input.hops.slice(0, 300) : [];
      for(const hop of rows) await pool.query('INSERT INTO network_hops(request_id,trace_id,hop,route,method,status,started_at,completed_at,latency_ms,upstream,error_code) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),to_timestamp($8/1000.0),$9,$10,$11)',[hop.requestId||null,hop.traceId||null,String(hop.hop||'').slice(0,32),String(hop.route||'').slice(0,120),String(hop.method||'GET').slice(0,8),Number(hop.status)||0,Number(hop.startedAt)||Date.now(),Number(hop.completedAt)||Date.now(),Number(hop.latencyMs)||null,String(hop.upstream||'').slice(0,32),hop.errorCode?String(hop.errorCode).slice(0,64):null]);
      return reply(res, 202, { stored: rows.length });
    }
    if(url.pathname === '/api/debug/decision-provenance' && req.method === 'POST') {
      const ingest = verify((req.headers.authorization||'').replace(/^Bearer /,''));
      if(req.headers['x-relay-admin'] !== admin && !ingest) return reply(res, 401, { error: 'unauthorized' });
      const input = await body(req, 1500000); const p = input.provenance || input;
      await pool.query('INSERT INTO decision_provenance(decision_id,session_id,market_event_id,frame_id,candle_id,price_observation_ids,context_versions,agent_run_ids,bull_run_id,bear_run_id,fusion_run_id,arbiter_run_id,profile,threshold_version,config_version,prompt_version,model_versions,raw_scores,calibrated_scores,decision,directional_lean,why,conflicts,warnings,trace_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$22::jsonb,$23::jsonb,$24::jsonb,$25) ON CONFLICT(decision_id) DO UPDATE SET why=EXCLUDED.why,agent_run_ids=EXCLUDED.agent_run_ids,decision=EXCLUDED.decision,directional_lean=EXCLUDED.directional_lean',[String(p.decisionId||crypto.randomUUID()).slice(0,80),p.sessionId||input.sessionId||null,p.marketEventId||null,p.frameId||null,p.candleId||null,JSON.stringify(p.priceObservationIds||[]),JSON.stringify(p.contextVersions||{}),JSON.stringify(p.agentRunIds||[]),p.bullRunId||null,p.bearRunId||null,p.fusionRunId||null,p.arbiterRunId||null,p.profile||null,p.thresholdVersion||null,p.configVersion||null,p.promptVersion||null,JSON.stringify(p.modelVersions||{}),JSON.stringify(p.rawScores||{}),JSON.stringify(p.calibratedScores||{}),p.decision||null,p.directionalLean||null,JSON.stringify(p.why||{}),JSON.stringify(p.conflicts||[]),JSON.stringify(p.warnings||[]),p.traceId||null]);
      return reply(res, 202, { stored: true, decisionId: p.decisionId || null });
    }
    const provenanceRead = url.pathname.match(/^\/api\/live\/sessions\/([^/]+)\/decision-provenance$/);
    if(provenanceRead && req.method === 'GET') {
      const key = await authenticate(req, 'debug:read'); if(!key && req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const sid = decodeURIComponent(provenanceRead[1]); const decisionId = url.searchParams.get('decisionId');
      const rows = decisionId ? (await pool.query('SELECT * FROM decision_provenance WHERE session_id=$1 AND decision_id=$2',[sid,decisionId])).rows : (await pool.query('SELECT * FROM decision_provenance WHERE session_id=$1 ORDER BY created_at DESC LIMIT 200',[sid])).rows;
      return reply(res, 200, { sessionId: sid, provenance: rows });
    }
    const stateHistoryRead = url.pathname.match(/^\/api\/live\/sessions\/([^/]+)\/state-history$/);
    if(stateHistoryRead && req.method === 'GET') {
      const key = await authenticate(req, 'debug:read'); if(!key && req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const sid = decodeURIComponent(stateHistoryRead[1]); const machine = url.searchParams.get('machine');
      const rows = machine ? (await pool.query('SELECT machine,from_state as "from",to_state as "to",reason,signal_id as "signalId",market_event_id as "marketEventId",trace_id as "traceId",transitioned_at as timestamp FROM state_transitions WHERE session_id=$1 AND machine=$2 ORDER BY transitioned_at DESC LIMIT 500',[sid,machine])).rows : (await pool.query('SELECT machine,from_state as "from",to_state as "to",reason,signal_id as "signalId",market_event_id as "marketEventId",trace_id as "traceId",transitioned_at as timestamp FROM state_transitions WHERE session_id=$1 ORDER BY transitioned_at DESC LIMIT 500',[sid])).rows;
      return reply(res, 200, { sessionId: sid, transitions: rows });
    }
    if(url.pathname === '/api/debug/state-transitions' && req.method === 'POST') {
      const ingest = verify((req.headers.authorization||'').replace(/^Bearer /,''));
      if(req.headers['x-relay-admin'] !== admin && !ingest) return reply(res, 401, { error: 'unauthorized' });
      const input = await body(req, 1500000); const rows = Array.isArray(input.transitions) ? input.transitions.slice(0, 300) : [];
      for(const row of rows) await pool.query('INSERT INTO state_transitions(session_id,machine,from_state,to_state,reason,signal_id,market_event_id,trace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[row.sessionId||input.sessionId||null,String(row.machine||'').slice(0,32),String(row.from||'').slice(0,32),String(row.to||'').slice(0,32),String(row.reason||'').slice(0,120),row.signalId||null,row.marketEventId||null,row.traceId||null]);
      return reply(res, 202, { stored: rows.length });
    }
    const traceSpansRead = url.pathname.match(/^\/api\/debug\/traces\/([^/]+)\/spans$/);
    if(traceSpansRead && req.method === 'GET') {
      const key = await authenticate(req, 'traces:read'); if(!key && req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const traceId = decodeURIComponent(traceSpansRead[1]);
      const [spans,hops] = await Promise.all([
        pool.query('SELECT span_id as "spanId",parent_span_id as "parentSpanId",trace_id as "traceId",session_id as "sessionId",component,operation,started_at as "startedAt",completed_at as "completedAt",latency_ms as "latencyMs",status,error_code as "errorCode",related_ids as "relatedIds" FROM trace_spans WHERE trace_id=$1 ORDER BY started_at',[traceId]),
        pool.query('SELECT request_id as "requestId",hop,route,method,status,started_at as "startedAt",completed_at as "completedAt",latency_ms as "latencyMs",upstream,error_code as "errorCode" FROM network_hops WHERE trace_id=$1 ORDER BY started_at',[traceId]),
      ]);
      return reply(res, 200, { traceId, spans: spans.rows, hops: hops.rows });
    }
    if(url.pathname === '/api/shadow/jobs' && req.method === 'POST') {
      if(req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const input = await body(req); const jobId = String(input.jobId||`job_${Date.now()}`).slice(0,80);
      await pool.query("INSERT INTO shadow_jobs(job_id,status,requested_count,queue_depth,concurrency,idempotency_key,started_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(job_id) DO UPDATE SET status=EXCLUDED.status,requested_count=EXCLUDED.requested_count,queue_depth=EXCLUDED.queue_depth,started_at=now()",[jobId,String(input.status||'RUNNING').slice(0,16),Number(input.requestedCount)||0,Number(input.queueDepth)||0,Number(input.concurrency)||8,input.idempotencyKey||null]);
      return reply(res, 202, { jobId, status: input.status||'RUNNING' });
    }
    if(url.pathname.startsWith('/api/shadow/jobs')) {
      if(req.headers['x-relay-admin'] !== admin) { const key = await authenticate(req, 'shadow:read'); if(!key) return reply(res, 401, { error: 'unauthorized' }); }
      const jobPath = url.pathname.match(/^\/api\/shadow\/jobs\/([^/]+)$/);
      if(jobPath && req.method === 'GET') { const row = (await pool.query('SELECT job_id as "jobId",status,requested_count as "requestedCount",processed_count as "processedCount",failed_count as "failedCount",queue_depth as "queueDepth",concurrency,idempotency_key as "idempotencyKey",created_at as "createdAt",started_at as "startedAt",completed_at as "completedAt",result FROM shadow_jobs WHERE job_id=$1',[decodeURIComponent(jobPath[1])])).rows[0]; if(!row) return reply(res, 404, { error: 'job_not_found' }); return reply(res, 200, row); }
      if(jobPath && req.method === 'PUT') {
        const b = await body(req); await pool.query("UPDATE shadow_jobs SET status=$2,processed_count=$3,failed_count=$4,queue_depth=$5,completed_at=CASE WHEN $2 IN ('COMPLETED','FAILED','CANCELLED') THEN now() ELSE completed_at END,result=COALESCE($6,result) WHERE job_id=$1",[decodeURIComponent(jobPath[1]),String(b.status||'RUNNING').slice(0,16),Number(b.processedCount)||0,Number(b.failedCount)||0,Number(b.queueDepth)||0,b.result?JSON.stringify(b.result):null]);
        return reply(res, 200, { updated: true });
      }
      if(url.pathname === '/api/shadow/jobs' && req.method === 'GET') return reply(res, 200, (await pool.query('SELECT job_id as "jobId",status,requested_count as "requestedCount",processed_count as "processedCount",failed_count as "failedCount",queue_depth as "queueDepth",concurrency,created_at as "createdAt",completed_at as "completedAt" FROM shadow_jobs ORDER BY created_at DESC LIMIT 50')).rows);
    }
    if(url.pathname === '/api/debug/verify-key' && req.method === 'POST') {
      const value = (req.headers.authorization||'').replace(/^Bearer /,'');
      if(!value.startsWith('tc_live_')) return reply(res, 401, { valid: false });
      const result = await pool.query('SELECT scopes FROM live_api_keys WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())',[hash(value)]);
      if(!result.rows[0]) return reply(res, 401, { valid: false });
      return reply(res, 200, { valid: true, scopes: result.rows[0].scopes });
    }
    if(url.pathname === '/api/debug/agent-runs' && req.method === 'POST') {
      const ingest = verify((req.headers.authorization||'').replace(/^Bearer /,''));
      if(req.headers['x-relay-admin'] !== admin && !ingest) return reply(res, 401, { error: 'unauthorized' });
      const input = await body(req, 1500000); const rows = Array.isArray(input.runs) ? input.runs.slice(0, 100) : [];
      for(const run of rows) await pool.query('INSERT INTO agent_runs(session_id,agent_run_id,agent_id,agent_name,agent_role,agent_version,model,provider,prompt_version,config_version,started_at,completed_at,latency_ms,status,structured_input,structured_output,confidence,evidence,warnings,error,fallback_used,trace_id,market_event_id,frame_id,candle_id,decision_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11/1000.0),to_timestamp($12/1000.0),$13,$14,$15::jsonb,$16::jsonb,$17,$18::jsonb,$19::jsonb,$20,$21,$22,$23,$24,$25,$26) ON CONFLICT(agent_run_id) DO NOTHING',[run.sessionId||input.sessionId||null,String(run.agentRunId||crypto.randomUUID()).slice(0,80),String(run.agentId||'').slice(0,64),String(run.agentName||'').slice(0,64),String(run.agentRole||'').slice(0,32),String(run.agentVersion||'v1').slice(0,32),String(run.model||'').slice(0,64)||null,String(run.provider||'').slice(0,32)||null,String(run.promptVersion||'').slice(0,32)||null,String(run.configVersion||'').slice(0,32)||null,Number(run.startedAt)||Date.now(),Number(run.completedAt)||Date.now(),Number(run.latencyMs)||null,String(run.status||'COMPLETED').slice(0,24),JSON.stringify(run.structuredInput||{}),JSON.stringify(run.structuredOutput||{}),Number.isFinite(Number(run.confidence))?Number(run.confidence):null,JSON.stringify(run.evidence||[]),JSON.stringify(run.warnings||[]),run.error?String(run.error).slice(0,300):null,run.fallbackUsed===true,run.traceId||null,run.marketEventId||null,run.frameId||null,run.candleId||null,run.decisionId||null]);
      return reply(res, 202, { stored: rows.length });
    }
    const agentRunGlobal = url.pathname.match(/^\/api\/debug\/agent-runs\/([^/]+)$/);
    if(agentRunGlobal && req.method === 'GET') {
      const key = await authenticate(req, 'agents:read'); if(!key && req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const row=(await pool.query('SELECT agent_run_id as "agentRunId",agent_id as "agentId",agent_name as "agentName",agent_role as "agentRole",agent_version as "agentVersion",model,provider,prompt_version as "promptVersion",config_version as "configVersion",started_at as "startedAt",completed_at as "completedAt",latency_ms as "latencyMs",status,structured_input as "structuredInput",structured_output as "structuredOutput",confidence,evidence,warnings,error,fallback_used as "fallbackUsed",trace_id as "traceId",market_event_id as "marketEventId",frame_id as "frameId",candle_id as "candleId",decision_id as "decisionId",session_id as "sessionId" FROM agent_runs WHERE agent_run_id=$1',[decodeURIComponent(agentRunGlobal[1])])).rows[0];
      if(!row) return reply(res, 404, { error: 'agent_run_not_found' });
      return reply(res, 200, row);
    }
    const agentDetail = url.pathname.match(/^\/api\/debug\/agents\/([^/]+)$/);
    if(agentDetail && req.method === 'GET') {
      if(req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const agentId = decodeURIComponent(agentDetail[1]);
      const [summary,runs] = await Promise.all([
        pool.query('SELECT agent_id as "agentId",agent_name as "agentName",agent_role as "agentRole",count(*)::int as runs,max(created_at) as "lastRunAt" FROM agent_runs WHERE agent_id=$1 GROUP BY agent_id,agent_name,agent_role',[agentId]),
        pool.query('SELECT agent_run_id as "agentRunId",status,latency_ms as "latencyMs",fallback_used as "fallbackUsed",error,started_at as "startedAt" FROM agent_runs WHERE agent_id=$1 ORDER BY created_at DESC LIMIT 100',[agentId]),
      ]);
      if(!summary.rows[0]) return reply(res, 404, { error: 'agent_not_found' });
      return reply(res, 200, { agent: summary.rows[0], runs: runs.rows });
    }
    if(url.pathname === '/api/debug/agents' && req.method === 'GET') {
      if(req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      return reply(res, 200, { agents: (await pool.query('SELECT agent_id as "agentId", agent_name as "agentName", agent_role as "agentRole", count(*)::int as runs, max(created_at) as "lastRunAt" FROM agent_runs GROUP BY agent_id, agent_name, agent_role ORDER BY runs DESC')).rows });
    }
    const sessionTimeline = url.pathname.match(/^\/api\/live\/sessions\/([^/]+)\/timeline$/);
    if(sessionTimeline && req.method === 'GET') {
      const key = await authenticate(req, 'debug:read'); if(!key && req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const sid = decodeURIComponent(sessionTimeline[1]);
      const [events,frames,decisions,settlements,samples,logs,runs]=await Promise.all([
        pool.query('SELECT id,event_type as "type",event_timestamp as "at",payload_json as data FROM live_events WHERE session_id=$1 ORDER BY id',[sid]),
        pool.query('SELECT frame_id as "frameId",created_at as "at",payload_json as data FROM live_frames WHERE session_id=$1 ORDER BY created_at',[sid]),
        pool.query('SELECT decision_id as "decisionId",timestamp as at,direction,confidence,p_buy,p_sell,p_wait FROM live_decisions WHERE session_id=$1 ORDER BY id',[sid]),
        pool.query('SELECT decision_id as "decisionId",timestamp as at,result,entry_price,settlement_price FROM live_settlements WHERE session_id=$1 ORDER BY id',[sid]),
        pool.query('SELECT frame_id as "frameId",timestamp as at,detected_price as price,detected_price_confidence as confidence FROM vision_market_samples WHERE session_id=$1 ORDER BY id',[sid]),
        pool.query('SELECT log_id as "logId",logged_at as at,component,level,event,message,trace_id FROM diagnostic_logs WHERE session_id=$1 ORDER BY logged_at',[sid]),
        pool.query('SELECT agent_run_id as "agentRunId",agent_id as "agentId",agent_name as "agentName",status,latency_ms,started_at as at FROM agent_runs WHERE session_id=$1 ORDER BY started_at',[sid]),
      ]);
      const timeline=[...events.rows.map(r=>({kind:'event',...r})),...frames.rows.map(r=>({kind:'frame',...r})),...decisions.rows.map(r=>({kind:'decision',...r})),...settlements.rows.map(r=>({kind:'settlement',...r})),...samples.rows.map(r=>({kind:'market_sample',...r})),...logs.rows.map(r=>({kind:'log',...r})),...runs.rows.map(r=>({kind:'agent_run',...r}))].sort((a,b)=>new Date(a.at)-new Date(b.at));
      return reply(res, 200, { sessionId: sid, items: timeline });
    }
    const sessionSnapshot = url.pathname.match(/^\/api\/live\/sessions\/([^/]+)\/debug-snapshot$/);
    if(sessionSnapshot && req.method === 'GET') {
      const key = await authenticate(req, 'debug:read'); if(!key && req.headers['x-relay-admin'] !== admin) return reply(res, 401, { error: 'unauthorized' });
      const sid = decodeURIComponent(sessionSnapshot[1]);
      const snapshot = await currentSnapshot();
      const [logs, runs] = await Promise.all([
        pool.query('SELECT log_id as "logId",logged_at as timestamp,level,event,message,trace_id as "traceId" FROM diagnostic_logs WHERE session_id=$1 ORDER BY logged_at DESC LIMIT 50',[sid]),
        pool.query('SELECT agent_id as "agentId",agent_name as "agentName",status,latency_ms as "latencyMs",fallback_used as "fallbackUsed" FROM agent_runs WHERE session_id=$1 ORDER BY created_at DESC LIMIT 50',[sid]),
      ]);
      return reply(res, 200, { snapshot, sessionId: sid, recentLogs: logs.rows, recentAgentRuns: runs.rows, connectionState: snapshot.connectionState });
    }
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
