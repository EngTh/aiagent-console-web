import { useState, useRef, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import Terminal, { TerminalHandle } from './components/Terminal'
import CreateAgentDialog from './components/CreateAgentDialog'
import CreatePRDialog from './components/CreatePRDialog'
import { useAgents } from './hooks/useAgents'
import { useWebSocket } from './hooks/useWebSocket'
import styles from './App.module.css'

export default function App() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [prDialogAgentId, setPRDialogAgentId] = useState<string | null>(null)
  const terminalRef = useRef<TerminalHandle>(null)

  const {
    agents,
    loading,
    createAgent,
    deleteAgent,
    updateAgentStatus,
    updateAgents,
    createPR,
  } = useAgents()

  const handleOutput = useCallback((data: string) => {
    terminalRef.current?.write(data)
  }, [])

  const handleError = useCallback((message: string) => {
    console.error('WebSocket error:', message)
  }, [])

  const {
    connected,
    attachedAgentId,
    attach,
    sendInput,
    resize,
  } = useWebSocket({
    onOutput: handleOutput,
    onAgentsUpdated: updateAgents,
    onAgentStatus: updateAgentStatus,
    onError: handleError,
  })

  const handleSelectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId)
    terminalRef.current?.clear()
    attach(agentId)
    setTimeout(() => terminalRef.current?.focus(), 100)
  }, [attach])

  const handleCreateAgent = useCallback(async (name: string, sourceRepo: string) => {
    const agent = await createAgent({ name, sourceRepo })
    handleSelectAgent(agent.id)
  }, [createAgent, handleSelectAgent])

  const handleDeleteAgent = useCallback(async (agentId: string) => {
    if (confirm('Are you sure you want to delete this agent?')) {
      await deleteAgent(agentId)
      if (selectedAgentId === agentId) {
        setSelectedAgentId(null)
        terminalRef.current?.clear()
      }
    }
  }, [deleteAgent, selectedAgentId])

  const handleCreatePR = useCallback(async (title: string, body: string) => {
    if (!prDialogAgentId) return
    const prUrl = await createPR(prDialogAgentId, title, body)
    alert(`PR created: ${prUrl}`)
  }, [createPR, prDialogAgentId])

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)
  const prDialogAgent = agents.find((a) => a.id === prDialogAgentId)

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <span>Loading...</span>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <Sidebar
        agents={agents}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        onCreateAgent={() => setShowCreateDialog(true)}
        onDeleteAgent={handleDeleteAgent}
        onCreatePR={(agentId) => setPRDialogAgentId(agentId)}
      />

      <div className={styles.main}>
        <div className={styles.header}>
          <div className={styles.agentInfo}>
            {selectedAgent ? (
              <>
                <span className={styles.agentName}>{selectedAgent.name}</span>
                <span className={styles.agentPath}>{selectedAgent.workDir}</span>
              </>
            ) : (
              <span className={styles.noAgent}>Select an agent to start</span>
            )}
          </div>
          <div className={styles.connectionStatus}>
            <span
              className={styles.statusDot}
              style={{ background: connected ? 'var(--success)' : 'var(--danger)' }}
            />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className={styles.terminalContainer}>
          {selectedAgentId ? (
            <Terminal
              ref={terminalRef}
              onInput={sendInput}
              onResize={resize}
            />
          ) : (
            <div className={styles.emptyTerminal}>
              <div className={styles.emptyIcon}>⌨️</div>
              <div className={styles.emptyText}>
                Select an agent from the sidebar or create a new one
              </div>
            </div>
          )}
        </div>
      </div>

      <CreateAgentDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={handleCreateAgent}
      />

      <CreatePRDialog
        isOpen={!!prDialogAgentId}
        agentName={prDialogAgent?.name || ''}
        onClose={() => setPRDialogAgentId(null)}
        onCreate={handleCreatePR}
      />
    </div>
  )
}
