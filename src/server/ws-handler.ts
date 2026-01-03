import { WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import type { WSClientMessage, WSServerMessage } from '../shared/types.js'
import type { AgentManager } from './agent-manager.js'

export class WSHandler {
  private ws: WebSocket
  private agentManager: AgentManager
  private clientId: string
  private attachedAgentId: string | null = null
  private boundPtyDataHandler: (agentId: string, data: string) => void
  private boundAgentsUpdatedHandler: (agents: unknown[]) => void
  private boundAgentStatusHandler: (agentId: string, status: string) => void
  private boundControlChangedHandler: (agentId: string, newOwnerId: string | null) => void

  constructor(ws: WebSocket, agentManager: AgentManager) {
    this.ws = ws
    this.agentManager = agentManager
    this.clientId = uuidv4()

    // Bind handlers so we can remove them later
    this.boundPtyDataHandler = this.handlePtyData.bind(this)
    this.boundAgentsUpdatedHandler = this.handleAgentsUpdated.bind(this)
    this.boundAgentStatusHandler = this.handleAgentStatus.bind(this)
    this.boundControlChangedHandler = this.handleControlChanged.bind(this)

    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WSClientMessage
        this.handleMessage(message)
      } catch {
        this.send({ type: 'error', message: 'Invalid message format' })
      }
    })

    this.ws.on('close', () => {
      this.cleanup()
    })

    // Listen for agent updates
    this.agentManager.on('agents-updated', this.boundAgentsUpdatedHandler)
    this.agentManager.on('agent-status', this.boundAgentStatusHandler)
    this.agentManager.on('pty-data', this.boundPtyDataHandler)
    this.agentManager.on('control-changed', this.boundControlChangedHandler)
  }

  private handlePtyData(agentId: string, data: string): void {
    // Only send data if this client is attached to this agent
    if (this.attachedAgentId === agentId) {
      this.send({ type: 'output', data })
    }
  }

  private handleAgentsUpdated(agents: unknown[]): void {
    this.send({ type: 'agents-updated', agents } as WSServerMessage)
  }

  private handleAgentStatus(agentId: string, status: string): void {
    this.send({ type: 'agent-status', agentId, status } as WSServerMessage)
  }

  private handleControlChanged(agentId: string, newOwnerId: string | null): void {
    // Only notify if this client is attached to this agent
    if (this.attachedAgentId === agentId) {
      const hasControl = newOwnerId === this.clientId
      this.send({ type: 'control-changed', hasControl })
    }
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
      case 'gain-control':
        this.gainControl()
        break
    }
  }

  private attachToAgent(agentId: string): void {
    // Release control from previous agent if attached
    if (this.attachedAgentId) {
      this.agentManager.releaseControl(this.attachedAgentId, this.clientId)
      this.attachedAgentId = null
    }

    const agent = this.agentManager.getAgent(agentId)
    if (!agent) {
      this.send({ type: 'error', message: `Agent not found: ${agentId}` })
      return
    }

    this.attachedAgentId = agentId

    // Get or create PTY
    let pty = this.agentManager.getPty(agentId)
    if (!pty) {
      this.agentManager.startAgent(agentId)
    }

    // Try to gain control if no one has it
    const currentOwner = this.agentManager.getControlOwner(agentId)
    let hasControl = false
    if (!currentOwner) {
      this.agentManager.tryGainControl(agentId, this.clientId)
      hasControl = true
    }

    this.send({ type: 'attached', agentId, hasControl })
  }

  private detachFromAgent(): void {
    if (!this.attachedAgentId) return

    // Release control when detaching
    this.agentManager.releaseControl(this.attachedAgentId, this.clientId)
    this.attachedAgentId = null
    this.send({ type: 'detached' })
  }

  private gainControl(): void {
    if (!this.attachedAgentId) return

    this.agentManager.tryGainControl(this.attachedAgentId, this.clientId)
    // control-changed event will notify all clients
  }

  private handleInput(data: string): void {
    if (!this.attachedAgentId) return

    // Only allow input if this client has control
    if (!this.agentManager.hasControl(this.attachedAgentId, this.clientId)) {
      return // Silently ignore input from non-controlling clients
    }

    const pty = this.agentManager.getPty(this.attachedAgentId)
    if (pty) {
      pty.write(data)
    }
  }

  private handleResize(cols: number, rows: number): void {
    if (!this.attachedAgentId) return
    // Only allow resize if this client has control
    if (!this.agentManager.hasControl(this.attachedAgentId, this.clientId)) {
      return
    }
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
    // Release control when connection closes
    if (this.attachedAgentId) {
      this.agentManager.releaseControl(this.attachedAgentId, this.clientId)
    }

    // Remove all event listeners
    this.agentManager.off('agents-updated', this.boundAgentsUpdatedHandler)
    this.agentManager.off('agent-status', this.boundAgentStatusHandler)
    this.agentManager.off('pty-data', this.boundPtyDataHandler)
    this.agentManager.off('control-changed', this.boundControlChangedHandler)
    this.attachedAgentId = null
  }
}
