/**
 * Configuration values: defaults, normalization and the small derivations
 * every other module needs. Kept free of imports so it can be tested with a
 * plain Node runtime that has no DSH packages installed.
 */

/** Concurrency/shape limits shared by the schema and the runtime checks. */
export const LIMITS = {
  hostEntry: 253,
  proxyName: 64,
  cookieMaxAgeDays: 36500,
}

/** Narrows an unknown value to a plain object. */
export const asRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}

/**
 * Accepts what a human types for a public address and returns a bare
 * `https://host[:port]` root, or `''` when it cannot be an HTTP(S) root.
 * @param {unknown} value - raw address.
 * @returns {string} the normalized root.
 */
export function normalizePublicUrl(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '') return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    if (url.username || url.password) return ''
    if (url.pathname !== '/' && url.pathname !== '') return ''
    if (url.search || url.hash) return ''
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

/**
 * The authority (host, or host:port when non-default) a phone will send in
 * `Host`, i.e. the value DSH must trust.
 * @param {string} publicUrl - normalized public root.
 * @returns {string} the authority, or `''`.
 */
export function publicHostOf(publicUrl) {
  if (!publicUrl) return ''
  try {
    return new URL(publicUrl).host
  } catch {
    return ''
  }
}

/**
 * Fills defaults and trims user text so the rest of the plugin can treat the
 * config as fully present. Every default is deliberately inert: no server, no
 * domain, tunnel off.
 * @param {Record<string, unknown>} input - raw row configuration.
 * @returns {Record<string, unknown>} a normalized copy.
 */
export function normalizeConfig(input) {
  const raw = asRecord(input)
  const text = (value) => (typeof value === 'string' ? value.trim() : '')
  const count = (value, fallback, min, max) => {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback
  }
  return {
    enabled: raw.enabled === true,
    serverAddr: text(raw.serverAddr),
    serverPort: count(raw.serverPort, 7000, 1, 65535),
    remotePort: count(raw.remotePort, 19098, 1, 65535),
    publicUrl: normalizePublicUrl(raw.publicUrl),
    localHost: text(raw.localHost) || '127.0.0.1',
    proxyName: /^[A-Za-z0-9_.-]{1,64}$/.test(text(raw.proxyName)) ? text(raw.proxyName) : 'dsh-desktop',
    frpcPath: text(raw.frpcPath),
    frpVersion: text(raw.frpVersion),
    frpConfigFormat: raw.frpConfigFormat === 'ini' ? 'ini' : 'toml',
    tls: raw.tls !== false,
    tlsServerName: text(raw.tlsServerName),
    restartBaseDelayMs: count(raw.restartBaseDelayMs, 2000, 200, 600000),
    restartMaxDelayMs: count(raw.restartMaxDelayMs, 60000, 1000, 3600000),
    trustedHosts: Array.isArray(raw.trustedHosts)
      ? [...new Set(raw.trustedHosts.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
      : [],
    cookieMaxAgeDays: count(raw.cookieMaxAgeDays, 3650, 1, LIMITS.cookieMaxAgeDays),
    autoApplyTrust: raw.autoApplyTrust !== false,
    dataDir: text(raw.dataDir),
    keepLogLines: count(raw.keepLogLines, 400, 20, 2000),
  }
}

/** The empty default configuration, used when the row has no config yet. */
export function defaultConfig() {
  return normalizeConfig({})
}
