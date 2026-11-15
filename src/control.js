/**
 * Everything the control page can ask for, behind one trust-fenced HTTP API.
 *
 * Rules this module enforces:
 * - Every route runs the DSH connection's Host/Origin and browser-auth fence,
 *   so only an already authenticated owner browser reaches it.
 * - Mutations additionally require the `x-dsh-tunnel` header, which a
 *   cross-site form cannot set.
 * - The frp token is write-only from the browser's point of view; the DSH
 *   access key is only returned by an explicit, no-store request.
 */
import { spawn } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { publicHostOf } from './config-values.js'
import { describeFrpToken, readFrpToken, validateFrpToken, writeFrpToken } from './credentials.js'
import { buildShortcutScript, removeShortcut, shortcutExists, startupShortcutPath, supportsStartupShortcut } from './startup.js'
import { detectHarmony, harmonyAdvice, appCompatibility } from './harmony.js'
import { exportConfig, parseImport } from './migrate.js'
import { renderPage } from './page.js'
import { splitAuthenticatedUrl } from './secrets.js'
import { findConnectionRow, literalHosts, planTrustPatch, planTrustRevert } from './trust.js'

/** Reads the usable authorities out of a `trustedHosts` layer value. */
const publicHostList = (value) => literalHosts(value)

/** Route prefix owned by this plugin. */
export const ROUTE_PREFIX = '/dsh-tunnel'

/** Largest JSON body accepted from the page. */
const MAX_BODY_BYTES = 64 * 1024

/** Page content policy: no external loads, no framing, no forms off-site. */
const PAGE_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data:',
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** Writes a JSON response with the no-store and security headers. */
export function sendJson(res, status, value) {
  const body = JSON.stringify(value ?? null)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/** Reads a JSON body, refusing anything oversized or unparseable. */
export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('request body is not valid JSON')
  }
}

/**
 * Owns the control API and the page for one plugin instance.
 */
export class TunnelControl {
  /**
   * @param {object} options - wiring.
   * @param {object} options.ctx - the plugin context.
   * @param {Record<string, unknown>} options.config - normalized plugin config.
   * @param {string} options.version - this plugin's version.
   * @param {string} options.dataDir - plugin data directory.
   * @param {import('./logs.js').ScrubLog} options.log - redacting log sink.
   * @param {import('./frpc.js').FrpcSupervisor} options.supervisor - frpc owner.
   * @param {object} options.state - durable plugin state.
   * @param {(patch: Record<string, unknown>) => void} options.patchState - state writer.
   * @param {(reason: string) => Promise<void>} options.reloadSelf - applies a config change.
   * @param {() => Record<string, unknown>} options.readConfig - current normalized config.
   */
  constructor({ ctx, config, version, dataDir, log, supervisor, state, patchState, reloadSelf, readConfig }) {
    this.ctx = ctx
    this.config = config
    this.version = version
    this.dataDir = dataDir
    this.log = log
    this.supervisor = supervisor
    this.state = state
    this.patchState = patchState
    this.reloadSelf = reloadSelf
    this.readConfig = readConfig
    this.relogin = undefined
  }

  /** The connection service, when this profile has one. */
  get connection() {
    return this.ctx.get('connection')
  }

  /** The config editor, when the profile is editable. */
  get editor() {
    return this.ctx.get('configEditor')
  }

  /** Whether a request may reach this plugin. */
  admits(req) {
    const connection = this.connection
    if (connection === undefined) return false
    try {
      return connection.requestRejection(req) === undefined
    } catch {
      return false
    }
  }

  /** The currently stored frp token (never returned to the browser). */
  async token() {
    return readFrpToken(this.ctx.get('credentials'))
  }

  /** The current DSH origin, or `''` when the listener is not up. */
  origin() {
    try {
      return this.ctx.webServer.getOrigin()
    } catch {
      return ''
    }
  }

  /** The public root a phone should type. */
  publicRoot() {
    const config = this.readConfig()
    return typeof config.publicUrl === 'string' ? config.publicUrl : ''
  }

