import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { EnvRuleRegistry, seedBuiltinRules } from '../src/env-rules.ts'
import { StateStore, WORLD_STATE_SCHEMA_VERSION } from '../src/state-store.ts'
import { ConsequenceEngine } from '../src/consequence.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

// ---------------------------------------------------------------------------
// Module 1: Environment Rules & Policy Validation
// ---------------------------------------------------------------------------

describe('EnvRuleRegistry & Policy Validator', () => {
  it('renders only categories that have active rules', () => {
    const registry = new EnvRuleRegistry()
    registry.register({ id: 'capability:solo', category: 'capability', description: 'solo capability', active: true, metadata: {} })
    const text = registry.describeEnvironment()
    expect(text).toContain('capability:solo')
    expect(text).not.toContain('### Constraints')
  })

  it('validates actions with non-string argument values', () => {
    const registry = new EnvRuleRegistry()
    seedBuiltinRules(registry)
    const result = registry.validateAction('write_to_file', { path: 42, CodeContent: true })
    expect(result.allowed).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('registers and lists rules', () => {
    const reg = new EnvRuleRegistry()
    reg.register({
      id: 'test:foo',
      category: 'capability',
      description: 'Test capability',
      active: true,
      metadata: {},
    })
    expect(reg.list()).toHaveLength(1)
    expect(reg.list(true)).toHaveLength(1)
    expect(reg.list()[0]!.id).toBe('test:foo')
  })

  it('disposer removes the rule', () => {
    const reg = new EnvRuleRegistry()
    const dispose = reg.register({
      id: 'test:bar',
      category: 'constraint',
      description: 'Removable',
      active: true,
      metadata: {},
    })
    expect(reg.list()).toHaveLength(1)
    dispose()
    expect(reg.list()).toHaveLength(0)
  })

  it('toggles active state', () => {
    const reg = new EnvRuleRegistry()
    reg.register({
      id: 'test:toggle',
      category: 'permission',
      description: 'Toggleable',
      active: true,
      metadata: {},
    })
    expect(reg.list(true)).toHaveLength(1)
    reg.setActive('test:toggle', false)
    expect(reg.list(true)).toHaveLength(0)
    expect(reg.list()).toHaveLength(1)
  })

  it('ignores setActive for unknown rules', () => {
    const reg = new EnvRuleRegistry()
    expect(() => { reg.setActive('test:missing', false) }).not.toThrow()
    expect(reg.list()).toHaveLength(0)
  })

  it('seeds builtin rules', () => {
    const reg = new EnvRuleRegistry()
    seedBuiltinRules(reg)
    const rules = reg.list(true)
    expect(rules.length).toBeGreaterThanOrEqual(5)
    expect(rules.some(r => r.id === 'constraint:esm-only')).toBe(true)
    expect(rules.some(r => r.id === 'capability:world-model')).toBe(true)
  })

  it('describeEnvironment returns structured text with telemetry', () => {
    const reg = new EnvRuleRegistry()
    seedBuiltinRules(reg)
    const desc = reg.describeEnvironment()
    expect(desc).toContain('## Environment Rules')
    expect(desc).toContain('### Capabilities')
    expect(desc).toContain('### Constraints')
    expect(desc).toContain('### Runtime Telemetry')
  })

  it('describeEnvironment returns empty without active rules', () => {
    const reg = new EnvRuleRegistry()
    expect(reg.describeEnvironment()).toBe('')
  })

  it('collects live runtime telemetry', () => {
    const reg = new EnvRuleRegistry()
    const t = reg.getTelemetry()
    expect(typeof t.platform).toBe('string')
    expect(typeof t.nodeVersion).toBe('string')
    expect(t.cpuCount).toBeGreaterThan(0)
    expect(t.totalMemoryMb).toBeGreaterThan(0)
  })

  it('validates actions against active constraints (blocks secrets)', () => {
    const reg = new EnvRuleRegistry()
    seedBuiltinRules(reg)

    // Attempting to write a secret token
    const result = reg.validateAction('write_to_file', {
      path: 'src/secret.ts',
      CodeContent: 'const key = "sk-abcdef12345678901234567890"',
    })

    expect(result.allowed).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations[0]).toContain('no-credential-commit')
  })

  it('validates write permission disabled', () => {
    const reg = new EnvRuleRegistry()
    seedBuiltinRules(reg)
    reg.setActive('permission:filesystem-write', false)

    const result = reg.validateAction('write_to_file', { path: 'test.txt' })
    expect(result.allowed).toBe(false)
    expect(result.violations[0]).toContain('permission:filesystem-write')
  })

  it('warns when writing a sensitive environment file', () => {
    const reg = new EnvRuleRegistry()
    seedBuiltinRules(reg)

    const result = reg.validateAction('write_to_file', { path: 'config/.env.local', CodeContent: 'SAFE=1' })
    expect(result.allowed).toBe(true)
    expect(result.warnings[0]).toContain('sensitive environment file')
  })

  it('warns when creating a .cjs file under the esm-only constraint', () => {
    const reg = new EnvRuleRegistry()
    seedBuiltinRules(reg)

    const result = reg.validateAction('create_file', { path: 'legacy.cjs' })
    expect(result.allowed).toBe(true)
    expect(result.warnings[0]).toContain('esm-only')
  })

  it('allows safe actions', () => {
    const reg = new EnvRuleRegistry()
    seedBuiltinRules(reg)

    const result = reg.validateAction('view_file', { AbsolutePath: '/tmp/safe.ts' })
    expect(result.allowed).toBe(true)
    expect(result.violations).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('skips credential and esm checks when their constraints are inactive', () => {
    const reg = new EnvRuleRegistry()
    seedBuiltinRules(reg)
    reg.setActive('constraint:no-credential-commit', false)
    reg.setActive('constraint:esm-only', false)

    const secret = reg.validateAction('write_to_file', {
      path: '.env',
      CodeContent: 'sk-abcdef12345678901234567890',
    })
    expect(secret.violations).toHaveLength(0)
    expect(secret.warnings).toHaveLength(0)

    const cjs = reg.validateAction('create_file', { path: 'legacy.cjs' })
    expect(cjs.warnings).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Module 2: Robust State Store (Atomic Writes, Backups, Fail-loud Versions)
// ---------------------------------------------------------------------------

const TEST_CWD = resolve('__test_robust_world_state__')
const STATE_FILE = join(TEST_CWD, '.dsh', 'world-state.json')
const BACKUP_FILE = join(TEST_CWD, '.dsh', 'world-state.json.bak')

describe('StateStore (Robustness & Persistence)', () => {
  beforeEach(() => {
    rmSync(TEST_CWD, { recursive: true, force: true })
    mkdirSync(TEST_CWD, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_CWD, { recursive: true, force: true })
  })

  it('creates initial empty state with the current schema version', () => {
    const store = new StateStore(TEST_CWD)
    const snap = store.snapshot
    expect(snap.version).toBe(WORLD_STATE_SCHEMA_VERSION)
    expect(snap.taskHistory).toEqual([])
    expect(snap.customFacts).toEqual({})
    expect(snap.writeCount).toBe(0)
    expect(store.filePath).toBe(STATE_FILE)
  })

  it('persists atomically and increments write count', () => {
    const store = new StateStore(TEST_CWD)
    store.setFact('language', 'en')
    store.setSession(SessionId('session-alpha'))
    store.flush()

    expect(store.snapshot.writeCount).toBe(1)

    const reloaded = new StateStore(TEST_CWD)
    expect(reloaded.snapshot.customFacts['language']).toBe('en')
    expect(reloaded.snapshot.sessionId).toBe('session-alpha')
    expect(reloaded.snapshot.writeCount).toBe(1)
  })

  it('maintains a backup file (.bak) on atomic write', () => {
    const store = new StateStore(TEST_CWD)
    store.setFact('first', 1)
    store.flush()

    store.setFact('second', 2)
    store.flush()

    expect(existsSync(STATE_FILE)).toBe(true)
    expect(existsSync(BACKUP_FILE)).toBe(true)
  })

  it('automatically recovers from backup when primary file is corrupt', () => {
    const store = new StateStore(TEST_CWD)
    store.setFact('importantKey', 'crucialValue')
    store.flush()

    // Second write creates backup containing importantKey
    store.setFact('importantKey2', 'secondValue')
    store.flush()

    // Corrupt the primary file completely
    writeFileSync(STATE_FILE, '<<< INVALID CORRUPTED JSON >>>', 'utf8')

    // Reload store — should seamlessly recover from .bak
    const recoveredStore = new StateStore(TEST_CWD)
    expect(recoveredStore.snapshot.customFacts['importantKey']).toBe('crucialValue')
  })

  it('ignores non-object state files and falls back to backup then empty state', () => {
    const store = new StateStore(TEST_CWD)
    store.setFact('key', 'value')
    store.flush()
    // A second flush cycle: the .bak trails the primary, so the backup now
    // holds the flushed state (the first write has no prior file to back up).
    store.setFact('key', 'value')
    store.flush()

    writeFileSync(STATE_FILE, '[1, 2, 3]', 'utf8')
    const fromBackup = new StateStore(TEST_CWD)
    expect(fromBackup.snapshot.customFacts['key']).toBe('value')

    rmSync(BACKUP_FILE, { force: true })
    writeFileSync(STATE_FILE, '"just a string"', 'utf8')
    const fromEmpty = new StateStore(TEST_CWD)
    expect(fromEmpty.snapshot.customFacts).toEqual({})
  })

  it('self-heals missing or malformed fields safely', () => {
    const stateDir = join(TEST_CWD, '.dsh')
    mkdirSync(stateDir, { recursive: true })

    // JSON object with missing required fields
    writeFileSync(join(stateDir, 'world-state.json'), JSON.stringify({
      version: 1,
      customFacts: { brokenField: true },
      activeRuleIds: ['rule-a', 42, null],
      taskHistory: ['nope', { action: 'kept' }],
    }), 'utf8')

    const store = new StateStore(TEST_CWD)
    const snap = store.snapshot
    expect(snap.version).toBe(1)
    expect(Array.isArray(snap.taskHistory)).toBe(true)
    expect(snap.taskHistory).toEqual([{ action: 'kept' }])
    expect(snap.activeRuleIds).toEqual(['rule-a'])
    expect(snap.customFacts['brokenField']).toBe(true)
  })

  it('resets a non-object customFacts field to empty', () => {
    const stateDir = join(TEST_CWD, '.dsh')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({ version: 1, customFacts: ['not', 'an', 'object'] }), 'utf8')

    const store = new StateStore(TEST_CWD)
    expect(store.snapshot.customFacts).toEqual({})
  })

  it('fails loud on a newer on-disk schema version', () => {
    const stateDir = join(TEST_CWD, '.dsh')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({ version: WORLD_STATE_SCHEMA_VERSION + 1, customFacts: {} }), 'utf8')

    expect(() => new StateStore(TEST_CWD)).toThrow(`world state file at "${STATE_FILE}" has schema version ${WORLD_STATE_SCHEMA_VERSION + 1}, incompatible with this build (${WORLD_STATE_SCHEMA_VERSION})`)
  })

  it('repairs a version-1 file whose version field is absent', () => {
    const stateDir = join(TEST_CWD, '.dsh')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({ customFacts: { kept: 1 } }), 'utf8')

    const store = new StateStore(TEST_CWD)
    expect(store.snapshot.version).toBe(1)
    expect(store.snapshot.customFacts['kept']).toBe(1)
  })

  it('records tasks with durations and caps buffer properly', () => {
    const store = new StateStore(TEST_CWD, { historyCap: 15 })
    for (let i = 0; i < 25; i++) {
      store.recordTask({
        action: `task-${i}`,
        timestamp: new Date().toISOString(),
        outcome: 'ok',
        success: true,
        durationMs: 42,
      })
    }
    store.flush()

    expect(store.snapshot.taskHistory).toHaveLength(15)
    expect(store.snapshot.taskHistory[0]!.action).toBe('task-10')
    expect(store.snapshot.taskHistory[0]!.durationMs).toBe(42)
  })

  it('supports full fact lifecycle (set, get, getAll, delete, clear)', () => {
    const store = new StateStore(TEST_CWD)
    store.setFact('k1', 'v1')
    store.setFact('k2', { nested: true })

    expect(store.getFact('k1')).toBe('v1')
    expect(store.getAllFacts()).toEqual({ k1: 'v1', k2: { nested: true } })

    store.setFact('k1', undefined)
    expect(store.getFact('k1')).toBeUndefined()

    store.clearFacts()
    expect(store.getAllFacts()).toEqual({})
  })

  it('reloads state from disk and cancels a pending debounced write', () => {
    vi.useFakeTimers()
    try {
      const store = new StateStore(TEST_CWD)
      store.setFact('first', 1)
      store.flush()

      // An external writer replaces the file after the store's last flush.
      writeFileSync(STATE_FILE, JSON.stringify({ version: 1, customFacts: { external: true } }), 'utf8')

      // A pending mutation schedules a debounced write; reload must cancel it
      // so the external content survives on disk.
      store.setFact('local', 2)
      store.reload()

      const snap = store.snapshot
      expect(snap.customFacts['external']).toBe(true)
      expect(snap.customFacts['local']).toBeUndefined()

      vi.advanceTimersByTime(1000)
      const onDisk = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { customFacts: Record<string, unknown> }
      expect(onDisk.customFacts['external']).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes debounced mutations after the debounce window', () => {
    vi.useFakeTimers()
    try {
      const store = new StateStore(TEST_CWD)
      store.setFact('debounced', true)
      expect(existsSync(STATE_FILE)).toBe(false)

      vi.advanceTimersByTime(500)
      expect((JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { customFacts: Record<string, unknown> }).customFacts['debounced']).toBe(true)
      expect(existsSync(`${STATE_FILE}.tmp`)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps in-memory state when a debounced flush fails', () => {
    vi.useFakeTimers()
    try {
      // A directory at the state-file path makes every write fail.
      mkdirSync(STATE_FILE, { recursive: true })
      const store = new StateStore(TEST_CWD)
      store.setFact('kept', 'yes')

      expect(() => vi.advanceTimersByTime(500)).not.toThrow()
      expect(store.snapshot.customFacts['kept']).toBe('yes')
    } finally {
      vi.useRealTimers()
      rmSync(STATE_FILE, { recursive: true, force: true })
    }
  })

  it('rethrows flush failures after cleaning the temp file', () => {
    // A directory at the target path makes the final rename fail; the temp
    // file exists at that point and must not survive the rethrow.
    mkdirSync(STATE_FILE, { recursive: true })
    const store = new StateStore(TEST_CWD)
    store.setFact('key', 'value')

    expect(() => { store.flush() }).toThrow()
    expect(existsSync(join(TEST_CWD, '.dsh'))).toBe(true)
    const leftovers = readdirSync(join(TEST_CWD, '.dsh')).filter(name => name.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('rethrows flush failures that happen before the temp file exists', () => {
    // An unwritable state directory fails the temp write itself; no temp file
    // is created and nothing needs cleaning.
    const stateDir = join(TEST_CWD, '.dsh')
    mkdirSync(stateDir, { recursive: true })
    chmodSync(stateDir, 0o500)
    try {
      const store = new StateStore(TEST_CWD)
      store.setFact('key', 'value')
      expect(() => { store.flush() }).toThrow()
    } finally {
      chmodSync(stateDir, 0o755)
    }
  })

  it('resets to an empty state and persists the reset', () => {
    const store = new StateStore(TEST_CWD)
    store.setFact('gone', 1)
    store.flush()

    store.reset()
    store.flush()
    expect(store.snapshot.customFacts).toEqual({})
    expect((JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { customFacts: Record<string, unknown> }).customFacts).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// Module 3: Consequence Engine & Risk Assessment
// ---------------------------------------------------------------------------

describe('ConsequenceEngine (Risk Assessment & Impact Analysis)', () => {
  it('detects high risk & critical blast radius on package.json writes', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('write_to_file', { TargetFile: 'packages/core/package.json' })

    expect(record.assessment.riskLevel).toBe('high')
    expect(record.assessment.blastRadius).toBe('workspace')
    expect(record.assessment.warnings.length).toBeGreaterThan(0)
  })

  it('rates critical-file deletions as critical with workspace blast radius', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('delete_file', { path: 'package.json' })
    expect(record.assessment.riskLevel).toBe('critical')
    expect(record.assessment.blastRadius).toBe('workspace')
    expect(record.assessment.reversible).toBe(false)
  })

  it('coerces numeric and boolean argument values when assessing targets', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('write_file', { path: 42 })
    expect(record.predictedEffects[0]?.target).toBe('file:42')
  })

  it('falls back through the read-rule target keys and to unknown without any', () => {
    const engine = new ConsequenceEngine()
    expect(engine.predict('view_file', { target: 'notes.md' }).predictedEffects[0]?.target).toBe('file:notes.md')
    expect(engine.predict('read_file', {}).predictedEffects[0]?.target).toBe('file:unknown')
  })

  it('reads shell commands from the cmd key and truncates long commands', () => {
    const engine = new ConsequenceEngine()
    const viaCmd = engine.predict('bash', { cmd: 'ls' })
    expect(viaCmd.predictedEffects[0]?.description).toContain('`ls`')
    const long = engine.predict('shell', { command: `echo ${'x'.repeat(100)}` })
    expect(long.predictedEffects[0]?.description).toContain('...')
  })

  it('rates plain file writes as low risk', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('write_file', { path: 'src/plain.ts' })

    expect(record.assessment.riskLevel).toBe('low')
    expect(record.assessment.blastRadius).toBe('file')
    expect(record.assessment.reversible).toBe(true)
    expect(record.assessment.warnings).toEqual([])
  })

  it('rates critical-file edits as high risk with package blast radius', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('replace_file_content', { target: 'tsconfig.json' })

    expect(record.assessment.riskLevel).toBe('high')
    expect(record.assessment.blastRadius).toBe('package')
    expect(record.predictedEffects[0]!.kind).toBe('modify')
    expect(record.predictedEffects[0]!.description).toContain('Modifies the content')
  })

  it('rates plain file edits as low risk', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('edit_file', { path: 'src/plain.ts' })

    expect(record.assessment.riskLevel).toBe('low')
    expect(record.assessment.blastRadius).toBe('file')
  })

  it('flags destructive shell operations as critical risk & irreversible', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('run_command', { CommandLine: 'rm -rf /some/directory' })

    expect(record.assessment.riskLevel).toBe('critical')
    expect(record.assessment.reversible).toBe(false)
    expect(record.assessment.warnings[0]).toContain('destructive command')
  })

  it('rates ordinary shell commands as medium risk', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('bash', { command: 'echo hello' })

    expect(record.assessment.riskLevel).toBe('medium')
    expect(record.assessment.reversible).toBe(true)
    expect(record.assessment.warnings).toEqual([])
  })

  it('rates safe inspection tools with zero risk', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('view_file', { AbsolutePath: '/tmp/test.ts' })

    expect(record.assessment.riskLevel).toBe('none')
    expect(record.assessment.blastRadius).toBe('isolated')
    expect(record.assessment.reversible).toBe(true)
  })

  it('predicts read-only effects for network and search tools', () => {
    const engine = new ConsequenceEngine()
    const web = engine.predict('search_web', { query: 'https://example.com' })
    expect(web.assessment.riskLevel).toBe('none')
    expect(web.predictedEffects[0]!.kind).toBe('network')
    expect(web.predictedEffects[0]!.description).toContain('Read-only external request')

    const search = engine.predict('grep_search', {})
    expect(search.assessment.riskLevel).toBe('none')
    expect(search.predictedEffects[0]!.target).toBe('filesystem:search')
  })

  it('falls back to a generic state-change for unknown actions', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('probe_tool', { ignored: true })

    expect(record.assessment.riskLevel).toBe('low')
    expect(record.predictedEffects[0]!.target).toBe('tool:probe_tool')
    expect(record.predictedEffects[0]!.description).toContain('generic tool')
  })

  it('narrows non-object arguments to an empty record', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('write_to_file', 'not-an-object')
    expect(record.predictedEffects[0]!.target).toBe('file:unknown')
  })

  it('reconciles failure with error details and failed status', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('write_to_file', { TargetFile: '/path/file.ts' })

    engine.reconcile(record, [], { error: 'Permission denied', durationMs: 15 })

    expect(record.status).toBe('failed')
    expect(record.error).toBe('Permission denied')
    expect(record.durationMs).toBe(15)
    expect(record.divergenceReason).toContain('failed')
  })

  it('filters high risk actions and anomalies', () => {
    const engine = new ConsequenceEngine()
    engine.predict('view_file', { AbsolutePath: 'a.ts' })
    engine.predict('run_command', { CommandLine: 'git reset --hard HEAD~1' })
    engine.predict('delete_file', { target: 'b.ts' })

    expect(engine.highRiskActions()).toHaveLength(2)
    expect(engine.divergences()).toHaveLength(0)
    expect(engine.history()).toHaveLength(3)
    expect(engine.recent(2)).toHaveLength(2)
  })

  it('reconciles confirmed status when predictions match actual', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('write_to_file', { TargetFile: 'new.ts' })
    engine.reconcile(record, [{
      target: 'file:new.ts',
      kind: 'create',
      description: 'Done',
    }])

    expect(record.status).toBe('confirmed')
    expect(record.divergenceReason).toBeUndefined()
  })

  it('marks diverged status when actual effects differ from predictions', () => {
    const engine = new ConsequenceEngine()
    const record = engine.predict('write_to_file', { TargetFile: 'new.ts' })
    engine.reconcile(record, [{
      target: 'file:other.ts',
      kind: 'create',
      description: 'Different file',
    }])

    expect(record.status).toBe('diverged')
    expect(record.divergenceReason).toContain('missing: file:new.ts:create')
  })

  it('infers actual effects from the rule table on success', () => {
    const engine = new ConsequenceEngine()
    const effects = engine.inferActualEffects('write_to_file', { path: 'a.ts' }, true)
    expect(effects[0]!.target).toBe('file:a.ts')
  })

  it('infers a generic completion for unknown successful actions', () => {
    const engine = new ConsequenceEngine()
    const effects = engine.inferActualEffects('probe_tool', {}, true)
    expect(effects[0]!.description).toContain('completed successfully')
  })

  it('infers no applied effects on failure', () => {
    const engine = new ConsequenceEngine()
    const effects = engine.inferActualEffects('write_to_file', { path: 'a.ts' }, false)
    expect(effects[0]!.description).toContain('no effects were applied')
  })

  it('evicts the oldest records beyond the configured capacity', () => {
    const engine = new ConsequenceEngine({ capacity: 2 })
    engine.predict('view_file', { path: 'a.ts' })
    engine.predict('view_file', { path: 'b.ts' })
    engine.predict('view_file', { path: 'c.ts' })

    expect(engine.history()).toHaveLength(2)
    expect(engine.history()[0]!.predictedEffects[0]!.target).toBe('file:b.ts')
  })
})
