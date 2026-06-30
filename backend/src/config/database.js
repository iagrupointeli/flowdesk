import pg           from 'pg'
import { logger }   from '#lib/logger.js'

const { Pool, types } = pg

// TZ=UTC é carregado via --env-file antes de qualquer import (Node 20+)
// Intercepta OID 1184 (TIMESTAMPTZ) e 1114 (TIMESTAMP):
// por padrão o pg converte para Date JS usando o fuso local da máquina —
// ao retornar a string ISO bruta, deixamos a aplicação controlar a conversão
// e a paginação keyset (entered_at) nunca quebra por diferença de fuso.
types.setTypeParser(1184, (val) => val)   // TIMESTAMPTZ → string ISO
types.setTypeParser(1114, (val) => val)   // TIMESTAMP   → string ISO

const pool = new Pool({
  host:     process.env.POSTGRES_HOST,
  port:     Number(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB,
  user:     process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 20,
  idleTimeoutMillis:      30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  // Erro inesperado no pool (ex: banco reiniciado, rede interrompida).
  // Loga como fatal porque compromete toda a capacidade de resposta da API.
  logger.fatal({ err }, 'Erro inesperado no pool do banco de dados')
})

// Threshold para slow query warning (ms).
// Ajustar via env em ambientes com hardware mais lento ou latência alta.
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS ?? 200)

export async function query(text, params) {
  const start = Date.now()
  try {
    const res      = await pool.query(text, params)
    const duration = Date.now() - start

    if (duration >= SLOW_QUERY_MS) {
      // Slow query: visível em todos os ambientes — produção incluída.
      // Trunca em 200 chars para evitar log de queries gigantes, mas
      // mais que os 80 chars anteriores para diagnóstico efetivo.
      logger.warn({ duration, query: text.slice(0, 200) }, 'Slow query detectada')
    } else if (process.env.NODE_ENV === 'development') {
      logger.debug({ duration, query: text.slice(0, 200) }, 'DB query')
    }

    return res
  } catch (err) {
    const duration = Date.now() - start
    // Loga com stack trace completo para diagnóstico de erros de schema,
    // constraint violations e conexão perdida.
    logger.error({ err, duration, query: text.slice(0, 200) }, 'DB query falhou')
    throw err
  }
}

export async function getClient() {
  return pool.connect()
}

export default pool
