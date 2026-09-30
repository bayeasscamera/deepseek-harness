/**
 * Loop-hygiene plugin that continues a turn after an output-ceiling truncation.
 * A step that ends `max-tokens` would otherwise close the turn mid-answer and
 * wait for a manual "continue"; this plugin steers a continuation prompt at
 * the stopping boundary so the model resumes the same response in the same
 * turn, with the turn-end reason and the consecutive-continuation cap as the
 * only controls. Configuration and chain semantics live in the package README;
 * rationale lives in the auto-continue Agent Note.
 * @module @deepseek-ai/dsh-auto-continue
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { lastAttemptTruncated } from './truncation.ts'

export const name = 'auto-continue'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time check in `apply` (misconfiguration fails loud: a non-integer or a
 * value below 1 throws at plugin load, never a silent fall-back).
 */
export interface Config {
  /** Consecutive continuations allowed before the turn closes truncated (default 8). */
  maxConsecutive?: number
}

export const Config: z<Config> = z.object({
  maxConsecutive: z.number().default(8),
})

/**
 * The `{kind:'plugin'}` source stamped on every continuation this plugin
 * steers — the label is load-bearing (an unlabeled context would render as a
 * user prompt in derived history).
 */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'auto-continue' }

/** The one continuation instruction, same text on every continuation. */
const CONTINUATION_PROMPT =
  'Your previous response was cut off at the model output-token limit before it ' +
  'finished. Continue that response from exactly where it stopped: do not repeat ' +
  'or rephrase content the conversation already holds. If a tool call was cut off ' +
  'before it completed, issue the complete tool call again.'

/**
 * Install the continuation listeners.
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}; `maxConsecutive` is re-checked fail-loud here.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the field is set after validation.
  const maxConsecutive = config.maxConsecutive as number
  if (!Number.isInteger(maxConsecutive) || maxConsecutive < 1) {
    throw new Error(
      `auto-continue: invalid maxConsecutive ${maxConsecutive} — must be an integer >= 1`,
    )
  }

  const consecutive = new WeakMap<Agent, number>()

  ctx.on('agent/turn-stopping', ({ agent, turn, reason }) => {
    if (reason.kind !== 'max-tokens') return
    // Delegated one-shot agents stop at their limit by contract: the subagent
    // run reports the recorded max-tokens ending to its parent even when a
    // continuation would complete the work, so continuing one only spends its
    // delegation budget.
    if ((agent.session.header.delegationDepth ?? 0) > 0) return
    if (!lastAttemptTruncated(agent.session.snapshotEvents(), turn)) return
    const count = (consecutive.get(agent) ?? 0) + 1
    if (count > maxConsecutive) return
    consecutive.set(agent, count)
    const message: UserMessage = createUserMessage({
      content: [{ type: 'text', text: CONTINUATION_PROMPT }],
      source: {
        ...PLUGIN_SOURCE,
        form: 'notice',
        summary: `output ceiling reached — continuing (${count}/${maxConsecutive})`,
      },
    })
    agent.steer(message)
  })

  // A user interjection changes the context; continuations across it are not
  // one run. Pure reset hook: always delegates (attaching nothing, vetoing
  // nothing).
  ctx.on('agent/pre-step', ({ agent, messages }, next): Promise<PreStepDecision> => {
    if (messages.some(message => message.source.kind === 'user')) consecutive.delete(agent)
    return next()
  })
}
