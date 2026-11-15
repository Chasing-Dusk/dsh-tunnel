/**
 * Configuration export and import for moving to another computer.
 *
 * The exported document is deliberately boring: no token, no access key, no
 * absolute path from the machine that wrote it. Importing it into a fresh
 * install leaves only the frp token and the phone login to redo.
 */
import { defaultConfig, normalizeConfig, publicHostOf } from './config-values.js'

/** Document schema identifier. */
export const EXPORT_SCHEMA = 'dsh-tunnel/config@1'

/** Keys that may cross a machine boundary. */
export const EXPORTABLE_KEYS = [
  'enabled',
  'serverAddr',
  'serverPort',
  'remotePort',
  'publicUrl',
  'localHost',
  'proxyName',
  'frpVersion',
  'frpConfigFormat',
  'tls',
  'tlsServerName',
  'trustedHosts',
  'cookieMaxAgeDays',
  'autoApplyTrust',
]

/**
 * Builds the portable document.
 * @param {object} input - export inputs.
 * @param {Record<string, unknown>} input.config - normalized plugin config.
 * @param {string} input.pluginVersion - this plugin's version.
 * @param {string} [input.now] - ISO timestamp override.
 * @returns {object} the document.
 */
export function exportConfig({ config, pluginVersion, now = new Date().toISOString() }) {
  const normalized = normalizeConfig(config)
  const tunnel = {}
  for (const key of EXPORTABLE_KEYS) tunnel[key] = normalized[key]
  return {
    schema: EXPORT_SCHEMA,
    generatedAt: now,
    pluginVersion,
    tunnel,
    secrets: {
      frpToken: 'not exported: re-enter it on the target machine',
      dshAccessKey: 'never exported: it changes on every DSH start',
    },
    notes: [
      'frpcPath and dataDir are intentionally omitted: they are machine-local.',
      'After importing, set the frp token, then apply the trust patch and restart DSH if asked.',
    ],
  }
}

/**
 * Reads a document produced by {@link exportConfig}, rejecting anything that
 * is not one.
 * @param {unknown} value - parsed JSON.
 * @returns {{ok: true, config: Record<string, unknown>, warnings: string[]} | {ok: false, error: string}} outcome.
 */
export function parseImport(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'not a dsh-tunnel configuration document' }
  }
  if (value.schema !== EXPORT_SCHEMA) {
    return { ok: false, error: `unsupported document schema ${JSON.stringify(value.schema ?? null)}; expected ${EXPORT_SCHEMA}` }
  }
  const source = value.tunnel
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return { ok: false, error: 'the document has no tunnel section' }
  }
  const warnings = []
  const accepted = {}
  for (const key of EXPORTABLE_KEYS) {
    if (Object.hasOwn(source, key)) accepted[key] = source[key]
  }
  const ignored = Object.keys(source).filter((key) => !EXPORTABLE_KEYS.includes(key))
  if (ignored.length > 0) warnings.push(`ignored machine-local keys: ${ignored.join(', ')}`)
  const config = normalizeConfig({ ...defaultConfig(), ...accepted })
  const rawPublicUrl = typeof source.publicUrl === 'string' ? source.publicUrl.trim() : ''
  if (rawPublicUrl !== '' && config.publicUrl === '') {
    return { ok: false, error: 'publicUrl in the document is not an HTTP(S) root' }
  }
  if (config.publicUrl !== '' && publicHostOf(config.publicUrl) === '') {
    return { ok: false, error: 'publicUrl in the document is not an HTTP(S) root' }
  }
  if (config.serverAddr === '') warnings.push('the document does not name an frp server; the tunnel stays unconfigured')
  return { ok: true, config, warnings }
}

/**
 * A one-paragraph safety summary shown next to the import button.
 * @returns {string} the warning text.
 */
export function importWarning() {
  return 'Importing replaces this machine\'s tunnel settings. The frp token is never included, so you must enter it again. Nothing is applied to DSH trust until you press Apply.'
}
