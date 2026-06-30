-- ─── 019: departments — updated_at + soft-delete (archived_at) ───────────────

ALTER TABLE departments ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NULL;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

-- Índice parcial: query mais frequente é "listar ativos"
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments (name) WHERE archived_at IS NULL;
