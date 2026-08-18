import * as path from 'path'
import * as fs from 'fs'

/**
 * Build an augmented PATH environment variable to guarantee Node.js and CLI
 * tools are discoverable when the app is launched from macOS GUI (Spotlight / Finder).
 */
export function getEnhancedPath(): string {
  const home = process.env.HOME || ''
  const extraPaths = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  const currentPath = process.env.PATH || ''
  return [...extraPaths, ...currentPath.split(':')]
    .filter((p, i, arr) => Boolean(p) && arr.indexOf(p) === i)
    .join(':')
}

/**
 * Locate a functional Node.js binary on the host system.
 */
export function findNodeExecutable(): string {
  const home = process.env.HOME || ''
  const candidates = [
    process.env.NODE_PATH_CUSTOM,
    path.join(home, '.local', 'bin', 'node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    'node',
  ].filter((c): c is string => Boolean(c))

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    } catch {}
  }
  return 'node'
}

/**
 * Resolve the project repository root directory.
 */
export function resolveRepoRoot(resourcesPath: string): string {
  const devRepoRoot = '/Users/bayeasssene/Documents/ProjetsGithub/DeepSeekHarness'
  if (fs.existsSync(path.join(devRepoRoot, 'apps', 'cli', 'lib', 'bin.js'))) {
    return devRepoRoot
  }
  const bundled = path.join(resourcesPath, 'app')
  if (fs.existsSync(bundled)) {
    return bundled
  }
  return path.resolve(__dirname, '..', '..')
}
