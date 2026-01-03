import { useState, useEffect } from 'react'
import styles from './CreateAgentDialog.module.css'

interface Settings {
  logDir: string
  logEnabled: boolean
}

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [logDir, setLogDir] = useState('')
  const [logEnabled, setLogEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchSettings()
    }
  }, [isOpen])

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (!response.ok) throw new Error('Failed to fetch settings')
      const data: Settings = await response.json()
      setLogDir(data.logDir || '')
      setLogEnabled(data.logEnabled || false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    }
  }

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    setLoading(true)

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logDir, logEnabled }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save settings')
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setError(null)
      setSuccess(false)
      onClose()
    }
  }

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className={styles.closeButton} onClick={handleClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={logEnabled}
                onChange={(e) => setLogEnabled(e.target.checked)}
              />
              <span>Enable Terminal Logging</span>
            </label>
            <p className={styles.hint}>
              Save all terminal output to log files.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="logDir">
              Log Directory
            </label>
            <input
              id="logDir"
              type="text"
              className={styles.input}
              value={logDir}
              onChange={(e) => setLogDir(e.target.value)}
              placeholder="/path/to/logs"
              disabled={!logEnabled}
            />
            <p className={styles.hint}>
              Logs will be saved as: logDir/YYYY-MM/DD/HHMMSS_agentName_path.log
            </p>
          </div>

          {error && <div className={styles.error}>{error}</div>}
          {success && <div className={styles.success}>Settings saved!</div>}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleClose}
              disabled={loading}
            >
              Close
            </button>
            <button
              type="submit"
              className={styles.createButton}
              disabled={loading || (logEnabled && !logDir.trim())}
            >
              {loading ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
