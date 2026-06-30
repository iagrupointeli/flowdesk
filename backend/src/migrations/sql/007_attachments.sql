-- ─── 007: attachments ─────────────────────────────────────────────────────────
-- Registra os arquivos enviados. É o próprio evento de upload —
-- não há linha duplicada em demand_feed para attachment_added.
-- O UNION ALL da timeline lê esta tabela diretamente.

CREATE TABLE attachments (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id   UUID         NOT NULL REFERENCES demands(id)          ON DELETE RESTRICT,
  uploaded_by UUID         NOT NULL REFERENCES users(id)            ON DELETE RESTRICT,
  -- contexto operacional no momento do upload (auditoria temporal)
  stage_id    UUID         NULL     REFERENCES workflow_stages(id)  ON DELETE RESTRICT,
  assignee_id UUID         NULL     REFERENCES users(id)            ON DELETE RESTRICT,
  -- UUID puro no MinIO — sem demand_id na chave, evita enumeração
  file_path   VARCHAR(255) NOT NULL UNIQUE,
  file_name   VARCHAR(500) NOT NULL,
  file_size   INTEGER      NOT NULL CHECK (file_size > 0),
  entered_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índice para paginação cursor-based no UNION ALL da timeline
CREATE INDEX idx_attachments_cursor   ON attachments (demand_id, entered_at, id);

-- FKs não cobertas por PK
CREATE INDEX idx_attachments_uploader ON attachments (uploaded_by);
CREATE INDEX idx_attachments_stage    ON attachments (stage_id)    WHERE stage_id IS NOT NULL;
CREATE INDEX idx_attachments_assignee ON attachments (assignee_id) WHERE assignee_id IS NOT NULL;
