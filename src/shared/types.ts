export interface Agent {
  id: string
  name: string
  sourceRepo: string
  workDir: string
  branch: string
  status: 'idle' | 'running' | 'stopped'
  createdAt: number
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
  | { type: 'attach'; agentId: string }
  | { type: 'detach' }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'start'; agentId: string }
  | { type: 'stop'; agentId: string }
  | { type: 'gain-control' }

export type WSServerMessage =
  | { type: 'output'; data: string }
  | { type: 'attached'; agentId: string; hasControl: boolean }
  | { type: 'detached' }
  | { type: 'agent-status'; agentId: string; status: Agent['status'] }
  | { type: 'error'; message: string }
  | { type: 'agents-updated'; agents: Agent[] }
  | { type: 'control-changed'; hasControl: boolean }
