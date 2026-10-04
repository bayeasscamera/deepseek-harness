/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** Summary of one skill as returned by the global settings skill-list endpoint. */
export interface SkillListEntry {
  /** Kebab-case skill identifier. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Origin bucket (e.g. `'user-dsh'`, `'user-agents'`). */
  readonly source: string
  /** Absolute path to the skill's own directory when the provider has one. */
  readonly path?: string
}

/** Why one discovered entry yielded no skill; mirrors the provider's reason vocabulary. */
export type SkillSkipReason =
  /** A directory holding `SKILL.md` files below its own level, which discovery does not descend into. */
  | 'nested-skills'
  /** The file carries frontmatter this runtime cannot parse. */
  | 'invalid-frontmatter'
  /** The frontmatter parses but omits `name` or `description`. */
  | 'missing-name'
  /** The declared name is not the kebab-case skill grammar. */
  | 'invalid-name'
  /** The entry is readable by name but its content could not be read. */
  | 'unreadable'

/** One entry the skill roots hold that discovery could not turn into a skill. */
export interface SkillSkipEntry {
  /** Absolute path of the entry that yielded no skill. */
  readonly path: string
  /** Why it yielded no skill. */
  readonly reason: SkillSkipReason
  /** Skill files (bundle manifests and flat markdown) counted below the entry, for `nested-skills`. */
  readonly nested?: number
  /** Whether the count stopped at its scan bound, so the entry holds more. */
  readonly truncated?: boolean
}

/** The deployment's skill catalog plus the entries discovery could not read. */
export interface SkillInventoryValue {
  /** Every discovered skill, in catalog order. */
  readonly skills: readonly SkillListEntry[]
  /** Entries that yielded no skill, so the tab can say why one is missing. */
  readonly skipped: readonly SkillSkipEntry[]
}

/** Result of opening the user skill directory in the native file manager. */
export type SkillDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** Why an import was rejected; the UI maps each code to a localized cause. */
export type SkillImportRejection = 'missing-skill-file' | 'invalid-frontmatter' | 'exists'

/** Result of importing one skill folder into the user skill directory. */
export type SkillImportValue =
  | { readonly imported: true; readonly name: string; readonly path: string }
  | { readonly imported: false; readonly reason: SkillImportRejection; readonly detail: string }
