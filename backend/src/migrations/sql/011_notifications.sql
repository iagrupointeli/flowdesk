-- ─── 011: notifications — evolução do schema ─────────────────────────────────
--
-- A migration 008 criou a tabela com a coluna `read` e sem `link`.
-- Esta migration alinha o schema para o que o serviço espera:
--   • renomeia `read` → `is_read`
--   • adiciona `link VARCHAR(500)`
--   • remove `demand_id` (substituído por `link` como rota relativa)

-- Renomeia `read` → `is_read` (idempotente via verificação no pg_attribute)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'read'
  ) THEN
    ALTER TABLE notifications RENAME COLUMN "read" TO is_read;
  END IF;
END $$;

-- Adiciona `link` se não existir
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS link VARCHAR(500) NULL;

-- Remove `demand_id` se ainda existir (substituído por `link`)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'demand_id'
  ) THEN
    ALTER TABLE notifications DROP COLUMN demand_id;
  END IF;
END $$;

-- Recria índices (idempotente)
DROP INDEX IF EXISTS idx_notifications_unread;
DROP INDEX IF EXISTS idx_notifications_demand;

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id)
  WHERE is_read = false;
