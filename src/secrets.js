/**
 * Secret handling: masking for the UI and redaction for anything that leaves
 * this process (logs, error strings, exported configuration).
 */

const MASK = '••••••••'

/**
 * Masks a secret for display, keeping a short tail so a human can tell two
 * tokens apart.
 * @param {unknown} secret - the secret.
 * @param {number} tail - number of trailing characters to keep.
 * @returns {string} a display-safe string.
 */
export function maskSecret(secret, tail = 4) {
  if (typeof secret !== 'string' || secret === '') return ''
  if (secret.length <= tail) return MASK
  return `${MASK}${secret.slice(-tail)}`
}

/** Escapes one literal string for use inside a RegExp. */
export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Removes ANSI escape sequences.
 *
 * frpc colorizes its console output, and those bytes reach a plain `<pre>`
 * where they render as `[1;34m` noise. Stripping at ingestion keeps both the
 * control page and the log file readable.
 * @param {string} text - text that may contain escape sequences.
 * @returns {string} plain text.
 */
export function stripAnsi(text) {
  if (typeof text !== 'string' || text === '') return ''
  // CSI (colors, cursor), OSC (titles/hyperlinks) and lone two-byte escapes.
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
}

/**
 * Replaces every occurrence of every known secret with a mask. Applied to
 * frpc output before it is buffered, written to disk, or returned by the API.
 * @param {string} text - untrusted text.
 * @param {string[]} secrets - values that must never survive.
 * @returns {string} redacted text.
 */
export function redactSecrets(text, secrets) {
  if (typeof text !== 'string' || text === '') return ''
  let out = text
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < 4) continue
    out = out.replace(new RegExp(escapeRegExp(secret), 'g'), MASK)
    // frpc may echo the token URL-encoded inside an error message.
    const encoded = encodeURIComponent(secret)
    if (encoded !== secret) out = out.replace(new RegExp(escapeRegExp(encoded), 'g'), MASK)
  }
  return out
}

/**
 * Drops the query string of any URL found in text, which is where DSH puts the
 * process access token.
 * @param {string} text - untrusted text.
 * @returns {string} text with tokenized URLs stripped.
 */
export function stripUrlQueries(text) {
  if (typeof text !== 'string') return ''
  return text.replace(/(https?:\/\/[^\s"'<>]+)\?[^\s"'<>]*/g, '$1?…')
}

/**
 * The full redaction ladder used for log lines and error messages.
 * @param {string} text - untrusted text.
 * @param {string[]} secrets - known secret values.
 * @returns {string} safe text.
 */
export function scrub(text, secrets = []) {
  return stripUrlQueries(stripAnsi(redactSecrets(typeof text === 'string' ? text : String(text ?? ''), secrets)))
}

/**
 * Splits an access token out of a DSH authenticated URL.
 * @param {string} url - a URL that may carry `?token=…`.
 * @returns {{url: string, token: string}} the clean URL and the token.
 */
export function splitAuthenticatedUrl(url) {
  try {
    const parsed = new URL(url)
    const token = parsed.searchParams.get('token') ?? ''
    parsed.searchParams.delete('token')
    return { url: parsed.href, token }
  } catch {
    return { url: typeof url === 'string' ? url : '', token: '' }
  }
}
