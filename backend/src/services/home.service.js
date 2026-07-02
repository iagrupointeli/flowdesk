import { query, getClient } from '#config/database.js'

const FOLDER_KEY = 'folder:estados'

// ── getHomeLayout ────────────────────────────────────────────────────────────
// Dois modos por usuário:
//   - "auto"   (nunca usou o Configurar): ordem = pasta primeiro, depois
//     favoritos, depois itens com * (default_starred), depois o resto —
//     cada grupo ordenado por default_position.
//   - "manual" (já arrastou pelo menos uma vez): ordem = position salva em
//     user_home_layout; itens novos (ainda sem position pra esse usuário)
//     entram no fim, na ordem de default_position.
// A troca "auto" → "manual" acontece na primeira chamada de saveLayout().
export async function getHomeLayout(userId) {
  const { rows: links } = await query(
    `SELECT key, label, url, category, state_abbr, default_starred, default_position
     FROM home_links WHERE archived_at IS NULL`
  )
  const { rows: layoutRows } = await query(
    `SELECT link_key, position, is_favorited FROM user_home_layout WHERE user_id = $1`,
    [userId]
  )
  const layout = new Map(layoutRows.map(r => [r.link_key, r]))
  const isManual = layoutRows.some(r => r.position !== null)

  const states = links
    .filter(l => l.category === 'state')
    .sort((a, b) => a.default_position - b.default_position)
    .map(l => ({ ...l, isFavorited: layout.get(l.key)?.is_favorited ?? false }))

  const topLevelBase = links.filter(l => l.category !== 'state')
  const favoritedStates = states.filter(s => s.isFavorited)

  const candidates = [
    { key: FOLDER_KEY, label: 'Estados', url: null, category: 'folder', isFolder: true },
    ...topLevelBase.map(l => ({ ...l, isFavorited: layout.get(l.key)?.is_favorited ?? false })),
    ...favoritedStates,
  ]

  let items
  if (isManual) {
    const withPos = candidates.map(c => ({
      ...c,
      _pos: layout.get(c.key)?.position ?? null,
    }))
    const placed   = withPos.filter(c => c._pos !== null).sort((a, b) => a._pos - b._pos)
    const unplaced = withPos.filter(c => c._pos === null).sort((a, b) => (a.default_position ?? 0) - (b.default_position ?? 0))
    items = [...placed, ...unplaced]
  } else {
    const rank = c => {
      if (c.isFolder) return 0
      if (c.isFavorited) return 1
      if (c.default_starred) return 2
      return 3
    }
    items = [...candidates].sort((a, b) => {
      const r = rank(a) - rank(b)
      return r !== 0 ? r : (a.default_position ?? 0) - (b.default_position ?? 0)
    })
  }

  return {
    items: items.map(({ _pos, ...item }) => item),
    states,
  }
}

// ── toggleFavorite ───────────────────────────────────────────────────────────
export async function toggleFavorite(userId, linkKey, isFavorited) {
  if (linkKey !== FOLDER_KEY) {
    const { rows } = await query(`SELECT 1 FROM home_links WHERE key = $1 AND archived_at IS NULL`, [linkKey])
    if (!rows.length) { const e = new Error('Link não encontrado.'); e.status = 404; throw e }
  }
  await query(
    `INSERT INTO user_home_layout (user_id, link_key, is_favorited)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, link_key) DO UPDATE SET is_favorited = $3`,
    [userId, linkKey, isFavorited]
  )
}

// ── saveLayout ────────────────────────────────────────────────────────────────
// orderedKeys: lista completa (pasta + itens visíveis) na ordem que o usuário
// arrastou no modo "Configurar". Sobrescreve position pra todos de uma vez —
// a partir daqui esse usuário entra em modo "manual" (ver getHomeLayout).
export async function saveLayout(userId, orderedKeys) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    for (let i = 0; i < orderedKeys.length; i++) {
      await client.query(
        `INSERT INTO user_home_layout (user_id, link_key, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, link_key) DO UPDATE SET position = $3`,
        [userId, orderedKeys[i], i]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
