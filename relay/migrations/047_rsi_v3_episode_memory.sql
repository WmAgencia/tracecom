-- 047: RSI V3.1 — memoria causal do episodio (EVENTO != ESTADO) + observabilidade corrigida.
-- Rejeicao Bollinger e DI cross persistidos com timestamp/validade; revalidation/submit preservados.
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS bollinger_rejection_at bigint;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS bollinger_rejection_price numeric;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS bollinger_rejection_direction text;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS bollinger_reentry_confirmed boolean;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS bars_since_rejection int;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS ms_since_rejection bigint;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS di_cross_at bigint;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS di_cross_direction text;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS di_cross_age_ms bigint;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS new_direction_confirmed_at bigint;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS rejection_valid boolean;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS revalidation_at bigint;
ALTER TABLE iq_rsi_opportunities_v3 ADD COLUMN IF NOT EXISTS submit_at bigint;

ALTER TABLE iq_rsi_agent_state_v3 ADD COLUMN IF NOT EXISTS bollinger_rejection_at bigint;
ALTER TABLE iq_rsi_agent_state_v3 ADD COLUMN IF NOT EXISTS di_cross_at bigint;
ALTER TABLE iq_rsi_agent_state_v3 ADD COLUMN IF NOT EXISTS new_direction_confirmed_at bigint;
