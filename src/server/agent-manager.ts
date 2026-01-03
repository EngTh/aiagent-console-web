import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import * as path from 'path'
import * as os from 'os'
import type { Agent } from '../shared/types.js'
import { GitWorktreeManager } from './git-worktree.js'

interface AgentProcess {
  pty: pty.IPty | null
  agent: Agent
}

export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentProcess> = new Map()
  private worktreeManager: GitWorktreeManager

  constructor() {
    super()
    const baseWorkDir = path.join(os.homedir(), '.aiagent-console', 'worktrees')
    this.worktreeManager = new GitWorktreeManager(baseWorkDir)
  }

  async createAgent(name: string, sourceRepo: string): Promise<Agent> {
    const id = uuidv4()
    const branchName = `agent/${id.slice(0, 8)}`

    // Create worktree
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

    this.agents.set(id, { pty: null, agent })
    this.emit('agents-updated', this.getAgents())

    return agent
  }

  async deleteAgent(agentId: string): Promise<void> {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
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

  startAgent(
    agentId: string,
    cols: number = 80,
    rows: number = 24
  ): pty.IPty {
    const agentProcess = this.agents.get(agentId)
    if (!agentProcess) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    if (agentProcess.pty) {
      // Already running, return existing pty
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

    // Centralized PTY data handling - emit to all listeners
    ptyProcess.onData((data) => {
      this.emit('pty-data', agentId, data)
    })

    ptyProcess.onExit(() => {
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

  shutdown(): void {
    console.log(`Stopping ${this.agents.size} agent(s)...`)
    for (const [agentId, agentProcess] of this.agents) {
      if (agentProcess.pty) {
        console.log(`Stopping agent ${agentId}`)
        agentProcess.pty.kill()
        agentProcess.pty = null
      }
    }
  }
}
