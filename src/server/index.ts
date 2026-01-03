import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { AgentManager } from './agent-manager.js'
import { WSHandler } from './ws-handler.js'
import type { CreateAgentRequest } from '../shared/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

const agentManager = new AgentManager()

// Middleware
app.use(express.json())

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
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

// WebSocket connections
wss.on('connection', (ws: WebSocket) => {
  console.log('New WebSocket connection')
  new WSHandler(ws, agentManager)
})

// Start server
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 AI Agent Console server running at http://localhost:${PORT}`)
})
