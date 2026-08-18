/**
 * Context-scoped rules: auto-discover `.dsh/rules/` and `.claude/rules/`
 * markdown files from the session workspace, apply YAML frontmatter path
 * scoping, and inject matching rules into the system prompt via
 * `ctx.systemPrompt.context()`. Modelled after Claude Code's rules cascade
 * but implemented natively in Cordis without any external dependency.
 *
 * Discovery order (later overrides earlier on same name):
 *   1. `~/.dsh/rules/*.md`            — global user rules
 *   2. `<session.cwd>/.dsh/rules/*.md` — project rules (DSH-native)
 *   3. `<session.cwd>/.claude/rules/*.md` — project rules (CC-compatible)
 *
 * YAML frontmatter (optional):
 * ```yaml
 * ---
 * paths:
 *   - "packages/shell/**"
 *   - "*.sh"
 * ---
 * Rule body text…
 * ```
 * When `paths` is absent the rule is always injected.
 * When `paths` is present the rule is injected only when at least one of the
 * session's most-recently touched files matches a glob.
 *
 * @module @deepseek-ai/dsh-context-rules
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'context-rules'
export const inject = ['systemPrompt']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One discovered and parsed rule file. */
interface ContextRule {
  /** Display name derived from the filename (without extension). */
  name: string
  /** Full path the rule was read from. */
  path: string
  /** Glob patterns that scope the rule. Empty ⟹ always inject. */
  paths: string[]
  /** The rule body text after stripping the frontmatter block. */
  body: string
}

/** Plugin config. */
export interface Config {
  /**
   * Extra rule directories to scan beyond the standard locations.
   * Each entry is an absolute path to a directory containing `*.md` files.
   */
  extraDirs?: string[]
  /**
   * Maximum number of rules to inject per system-prompt assembly. Excess rules
   * (sorted by name) are silently truncated. Default: 20.
   */
  maxRules?: number
}

export const Config: z<Config> = z.object({
  extraDirs: z.array(z.string()),
  maxRules: z.number().default(20),
})

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const FM_DELIM = /^---\s*$/

/**
 * Strip a leading YAML frontmatter block from `text` and return the `paths`
 * array declared inside it (empty when the block is absent or `paths` is not
 * an array of strings).
 */
function parseFrontmatter(text: string): { paths: string[]; body: string } {
  const lines = text.split('\n')
  if (!FM_DELIM.test(lines[0] ?? '')) return { paths: [], body: text }
  const closeIdx = lines.slice(1).findIndex(l => FM_DELIM.test(l))
  if (closeIdx === -1) return { paths: [], body: text }
  const fmLines = lines.slice(1, closeIdx + 1)
  const body = lines.slice(closeIdx + 2).join('\n').trimStart()
  // Minimal YAML `paths:` extraction without a full YAML parser.
  const paths: string[] = []
  let inPaths = false
  for (const line of fmLines) {
    if (/^paths\s*:/.test(line)) { inPaths = true; continue }
    if (inPaths) {
      const m = /^\s+-\s+"?([^"]+)"?\s*$/.exec(line)
      const pathVal = m?.[1]
      if (pathVal !== undefined) { paths.push(pathVal.trim()); continue }
      if (/^\S/.test(line)) inPaths = false
    }
  }
  return { paths, body }
}

// TODO(context-rules-touched-files): restore glob matching helpers when the
// per-session touched-files registry is wired in.

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Read all `*.md` files from `dir`, parse frontmatter, return rules. */
function scanDir(dir: string): ContextRule[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(f => extname(f) === '.md')
      .sort()
      .map((f) => {
        const path = join(dir, f)
        const text = readFileSync(path, 'utf8')
        const { paths, body } = parseFrontmatter(text)
        return { name: f.slice(0, -3), path, paths, body }
      })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function apply(ctx: Context, config: Config): void {
  const maxRules = config.maxRules ?? 20

  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.context({
      name: 'context-rules',
      // After agent identity but before tool specs so rules shape tool use.
      order: 60,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined) return ''
        const cwd = agent.session.header.cwd
        if (cwd === undefined) return ''

        // Discover from standard cascade: global → project DSH → project CC → extras.
        const dirs = [
          join(homedir(), '.dsh', 'rules'),
          join(cwd, '.dsh', 'rules'),
          join(cwd, '.claude', 'rules'),
          ...(config.extraDirs ?? []),
        ]
        const allRules: ContextRule[] = dirs.flatMap(scanDir)

        // Deduplicate by name (last declaration wins, i.e. project over global).
        const byName = new Map<string, ContextRule>()
        for (const rule of allRules) byName.set(rule.name, rule)

        // Apply path-scope filtering when a touched-file list is available.
        // In this release no source provides a touched-file list, so all rules
        // are always injected. TODO(context-rules-touched-files): wire in a
        // per-session touched-files registry so scoped rules narrow by file.
        const applicable = [...byName.values()]

        const selected = applicable.slice(0, maxRules)
        if (selected.length === 0) return ''

        return selected.map(r => `## Rule: ${r.name}\n\n${r.body.trim()}`).join('\n\n---\n\n')
      },
    })
  })
}
