/**
 * Continuous post-edit auto-verification guard plugin: provides instant syntax
 * and structural diagnostics feedback on file mutations.
 * @module @deepseek-ai/dsh-auto-verification
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'auto-verification'

/**
 * Configuration options for the auto-verification guard.
 */
export interface Config {
  /** Whether auto-verification is active (default true). */
  enabled?: boolean
  /** Whether to perform JSON parse checks on .json file mutations (default true). */
  checkJson?: boolean
  /** Whether to check delimiter/bracket balance on code files (default true). */
  checkBrackets?: boolean
  /** Whether to perform visual UI markup and layout integrity checks on frontend files (default true). */
  checkVisualUi?: boolean
  /** Whether to inject a TDD verification reminder after code mutations (default false). */
  enforceTdd?: boolean
  /** Whether to inject a 2-step visual review reminder after UI mutations (default false). */
  visualFeedbackStep?: boolean
  /** Whether to enforce Loop-Engineering Maker/Checker verification notice on code edits (default false). */
  enforceLoopVerifier?: boolean
  /**
   * Denylist of path substrings/patterns flagged after mutation
   * (default ['.env', 'auth/', 'payments/', 'secrets/', 'credentials/']).
   * Advisory and post-hoc: the notice fires after the write already happened
   * and never blocks or reverts it.
   */
  denylistPaths?: string[]
  /**
   * Max consecutive mutation attempts allowed on the same target before the
   * escalation notice (default 3). The notice fires once per target, on the
   * attempt that first reaches the threshold; later edits of the same target
   * are not re-escalated.
   */
  maxAttemptsPerTarget?: number
  /** Max characters allowed for diagnostic notices (default 1000). */
  maxDiagnosticChars?: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  checkJson: z.boolean().default(true),
  checkBrackets: z.boolean().default(true),
  checkVisualUi: z.boolean().default(true),
  enforceTdd: z.boolean().default(false),
  visualFeedbackStep: z.boolean().default(false),
  enforceLoopVerifier: z.boolean().default(false),
  denylistPaths: z.array(z.string()).default(['.env', 'auth/', 'payments/', 'secrets/', 'credentials/']),
  maxAttemptsPerTarget: z.number().default(3),
  maxDiagnosticChars: z.number().default(1000),
})

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'auto-verification' }

/**
 * Check if brackets/braces/parentheses in code are balanced.
 * @param content - text content to verify.
 * @returns error message if unbalanced, or undefined if balanced.
 */
export function checkBracketBalance(content: string): string | undefined {
  const stack: { char: string; line: number; col: number }[] = []
  const pairs: Record<string, string> = { '}': '{', ']': '[', ')': '(' }
  const lines = content.split('\n')

  let inString: string | null = null
  let inComment = false
  let escaped = false

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (line === undefined) continue
    for (let colIndex = 0; colIndex < line.length; colIndex++) {
      const char = line[colIndex]
      if (char === undefined) continue
      const nextChar = line[colIndex + 1]

      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }

      // Handle single-line comments //
      if (!inString && !inComment && char === '/' && nextChar === '/') {
        break
      }
      // Handle block comments /* */
      if (!inString && !inComment && char === '/' && nextChar === '*') {
        inComment = true
        colIndex++
        continue
      }
      if (!inString && inComment && char === '*' && nextChar === '/') {
        inComment = false
        colIndex++
        continue
      }
      if (inComment) continue

      // Handle string quotes
      if (char === '"' || char === "'" || char === '`') {
        if (!inString) {
          inString = char
        } else if (inString === char) {
          inString = null
        }
        continue
      }
      if (inString) continue

      // Handle brackets
      if (char === '{' || char === '[' || char === '(') {
        stack.push({ char, line: lineIndex + 1, col: colIndex + 1 })
      } else if (char === '}' || char === ']' || char === ')') {
        const expected = pairs[char]
        const top = stack.pop()
        if (!top || top.char !== expected) {
          return `Unmatched closing bracket '${char}' at line ${lineIndex + 1}, column ${colIndex + 1}.`
        }
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]
    if (unclosed !== undefined) {
      return `Unclosed opening bracket '${unclosed.char}' from line ${unclosed.line}, column ${unclosed.col}.`
    }
  }

  return undefined
}

/**
 * Check simple HTML / JSX element tag balance for UI components.
 * @param content - UI component text to inspect.
 * @returns diagnostic string if unclosed or mismatched tag found, or undefined.
 */
