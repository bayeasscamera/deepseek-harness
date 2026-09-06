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
    path.join(home, '.fnm', 'current', 'bin', 'node'),
    path.join(home, '.volta', 'bin', 'node'),
    path.join(home, '.asdf', 'shims', 'node'),
    path.join(home, '.proto', 'bin', 'node'),
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
  ].filter((c): c is string => Boolean(c))

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    } catch {
      // An unreadable candidate path is skipped; the scan continues to the
      // next candidate rather than failing the launch.
    }
  }

  // Scan NVM versions directory for installed node binaries; sort numerically so
  // v9 never beats v24 the way a lexicographic reverse would.
  try {
    const nvmDir = path.join(home, '.nvm', 'versions', 'node')
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir)
        .filter(v => /^v\d+\.\d+\.\d+$/.test(v))
        .sort((a, b) => {
          const pa = a.slice(1).split('.').map(Number)
          const pb = b.slice(1).split('.').map(Number)
          for (let i = 0; i < 3; i++) {
            if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0)
          }
          return 0
        })
      for (const v of versions) {
        const p = path.join(nvmDir, v, 'bin', 'node')
        if (fs.existsSync(p)) {
          return p
        }
      }
    }
  } catch {
    // A missing or malformed nvm directory is not an error; fall through to
    // the PATH-based `node` lookup below.
  }

  return 'node'
}

/**
 * Resolve the project repository root directory.
 */
export function resolveRepoRoot(resourcesPath: string): string {
  // Dev-launch probe: when this source tree's built CLI exists, run against it
  // instead of the packaged resources. The existsSync guard makes the literal
  // inert on any machine where the path does not exist (packaged installs) —
  // remove or generalize before public distribution.
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
