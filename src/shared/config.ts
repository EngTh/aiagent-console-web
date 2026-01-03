import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface Config {
  port: number
  vitePort: number
  logDir?: string // Directory to save terminal logs
  logEnabled?: boolean // Enable terminal logging
}

const DEFAULT_CONFIG: Config = {
  port: 17930,
  vitePort: 5173,
  logDir: '',
  logEnabled: false,
}

export function loadConfig(): Config {
  const configPath = join(process.cwd(), 'config.json')

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const userConfig = JSON.parse(content)
    return { ...DEFAULT_CONFIG, ...userConfig }
  } catch (error) {
    console.warn('Failed to load config.json, using defaults:', error)
    return DEFAULT_CONFIG
  }
}
