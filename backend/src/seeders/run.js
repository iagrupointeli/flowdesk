import bcrypt from 'bcrypt'
import pool   from '#config/database.js'

async function run() {
  const client = await pool.connect()
  try {
    // Super admin padrão — troque a senha no primeiro deploy
    const hash = await bcrypt.hash('Admin@FlowDesk1', 12)

    await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Super Admin', 'admin@flowdesk.local', $1, 'super_admin')
      ON CONFLICT (email) DO NOTHING
    `, [hash])

    // Departamentos de exemplo
    await client.query(`
      INSERT INTO departments (name, description) VALUES
        ('Jurídico',    'Departamento Jurídico'),
        ('Financeiro',  'Departamento Financeiro'),
        ('Contratos',   'Gestão de Contratos')
      ON CONFLICT (name) DO NOTHING
    `)

    console.log('✅ Seed concluído.')
  } finally {
    client.release()
    await pool.end()
  }
}

run()
