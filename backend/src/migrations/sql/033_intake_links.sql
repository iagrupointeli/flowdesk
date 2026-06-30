-- ─── 033: intake_links — links públicos de intake por tipo de demanda ──────────
--
-- Um intake_link é um URL tokenizado que permite criar uma demanda de um tipo
-- específico sem autenticação. O admin gera o link; o submissor preenche o
-- formulário e o sistema cria a demanda automaticamente.
--
-- Segurança: token em claro é retornado UMA VEZ na criação.
--            Apenas o SHA-256 hex (token_hash) é armazenado.
-- Expiração: expires_at NULL = nunca expira.
--            Expirado = formulário exibe mensagem de link inválido.

CREATE TABLE IF NOT EXISTS intake_links (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_type_id  UUID         NOT NULL REFERENCES demand_types(id) ON DELETE CASCADE,
  label           VARCHAR(200) NOT NULL,        -- nome descritivo (ex: "Pedido de Arte Digital")
  token_hash      VARCHAR(64)  NOT NULL UNIQUE, -- SHA-256 hex do token opaco (256 bits)
  expires_at      TIMESTAMPTZ  NULL,
  created_by      UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_links_type
  ON intake_links (demand_type_id);
