export interface Agent {
  id: string
  name: string
  sourceRepo: string
  workDir: string
  branch: string
  status: 'idle' | 'running' | 'stopped'
  createdAt: number
  tabs?: TabInfo[] // Active tabs for this agent
}

export interface TabInfo {
  id: string
  name: string
  status: 'idle' | 'running' | 'stopped'
}

export interface CreateAgentRequest {
  name: string
  sourceRepo: string
}

export interface AgentListResponse {
  agents: Agent[]
}

// WebSocket message types
export type WSClientMessage =
  | { type: 'attach'; agentId: string; tabId?: string }
  | { type: 'detach' }
  | { type: 'input'; data: string; tabId?: string }
  | { type: 'resize'; cols: number; rows: number; tabId?: string }
  | { type: 'start'; agentId: string; tabId?: string }
  | { type: 'stop'; agentId: string; tabId?: string }
  | { type: 'gain-control' }
  | { type: 'create-tab'; agentId: string; name?: string }
  | { type: 'close-tab'; agentId: string; tabId: string }

export type WSServerMessage =
  | { type: 'output'; data: string; tabId?: string }
  | { type: 'attached'; agentId: string; tabId: string; hasControl: boolean }
  | { type: 'detached' }
  | { type: 'agent-status'; agentId: string; status: Agent['status'] }
  | { type: 'tab-status'; agentId: string; tabId: string; status: TabInfo['status'] }
  | { type: 'tab-created'; agentId: string; tab: TabInfo }
  | { type: 'tab-closed'; agentId: string; tabId: string }
  | { type: 'error'; message: string }
  | { type: 'agents-updated'; agents: Agent[] }
  | { type: 'control-changed'; hasControl: boolean }
