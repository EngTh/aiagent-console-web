import { useEffect, useRef, useCallback, useState } from 'react'
import type { WSClientMessage, WSServerMessage, Agent } from '../../shared/types'

interface UseWebSocketOptions {
  onOutput: (data: string) => void
  onAgentsUpdated: (agents: Agent[]) => void
  onAgentStatus: (agentId: string, status: Agent['status']) => void
  onError: (message: string) => void
}

export function useWebSocket(options: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [attachedAgentId, setAttachedAgentId] = useState<string | null>(null)
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
        options.onOutput(message.data)
        break
      case 'attached':
        setAttachedAgentId(message.agentId)
        setHasControl(message.hasControl)
        break
      case 'detached':
        setAttachedAgentId(null)
        setHasControl(false)
        break
      case 'agents-updated':
        options.onAgentsUpdated(message.agents)
        break
      case 'agent-status':
        options.onAgentStatus(message.agentId, message.status)
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

  const attach = useCallback((agentId: string) => {
    send({ type: 'attach', agentId })
  }, [send])

  const detach = useCallback(() => {
    send({ type: 'detach' })
  }, [send])

  const sendInput = useCallback((data: string) => {
    send({ type: 'input', data })
  }, [send])

  const resize = useCallback((cols: number, rows: number) => {
    send({ type: 'resize', cols, rows })
  }, [send])

  const startAgent = useCallback((agentId: string) => {
    send({ type: 'start', agentId })
  }, [send])

  const stopAgent = useCallback((agentId: string) => {
    send({ type: 'stop', agentId })
  }, [send])

  const gainControl = useCallback(() => {
    send({ type: 'gain-control' })
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
    hasControl,
    attach,
    detach,
    sendInput,
    resize,
    startAgent,
    stopAgent,
    gainControl,
  }
}
