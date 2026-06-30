import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pool from '#config/database.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_DIR   = join(__dirname, 'sql')

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
}

async function getApplied(client) {
  const { rows } = await client.query(
    'SELECT filename FROM schema_migrations ORDER BY filename'
  )
  return new Set(rows.map(r => r.filename))
}

async function run() {
  const client = await pool.connect()
  try {
    await ensureMigrationsTable(client)
    const applied = await getApplied(client)

    const files = (await readdir(SQL_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort()                          // ordem lexicográfica = ordem numérica pelo prefixo 00N

    let count = 0
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  ✓ ${file} (já aplicada)`)
        continue
      }

      const sql = await readFile(join(SQL_DIR, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        )
        await client.query('COMMIT')
        console.log(`  ✅ ${file}`)
        count++
      } catch (err) {
        await client.query('ROLLBACK')
        console.error(`  ❌ ${file}: ${err.message}`)
        process.exit(1)
      }
    }

    console.log(`\nMigrations concluídas: ${count} nova(s) aplicada(s).`)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
