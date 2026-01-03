import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { AgentManager } from './agent-manager.js'
import { WSHandler } from './ws-handler.js'
import { loadConfig } from '../shared/config.js'
import { addRecentRepo, getRecentRepos, getTerminalSettings, updateTerminalSettings } from './local-config.js'
import type { CreateAgentRequest } from '../shared/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const config = loadConfig()

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const agentManager = new AgentManager(config)

// Middleware
app.use(express.json())

// Serve static files (skip only in dev mode with vite)
if (process.env.NODE_ENV !== 'development') {
  app.use(express.static(path.join(__dirname, '../client')))
}

// API Routes

// List all agents
app.get('/api/agents', (_req, res) => {
  res.json({ agents: agentManager.getAgents() })
})

// Get single agent
app.get('/api/agents/:id', (req, res) => {
  const agent = agentManager.getAgent(req.params.id)
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' })
  }
  res.json(agent)
})

// Create agent
app.post('/api/agents', async (req, res) => {
  try {
    const { name, sourceRepo } = req.body as CreateAgentRequest
    if (!name || !sourceRepo) {
      return res.status(400).json({ error: 'name and sourceRepo are required' })
    }

    const agent = await agentManager.createAgent(name, sourceRepo)

    // Save to recent repos
    addRecentRepo(sourceRepo)

    res.status(201).json(agent)
  } catch (error) {
    console.error('Failed to create agent:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create agent',
    })
  }
})

// Delete agent
app.delete('/api/agents/:id', async (req, res) => {
  try {
    await agentManager.deleteAgent(req.params.id)
    res.status(204).send()
  } catch (error) {
    console.error('Failed to delete agent:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to delete agent',
    })
  }
})

// Get git status for an agent
app.get('/api/agents/:id/status', async (req, res) => {
  try {
    const status = await agentManager.getGitStatus(req.params.id)
    res.json({ status })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get status',
    })
  }
})

// Get git diff for an agent
app.get('/api/agents/:id/diff', async (req, res) => {
  try {
    const diff = await agentManager.getGitDiff(req.params.id)
    res.json({ diff })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get diff',
    })
  }
})

// Create PR for an agent
app.post('/api/agents/:id/pr', async (req, res) => {
  try {
    const { title, body } = req.body
    if (!title) {
      return res.status(400).json({ error: 'title is required' })
    }

    const result = await agentManager.createPR(
      req.params.id,
      title,
      body || ''
    )
    res.json(result)
  } catch (error) {
    console.error('Failed to create PR:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create PR',
    })
  }
})

// Try local merge for an agent
app.post('/api/agents/:id/merge', async (req, res) => {
  try {
    const { targetBranch } = req.body
    const result = await agentManager.tryLocalMerge(req.params.id, targetBranch)
    res.json(result)
  } catch (error) {
    console.error('Failed to merge:', error)
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to merge',
    })
  }
})

// Recent repos API
app.get('/api/recent-repos', (_req, res) => {
  res.json({ repos: getRecentRepos() })
})

// Terminal settings API
app.get('/api/terminal-settings', (_req, res) => {
  res.json(getTerminalSettings())
})

app.put('/api/terminal-settings', (req, res) => {
  try {
    const { fontFamily, fontSize } = req.body
    const settings = updateTerminalSettings({ fontFamily, fontSize })
    res.json(settings)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update terminal settings',
    })
  }
})

// Settings API
app.get('/api/settings', (_req, res) => {
  res.json(agentManager.getConfig())
})

app.put('/api/settings', (req, res) => {
  try {
    const { logDir, logEnabled } = req.body
    agentManager.updateConfig({ logDir, logEnabled })
    res.json(agentManager.getConfig())
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update settings',
    })
  }
})

// SPA fallback - serve index.html for all non-API routes
if (process.env.NODE_ENV !== 'development') {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'))
  })
}

// WebSocket connections
wss.on('connection', (ws: WebSocket) => {
  console.log('New WebSocket connection')
  new WSHandler(ws, agentManager)
})

// Graceful shutdown - clean up all PTY processes
function shutdown() {
  console.log('Shutting down...')
  agentManager.shutdown()
  wss.clients.forEach((client) => client.close())
  server.close(() => {
    console.log('Server closed')
    process.exit(0)
  })
  // Force exit after 5 seconds
  setTimeout(() => process.exit(0), 5000)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Start server
const PORT = process.env.PORT || config.port
server.listen(PORT, () => {
  console.log(`AI Agent Console server running at http://localhost:${PORT}`)
})
