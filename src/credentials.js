/**
 * The frp token lives in DSH's credential store, never in plugin config, never
 * in the exported JSON and never in a log line.
 */

/** Record key used in DSH's credential store. */
export const FRP_TOKEN_KEY = 'dsh-tunnel:frp-token'

/**
 * Reads the stored frp token.
 * @param {{readRecord?: Function} | undefined} credentials - DSH credential service.
 * @returns {Promise<string>} the token, or `''`.
 */
export async function readFrpToken(credentials) {
  if (credentials === undefined || credentials === null || typeof credentials.readRecord !== 'function') return ''
  try {
    const record = await credentials.readRecord(FRP_TOKEN_KEY)
    if (record === null || typeof record !== 'object') return ''
    if (record.kind === 'api-key' && typeof record.key === 'string') return record.key
    return ''
  } catch {
    return ''
  }
}

/**
 * Stores or clears the frp token.
 * @param {{modifyRecord?: Function, deleteRecord?: Function} | undefined} credentials - credential service.
 * @param {string} token - the new token; an empty value clears it.
 * @returns {Promise<boolean>} whether the store accepted the change.
 */
export async function writeFrpToken(credentials, token) {
  if (credentials === undefined || credentials === null) return false
  const value = typeof token === 'string' ? token.trim() : ''
  try {
    if (value === '') {
      if (typeof credentials.deleteRecord !== 'function') return false
      await credentials.deleteRecord(FRP_TOKEN_KEY)
      return true
    }
    if (typeof credentials.modifyRecord !== 'function') return false
    await credentials.modifyRecord(FRP_TOKEN_KEY, async () => ({ kind: 'api-key', key: value }))
    return true
  } catch {
    return false
  }
}

/**
 * Describes whether a token is stored, without exposing it.
 *
 * `length` is included on purpose: a shared secret that is obviously too short
 * is the most common paste mistake, and letting the user see its length (never
 * its value) is how they catch it themselves.
 * @param {{describeRecord?: Function, readRecord?: Function} | undefined} credentials - credential service.
 * @returns {Promise<{configured: boolean, writable: boolean, length: number}>} presence facts.
 */
export async function describeFrpToken(credentials) {
  if (credentials === undefined || credentials === null) return { configured: false, writable: false, length: 0 }
  let writable = false
  try {
    if (typeof credentials.describeRecord === 'function') {
      const info = await credentials.describeRecord(FRP_TOKEN_KEY)
      writable = info?.writable !== false
    }
  } catch {
    writable = false
  }
  const value = await readFrpToken(credentials)
  return { configured: value !== '', writable, length: value.length }
}

/**
 * Basic shape check: frp tokens are opaque, but an empty or whitespace-bearing
 * value will fail at the server with a less helpful message.
 * @param {unknown} token - candidate.
 * @returns {string} a problem description, or `''` when acceptable.
 */
export function validateFrpToken(token) {
  if (typeof token !== 'string' || token.trim() === '') return 'frp token is empty'
  if (/\s/.test(token)) return 'frp token must not contain whitespace'
  if (token.length < 8) return 'frp token looks too short to be a real secret'
  return ''
}
