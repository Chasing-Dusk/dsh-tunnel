/**
 * frpc process supervision.
 *
 * One supervisor owns exactly one frpc child. It regenerates the config from
 * the port DSH actually bound on every start, keeps the child alive across
 * crashes with exponential backoff, and resolves any frpc left behind by a
 * previous DSH process so the new one can claim the proxy name on frps.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildFrpcConfig, frpcConfigFileName, portOfOrigin, hostOfOrigin } from './frpc-config.js'
import { resolveFrpcBinary, frpcExecutableName } from './paths.js'
import { scrub } from './secrets.js'

/** Restart delays: base, doubling, capped, and a "it ran fine" reset window. */
export function nextBackoff(attempt, baseMs, maxMs) {
  const exponent = Math.max(0, attempt - 1)
  const delay = baseMs * 2 ** Math.min(exponent, 16)
  return Math.min(maxMs, Math.max(baseMs, Math.round(delay)))
}

/** How long a child must stay up before a crash counts as a fresh failure. */
export const STABLE_WINDOW_MS = 30000

/** Log lines that mean the tunnel is actually carrying traffic. */
const LOGIN_SUCCESS = /login to server success/i
const PROXY_SUCCESS = /start proxy success/i
const AUTH_FAILURE = /authorization failed|token in login doesn't match|authentication failed/i

/** Parses the version out of `frpc -v` output. */
export function parseFrpcVersion(output) {
  const match = /v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(String(output ?? ''))
  return match?.[1] ?? ''
}

/** Parses `tasklist /FO CSV` output into `{name, pid}` rows. */
export function parseTasklistCsv(text) {
  const rows = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^"((?:[^"]|"")*)","(\d+)"/.exec(line.trim())
    if (match === null) continue
    rows.push({ name: match[1].replace(/""/g, '"'), pid: Number.parseInt(match[2], 10) })
  }
  return rows
}

/**
 * Owns one frpc child process and the config file it runs.
 */
export class FrpcSupervisor {
  /**
   * @param {object} options - wiring.
   * @param {Record<string, unknown>} options.config - normalized plugin config.
   * @param {string} options.dataDir - plugin data directory.
   * @param {() => Promise<string>} options.token - reads the frp token from the credential store.
   * @param {() => string} options.origin - reads the current DSH origin.
   * @param {import('./logs.js').ScrubLog} options.log - redacting log sink.
   * @param {(snapshot: object) => void} [options.onChange] - state notifier.
   * @param {typeof nodeSpawn} [options.spawn] - injectable for tests.
   * @param {(reason: string) => void} [options.onStalePid] - records a recovered orphan.
   */
  constructor({ config, dataDir, token, origin, log, onChange, spawn = nodeSpawn, onStalePid }) {
    this.config = config
    this.dataDir = dataDir
    this.token = token
    this.origin = origin
    this.log = log
    this.onChange = onChange
    this.spawn = spawn
    this.onStalePid = onStalePid

    this.child = undefined
    this.state = 'stopped'
    this.connected = false
    this.proxyStarted = false
    this.attempt = 0
    this.generation = 0
    this.startedAt = ''
    this.lastExitAt = ''
    this.lastExitCode = null
    this.lastError = ''
    this.binary = { path: '', source: 'missing' }
    this.frpcVersion = ''
    this.configPath = ''
    this.localPort = 0
    this.pid = 0
    this.restartTimer = undefined
    this.stopping = false
    this.stalePidRecovered = false
  }

  /** Notifies the owner that observable state changed. */
  emit() {
    try {
      this.onChange?.(this.snapshot())
    } catch {
      // A listener must never break supervision.
    }
  }

  /** The observable state of this supervisor. */
  snapshot() {
    return {
      state: this.state,
      connected: this.connected,
      proxyStarted: this.proxyStarted,
      attempt: this.attempt,
      pid: this.pid,
      startedAt: this.startedAt,
      lastExitAt: this.lastExitAt,
      lastExitCode: this.lastExitCode,
      lastError: scrub(this.lastError, [this.knownToken]),
      binaryPath: this.binary.path,
      binarySource: this.binary.source,
      frpcVersion: this.frpcVersion,
      configPath: this.configPath,
      localPort: this.localPort,
      stalePidRecovered: this.stalePidRecovered,
    }
  }

  /** Kept so `snapshot()` can scrub without awaiting the store. */
  get knownToken() {
    return this._token ?? ''
  }

  /** Resolves the token once per start so snapshots stay synchronous. */
  async loadToken() {
    this._token = await this.token()
    return this._token
  }

