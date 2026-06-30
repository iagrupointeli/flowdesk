-- ─── 047: rooms + room_bookings — Módulo de Recursos de Matriz / Agenda ───────
--
-- Pilar: Centralização Inteligente — todas as salas (LED, Studio, Tática) gerenciadas
-- em um único módulo com anti-double-booking, isolamento por marca (department_id)
-- e sincronização bidirecional com Google Calendar.
--
-- Arquitetura de sync:
--   InteliONE → Google Calendar  : push via GoogleCalendarService.createEvent / updateEvent
--   Google Calendar → InteliONE  : pull incremental via syncToken (pullChanges)
--   external_event_id            : chave de portabilidade entre Fase 1 (site externo) e Fase 2
--
-- btree_gist já existe (migration 027). CREATE EXTENSION IF NOT EXISTS garante idempotência.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 1. Salas ─────────────────────────────────────────────────────────────────
--
-- department_id = NULL → sala da matriz/holding (visível para todas as marcas)
-- department_id = <uuid> → sala regional (isolamento multi-tenant)
--
-- google_calendar_id: cada sala pode ter seu próprio calendário Google.
-- Se NULL, usa o calendário padrão (GOOGLE_CALENDAR_ID no .env).
CREATE TABLE IF NOT EXISTS rooms (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(100) NOT NULL,
  department_id       UUID         NULL REFERENCES departments(id) ON DELETE SET NULL,
  capacity            INTEGER      NULL CHECK (capacity IS NULL OR capacity > 0),

  -- Equipamentos disponíveis: ["projetor","videoconferência","TV LED","ar-condicionado"]
  resources           JSONB        NOT NULL DEFAULT '[]'::jsonb,

  location            VARCHAR(200) NULL,   -- ex: "Bloco B, 2º andar"
  color               VARCHAR(7)   NOT NULL DEFAULT '#6366f1',  -- hex, exibido no calendário

  -- Google Calendar: cada sala pode mapear para um calendário distinto
  google_calendar_id  VARCHAR(300) NULL,

  is_active           BOOLEAN      NOT NULL DEFAULT true,
  created_by          UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  archived_at         TIMESTAMPTZ  NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_department
  ON rooms (department_id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_active
  ON rooms (is_active)
  WHERE archived_at IS NULL AND is_active = true;

-- ── 2. Reservas ──────────────────────────────────────────────────────────────
--
-- Anti-double-booking via EXCLUDE (mesmo padrão de campaigns, migration 027):
--   Dois reservas na mesma sala com status='confirmed' não podem ter períodos sobrepostos.
--   tstzrange '[)' = intervalo fechado no início, aberto no fim (sem conflito de limite).
--
-- Campos de sync Google Calendar:
--   external_event_id    — ID do evento no Google Calendar (chave de portabilidade)
--   external_calendar_id — qual calendário Google recebeu este evento
--   last_synced_at       — timestamp do último push/pull bem-sucedido
--   sync_status          — estado do pipeline de sync
--   sync_error           — mensagem de erro do último sync falhado (para retry)
--
-- LGPD (migration 044): anonymized_at segue o mesmo padrão de demands/users.
CREATE TABLE IF NOT EXISTS room_bookings (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id              UUID         NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id              UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  department_id        UUID         NULL REFERENCES departments(id) ON DELETE SET NULL,

  title                VARCHAR(300) NOT NULL,
  description          TEXT         NULL,

  -- Participantes: [{"email":"fulano@grupointeli.com","name":"Fulano"}]
  attendees            JSONB        NOT NULL DEFAULT '[]'::jsonb,

  starts_at            TIMESTAMPTZ  NOT NULL,
  ends_at              TIMESTAMPTZ  NOT NULL,
  CHECK (ends_at > starts_at),

  status               VARCHAR(20)  NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'cancelled')),

  -- ── Google Calendar sync ─────────────────────────────────────────────────
  external_event_id    VARCHAR(300) NULL,   -- ID do evento no Google Calendar
  external_calendar_id VARCHAR(300) NULL,   -- Calendar ID que recebeu o evento
  last_synced_at       TIMESTAMPTZ  NULL,
  sync_status          VARCHAR(20)  NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'failed', 'not_applicable')),
  sync_error           TEXT         NULL,   -- última mensagem de erro (para diagnóstico/retry)

  -- ── LGPD (migration 044) ─────────────────────────────────────────────────
  anonymized_at        TIMESTAMPTZ  NULL,

  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Anti-double-booking: mesma sala não pode ter reservas 'confirmed' sobrepostas
  -- Reservas canceladas ou anonimizadas saem da proteção automaticamente
  CONSTRAINT no_room_double_booking EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status = 'confirmed' AND anonymized_at IS NULL)
);

