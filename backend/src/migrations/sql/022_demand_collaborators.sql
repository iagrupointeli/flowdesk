-- ─── 022: demand_collaborators (seguidores cross-department) ─────────────────
-- Opção B: uma demanda continua pertencendo a UM departamento, mas usuários de
-- qualquer departamento podem ser adicionados como colaboradores. Colaboradores
-- recebem notificações (mudança de etapa, comentários, bloqueio) e têm acesso de
-- leitura/comentário à demanda, sem assumir a propriedade do fluxo.

CREATE TABLE IF NOT EXISTS demand_collaborators (
  demand_id  UUID        NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  added_by   UUID        NULL     REFERENCES users(id)   ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (demand_id, user_id)
);

-- Lookup "quais demandas eu sigo" (notificação → board futuro do colaborador)
CREATE INDEX IF NOT EXISTS idx_demand_collaborators_user
  ON demand_collaborators (user_id);
