-- 035: QUANT / RESEARCH PLATFORM — registries e jobs de pesquisa (fora do hot path).
-- Nenhuma tabela aqui controla execucao; tudo e RESEARCH_ONLY.

CREATE TABLE IF NOT EXISTS iq_research_datasets (
  id text PRIMARY KEY,
  version text,
  source text,
  point_in_time boolean NOT NULL DEFAULT true,
  hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iq_research_experiments (
  id text PRIMARY KEY,
  hypothesis text,
  dataset_version text,
  strategy_version text,
  status text NOT NULL DEFAULT 'RESEARCH',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iq_research_hypotheses (
  id text PRIMARY KEY,
  origin text,
  description text,
  created_before_evaluation boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'CANDIDATE',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iq_research_models (
  id text PRIMARY KEY,
  version text,
  type text,
  status text NOT NULL DEFAULT 'RESEARCH',
  hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS iq_research_jobs (
  id text PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  progress numeric NOT NULL DEFAULT 0,
  requested_by text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iq_research_jobs_status ON iq_research_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_research_experiments_status ON iq_research_experiments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_iq_research_hypotheses_status ON iq_research_hypotheses(status, created_at DESC);
