import { useRef, useCallback, useState, useEffect } from 'react'
import styles from './SplitPane.module.css'

interface SplitPaneProps {
  direction: 'horizontal' | 'vertical'
  children: [React.ReactNode, React.ReactNode]
  defaultRatio?: number
  minSize?: number
}

export default function SplitPane({
  direction,
  children,
  defaultRatio = 0.5,
  minSize = 100,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState(defaultRatio)
  const [isDragging, setIsDragging] = useState(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return

      const rect = containerRef.current.getBoundingClientRect()
      let newRatio: number

      if (direction === 'horizontal') {
        const x = e.clientX - rect.left
        newRatio = x / rect.width
      } else {
        const y = e.clientY - rect.top
        newRatio = y / rect.height
      }

      // Clamp ratio to ensure minimum size
      const minRatio = minSize / (direction === 'horizontal' ? rect.width : rect.height)
      const maxRatio = 1 - minRatio
      newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio))

      setRatio(newRatio)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, direction, minSize])

  const isHorizontal = direction === 'horizontal'

  return (
    <div
      ref={containerRef}
      className={`${styles.splitPane} ${isHorizontal ? styles.horizontal : styles.vertical}`}
    >
      <div
        className={styles.pane}
        style={isHorizontal ? { width: `${ratio * 100}%` } : { height: `${ratio * 100}%` }}
      >
        {children[0]}
      </div>
      <div
        className={`${styles.divider} ${isDragging ? styles.dragging : ''}`}
        onMouseDown={handleMouseDown}
      >
        <div className={styles.dividerHandle} />
      </div>
      <div className={styles.pane} style={{ flex: 1 }}>
        {children[1]}
      </div>
      {isDragging && <div className={styles.dragOverlay} />}
    </div>
  )
}
