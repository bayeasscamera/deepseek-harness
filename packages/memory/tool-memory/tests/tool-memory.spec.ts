import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as ToolMemory from '../src/index.ts'
import { MemoryService } from '@deepseek-ai/dsh-memory'

interface ToolCall {
  name: string
  parameters: Record<string, unknown>
  output: { schema: unknown; render: (args: unknown, value: unknown) => unknown }
  execute: (args: never, exec: { agent?: { session: { header: { cwd: string } } } }) => Promise<unknown>
}

function boot(config?: { defaultScope?: 'workspace' | 'global' }): { tools: ToolCall[]; memory: MemoryService; cleanup: () => void } {
  const store = join(mkdtempSync(join(tmpdir(), 'dsh-tool-memory-')), 'memory.jsonl')
  const ctx = new Context()
  const memory = new MemoryService(ctx, { storePath: store })
  const tools: ToolCall[] = []
  ctx.provide('tools')
  ctx.set('tools', { register: (tool: ToolCall) => { tools.push(tool) } } as never)
  ToolMemory.apply(ctx, config)
  return { tools, memory, cleanup: () => { rmSync(dirname(store), { recursive: true, force: true }) } }
}

function tool(tools: ToolCall[], name: string): ToolCall {
  const found = tools.find(entry => entry.name === name)
  if (found === undefined) throw new Error(`tool ${name} not registered`)
  return found
}

describe('dsh-tool-memory', () => {
  it('registers memory_write, memory_search, and memory_forget', () => {
    const { tools, cleanup } = boot()
    expect(tools.map(entry => entry.name)).toEqual(['memory_write', 'memory_search', 'memory_forget'])
    cleanup()
  })

  it('writes workspace-scoped by default when the caller has a cwd', async () => {
    const { tools, memory, cleanup } = boot()
    const exec = { agent: { session: { header: { cwd: '/repo' } } } }
    const result = await tool(tools, 'memory_write').execute({ kind: 'fact', text: 'Uses pnpm workspaces.' } as never, exec)
    expect(result).toMatchObject({ stored: true })
    expect(memory.search('pnpm', { cwd: '/repo' })).toHaveLength(1)
    expect(memory.search('pnpm', { cwd: '/other' })).toHaveLength(0)
    expect(tool(tools, 'memory_write').output.render({ kind: 'fact', text: 'x' }, { id: '1', text: 'x', stored: true })).toEqual([{ type: 'text', text: 'Remembered (1): [fact] x' }])
    expect(tool(tools, 'memory_write').output.render({ kind: 'fact', text: 'x' }, { id: '1', text: 'x', stored: false })).toEqual([{ type: 'text', text: 'nothing stored' }])
    cleanup()
  })

  it('falls back to global scope without a cwd and honors an explicit scope', async () => {
    const { tools, memory, cleanup } = boot()
    const anonymous = {}
    await tool(tools, 'memory_write').execute({ kind: 'fact', text: 'Anonymous global fact.' } as never, anonymous)
    await tool(tools, 'memory_write').execute({ kind: 'lesson', text: 'Explicit global lesson.', scope: 'global' } as never, anonymous)
    expect(memory.search('global', { cwd: '/anywhere' })).toHaveLength(2)
    cleanup()
  })

  it('honors a configured global default scope', async () => {
    const { tools, memory, cleanup } = boot({ defaultScope: 'global' })
    const exec = { agent: { session: { header: { cwd: '/repo' } } } }
    await tool(tools, 'memory_write').execute({ kind: 'fact', text: 'Global by deployment default.' } as never, exec)
    expect(memory.search('deployment default', { cwd: '/other' })).toHaveLength(1)
    cleanup()
  })

  it('searches within the calling cwd and renders one line per record', async () => {
    const { tools, memory, cleanup } = boot()
    memory.remember('preference', 'Answer concisely.', 'global')
    memory.remember('fact', 'Repo uses vitest.', { cwd: '/repo' })
    const exec = { agent: { session: { header: { cwd: '/repo' } } } }
    const result = await tool(tools, 'memory_search').execute({ query: 'vitest' } as never, exec) as { results: string[] }
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toContain('[fact]')
    expect(result.results[0]).toContain('workspace /repo')
    const rendered = tool(tools, 'memory_search').output.render({}, { results: ['1 [fact] (global) x'] })
    expect(rendered).toEqual([{ type: 'text', text: '1 [fact] (global) x' }])
    cleanup()
  })

  it('searches without a caller and honors an explicit limit', async () => {
    const { tools, memory, cleanup } = boot()
    memory.remember('fact', 'global alpha note.', 'global')
    memory.remember('fact', 'global beta note.', 'global')
    memory.remember('fact', 'global gamma note.', 'global')
    const limited = await tool(tools, 'memory_search').execute({ query: 'global', limit: 2 } as never, {}) as { results: string[] }
    expect(limited.results).toHaveLength(2)
    const anonymous = await tool(tools, 'memory_search').execute({ query: 'alpha' } as never, {}) as { results: string[] }
    expect(anonymous.results[0]).toContain('(global)')
    cleanup()
  })

  it('forgets by id and reports unknown ids', async () => {
    const { tools, memory, cleanup } = boot()
    const record = memory.remember('fact', 'Doomed fact.', 'global')
    expect(await tool(tools, 'memory_forget').execute({ id: record.id } as never, {})).toEqual({ forgotten: true })
    expect(await tool(tools, 'memory_forget').execute({ id: record.id } as never, {})).toEqual({ forgotten: false })
    expect(tool(tools, 'memory_forget').output.render({}, { forgotten: false })).toEqual([{ type: 'text', text: 'no memory with that id' }])
    expect(tool(tools, 'memory_forget').output.render({}, { forgotten: true })).toEqual([{ type: 'text', text: 'forgotten' }])
    cleanup()
  })
})
