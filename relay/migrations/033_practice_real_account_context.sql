-- 033: isolamento PRACTICE x REAL (account_context) + persistencia do contexto ativo.
--
-- Nenhuma regra de estrategia/stake/Brain e alterada. O contexto ativo e persistido
-- apenas para exibicao (REAL sempre restaura LOCKED; ARMED nunca e persistido).

ALTER TABLE iq_executions ADD COLUMN IF NOT EXISTS account_context text NOT NULL DEFAULT 'PRACTICE';
CREATE INDEX IF NOT EXISTS iq_executions_account_context_idx ON iq_executions (account_context, requested_at DESC);

ALTER TABLE iq_audit_trail ADD COLUMN IF NOT EXISTS account_context text NOT NULL DEFAULT 'PRACTICE';
CREATE INDEX IF NOT EXISTS iq_audit_trail_account_context_idx ON iq_audit_trail (account_context, created_at DESC);

CREATE TABLE IF NOT EXISTS iq_account_context (
  id integer PRIMARY KEY CHECK (id = 1),
  active_context text NOT NULL DEFAULT 'PRACTICE' CHECK (active_context IN ('PRACTICE','REAL')),
  real_locked boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO iq_account_context (id, active_context, real_locked) VALUES (1, 'PRACTICE', true)
ON CONFLICT (id) DO NOTHING;

-- Contas PRACTICE e REAL nunca compartilham execucao/journal/PnL: a coluna e a
-- fonte de verdade para filtro em todas as consultas de execucao.
COMMENT ON COLUMN iq_executions.account_context IS 'PRACTICE/REAL — isolamento de conta; nunca misturar PnL/journal.';