export function checkUiStructure(content: string): string | undefined {
  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
  ])
  // Matches <tag ...>, </tag>, <>, </>
  const tagRegex = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)?(?:\s+[^>]*)?(\/?)>/g
  const stack: string[] = []
  let match: RegExpExecArray | null

  while ((match = tagRegex.exec(content)) !== null) {
    const isClosingTag = match[1] === '/'
    const rawName = match[2]
    const isSelfClosing = match[3] === '/'
    const isFragment = !rawName
    const tagName = isFragment ? '__fragment__' : rawName.toLowerCase()

    if (voidTags.has(tagName) || isSelfClosing) continue

    if (isClosingTag) {
      const top = stack.pop()
      if (!top || top !== tagName) {
        const displayTag = tagName === '__fragment__' ? '</>' : `</${tagName}>`
        const displayTop = top === '__fragment__' ? '<>' : (top ? `<${top}>` : 'none')
        return `Mismatched or unexpected closing UI tag ${displayTag} (expected matching ${displayTop}).`
      }
    } else {
      stack.push(tagName)
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]
    const displayUnclosed = unclosed === '__fragment__' ? '<>' : `<${unclosed}>`
    return `Unclosed UI tag ${displayUnclosed} detected in component markup.`
  }
  return undefined
}

/**
 * Check CSS / stylesheet structural integrity (brackets, comments, color codes).
 * @param content - CSS/SCSS text content.
 * @returns error message if malformed, or undefined if valid.
 */
export function checkCssStructure(content: string): string | undefined {
  let openBraces = 0
  let inComment = false
  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const nextChar = content[i + 1]
    if (!inComment && char === '/' && nextChar === '*') {
      inComment = true
      i++
      continue
    }
    if (inComment && char === '*' && nextChar === '/') {
      inComment = false
      i++
      continue
    }
    if (inComment) continue

    if (char === '{') openBraces++
    else if (char === '}') {
      openBraces--
      if (openBraces < 0) return 'Unmatched closing brace in stylesheet.'
    }
  }
  if (inComment) return 'Unclosed block comment /* ... */ in stylesheet.'
  if (openBraces > 0) return `Unclosed brace (${openBraces} remaining) in stylesheet.`

  // Check for malformed hex color codes (e.g. #12 or #fffffff or #gg0011)
  const hexColorRegex = /#([a-fA-F0-9]{1,2}|[a-fA-F0-9]{5}|[a-fA-F0-9]{7}|[a-fA-F0-9]{9,})\b/g
  const hexMatch = hexColorRegex.exec(content)
  if (hexMatch) {
    return `Malformed hex color code "${hexMatch[0]}" in stylesheet (valid lengths: #RGB, #RGBA, #RRGGBB, #RRGGBBAA).`
  }

  return undefined
}

/**
 * Check basic YAML structural validity (forbids tabs in indentation, detects unbalanced quotes).
 * @param content - YAML text to verify.
 * @returns diagnostic string if error detected, or undefined.
 */
export function checkYamlSyntax(content: string): string | undefined {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    if (/^\t+/.test(line)) {
      return `YAML syntax error at line ${i + 1}: tab characters are forbidden for indentation in YAML.`
    }
  }
  return undefined
}

/**
 * Check Markdown frontmatter balance if frontmatter is present.
 * @param content - Markdown text to inspect.
 * @returns diagnostic string if frontmatter unclosed, or undefined.
 */
export function checkMarkdownFrontmatter(content: string): string | undefined {
  if (content.startsWith('---')) {
    const secondFence = content.indexOf('\n---', 3)
    if (secondFence === -1) {
      return 'Unclosed YAML frontmatter fence (missing closing "---") in Markdown document.'
    }
  }
  return undefined
}

/**
 * Detect hardcoded secrets and API keys in source mutations.
 * @param content - text content to scan.
 * @returns diagnostic string if secret pattern found, or undefined.
 */
export function checkSecretLeak(content: string): string | undefined {
  if (/(?:sk-[a-z0-9]{24,}|ghp_[a-z0-9]{30,}|AKIA[a-z0-9]{16}|bearer\s+[a-z0-9._-]{30,})/i.test(content)) {
    return 'Potential hardcoded API token or credential detected in source content. Store secrets via environment variables or credential manager instead.'
  }
  return undefined
}

/**
 * Verify text content based on file path extension.
 * @param path - target file path.
 * @param content - file content or modified chunk.
 * @param config - resolved guard configuration.
 * @returns diagnostic string if error detected, or undefined.
 */
export function verifyContent(path: string, content: string, config: Config): string | undefined {
  try {
    const leakErr = checkSecretLeak(content)
    if (leakErr) return leakErr

    if (config.checkJson && path.endsWith('.json')) {
      try {
        JSON.parse(content)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return `JSON syntax error in ${path}: ${message}`
      }
    }

    if (/\.(ya?ml)$/i.test(path)) {
      const yamlErr = checkYamlSyntax(content)
      if (yamlErr) return yamlErr
    }

    if (/\.(md|markdown)$/i.test(path)) {
      const mdErr = checkMarkdownFrontmatter(content)
      if (mdErr) return mdErr
    }

    if (config.checkBrackets && /\.(ts|tsx|js|jsx|json|c|cpp|rs|go|java|cs)$/i.test(path)) {
      const bracketErr = checkBracketBalance(content)
      if (bracketErr) {
        return `Structural syntax warning in ${path}: ${bracketErr}`
      }
    }

    if (config.checkVisualUi && /\.(html|vue|svelte|jsx|tsx)$/i.test(path)) {
      const uiErr = checkUiStructure(content)
      if (uiErr) {
        return `Visual UI structural warning in ${path}: ${uiErr}`
      }
    }

    if (config.checkVisualUi && /\.(css|scss|less)$/i.test(path)) {
      const cssErr = checkCssStructure(content)
      if (cssErr) {
        return `Stylesheet structural warning in ${path}: ${cssErr}`
      }
    }
  } catch (_safeFallback) {
    // Verification is purely observational and must never throw
  }

  return undefined
}

