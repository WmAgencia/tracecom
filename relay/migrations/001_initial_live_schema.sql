CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS live_api_keys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,key_prefix text,key_suffix text,key_hash text UNIQUE,scopes jsonb,created_at timestamptz DEFAULT now(),expires_at timestamptz,revoked_at timestamptz,last_used_at timestamptz);
CREATE TABLE IF NOT EXISTS live_sessions(id text PRIMARY KEY,started_at timestamptz DEFAULT now(),ended_at timestamptz,status text,last_seen_at timestamptz,metadata jsonb DEFAULT '{}');
CREATE TABLE IF NOT EXISTS live_events(id bigserial PRIMARY KEY,session_id text REFERENCES live_sessions(id),event_type text,event_timestamp timestamptz DEFAULT now(),payload_json jsonb,sequence_id text UNIQUE);
CREATE TABLE IF NOT EXISTS vision_market_samples(id bigserial PRIMARY KEY,session_id text,frame_id text,timestamp timestamptz,asset text,market_type text,timeframe text,expiration_seconds integer,detected_price numeric,detected_price_confidence numeric,observation_json jsonb,frame_hash text,chart_region_json jsonb);
CREATE TABLE IF NOT EXISTS live_decisions(id bigserial PRIMARY KEY,session_id text,decision_id text,timestamp timestamptz,direction text,confidence numeric,probability_source text,p_buy numeric,p_sell numeric,p_wait numeric,raw_model_scores_json jsonb);
CREATE TABLE IF NOT EXISTS live_settlements(id bigserial PRIMARY KEY,session_id text,decision_id text,timestamp timestamptz,result text,entry_price numeric,settlement_price numeric);
CREATE TABLE IF NOT EXISTS live_access_logs(id bigserial PRIMARY KEY,api_key_id uuid,endpoint text,timestamp timestamptz DEFAULT now(),status integer,latency_ms integer,client_label text);
