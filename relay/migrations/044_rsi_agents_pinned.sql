-- 044: RSI AGENTS PINADOS (12 = 6 STRICT + 6 PULLBACK) — pino persistido, fail closed e observabilidade completa.
-- Mercado ausente/fechado/sem feed/invalido/em conflito NAO troca de estrategia: fica bloqueado com motivo exato.
ALTER TABLE iq_rsi_agent_assignments ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE iq_rsi_agent_assignments ADD COLUMN IF NOT EXISTS block_reason text;
ALTER TABLE iq_rsi_agent_state ADD COLUMN IF NOT EXISTS account_mode text;
ALTER TABLE iq_rsi_agent_state ADD COLUMN IF NOT EXISTS requested_stake numeric;
ALTER TABLE iq_rsi_agent_state ADD COLUMN IF NOT EXISTS effective_stake numeric;
ALTER TABLE iq_rsi_agent_state ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE iq_rsi_agent_state ADD COLUMN IF NOT EXISTS execution_id text;
CREATE INDEX IF NOT EXISTS idx_iq_rsi_agent_assignments_pinned ON iq_rsi_agent_assignments(pinned, strategy);
