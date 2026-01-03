import { useState, useRef, useCallback, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import Terminal, { TerminalHandle, TerminalSettings } from './components/Terminal'
import TabBar from './components/TabBar'
import SplitPane from './components/SplitPane'
import CreateAgentDialog from './components/CreateAgentDialog'
import CreatePRDialog from './components/CreatePRDialog'
import SettingsDialog from './components/SettingsDialog'
import { useAgents } from './hooks/useAgents'
import { useWebSocket } from './hooks/useWebSocket'
import type { TabInfo, OutputChunk, BufferStats } from '../shared/types'
import styles from './App.module.css'

type SplitMode = 'none' | 'horizontal' | 'vertical'

interface PanelState {
  agentId: string | null
  tabId: string | null
}

// Client-side sequence tracking per agentId:tabId
const lastSeqMap = new Map<string, number>()

function getSeqKey(agentId: string, tabId: string): string {
  return `${agentId}:${tabId}`
}

function getLastSeq(agentId: string, tabId: string): number {
  const key = getSeqKey(agentId, tabId)
  const value = lastSeqMap.get(key) ?? -1
  console.log(`[DEBUG] getLastSeq: key=${key}, value=${value}, mapSize=${lastSeqMap.size}`)
  return value
}

function updateLastSeq(agentId: string, tabId: string, seq: number): void {
  const key = getSeqKey(agentId, tabId)
  const current = lastSeqMap.get(key) ?? -1
  if (seq > current) {
    lastSeqMap.set(key, seq)
    console.log(`[DEBUG] updateLastSeq: key=${key}, seq=${seq}, mapSize=${lastSeqMap.size}`)
  }
}

function resetLastSeq(agentId: string, tabId: string): void {
  lastSeqMap.delete(getSeqKey(agentId, tabId))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default function App() {
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [prDialogAgentId, setPRDialogAgentId] = useState<string | null>(null)
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings | undefined>()

  // Split view state
  const [splitMode, setSplitMode] = useState<SplitMode>('none')
  const [activePanel, setActivePanel] = useState<0 | 1>(0)
  const [panels, setPanels] = useState<[PanelState, PanelState]>([
    { agentId: null, tabId: null },
    { agentId: null, tabId: null },
  ])

  // Buffer stats per agentId:tabId
  const [bufferStats, setBufferStats] = useState<Map<string, BufferStats>>(new Map())

  // Terminal refs for each panel
  const terminalRef0 = useRef<TerminalHandle>(null)
  const terminalRef1 = useRef<TerminalHandle>(null)
  const terminalRefs = [terminalRef0, terminalRef1]

  // Track what each panel is currently displaying to route output correctly
  const panelsRef = useRef(panels)
  panelsRef.current = panels

  // Fetch terminal settings on mount
  useEffect(() => {
    fetch('/api/terminal-settings')
      .then((res) => res.json())
      .then((data) => setTerminalSettings(data))
      .catch(() => {
        // Use defaults if fetch fails
      })
  }, [])

  const {
    agents,
    loading,
    createAgent,
    deleteAgent,
    updateAgentStatus,
    updateAgents,
    createPR,
  } = useAgents()

  // Handle real-time output with sequence number
  const handleOutput = useCallback((data: string, tabId: string, seq: number) => {
    const currentPanels = panelsRef.current
    console.log(`[DEBUG] handleOutput: seq=${seq}, tabId=${tabId}, dataLen=${data.length}`)

    // Route output to ALL panels showing this tabId
    for (let i = 0; i < 2; i++) {
      const panel = currentPanels[i]
      if (panel.agentId && panel.tabId === tabId) {
        // Track sequence number for this agentId:tabId
        updateLastSeq(panel.agentId, tabId, seq)
        terminalRefs[i].current?.write(data)
        console.log(`[DEBUG] Wrote to panel ${i}`)
      }
    }
  }, [])

  // Handle sync output (bulk chunks from server)
  const handleOutputSync = useCallback((chunks: OutputChunk[], tabId: string, lastSeq: number) => {
    const currentPanels = panelsRef.current
    console.log(`[DEBUG] handleOutputSync: chunks=${chunks.length}, tabId=${tabId}, lastSeq=${lastSeq}`)

    if (chunks.length === 0) return

    // Find panels showing this tabId
    for (let i = 0; i < 2; i++) {
      const panel = currentPanels[i]
      if (panel.agentId && panel.tabId === tabId) {
        const currentLastSeq = getLastSeq(panel.agentId, tabId)
        const firstChunkSeq = chunks[0].seq

        // Check if this is a full sync (chunks start from 0 and we haven't seen data yet)
        const isFullSync = firstChunkSeq === 0 && currentLastSeq === -1
        console.log(`[DEBUG] Panel ${i}: currentLastSeq=${currentLastSeq}, firstChunkSeq=${firstChunkSeq}, isFullSync=${isFullSync}`)

        if (isFullSync) {
          // Full sync: clear and write all
          terminalRefs[i].current?.clear()
          for (const chunk of chunks) {
            terminalRefs[i].current?.write(chunk.data)
          }
        } else {
          // Incremental: only write chunks newer than what we have
          for (const chunk of chunks) {
            if (chunk.seq > currentLastSeq) {
              terminalRefs[i].current?.write(chunk.data)
            }
          }
        }

        updateLastSeq(panel.agentId, tabId, lastSeq)
      }
    }
  }, [])

  // Handle buffer stats update
  const handleBufferStats = useCallback((agentId: string, tabId: string, stats: BufferStats) => {
    setBufferStats(prev => {
      const next = new Map(prev)
      next.set(getSeqKey(agentId, tabId), stats)
      return next
    })
  }, [])

  const handleError = useCallback((message: string) => {
    console.error('WebSocket error:', message)
  }, [])

  const handleTabStatus = useCallback((agentId: string, tabId: string, status: TabInfo['status']) => {
    // Tab status is handled through agents-updated
  }, [])

  const handleTabCreated = useCallback((agentId: string, tab: TabInfo) => {
    // Tab created is handled through agents-updated
  }, [])

  const handleTabClosed = useCallback((agentId: string, tabId: string) => {
    // If closed tab was active, select first available tab
    setPanels(prev => prev.map(panel => {
      if (panel.agentId === agentId && panel.tabId === tabId) {
        const agent = agents.find(a => a.id === agentId)
        const remainingTabs = agent?.tabs?.filter(t => t.id !== tabId)
        return { ...panel, tabId: remainingTabs?.[0]?.id || null }
      }
      return panel
    }) as [PanelState, PanelState])
  }, [agents])

  const {
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
    syncOutput,
    getBufferStats,
  } = useWebSocket({
    onOutput: handleOutput,
    onOutputSync: handleOutputSync,
    onBufferStats: handleBufferStats,
    onAgentsUpdated: updateAgents,
    onAgentStatus: updateAgentStatus,
    onTabStatus: handleTabStatus,
    onTabCreated: handleTabCreated,
    onTabClosed: handleTabClosed,
    onError: handleError,
  })

  // Get current panel state
  const currentPanel = panels[activePanel]
  const selectedAgentId = currentPanel.agentId

  // Request buffer stats periodically
  useEffect(() => {
    const interval = setInterval(() => {
      for (const panel of panels) {
        if (panel.agentId && panel.tabId) {
          getBufferStats(panel.agentId, panel.tabId)
        }
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [panels, getBufferStats])

  const handleSelectAgent = useCallback((agentId: string, panelIndex?: number) => {
    const targetPanel = panelIndex ?? activePanel
    const agent = agents.find(a => a.id === agentId)
    const firstTabId = agent?.tabs?.[0]?.id || null

    setPanels(prev => {
      const newPanels = [...prev] as [PanelState, PanelState]
      newPanels[targetPanel] = { agentId, tabId: firstTabId }
      return newPanels
    })

    if (targetPanel === activePanel && firstTabId) {
      // Use incremental sync if we have previous seq, otherwise get all
      const fromSeq = getLastSeq(agentId, firstTabId) + 1
      attach(agentId, firstTabId, fromSeq > 0 ? fromSeq : undefined)
      // Request buffer stats
      getBufferStats(agentId, firstTabId)
      setTimeout(() => terminalRefs[targetPanel].current?.focus(), 100)
    }
  }, [agents, activePanel, attach, getBufferStats])

  const handleSelectTab = useCallback((tabId: string, panelIndex?: number) => {
    const targetPanel = panelIndex ?? activePanel
    const panel = panels[targetPanel]
    if (!panel.agentId) return

    setPanels(prev => {
      const newPanels = [...prev] as [PanelState, PanelState]
      newPanels[targetPanel] = { ...newPanels[targetPanel], tabId }
      return newPanels
    })

    // Use incremental sync if we have previous seq
    const fromSeq = getLastSeq(panel.agentId, tabId) + 1
    attach(panel.agentId, tabId, fromSeq > 0 ? fromSeq : undefined)
    // Request buffer stats
    getBufferStats(panel.agentId, tabId)
    setTimeout(() => terminalRefs[targetPanel].current?.focus(), 100)
  }, [panels, activePanel, attach, getBufferStats])

  // Reload terminal content from beginning
  const handleReload = useCallback((panelIndex: number) => {
    const panel = panels[panelIndex]
    if (!panel.agentId || !panel.tabId) return

    // Clear terminal first
    terminalRefs[panelIndex].current?.clear()
    // Reset local seq tracking
    resetLastSeq(panel.agentId, panel.tabId)
    // Request all content from server (fromSeq = 0)
    attach(panel.agentId, panel.tabId, 0)
  }, [panels, attach])

  const handleCreateTab = useCallback((panelIndex?: number) => {
    const targetPanel = panelIndex ?? activePanel
    const panel = panels[targetPanel]
    if (panel.agentId) {
      createTab(panel.agentId)
    }
  }, [panels, activePanel, createTab])

  const handleCloseTab = useCallback((tabId: string, panelIndex?: number) => {
    const targetPanel = panelIndex ?? activePanel
    const panel = panels[targetPanel]
    if (panel.agentId) {
      closeTab(panel.agentId, tabId)
    }
  }, [panels, activePanel, closeTab])

  const handleCreateAgent = useCallback(async (name: string, sourceRepo: string) => {
    const agent = await createAgent({ name, sourceRepo })
    handleSelectAgent(agent.id)
  }, [createAgent, handleSelectAgent])

  const handleDeleteAgent = useCallback(async (agentId: string) => {
    if (confirm('Are you sure you want to delete this agent?')) {
      await deleteAgent(agentId)
      // Clear any panels showing this agent
      setPanels(prev => prev.map(panel =>
        panel.agentId === agentId ? { agentId: null, tabId: null } : panel
      ) as [PanelState, PanelState])
    }
  }, [deleteAgent])

  const handleCreatePR = useCallback(async (title: string, body: string) => {
    if (!prDialogAgentId) return
    const prUrl = await createPR(prDialogAgentId, title, body)
    alert(`PR created: ${prUrl}`)
  }, [createPR, prDialogAgentId])

  const handleMerge = useCallback(async (agentId: string) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const result = await response.json()

      if (result.success) {
        alert(`✅ ${result.message}`)
      } else {
        const conflictInfo = result.conflicts?.length
          ? `\n\nConflicting files:\n${result.conflicts.join('\n')}`
          : ''
        alert(`⚠️ ${result.message}${conflictInfo}\n\nYou can manually merge branch '${result.branch}' into '${result.targetBranch}'.`)
      }
    } catch (error) {
      alert(`Failed to merge: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }, [])

  const toggleSplit = useCallback((mode: SplitMode) => {
    if (splitMode === mode) {
      setSplitMode('none')
      setActivePanel(0)
    } else {
      setSplitMode(mode)
    }
  }, [splitMode])

  const handlePanelClick = useCallback((panelIndex: 0 | 1) => {
    if (activePanel !== panelIndex) {
      setActivePanel(panelIndex)
      const panel = panels[panelIndex]
      const otherPanel = panels[activePanel]

      // Only re-attach if switching to a different agent:tab
      // Skip if both panels show the same agent:tab (already receiving output)
      if (panel.agentId && panel.tabId) {
        const isSameTab = otherPanel.agentId === panel.agentId && otherPanel.tabId === panel.tabId
        if (!isSameTab) {
          const fromSeq = getLastSeq(panel.agentId, panel.tabId) + 1
          attach(panel.agentId, panel.tabId, fromSeq > 0 ? fromSeq : undefined)
        }
      }
    }
  }, [activePanel, panels, attach])

  const prDialogAgent = agents.find((a) => a.id === prDialogAgentId)

  const renderTerminalPanel = (panelIndex: 0 | 1) => {
    const panel = panels[panelIndex]
    const agent = agents.find(a => a.id === panel.agentId)
    const isActive = activePanel === panelIndex
    const tabs = agent?.tabs || []
    const terminalRef = terminalRefs[panelIndex]

    // Get buffer stats for this panel
    const stats = panel.agentId && panel.tabId
      ? bufferStats.get(getSeqKey(panel.agentId, panel.tabId))
      : null
    const localSeq = panel.agentId && panel.tabId
      ? getLastSeq(panel.agentId, panel.tabId)
      : -1

    if (!agent) {
      return (
        <div
          className={`${styles.emptyTerminal} ${isActive ? styles.activePanel : ''}`}
          onClick={() => handlePanelClick(panelIndex)}
        >
          <div className={styles.emptyIcon}>⌨️</div>
          <div className={styles.emptyText}>
            Select an agent from the sidebar
          </div>
        </div>
      )
    }

    return (
      <div
        className={`${styles.terminalPanel} ${isActive ? styles.activePanel : ''}`}
        onClick={() => handlePanelClick(panelIndex)}
      >
        <div className={styles.panelHeader}>
          <div className={styles.agentInfo}>
            <span className={styles.agentName}>{agent.name}</span>
            <span className={styles.agentPath}>{agent.workDir}</span>
          </div>
          <div className={styles.bufferInfo}>
            {stats && (
              <>
                <span className={styles.bufferStat}>
                  Server: {formatBytes(stats.totalSize)} ({stats.chunkCount} chunks, seq {stats.firstSeq}-{stats.lastSeq})
                </span>
                <span className={styles.bufferStat}>
                  Local: seq {localSeq}
                </span>
                <button
                  className={styles.reloadBtn}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleReload(panelIndex)
                  }}
                  title="Reload all content from server"
                >
                  ↻ Reload
                </button>
              </>
            )}
          </div>
          {isActive && (
            <div className={styles.controlStatus}>
              {hasControl ? (
                <span className={styles.controlLabel}>In Control</span>
              ) : (
                <>
                  <span className={styles.viewOnlyLabel}>View Only</span>
                  <button className={styles.gainControlBtn} onClick={gainControl}>
                    Gain Control
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <TabBar
          tabs={tabs}
          activeTabId={panel.tabId}
          onSelectTab={(tabId) => {
            if (panelIndex !== activePanel) {
              setActivePanel(panelIndex)
            }
            handleSelectTab(tabId, panelIndex)
          }}
          onCreateTab={() => handleCreateTab(panelIndex)}
          onCloseTab={(tabId) => handleCloseTab(tabId, panelIndex)}
        />
        <div className={styles.terminalContainer}>
          <Terminal
            ref={terminalRef}
            onInput={(data) => sendInput(data, panel.tabId || undefined)}
            onResize={(cols, rows) => resize(cols, rows, panel.tabId || undefined)}
            settings={terminalSettings}
          />
        </div>
      </div>
    )
  }

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
        onMerge={handleMerge}
        onOpenSettings={() => setShowSettingsDialog(true)}
      />

      <div className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.splitButtons}>
            <button
              className={`${styles.splitBtn} ${splitMode === 'horizontal' ? styles.active : ''}`}
              onClick={() => toggleSplit('horizontal')}
              title="Split Left/Right"
            >
              ◧
            </button>
            <button
              className={`${styles.splitBtn} ${splitMode === 'vertical' ? styles.active : ''}`}
              onClick={() => toggleSplit('vertical')}
              title="Split Top/Bottom"
            >
              ⬒
            </button>
          </div>
          <div className={styles.connectionStatus}>
            <span
              className={styles.statusDot}
              style={{ background: connected ? 'var(--success)' : 'var(--danger)' }}
            />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        <div className={styles.content}>
          {splitMode === 'none' ? (
            renderTerminalPanel(0)
          ) : (
            <SplitPane direction={splitMode}>
              {renderTerminalPanel(0)}
              {renderTerminalPanel(1)}
            </SplitPane>
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

      <SettingsDialog
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
        onTerminalSettingsChange={setTerminalSettings}
      />
    </div>
  )
}