  /** Runs `frpc -v` and returns the reported version. */
  async probeVersion(binaryPath) {
    return new Promise((resolve) => {
      let output = ''
      let settled = false
      const done = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      let child
      try {
        child = this.spawn(binaryPath, ['-v'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch {
        done('')
        return
      }
      child.stdout?.on('data', (chunk) => {
        output += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        output += String(chunk)
      })
      child.on?.('error', () => done(''))
      child.on?.('exit', () => done(parseFrpcVersion(output)))
      setTimeout(() => {
        try {
          child.kill()
        } catch {
          // ignore
        }
        done(parseFrpcVersion(output))
      }, 5000).unref?.()
    })
  }

  /**
   * Resolves the binary and checks it against the version the server runs.
   * @returns {Promise<{ok: boolean, reason?: string}>} resolution result.
   */
  async resolveBinary() {
    this.binary = resolveFrpcBinary({ dataDir: this.dataDir, frpcPath: this.config.frpcPath })
    if (this.binary.source === 'missing') {
      this.state = 'missing-binary'
      this.lastError = this.binary.path
        ? `frpc not found at ${this.binary.path}`
        : 'frpc binary not found: place frpc under the plugin data directory or set frpcPath'
      this.emit()
      return { ok: false, reason: this.lastError }
    }
    this.frpcVersion = await this.probeVersion(this.binary.path)
    const expected = String(this.config.frpVersion ?? '').trim()
    if (expected !== '' && this.frpcVersion !== '' && expected !== this.frpcVersion) {
      this.log.note(
        `frpc version mismatch: binary reports ${this.frpcVersion}, configuration expects ${expected}. frps and frpc must match.`,
      )
    }
    return { ok: true }
  }

  /**
   * Writes the generated config for the current DSH port.
   * @returns {Promise<{ok: boolean, reason?: string}>} preparation result.
   */
  async prepare() {
    const token = await this.loadToken()
    if (token === '') {
      this.state = 'invalid-config'
      this.lastError = 'frp token is not set'
      this.emit()
      return { ok: false, reason: this.lastError }
    }
    const origin = this.origin()
    const localPort = portOfOrigin(origin)
    this.localPort = localPort
    const text = buildFrpcConfig({
      format: this.config.frpConfigFormat,
      serverAddr: this.config.serverAddr,
      serverPort: this.config.serverPort,
      token,
      tls: this.config.tls,
      tlsServerName: this.config.tlsServerName,
      localHost: this.config.localHost || hostOfOrigin(origin),
      localPort,
      remotePort: this.config.remotePort,
      proxyName: this.config.proxyName,
    })
    mkdirSync(this.dataDir, { recursive: true })
    const path = join(this.dataDir, frpcConfigFileName(this.config.frpConfigFormat))
    writeFileSync(path, text, { mode: 0o600 })
    try {
      chmodSync(path, 0o600)
    } catch {
      // Windows ignores POSIX modes; the profile directory ACL is the real guard.
    }
    this.configPath = path
    return { ok: true }
  }

  /**
   * Starts frpc if it is not already running.
   * @param {{reason?: string}} [options] - why the start happened, for the log.
   * @returns {Promise<object>} the supervisor snapshot.
   */
  async start({ reason = 'manual' } = {}) {
    if (this.child !== undefined) return this.snapshot()
    this.clearTimer()
    this.stopping = false
    this.generation += 1
    const generation = this.generation
    this.log.note(`starting frpc (${reason})`)
    if (!(await this.resolveBinary()).ok) return this.snapshot()
    if (!(await this.prepare()).ok) return this.snapshot()

    this.state = 'starting'
    this.connected = false
    this.proxyStarted = false
    this.emit()

    let child
    try {
      child = this.spawn(this.binary.path, ['-c', this.configPath], {
        cwd: this.dataDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      this.lastError = scrub(error instanceof Error ? error.message : String(error), [this._token])
      this.state = 'error'
      this.emit()
      this.scheduleRestart()
      return this.snapshot()
    }

    this.child = child
    this.pid = child.pid ?? 0
    this.startedAt = new Date().toISOString()
    this.state = 'running'

    child.stdout?.on('data', (chunk) => this.consume(chunk, 'out'))
    child.stderr?.on('data', (chunk) => this.consume(chunk, 'err'))
    child.on?.('error', (error) => {
      this.lastError = scrub(error instanceof Error ? error.message : String(error), [this._token])
      this.log.note(`frpc process error: ${this.lastError}`)
    })
    child.on?.('exit', (code, signal) => {
      if (generation !== this.generation) return
      this.handleExit(code, signal)
    })
    this.emit()
    return this.snapshot()
  }

  /** Consumes child output, updating the connection flags. */
  consume(chunk, stream) {
    const text = String(chunk ?? '')
    this.log.appendChunk(text, stream)
    const scrubbed = scrub(text, [this._token ?? ''])
    if (LOGIN_SUCCESS.test(scrubbed)) {
      this.connected = true
      this.proxyStarted = false
      this.attempt = 0
      this.emit()
    }
    if (PROXY_SUCCESS.test(scrubbed)) {
      this.proxyStarted = true
      this.emit()
    }
    if (AUTH_FAILURE.test(scrubbed)) {
      this.lastError = 'frps rejected the login: check the frp token and TLS settings'
      this.emit()
    }
  }

  /** Handles one child exit, scheduling a restart unless it was requested. */
  handleExit(code, signal) {
    const ranFor = this.startedAt === '' ? 0 : Date.now() - Date.parse(this.startedAt)
    this.child = undefined
    this.pid = 0
    this.connected = false
    this.proxyStarted = false
    this.lastExitAt = new Date().toISOString()
    this.lastExitCode = typeof code === 'number' ? code : null
    this.log.note(`frpc exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`)
    if (this.stopping) {
      this.state = 'stopped'
      this.emit()
      return
    }
    this.state = 'backoff'
    if (ranFor >= STABLE_WINDOW_MS) this.attempt = 0
    this.attempt += 1
    this.emit()
    this.scheduleRestart()
  }

  /** Arms the next restart with backoff. */
  scheduleRestart() {
    this.clearTimer()
    if (this.stopping) return
    const delay = nextBackoff(this.attempt, this.config.restartBaseDelayMs, this.config.restartMaxDelayMs)
    this.log.note(`restarting frpc in ${delay} ms (attempt ${this.attempt})`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (this.stopping) return
      void this.start({ reason: 'restart' })
    }, delay)
    this.restartTimer.unref?.()
  }

  /** Clears a pending restart timer. */
  clearTimer() {
    if (this.restartTimer === undefined) return
    clearTimeout(this.restartTimer)
    this.restartTimer = undefined
  }

  /**
   * Stops frpc and leaves supervision off.
   * @param {string} [reason] - why, for the log.
   * @returns {Promise<object>} the snapshot after the child is gone.
   */
  async stop(reason = 'manual') {
    this.stopping = true
    this.generation += 1
    this.clearTimer()
    const child = this.child
    if (child === undefined) {
      this.state = 'stopped'
      this.connected = false
      this.proxyStarted = false
      this.emit()
      return this.snapshot()
    }
    this.log.note(`stopping frpc (${reason})`)
    const exited = new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      child.once?.('exit', finish)
      setTimeout(finish, 5000).unref?.()
    })
    this.terminate(child)
    await exited
    this.child = undefined
    this.pid = 0
    this.connected = false
    this.proxyStarted = false
    this.state = 'stopped'
    this.emit()
    return this.snapshot()
  }

  /** Terminates a child, escalating on Windows where signals are advisory. */
  terminate(child) {
    try {
      child.kill()
    } catch {
      // already gone
    }
    if (process.platform === 'win32' && typeof child.pid === 'number' && child.pid > 0) {
      const timer = setTimeout(() => {
        killTree(child.pid)
      }, 2500)
      timer.unref?.()
      child.once?.('exit', () => clearTimeout(timer))
    }
  }

  /** Restarts the child, regenerating the config first. */
  async restart(reason = 'manual') {
    await this.stop(`restart: ${reason}`)
    return this.start({ reason })
  }

  /**
   * Kills an frpc recorded from a previous DSH process, so this one can claim
   * the proxy name. Only a process whose image name is frpc is touched.
   * @param {number} pid - previously recorded pid.
   * @returns {Promise<boolean>} whether a stale process was found and killed.
   */
  async recoverStale(pid) {
    if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return false
    const name = frpcExecutableName()
    try {
      const listing = await runCommand(this.spawn, 'tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
      const found = parseTasklistCsv(listing).some((row) => row.pid === pid && row.name.toLowerCase() === name.toLowerCase())
      if (!found) return false
      await runCommand(this.spawn, 'taskkill', ['/PID', String(pid), '/T', '/F'])
      this.stalePidRecovered = true
      this.log.note(`terminated a stale frpc from a previous DSH process (pid ${pid})`)
      this.onStalePid?.('stale-pid')
      return true
    } catch {
      return false
    }
  }
}

/** Runs a short helper command and resolves its stdout. */
export function runCommand(spawn, command, args, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      reject(error)
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk) => {
      out += String(chunk)
    })
    child.stderr?.on('data', () => {})
    child.on?.('error', reject)
    child.on?.('exit', () => resolve(out))
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      resolve(out)
    }, timeoutMs).unref?.()
  })
}

/** Force-kills a process tree. */
export function killTree(pid) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return
  try {
    nodeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    }).unref?.()
  } catch {
    // ignore
  }
}
