/**
 * Model-facing long-term memory tools: `memory_write` stores a durable record,
 * `memory_search` ranks what is remembered, and `memory_forget` removes one.
 * Every call is a logged tool call; the memory service owns persistence and
 * recall injection. Named exports preserve loader injection metadata.
 *
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryKind, MemoryScope, MemoryRecord } from '@deepseek-ai/dsh-memory'

export const name = 'tool-memory'
export const inject = ['tools', 'memory']

/** Model-facing memory tool configuration. */
export interface Config {
  /**
   * Default scope for a write that does not pass `scope`: `workspace` bounds
   * the record to the calling session's cwd and `global` applies it
   * everywhere. Default: `workspace` when the caller has a cwd, else `global`.
   */
  defaultScope?: 'workspace' | 'global'
}

export const Config: z<Config> = z.object({
  defaultScope: z.union([z.const('workspace'), z.const('global')]),
})

const KINDS = ['fact', 'preference', 'lesson'] as const

/**
 * Resolve the effective scope for one write.
 * @param requested - the model-supplied scope, when present.
 * @param fallback - the deployment default scope.
 * @param cwd - the calling session's workspace root, when known.
 * @returns the resolved scope.
 */
function resolveScope(
  requested: string | undefined,
  fallback: 'workspace' | 'global',
  cwd: string | undefined,
): MemoryScope {
  const wanted = requested ?? fallback
  if (wanted === 'global') return 'global'
  return cwd !== undefined ? { cwd } : 'global'
}

/**
 * Render one record for tool output and search results.
 * @param record - the record to render.
 * @returns the one-line rendering.
 */
function renderRecord(record: MemoryRecord): string {
  const scope = record.scope === 'global' ? 'global' : `workspace ${record.scope.cwd}`
  return `${record.id} [${record.kind}] (${scope}) ${record.text}`
}

/**
 * Register the memory tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool and memory services.
 * @param config - deployment configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const fallback = config.defaultScope ?? 'workspace'

  ctx.tools.register(defineTool({
    name: 'memory_write',
    description: 'Store one durable memory for future sessions. Write a stable fact about the '
      + 'user or project, a stated preference, or a lesson learned from a failure. One concise '
      + 'sentence per call; write only what is worth recalling weeks later — never transient '
      + 'task state. Restating an existing memory is safe: it refreshes it instead of duplicating.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: [...KINDS],
        description: 'fact (stable truth) | preference (how the user wants things done) | lesson (a failure to avoid repeating).',
      },
      text: {
        type: 'string',
        required: true,
        description: 'One concise sentence stating the memory.',
      },
      scope: {
        type: 'string',
        enum: ['workspace', 'global'],
        description: 'workspace (this project only, default) or global (every project).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          text: { type: 'string', required: true },
          stored: { type: 'boolean', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: value.stored ? `Remembered (${value.id}): [${args.kind}] ${value.text}` : 'nothing stored' }],
    },
    execute(args, exec) {
      const kind: MemoryKind = args.kind
      const cwd = exec.agent?.session.header.cwd
      const scope = resolveScope(args.scope, fallback, cwd)
      const record = ctx.memory.remember(kind, args.text, scope)
      return Promise.resolve({ id: record.id, text: record.text, stored: true })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description: 'Search the long-term memory for records matching a query. The session prompt '
      + 'already carries the top memories; use this when you need more or want to check whether '
      + 'something is already remembered before writing it.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text query; an empty string lists the freshest memories.' },
      limit: { type: 'integer', description: 'Maximum results. Default: 12.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => value.results.map(line => ({ type: 'text' as const, text: line })),
    },
    execute(args, exec) {
      const cwd = exec.agent?.session.header.cwd
      const records = ctx.memory.search(args.query, {
        ...cwd !== undefined ? { cwd } : {},
        ...args.limit !== undefined ? { limit: args.limit } : {},
      })
      return Promise.resolve({ results: records.map(renderRecord) })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_forget',
    description: 'Remove one long-term memory by id. Use when a memory is wrong or no longer '
      + 'holds; prefer overwriting a stale fact by writing the corrected one, since restating '
      + 'does not replace old text.',
    parameters: {
      id: { type: 'string', required: true, description: 'The record id from a previous memory_write or memory_search result.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          forgotten: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.forgotten ? 'forgotten' : 'no memory with that id' }],
    },
    execute(args) {
      return Promise.resolve({ forgotten: ctx.memory.forget(args.id) })
    },
  }))
}
