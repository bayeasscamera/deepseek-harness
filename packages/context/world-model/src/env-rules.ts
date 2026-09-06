/**
 * Environment rules registry & policy validator.
 *
 * Capabilities:
 * 1. **Declarative rules catalogue**: capabilities, constraints, permissions, resources.
 * 2. **Runtime telemetry discovery**: gathers live OS, platform, Node, and memory data.
 * 3. **Action pre-flight policy evaluation**: validates planned tool calls against active constraints.
 * 4. **Dynamic system prompt formatting**: injects a coherent snapshot of the execution environment.
 *
 * @module
 */

import { arch, cpus, platform, totalmem, freemem } from 'node:os'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Category for an environment rule. */
export type RuleCategory = 'capability' | 'constraint' | 'permission' | 'resource'

/** Severity when an action violates a rule. */
export type ViolationSeverity = 'error' | 'warning'

/** One declared rule in the environment. */
export interface EnvRule {
  /** Stable, namespaced identifier — e.g. `"tool:run_command"`. */
  readonly id: string
  /** Broad category for grouping in reports. */
  readonly category: RuleCategory
  /** Human-readable description injected into the system prompt. */
  readonly description: string
  /** Whether the rule is currently active. Inactive rules are tracked but not enforced. */
  active: boolean
  /** Arbitrary key/value annotations (e.g. max-concurrency, platform restriction). */
  readonly metadata: Readonly<Record<string, string>>
}

/** Result of validating an action against active environment rules. */
export interface ActionValidationResult {
  /** True if no blocking constraint is violated. */
  readonly allowed: boolean
  /** Blocking constraint violations that must prevent execution. */
  readonly violations: string[]
  /** Non-blocking advisories. */
  readonly warnings: string[]
}

/** Live environment telemetry snapshot. */
export interface RuntimeTelemetry {
  readonly platform: string
  readonly arch: string
  readonly nodeVersion: string
  readonly cpuCount: number
  readonly totalMemoryMb: number
  readonly freeMemoryMb: number
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Mutable registry of environment rules for the current process lifetime. */
export class EnvRuleRegistry {
  readonly #rules = new Map<string, EnvRule>()

