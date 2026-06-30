-- ─── 025: attachments.kind — evidências de checking fotográfico ──────────────
--
-- Checking é processo central de OOH: a prova fotográfica de que a peça está
-- exibida é o que libera o faturamento junto ao anunciante.
--
-- kind:
--   'generic'  — anexo comum (contratos, artes, documentos)
--   'checking' — evidência fotográfica de veiculação/instalação
--
-- Evidências alimentam a galeria comparativa na demanda e o Relatório de
-- Checking em PDF gerado para o cliente final.

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'generic'
    CHECK (kind IN ('generic', 'checking'));

-- Índice parcial: galeria e relatório PDF buscam só evidências da demanda
CREATE INDEX IF NOT EXISTS idx_attachments_checking
  ON attachments (demand_id, entered_at DESC)
  WHERE kind = 'checking';
