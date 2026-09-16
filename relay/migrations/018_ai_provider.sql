-- 018_ai_provider.sql — configuracao do provider de IA (server-side, nunca exposta ao frontend).
CREATE TABLE IF NOT EXISTS ai_provider_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  provider text NOT NULL DEFAULT 'openCodeGo',
  model text,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
