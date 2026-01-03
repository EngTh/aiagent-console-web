import { useState } from 'react'
import styles from './CreateAgentDialog.module.css'

interface CreateAgentDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (name: string, sourceRepo: string) => Promise<void>
}

export default function CreateAgentDialog({
  isOpen,
  onClose,
  onCreate,
}: CreateAgentDialogProps) {
  const [name, setName] = useState('')
  const [sourceRepo, setSourceRepo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await onCreate(name.trim(), sourceRepo.trim())
      setName('')
      setSourceRepo('')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setName('')
      setSourceRepo('')
      setError(null)
      onClose()
    }
  }

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Create New Agent</h2>
          <button className={styles.closeButton} onClick={handleClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="name">
              Agent Name
            </label>
            <input
              id="name"
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-feature-agent"
              required
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="sourceRepo">
              Source Repository Path
            </label>
            <input
              id="sourceRepo"
              type="text"
              className={styles.input}
              value={sourceRepo}
              onChange={(e) => setSourceRepo(e.target.value)}
              placeholder="/path/to/your/git/repo"
              required
            />
            <p className={styles.hint}>
              The git repository to create a worktree from. A new branch will be
              created for this agent.
            </p>
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
              disabled={loading || !name.trim() || !sourceRepo.trim()}
            >
              {loading ? 'Creating...' : 'Create Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
