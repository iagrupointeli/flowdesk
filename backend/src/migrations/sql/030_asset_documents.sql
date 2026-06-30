-- 030: asset_documents — documentos com vencimento por ponto OOH
--
-- Controla alvarás, contratos de locação, seguros e licenças municipais.
-- O job diário `runDocumentExpiryCheck` notifica super_admins quando
-- um documento vence em 30, 15, 7 ou 1 dia.

CREATE TABLE IF NOT EXISTS asset_documents (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID         NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  doc_type    VARCHAR(20)  NOT NULL DEFAULT 'outro'
                CHECK (doc_type IN ('alvara', 'contrato', 'seguro', 'licenca', 'outro')),
  expires_at  DATE         NOT NULL,
  notes       TEXT,
  created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_documents_asset
  ON asset_documents (asset_id);

CREATE INDEX IF NOT EXISTS idx_asset_documents_expires
  ON asset_documents (expires_at);
