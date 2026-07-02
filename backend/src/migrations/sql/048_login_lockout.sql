-- ─── 048: login lockout — proteção contra brute force ─────────────────────────
--
-- failed_login_attempts: contador de tentativas inválidas consecutivas.
-- locked_until:           timestamp até quando a conta fica bloqueada.
-- Ambos resetados no login bem-sucedido.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until           TIMESTAMPTZ NULL;
