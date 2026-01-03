import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import type { Agent } from '../shared/types.js'
import type { Config } from '../shared/config.js'
import { GitWorktreeManager } from './git-worktree.js'

const MAX_BUFFER_SIZE = 100000 // ~100KB of history per agent

interface AgentProcess {
  pty: pty.IPty | null
  agent: Agent
  outputBuffer: string // Store recent output for new connections
  logStream: fs.WriteStream | null // Log file stream
}

export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentProcess> = new Map()
  private worktreeManager: GitWorktreeManager
  private controlOwners: Map<string, string> = new Map()
  private config: Config

  constructor(config: Config) {
    super()
    this.config = config
    const baseWorkDir = path.join(os.homedir(), '.aiagent-console', 'worktrees')
    this.worktreeManager = new GitWorktreeManager(baseWorkDir)
  }

  // Control management
  getControlOwner(agentId: string): string | null {
    return this.controlOwners.get(agentId) || null
  }

  hasControl(agentId: string, clientId: string): boolean {
    return this.controlOwners.get(agentId) === clientId
  }

  tryGainControl(agentId: string, clientId: string): boolean {
    const currentOwner = this.controlOwners.get(agentId)
    if (!currentOwner) {
      this.controlOwners.set(agentId, clientId)
      this.emit('control-changed', agentId, clientId)
      return true
    }
    this.controlOwners.set(agentId, clientId)
    this.emit('control-changed', agentId, clientId)
    return true
  }

  releaseControl(agentId: string, clientId: string): void {
    if (this.controlOwners.get(agentId) === clientId) {
      this.controlOwners.delete(agentId)
      this.emit('control-changed', agentId, null)
    }
  }

  // Get output history for a specific agent
  getOutputHistory(agentId: string): string {
    const agentProcess = this.agents.get(agentId)
    return agentProcess?.outputBuffer || ''
  }

  // Create log file for an agent
  private createLogStream(agent: Agent): fs.WriteStream | null {
    if (!this.config.logEnabled || !this.config.logDir) {
      return null
    }

    try {
      // Create log directory structure: logDir/YYYY-MM/DD/
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`

      const logDir = path.join(this.config.logDir, `${year}-${month}`, day)
      fs.mkdirSync(logDir, { recursive: true })

      // Sanitize path for filename
      const sanitizedPath = agent.workDir.replace(/[/\\:]/g, '_').replace(/^_+/, '')
      const logFileName = `${time}_${agent.name}_${sanitizedPath}.log`
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

    const agent: Agent = {
      id,
      name,
      sourceRepo,
      workDir: worktreePath,
      branch,
      status: 'idle',
      createdAt: Date.now(),
    }

    this.agents.set(id, {
      pty: null,
      agent,
      outputBuffer: '',
      logStream: null,
    })
    this.emit('agents-updated', this.getAgents())

    return agent
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    // Close log stream
    if (agentProcess.logStream) {
      agentProcess.logStream.end()
    }

    // Stop the agent if running
    if (agentProcess.pty) {
      agentProcess.pty.kill()
    }

    // Remove worktree
    await this.worktreeManager.removeWorktree(
      agentProcess.agent.sourceRepo,
      agentId
    )

    this.agents.delete(agentId)
    this.emit('agents-updated', this.getAgents())
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId)?.agent
  }

  getAgents(): Agent[] {
    return Array.from(this.agents.values()).map((p) => p.agent)
  }

  startAgent(agentId: string, cols: number = 80, rows: number = 24): pty.IPty {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    if (agentProcess.pty) {
      return agentProcess.pty
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

    agentProcess.pty = ptyProcess
    agentProcess.agent.status = 'running'
    agentProcess.outputBuffer = ''

    // Create log stream when PTY starts
    agentProcess.logStream = this.createLogStream(agentProcess.agent)

    // Centralized PTY data handling
    ptyProcess.onData((data) => {
      // Store in buffer for history
      agentProcess.outputBuffer += data
      // Trim buffer if too large
      if (agentProcess.outputBuffer.length > MAX_BUFFER_SIZE) {
        agentProcess.outputBuffer = agentProcess.outputBuffer.slice(-MAX_BUFFER_SIZE)
      }

      // Write to log file
      if (agentProcess.logStream) {
        agentProcess.logStream.write(data)
      }

      this.emit('pty-data', agentId, data)
    })

    ptyProcess.onExit(() => {
      // Close log stream
      if (agentProcess.logStream) {
        agentProcess.logStream.end()
        agentProcess.logStream = null
      }

      agentProcess.pty = null
      agentProcess.agent.status = 'stopped'
      this.emit('agent-status', agentId, 'stopped')
    })

    this.emit('agent-status', agentId, 'running')

    return ptyProcess
  }

  stopAgent(agentId: string): void {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess || !agentProcess.pty) {
      return
    }

    agentProcess.pty.kill()
    agentProcess.pty = null
    agentProcess.agent.status = 'stopped'
    this.emit('agent-status', agentId, 'stopped')
  }

  getPty(agentId: string): pty.IPty | null {
    return this.agents.get(agentId)?.pty || null
  }

  resizePty(agentId: string, cols: number, rows: number): void {
    const ptyProcess = this.getPty(agentId)
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
    for (const [agentId, agentProcess] of this.agents) {
      // Close log streams
      if (agentProcess.logStream) {
        agentProcess.logStream.end()
      }

      if (agentProcess.pty) {
        console.log(`Stopping agent ${agentId}`)
        agentProcess.pty.kill()
        agentProcess.pty = null
      }
    }
  }
}
