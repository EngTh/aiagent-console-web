import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'fs'

interface Config {
  port?: number
  vitePort?: number
}

function loadConfig(): Config {
  const configPath = './config.json'
  if (!existsSync(configPath)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    return {}
  }
}

const config = loadConfig()
const SERVER_PORT = config.port || 3000
const VITE_PORT = config.vitePort || 5173

export default defineConfig({
  plugins: [react()],
  server: {
    port: VITE_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
  },
})
