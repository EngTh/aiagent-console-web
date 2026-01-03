import type { TabInfo } from '../../shared/types'
import styles from './TabBar.module.css'

interface TabBarProps {
  tabs: TabInfo[]
  activeTabId: string | null
  onSelectTab: (tabId: string) => void
  onCreateTab: () => void
  onCloseTab: (tabId: string) => void
}

export default function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCreateTab,
  onCloseTab,
}: TabBarProps) {
  const getStatusColor = (status: TabInfo['status']) => {
    switch (status) {
      case 'running':
        return 'var(--success)'
      case 'stopped':
        return 'var(--danger)'
      default:
        return 'var(--text-muted)'
    }
  }

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabList}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`${styles.tab} ${activeTabId === tab.id ? styles.active : ''}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <span
              className={styles.statusDot}
              style={{ background: getStatusColor(tab.status) }}
            />
            <span className={styles.tabName}>{tab.name}</span>
            {tabs.length > 1 && (
              <button
                className={styles.closeBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                title="Close tab"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <button className={styles.addBtn} onClick={onCreateTab} title="New tab">
        +
      </button>
    </div>
  )
}
