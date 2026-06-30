-- ─── 013: demand_types extensions + textarea field type ─────────────────────
--
-- 1. Adiciona description e archived_at a demand_types
--    - description: texto livre para descrever o tipo de demanda (admin)
--    - archived_at: soft-delete — tipo arquivado some do board mas preserva
--      demands históricas
--
-- 2. Adiciona 'textarea' ao CHECK constraint de demand_type_fields.field_type
--    - Necessário para o construtor de formulários dinâmicos (Fase 16)
--    - Compatível com buildDemandSchema (case 'textarea' já tratado)

ALTER TABLE demand_types
  ADD COLUMN IF NOT EXISTS description TEXT NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_demand_types_active
  ON demand_types (department_id)
  WHERE archived_at IS NULL;

-- Remove a constraint anônima gerada pelo PostgreSQL no CREATE TABLE
-- e recria com o enum expandido.
-- O nome demand_type_fields_field_type_check é o padrão automático do PG
-- para CHECK sem nome explícito: <tablename>_<columnname>_check.
ALTER TABLE demand_type_fields
  DROP CONSTRAINT IF EXISTS demand_type_fields_field_type_check,
  ADD CONSTRAINT demand_type_fields_field_type_check
    CHECK (field_type IN ('text', 'textarea', 'number', 'date', 'select', 'cpf'));
