-- ─── 043: asset governance — department ownership + import keys ───────────────
--
-- Pilar 1: Centralização do Inventário (Independência da Dataprisma)
--
-- Problema: assets são globais — qualquer marca pode reservar qualquer ponto.
-- Com 180k pontos da Dataprisma chegando, sem scoping por marca a governança
-- colapsa (BA Outdoor vê inventário da SP Outdoor e vice-versa).
--
-- Solução:
--   department_id  — proprietário explícito do ponto (NULL = ativo compartilhado/holding)
--   external_code  — chave de deduplicação para import idempotente (Dataprisma / Scoutdoor)
--   installation_date — âncora para ciclo de manutenção preditiva (Inteli Estruturas)
--   structure_type — classifica a estrutura física para regras de manutenção distintas

-- ── 1. Propriedade da marca ─────────────────────────────────────────────────
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS department_id UUID NULL
    REFERENCES departments(id) ON DELETE RESTRICT;

-- Busca "todos os pontos da minha marca" — query mais frequente pós-import
CREATE INDEX IF NOT EXISTS idx_assets_department
  ON assets (department_id)
  WHERE department_id IS NOT NULL AND archived_at IS NULL;

-- ── 2. Chave de import externo (Dataprisma / Scoutdoor) ─────────────────────
-- Permite UPSERT idempotente: ON CONFLICT (external_code) DO UPDATE ...
-- Unique apenas entre ativos não arquivados: mesma regra do code (migration 024)
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS external_code VARCHAR(100) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_external_code
  ON assets (external_code)
  WHERE external_code IS NOT NULL AND archived_at IS NULL;

-- ── 3. Data de instalação da estrutura (Inteli Estruturas) ──────────────────
-- Âncora do ciclo de manutenção: next_maintenance = installation_date + interval_days
-- da maintenance_rule correspondente (criada na migration 046).
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS installation_date DATE NULL;

-- ── 4. Tipo de estrutura física (para regras de manutenção distintas) ────────
-- mastro_metalico: maior frequência de vistoria (risco estrutural)
-- totem / parede / cobertura: intervalo maior
-- digital: foco em manutenção elétrica, não estrutural
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS structure_type VARCHAR(30) NULL
    CHECK (structure_type IS NULL OR structure_type IN (
      'mastro_metalico', 'totem', 'parede', 'cobertura', 'digital', 'outro'
    ));

-- ── 5. Índice geográfico composto ───────────────────────────────────────────
-- Busca de pontos por cidade+UF: "todos os painéis em Pindamonhangaba/SP"
-- Crítico após import de 180k pontos distribuídos por 27 estados.
CREATE INDEX IF NOT EXISTS idx_assets_city_state
  ON assets (city, state)
  WHERE archived_at IS NULL;

-- Busca brand-scoped por geografia: "pontos da BA Outdoor em Salvador"
CREATE INDEX IF NOT EXISTS idx_assets_dept_city
  ON assets (department_id, city)
  WHERE archived_at IS NULL AND department_id IS NOT NULL;

-- ── Nota de migração de dados ────────────────────────────────────────────────
-- department_id começa NULL para todos os ativos existentes.
-- O operador deve rodar uma segunda passagem após o import da Dataprisma para
-- atribuir os pontos às marcas conforme o mapeamento estado/cidade → marca:
--
--   UPDATE assets
--   SET department_id = '<uuid-da-ba-outdoor>'
--   WHERE state = 'BA' AND source = 'dataprisma' AND department_id IS NULL;
--
-- Pontos compartilhados entre marcas (ex: ponto na divisa de territórios)
-- ficam com department_id = NULL e pertencem à holding (visíveis para todos).
