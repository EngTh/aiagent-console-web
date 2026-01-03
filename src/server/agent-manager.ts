import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import type { Agent, TabInfo, OutputChunk, BufferStats } from '../shared/types.js'
import type { Config } from '../shared/config.js'
import { GitWorktreeManager } from './git-worktree.js'
import {
  getPersistedAgents,
  savePersistedAgent,
  removePersistedAgent,
  updatePersistedAgentBuffer,
  type PersistedAgent,
} from './local-config.js'

const MAX_CHUNKS = 1000 // Max number of chunks to keep per tab
const MAX_CHUNK_SIZE = 4096 // Merge small outputs into chunks up to this size
const DEFAULT_TAB_NAME = 'Terminal'

interface TabProcess {
  pty: pty.IPty | null
  info: TabInfo
  outputChunks: OutputChunk[]
  currentSeq: number
  pendingData: string // Buffer for merging small outputs
  logStream: fs.WriteStream | null
}

interface AgentProcess {
  agent: Agent
  tabs: Map<string, TabProcess>
}

export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentProcess> = new Map()
  private worktreeManager: GitWorktreeManager
  private controlOwners: Map<string, string> = new Map() // agentId:tabId -> clientId
  private config: Config
  private flushTimers: Map<string, NodeJS.Timeout> = new Map()

  constructor(config: Config) {
    super()
    this.config = config
    const baseWorkDir = path.join(os.homedir(), '.aiagent-console', 'worktrees')
    this.worktreeManager = new GitWorktreeManager(baseWorkDir)

    // Load persisted agents on startup
    this.loadPersistedAgents()
  }

  private loadPersistedAgents(): void {
    const persisted = getPersistedAgents()
    console.log(`Loading ${persisted.length} persisted agent(s)...`)

    for (const pa of persisted) {
      // Check if worktree still exists
      if (!fs.existsSync(pa.workDir)) {
        console.log(`Worktree for agent ${pa.name} no longer exists, removing...`)
        removePersistedAgent(pa.id)
        continue
      }

      const agent: Agent = {
        id: pa.id,
        name: pa.name,
        sourceRepo: pa.sourceRepo,
        workDir: pa.workDir,
        branch: pa.branch,
        status: 'idle',
        createdAt: pa.createdAt,
        tabs: [],
      }

      // Create default tab with restored buffer as a single chunk
      const defaultTabId = uuidv4()
      const tabs = new Map<string, TabProcess>()
      const initialChunks: OutputChunk[] = []

      if (pa.outputBuffer) {
        initialChunks.push({
          seq: 0,
          data: pa.outputBuffer,
          timestamp: Date.now(),
        })
      }

      tabs.set(defaultTabId, {
        pty: null,
        info: { id: defaultTabId, name: DEFAULT_TAB_NAME, status: 'idle' },
        outputChunks: initialChunks,
        currentSeq: initialChunks.length,
        pendingData: '',
        logStream: null,
      })

      agent.tabs = [{ id: defaultTabId, name: DEFAULT_TAB_NAME, status: 'idle' }]

      this.agents.set(pa.id, { agent, tabs })

      console.log(`Loaded agent: ${pa.name} (${pa.id})`)
    }
  }

  private getControlKey(agentId: string, tabId: string): string {
    return `${agentId}:${tabId}`
  }

  // Control management
  getControlOwner(agentId: string, tabId: string): string | null {
    return this.controlOwners.get(this.getControlKey(agentId, tabId)) || null
  }

  hasControl(agentId: string, tabId: string, clientId: string): boolean {
    return this.controlOwners.get(this.getControlKey(agentId, tabId)) === clientId
  }

  tryGainControl(agentId: string, tabId: string, clientId: string): boolean {
    const key = this.getControlKey(agentId, tabId)
    this.controlOwners.set(key, clientId)
    this.emit('control-changed', agentId, tabId, clientId)
    return true
  }

  releaseControl(agentId: string, tabId: string, clientId: string): void {
    const key = this.getControlKey(agentId, tabId)
    if (this.controlOwners.get(key) === clientId) {
      this.controlOwners.delete(key)
      this.emit('control-changed', agentId, tabId, null)
    }
  }

  // Get output chunks from a specific sequence number
  getOutputChunks(agentId: string, tabId: string, fromSeq: number = 0): { chunks: OutputChunk[]; lastSeq: number } {
    const agentProcess = this.agents.get(agentId)
    const tabProcess = agentProcess?.tabs.get(tabId)
    if (!tabProcess) {
      return { chunks: [], lastSeq: -1 }
    }

    const chunks = tabProcess.outputChunks.filter(c => c.seq >= fromSeq)
    return {
      chunks,
      lastSeq: tabProcess.currentSeq - 1,
    }
  }

  // Get the last sequence number for a tab
  getLastSeq(agentId: string, tabId: string): number {
    const agentProcess = this.agents.get(agentId)
    const tabProcess = agentProcess?.tabs.get(tabId)
    return tabProcess ? tabProcess.currentSeq - 1 : -1
  }

  // Get buffer statistics for a tab
  getBufferStats(agentId: string, tabId: string): BufferStats {
    const agentProcess = this.agents.get(agentId)
    const tabProcess = agentProcess?.tabs.get(tabId)
    if (!tabProcess || tabProcess.outputChunks.length === 0) {
      return { chunkCount: 0, totalSize: 0, firstSeq: -1, lastSeq: -1 }
    }

    const totalSize = tabProcess.outputChunks.reduce((sum, c) => sum + c.data.length, 0)
    return {
      chunkCount: tabProcess.outputChunks.length,
      totalSize,
      firstSeq: tabProcess.outputChunks[0].seq,
      lastSeq: tabProcess.currentSeq - 1,
    }
  }

  // Get full output as string (for persistence)
  getOutputHistory(agentId: string, tabId: string): string {
    const agentProcess = this.agents.get(agentId)
    const tabProcess = agentProcess?.tabs.get(tabId)
    if (!tabProcess) return ''
    return tabProcess.outputChunks.map(c => c.data).join('')
  }

  // Add output chunk with sequence number
  private addOutputChunk(agentId: string, tabId: string, data: string): OutputChunk {
    const agentProcess = this.agents.get(agentId)
    const tabProcess = agentProcess?.tabs.get(tabId)
    if (!tabProcess) {
      throw new Error(`Tab not found: ${tabId}`)
    }

    const chunk: OutputChunk = {
      seq: tabProcess.currentSeq++,
      data,
      timestamp: Date.now(),
    }

    tabProcess.outputChunks.push(chunk)

    // Debug: log chunk creation
    const totalSize = tabProcess.outputChunks.reduce((sum, c) => sum + c.data.length, 0)
    console.log(`[DEBUG] Chunk added: seq=${chunk.seq}, size=${data.length}B, total=${totalSize}B, data preview: ${JSON.stringify(data.slice(0, 50))}`)

    // Trim old chunks if we have too many
    if (tabProcess.outputChunks.length > MAX_CHUNKS) {
      tabProcess.outputChunks = tabProcess.outputChunks.slice(-MAX_CHUNKS)
    }

    return chunk
  }

  // Flush pending data to a chunk
  private flushPendingData(agentId: string, tabId: string): void {
    const key = this.getControlKey(agentId, tabId)
    const timer = this.flushTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.flushTimers.delete(key)
    }

    const agentProcess = this.agents.get(agentId)
    const tabProcess = agentProcess?.tabs.get(tabId)
    if (!tabProcess || !tabProcess.pendingData) return

    const chunk = this.addOutputChunk(agentId, tabId, tabProcess.pendingData)
    tabProcess.pendingData = ''

    // Emit the chunk with seq number
    this.emit('pty-data', agentId, tabId, chunk.data, chunk.seq)
  }

  // Handle incoming PTY data - buffer small outputs
  private handlePtyData(agentId: string, tabId: string, data: string): void {
    const agentProcess = this.agents.get(agentId)
    const tabProcess = agentProcess?.tabs.get(tabId)
    if (!tabProcess) return

    // Write to log
    if (tabProcess.logStream) {
      tabProcess.logStream.write(data)
    }

    tabProcess.pendingData += data

    // If pending data is large enough, flush immediately
    if (tabProcess.pendingData.length >= MAX_CHUNK_SIZE) {
      this.flushPendingData(agentId, tabId)
    } else {
      // Otherwise, set a timer to flush soon (debounce small outputs)
      const key = this.getControlKey(agentId, tabId)
      if (!this.flushTimers.has(key)) {
        this.flushTimers.set(key, setTimeout(() => {
          this.flushPendingData(agentId, tabId)
        }, 50)) // 50ms debounce
      }
    }
  }

  // Create log file for a tab
  private createLogStream(agent: Agent, tabName: string): fs.WriteStream | null {
    if (!this.config.logEnabled || !this.config.logDir) {
      return null
    }

    try {
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

      const logDir = path.join(this.config.logDir, `${year}-${month}`, day)
      fs.mkdirSync(logDir, { recursive: true })

      const sanitizedPath = agent.workDir.replace(/[/\\:]/g, '_').replace(/^_+/, '')
      const logFileName = `${time}_${agent.name}_${tabName}_${sanitizedPath}.log`
      const logPath = path.join(logDir, logFileName)

      const stream = fs.createWriteStream(logPath, { flags: 'a' })
      console.log(`Logging to: ${logPath}`)
      return stream
    } catch (error) {
      console.error('Failed to create log file:', error)
      return null
    }
  }

  async createAgent(name: string, sourceRepo: string): Promise<Agent> {
    const id = uuidv4()
    const branchName = `agent/${id.slice(0, 8)}`

    const { worktreePath, branch } = await this.worktreeManager.createWorktree(
      sourceRepo,
      id,
      branchName
    )

    // Create default tab
    const defaultTabId = uuidv4()
    const defaultTab: TabInfo = { id: defaultTabId, name: DEFAULT_TAB_NAME, status: 'idle' }

    const agent: Agent = {
      id,
      name,
      sourceRepo,
      workDir: worktreePath,
      branch,
      status: 'idle',
      createdAt: Date.now(),
      tabs: [defaultTab],
    }

    const tabs = new Map<string, TabProcess>()
    tabs.set(defaultTabId, {
      pty: null,
      info: defaultTab,
      outputChunks: [],
      currentSeq: 0,
      pendingData: '',
      logStream: null,
    })

    this.agents.set(id, { agent, tabs })

    // Persist agent for recovery
    savePersistedAgent({
      id: agent.id,
      name: agent.name,
      sourceRepo: agent.sourceRepo,
      workDir: agent.workDir,
      branch: agent.branch,
      createdAt: agent.createdAt,
    })

    this.emit('agents-updated', this.getAgents())

    return agent
  }

  createTab(agentId: string, name?: string): TabInfo {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const tabId = uuidv4()
    const tabName = name || `Terminal ${agentProcess.tabs.size + 1}`
    const tabInfo: TabInfo = { id: tabId, name: tabName, status: 'idle' }

    agentProcess.tabs.set(tabId, {
      pty: null,
      info: tabInfo,
      outputChunks: [],
      currentSeq: 0,
      pendingData: '',
      logStream: null,
    })

    // Update agent tabs list
    agentProcess.agent.tabs = Array.from(agentProcess.tabs.values()).map(t => t.info)

    this.emit('tab-created', agentId, tabInfo)
    this.emit('agents-updated', this.getAgents())

    return tabInfo
  }

  closeTab(agentId: string, tabId: string): void {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const tabProcess = agentProcess.tabs.get(tabId)
    if (!tabProcess) {
      throw new Error(`Tab not found: ${tabId}`)
    }

    // Clear flush timer
    const key = this.getControlKey(agentId, tabId)
    const timer = this.flushTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.flushTimers.delete(key)
    }

    // Kill PTY if running
    if (tabProcess.pty) {
      tabProcess.pty.kill()
    }

    // Close log stream
    if (tabProcess.logStream) {
      tabProcess.logStream.end()
    }

    // Remove control
    this.controlOwners.delete(key)

    agentProcess.tabs.delete(tabId)

    // Update agent tabs list
    agentProcess.agent.tabs = Array.from(agentProcess.tabs.values()).map(t => t.info)

    this.emit('tab-closed', agentId, tabId)
    this.emit('agents-updated', this.getAgents())
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // Close all tabs
    for (const [tabId, tabProcess] of agentProcess.tabs) {
      // Clear flush timer
      const key = this.getControlKey(agentId, tabId)
      const timer = this.flushTimers.get(key)
      if (timer) {
        clearTimeout(timer)
        this.flushTimers.delete(key)
      }

      if (tabProcess.logStream) {
        tabProcess.logStream.end()
      }
      if (tabProcess.pty) {
        tabProcess.pty.kill()
      }
      this.controlOwners.delete(key)
    }

    // Remove worktree
    await this.worktreeManager.removeWorktree(
      agentProcess.agent.sourceRepo,
      agentId
    )

    this.agents.delete(agentId)

    // Remove from persistence
    removePersistedAgent(agentId)

    this.emit('agents-updated', this.getAgents())
  }

  getAgent(agentId: string): Agent | undefined {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) return undefined
    // Ensure tabs are up to date
    agentProcess.agent.tabs = Array.from(agentProcess.tabs.values()).map(t => t.info)
    return agentProcess.agent
  }

  getAgents(): Agent[] {
    return Array.from(this.agents.values()).map(p => {
      p.agent.tabs = Array.from(p.tabs.values()).map(t => t.info)
      return p.agent
    })
  }

  getTab(agentId: string, tabId: string): TabInfo | undefined {
    return this.agents.get(agentId)?.tabs.get(tabId)?.info
  }

  startTab(agentId: string, tabId: string, cols: number = 80, rows: number = 24): pty.IPty {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const tabProcess = agentProcess.tabs.get(tabId)
    if (!tabProcess) {
      throw new Error(`Tab not found: ${tabId}`)
    }

    if (tabProcess.pty) {
      return tabProcess.pty
    }

    const shell = process.env.SHELL || '/bin/bash'

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: agentProcess.agent.workDir,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    })

    tabProcess.pty = ptyProcess
    tabProcess.info.status = 'running'

    // Create log stream when PTY starts
    tabProcess.logStream = this.createLogStream(agentProcess.agent, tabProcess.info.name)

    // Handle PTY data
    ptyProcess.onData((data) => {
      this.handlePtyData(agentId, tabId, data)
    })

    ptyProcess.onExit(() => {
      // Flush any pending data
      this.flushPendingData(agentId, tabId)

      if (tabProcess.logStream) {
        tabProcess.logStream.end()
        tabProcess.logStream = null
      }

      // Save output buffer for recovery (first tab only for now)
      const firstTabId = agentProcess.tabs.keys().next().value
      if (tabId === firstTabId) {
        const fullOutput = this.getOutputHistory(agentId, tabId)
        // Only save last 50KB for persistence
        const persistBuffer = fullOutput.slice(-50000)
        updatePersistedAgentBuffer(agentId, persistBuffer)
      }

      tabProcess.pty = null
      tabProcess.info.status = 'stopped'
      this.emit('tab-status', agentId, tabId, 'stopped')
    })

    this.emit('tab-status', agentId, tabId, 'running')

    // Update agent status
    agentProcess.agent.status = 'running'
    this.emit('agent-status', agentId, 'running')

    return ptyProcess
  }

  stopTab(agentId: string, tabId: string): void {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) return

    const tabProcess = agentProcess.tabs.get(tabId)
    if (!tabProcess || !tabProcess.pty) return

    // Flush pending data before stopping
    this.flushPendingData(agentId, tabId)

    tabProcess.pty.kill()
    tabProcess.pty = null
    tabProcess.info.status = 'stopped'

    this.emit('tab-status', agentId, tabId, 'stopped')

    // Check if any tabs are still running
    const anyRunning = Array.from(agentProcess.tabs.values()).some(t => t.info.status === 'running')
    if (!anyRunning) {
      agentProcess.agent.status = 'stopped'
      this.emit('agent-status', agentId, 'stopped')
    }
  }

  getPty(agentId: string, tabId: string): pty.IPty | null {
    return this.agents.get(agentId)?.tabs.get(tabId)?.pty || null
  }

  resizePty(agentId: string, tabId: string, cols: number, rows: number): void {
    const ptyProcess = this.getPty(agentId, tabId)
    if (ptyProcess) {
      ptyProcess.resize(cols, rows)
    }
  }

  async createPR(
    agentId: string,
    title: string,
    body: string
  ): Promise<{ prUrl: string }> {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    return this.worktreeManager.createPullRequest(
      agentProcess.agent.workDir,
      title,
      body
    )
  }

  async getGitStatus(agentId: string): Promise<string> {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    return this.worktreeManager.getStatus(agentProcess.agent.workDir)
  }

  async getGitDiff(agentId: string): Promise<string> {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    return this.worktreeManager.getDiff(agentProcess.agent.workDir)
  }

  async tryLocalMerge(
    agentId: string,
    targetBranch?: string
  ): Promise<{ success: boolean; message: string; branch: string; targetBranch: string; conflicts?: string[] }> {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    return this.worktreeManager.tryLocalMerge(agentProcess.agent.workDir, targetBranch)
  }

  // Update config at runtime
  updateConfig(newConfig: Partial<Config>): void {
    this.config = { ...this.config, ...newConfig }
  }

  getConfig(): Config {
    return { ...this.config }
  }

  shutdown(): void {
    console.log(`Stopping ${this.agents.size} agent(s)...`)

    // Clear all flush timers
    for (const timer of this.flushTimers.values()) {
      clearTimeout(timer)
    }
    this.flushTimers.clear()

    for (const [agentId, agentProcess] of this.agents) {
      for (const [tabId, tabProcess] of agentProcess.tabs) {
        // Save output buffer for first tab
        const firstTabId = agentProcess.tabs.keys().next().value
        if (tabId === firstTabId) {
          const fullOutput = this.getOutputHistory(agentId, tabId)
          const persistBuffer = fullOutput.slice(-50000)
          if (persistBuffer) {
            updatePersistedAgentBuffer(agentId, persistBuffer)
          }
        }

        if (tabProcess.logStream) {
          tabProcess.logStream.end()
        }

        if (tabProcess.pty) {
          console.log(`Stopping tab ${tabId} of agent ${agentId}`)
          tabProcess.pty.kill()
          tabProcess.pty = null
        }
      }
    }
  }
}
