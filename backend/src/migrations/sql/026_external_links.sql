-- ─── 026: external_links — portal do prestador externo ───────────────────────
--
-- Prestadores (instaladores, manutenção) não têm conta no sistema. Um link
-- tokenizado dá acesso restrito a UMA demanda: ver o essencial, subir fotos
-- de checking e registrar conclusão do serviço. Sem cadastro, sem senha.
--
-- Segurança:
--   token_hash — SHA-256 hex do token opaco (256 bits, base64url).
--                O token em claro é exibido UMA única vez, na criação.
--   expires_at — validade obrigatória (7–30 dias tipicamente)
--   revoked_at — revogação manual imediata (soft, auditável)
--
-- O upload externo registra uploaded_by = created_by do link (o funcionário
-- que gerou o link responde formalmente pelo material do prestador).

CREATE TABLE IF NOT EXISTS external_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id    UUID NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64) NOT NULL UNIQUE,
  label        VARCHAR(200) NULL,
  created_by   UUID NOT NULL REFERENCES users(id),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_links_demand
  ON external_links (demand_id);
