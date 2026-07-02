-- ─── 050: home hub — botões de acesso da tela inicial ──────────────────────
--
-- Track F1/R1 (2026-07-02): painel na tela inicial com todos os acessos do
-- colaborador — internos (Projetos, Mensagens) e externos (sites do Grupo
-- Inteli, incluindo os ~40 sites regionais de OOH por estado). Cada usuário
-- pode favoritar itens (inclusive estados de dentro da pasta) e reordenar
-- tudo livremente, tipo tela inicial de celular.
--
-- home_links = catálogo global (hoje só seedado por migration, sem CRUD).
-- user_home_layout = personalização por usuário: posição manual (draggable,
-- só existe depois que o usuário usa o "Configurar" pela 1a vez) e favorito
-- (bool simples, não precisa de posição pra favoritar).

CREATE TABLE IF NOT EXISTS home_links (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  key              TEXT         UNIQUE NOT NULL,
  label            TEXT         NOT NULL,
  url              TEXT         NOT NULL,
  category         TEXT         NOT NULL DEFAULT 'site'
                     CHECK (category IN ('internal', 'site', 'state')),
  state_abbr       TEXT,
  default_starred  BOOLEAN      NOT NULL DEFAULT false,
  default_position INTEGER      NOT NULL DEFAULT 0,
  archived_at      TIMESTAMPTZ
);

-- link_key referencia home_links.key OU o literal 'folder:estados' (a pasta
-- em si é um item posicionável, não tem linha própria em home_links).
CREATE TABLE IF NOT EXISTS user_home_layout (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  link_key     TEXT         NOT NULL,
  position     INTEGER,
  is_favorited BOOLEAN      NOT NULL DEFAULT false,
  UNIQUE(user_id, link_key)
);

CREATE INDEX IF NOT EXISTS idx_user_home_layout_user ON user_home_layout(user_id);

-- ── Seed: botões internos ───────────────────────────────────────────────────
INSERT INTO home_links (key, label, url, category, default_position) VALUES
  ('projetos',  'Projetos',  '/areas', 'internal', 0),
  ('mensagens', 'Mensagens', '/chat',  'internal', 1)
ON CONFLICT (key) DO NOTHING;

-- ── Seed: sites do Grupo Inteli (não-estado) ────────────────────────────────
-- default_starred = itens marcados com * pelo Ruan, ficam primeiro por padrão.
INSERT INTO home_links (key, label, url, category, default_starred, default_position) VALUES
  ('webmail',           'Webmail',                 'https://server3.scoutdoor.com.br:2096/',   'site', false, 10),
  ('agenda',             'Agenda de Salas',         'https://agenda.grupointeli.com/',           'site', false, 11),
  ('site-principal',     'Site Principal',          'https://grupointeli.com/',                  'site', false, 12),
  ('portal-outdoor',     'Portal Outdoor',          'https://www.portaloutdoor.com.br/',         'site', false, 20),
  ('billboard',          'Inteli Billboard',        'https://www.intelioutdoor.com/',            'site', false, 21),
  ('publicidad-esp',     'Publicidad Espectacular', 'https://www.publicidadespectacular.mx/',    'site', false, 22),
  ('inteli-py',          'Inteli PY',               'https://inteli.com.py/',                    'site', false, 23),
  ('inteli-ro',          'Inteli RO',               'https://www.intelioutdoor.ro/',             'site', false, 24),
  ('estruturas',         'Inteli Estruturas',       'https://www.inteliestruturas.com.br/',      'site', true,   1),
  ('paineis',            'Painéis (Direct Mídia)',  'https://directmidia.com.br/',                'site', false, 25),
  ('mls-leds',           'MLS LEDs',                'https://lp.mlsled.com.br/',                  'site', true,   2),
  ('higrow',             'Higrow',                  'https://higrow.com.br/',                     'site', true,   3),
  ('carro-de-som',       'Carro de Som',            'https://www.propagandacarrodesom.com.br/',   'site', false, 26),
  ('hubix',              'Hubix',                   'https://www.hubix.com.br/',                  'site', true,   4),
  ('propaganda-indoor',  'Propaganda Indoor',       'https://www.propagandaindoor.com.br/',       'site', false, 27),
  ('inteli-academy',     'Inteli Academy',          'https://ia.grupointeli.com/courses',         'site', true,   5)
