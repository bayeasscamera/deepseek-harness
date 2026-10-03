/**
 * Host half: nothing to load.
 *
 * The whole preview is browser-only — the bytes arrive through the Host's
 * `workspaceFiles` Remote, which another package serves — so this entry keeps
 * the package loadable from the Loader without contributing anything on the
 * Host side.
 */

/** Host plugin body: contributes nothing. */
export function apply(): void {
  // The preview lives entirely in the browser half.
}
