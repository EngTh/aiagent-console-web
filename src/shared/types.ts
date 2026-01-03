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

// Output chunk with sequence number for incremental sync
export interface OutputChunk {
  seq: number
  data: string
  timestamp: number
}

// Buffer statistics for debugging/display
export interface BufferStats {
  chunkCount: number
  totalSize: number
  firstSeq: number
  lastSeq: number
}

// Response for output sync API
export interface OutputSyncResponse {
  chunks: OutputChunk[]
  lastSeq: number
  hasMore: boolean
}

// WebSocket message types
export type WSClientMessage =
  | { type: 'attach'; agentId: string; tabId?: string; fromSeq?: number }
  | { type: 'detach' }
  | { type: 'input'; data: string; tabId?: string }
  | { type: 'resize'; cols: number; rows: number; tabId?: string }
  | { type: 'start'; agentId: string; tabId?: string }
  | { type: 'stop'; agentId: string; tabId?: string }
  | { type: 'gain-control' }
  | { type: 'create-tab'; agentId: string; name?: string }
  | { type: 'close-tab'; agentId: string; tabId: string }
  | { type: 'sync-output'; agentId: string; tabId: string; fromSeq: number }
  | { type: 'get-buffer-stats'; agentId: string; tabId: string }

export type WSServerMessage =
  | { type: 'output'; data: string; tabId?: string; seq: number }
  | { type: 'output-sync'; chunks: OutputChunk[]; tabId: string; lastSeq: number }
  | { type: 'attached'; agentId: string; tabId: string; hasControl: boolean; lastSeq: number }
  | { type: 'detached' }
  | { type: 'agent-status'; agentId: string; status: Agent['status'] }
  | { type: 'tab-status'; agentId: string; tabId: string; status: TabInfo['status'] }
  | { type: 'tab-created'; agentId: string; tab: TabInfo }
  | { type: 'tab-closed'; agentId: string; tabId: string }
  | { type: 'error'; message: string }
  | { type: 'agents-updated'; agents: Agent[] }
  | { type: 'control-changed'; hasControl: boolean }
  | { type: 'buffer-stats'; agentId: string; tabId: string; stats: BufferStats }
