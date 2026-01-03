import * as fs from 'fs'
import * as path from 'path'

export interface TerminalSettings {
  fontFamily: string
  fontSize: number
}

export interface PersistedAgent {
  id: string
  name: string
  sourceRepo: string
  workDir: string
  branch: string
  createdAt: number
  outputBuffer?: string // Last terminal output for recovery
}

export interface LocalConfig {
  recentRepos: string[] // Recently used source repositories
  terminal: TerminalSettings
  agents: PersistedAgent[] // Persisted agents for recovery
}

const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  fontFamily: '"Maple Mono NF CN", monospace',
  fontSize: 14,
}

const DEFAULT_LOCAL_CONFIG: LocalConfig = {
  recentRepos: [],
  terminal: { ...DEFAULT_TERMINAL_SETTINGS },
  agents: [],
}

const MAX_RECENT_REPOS = 10

const LOCAL_CONFIG_FILE = '.aiagent-local.json'

function getConfigPath(): string {
  return path.join(process.cwd(), LOCAL_CONFIG_FILE)
}

export function loadLocalConfig(): LocalConfig {
  const configPath = getConfigPath()

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_LOCAL_CONFIG, terminal: { ...DEFAULT_TERMINAL_SETTINGS } }
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content)
    return {
      ...DEFAULT_LOCAL_CONFIG,
      ...config,
      terminal: { ...DEFAULT_TERMINAL_SETTINGS, ...config.terminal },
    }
  } catch (error) {
    console.warn('Failed to load local config:', error)
    return { ...DEFAULT_LOCAL_CONFIG, terminal: { ...DEFAULT_TERMINAL_SETTINGS } }
  }
}

export function saveLocalConfig(config: LocalConfig): void {
  const configPath = getConfigPath()

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('Failed to save local config:', error)
  }
}

export function addRecentRepo(repoPath: string): void {
  const config = loadLocalConfig()

  // Remove if already exists (we'll add to front)
  config.recentRepos = config.recentRepos.filter((r) => r !== repoPath)

  // Add to front
  config.recentRepos.unshift(repoPath)

  // Keep only MAX_RECENT_REPOS
  config.recentRepos = config.recentRepos.slice(0, MAX_RECENT_REPOS)

  saveLocalConfig(config)
}

export function getRecentRepos(): string[] {
  return loadLocalConfig().recentRepos
}

export function getTerminalSettings(): TerminalSettings {
  return loadLocalConfig().terminal
}

export function updateTerminalSettings(settings: Partial<TerminalSettings>): TerminalSettings {
  const config = loadLocalConfig()
  config.terminal = { ...config.terminal, ...settings }
  saveLocalConfig(config)
  return config.terminal
}

// Agent persistence functions
export function getPersistedAgents(): PersistedAgent[] {
  return loadLocalConfig().agents || []
}

export function savePersistedAgent(agent: PersistedAgent): void {
  const config = loadLocalConfig()
  const existingIndex = config.agents.findIndex((a) => a.id === agent.id)
  if (existingIndex >= 0) {
    config.agents[existingIndex] = agent
  } else {
    config.agents.push(agent)
  }
  saveLocalConfig(config)
}

export function removePersistedAgent(agentId: string): void {
  const config = loadLocalConfig()
  config.agents = config.agents.filter((a) => a.id !== agentId)
  saveLocalConfig(config)
}

export function updatePersistedAgentBuffer(agentId: string, outputBuffer: string): void {
  const config = loadLocalConfig()
  const agent = config.agents.find((a) => a.id === agentId)
  if (agent) {
    // Only save last 50KB of output buffer
    agent.outputBuffer = outputBuffer.slice(-50000)
    saveLocalConfig(config)
  }
}
