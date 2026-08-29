/**
 * Pre-action consequence prediction: classify a tool call's risk and derive
 * its most significant expected effects from the tool name and arguments.
 *
 * @module @deepseek-ai/dsh-agent-state/predict
 */

import type { ActionPrediction, PredictedConsequence } from './types.ts'

/**
 * The tools whose arguments carry a primary filesystem target.
 */
const TARGETED_TOOLS: ReadonlySet<string> = new Set([
  'write', 'edit', 'str_replace', 'str_replace_based_edit', 'read', 'read_image', 'delete', 'move', 'mkdir',
])

/**
 * The tools that run commands or code.
 */
const EXECUTING_TOOLS: ReadonlySet<string> = new Set(['bash', 'run_code', 'execute'])

/** Tools with no convention for undoing what they do. */
const IRREVERSIBLE_TOOLS: ReadonlySet<string> = new Set(['delete', 'rm', 'truncate'])

/** Whether a command string suggests destructive filesystem use. */
const DESTRUCTIVE_COMMAND = new RegExp(
  '(^|[;&|]\\s*)('
    + 'rm\\s+-[a-z]*r[a-z]*\\b'
    + '|git\\s+(reset|clean|checkout\\s+--)'
    + '|drop\\s+table|truncate\\s+table'
    + '|pip\\s+uninstall|npm\\s+uninstall)',
  'i',
)

/**
 * Predict the consequences of one tool call.
 * @param name - the tool being invoked.
 * @param args - the tool's parsed arguments (validated by the tool itself later).
 * @returns the risk classification and predicted consequences, targets included.
 */
export function predictAction(name: string, args: unknown): ActionPrediction {
  const record = isRecord(args) ? args : {}
  const consequences: PredictedConsequence[] = []
  const targets: string[] = []
  let reversibleByConvention = true

  for (const key of ['file_path', 'target', 'path', 'cwd', 'workdir']) {
    const value = record[key]
    if (typeof value === 'string' && value !== '') targets.push(value)
  }

  if (TARGETED_TOOLS.has(name)) {
    if (name === 'write' || name === 'edit' || name === 'str_replace' || name === 'str_replace_based_edit') {
      consequences.push({
        effect: 'writes-file',
        detail: `modifies ${targets[0] ?? 'the target file'} on disk; existing content is replaced`,
      })
    } else if (name === 'delete' || name === 'move' || name === 'mkdir') {
      consequences.push({
        effect: `fs-${name}`,
        detail: `applies a ${name} operation to ${targets[0] ?? 'the target path'}`,
      })
    } else {
      // Read-family tools land here but produce only read-only consequences.
      consequences.push({ effect: 'reads-file', detail: `reads ${targets[0] ?? 'the target file'} without modifying it` })
    }
    if (IRREVERSIBLE_TOOLS.has(name)) {
      reversibleByConvention = false
      consequences.push({ effect: 'irreversible', detail: 'the tool convention provides no undo; the previous state cannot be restored' })
    }
  }

  if (EXECUTING_TOOLS.has(name)) {
    const command = typeof record.command === 'string' ? record.command : undefined
    consequences.push({
      effect: 'spawns-process',
      detail: command === undefined
        ? 'executes a program with the process ambient environment'
        : `runs: ${command.slice(0, 160)}`,
    })
    if (command !== undefined && DESTRUCTIVE_COMMAND.test(command)) {
      reversibleByConvention = false
      consequences.push({
        effect: 'destructive-command',
        detail: 'the command pattern matches destructive operations (forced removal, hard reset, table truncation, package uninstall)',
      })
    }
  }

  if (consequences.length === 0) {
    // Unknown or read-only: state that explicitly so the observation can compare.
    consequences.push({ effect: 'no-mutation', detail: 'no durable state change is expected from this call' })
  }

  return {
    risk: reversibleByConvention ? (consequences.some(c => c.effect !== 'no-mutation') ? 'reversible' : 'read-only') : 'irreversible',
    consequences,
    targets,
    reversibleByConvention,
  }
}

/** Narrow an unknown argument value to a plain string-keyed record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
