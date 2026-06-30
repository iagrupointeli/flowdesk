-- ─── 029: stage_notifications — automação de notificação por etapa ──────────────
--
-- Quando uma demanda entra em uma etapa configurada, o sistema dispara
-- notificações automáticas para solicitante e/ou responsável.
-- A mensagem suporta {title} como placeholder (substituído pelo título da demanda).

CREATE TABLE IF NOT EXISTS stage_notifications (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id            UUID        NOT NULL REFERENCES workflow_stages(id) ON DELETE CASCADE,
  notify_requester    BOOLEAN     NOT NULL DEFAULT false,
  notify_assignee     BOOLEAN     NOT NULL DEFAULT false,
  message_template    VARCHAR(500) NOT NULL DEFAULT 'Demanda "{title}" avançou de etapa.',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (stage_id)  -- máx. 1 regra por etapa
);

CREATE INDEX IF NOT EXISTS idx_stage_notifications_stage ON stage_notifications (stage_id);