  /** A full status snapshot for the page. */
  async status() {
    const config = this.readConfig()
    const origin = this.origin()
    const tokenInfo = await describeFrpToken(this.ctx.get('credentials'))
    const harmony = await detectHarmony({ profileDir: this.profileDir() })
    const trust = await this.trustState(config)
    const startupPath = startupShortcutPath()
    const supported = supportsStartupShortcut()
    return {
      plugin: { version: this.version, dataDir: this.dataDir },
      dsh: {
        origin,
        advertisedUrl: this.advertisedUrl(),
        allowsRemoteAuthorities: this.connection?.allowsRemoteAuthorities === true,
        profile: this.profileDir(),
      },
      tunnel: {
        enabled: config.enabled === true,
        configured: typeof config.serverAddr === 'string' && config.serverAddr !== '',
        publicUrl: config.publicUrl,
        publicHost: publicHostOf(config.publicUrl),
        remotePort: config.remotePort,
        runtime: this.supervisor.snapshot(),
      },
      trust,
      token: tokenInfo,
      harmony: { ...harmony, advice: harmonyAdvice(harmony), compatibility: appCompatibility(harmony.version) },
      startup: { path: startupPath, exists: shortcutExists(startupPath), created: this.state.startupShortcut || '', supported },
      config: pageConfig(config),
      logs: this.log.tail(),
      login: { url: this.publicRoot() },
    }
  }

  /** The profile directory, for the harmonony check. */
  profileDir() {
    const info = this.ctx.get('profileContext')
    if (typeof info?.dir === 'string' && info.dir !== '') return info.dir
    return typeof process.env.DSH_PROFILE_DIR === 'string' ? process.env.DSH_PROFILE_DIR : ''
  }

  /** The URL this GUI advertises, used when no public root is configured. */
  advertisedUrl() {
    try {
      return this.ctx.get('webApp')?.getAdvertisedUrl?.() ?? this.origin()
    } catch {
      return this.origin()
    }
  }

  /** Reads the connection row's trust facts without changing anything. */
  async trustState(config) {
    const editor = this.editor
    const base = {
      effective: this.connection?.allowsRemoteAuthorities === true,
      pendingRestart: false,
      trustedHosts: [],
      cookieMaxAgeDays: config.cookieMaxAgeDays,
      editable: editor !== undefined,
      error: '',
    }
    if (editor === undefined) {
      base.error = 'this profile has no config editor; write the trust patch by hand'
      return base
    }
    try {
      const rows = editor.configuration()
      const row = findConnectionRow(rows)
      if (row === undefined) {
        base.error = 'the connection row was not found in this profile'
        return base
      }
      const plan = planTrustPatch({
        publicHost: publicHostOf(config.publicUrl),
        extraHosts: config.trustedHosts,
        invocationHosts: this.invocationHosts(),
        inherited: row.inherited,
        override: row.override,
        cookieMaxAgeDays: config.cookieMaxAgeDays,
      })
      base.trustedHosts = publicHostList(plan.next.trustedHosts)
      base.plannedHosts = publicHostList(plan.next.trustedHosts)
      base.rejected = plan.rejected
      base.frozenExpression = plan.frozenExpression
      const host = publicHostOf(config.publicUrl)
      base.pendingRestart = host !== '' && !base.effective
      return base
    } catch (error) {
      base.error = error instanceof Error ? error.message : String(error)
      return base
    }
  }

