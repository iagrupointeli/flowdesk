-- ─── 010: rastreia troca de senha no primeiro acesso ─────────────────────────
--
-- password_changed_at NULL  →  usuário nunca trocou a senha (primeiro acesso pendente)
-- password_changed_at NOT NULL  →  senha definida pelo próprio usuário pelo menos 1x
--
-- Usuários existentes: marcamos como já trocados (NULL seria enganoso para
-- contas criadas antes desta migração que já estão em uso).
-- Contas novas criadas via POST /users: coluna começa como NULL.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL;

-- Usuários pré-existentes são marcados como tendo definido senha (NOW())
-- para não forçar re-troca em contas que já estão ativas.
UPDATE users SET password_changed_at = NOW()
WHERE password_changed_at IS NULL;
