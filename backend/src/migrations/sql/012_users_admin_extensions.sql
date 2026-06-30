-- ─── 012: extensões para painel Admin de Usuários ───────────────────────────
--
-- Adiciona coluna is_active como GENERATED ALWAYS (coluna computada persistida).
-- Preserva total compatibilidade com o código existente que usa deactivated_at:
--   is_active = true   ←→  deactivated_at IS NULL   (usuário ativo)
--   is_active = false  ←→  deactivated_at NOT NULL  (usuário desativado)
--
-- Benefícios:
--   - Queries de listagem admin podem filtrar por is_active sem IS NULL check
--   - JSON serializado de usuários inclui campo booleano explícito
--   - Índice parcial em is_active = true para listagens de usuários ativos
--
-- IMPORTANTE: o soft-delete continua sendo controlado por deactivated_at.
-- Nunca grave diretamente em is_active — é gerado automaticamente pelo banco.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN
  GENERATED ALWAYS AS (deactivated_at IS NULL) STORED;

-- Índice parcial para listagens de usuários ativos (caso mais frequente)
CREATE INDEX IF NOT EXISTS idx_users_is_active_true
  ON users (is_active) WHERE is_active = true;
