/**
 * Model-facing presentation tool: a deck the model describes becomes a real
 * `.pptx` in the session workspace.
 *
 * The tool owns the model contract — a title, an optional subtitle, and the
 * content slides — and the write; the package it writes is
 * {@link buildPresentation}'s business. The bytes go through `ctx.fs.writeBytes`
 * so the same resolution, guards, and sandbox fence apply as to any other
 * mutation: this tool offers no escalation of its own, and a policy denial is
 * reported with the shared sandbox marker rather than retried another way.
 *
 * @module @deepseek-ai/dsh-tool-slides
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import { canonicalPath, sandboxDenialMarker, type SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { buildPresentation, type Deck, type DeckSlide } from './pptx.ts'

/** Cordis plugin name. */
export const name = 'tool-slides'

/** Required services: the tool registry and the filesystem seam. */
export const inject = ['tools', 'fs']

const description = 'Write a PowerPoint presentation (.pptx) into the session workspace from a structured outline. '
  + 'Use it when the user asks for slides, a deck, or a presentation. '
  + 'The deck opens with a title slide built from title and subtitle, then one slide per entry: '
  + 'layout "bullets" draws a heading with bullet lines, layout "section" draws a divider heading. '
  + 'The template picks the deck\'s colour scheme, fonts, and background: "default" (neutral light), "dark" (dark background, light text), or "print" (black on white, serif, for handouts). '
  + 'The file is written as binary content, overwrites an existing file at that path, and appears in the workspace for the user to open.'

/**
 * The provider options one call resolves with: the policy's workspace root when
 * a mutation carries one, else the calling session's workspace, canonicalized
 * so a symlinked root keeps one filesystem identity across the write.
 * @param exec - the tool-execution context supplying the session and cancellation.
 * @param policyWorkspaceRoot - the sandbox policy's root for this call, when it has one.
 * @returns the resolution options the filesystem backend receives.
 */
function resolveOptions(
  exec: ToolExecution,
  policyWorkspaceRoot: string | undefined,
): { cwd?: string; signal?: AbortSignal } {
  const cwd = policyWorkspaceRoot ?? exec.agent?.session.header.cwd
  return {
    ...cwd === undefined ? {} : { cwd: canonicalPath(cwd) },
    signal: exec.signal,
  }
}

/**
 * Render a sandbox denial the way every enforcing family reports one, so the
 * model recognizes a policy refusal instead of reading it as a tool bug.
 * @param error - the failure the backend raised.
 * @param policy - the policy this call ran under, when it had one.
 * @returns the failure to throw: the marker-wrapped denial, or the original error.
 */
function reportDenial(error: unknown, policy: SandboxExecutionPolicy | undefined): unknown {
  if (!(error instanceof FsError) || error.code !== 'FS_SANDBOX_DENIED') return error
  // A denial only arises under a confining backend, whose call path resolves a
  // policy before the mutation.
  const mode = (policy as SandboxExecutionPolicy).mode
  return new FsError(`${sandboxDenialMarker(mode)}\n${error.message}`, 'FS_SANDBOX_DENIED', { cause: error })
}

/**
 * Register the `write_presentation` tool.
 * @param ctx - plugin context carrying the tool registry and the filesystem seam.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'write_presentation',
    description,
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path of the .pptx to write, resolved by the filesystem backend (a relative path resolves against the session workspace).',
      },
      title: {
        type: 'string',
        required: true,
        description: 'Title of the presentation, drawn on the first slide.',
      },
      subtitle: {
        type: 'string',
        description: 'Subtitle drawn under the title on the first slide.',
      },
      template: {
        type: 'string',
        enum: ['default', 'dark', 'print'],
        description: 'Template the deck is built on: "default" (neutral light, the default), "dark" (dark background, light text), or "print" (black on white, serif).',
      },
      slides: {
        type: 'array',
        required: true,
        description: 'Content slides, in order, after the title slide.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            layout: {
              type: 'string',
              required: true,
              enum: ['bullets', 'section'],
              description: 'How the slide is drawn: "bullets" for a heading with bullet lines, "section" for a divider heading.',
            },
            title: {
              type: 'string',
              required: true,
              description: 'Heading of the slide.',
            },
            bullets: {
              type: 'array',
              description: 'Bullet lines, one paragraph each; read by the "bullets" layout.',
              items: { type: 'string' },
            },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true, description: 'The path the presentation was written to.' },
          operation: { type: 'string', required: true, enum: ['create', 'update'], description: 'Whether the write created the file or replaced it.' },
          bytes: { type: 'number', required: true, description: 'Size of the written package, in bytes.' },
          slides: { type: 'number', required: true, description: 'How many slides the deck holds, title slide included.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<path>${value.path}</path>
<type>file</type>
<content>
${value.operation === 'create' ? 'Created' : 'Updated'} presentation with ${value.slides} slides (${value.bytes} bytes)
</content>`,
      }],
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Write ${args.file_path}`,
        kind: 'edit',
        locations: [{ path: args.file_path }],
      }
    },
    async execute(args, exec) {
      const deck: Deck = {
        title: args.title,
        ...args.subtitle === undefined ? {} : { subtitle: args.subtitle },
        template: args.template ?? 'default',
        slides: args.slides.map((slide): DeckSlide => ({
          layout: slide.layout,
          title: slide.title,
          ...slide.bullets === undefined ? {} : { bullets: slide.bullets },
        })),
      }
      const bytes = buildPresentation(deck)
      const policy = ctx.get('sandboxPolicy')?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })
      const target = await ctx.fs.resolve(args.file_path, resolveOptions(exec, policy?.workspaceRoot))
      let outcome
      try {
        outcome = await ctx.fs.writeBytes(target, bytes, undefined, exec.signal, policy)
      } catch (error: unknown) {
        throw reportDenial(error, policy)
      }
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, exec)
      return {
        path: target.displayPath,
        operation: outcome.operation,
        bytes: outcome.bytes,
        slides: deck.slides.length + 1,
      }
    },
  }))
}
