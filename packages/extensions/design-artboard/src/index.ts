/**
 * UI design artboard preview extension: creates, manages and previews
 * interactive HTML/Tailwind artboards before committing changes to code.
 *
 * @module @deepseek-ai/dsh-design-artboard
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Plugin name. */
export const name = 'design-artboard'
/** Required Cordis services. */
export const inject = ['commands', 'tools']

/** Default storage directory for rendered artboard preview files. */
export const DEFAULT_ARTBOARD_DIR = '.dsh/artboards'

/**
 * Preview cap for `/design show` output: an artboard file is Tailwind
 * boilerplate plus markup, so echoing it whole would dominate the command
 * transcript. 1000 characters is enough to identify the component, and the
 * full source stays available at the reported file path.
 */
const SHOW_PREVIEW_CHARS = 1000

/** Stem characters an artboard file name may carry after sanitizing. */
const SAFE_STEM = /^[a-z0-9_-]+$/

/** Characters replaced with `_` by the save-side name sanitizer. */
const UNSAFE_STEM_CHARS = /[^a-z0-9_-]/g

/**
 * Rejection message for a raw artboard name outside the safe stem alphabet.
 * @param name - rejected raw name, quoted verbatim.
 * @returns the user-facing rejection text.
 */
function invalidNameMessage(name: string): string {
  return `Invalid artboard name "${name}": names may contain only lowercase letters, digits, hyphens, and underscores.`
}

/** Plugin config. */
export interface Config {
  /** Directory holding the HTML artboard files, resolved against the process cwd. Default: `.dsh/artboards`. */
  artboardDir?: string
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  artboardDir: z.string().default(DEFAULT_ARTBOARD_DIR),
})

/** Metadata for one stored artboard. */
export interface ArtboardMetadata {
  /** Identifier name of the artboard. */
  name: string
  /** Human readable title. */
  title: string
  /** Last modification time of the file in milliseconds. */
  updatedAt: number
  /** File path where the HTML artifact is saved. */
  filePath: string
}

/**
 * Normalize an artboard name to its on-disk file stem: lowercased with every
 * character outside [a-z0-9_-] collapsed to `_`, so the stem can never carry
 * path separators or `..` segments.
 * @param name - raw component name.
 * @returns the sanitized file stem.
 */
export function artboardStem(name: string): string {
  return name.toLowerCase().replace(UNSAFE_STEM_CHARS, '_')
}

/**
 * Resolve one artboard's file path from a raw name for reading. Only names
 * the save side can produce — already-sanitized stems — resolve; anything
 * else (a `../` traversal, a path separator, an uppercase or spaced name)
 * fails loud instead of reading a differently named file.
 * @param name - raw artboard name as supplied to `/design show`.
 * @param artboardDir - resolved artboard directory.
 * @returns the artboard file path inside the directory.
 * @throws when the name is not a safe stem.
 */
export function resolveArtboardPath(name: string, artboardDir: string): string {
  const stem = name.toLowerCase()
  if (!SAFE_STEM.test(stem)) {
    throw new Error(invalidNameMessage(name))
  }
  return join(resolve(artboardDir), `${stem}.html`)
}

/**
 * Generate a standalone HTML container with Tailwind CSS script for immediate preview.
 * @param title - page title displayed in the preview header.
 * @param bodyContent - raw HTML content of the component.
 * @returns complete HTML markup string.
 */
