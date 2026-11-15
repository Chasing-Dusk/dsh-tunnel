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
 * @param {{describeRecord?: Function} | undefined} credentials - credential service.
 * @returns {Promise<{configured: boolean, writable: boolean}>} presence facts.
 */
export async function describeFrpToken(credentials) {
  if (credentials === undefined || credentials === null || typeof credentials.describeRecord !== 'function') {
    return { configured: false, writable: false }
  }
  try {
    const info = await credentials.describeRecord(FRP_TOKEN_KEY)
    return { configured: info?.configured === true, writable: info?.writable !== false }
  } catch {
    return { configured: false, writable: false }
  }
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
