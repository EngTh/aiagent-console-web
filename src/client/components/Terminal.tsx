import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
}

export interface TerminalHandle {
  write: (data: string) => void
  clear: () => void
  focus: () => void
}

const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ onInput, onResize }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const terminalRef = useRef<XTerm | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        terminalRef.current?.write(data)
      },
      clear: () => {
        terminalRef.current?.clear()
      },
      focus: () => {
        terminalRef.current?.focus()
      },
    }))

    useEffect(() => {
      if (!containerRef.current) return

      const terminal = new XTerm({
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        lineHeight: 1.2,
        theme: {
          background: '#1a1b26',
          foreground: '#c0caf5',
          cursor: '#c0caf5',
          cursorAccent: '#1a1b26',
          selectionBackground: '#33467c',
          selectionForeground: '#c0caf5',
          black: '#15161e',
          red: '#f7768e',
          green: '#9ece6a',
          yellow: '#e0af68',
          blue: '#7aa2f7',
          magenta: '#bb9af7',
          cyan: '#7dcfff',
          white: '#a9b1d6',
          brightBlack: '#414868',
          brightRed: '#f7768e',
          brightGreen: '#9ece6a',
          brightYellow: '#e0af68',
          brightBlue: '#7aa2f7',
          brightMagenta: '#bb9af7',
          brightCyan: '#7dcfff',
          brightWhite: '#c0caf5',
        },
        allowProposedApi: true,
      })

      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.loadAddon(new WebLinksAddon())

      // Try to load WebGL addon for better performance
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          webglAddon.dispose()
        })
        terminal.loadAddon(webglAddon)
      } catch (e) {
        console.warn('WebGL addon not available, using canvas renderer')
      }

      terminal.open(containerRef.current)
      fitAddon.fit()

      // Handle input
      terminal.onData((data) => {
        onInput(data)
      })

      // Handle resize
      const handleResize = () => {
        fitAddon.fit()
        onResize(terminal.cols, terminal.rows)
      }

      window.addEventListener('resize', handleResize)

      // Initial resize notification
      setTimeout(() => {
        fitAddon.fit()
        onResize(terminal.cols, terminal.rows)
      }, 100)

      terminalRef.current = terminal
      fitAddonRef.current = fitAddon

      return () => {
        window.removeEventListener('resize', handleResize)
        terminal.dispose()
      }
    }, [onInput, onResize])

    // Re-fit when container size changes
    useEffect(() => {
      const observer = new ResizeObserver(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit()
          onResize(terminalRef.current.cols, terminalRef.current.rows)
        }
      })

      if (containerRef.current) {
        observer.observe(containerRef.current)
      }

      return () => {
        observer.disconnect()
      }
    }, [onResize])

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          padding: '8px',
          background: '#1a1b26',
        }}
      />
    )
  }
)

Terminal.displayName = 'Terminal'

export default Terminal
