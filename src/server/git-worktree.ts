import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'

const execAsync = promisify(exec)

export interface WorktreeInfo {
  worktreePath: string
  branch: string
}

export class GitWorktreeManager {
  private baseWorkDir: string

  constructor(baseWorkDir: string) {
    this.baseWorkDir = baseWorkDir
  }

  async ensureBaseDir(): Promise<void> {
    await fs.mkdir(this.baseWorkDir, { recursive: true })
  }

  /**
   * Create a new worktree from a source repository
   */
  async createWorktree(
    sourceRepo: string,
    agentId: string,
    branchName: string
  ): Promise<WorktreeInfo> {
    await this.ensureBaseDir()

    const worktreePath = path.join(this.baseWorkDir, agentId)

    // Check if source repo exists and is a git repo
    try {
      await execAsync('git rev-parse --git-dir', { cwd: sourceRepo })
    } catch {
      throw new Error(`Source path is not a git repository: ${sourceRepo}`)
    }

    // Get the absolute path of the git dir
    const { stdout: gitDir } = await execAsync('git rev-parse --git-dir', {
      cwd: sourceRepo,
    })
    const absoluteGitDir = path.resolve(sourceRepo, gitDir.trim())
    const repoRoot = path.dirname(
      absoluteGitDir.endsWith('.git')
        ? absoluteGitDir
        : path.dirname(absoluteGitDir)
    )

    // Check if branch already exists
    try {
      await execAsync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
        cwd: sourceRepo,
      })
      // Branch exists, create worktree without -b flag
      await execAsync(`git worktree add "${worktreePath}" "${branchName}"`, {
        cwd: sourceRepo,
      })
    } catch {
      // Branch doesn't exist, create new branch
      await execAsync(`git worktree add -b "${branchName}" "${worktreePath}"`, {
        cwd: sourceRepo,
      })
    }

    return {
      worktreePath,
      branch: branchName,
    }
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(sourceRepo: string, agentId: string): Promise<void> {
    const worktreePath = path.join(this.baseWorkDir, agentId)

    try {
      // Force remove worktree
      await execAsync(`git worktree remove --force "${worktreePath}"`, {
        cwd: sourceRepo,
      })
    } catch (error) {
      // If git worktree remove fails, try manual cleanup
      console.error('Failed to remove worktree via git, trying manual cleanup:', error)
      try {
        await fs.rm(worktreePath, { recursive: true, force: true })
        await execAsync('git worktree prune', { cwd: sourceRepo })
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Create a PR from the worktree branch
   */
  async createPullRequest(
    worktreePath: string,
    title: string,
    body: string
  ): Promise<{ prUrl: string }> {
    // First, push the branch
    const { stdout: branchName } = await execAsync('git branch --show-current', {
      cwd: worktreePath,
    })
    const branch = branchName.trim()

    await execAsync(`git push -u origin "${branch}"`, {
      cwd: worktreePath,
    })

    // Create PR using gh CLI
    const { stdout } = await execAsync(
      `gh pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`,
      { cwd: worktreePath }
    )

    const prUrl = stdout.trim()
    return { prUrl }
  }

  /**
   * Get current git status of a worktree
   */
  async getStatus(worktreePath: string): Promise<string> {
    const { stdout } = await execAsync('git status --short', {
      cwd: worktreePath,
    })
    return stdout
  }

  /**
   * Get diff of a worktree
   */
  async getDiff(worktreePath: string): Promise<string> {
    const { stdout } = await execAsync('git diff', {
      cwd: worktreePath,
    })
    return stdout
  }
}