  /** Authorities the host process was launched with. */
  invocationHosts() {
    try {
      const startup = this.ctx.get('webStartup')
      return Array.isArray(startup?.trustedHosts) ? startup.trustedHosts.filter((item) => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  /** Writes the trust patch for the configured public host. */
  async applyTrust() {
    const editor = this.editor
    if (editor === undefined) throw new Error('this profile has no config editor')
    const config = this.readConfig()
    const host = publicHostOf(config.publicUrl)
    if (host === '' && config.trustedHosts.length === 0) {
      throw new Error('set the public address first: nothing to trust')
    }
    const rows = editor.configuration()
    const row = findConnectionRow(rows)
    if (row === undefined) throw new Error('the connection row was not found in this profile')
    const invocationHosts = this.invocationHosts()
    const planned = planTrustPatch({
      publicHost: host,
      extraHosts: config.trustedHosts,
      invocationHosts,
      inherited: row.inherited,
      override: row.override,
      cookieMaxAgeDays: config.cookieMaxAgeDays,
    })
    const desired = publicHostList(planned.next.trustedHosts)
    if (isDeepStrictEqual(planned.next, row.override)) {
      // Already exactly what we would write: never trigger a needless
      // connection reload on every DSH start.
      return { ok: true, skipped: true, trustedHosts: desired, effective: this.connection?.allowsRemoteAuthorities === true }
    }
    await editor.edit(row.entry, (current, inherited) => {
      const plan = planTrustPatch({
        publicHost: host,
        extraHosts: config.trustedHosts,
        invocationHosts,
        inherited,
        override: current,
        cookieMaxAgeDays: config.cookieMaxAgeDays,
      })
      if (plan.rejected.length > 0) {
        this.log.note(`ignored invalid trusted host entries: ${plan.rejected.join(', ')}`)
      }
      return plan.next
    })
    this.log.note(`trust patch written for ${host || '(no public host)'}: ${desired.join(', ')}`)
    return { ok: true, skipped: false, trustedHosts: desired, effective: this.connection?.allowsRemoteAuthorities === true }
  }

  /** Restores the shipped connection row, removing the override. */
  async revertTrust() {
    const editor = this.editor
    if (editor === undefined) throw new Error('this profile has no config editor')
    const rows = editor.configuration()
    const row = findConnectionRow(rows)
    if (row === undefined) throw new Error('the connection row was not found in this profile')
    await editor.edit(row.entry, (_current, inherited) => planTrustRevert(inherited))
    this.log.note('trust patch reverted to the shipped connection defaults')
    return { ok: true }
  }

  /** Persists a config patch on this plugin's own row. */
  async saveConfig(patch) {
    const editor = this.editor
    if (editor === undefined) throw new Error('this profile has no config editor')
    const entry = this.ctx.fiber?.entry
    if (entry === undefined) throw new Error('this plugin row is not addressable')
    const cleaned = sanitizePatch(patch)
    if (Object.keys(cleaned).length === 0) throw new Error('nothing to save')
    await editor.edit(entry, (current) => ({ ...current, ...cleaned }))
    return { ok: true }
  }

  /** Stores the frp token. */
  async saveToken(token) {
    const problem = validateFrpToken(token)
    if (problem !== '') throw new Error(problem)
    const accepted = await writeFrpToken(this.ctx.get('credentials'), token)
    if (!accepted) throw new Error('the credential store refused the write')
    return { ok: true }
  }

  /** Removes the stored frp token. */
  async clearToken() {
    await writeFrpToken(this.ctx.get('credentials'), '')
    return { ok: true }
  }

  /** The login facts a phone needs, including the live access key. */
  async loginInfo() {
    const connection = this.connection
    if (connection === undefined) throw new Error('the connection service is not mounted')
    const config = this.readConfig()
    const base = config.publicUrl !== '' ? `${config.publicUrl}/` : `${this.advertisedUrl().replace(/\/+$/, '')}/`
    const authenticated = connection.authenticatedUrl(base)
    const { url, token } = splitAuthenticatedUrl(authenticated)
    return {
      url,
      accessKey: token,
      note: 'The access key is valid for this DSH process only and grants full control of this computer.',
    }
  }

  /** Creates the Startup shortcut after an explicit click. */
  async createStartup() {
    if (!supportsStartupShortcut()) throw new Error('the Startup folder is only available on Windows')
    const lnkPath = startupShortcutPath()
    const target = process.execPath
    if (!lnkPath) throw new Error('no Startup folder could be resolved')
    const script = buildShortcutScript({
      lnkPath,
      target,
      args: '',
      workingDirectory: process.execPath.replace(/[\\/][^\\/]+$/, ''),
      description: 'Start DeepSeek Harness so the dsh-tunnel public entry comes back after login.',
    })
    await new Promise((resolve, reject) => {
      const child = spawnHelper('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
      let stderr = ''
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on?.('error', reject)
      child.on?.('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `powershell exited ${code}`))))
      setTimeout(() => {
        try {
          child.kill()
        } catch {
          // ignore
        }
        reject(new Error('creating the shortcut timed out'))
      }, 20000).unref?.()
    })
    if (!shortcutExists(lnkPath)) throw new Error('the shortcut file was not created')
    this.patchState({ startupShortcut: lnkPath })
    return { ok: true, path: lnkPath }
  }

  /** Removes only the shortcut this plugin created. */
  async removeStartup() {
    const lnkPath = startupShortcutPath()
    const removed = removeShortcut(lnkPath, this.state.startupShortcut || '')
    this.patchState({ startupShortcut: '' })
    return { ok: true, removed }
  }

  /** The portable configuration document. */
  exportDocument() {
    return exportConfig({ config: this.readConfig(), pluginVersion: this.version })
  }

  /** Applies an imported document, keeping machine-local settings. */
  async importDocument(document_) {
    const parsed = parseImport(document_)
    if (!parsed.ok) throw new Error(parsed.error)
    const current = this.readConfig()
    const merged = {
      ...parsed.config,
      frpcPath: current.frpcPath,
      dataDir: current.dataDir,
      keepLogLines: current.keepLogLines,
      restartBaseDelayMs: current.restartBaseDelayMs,
      restartMaxDelayMs: current.restartMaxDelayMs,
    }
    await this.saveConfig(merged)
    return { ok: true, warnings: parsed.warnings }
  }

  /**
   * Routes one request inside the plugin prefix.
   * @param {import('node:http').IncomingMessage} req - request.
   * @param {import('node:http').ServerResponse} res - response.
   */
  async handle(req, res) {
    if (!this.admits(req)) {
      sendJson(res, 403, { error: 'untrusted or unauthenticated request' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    if (path === ROUTE_PREFIX || path === `${ROUTE_PREFIX}/index.html`) {
      this.servePage(res)
      return
    }
    if (!path.startsWith(`${ROUTE_PREFIX}/api/`)) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const endpoint = path.slice(`${ROUTE_PREFIX}/api`.length)
    const method = req.method ?? 'GET'
    if (endpoint !== '/status' && endpoint !== '/export' && method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    if (method === 'POST' && req.headers['x-dsh-tunnel'] !== '1') {
      sendJson(res, 403, { error: 'missing same-origin marker' })
      return
    }
    try {
      await this.dispatch(endpoint, req, res)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, 400, { error: message })
    }
  }

  /** Serves the control page. */
  servePage(res) {
    const html = renderPage({ version: this.version })
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': PAGE_CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    })
    res.end(html)
  }

  /** Runs one API endpoint. */
  async dispatch(endpoint, req, res) {
    switch (endpoint) {
      case '/status':
        sendJson(res, 200, await this.status())
        return
      case '/config':
        sendJson(res, 200, await this.saveConfig(await readJsonBody(req)))
        return
      case '/token': {
        const body = await readJsonBody(req)
        const token = typeof body.token === 'string' ? body.token : ''
        sendJson(res, 200, token === '' ? await this.clearToken() : await this.saveToken(token))
        return
      }
      case '/trust/apply':
        sendJson(res, 200, await this.applyTrust())
        return
      case '/trust/revert':
        sendJson(res, 200, await this.revertTrust())
        return
      case '/start':
        sendJson(res, 200, await this.supervisor.start({ reason: 'page' }))
        return
      case '/stop':
        sendJson(res, 200, await this.supervisor.stop('page'))
        return
      case '/restart':
        sendJson(res, 200, await this.supervisor.restart('page'))
        return
      case '/login-info':
        sendJson(res, 200, await this.loginInfo())
        return
      case '/startup/create':
        sendJson(res, 200, await this.createStartup())
        return
      case '/startup/remove':
        sendJson(res, 200, await this.removeStartup())
        return
      case '/export':
        sendJson(res, 200, this.exportDocument())
        return
      case '/import': {
        const body = await readJsonBody(req)
        sendJson(res, 200, await this.importDocument(body.document))
        return
      }
      default:
        sendJson(res, 404, { error: 'not found' })
    }
  }
}

/** Keeps only known, JSON-safe config keys and drops empty strings. */
export function sanitizePatch(patch) {
  const allowed = {
    enabled: 'boolean',
    serverAddr: 'string',
    serverPort: 'number',
    remotePort: 'number',
    publicUrl: 'string',
    localHost: 'string',
    proxyName: 'string',
    frpcPath: 'string',
    frpVersion: 'string',
    frpConfigFormat: 'string',
    tls: 'boolean',
    tlsServerName: 'string',
    trustedHosts: 'array',
    cookieMaxAgeDays: 'number',
    autoApplyTrust: 'boolean',
  }
  const out = {}
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return out
  for (const [key, type] of Object.entries(allowed)) {
    if (!Object.hasOwn(patch, key)) continue
    const value = patch[key]
    if (type === 'boolean' && typeof value === 'boolean') out[key] = value
    else if (type === 'string' && typeof value === 'string') out[key] = value.trim()
    else if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) out[key] = Math.trunc(value)
    else if (type === 'array' && Array.isArray(value)) {
      out[key] = value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    }
  }
  return out
}

/** Only the config the page actually renders. */
export function pageConfig(config) {
  return {
    enabled: config.enabled,
    serverAddr: config.serverAddr,
    serverPort: config.serverPort,
    remotePort: config.remotePort,
    publicUrl: config.publicUrl,
    localHost: config.localHost,
    proxyName: config.proxyName,
    frpcPath: config.frpcPath,
    frpVersion: config.frpVersion,
    frpConfigFormat: config.frpConfigFormat,
    tls: config.tls,
    tlsServerName: config.tlsServerName,
    trustedHosts: config.trustedHosts,
    cookieMaxAgeDays: config.cookieMaxAgeDays,
    autoApplyTrust: config.autoApplyTrust,
  }
}

/** Spawns a helper process for the Startup shortcut. */
function spawnHelper(command, args) {
  return spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
}