export function wrapArtboardHtml(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-950 text-slate-100">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Artboard Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-full p-6 antialiased flex flex-col items-center justify-center">
  <div class="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-8 backdrop-blur">
    <div class="flex items-center justify-between pb-6 mb-6 border-b border-slate-800">
      <div class="flex items-center space-x-3">
        <span class="inline-block w-3.5 h-3.5 rounded-full bg-emerald-500 animate-pulse"></span>
        <h1 class="text-xl font-bold tracking-tight text-white">${title}</h1>
      </div>
      <span class="text-xs px-2.5 py-1 bg-slate-800 text-slate-400 font-mono rounded-md">Artboard Preview</span>
    </div>
    <div class="artboard-canvas">
      ${bodyContent}
    </div>
  </div>
</body>
</html>`
}

/**
 * List all available artboards in the project.
 * @param artboardDir - directory holding the HTML artboard files.
 * @returns list of discovered artboard metadata, newest information taken from each file's mtime.
 */
export function listArtboards(artboardDir: string): ArtboardMetadata[] {
  const dir = resolve(artboardDir)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(f => f.endsWith('.html'))
  return files.map((file) => {
    const stem = file.replace(/\.html$/, '')
    const filePath = join(dir, file)
    return {
      name: stem,
      title: stem.replace(/[-_]/g, ' '),
      updatedAt: statSync(filePath).mtimeMs,
      filePath,
    }
  })
}

/**
 * Save an artboard to disk.
 * @param name - component identifier name, sanitized to a file-safe stem.
 * @param content - HTML markup content.
 * @param title - optional human title used by the preview wrapper.
 * @param artboardDir - target directory to store the preview file.
 * @returns absolute file path of the saved artboard.
 */
export function saveArtboard(name: string, content: string, title: string | undefined, artboardDir: string): string {
  const dir = resolve(artboardDir)
  mkdirSync(dir, { recursive: true })
  const stem = artboardStem(name)
  const filePath = join(dir, `${stem}.html`)
  const html = content.includes('<!DOCTYPE html>')
    ? content
    : wrapArtboardHtml(title ?? stem, content)
  writeFileSync(filePath, html, 'utf8')
  return filePath
}

/**
 * Mount the design artboard command and tool extension.
 * @param ctx - Cordis context carrying commands and tools services.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // The validated Config fills the schema default; the assert only bridges
  // the optional input type. One explicit resolve here — every handler
  // receives the directory, none defaults it internally.
  const artboardDir = resolve(config.artboardDir as string)

  ctx.effect(() => ctx.commands.register({
    name: 'design',
    description: 'Create, list, or preview interactive UI artboards before wiring them into code.',
    input: {
      hint: '[new <name> <html_code> | list | show <name> | export]',
    },
    handler: (invocation: CommandInvocation): CommandResult => {
      const parts = invocation.rawInput.trim().split(/\s+/).filter(token => token.length > 0)
      const [action, targetName, ...rest] = parts

      if (!action || action === 'list') {
        const artboards = listArtboards(artboardDir)
        if (artboards.length === 0) {
          return {
            kind: 'success',
            text: `No UI artboards found in ${artboardDir}. Use \`/design new <name>\` to create one.`,
          }
        }
        const list = artboards.map(a => `- **${a.name}** — \`${a.filePath}\``).join('\n')
        return {
          kind: 'success',
          text: `### Available UI artboards:\n\n${list}\n\n*To preview:* \`/design show <name>\``,
        }
      }

      if (action === 'new' && targetName) {
        const stem = artboardStem(targetName)
        const content = rest.join(' ')
          || `<div class="p-8 text-center"><h2 class="text-lg font-semibold">New component: ${stem}</h2><p class="text-slate-400 mt-2">Edit this content in ${artboardDir}/${stem}.html</p></div>`
        const path = saveArtboard(stem, content, undefined, artboardDir)
        return {
          kind: 'success',
          text: `Artboard **${stem}** created.\nFile: \`${path}\``,
        }
      }

      if (action === 'show' && targetName) {
        // Reads accept exactly the names the save side can produce; a `../`
        // escape, separator, or spaced name is rejected before any file is
        // touched. resolveArtboardPath re-asserts the same predicate for
        // direct callers.
        if (!SAFE_STEM.test(targetName.toLowerCase())) {
          return { kind: 'error', text: invalidNameMessage(targetName) }
        }
        const filePath = resolveArtboardPath(targetName, artboardDir)
        if (!existsSync(filePath)) {
          return { kind: 'error', text: `Artboard **${targetName}** not found in ${artboardDir}.` }
        }
        const content = readFileSync(filePath, 'utf8')
        const preview = content.length > SHOW_PREVIEW_CHARS
          ? `${content.slice(0, SHOW_PREVIEW_CHARS)}...`
          : content
        return {
          kind: 'success',
          text: `### Artboard: ${targetName}\n\n\`\`\`html\n${preview}\n\`\`\`\n\nFull source file: \`${filePath}\``,
        }
      }

      return {
        kind: 'success',
        text: 'Usage: `/design list` | `/design new <name> [html]` | `/design show <name>`',
      }
    },
  }), 'design-artboard: command')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'design_create_artboard',
    description: 'Create a new HTML/Tailwind UI artboard in the configured artboard directory for visual preview.',
    parameters: {
      name: { type: 'string', required: true, description: 'Identifying name of the component or page (e.g. login_card, dashboard_stat).' },
      title: { type: 'string', description: 'Human-readable artboard title.' },
      content: { type: 'string', required: true, description: 'HTML/Tailwind markup of the component.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          filePath: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Artboard created: ${value.filePath}`,
      }],
    },
    execute: (args: { name: string; title?: string; content: string }) => {
      const filePath = saveArtboard(args.name, args.content, args.title, artboardDir)
      return Promise.resolve({ success: true, filePath })
    },
  })), 'design-artboard: tool')
}
