import { useState, useEffect } from 'react'
import styles from './CreateAgentDialog.module.css'

interface Settings {
  logDir: string
  logEnabled: boolean
}

interface TerminalSettings {
  fontFamily: string
  fontSize: number
}

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  onTerminalSettingsChange?: (settings: TerminalSettings) => void
}

const FONT_OPTIONS = [
  '"Maple Mono NF CN", monospace',
  'JetBrains Mono, monospace',
  'Fira Code, monospace',
  'Menlo, Monaco, "Courier New", monospace',
  'Source Code Pro, monospace',
  'Cascadia Code, monospace',
  'SF Mono, monospace',
  'Consolas, monospace',
]

export default function SettingsDialog({
  isOpen,
  onClose,
  onTerminalSettingsChange,
}: SettingsDialogProps) {
  const [logDir, setLogDir] = useState('')
  const [logEnabled, setLogEnabled] = useState(false)
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0])
  const [fontSize, setFontSize] = useState(14)
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
      const [settingsRes, terminalRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/terminal-settings'),
      ])

      if (settingsRes.ok) {
        const data: Settings = await settingsRes.json()
        setLogDir(data.logDir || '')
        setLogEnabled(data.logEnabled || false)
      }

      if (terminalRes.ok) {
        const data: TerminalSettings = await terminalRes.json()
        setFontFamily(data.fontFamily || FONT_OPTIONS[0])
        setFontSize(data.fontSize || 14)
      }
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
      const [settingsRes, terminalRes] = await Promise.all([
        fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ logDir, logEnabled }),
        }),
        fetch('/api/terminal-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fontFamily, fontSize }),
        }),
      ])

      if (!settingsRes.ok) {
        const data = await settingsRes.json()
        throw new Error(data.error || 'Failed to save settings')
      }

      if (!terminalRes.ok) {
        const data = await terminalRes.json()
        throw new Error(data.error || 'Failed to save terminal settings')
      }

      // Notify parent of terminal settings change
      onTerminalSettingsChange?.({ fontFamily, fontSize })

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
          <div className={styles.sectionTitle}>Terminal</div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="fontFamily">
              Font Family
            </label>
            <select
              id="fontFamily"
              className={styles.select}
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font} value={font}>
                  {font.split(',')[0].replace(/"/g, '')}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="fontSize">
              Font Size
            </label>
            <input
              id="fontSize"
              type="number"
              className={styles.input}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              min={10}
              max={24}
            />
          </div>

          <div className={styles.sectionTitle}>Logging</div>

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
