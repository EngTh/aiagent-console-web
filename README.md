# AI Agent Console Web

一个基于 Web 的 AI Agent 多路复用控制台，支持同时管理多个 Agent 实例，每个 Agent 运行在独立的 Git Worktree 中，最终通过 PR 合并代码。

## 功能特性

- **多 Agent 管理** - 同时运行多个 AI Agent，互不干扰
- **Git Worktree 隔离** - 每个 Agent 自动创建独立分支和工作目录
- **现代化终端** - 基于 xterm.js + WebGL 渲染，支持真彩色、连字等
- **实时通信** - WebSocket + PTY，流畅的终端交互体验
- **PR 工作流** - 一键创建 Pull Request，轻松合并 Agent 的工作成果

## 架构

```
┌──────────────────────────────────────────────────────────┐
│                      Browser                              │
│  ┌─────────────┐  ┌────────────────────────────────────┐ │
│  │ Agent List  │  │         Terminal (xterm.js)        │ │
│  │ ─────────── │  │  $ claude                          │ │
│  │ ● Agent 1   │  │  > I'll help you implement...      │ │
│  │ ○ Agent 2   │  │  > ...                             │ │
│  │ + New Agent │  │                                    │ │
│  └─────────────┘  └────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
                           │ WebSocket
                           ▼
┌──────────────────────────────────────────────────────────┐
│                   Node.js Server                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Agent       │  │ PTY         │  │ Git Worktree    │  │
│  │ Manager     │  │ Manager     │  │ Manager         │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                   File System                             │
│  ~/.aiagent-console/worktrees/                           │
│  ├── agent-abc123/  (branch: agent/abc123)               │
│  ├── agent-def456/  (branch: agent/def456)               │
│  └── ...                                                  │
└──────────────────────────────────────────────────────────┘
```

## 快速开始

### 环境要求

- Node.js 18+
- Git
- GitHub CLI (`gh`) - 用于创建 PR

### 安装

```bash
# 克隆仓库
git clone <repo-url>
cd aiagent-console-web

# 安装依赖
npm install
```

### 开发模式

```bash
npm run dev
```

访问 http://localhost:5173

### 配置

复制配置模板并根据需要修改：

```bash
cp config.example.json config.json
```

```json
{
  "port": 17930,     // 后端服务端口
  "vitePort": 5173   // 开发模式下 Vite 端口
}
```

### 生产部署

```bash
# 构建
npm run build

# 前台启动
npm start

# 或后台启动 (需要 pm2)
npm run start:bg
```

服务运行在 http://localhost:17930

### 后台运行 (PM2)

安装 PM2：

```bash
npm install -g pm2
```

常用命令：

| 命令 | 说明 |
|------|------|
| `npm run start:bg` | 后台启动服务 |
| `npm run stop` | 停止服务 |
| `npm run restart` | 重启服务 |
| `npm run logs` | 查看日志 |
| `npm run status` | 查看运行状态 |

## 使用指南

### 创建 Agent

1. 点击侧边栏的 **+** 按钮
2. 输入 Agent 名称（如 `feature-auth`）
3. 输入源仓库路径（如 `/home/user/my-project`）
4. 点击 **Create Agent**

系统会自动：
- 创建新分支 `agent/<id>`
- 在 `~/.aiagent-console/worktrees/` 下创建 worktree
- 启动一个 shell 终端

### 使用终端

- 点击侧边栏的 Agent 切换终端
- 在终端中运行任何命令，如 `claude` 启动 AI 助手
- 支持所有终端特性：颜色、光标移动、滚动等

### 多客户端支持

支持多个浏览器窗口同时连接查看同一个 Agent：

- **第一个连接**的客户端自动获得控制权，可以输入
- **后续连接**的客户端为 **View Only** 模式，只能查看
- View Only 客户端可以点击 **Gain Control** 按钮获取控制权
- 同一时间只有一个客户端可以输入，避免冲突

### 创建 PR

1. 右键点击 Agent
2. 选择 **Create PR**
3. 填写 PR 标题和描述
4. 点击 **Create PR**

### 删除 Agent

1. 右键点击 Agent
2. 选择 **Delete**
3. 确认删除

这会清理 worktree 和相关资源。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 |
| 终端渲染 | xterm.js + WebGL Addon |
| 构建工具 | Vite |
| 后端框架 | Express |
| 实时通信 | WebSocket (ws) |
| 终端模拟 | node-pty |
| 语言 | TypeScript |

## 项目结构

```
src/
├── client/                 # 前端代码
│   ├── components/
│   │   ├── Terminal.tsx    # 终端组件
│   │   ├── Sidebar.tsx     # 侧边栏
│   │   ├── CreateAgentDialog.tsx
│   │   └── CreatePRDialog.tsx
│   ├── hooks/
│   │   ├── useWebSocket.ts # WebSocket hook
│   │   └── useAgents.ts    # Agent API hook
│   ├── styles/
│   │   └── global.css
│   ├── App.tsx
│   └── main.tsx
├── server/                 # 后端代码
│   ├── index.ts            # 服务入口
│   ├── agent-manager.ts    # Agent 管理
│   ├── git-worktree.ts     # Git Worktree 操作
│   └── ws-handler.ts       # WebSocket 处理
└── shared/
    └── types.ts            # 共享类型
```

## API

### REST API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/agents` | 获取所有 Agent |
| POST | `/api/agents` | 创建 Agent |
| DELETE | `/api/agents/:id` | 删除 Agent |
| GET | `/api/agents/:id/status` | 获取 Git 状态 |
| GET | `/api/agents/:id/diff` | 获取 Git diff |
| POST | `/api/agents/:id/pr` | 创建 PR |

### WebSocket 消息

**客户端 → 服务端：**
- `attach` - 连接到 Agent 终端
- `detach` - 断开连接
- `input` - 发送键盘输入
- `resize` - 调整终端大小
- `gain-control` - 请求获取控制权

**服务端 → 客户端：**
- `output` - 终端输出
- `attached` / `detached` - 连接状态（包含 hasControl）
- `agent-status` - Agent 状态变化
- `agents-updated` - Agent 列表更新
- `control-changed` - 控制权变化通知

## License

MIT
