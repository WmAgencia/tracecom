-- 019: sessao IQ persistida CRIPTOGRAFADA (AES-256-GCM). Nunca em plaintext; nunca exposta ao frontend.
CREATE TABLE IF NOT EXISTS iq_auth_session (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ssid_enc text NOT NULL,
  iv text NOT NULL,
  tag text NOT NULL,
  email_masked text,
  connected_at bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