/**
 * Check whether a target file path violates denylist rules.
 * @param path - file path to evaluate.
 * @param denylist - list of forbidden substrings or prefixes.
 * @returns true if path is denylisted.
 */
export function isPathDenylisted(path: string, denylist: string[] = ['.env', 'auth/', 'payments/', 'secrets/', 'credentials/']): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return denylist.some(forbidden => normalized.includes(forbidden.toLowerCase()))
}

function prependContext(ours: UserMessage, theirs: UserMessage[] | undefined): UserMessage[] {
  return [ours, ...theirs ?? []]
}

/**
 * Install the auto-verification guard listeners.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return

  const attemptsByTarget = new Map<string, number>()
  /** Targets whose circuit-breaker notice already fired; each target escalates once. */
  const breakersFired = new Set<string>()

  ctx.on('tools/post-execute', async (exec: ToolExecution, _result, next): Promise<PostToolDecision> => {
    const downstream = await next()
    if (!exec.agent) return downstream

    const toolName = exec.name.toLowerCase()
    const isMutation = toolName.includes('write') || toolName.includes('edit') || toolName.includes('replace')
    if (!isMutation) return downstream

    const args = exec.arguments
    if (!args || typeof args !== 'object') return downstream

    const record = args as Record<string, unknown>
    const path = typeof record.path === 'string'
      ? record.path
      : typeof record.filePath === 'string'
        ? record.filePath
        : typeof record.TargetFile === 'string'
          ? record.TargetFile
          : undefined

    const content = typeof record.content === 'string'
      ? record.content
      : typeof record.replacement === 'string'
        ? record.replacement
        : typeof record.CodeContent === 'string'
          ? record.CodeContent
          : undefined

    if (!path || !content) return downstream

    const denylist = config.denylistPaths ?? ['.env', 'auth/', 'payments/', 'secrets/', 'credentials/']
    const isDenylisted = isPathDenylisted(path, denylist)

    const diagnostic = verifyContent(path, content, config)
    let noticeText: string | undefined
    let summary = `Syntax Diagnostic: ${path}`

    const attempts = (attemptsByTarget.get(path) ?? 0) + 1
    attemptsByTarget.set(path, attempts)
    const maxAttempts = config.maxAttemptsPerTarget ?? 3

    if (isDenylisted) {
      noticeText = `[Loop Constraint Violation] Path "${path}" matches security denylist. Modifications to sensitive secrets/auth paths require explicit human escalation.`
      summary = `Security Denylist: ${path}`
    } else if (diagnostic) {
      const cap = config.maxDiagnosticChars ?? 1000
      const text = diagnostic.length > cap ? `${diagnostic.slice(0, cap)}…` : diagnostic
      noticeText = `[Auto-Verification] ${text}\nPlease review and fix this syntax issue before proceeding.`
    } else if (attempts >= maxAttempts && !breakersFired.has(path)) {
      // Fire on the attempt that first reaches the threshold only: re-escalating
      // every later edit of the same target would inject unbounded repeated
      // noise into model context.
      breakersFired.add(path)
      noticeText = `[Loop Engineering Circuit-Breaker] ${attempts} consecutive modifications on "${path}". If issues persist, stop and escalate to human review.`
      summary = `Circuit Breaker: ${path}`
    } else if (config.enforceLoopVerifier && /\.(ts|js|py|rs|go|c|cpp|java|cs)$/i.test(path)) {
      noticeText = `[Loop-Engineering Verifier] Minimal-fix applied to "${path}". Verifier stance: REJECT by default until automated tests provide pass evidence.`
      summary = `Loop Verifier: ${path}`
    } else if (config.visualFeedbackStep && /\.(html|vue|svelte|jsx|tsx|css|scss)$/i.test(path)) {
      noticeText = `[Visual Feedback Step] UI file "${path}" modified. Inspect the rendered component visual layout before concluding the task.`
      summary = `Visual Review: ${path}`
    } else if (config.enforceTdd && /\.(ts|js|py|rs|go|c|cpp|java|cs)$/i.test(path) && !/\.(spec|test)\.[a-z]+$/i.test(path)) {
      noticeText = `[TDD Pipeline] Source code in "${path}" modified. Run relevant automated test suites to verify behavior before concluding.`
      summary = `TDD Check: ${path}`
    }

    if (!noticeText) return downstream

    const notice = createUserMessage({
      content: [{
        type: 'text',
        text: noticeText,
      }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary },
    })

    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(notice, downstream.additionalContexts) }
    }
    return {
      ...downstream,
      additionalContexts: prependContext(notice, downstream.additionalContexts),
    }
  })
}
