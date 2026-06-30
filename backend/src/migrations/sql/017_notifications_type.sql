-- ─── 017: notifications — coluna type ───────────────────────────────────────
--
-- Adiciona tipagem semântica às notificações para suportar filtragem e
-- categorização visual futura (menção, atribuição, comentário, sistema).
--
-- Valores possíveis atuais:
--   'mention'      — @menção em comentário
--   'assignment'   — demanda atribuída ao usuário
--   'stage_change' — demanda do usuário movida de etapa
--   'comment'      — novo comentário em demanda relacionada ao usuário
--   'system'       — notificação genérica do sistema (default)

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'system';

-- Índice para filtragem futura por tipo (ex: listar só menções)
CREATE INDEX IF NOT EXISTS idx_notifications_type
  ON notifications (user_id, type, created_at DESC);
