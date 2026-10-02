/** Ad-hoc sign a locally packaged macOS application so Apple Silicon can execute it. */

import { spawnSync } from 'node:child_process'

/**
 * @typedef {object} CodeSignOutcome
 * @property {number | null} status - Exit status, or null when the tool could not start.
 * @property {string} stdout - Captured standard output.
 * @property {string} stderr - Captured standard error.
 * @property {Error} [error] - Start failure reported by the process runner.
 */

/**
 * Execute one codesign invocation.
 * @typedef {(args: readonly string[]) => CodeSignOutcome} CodeSignRunner
 */

/**
 * Build the codesign arguments that replace an application signature with the ad-hoc identity.
 * @param {string} appPath - Path to the packaged `.app` directory.
 * @returns {readonly string[]} Arguments for `/usr/bin/codesign`.
 */
export function adhocSignArguments(appPath) {
  return ['--force', '--deep', '--sign', '-', appPath]
}

/**
 * Build the codesign arguments that verify an application and its nested code.
 * @param {string} appPath - Path to the packaged `.app` directory.
 * @returns {readonly string[]} Arguments for `/usr/bin/codesign`.
 */
export function adhocVerifyArguments(appPath) {
  return ['--verify', '--deep', '--strict', appPath]
}

/**
 * Execute codesign through the host process runner.
 * @param {readonly string[]} args - Arguments for `/usr/bin/codesign`.
 * @returns {CodeSignOutcome} Exit status and diagnostics.
 */
function runCodeSignProcess(args) {
  const result = spawnSync('/usr/bin/codesign', [...args], { encoding: 'utf8' })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error === undefined ? {} : { error: result.error }),
  }
}

/**
 * Reject a failed codesign invocation with its diagnostics.
 * @param {CodeSignOutcome} outcome - Exit status and diagnostics.
 * @param {string} label - Stable diagnostic name.
 * @returns {void}
 */
function assertCodeSignOutcome(outcome, label) {
  if (outcome.error !== undefined) {
    throw new Error(`desktop local signing: could not execute ${label}: ${outcome.error.message}`)
  }
  if (outcome.status !== 0) {
    const diagnostic = `${outcome.stdout}${outcome.stderr}`.trim()
    throw new Error(
      `desktop local signing: ${label} exited with ${String(outcome.status)}${diagnostic === '' ? '' : `: ${diagnostic}`}`,
    )
  }
}

/**
 * Ad-hoc sign a locally packaged application and verify the result.
 *
 * The signature enables no hardened runtime because the packaged Electron
 * application declares no JIT entitlement; hardened runtime would stop V8 from
 * running. A local build replaces the release signature, which needs an
 * Apple-issued Developer ID that local packaging deliberately does not use.
 * @param {string} appPath - Path to the packaged `.app` directory.
 * @param {CodeSignRunner} run - codesign runner, replaced by focused tests.
 * @returns {void}
 */
export function adhocSignMacOSApp(appPath, run = runCodeSignProcess) {
  assertCodeSignOutcome(run(adhocSignArguments(appPath)), 'codesign sign')
  assertCodeSignOutcome(run(adhocVerifyArguments(appPath)), 'codesign verify')
}
