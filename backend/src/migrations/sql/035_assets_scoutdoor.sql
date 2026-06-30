-- ─── 035: assets — campos de origem e foto ────────────────────────────────────
--
-- Suporte à sincronização automática com o Scoutdoor e outras fontes externas.
--
-- state:               UF do ponto (ex: 'SC', 'SP')
-- source:              origem do cadastro ('manual' | 'scoutdoor' | ...)
-- photo_url:           URL da foto principal (Scoutdoor CDN ou MinIO)
-- impressions_monthly: visualizações mensais estimadas (vinda do Scoutdoor)

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS state               VARCHAR(2)  NULL,
  ADD COLUMN IF NOT EXISTS source              VARCHAR(30) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS photo_url           TEXT        NULL,
  ADD COLUMN IF NOT EXISTS impressions_monthly INTEGER     NULL;
