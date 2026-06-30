-- 031: attachments — kind 'creative' e controle de versão
--
-- Adiciona 'creative' como tipo de anexo para peças criativas (artes, layouts).
-- A coluna `version` numera automaticamente as versões de uma peça por demanda:
-- uploadAttachment incrementa MAX(version)+1 ao receber kind='creative'.

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_kind_check;

ALTER TABLE attachments
  ADD CONSTRAINT attachments_kind_check
    CHECK (kind IN ('generic', 'checking', 'creative'));

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_attachments_creative
  ON attachments (demand_id, version DESC)
  WHERE kind = 'creative';
