-- ─── 002: demand_types, demand_type_fields ────────────────────────────────────

CREATE TABLE demand_types (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  department_id UUID         NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_demand_types_dept ON demand_types (department_id);

CREATE TABLE demand_type_fields (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_type_id UUID         NOT NULL REFERENCES demand_types(id) ON DELETE RESTRICT,
  label          VARCHAR(255) NOT NULL,
  -- field_type é imutável após criação (nunca faça ALTER nesta coluna)
  field_type     VARCHAR(20)  NOT NULL
                 CHECK (field_type IN ('text', 'number', 'date', 'select', 'cpf')),
  required       BOOLEAN      NOT NULL DEFAULT false,
  -- options armazena [{id: uuid, label: string}] para campos select
  -- payload das demandas armazena o ID da opção, nunca o label
  options        JSONB        NULL,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  -- nunca hard-delete: campo arquivado continua renderizando em demandas históricas
  archived_at    TIMESTAMPTZ  NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_demand_type_fields_type   ON demand_type_fields (demand_type_id);
-- índice parcial para busca de campos ativos (caso comum em formulários)
CREATE INDEX idx_demand_type_fields_active ON demand_type_fields (demand_type_id, display_order)
  WHERE archived_at IS NULL;
