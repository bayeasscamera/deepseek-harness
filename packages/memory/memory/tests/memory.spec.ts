import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as MemoryPlugin from '../src/index.ts'
import { MemoryService, scoreMemory } from '../src/index.ts'

function freshStore(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-memory-')), 'memory.jsonl')
}

function service(storePath: string, maxRecall?: number): MemoryService {
  return new MemoryService(new Context(), { storePath, ...maxRecall !== undefined ? { maxRecall } : {} })
}
describe('dsh-memory service', () => {
  it('stores records, persists them, and reloads them in a new service instance', () => {
    const store = freshStore()
    const first = service(store)
    first.remember('fact', 'The deploy pipeline is trunk-based.', 'global')
    first.remember('preference', 'Prefer pnpm over npm.', { cwd: '/repo' })

    const second = service(store)
    expect(second.search('deploy pipeline')).toHaveLength(1)
    expect(second.search('pnpm', { cwd: '/repo' })).toHaveLength(1)
    rmSync(dirname(store), { recursive: true, force: true })
  })

  it('consolidates a restated memory instead of duplicating it', () => {
    const store = freshStore()
    const svc = service(store)
    const a = svc.remember('fact', 'Trunk-based deploy.', 'global')
    const b = svc.remember('fact', 'Trunk-based deploy.', 'global')
    expect(b.id).toBe(a.id)
    expect(svc.search('trunk')).toHaveLength(1)
    // A different kind or scope stays a separate record: the consolidation
    // probe walks both scope-shape mismatches (object vs 'global', each way).
    const scopedFirst = svc.remember('fact', 'Scoped first.', { cwd: '/repo' })
    // Existing object scope vs candidate 'global' scope: not the same memory.
    expect(svc.remember('fact', 'Scoped first.', 'global').id).not.toBe(scopedFirst.id)
    // And the reverse probe: existing 'global' vs candidate object scope.
    const globalFirst = svc.remember('fact', 'Global first.', 'global')
    expect(svc.remember('fact', 'Global first.', { cwd: '/repo' }).id).not.toBe(globalFirst.id)
    // Two object scopes with different roots stay separate records.
    const repoOne = svc.remember('fact', 'One root.', { cwd: '/repo' })
    expect(svc.remember('fact', 'One root.', { cwd: '/other' }).id).not.toBe(repoOne.id)
    svc.remember('lesson', 'Trunk-based deploy.', 'global')
    svc.remember('fact', 'Trunk-based deploy.', { cwd: '/repo' })
    expect(svc.search('trunk')).toHaveLength(2)
    expect(svc.search('trunk', { cwd: '/repo' })).toHaveLength(3)
    rmSync(dirname(store), { recursive: true, force: true })
  })

  it('rejects empty memory text', () => {
    const store = freshStore()
    expect(() => service(store).remember('fact', '   ', 'global')).toThrow('non-empty')
    rmSync(dirname(store), { recursive: true, force: true })
  })

  it('scopes workspace records to their exact cwd', () => {
    const store = freshStore()
    const svc = service(store)
    svc.remember('fact', 'Uses vitest workspace config.', { cwd: '/repo' })
    expect(svc.search('vitest', { cwd: '/repo' })).toHaveLength(1)
    expect(svc.search('vitest', { cwd: '/other' })).toHaveLength(0)
    expect(svc.search('vitest')).toHaveLength(0)
    rmSync(dirname(store), { recursive: true, force: true })
  })

  it('ranks verbatim matches above token overlaps and counts recall hits', () => {
    const store = freshStore()
    const svc = service(store)
    svc.remember('fact', 'Deploys go through the blue pipeline.', 'global')
    svc.remember('fact', 'The pipeline color is irrelevant to builds.', 'global')
    const ranked = svc.search('blue pipeline')
    expect(ranked[0]?.text).toBe('Deploys go through the blue pipeline.')
    // The returned record is the pre-increment snapshot of this recall.
    expect(svc.search('blue pipeline')[0]?.hits).toBe(1)
    rmSync(dirname(store), { recursive: true, force: true })
  })

  it('limits search results and drops unrelated records', () => {
    const store = freshStore()
    const svc = service(store, 2)
    svc.remember('fact', 'alpha deploy note', 'global')
    svc.remember('fact', 'beta deploy note', 'global')
    svc.remember('fact', 'gamma deploy note', 'global')
    svc.remember('fact', 'unrelated kitchen note', 'global')
    expect(svc.search('deploy note')).toHaveLength(2)
    expect(svc.search('kitchen')).toHaveLength(1)
    rmSync(dirname(store), { recursive: true, force: true })
  })

  it('forgets by id and reports a miss for unknown ids', () => {
    const store = freshStore()
    const svc = service(store)
    const record = svc.remember('fact', 'Temporary fact.', 'global')
    expect(svc.forget(record.id)).toBe(true)
    expect(svc.forget(record.id)).toBe(false)
    expect(svc.search('temporary')).toHaveLength(0)
    expect(readFileSync(store, 'utf8')).toBe('')
    rmSync(dirname(store), { recursive: true, force: true })
  })

  it('skips torn, corrupt, and wrong-shaped store lines on load', () => {
    const store = freshStore()
    writeFileSync(store, [
      '{"id":"1","kind":"fact","text":"intact record","scope":"global","createdAt":0,"updatedAt":0,"hits":0}',
      '{"id":"abc","kind":"fact","text":"non-numeric id","scope":"global","createdAt":0,"updatedAt":0,"hits":0}',
      '{"id":"3","kind":"fact","text":42,"scope":"global","createdAt":0,"updatedAt":0,"hits":0}',
      '{"id":"4","kind":"fac',
    ].join('\n') + '\n')
    const svc = service(store)
    expect(svc.search('intact')).toHaveLength(1)
    expect(svc.search('non-numeric')).toHaveLength(1)
    expect(svc.search('wrong-shaped')).toHaveLength(0)
    // A write through the loaded index persists it and renumbers past the
    // non-numeric id without treating it as a counter.
    svc.remember('fact', 'survives the rewrite.', 'global')
    const reloaded = service(store)
    expect(reloaded.search('survives')).toHaveLength(1)
    rmSync(dirname(store), { recursive: true, force: true })
  })

  it('defaults the store to the harness home and the recall width', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-memory-home-'))
    const previous = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = home
      const fromEnv = new MemoryService(new Context(), { maxRecall: 5 })
      fromEnv.remember('fact', 'Env-home fact.', 'global')

      delete process.env.DSH_HOME
      // Constructor-only: covers the homedir fallback without writing there.
      new MemoryService(new Context(), {})
      const svc = service(join(home, 'memory.jsonl'))
      expect(svc.search('Env-home fact')).toHaveLength(1)
      // maxRecall default 12 trims the recall section.
      for (let i = 0; i < 20; i++) svc.remember('fact', `default-width fact ${i}.`, 'global')
      expect(svc.recallText(undefined).split('\n').length - 1).toBeLessThanOrEqual(12)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('renders recall text for the workspace and stays empty without records', () => {
    const store = freshStore()
    const svc = service(store)
    expect(svc.recallText('/repo')).toBe('')
    svc.remember('preference', 'Answer in French.', 'global')
    svc.remember('fact', 'Monorepo with pnpm.', { cwd: '/repo' })
    const text = svc.recallText('/repo')
    expect(text).toContain('Long-term memory')
    expect(text).toContain('Answer in French.')
    expect(text).toContain('Monorepo with pnpm.')
    expect(text).toContain('(this workspace)')
    expect(svc.recallText('/other')).not.toContain('Monorepo')
    rmSync(dirname(store), { recursive: true, force: true })
  })
})

describe('scoreMemory', () => {
  it('scores verbatim containment, token overlap, and empty queries', () => {
    const base = { id: '1', kind: 'fact' as const, text: 'Deploy via blue pipeline', scope: 'global' as const, createdAt: 0, updatedAt: 0, hits: 0 }
    expect(scoreMemory(base, 'Deploy via blue pipeline')).toBe(3 + 8) // verbatim + 4 tokens
    expect(scoreMemory(base, 'blue')).toBe(5)
    expect(scoreMemory(base, 'kitchen')).toBe(0)
    // A verbatim single-character query scores 3 with no token overlap to add.
    expect(scoreMemory({ ...base, text: 'x' }, 'x')).toBe(3)
    expect(scoreMemory(base, '')).toBe(1)
  })
})

describe('dsh-memory plugin apply', () => {
  it('provides the service and registers the recall prompt section', async () => {
    const store = freshStore()
    const ctx = new Context()
    type CtxPrompt = { agent?: { session: { header: { cwd: string } } } }
    let registered: { name: string; order: number; text: (c: CtxPrompt) => string } | undefined
    ctx.provide('systemPrompt')
    ctx.set('systemPrompt', { context: (def: never) => { registered = def } } as never)

    await ctx.plugin(MemoryPlugin, { storePath: store })
    ctx.memory.remember('fact', 'Workspace uses oxlint.', { cwd: '/repo' })

    expect(registered?.name).toBe('memory:recall')
    expect(registered?.order).toBe(70)
    expect(registered?.text({ agent: { session: { header: { cwd: '/repo' } } } })).toContain('oxlint')
    expect(registered?.text({ agent: { session: { header: { cwd: '/elsewhere' } } } })).toBe('')
    expect(registered?.text({})).toBe('')
    rmSync(dirname(store), { recursive: true, force: true })
  })})
