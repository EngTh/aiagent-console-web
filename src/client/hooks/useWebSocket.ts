import { useEffect, useRef, useCallback, useState } from 'react'
import type { WSClientMessage, WSServerMessage, Agent, TabInfo } from '../../shared/types'

interface UseWebSocketOptions {
  onOutput: (data: string, tabId?: string) => void
  onAgentsUpdated: (agents: Agent[]) => void
  onAgentStatus: (agentId: string, status: Agent['status']) => void
  onTabStatus: (agentId: string, tabId: string, status: TabInfo['status']) => void
  onTabCreated: (agentId: string, tab: TabInfo) => void
  onTabClosed: (agentId: string, tabId: string) => void
  onError: (message: string) => void
}

export function useWebSocket(options: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [attachedAgentId, setAttachedAgentId] = useState<string | null>(null)
  const [attachedTabId, setAttachedTabId] = useState<string | null>(null)
  const [hasControl, setHasControl] = useState(false)
  const reconnectTimeoutRef = useRef<number>()

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

    ws.onopen = () => {
      console.log('WebSocket connected')
      setConnected(true)
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setConnected(false)
      setAttachedAgentId(null)
      setAttachedTabId(null)
      setHasControl(false)

      // Reconnect after 2 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect()
      }, 2000)
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WSServerMessage
        handleMessage(message)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    wsRef.current = ws
  }, [])

  const handleMessage = useCallback((message: WSServerMessage) => {
    switch (message.type) {
      case 'output':
        options.onOutput(message.data, message.tabId)
        break
      case 'attached':
        setAttachedAgentId(message.agentId)
        setAttachedTabId(message.tabId)
        setHasControl(message.hasControl)
        break
      case 'detached':
        setAttachedAgentId(null)
        setAttachedTabId(null)
        setHasControl(false)
        break
      case 'agents-updated':
        options.onAgentsUpdated(message.agents)
        break
      case 'agent-status':
        options.onAgentStatus(message.agentId, message.status)
        break
      case 'tab-status':
        options.onTabStatus(message.agentId, message.tabId, message.status)
        break
      case 'tab-created':
        options.onTabCreated(message.agentId, message.tab)
        break
      case 'tab-closed':
        options.onTabClosed(message.agentId, message.tabId)
        break
      case 'control-changed':
        setHasControl(message.hasControl)
        break
      case 'error':
        options.onError(message.message)
        break
    }
  }, [options])

  const send = useCallback((message: WSClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const attach = useCallback((agentId: string, tabId?: string) => {
    send({ type: 'attach', agentId, tabId })
  }, [send])

  const detach = useCallback(() => {
    send({ type: 'detach' })
  }, [send])

  const sendInput = useCallback((data: string, tabId?: string) => {
    send({ type: 'input', data, tabId })
  }, [send])

  const resize = useCallback((cols: number, rows: number, tabId?: string) => {
    send({ type: 'resize', cols, rows, tabId })
  }, [send])

  const startTab = useCallback((agentId: string, tabId?: string) => {
    send({ type: 'start', agentId, tabId })
  }, [send])

  const stopTab = useCallback((agentId: string, tabId?: string) => {
    send({ type: 'stop', agentId, tabId })
  }, [send])

  const gainControl = useCallback(() => {
    send({ type: 'gain-control' })
  }, [send])

  const createTab = useCallback((agentId: string, name?: string) => {
    send({ type: 'create-tab', agentId, name })
  }, [send])

  const closeTab = useCallback((agentId: string, tabId: string) => {
    send({ type: 'close-tab', agentId, tabId })
  }, [send])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      wsRef.current?.close()
    }
  }, [connect])

  return {
    connected,
    attachedAgentId,
    attachedTabId,
    hasControl,
    attach,
    detach,
    sendInput,
    resize,
    startTab,
    stopTab,
    gainControl,
    createTab,
    closeTab,
  }
}