ON CONFLICT (key) DO NOTHING;

-- ── Seed: sites regionais por estado (dentro da pasta "Estados") ───────────
-- Todos os 27 estados+DF cobertos em 2026-07-02: 16 individuais (padrão
-- https://www.{UF}outdoor.com.br/, exceto RS = rgoutdoor.com.br) + 3 sites
-- consolidados multi-estado (Norte, DF/GO/MS, parte do Nordeste) — todos
-- verificados ao vivo (200) e o conteúdo das páginas confere com os estados
-- atribuídos, não só o nome do domínio.
INSERT INTO home_links (key, label, url, category, state_abbr, default_position) VALUES
  ('estado-al', 'Alagoas',             'https://www.aloutdoor.com.br/', 'state', 'AL', 0),
  ('estado-ba', 'Bahia',               'https://www.baoutdoor.com.br/', 'state', 'BA', 1),
  ('estado-ce', 'Ceará',               'https://www.ceoutdoor.com.br/', 'state', 'CE', 2),
  ('estado-es', 'Espírito Santo',      'https://www.esoutdoor.com.br/', 'state', 'ES', 3),
  ('estado-ma', 'Maranhão',            'https://www.maoutdoor.com.br/', 'state', 'MA', 4),
  ('estado-mt', 'Mato Grosso',         'https://www.mtoutdoor.com.br/', 'state', 'MT', 5),
  ('estado-mg', 'Minas Gerais',        'https://www.mgoutdoor.com.br/', 'state', 'MG', 6),
  ('estado-pa', 'Pará',                'https://www.paoutdoor.com.br/', 'state', 'PA', 7),
  ('estado-pr', 'Paraná',              'https://www.proutdoor.com.br/', 'state', 'PR', 8),
  ('estado-pe', 'Pernambuco',          'https://www.peoutdoor.com.br/', 'state', 'PE', 9),
  ('estado-rj', 'Rio de Janeiro',      'https://www.rjoutdoor.com.br/', 'state', 'RJ', 10),
  ('estado-rn', 'Rio Grande do Norte', 'https://www.rnoutdoor.com.br/', 'state', 'RN', 11),
  ('estado-rs', 'Rio Grande do Sul',   'https://www.rgoutdoor.com.br/', 'state', 'RS', 12),
  ('estado-sc', 'Santa Catarina',      'https://www.scoutdoor.com.br/', 'state', 'SC', 13),
  ('estado-sp', 'São Paulo',           'https://www.spoutdoor.com.br/', 'state', 'SP', 14),
  ('estado-to', 'Tocantins',           'https://www.tooutdoor.com.br/', 'state', 'TO', 15),
  -- Região Norte consolidada (AC/AP/AM/RO/RR não têm site próprio — um só
  -- cobre os 5, confirmado pelo Ruan em 2026-07-02).
  ('estado-norte', 'Norte (AC · AP · AM · RO · RR)', 'https://www.norteoutdoor.com.br/', 'state', NULL, 16),
  -- DF/Goiás/MS consolidados — página menciona Brasília, Goiás e Mato
  -- Grosso do Sul explicitamente.
  ('estado-df-go-ms', 'DF · Goiás · MS', 'https://www.dfgoias.com.br/', 'state', NULL, 17),
  -- Nordeste consolidado — só os 3 estados que ainda não tinham site próprio
  -- (CE/PE/RN/AL/BA/MA já têm o deles). Página menciona Paraíba, Piauí e
  -- Sergipe (Teresina/Aracaju) explicitamente.
  ('estado-nordeste', 'Nordeste (PB · PI · SE)', 'https://www.nordesteoutdoor.com.br/', 'state', NULL, 18)
ON CONFLICT (key) DO NOTHING;
