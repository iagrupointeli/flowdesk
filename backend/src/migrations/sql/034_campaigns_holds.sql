-- ─── 034: campaigns holds + assets is_premium ────────────────────────────────
--
-- Controle de alçadas para reservas:
--
-- assets.is_premium: pontos premium (painel de alta visibilidade, etc.)
--   Qualquer campanha neste ponto entra como 'pending' para aprovação do gestor.
--
-- campaigns.approval_status:
--   'approved' = confirmado (default para pontos normais com duração <= 30 dias)
--   'pending'  = aguardando aprovação do gestor
--   'rejected' = reprovado — archived_at setado automaticamente, slot liberado
--
-- campaigns.approval_note: motivo opcional de rejeição.
-- campaigns.approved_by:   FK para quem aprovou/rejeitou.

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(10) NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approval_note   TEXT NULL,
  ADD COLUMN IF NOT EXISTS approved_by     UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_approval
  ON campaigns (approval_status)
  WHERE approval_status = 'pending' AND archived_at IS NULL;
