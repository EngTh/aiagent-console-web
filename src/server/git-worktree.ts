import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'

const execAsync = promisify(exec)

export interface WorktreeInfo {
  worktreePath: string
  branch: string
}

export interface MergeResult {
  success: boolean
  message: string
  branch: string
  targetBranch: string
  conflicts?: string[]
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

  /**
   * Try to merge the worktree branch into the target branch (main/master) in the source repo
   * If merge fails due to conflicts, leaves the branch for manual merge
   */
  async tryLocalMerge(
    worktreePath: string,
    targetBranch?: string
  ): Promise<MergeResult> {
    // Get current branch name
    const { stdout: branchName } = await execAsync('git branch --show-current', {
      cwd: worktreePath,
    })
    const branch = branchName.trim()

    // Get the source repo path (parent of worktree)
    const { stdout: topLevel } = await execAsync('git rev-parse --show-toplevel', {
      cwd: worktreePath,
    })
    const worktreeRoot = topLevel.trim()

    // Get the main worktree (source repo) path
    const { stdout: worktreeList } = await execAsync('git worktree list --porcelain', {
      cwd: worktreePath,
    })

    // Find the main worktree path (first one listed)
    const lines = worktreeList.split('\n')
    let sourceRepoPath = ''
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        sourceRepoPath = line.replace('worktree ', '')
        break
      }
    }

    if (!sourceRepoPath) {
      throw new Error('Could not find source repository path')
    }

    // Detect default branch if not specified
    if (!targetBranch) {
      try {
        const { stdout: defaultBranch } = await execAsync(
          'git symbolic-ref refs/remotes/origin/HEAD',
          { cwd: sourceRepoPath }
        )
        targetBranch = defaultBranch.trim().replace('refs/remotes/origin/', '')
      } catch {
        // Try common branch names
        for (const tryBranch of ['main', 'master']) {
          try {
            await execAsync(`git show-ref --verify --quiet refs/heads/${tryBranch}`, {
              cwd: sourceRepoPath,
            })
            targetBranch = tryBranch
            break
          } catch {
            continue
          }
        }
      }
    }

    if (!targetBranch) {
      throw new Error('Could not determine target branch for merge')
    }

    // First, commit any uncommitted changes in the worktree
    try {
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: worktreePath,
      })
      if (status.trim()) {
        await execAsync('git add -A', { cwd: worktreePath })
        await execAsync('git commit -m "Auto-commit before merge"', { cwd: worktreePath })
      }
    } catch {
      // Ignore commit errors (might be nothing to commit)
    }

    // Switch to target branch in source repo
    const currentBranchBackup = await execAsync('git branch --show-current', {
      cwd: sourceRepoPath,
    })
    const originalBranch = currentBranchBackup.stdout.trim()

    try {
      // Checkout target branch
      await execAsync(`git checkout "${targetBranch}"`, { cwd: sourceRepoPath })

      // Try to merge
      try {
        await execAsync(`git merge "${branch}" --no-edit`, { cwd: sourceRepoPath })

        return {
          success: true,
          message: `Successfully merged '${branch}' into '${targetBranch}'`,
          branch,
          targetBranch,
        }
      } catch (mergeError) {
        // Merge failed - get conflict files
        const { stdout: conflictFiles } = await execAsync(
          'git diff --name-only --diff-filter=U',
          { cwd: sourceRepoPath }
        )
        const conflicts = conflictFiles.trim().split('\n').filter(Boolean)

        // Abort the merge
        await execAsync('git merge --abort', { cwd: sourceRepoPath })

        // Restore original branch
        if (originalBranch) {
          await execAsync(`git checkout "${originalBranch}"`, { cwd: sourceRepoPath })
        }

        return {
          success: false,
          message: `Merge failed due to conflicts. Branch '${branch}' is ready for manual merge into '${targetBranch}'`,
          branch,
          targetBranch,
          conflicts,
        }
      }
    } catch (error) {
      // Restore original branch on any error
      if (originalBranch) {
        try {
          await execAsync(`git checkout "${originalBranch}"`, { cwd: sourceRepoPath })
        } catch {
          // Ignore
        }
      }
      throw error
    }
  }
}
