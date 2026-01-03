import { WebSocket } from 'ws'
import type { IPty } from 'node-pty'
import type { WSClientMessage, WSServerMessage } from '../shared/types.js'
import type { AgentManager } from './agent-manager.js'

export class WSHandler {
  private ws: WebSocket
  private agentManager: AgentManager
  private attachedAgentId: string | null = null
  private ptyDataHandler: ((data: string) => void) | null = null

  constructor(ws: WebSocket, agentManager: AgentManager) {
    this.ws = ws
    this.agentManager = agentManager

    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSClientMessage
        this.handleMessage(message)
      } catch (error) {
        this.send({ type: 'error', message: 'Invalid message format' })
      }
    })

    this.ws.on('close', () => {
      this.cleanup()
    })

    // Listen for agent updates
    this.agentManager.on('agents-updated', (agents) => {
      this.send({ type: 'agents-updated', agents })
    })

    this.agentManager.on('agent-status', (agentId, status) => {
      this.send({ type: 'agent-status', agentId, status })
    })
  }

  private handleMessage(message: WSClientMessage): void {
    switch (message.type) {
      case 'attach':
        this.attachToAgent(message.agentId)
        break
      case 'detach':
        this.detachFromAgent()
        break
      case 'input':
        this.handleInput(message.data)
        break
      case 'resize':
        this.handleResize(message.cols, message.rows)
        break
      case 'start':
        this.startAgent(message.agentId)
        break
      case 'stop':
        this.stopAgent(message.agentId)
        break
    }
  }

  private attachToAgent(agentId: string): void {
    // Detach from current agent if attached
    this.detachFromAgent()

    const agent = this.agentManager.getAgent(agentId)
    if (!agent) {
      this.send({ type: 'error', message: `Agent not found: ${agentId}` })
      return
    }

    this.attachedAgentId = agentId

    // Get or create PTY
    let pty = this.agentManager.getPty(agentId)
    if (!pty) {
      pty = this.agentManager.startAgent(agentId)
    }

    // Setup data handler
    this.ptyDataHandler = (data: string) => {
      this.send({ type: 'output', data })
    }
    pty.onData(this.ptyDataHandler)

    this.send({ type: 'attached', agentId })
  }

  private detachFromAgent(): void {
    if (!this.attachedAgentId) return

    // Note: node-pty doesn't provide a way to remove specific listeners
    // The connection will be cleaned up when the websocket closes
    this.attachedAgentId = null
    this.ptyDataHandler = null

    this.send({ type: 'detached' })
  }

  private handleInput(data: string): void {
    if (!this.attachedAgentId) return

    const pty = this.agentManager.getPty(this.attachedAgentId)
    if (pty) {
      pty.write(data)
    }
  }

  private handleResize(cols: number, rows: number): void {
    if (!this.attachedAgentId) return

    this.agentManager.resizePty(this.attachedAgentId, cols, rows)
  }

  private startAgent(agentId: string): void {
    try {
      this.agentManager.startAgent(agentId)
    } catch (error) {
      this.send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to start agent',
      })
    }
  }

  private stopAgent(agentId: string): void {
    this.agentManager.stopAgent(agentId)
  }

  private send(message: WSServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private cleanup(): void {
    this.detachFromAgent()
  }
}
