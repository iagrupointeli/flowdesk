-- ─── 009: view de SLA ─────────────────────────────────────────────────────────
-- Calcula intervalos de tempo por evento em demand_history.
--
-- Lógica:
--   interval_duration  = tempo total deste evento até o próximo
--   active_duration    = tempo contando apenas quando exception_state IS NULL
--   paused_duration    = tempo contando apenas quando exception_state = 'on_hold'
--
-- Ordenação: sempre por id (SEQUENCE nativo), nunca por entered_at,
--            para garantir ordem determinística mesmo com timestamps idênticos.
--
-- COALESCE(..., CURRENT_TIMESTAMP): demanda ainda ativa conta até agora,
--            evitando NULL no último intervalo de cada demanda.

CREATE VIEW demand_sla AS
WITH intervals AS (
  SELECT
    demand_id,
    id,
    event_type,
    stage_id,
    assignee_id,
    exception_state,
    entered_at,
    COALESCE(
      LEAD(entered_at) OVER (PARTITION BY demand_id ORDER BY id),
      CURRENT_TIMESTAMP
    ) AS next_entered_at
  FROM demand_history
)
SELECT
  demand_id,
  id                                    AS history_id,
  event_type,
  stage_id,
  assignee_id,
  exception_state,
  entered_at,
  next_entered_at,
  -- intervalo total independente do estado
  next_entered_at - entered_at          AS interval_duration,
  -- tempo útil: apenas janelas em fluxo normal
  CASE WHEN exception_state IS NULL
    THEN next_entered_at - entered_at
    ELSE INTERVAL '0'
  END                                   AS active_duration,
  -- tempo parado: apenas janelas em on_hold
  CASE WHEN exception_state = 'on_hold'
    THEN next_entered_at - entered_at
    ELSE INTERVAL '0'
  END                                   AS paused_duration
FROM intervals;

-- Para agregar SLA por demanda na camada de serviço:
-- SELECT demand_id,
--        SUM(active_duration) AS total_active,
--        SUM(paused_duration) AS total_paused
-- FROM demand_sla
-- WHERE demand_id = $1
-- GROUP BY demand_id;