-- Timeline da sala: query mais frequente no calendário mensal
CREATE INDEX IF NOT EXISTS idx_room_bookings_room_period
  ON room_bookings (room_id, starts_at, ends_at)
  WHERE status = 'confirmed' AND anonymized_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_room_bookings_user
  ON room_bookings (user_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_bookings_dept
  ON room_bookings (department_id, starts_at)
  WHERE department_id IS NOT NULL;

-- Fila de sync: job busca reservas pendentes ou com falha
CREATE INDEX IF NOT EXISTS idx_room_bookings_sync_queue
  ON room_bookings (created_at)
  WHERE sync_status IN ('pending', 'failed') AND status = 'confirmed';

-- Lookup por ID externo: recebendo webhook do Google Calendar, encontra o booking local
CREATE INDEX IF NOT EXISTS idx_room_bookings_external_event
  ON room_bookings (external_event_id)
  WHERE external_event_id IS NOT NULL;

-- LGPD: job de anonimização encontra reservas de usuários desativados
CREATE INDEX IF NOT EXISTS idx_room_bookings_lgpd
  ON room_bookings (user_id)
  WHERE anonymized_at IS NULL;

-- ── 3. Seed: salas iniciais (LED, Studio, Tática) ────────────────────────────
-- Criadas como salas da matriz (department_id = NULL).
-- O google_calendar_id deve ser preenchido via admin após configurar o OAuth.
DO $$
DECLARE
  admin_id UUID;
BEGIN
  SELECT id INTO admin_id FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1;
  IF admin_id IS NULL THEN RETURN; END IF;

  INSERT INTO rooms (name, capacity, resources, color, is_active, created_by) VALUES
    (
      'LED', 20,
      '["videoconferência","TV LED 85\"","ar-condicionado","sistema de som","HDMI","câmera PTZ"]'::jsonb,
      '#3b82f6', true, admin_id
    ),
    (
      'Studio', 10,
      '["câmera profissional","iluminação de 3 pontos","fundo infinito","telepromter","microfone condensador","mixer de áudio"]'::jsonb,
      '#8b5cf6', true, admin_id
    ),
    (
      'Tática', 8,
      '["projetor 4K","quadro branco","videoconferência","TV 65\"","HDMI","flip chart"]'::jsonb,
      '#10b981', true, admin_id
    )
  ON CONFLICT DO NOTHING;
END $$;

-- ── Nota: campos a preencher após configurar Google Calendar ─────────────────
-- UPDATE rooms SET google_calendar_id = '<id-do-calendário>' WHERE name = 'LED';
-- UPDATE rooms SET google_calendar_id = '<id-do-calendário>' WHERE name = 'Studio';
-- UPDATE rooms SET google_calendar_id = '<id-do-calendário>' WHERE name = 'Tática';
--
-- O sync_token por calendário é armazenado na tabela rooms.google_calendar_id
-- e gerenciado pelo GoogleCalendarService.pullChanges().
-- Para múltiplos calendários com sync_token individual, considere a migration 048
-- adicionando uma tabela calendar_sync_state (calendar_id, sync_token, last_sync_at).
