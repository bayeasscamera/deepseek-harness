/**
 * Prompt-budget observability: prices every assembled system prompt with the
 * token-meter fixed-density heuristic and emits a per-part breakdown event, so
 * a deployment can see where request tokens go before tuning per-component
 * budgets. Purely observational — it never trims, reorders, or rejects an
 * assembly, and a listener failure never blocks the model request.
 *
 * @module @deepseek-ai/dsh-prompt-budget
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'prompt-budget'

/** The system-prompt service whose assembly waterfall this plugin observes. */
export const inject = ['systemPrompt']

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One assembled system prompt priced into a per-part token breakdown.
     * Emitted after the assembly waterfall resolves; the assembly itself is
     * returned unchanged to the caller.
     * @param breakdown - the priced parts of the assembly.
     * @mode emit
     */
    'prompt-budget/breakdown'(breakdown: PromptBudgetBreakdown): void
  }
}

/** Fixed text-density estimate mirroring `@deepseek-ai/dsh-token-meter`. */
const CHARS_PER_TOKEN = 4

/** Per-part structural overhead for JSON framing and type tags. */
const PART_OVERHEAD = 4

/**
 * Price one text part under the fixed-density heuristic.
 * @param text - the part's rendered text.
 * @returns heuristic tokens including structural overhead.
 */
function estimateText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN) + PART_OVERHEAD
}

/** One priced part of an assembled prompt. */
export interface PromptBudgetPart {
  /** The part's registered name (section, context, or tool name). */
  readonly name: string
  /** Heuristic tokens this part contributes. */
  readonly tokens: number
}

/** The priced breakdown of one assembled system prompt. */
export interface PromptBudgetBreakdown {
  /** Priced prompt sections, in assembly order. */
  readonly sections: readonly PromptBudgetPart[]
  /** Priced dynamic contexts, in assembly order. */
  readonly contexts: readonly PromptBudgetPart[]
  /** Priced tool schemas, in assembly order. */
  readonly tools: readonly PromptBudgetPart[]
  /** Priced prompt variables, in insertion order. */
  readonly variables: readonly PromptBudgetPart[]
  /** Sum of every part's tokens. */
  readonly total: number
}

/**
 * Price one tool schema the way the request envelope serializes it.
 * @param schema - the tool schema to price without mutation.
 * @returns heuristic tokens for the serialized schema.
 */
function estimateTool(schema: ToolSchema): number {
  return Math.ceil(JSON.stringify(schema).length / CHARS_PER_TOKEN) + PART_OVERHEAD
}

/**
 * Price an assembled prompt into a per-part breakdown.
 * @param assembly - the resolved assembly to price without mutation.
 * @returns the breakdown with every part and the total.
 */
export function priceAssembly(assembly: PromptAssembly): PromptBudgetBreakdown {
  const sections = assembly.sections.map(section => ({ name: section.name, tokens: estimateText(section.text) }))
  const contexts = assembly.contexts.map(context => ({ name: context.name, tokens: estimateText(context.text) }))
  const tools = assembly.tools.map(tool => ({ name: tool.name, tokens: estimateTool(tool) }))
  const variables = Object.entries(assembly.variables)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ name: key, tokens: estimateText(value as string) }))
  const total = [...sections, ...contexts, ...tools, ...variables]
    .reduce((sum, part) => sum + part.tokens, 0)
  return { sections, contexts, tools, variables, total }
}

/**
 * Register the assembly observer. It listens on the `system-prompt/assemble`
 * waterfall, delegates first, prices the resolved assembly, emits the
 * breakdown, and returns the assembly unchanged.
 * @param ctx - Cordis context carrying the system-prompt service.
 */
export function apply(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    try {
      ctx.emit('prompt-budget/breakdown', priceAssembly(assembled))
    } catch {
      // Observability must never block the model request: a breakdown listener
      // failure is swallowed here because the assembly is already authoritative.
    }
    return assembled
  })
}
