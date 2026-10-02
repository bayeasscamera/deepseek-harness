import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createIsolatedWorkspace,
  removeIsolatedWorkspace,
  type IsolationCommandOutcome,
} from '../src/branch-workspace.ts'

const temporaryRoots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-branch-isolation-test-'))
  temporaryRoots.push(root)
  return root
}

function ok(stdout = ''): IsolationCommandOutcome {
  return { status: 0, stdout, stderr: '' }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('branch isolation', () => {
  it('copies a plain directory without dependencies or history and leaves the source alone', () => {
    const root = temporaryRoot()
    const source = join(root, 'project')
    mkdirSync(join(source, 'src'), { recursive: true })
    mkdirSync(join(source, 'node_modules'), { recursive: true })
    mkdirSync(join(source, '.git'), { recursive: true })
    writeFileSync(join(source, 'src', 'app.ts'), 'source body')

    const workspace = createIsolatedWorkspace(source, 'session-abcdefgh', () => ok('false'))

    expect(workspace.kind).toBe('copy')
    expect(readFileSync(join(workspace.path, 'src', 'app.ts'), 'utf8')).toBe('source body')
    expect(existsSync(join(workspace.path, 'node_modules'))).toBe(false)
    expect(existsSync(join(workspace.path, '.git'))).toBe(false)

    writeFileSync(join(workspace.path, 'src', 'app.ts'), 'branch body')
    expect(readFileSync(join(source, 'src', 'app.ts'), 'utf8')).toBe('source body')

    removeIsolatedWorkspace(workspace, () => ok())
    expect(existsSync(workspace.path)).toBe(false)
    expect(readFileSync(join(source, 'src', 'app.ts'), 'utf8')).toBe('source body')
  })

  it('uses a git worktree when the source is inside one', () => {
    const root = temporaryRoot()
    const source = join(root, 'repo')
    mkdirSync(source)
    const commands: string[] = []
    const workspace = createIsolatedWorkspace(source, 'session-abcdefgh', (command, args) => {
      commands.push([command, ...args].join(' '))
      return ok(args[0] === 'rev-parse' ? 'true' : '')
    })

    expect(workspace.kind).toBe('worktree')
    expect(commands[0]).toBe('git rev-parse --is-inside-work-tree')
    expect(commands[1]).toContain('git worktree add -b dsh-branch-abcdefgh')
    expect(workspace.path.endsWith('-branch-abcdefgh')).toBe(true)
  })

  it('fails closed when the worktree cannot be created', () => {
    const root = temporaryRoot()
    const source = join(root, 'repo')
    mkdirSync(source)
    expect(() => createIsolatedWorkspace(source, 'session-abcdefgh', (_command, args) => (
      args[0] === 'rev-parse' ? ok('true') : { status: 128, stdout: '', stderr: 'already checked out' }
    ))).toThrow(/git worktree add failed: already checked out/u)
    expect(existsSync(join(root, 'repo-branch-abcdefgh'))).toBe(false)
  })

  it('refuses a source that is missing or already isolated', () => {
    const root = temporaryRoot()
    expect(() => createIsolatedWorkspace(join(root, 'absent'), 'session-abcdefgh', () => ok()))
      .toThrow(/is not a directory/u)

    const source = join(root, 'project')
    mkdirSync(source)
    mkdirSync(join(root, 'project-branch-abcdefgh'))
    expect(() => createIsolatedWorkspace(source, 'session-abcdefgh', () => ok('false')))
      .toThrow(/already exists/u)
  })
})
