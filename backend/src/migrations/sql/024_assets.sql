-- ─── 024: assets — inventário de pontos OOH ──────────────────────────────────
--
-- O ativo central de uma empresa OOH são os pontos físicos (painéis, empenas,
-- LED, lonas). Esta tabela é o registro estruturado deles; demandas passam a
-- poder referenciar o ponto em que acontecem (asset_id opcional).
--
-- Cada ponto acumula histórico: todas as demandas (instalação, manutenção,
-- checking) vinculadas a ele formam a timeline do ativo.
--
-- code:
--   Código interno legível (ex: "PT-001", "LED-PAULISTA-02"). Único quando
--   preenchido; NULL permitido para cadastros rápidos.
--
-- Escopo: pontos são ativos da EMPRESA (globais), não de um departamento.
--   Leitura: todos os usuários autenticados (para vincular ao criar demanda).
--   Escrita: super_admin e dept_admin.

CREATE TABLE IF NOT EXISTS assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(50) NULL,
  name        VARCHAR(200) NOT NULL,
  asset_type  VARCHAR(30) NOT NULL DEFAULT 'painel'
              CHECK (asset_type IN ('painel','empena','led','lona','outdoor','mub','outro')),
  address     TEXT NULL,
  city        VARCHAR(120) NULL,
  dimensions  VARCHAR(80) NULL,
  notes       TEXT NULL,
  archived_at TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidade do código apenas entre ativos não arquivados
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_code_unique
  ON assets (code)
  WHERE code IS NOT NULL AND archived_at IS NULL;

-- Vínculo demanda → ponto (opcional)
ALTER TABLE demands
  ADD COLUMN IF NOT EXISTS asset_id UUID NULL REFERENCES assets(id);

CREATE INDEX IF NOT EXISTS idx_demands_asset
  ON demands (asset_id)
  WHERE asset_id IS NOT NULL;
