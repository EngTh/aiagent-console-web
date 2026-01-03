import { useState } from 'react'
import styles from './CreateAgentDialog.module.css'

interface CreatePRDialogProps {
  isOpen: boolean
  agentName: string
  onClose: () => void
  onCreate: (title: string, body: string) => Promise<void>
}

export default function CreatePRDialog({
  isOpen,
  agentName,
  onClose,
  onCreate,
}: CreatePRDialogProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await onCreate(title.trim(), body.trim())
      setTitle('')
      setBody('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create PR')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setTitle('')
      setBody('')
      setError(null)
      onClose()
    }
  }

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Create Pull Request</h2>
          <button className={styles.closeButton} onClick={handleClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>Agent</label>
            <div style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
              {agentName}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="prTitle">
              PR Title
            </label>
            <input
              id="prTitle"
              type="text"
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add new feature..."
              required
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="prBody">
              Description
            </label>
            <textarea
              id="prBody"
              className={styles.input}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your changes..."
              rows={5}
              style={{ resize: 'vertical' }}
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.createButton}
              disabled={loading || !title.trim()}
            >
              {loading ? 'Creating...' : 'Create PR'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
