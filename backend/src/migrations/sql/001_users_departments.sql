-- ─── 001: users, departments, user_departments ───────────────────────────────

CREATE TABLE users (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255) NOT NULL,
  email            VARCHAR(255) NOT NULL UNIQUE,
  password_hash    VARCHAR(255) NOT NULL,
  -- VARCHAR + CHECK em vez de ENUM nativo (reversível sem ALTER TYPE)
  role             VARCHAR(20)  NOT NULL DEFAULT 'user'
                   CHECK (role IN ('super_admin', 'dept_admin', 'user')),
  notify_email     BOOLEAN      NOT NULL DEFAULT true,
  notify_platform  BOOLEAN      NOT NULL DEFAULT true,
  deactivated_at   TIMESTAMPTZ  NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE departments (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL UNIQUE,
  description TEXT         NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- N:M entre users e departments
-- PK composta (user_id, department_id) já cobre o índice de user_id
CREATE TABLE user_departments (
  user_id       UUID        NOT NULL REFERENCES users(id)       ON DELETE RESTRICT,
  department_id UUID        NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  is_primary    BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, department_id)
);

-- FK department_id não está coberta pela PK → índice explícito
CREATE INDEX idx_user_departments_dept ON user_departments (department_id);
