-- 055: V3 agentes LLM + scheduler (observe-only; log completo por opportunity).
ALTER TABLE iq_v3_opportunities ADD COLUMN IF NOT EXISTS agent_mode text;
ALTER TABLE iq_v3_opportunities ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz;
ALTER TABLE iq_v3_opportunities ADD COLUMN IF NOT EXISTS scheduled_fire_at timestamptz;
ALTER TABLE iq_v3_opportunities ADD COLUMN IF NOT EXISTS revalidation jsonb;
COMMENT ON COLUMN iq_v3_opportunities.agent_mode IS 'LLM (DeepSeek v4.1-flash via opencode-go) ou DETERMINISTIC_OBSERVE (nunca aprova).';
COMMENT ON COLUMN iq_v3_opportunities.revalidation IS 'Checagens do disparo no alvo (~TTE302): janela, invalidations, blockers, resultado.';
