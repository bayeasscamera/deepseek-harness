/** Create and remove the isolated working copy a branch can run in. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Directory names a copy skips: dependencies, history, and build residue. */
const COPY_EXCLUSIONS = new Set([
  '.cache', '.git', '.next', '.turbo', '.venv', 'build', 'dist', 'node_modules',
])

/** One prepared branch working copy. */
export interface IsolatedWorkspace {
  /** Absolute working directory the child session runs in. */
  readonly path: string
  /** How the copy was produced, which decides how it is removed. */
  readonly kind: 'worktree' | 'copy'
}

/**
 * Run one command and return its outcome.
 * @param command - Absolute executable path.
 * @param args - Command arguments.
 * @param cwd - Working directory for the command.
 * @returns Exit status and diagnostics.
 */
export interface IsolationCommandOutcome {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

/** Runner used by focused tests to replace the host process. */
export type IsolationCommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => IsolationCommandOutcome

/**
 * Execute one command through the host process.
 * @param command - Absolute executable path.
 * @param args - Command arguments.
 * @param cwd - Working directory for the command.
 * @returns Exit status and diagnostics.
 */
function runProcess(command: string, args: readonly string[], cwd: string): IsolationCommandOutcome {
  const result = spawnSync(command, [...args], { cwd, encoding: 'utf8' })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

/**
 * Create an isolated working copy of one session's directory.
 *
 * A Git work tree gets its own `git worktree` on a branch named for the child,
 * so the two sessions share history but not a checked-out tree. Any other
 * directory is copied without dependencies, history, or build residue. Every
 * failure throws: the caller must not create a branch whose files it could not
 * isolate, and a half-created copy is removed before the error propagates.
 * @param sourceCwd - Absolute working directory of the source session.
 * @param childSessionId - Session id the copy is named for.
 * @param run - Command runner, replaced by focused tests.
 * @returns The prepared copy.
 */
export function createIsolatedWorkspace(
  sourceCwd: string,
  childSessionId: string,
  run: IsolationCommandRunner = runProcess,
): IsolatedWorkspace {
  if (!existsSync(sourceCwd) || !statSync(sourceCwd).isDirectory()) {
    throw new Error(`branch isolation: "${sourceCwd}" is not a directory`)
  }
  const suffix = childSessionId.slice(-8)
  const target = join(sourceCwd, '..', `${basenameOf(sourceCwd)}-branch-${suffix}`)
  if (existsSync(target)) throw new Error(`branch isolation: "${target}" already exists`)
  const insideWorkTree = run('git', ['rev-parse', '--is-inside-work-tree'], sourceCwd)
  if (insideWorkTree.status === 0 && insideWorkTree.stdout.trim() === 'true') {
    const added = run('git', ['worktree', 'add', '-b', `dsh-branch-${suffix}`, target], sourceCwd)
    if (added.status !== 0) {
      throw new Error(`branch isolation: git worktree add failed: ${`${added.stdout}${added.stderr}`.trim()}`)
    }
    return { path: target, kind: 'worktree' }
  }
  try {
    cpSync(sourceCwd, target, {
      recursive: true,
      filter: source => !COPY_EXCLUSIONS.has(basenameOf(source)),
    })
  } catch (error) {
    rmSync(target, { recursive: true, force: true })
    throw error
  }
  return { path: target, kind: 'copy' }
}

/**
 * Remove one prepared copy, leaving the source directory untouched.
 * @param workspace - Copy returned by {@link createIsolatedWorkspace}.
 * @param run - Command runner, replaced by focused tests.
 * @returns Nothing; a removal failure is swallowed because the branch is already gone.
 */
export function removeIsolatedWorkspace(
  workspace: IsolatedWorkspace,
  run: IsolationCommandRunner = runProcess,
): void {
  if (workspace.kind === 'worktree') {
    run('git', ['worktree', 'remove', '--force', workspace.path], workspace.path)
    if (existsSync(workspace.path)) rmSync(workspace.path, { recursive: true, force: true })
    return
  }
  rmSync(workspace.path, { recursive: true, force: true })
}

/**
 * Read the final path segment of one path without importing a path dialect.
 * @param path - Absolute path.
 * @returns Last segment, or the path itself when it has none.
 */
function basenameOf(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const separator = trimmed.lastIndexOf('/')
  return separator === -1 ? trimmed : trimmed.slice(separator + 1)
}
