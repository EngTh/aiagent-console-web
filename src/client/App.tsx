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
import type { TabInfo } from '../shared/types'
import styles from './App.module.css'

type SplitMode = 'none' | 'horizontal' | 'vertical'

interface PanelState {
  agentId: string | null
  tabId: string | null
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

  // Terminal refs for each panel
  const terminalRef0 = useRef<TerminalHandle>(null)
  const terminalRef1 = useRef<TerminalHandle>(null)
  const terminalRefs = [terminalRef0, terminalRef1]

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

  const handleOutput = useCallback((data: string, tabId?: string) => {
    // Route output to correct terminal based on attached tab
    const terminalRef = terminalRefs[activePanel]
    terminalRef.current?.write(data)
  }, [activePanel])

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
  } = useWebSocket({
    onOutput: handleOutput,
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

  const handleSelectAgent = useCallback((agentId: string, panelIndex?: number) => {
    const targetPanel = panelIndex ?? activePanel
    const agent = agents.find(a => a.id === agentId)
    const firstTabId = agent?.tabs?.[0]?.id || null

    setPanels(prev => {
      const newPanels = [...prev] as [PanelState, PanelState]
      newPanels[targetPanel] = { agentId, tabId: firstTabId }
      return newPanels
    })

    if (targetPanel === activePanel) {
      const terminalRef = terminalRefs[activePanel]
      terminalRef.current?.clear()
      attach(agentId, firstTabId || undefined)
      setTimeout(() => terminalRef.current?.focus(), 100)
    }
  }, [agents, activePanel, attach])

  const handleSelectTab = useCallback((tabId: string) => {
    const panel = panels[activePanel]
    if (!panel.agentId) return

    setPanels(prev => {
      const newPanels = [...prev] as [PanelState, PanelState]
      newPanels[activePanel] = { ...newPanels[activePanel], tabId }
      return newPanels
    })

    const terminalRef = terminalRefs[activePanel]
    terminalRef.current?.clear()
    attach(panel.agentId, tabId)
    setTimeout(() => terminalRef.current?.focus(), 100)
  }, [panels, activePanel, attach])

  const handleCreateTab = useCallback(() => {
    const panel = panels[activePanel]
    if (panel.agentId) {
      createTab(panel.agentId)
    }
  }, [panels, activePanel, createTab])

  const handleCloseTab = useCallback((tabId: string) => {
    const panel = panels[activePanel]
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
      if (panel.agentId) {
        attach(panel.agentId, panel.tabId || undefined)
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
            handleSelectTab(tabId)
          }}
          onCreateTab={handleCreateTab}
          onCloseTab={handleCloseTab}
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
