/** Exit status and diagnostics reported by the codesign runner. */
export interface CodeSignOutcome {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

/** Runner that executes codesign, replaced by focused tests. */
export type CodeSignRunner = (args: readonly string[]) => CodeSignOutcome

/**
 * Build the codesign arguments that replace an application signature with the ad-hoc identity.
 * @param appPath - Path to the packaged `.app` directory.
 * @returns Arguments for `/usr/bin/codesign`.
 */
export function adhocSignArguments(appPath: string): readonly string[]

/**
 * Build the codesign arguments that verify an application and its nested code.
 * @param appPath - Path to the packaged `.app` directory.
 * @returns Arguments for `/usr/bin/codesign`.
 */
export function adhocVerifyArguments(appPath: string): readonly string[]

/**
 * Ad-hoc sign a locally packaged application and verify the result.
 * @param appPath - Path to the packaged `.app` directory.
 * @param run - codesign runner, replaced by focused tests.
 */
export function adhocSignMacOSApp(appPath: string, run?: CodeSignRunner): void
