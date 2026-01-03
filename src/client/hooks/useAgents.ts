import { useState, useCallback, useEffect } from 'react'
import type { Agent, CreateAgentRequest } from '../../shared/types'

const API_BASE = '/api'

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/agents`)
      if (!response.ok) throw new Error('Failed to fetch agents')
      const data = await response.json()
      setAgents(data.agents)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  const createAgent = useCallback(async (request: CreateAgentRequest): Promise<Agent> => {
    const response = await fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to create agent')
    }
    const agent = await response.json()
    // Don't add locally - WebSocket will push agents-updated
    return agent
  }, [])

  const deleteAgent = useCallback(async (agentId: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/agents/${agentId}`, {
      method: 'DELETE',
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to delete agent')
    }
    // Don't remove locally - WebSocket will push agents-updated
  }, [])

  const updateAgentStatus = useCallback((agentId: string, status: Agent['status']) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agentId ? { ...a, status } : a))
    )
  }, [])

  const updateAgents = useCallback((newAgents: Agent[]) => {
    setAgents(newAgents)
  }, [])

  const createPR = useCallback(async (agentId: string, title: string, body: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/agents/${agentId}/pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to create PR')
    }
    const data = await response.json()
    return data.prUrl
  }, [])

  const getGitStatus = useCallback(async (agentId: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/agents/${agentId}/status`)
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to get status')
    }
    const data = await response.json()
    return data.status
  }, [])

  const getGitDiff = useCallback(async (agentId: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/agents/${agentId}/diff`)
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to get diff')
    }
    const data = await response.json()
    return data.diff
  }, [])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  return {
    agents,
    loading,
    error,
    createAgent,
    deleteAgent,
    updateAgentStatus,
    updateAgents,
    createPR,
    getGitStatus,
    getGitDiff,
    refetch: fetchAgents,
  }
}
