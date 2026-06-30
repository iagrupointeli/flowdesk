import axios from 'axios'

/**
 * Instância Axios exportada pura.
 *
 * Regras inegociáveis:
 *   - baseURL '/api'  → Vite proxy redireciona para http://localhost:3000/api
 *                       (nunca URL absoluta de localhost — quebraria CORS em dev)
 *   - withCredentials → envia o cookie httpOnly do refreshToken automaticamente
 *   - ZERO imports de stores Zustand aqui (evita dependência circular ESM)
 *
 * Os interceptores de request/response são injetados externamente via
 * setupInterceptors.js, chamado em App.jsx antes de qualquer render.
 */
const api = axios.create({
  baseURL:         '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

export default api
