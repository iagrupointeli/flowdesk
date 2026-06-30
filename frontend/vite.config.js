import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5174,
    // O proxy faz o navegador ver apenas a origem 5174 — CORS e cookies httpOnly
    // fluem sem restrição porque front e back parecem estar na mesma origem.
    proxy: {
      '/api': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target:  'http://localhost:3001',
        ws:      true,
      },
    },
  },
})
