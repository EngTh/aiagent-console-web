import { useState } from 'react'
import type { Agent } from '../../shared/types'
import styles from './Sidebar.module.css'

interface SidebarProps {
  agents: Agent[]
  selectedAgentId: string | null
  onSelectAgent: (agentId: string) => void
  onCreateAgent: () => void
  onDeleteAgent: (agentId: string) => void
  onCreatePR: (agentId: string) => void
  onMerge: (agentId: string) => void
  onOpenSettings: () => void
}

export default function Sidebar({
  agents,
  selectedAgentId,
  onSelectAgent,
  onCreateAgent,
  onDeleteAgent,
  onCreatePR,
  onMerge,
  onOpenSettings,
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    agentId: string
    x: number
    y: number
  } | null>(null)

  const handleContextMenu = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault()
    setContextMenu({ agentId, x: e.clientX, y: e.clientY })
  }

  const closeContextMenu = () => setContextMenu(null)

  const getStatusColor = (status: Agent['status']) => {
    switch (status) {
      case 'running':
        return 'var(--success)'
      case 'stopped':
        return 'var(--danger)'
      default:
        return 'var(--text-muted)'
    }
  }

  const getStatusIcon = (status: Agent['status']) => {
    switch (status) {
      case 'running':
        return '●'
      case 'stopped':
        return '○'
      default:
        return '◌'
    }
  }

  return (
    <div className={styles.sidebar} onClick={closeContextMenu}>
      <div className={styles.header}>
        <h1 className={styles.title}>AI Agents</h1>
        <button className={styles.addButton} onClick={onCreateAgent} title="Create new agent">
          +
        </button>
      </div>

      <div className={styles.agentList}>
        {agents.length === 0 ? (
          <div className={styles.emptyState}>
            No agents yet.
            <br />
            Click + to create one.
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.id}
              className={`${styles.agentItem} ${
                selectedAgentId === agent.id ? styles.selected : ''
              }`}
              onClick={() => onSelectAgent(agent.id)}
              onContextMenu={(e) => handleContextMenu(e, agent.id)}
            >
              <span
                className={styles.statusIndicator}
                style={{ color: getStatusColor(agent.status) }}
              >
                {getStatusIcon(agent.status)}
              </span>
              <div className={styles.agentInfo}>
                <div className={styles.agentName}>{agent.name}</div>
                <div className={styles.agentBranch}>{agent.branch}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className={styles.footer}>
        <button className={styles.settingsButton} onClick={onOpenSettings} title="Settings">
          ⚙
        </button>
      </div>

      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              onMerge(contextMenu.agentId)
              closeContextMenu()
            }}
          >
            Merge to Main
          </button>
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              onCreatePR(contextMenu.agentId)
              closeContextMenu()
            }}
          >
            Create PR (GitHub)
          </button>
          <button
            className={`${styles.contextMenuItem} ${styles.danger}`}
            onClick={() => {
              onDeleteAgent(contextMenu.agentId)
              closeContextMenu()
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
