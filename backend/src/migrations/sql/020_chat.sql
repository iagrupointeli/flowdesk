-- ─── 020: chat — canais, membros, mensagens e anexos ────────────────────────

CREATE TABLE IF NOT EXISTS chat_channels (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  type          VARCHAR(20)  NOT NULL
                CHECK (type IN ('dm','group','broadcast')),
  name          VARCHAR(255) NULL,
  department_id UUID         NULL REFERENCES departments(id) ON DELETE SET NULL,
  created_by    UUID         NOT NULL REFERENCES users(id),
  description   TEXT         NULL,
  archived_at   TIMESTAMPTZ  NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_members (
  channel_id   UUID        NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL DEFAULT 'member'
               CHECK (role IN ('owner','admin','member','readonly')),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ NULL,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID        NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_id  UUID        NOT NULL REFERENCES users(id),
  body       TEXT        NULL,
  reply_to   UUID        NULL REFERENCES chat_messages(id),
  edited_at  TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_channel
  ON chat_messages (channel_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_attachments (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID         NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  file_path  VARCHAR(255) NOT NULL,
  file_name  VARCHAR(500) NOT NULL,
  file_size  INTEGER      NOT NULL,
  mime_type  VARCHAR(127) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
