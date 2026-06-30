-- ─── 040: log de ciclo de vida dos ativos OOH ─────────────────────────────────
--
-- Histórico de manutenções, vistorias, reparos e outros eventos físicos
-- vinculados a cada ponto. Complementa o TimelineModal de demandas.

CREATE TABLE IF NOT EXISTS asset_lifecycle_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     uuid        NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  event_type   varchar(30) NOT NULL CHECK (event_type IN ('manutencao','vistoria','reparo','troca_material','outro')),
  description  text        NOT NULL,
  performed_at date        NOT NULL,
  next_date    date,
  created_by   uuid        NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_lifecycle_asset_id
  ON asset_lifecycle_logs(asset_id, performed_at DESC);