  /**
   * Register or overwrite a rule.
   * @param rule - environment rule definition to register.
   * @returns a disposer function that removes the rule when called.
   */
  register(rule: EnvRule): () => void {
    this.#rules.set(rule.id, rule)
    return () => { this.#rules.delete(rule.id) }
  }

  /**
   * Activate or deactivate a rule by id.
   * @param id - rule identifier to update.
   * @param active - whether the rule is active.
   */
  setActive(id: string, active: boolean): void {
    const rule = this.#rules.get(id)
    if (rule !== undefined) rule.active = active
  }

  /**
   * Return all rules, optionally filtered to active-only.
   * @param activeOnly - if true, returns only currently active rules.
   * @returns list of matching environment rules.
   */
  list(activeOnly = false): readonly EnvRule[] {
    const all = [...this.#rules.values()]
    return activeOnly ? all.filter(r => r.active) : all
  }

  /**
   * Return active rule by ID if present.
   * @param id - unique rule identifier.
   * @returns the rule definition or undefined if not found.
   */
  getRule(id: string): EnvRule | undefined {
    return this.#rules.get(id)
  }

  /**
   * Read current runtime telemetry snapshot.
   * @returns telemetry snapshot containing platform, CPU, and memory details.
   */
  getTelemetry(): RuntimeTelemetry {
    return {
      platform: platform(),
      arch: arch(),
      nodeVersion: process.version,
      cpuCount: cpus().length,
      totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(freemem() / 1024 / 1024),
    }
  }

  /**
   * Validate a planned action against active constraints and permissions.
   *
   * ADVISORY ONLY: nothing in the harness enforces the returned verdict. The
   * `/env check` command renders it for the human, and callers that choose to
   * consult it may veto their own actions; the plugin does not intercept the
   * tool pipeline with it.
   *
   * @param action - tool or command action name.
   * @param args - payload arguments passed to the action.
   * @returns validation result with allowed flag, blocking violations, and warnings.
   */
  validateAction(action: string, args: Record<string, unknown>): ActionValidationResult {
    const violations: string[] = []
    const warnings: string[] = []

    const toStr = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')

    // 1. Filesystem write permission check
    const isWriteAction = /^(write_to_file|replace_file_content|delete_file|create_file|patch_file)$/.test(action)
    if (isWriteAction) {
      const writePermission = this.getRule('permission:filesystem-write')
      if (writePermission !== undefined && !writePermission.active) {
        violations.push('Action forbidden: the \'permission:filesystem-write\' permission is disabled.')
      }
    }

    // 2. Credential exposure constraint
    const noCreds = this.getRule('constraint:no-credential-commit')
    if (noCreds?.active) {
      const targetPath = toStr(args['path'] ?? args['TargetFile'] ?? args['target'])
      const content = toStr(args['CodeContent'] ?? args['ReplacementContent'] ?? args['CommandLine'])

      if (/\.env(\..+)?$/.test(targetPath) && isWriteAction) {
        warnings.push(`Warning: writing to a sensitive environment file (${targetPath}). Make sure no secrets are committed.`)
      }

      if (/(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z-_]{35})/.test(content)) {
        violations.push('Constraint \'no-credential-commit\' violation: an API key or secret token is present in the content.')
      }
    }

    // 3. ESM-only constraint
    const esmOnly = this.getRule('constraint:esm-only')
    if (esmOnly?.active && isWriteAction) {
      const targetPath = toStr(args['path'] ?? args['TargetFile'] ?? args['target'])
      if (targetPath.endsWith('.cjs')) {
        warnings.push('Warning: creating a .cjs file while the \'esm-only\' constraint is active.')
      }
    }

    return {
      allowed: violations.length === 0,
      violations,
      warnings,
    }
  }

  /**
   * Return a structured text description of the active environment.
   * @returns formatted environment summary string for prompt context.
   */
  describeEnvironment(): string {
    const active = this.list(true)
    if (active.length === 0) return ''

    const categories: RuleCategory[] = ['capability', 'permission', 'constraint', 'resource']
    const categoryLabels: Record<RuleCategory, string> = {
      capability: 'Capabilities',
      permission: 'Permissions',
      constraint: 'Constraints',
      resource: 'Resources',
    }
    const sections: string[] = []

    for (const cat of categories) {
      const group = active.filter(r => r.category === cat)
      if (group.length === 0) continue
      const header = categoryLabels[cat]
      const items = group.map(r => `- **${r.id}**: ${r.description}`).join('\n')
      sections.push(`### ${header}\n${items}`)
    }

    const t = this.getTelemetry()
    const telemetrySection = `### Runtime Telemetry\n- **Platform**: ${t.platform} (${t.arch}) | Node: ${t.nodeVersion} | Memory: ${t.freeMemoryMb} MB free / ${t.totalMemoryMb} MB total`

    return `## Environment Rules\n\n${sections.join('\n\n')}\n\n${telemetrySection}`
  }
}

// ---------------------------------------------------------------------------
// Built-in rules seeded at startup
// ---------------------------------------------------------------------------

/**
 * Seed a registry with the built-in rules that apply to every DeepSeek Harness session.
 * @param registry - registry instance to seed.
 */
export function seedBuiltinRules(registry: EnvRuleRegistry): void {
  const builtins: EnvRule[] = [
    {
      id: 'constraint:no-credential-commit',
      category: 'constraint',
      description: 'Never commit or log secrets, API keys, or credentials. Environment variables and .env files are excluded from all outputs.',
      active: true,
      metadata: {},
    },
    {
      id: 'constraint:esm-only',
      category: 'constraint',
      description: 'All TypeScript/JavaScript in this project is ESM. CJS-only imports are forbidden.',
      active: true,
      metadata: {},
    },
    {
      id: 'constraint:strict-typescript',
      category: 'constraint',
      description: 'TypeScript strict mode with noImplicitAny is enforced. Every remaining `any` must be justified.',
      active: true,
      metadata: {},
    },
    {
      id: 'capability:tool-execution',
      category: 'capability',
      description: 'The agent can execute registered tools (shell commands, file operations, web fetch, etc.).',
      active: true,
      metadata: {},
    },
    {
      id: 'capability:context-store',
      category: 'capability',
      description: 'The agent can read and write hierarchical L0/L1/L2 context entries in the local context store.',
      active: true,
      metadata: {},
    },
    {
      id: 'capability:world-model',
      category: 'capability',
      description: 'The agent maintains a world model: environment rules, persistent state, and consequence tracking per tool execution.',
      active: true,
      metadata: { version: '2' },
    },
    {
      id: 'permission:filesystem-read',
      category: 'permission',
      description: 'The agent may read files within the session workspace without approval.',
      active: true,
      metadata: {},
    },
    {
      id: 'permission:filesystem-write',
      category: 'permission',
      description: 'The agent may write files within the session workspace; destructive operations require confirmation when interactive.',
      active: true,
      metadata: {},
    },
    {
      id: 'resource:session-cwd',
      category: 'resource',
      description: 'The working directory for the current session is the root anchor for all relative paths.',
      active: true,
      metadata: {},
    },
  ]

  for (const rule of builtins) registry.register(rule)
}
