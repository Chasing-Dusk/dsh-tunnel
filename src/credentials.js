/**
 * The frp token lives in DSH's credential store, never in plugin config, never
 * in the exported JSON and never in a log line.
 *
 * ── The rule this file exists to enforce ────────────────────────────────────
 * A record is addressed by `<scope>/<id>`, and BOTH segments must match
 * `/^[a-z][a-z0-9-]*$/` (`@deepseek-ai/dsh-credentials`, `KEY_SEGMENT_PATTERN`).
 * That grammar is checked while the store's document is *parsed at startup*
 * (`LocalCredentialProvider.loadInitial`), so one bad key does not break the
 * plugin that wrote it — it fails the `credentials` service, which aborts the
 * whole DSH host startup.
 *
 * A previous release used `dsh-tunnel:frp-token`; the colon is not in the
 * grammar, so loading that document threw and DSH would not start. Every entry
 * point below therefore validates the key before touching the store and fails
 * closed instead of writing something unreadable.
 */

/** Owning plugin's registered name. */
export const FRP_TOKEN_SCOPE = 'dsh-tunnel'
/** This plugin's own addressing unit inside that scope. */
export const FRP_TOKEN_ID = 'frp-token'

/**
 * The grammar DSH applies to each half of a credential key. Kept as a literal
 * copy rather than an import so a missing peer dependency can never turn into
 * a plugin that fails to load; `test/credentials.test.js` pins it.
 */
export const CREDENTIAL_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/

/**
 * Builds one `<scope>/<id>` credential key, rejecting segments DSH would
 * refuse to parse.
 * @param {string} scope - owning plugin name.
 * @param {string} id - that plugin's addressing unit.
 * @returns {string} the joined key.
 * @throws {TypeError} when either segment is outside the grammar.
 */
export function credentialKey(scope, id) {
  for (const segment of [scope, id]) {
    if (typeof segment !== 'string' || !CREDENTIAL_SEGMENT_PATTERN.test(segment)) {
      throw new TypeError(`credential key segment "${segment}" must match ${String(CREDENTIAL_SEGMENT_PATTERN)}`)
    }
  }
  return `${scope}/${id}`
}

/**
 * Whether a joined key is exactly two valid segments.
 * @param {unknown} key - candidate.
 * @returns {boolean} true when DSH would accept it.
 */
export function isValidCredentialKey(key) {
  if (typeof key !== 'string') return false
  const segments = key.split('/')
  if (segments.length !== 2) return false
  return segments.every((segment) => CREDENTIAL_SEGMENT_PATTERN.test(segment))
}

/** Record key used in DSH's credential store. */
export const FRP_TOKEN_KEY = credentialKey(FRP_TOKEN_SCOPE, FRP_TOKEN_ID)

/**
 * Reads the stored frp token.
 * @param {{readRecord?: Function} | undefined} credentials - DSH credential service.
 * @returns {Promise<string>} the token, or `''`.
 */
export async function readFrpToken(credentials) {
  if (!isValidCredentialKey(FRP_TOKEN_KEY)) return ''
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
  if (!isValidCredentialKey(FRP_TOKEN_KEY)) return false
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
 * its value) is how they catch it themselves. `keyValid` surfaces a broken key
 * grammar instead of silently reporting "not set".
 * @param {{describeRecord?: Function, readRecord?: Function} | undefined} credentials - credential service.
 * @returns {Promise<{configured: boolean, writable: boolean, length: number, keyValid: boolean}>} presence facts.
 */
export async function describeFrpToken(credentials) {
  const keyValid = isValidCredentialKey(FRP_TOKEN_KEY)
  if (!keyValid) return { configured: false, writable: false, length: 0, keyValid: false }
  if (credentials === undefined || credentials === null) {
    return { configured: false, writable: false, length: 0, keyValid: true }
  }
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
  return { configured: value !== '', writable, length: value.length, keyValid: true }
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
