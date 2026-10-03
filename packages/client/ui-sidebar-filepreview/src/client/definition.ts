/**
 * Stage one of this package's registration: what the `preview` tab type IS.
 *
 * The type claims the `dsh-resource://file/` addresses whose basename carries a
 * rendered extension — pictures, PDFs, and HTML pages — at the `builtin` band,
 * above the text preview's `fallback` claim on every file address. Every other
 * file address still lands in the text viewer, which is why this type declares
 * no broad pattern of its own. `canOpen` refuses an address `parseFileAddress`
 * rejects at claim time, where an unclaimed address is the documented wiring
 * error.
 */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { PREVIEW_EXTENSIONS } from './media.ts'

/** The tab kind this package owns. */
export const PREVIEW_KIND = 'preview'

/** This implementation's identity in the tab system: the key its body registers under. */
export const PREVIEW_ID = '@deepseek-ai/dsh-client-ui-sidebar-filepreview'

/**
 * The tab title for one `file:` address: its decoded basename.
 *
 * The whole address stays the content identity, so two files with one name in
 * different directories are two tabs; only the chip text is shortened. Decoding
 * is per segment, matching how the address was built, so a name carrying `#`,
 * `?`, or a space reads as itself.
 * @param address - a `file:`-shaped address.
 * @returns the decoded last path segment, or the address itself when it has none.
 */
export function basenameOf(address: string): string {
  const name = address.slice(address.lastIndexOf('/') + 1)
  if (name === '') return address
  try {
    return decodeURIComponent(name)
  } catch {
    // A malformed percent sequence is still a name; showing it raw beats refusing the address.
    return name
  }
}

/**
 * The preview type's registry definition.
 * @returns the definition to register.
 */
export function previewDefinition(): SidebarRightTabDefinition {
  return {
    id: PREVIEW_ID,
    kind: PREVIEW_KIND,
    patterns: PREVIEW_EXTENSIONS.map(extension => `*.${extension}`),
    priority: 'builtin',
    canOpen: address => parseFileAddress(address) !== undefined,
    title: basenameOf,
  }
}
