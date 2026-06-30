-- ─── 028: workflow_stages — exige anexo antes de avançar ────────────────────────
--
-- Gate de handoff comercial→produção: impede mover uma demanda para esta etapa
-- sem que ao menos um anexo (NF, PI ou qualquer documento) tenha sido upado.
-- Segue o padrão de requires_note / requires_assignee já existentes.

ALTER TABLE workflow_stages
  ADD COLUMN IF NOT EXISTS requires_attachment BOOLEAN NOT NULL DEFAULT FALSE;
