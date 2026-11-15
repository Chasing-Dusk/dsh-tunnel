/**
 * Every path this plugin touches is derived at runtime. Nothing here may
 * hardcode a user name, a drive letter or an install location: the plugin has
 * to survive a new Windows account or a new computer without edits.
 */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'

/** The DSH home directory, as the host process sees it. */
export function dshHome(env = process.env) {
  const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/**
 * Expands `~` and resolves a relative path against the home directory, never
 * against the working directory (which is a session property, not a machine
 * fact).
 * @param {string} input - a user-supplied path.
 * @returns {string} an absolute path, or `''` for empty input.
 */
export function resolveUserPath(input) {
  if (typeof input !== 'string') return ''
  const trimmed = input.trim()
  if (trimmed === '') return ''
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return join(homedir(), trimmed.slice(2))
  if (isAbsolute(trimmed)) return resolve(trimmed)
  return resolve(homedir(), trimmed)
}

/**
 * The directory holding generated frpc configs, state and logs.
 * @param {{dataDir?: string}} config - normalized plugin config.
 * @returns {string} an absolute directory path.
 */
export function resolveDataDir(config = {}, env = process.env) {
  const configured = resolveUserPath(config.dataDir ?? '')
  if (configured !== '') return configured
  return join(dshHome(env), 'dsh-tunnel')
}

/** The executable file name for this platform. */
export function frpcExecutableName(platform = process.platform) {
  return platform === 'win32' ? 'frpc.exe' : 'frpc'
}

/**
 * Candidate locations for an frpc binary, most specific first. The managed
 * copy is where a user is told to drop the download.
 * @param {{dataDir: string, frpcPath?: string, platform?: string}} options - layout.
 * @returns {string[]} absolute candidates, plus bare names resolved through PATH.
 */
export function frpcCandidates({ dataDir, frpcPath = '', platform = process.platform }) {
  const exe = frpcExecutableName(platform)
  const explicit = resolveUserPath(frpcPath)
  const list = []
  if (explicit !== '') list.push(explicit)
  list.push(join(dataDir, 'bin', exe))
  list.push(join(dataDir, exe))
  list.push(exe)
  return [...new Set(list)]
}

/**
 * Finds an executable on PATH. Bare names cannot be resolved with `statSync`,
 * so the search is explicit and stays testable with an injected platform.
 * @param {string} name - executable file name.
 * @param {{env?: NodeJS.ProcessEnv, platform?: string}} options - search inputs.
 * @returns {string} an absolute path, or `''` when not found.
 */
export function findOnPath(name, { env = process.env, platform = process.platform } = {}) {
  const raw = platform === 'win32' ? env.Path ?? env.PATH ?? '' : env.PATH ?? ''
  const separator = platform === 'win32' ? ';' : ':'
  for (const entry of raw.split(separator)) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1')
    if (dir === '') continue
    const candidate = join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return ''
}

/** Whether a path is an existing regular file. */
export function isExecutableFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Resolves the frpc binary this machine should run.
 * @param {{dataDir: string, frpcPath?: string, platform?: string, env?: NodeJS.ProcessEnv}} options - search inputs.
 * @returns {{path: string, source: 'configured' | 'managed' | 'path' | 'missing'}} the resolution.
 */
export function resolveFrpcBinary({ dataDir, frpcPath = '', platform = process.platform, env = process.env }) {
  const explicit = resolveUserPath(frpcPath)
  if (explicit !== '') {
    return isExecutableFile(explicit)
      ? { path: explicit, source: 'configured' }
      : { path: explicit, source: 'missing' }
  }
  const managed = join(dataDir, 'bin', frpcExecutableName(platform))
  if (isExecutableFile(managed)) return { path: managed, source: 'managed' }
  const onPath = findOnPath(frpcExecutableName(platform), { env, platform })
  if (onPath !== '') return { path: onPath, source: 'path' }
  return { path: '', source: 'missing' }
}

/** Information about the profile this process belongs to, without guessing. */
export function profileInfo(ctx, env = process.env) {
  const profileContext = ctx?.get?.('profileContext')
  const dir =
    (typeof profileContext?.dir === 'string' && profileContext.dir) ||
    (typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR) ||
    ''
  const name =
    (typeof profileContext?.name === 'string' && profileContext.name) ||
    (typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE) ||
    ''
  return { dir, name, patchPath: typeof profileContext?.patchPath === 'string' ? profileContext.patchPath : '' }
}

/** Whether the path currently exists. */
export function exists(path) {
  return typeof path === 'string' && path !== '' && existsSync(path)
}
