-- ─── 004: demands ─────────────────────────────────────────────────────────────

CREATE TABLE demands (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title               VARCHAR(500) NOT NULL,
  description         TEXT         NOT NULL,
  requester_id        UUID         NOT NULL REFERENCES users(id)        ON DELETE RESTRICT,
  demand_type_id      UUID         NOT NULL REFERENCES demand_types(id) ON DELETE RESTRICT,

  -- current_stage_id é nullable durante instantes de transição atômica
  current_stage_id    UUID         NULL,
  current_assignee_id UUID         NULL REFERENCES users(id) ON DELETE RESTRICT,

  -- exception_state: OVERRIDE explícito do usuário, ortogonal ao fluxo de etapas.
  -- NULL = demanda fluindo normalmente (qualquer etapa, incluindo a final).
  -- "Concluída" = exception_state IS NULL AND stage.is_final = true.
  -- on_hold / cancelled = interrupção forçada, independente da etapa atual.
  exception_state     VARCHAR(20)  NULL
                      CHECK (exception_state IN ('on_hold', 'cancelled')),

  -- Snapshot imutável dos demand_type_fields no momento da criação.
  -- Validações futuras usam este snapshot, não o schema atual.
  fields_snapshot     JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- Valores preenchidos pelo usuário. Chaves = id do campo (não o label).
  -- Para campos select: valor = id da opção (não o label).
  payload             JSONB        NOT NULL DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- FK composta: garante que current_stage_id pertença ao demand_type_id desta demanda.
  -- Depende de workflow_stages.UNIQUE(id, demand_type_id) criada na migration 003.
  FOREIGN KEY (current_stage_id, demand_type_id)
    REFERENCES workflow_stages (id, demand_type_id)
    DEFERRABLE INITIALLY DEFERRED
    -- DEFERRABLE permite que a transação de criação insira demands antes de
    -- popular current_stage_id, desde que o commit final seja consistente.
);

-- FKs não cobertas por PK → índices explícitos
CREATE INDEX idx_demands_requester ON demands (requester_id);
CREATE INDEX idx_demands_type      ON demands (demand_type_id);
CREATE INDEX idx_demands_stage     ON demands (current_stage_id);
-- índice parcial: query de Kanban "minhas demandas" é a mais frequente
CREATE INDEX idx_demands_assignee  ON demands (current_assignee_id)
  WHERE current_assignee_id IS NOT NULL;
