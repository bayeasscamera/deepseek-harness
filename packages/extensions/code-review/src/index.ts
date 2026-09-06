/**
 * Multi-level adaptive code review extension: five configurable review depths
 * (low, medium, high, extra-high, ultra) balance speed and token cost against
 * exhaustive security and bug discovery. `/review` renders the audit prompt
 * for the human; `code_review_audit` returns the structured level spec to the
 * model.
 *
 * @module @deepseek-ai/dsh-code-review
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Plugin name. */
export const name = 'code-review'
/** Required Cordis services. */
export const inject = ['commands', 'tools']

/** Effort level for code reviews. */
export type ReviewEffortLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'ultra'

/** Specification of review guidelines for an effort level. */
export interface ReviewLevelSpec {
  /** Effort level key. */
  name: ReviewEffortLevel
  /** Human display label. */
  label: string
  /** Description of review objectives. */
  description: string
  /** List of evaluated architectural/code aspects. */
  aspects: string[]
  /** Suggested thinking turn budget. */
  thinkingBudget: number
}

/** Registry of configured review depth levels. */
export const REVIEW_LEVELS: Record<ReviewEffortLevel, ReviewLevelSpec> = {
  low: {
    name: 'low',
    label: 'Fast (Low)',
    description: 'Syntax check, typos, code style, and linter compliance.',
    aspects: ['Syntax & typos', 'Naming conventions', 'Linter & unused imports'],
    thinkingBudget: 1,
  },
  medium: {
    name: 'medium',
    label: 'Standard (Medium)',
    description: 'Strict typing, function return contracts, basic error handling, and obvious regressions.',
    aspects: ['Type safety', 'Basic error handling', 'Function contracts', 'Code structure'],
    thinkingBudget: 2,
  },
  high: {
    name: 'high',
    label: 'In-Depth (High)',
    description: 'Business logic, security flaws, architecture invariants, and test coverage.',
    aspects: ['Business logic', 'Security & zero-trust', 'Unit test coverage', 'Failure-case handling'],
    thinkingBudget: 4,
  },
  'extra-high': {
    name: 'extra-high',
    label: 'Reinforced (Extra High)',
    description: 'Performance, concurrency, memory/resource leaks, race conditions, and dependencies.',
    aspects: ['Concurrency & race conditions', 'Resource management & memory leaks', 'Bottlenecks', 'Advanced security'],
    thinkingBudget: 6,
  },
  ultra: {
    name: 'ultra',
    label: 'Exhaustive (Ultra)',
    description: 'Formal contract verification, extreme edge-case exploration, and a complete architecture audit.',
    aspects: ['Formal invariant verification', 'Extreme edge cases', 'System resilience', 'Architecture ADR audit', 'Exhaustive regression tests'],
    thinkingBudget: 10,
  },
}

/** Comma-separated level list quoted by every invalid-level error. */
const LEVEL_LIST = Object.keys(REVIEW_LEVELS).join(', ')

/**
 * Generate a specialized system prompt section for the requested effort level.
 * @param level - selected effort level.
 * @param targetPath - optional file or directory target.
 * @returns generated markdown instructions for model evaluation.
 */
export function buildReviewPrompt(level: ReviewEffortLevel, targetPath?: string): string {
  const spec = REVIEW_LEVELS[level]
  const target = targetPath ? `on target: \`${targetPath}\`` : 'on the recent changes'
  return `### Code Review — Level ${spec.label}\n` +
    `Perform a code review ${target} focusing on:\n` +
    spec.aspects.map(aspect => `- ${aspect}`).join('\n') +
    `\n\n**Audit guidelines:** ${spec.description}`
}

/**
 * Mount the code review command and tool extensions.
 * @param ctx - Cordis context carrying commands and tools services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'review',
    description: 'Run a code review with an adjustable effort level (low, medium, high, extra-high, ultra).',
    input: {
      hint: '[low | medium | high | extra-high | ultra] [path]',
    },
    handler: (invocation: CommandInvocation): CommandResult => {
      const parts = invocation.rawInput.trim().split(/\s+/).filter(token => token.length > 0)
      // The cast is the raw-text-to-union boundary; the hasOwn check below is
      // the runtime guard that keeps unrecognized text from resolving.
      const maybeLevel = parts[0]?.toLowerCase() as ReviewEffortLevel | undefined
      if (maybeLevel !== undefined && !Object.hasOwn(REVIEW_LEVELS, maybeLevel)) {
        return {
          kind: 'error',
          text: `Unknown review level "${parts[0]}". Valid levels: ${LEVEL_LIST}.`,
        }
      }
      // An omitted level resolves to the documented medium default; an
      // unrecognized one already failed loud above.
      const level = maybeLevel ?? 'medium'
      const spec = REVIEW_LEVELS[level]
      const targetPath = parts.slice(1).join(' ') || undefined
      const prompt = buildReviewPrompt(level, targetPath)

      return {
        kind: 'success',
        text: `### Code Review Launched (${spec.label})\n\n` +
          `**Analysis scope:** ${targetPath ? `\`${targetPath}\`` : 'current changes'}\n` +
          `**Evaluated criteria:**\n${spec.aspects.map(aspect => `- ${aspect}`).join('\n')}\n\n` +
          `*Evaluation prompt enabled for the model:*\n\`\`\`markdown\n${prompt}\n\`\`\``,
      }
    },
  }), 'code-review: command')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'code_review_audit',
    description: 'Run an automated code review audit at one of five configurable effort levels (low, medium, high, extra-high, ultra).',
    parameters: {
      level: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'extra-high', 'ultra'],
        description: 'Effort and analysis depth.',
      },
      path: {
        type: 'string',
        description: 'File or directory to review.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          level: { type: 'string', required: true },
          guidelines: { type: 'string', required: true },
          aspects: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Code Review Level: ${value.level}\nGuidelines: ${value.guidelines}\nAspects: ${value.aspects.join(', ')}`,
      }],
    },
    execute: (args: { level?: ReviewEffortLevel; path?: string }) => {
      // The declared parameter enum rejects unknown levels before execute
      // runs; an omitted level resolves to the documented medium default.
      const spec = args.level === undefined ? REVIEW_LEVELS.medium : REVIEW_LEVELS[args.level]
      return Promise.resolve({
        level: spec.name,
        guidelines: spec.description,
        aspects: spec.aspects,
      })
    },
  })), 'code-review: tool')
}
