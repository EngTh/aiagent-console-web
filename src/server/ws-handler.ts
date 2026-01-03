import { WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import type { WSClientMessage, WSServerMessage, TabInfo } from '../shared/types.js'
import type { AgentManager } from './agent-manager.js'

export class WSHandler {
  private ws: WebSocket
  private agentManager: AgentManager
  private clientId: string
  private attachedAgentId: string | null = null
  private attachedTabId: string | null = null
  private boundPtyDataHandler: (agentId: string, tabId: string, data: string) => void
  private boundAgentsUpdatedHandler: (agents: unknown[]) => void
  private boundAgentStatusHandler: (agentId: string, status: string) => void
  private boundTabStatusHandler: (agentId: string, tabId: string, status: string) => void
  private boundControlChangedHandler: (agentId: string, tabId: string, newOwnerId: string | null) => void
  private boundTabCreatedHandler: (agentId: string, tab: TabInfo) => void
  private boundTabClosedHandler: (agentId: string, tabId: string) => void

  constructor(ws: WebSocket, agentManager: AgentManager) {
    this.ws = ws
    this.agentManager = agentManager
    this.clientId = uuidv4()

    // Bind handlers so we can remove them later
    this.boundPtyDataHandler = this.handlePtyData.bind(this)
    this.boundAgentsUpdatedHandler = this.handleAgentsUpdated.bind(this)
    this.boundAgentStatusHandler = this.handleAgentStatus.bind(this)
    this.boundTabStatusHandler = this.handleTabStatus.bind(this)
    this.boundControlChangedHandler = this.handleControlChanged.bind(this)
    this.boundTabCreatedHandler = this.handleTabCreated.bind(this)
    this.boundTabClosedHandler = this.handleTabClosed.bind(this)

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
    this.agentManager.on('tab-status', this.boundTabStatusHandler)
    this.agentManager.on('pty-data', this.boundPtyDataHandler)
    this.agentManager.on('control-changed', this.boundControlChangedHandler)
    this.agentManager.on('tab-created', this.boundTabCreatedHandler)
    this.agentManager.on('tab-closed', this.boundTabClosedHandler)
  }

  private handlePtyData(agentId: string, tabId: string, data: string): void {
    // Only send data if this client is attached to this agent and tab
    if (this.attachedAgentId === agentId && this.attachedTabId === tabId) {
      this.send({ type: 'output', data, tabId })
    }
  }

  private handleAgentsUpdated(agents: unknown[]): void {
    this.send({ type: 'agents-updated', agents } as WSServerMessage)
  }

  private handleAgentStatus(agentId: string, status: string): void {
    this.send({ type: 'agent-status', agentId, status } as WSServerMessage)
  }

  private handleTabStatus(agentId: string, tabId: string, status: string): void {
    if (this.attachedAgentId === agentId) {
      this.send({ type: 'tab-status', agentId, tabId, status } as WSServerMessage)
    }
  }

  private handleControlChanged(agentId: string, tabId: string, newOwnerId: string | null): void {
    // Only notify if this client is attached to this agent and tab
    if (this.attachedAgentId === agentId && this.attachedTabId === tabId) {
      const hasControl = newOwnerId === this.clientId
      this.send({ type: 'control-changed', hasControl })
    }
  }

  private handleTabCreated(agentId: string, tab: TabInfo): void {
    if (this.attachedAgentId === agentId) {
      this.send({ type: 'tab-created', agentId, tab })
    }
  }

  private handleTabClosed(agentId: string, tabId: string): void {
    if (this.attachedAgentId === agentId) {
      this.send({ type: 'tab-closed', agentId, tabId })
      // If current tab was closed, detach
      if (this.attachedTabId === tabId) {
        this.attachedTabId = null
      }
    }
  }

  private handleMessage(message: WSClientMessage): void {
    switch (message.type) {
      case 'attach':
        this.attachToAgent(message.agentId, message.tabId)
        break
      case 'detach':
        this.detachFromAgent()
        break
      case 'input':
        this.handleInput(message.data, message.tabId)
        break
      case 'resize':
        this.handleResize(message.cols, message.rows, message.tabId)
        break
      case 'start':
        this.startTab(message.agentId, message.tabId)
        break
      case 'stop':
        this.stopTab(message.agentId, message.tabId)
        break
      case 'gain-control':
        this.gainControl()
        break
      case 'create-tab':
        this.createTab(message.agentId, message.name)
        break
      case 'close-tab':
        this.closeTab(message.agentId, message.tabId)
        break
    }
  }

  private attachToAgent(agentId: string, tabId?: string): void {
    // Release control from previous agent/tab if attached
    if (this.attachedAgentId && this.attachedTabId) {
      this.agentManager.releaseControl(this.attachedAgentId, this.attachedTabId, this.clientId)
    }

    const agent = this.agentManager.getAgent(agentId)
    if (!agent) {
      this.send({ type: 'error', message: `Agent not found: ${agentId}` })
      return
    }

    // Use first tab if not specified
    const targetTabId = tabId || agent.tabs?.[0]?.id
    if (!targetTabId) {
      this.send({ type: 'error', message: `No tabs available for agent: ${agentId}` })
      return
    }

    this.attachedAgentId = agentId
    this.attachedTabId = targetTabId

    // Get or start PTY for this tab
    let pty = this.agentManager.getPty(agentId, targetTabId)
    if (!pty) {
      this.agentManager.startTab(agentId, targetTabId)
    }

    // Try to gain control if no one has it
    const currentOwner = this.agentManager.getControlOwner(agentId, targetTabId)
    let hasControl = false
    if (!currentOwner) {
      this.agentManager.tryGainControl(agentId, targetTabId, this.clientId)
      hasControl = true
    }

    this.send({ type: 'attached', agentId, tabId: targetTabId, hasControl })

    // Send history output so new connections can see previous terminal content
    const history = this.agentManager.getOutputHistory(agentId, targetTabId)
    if (history) {
      this.send({ type: 'output', data: history, tabId: targetTabId })
    }
  }

  private detachFromAgent(): void {
    if (!this.attachedAgentId || !this.attachedTabId) return

    // Release control when detaching
    this.agentManager.releaseControl(this.attachedAgentId, this.attachedTabId, this.clientId)
    this.attachedAgentId = null
    this.attachedTabId = null
    this.send({ type: 'detached' })
  }

  private gainControl(): void {
    if (!this.attachedAgentId || !this.attachedTabId) return

    this.agentManager.tryGainControl(this.attachedAgentId, this.attachedTabId, this.clientId)
    // control-changed event will notify all clients
  }

  private handleInput(data: string, tabId?: string): void {
    if (!this.attachedAgentId) return

    const targetTabId = tabId || this.attachedTabId
    if (!targetTabId) return

    // Only allow input if this client has control
    if (!this.agentManager.hasControl(this.attachedAgentId, targetTabId, this.clientId)) {
      return // Silently ignore input from non-controlling clients
    }

    const pty = this.agentManager.getPty(this.attachedAgentId, targetTabId)
    if (pty) {
      pty.write(data)
    }
  }

  private handleResize(cols: number, rows: number, tabId?: string): void {
    if (!this.attachedAgentId) return

    const targetTabId = tabId || this.attachedTabId
    if (!targetTabId) return

    // Only allow resize if this client has control
    if (!this.agentManager.hasControl(this.attachedAgentId, targetTabId, this.clientId)) {
      return
    }
    this.agentManager.resizePty(this.attachedAgentId, targetTabId, cols, rows)
  }

  private startTab(agentId: string, tabId?: string): void {
    const agent = this.agentManager.getAgent(agentId)
    if (!agent) {
      this.send({ type: 'error', message: `Agent not found: ${agentId}` })
      return
    }

    const targetTabId = tabId || agent.tabs?.[0]?.id
    if (!targetTabId) {
      this.send({ type: 'error', message: `No tabs available for agent: ${agentId}` })
      return
    }

    try {
      this.agentManager.startTab(agentId, targetTabId)
    } catch (error) {
      this.send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to start tab',
      })
    }
  }

  private stopTab(agentId: string, tabId?: string): void {
    const agent = this.agentManager.getAgent(agentId)
    if (!agent) return

    const targetTabId = tabId || agent.tabs?.[0]?.id
    if (!targetTabId) return

    this.agentManager.stopTab(agentId, targetTabId)
  }

  private createTab(agentId: string, name?: string): void {
    try {
      this.agentManager.createTab(agentId, name)
      // Tab created event will be emitted by agentManager
    } catch (error) {
      this.send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to create tab',
      })
    }
  }

  private closeTab(agentId: string, tabId: string): void {
    try {
      this.agentManager.closeTab(agentId, tabId)
      // Tab closed event will be emitted by agentManager
    } catch (error) {
      this.send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to close tab',
      })
    }
  }

  private send(message: WSServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private cleanup(): void {
    // Release control when connection closes
    if (this.attachedAgentId && this.attachedTabId) {
      this.agentManager.releaseControl(this.attachedAgentId, this.attachedTabId, this.clientId)
    }

    // Remove all event listeners
    this.agentManager.off('agents-updated', this.boundAgentsUpdatedHandler)
    this.agentManager.off('agent-status', this.boundAgentStatusHandler)
    this.agentManager.off('tab-status', this.boundTabStatusHandler)
    this.agentManager.off('pty-data', this.boundPtyDataHandler)
    this.agentManager.off('control-changed', this.boundControlChangedHandler)
    this.agentManager.off('tab-created', this.boundTabCreatedHandler)
    this.agentManager.off('tab-closed', this.boundTabClosedHandler)
    this.attachedAgentId = null
    this.attachedTabId = null
  }
}
