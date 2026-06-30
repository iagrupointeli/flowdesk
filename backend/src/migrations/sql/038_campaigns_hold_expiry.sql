-- ─── 038: campaigns — expiração automática de holds ──────────────────────────
--
-- expires_at: data/hora em que o hold (approval_status='pending') expira
-- automaticamente. NULL = sem expiração (campanhas aprovadas/rejeitadas
-- ignoram este campo).

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;
