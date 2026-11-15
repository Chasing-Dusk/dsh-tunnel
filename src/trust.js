/**
 * The DSH trust patch.
 *
 * A phone reaches this DSH through `https://<public-host>`, so the `connection`
 * row's `trustedHosts` must name that authority, and `cookieMaxAgeDays` decides
 * how long "log in once" lasts.
 *
 * The trap this module exists for: a profile patch replaces the targeted row's
 * **whole** config. The shipped bundle row is
 *
 *     trustedHosts: !!js ctx.webStartup.trustedHosts
 *
 * so writing only `cookieMaxAgeDays` silently drops that expression and the
 * public host stops being trusted. Every write here therefore restates
 * `trustedHosts` from values resolved at runtime, and the merge is a pure
 * function with tests covering exactly that case.
 */
import { isDeepStrictEqual } from 'node:util'

/** Loader row id of the DSH connection plugin. */
export const CONNECTION_ROW_ID = 'connection'
/** Package name of the DSH connection plugin, used to confirm the row. */
export const CONNECTION_ROW_NAME = '@deepseek-ai/dsh-client-connection'

const AUTHORITY = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)(?::(\d{1,5}))?$/

/**
 * Whether a value is an authority DSH can match a request's `Host` against.
 * Wildcards and URLs are rejected: DSH compares authorities, it does not glob.
 * @param {unknown} value - candidate entry.
 * @returns {boolean} true when usable.
 */
export function isTrustedHostEntry(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text === '' || text.length > 253 || text.includes('*')) return false
  const match = AUTHORITY.exec(text)
  if (match === null) return false
  const port = match[2]
  if (port !== undefined) {
    const parsed = Number.parseInt(port, 10)
    if (parsed < 1 || parsed > 65535) return false
  }
  return true
}

/**
 * Reads string entries out of a config value that may be an array, an
 * unevaluated `!!js` expression marker, or absent.
 * @param {unknown} value - a `trustedHosts` layer value.
 * @returns {string[]} the literal entries that can be preserved.
 */
export function literalHosts(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
}

/**
 * Whether a layer value is an unresolved `!!js` expression.
 * @param {unknown} value - a config layer value.
 * @returns {boolean} true for the inert expression marker.
 */
export function isExpression(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.__jsExpr === 'string'
  )
}

/**
 * Deduplicates authorities case-insensitively while keeping the first
 * occurrence's position and spelling.
 * @param {string[]} hosts - candidate authorities.
 * @returns {{hosts: string[], rejected: string[]}} accepted and rejected entries.
 */
export function dedupeHosts(hosts) {
  const seen = new Set()
  const accepted = []
  const rejected = []
  for (const host of hosts) {
    if (typeof host !== 'string') continue
    const text = host.trim()
    if (!isTrustedHostEntry(text)) {
      if (text !== '') rejected.push(text)
      continue
    }
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    accepted.push(text)
  }
  return { hosts: accepted, rejected }
}

/**
 * Plans the `connection` row config write.
 *
 * @param {object} input - planning inputs.
 * @param {string} [input.publicHost] - authority of the public URL.
 * @param {string[]} [input.extraHosts] - authorities from plugin config.
 * @param {string[]} [input.invocationHosts] - `--trusted-host` values resolved at runtime.
 * @param {Record<string, unknown>} [input.inherited] - the row's bundle-layer config.
 * @param {Record<string, unknown>} [input.override] - the row's current profile override.
 * @param {number} input.cookieMaxAgeDays - desired cookie lifetime.
 * @returns {{next: Record<string, unknown>, needsWrite: boolean, rejected: string[], frozenExpression: boolean}} plan.
 */
export function planTrustPatch({
  publicHost = '',
  extraHosts = [],
  invocationHosts = [],
  inherited = {},
  override = {},
  cookieMaxAgeDays,
}) {
  const inheritedConfig = isPlainObject(inherited) ? inherited : {}
  const overrideConfig = isPlainObject(override) ? override : {}
  const frozenExpression = isExpression(inheritedConfig.trustedHosts) || isExpression(overrideConfig.trustedHosts)
  const preserved = [
    ...literalHosts(inheritedConfig.trustedHosts),
    ...literalHosts(overrideConfig.trustedHosts),
    ...invocationHosts,
  ]
  const { hosts, rejected } = dedupeHosts([publicHost, ...extraHosts, ...preserved])
  // Restate every inherited key first so an unrelated field is never dropped,
  // then pin the two keys this plugin owns.
  const next = {
    ...inheritedConfig,
    trustedHosts: hosts,
    cookieMaxAgeDays,
  }
  return {
    next,
    needsWrite: !isDeepStrictEqual(next, inheritedConfig),
    rejected,
    frozenExpression,
  }
}

/**
 * The config that restores the shipped row, letting the bundle expression take
 * over again. The config editor deletes the override when the value equals the
 * inherited layer, which is what makes uninstall leave no trace.
 * @param {unknown} inherited - the row's bundle-layer config.
 * @returns {Record<string, unknown>} the config to write.
 */
export function planTrustRevert(inherited) {
  return structuredClone(isPlainObject(inherited) ? inherited : {})
}

/** Whether the value is a non-array object. */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Finds the connection row among the addressable profile rows.
 * @param {Array<{entry: {options: {id?: string, name?: string}}, inherited: unknown, override: unknown}>} rows - config editor rows.
 * @returns {object | undefined} the matching row.
 */
export function findConnectionRow(rows) {
  if (!Array.isArray(rows)) return undefined
  const byName = rows.find((row) => row?.entry?.options?.name === CONNECTION_ROW_NAME)
  if (byName !== undefined) return byName
  return rows.find((row) => row?.entry?.options?.id === CONNECTION_ROW_ID)
}
