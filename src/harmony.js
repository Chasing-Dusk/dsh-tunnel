/**
 * Compatibility checks against the other half of the phone chain.
 *
 * The mobile protocol belongs to `@dsh-harmony/plugin`; this plugin only makes
 * the machine reachable and trusted. When that package is missing, present but
 * not enabled as a bundle, or from a different generation than the phone app,
 * the status page has to say so plainly instead of showing a green tunnel that
 * cannot serve a phone.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The mobile-protocol package this plugin depends on at runtime. */
export const HARMONY_PACKAGE = '@dsh-harmony/plugin'
/** Mobile app version this plugin's documentation is written against. */
export const DOCUMENTED_APP_VERSION = '0.4.10'

/**
 * Reads one JSON file, returning `undefined` when absent or malformed.
 * @param {string} path - file path.
 * @returns {Promise<any>} parsed JSON.
 */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Inspects the mobile-protocol plugin without importing it.
 * @param {{profileDir: string}} options - where the profile lives.
 * @returns {Promise<{installed: boolean, version: string, enabled: boolean, found: boolean}>} facts.
 */
export async function detectHarmony({ profileDir }) {
  const result = { installed: false, version: '', enabled: false, found: false }
  if (typeof profileDir !== 'string' || profileDir === '') return result
  const manifest = await readJson(join(profileDir, 'node_modules', ...HARMONY_PACKAGE.split('/'), 'package.json'))
  if (manifest !== undefined && typeof manifest?.version === 'string') {
    result.installed = true
    result.found = true
    result.version = manifest.version
  }
  const profile = await readJson(join(profileDir, 'package.json'))
  const bundles = profile?.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(HARMONY_PACKAGE)) {
    result.enabled = true
  }
  return result
}

/**
 * Turns the facts into one actionable sentence, or `''` when all is well.
 * @param {{installed: boolean, version: string, enabled: boolean}} info - detected facts.
 * @returns {string} advice.
 */
export function harmonyAdvice(info) {
  if (!info?.installed) {
    return `Install ${HARMONY_PACKAGE} (the official DSH-Harmony plugin) in this profile: without it the phone has no /pocket endpoint to log in to.`
  }
  if (!info.enabled) {
    return `${HARMONY_PACKAGE} ${info.version} is installed but is not in this profile's bundle list, so its routes are not mounted. Add it to dsh.profile.bundles in the profile package.json and restart DSH.`
  }
  return ''
}

/**
 * Whether the installed mobile plugin matches the documented phone app.
 * @param {string} version - installed plugin version.
 * @returns {'match' | 'mismatch' | 'unknown'} compatibility verdict.
 */
export function appCompatibility(version) {
  if (typeof version !== 'string' || version === '') return 'unknown'
  if (version === '0.4.0') return 'match'
  const [major, minor] = version.split('.').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return 'unknown'
  return major === 0 && minor === 4 ? 'match' : 'mismatch'
}
