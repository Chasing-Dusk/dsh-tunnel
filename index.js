/**
 * dsh-tunnel — publish this DSH instance behind a fixed public HTTPS address.
 *
 * The Host half owns three things and nothing else:
 *   1. the DSH trust patch (`connection.trustedHosts` + `cookieMaxAgeDays`),
 *   2. a generated frpc config plus the frpc process that keeps the tunnel up,
 *   3. one fenced control page at `/dsh-tunnel/` and the JSON API behind it.
 *
 * The mobile protocol itself belongs to `@dsh-harmony/plugin`; this plugin only
 * makes the machine reachable and trusted.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Config } from './src/config.js'
import { normalizeConfig, publicHostOf } from './src/config-values.js'
import { resolveDataDir } from './src/paths.js'
import { ScrubLog } from './src/logs.js'
import { FrpcSupervisor } from './src/frpc.js'
import { patchState, readState } from './src/state.js'
import { readFrpToken } from './src/credentials.js'
import { ROUTE_PREFIX, TunnelControl } from './src/control.js'

const require = createRequire(import.meta.url)
const VERSION = require('./package.json').version

/** Stable Cordis plugin name. */
export const name = 'dsh-tunnel'

/** The plugin cannot work without the HTTP carrier and the trust fence. */
export const inject = ['webServer', 'connection']

export { Config }

/** Delay before the first automatic trust write, so Loader boot finishes first. */
const AUTO_APPLY_DELAY_MS = 8000

/**
 * Mounts the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {Record<string, unknown>} rawConfig - validated row configuration.
 */
export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const dataDir = resolveDataDir(config)
  mkdirSync(dataDir, { recursive: true })
  let state = readState(dataDir)

  // The live token is cached only for log redaction; the store stays the source
  // of truth and is re-read on every start.
  const secretHolder = { value: '' }

  const log = new ScrubLog({
    limit: config.keepLogLines,
    file: join(dataDir, 'logs', 'frpc.log'),
    secrets: () => (secretHolder.value === '' ? [] : [secretHolder.value]),
  })

  const supervisor = new FrpcSupervisor({
    config,
    dataDir,
    origin: () => {
      try {
        return ctx.webServer.getOrigin()
      } catch {
        return ''
      }
    },
    token: async () => {
      const token = await readFrpToken(ctx.get('credentials'))
      secretHolder.value = token
      return token
    },
    log,
    onStalePid: () => {
      state = patchState(dataDir, { frpcPid: 0 })
    },
  })

  const control = new TunnelControl({
    ctx,
    config,
    version: VERSION,
    dataDir,
    log,
    supervisor,
    state,
    patchState: (patch) => {
      state = patchState(dataDir, patch)
    },
    readConfig: () => config,
  })

  /** Starts the tunnel when the row is enabled and fully configured. */
  const startIfConfigured = async (reason) => {
    if (!config.enabled) {
      log.note('tunnel is disabled in configuration; not starting frpc')
      return
    }
    if (config.serverAddr === '' || publicHostOf(config.publicUrl) === '') {
      log.note('server address or public address is missing; not starting frpc')
      return
    }
    const token = await readFrpToken(ctx.get('credentials'))
    if (token === '') {
      log.note('frp token is not stored; not starting frpc')
      return
    }
    const previousPid = Number(state.frpcPid ?? 0)
    if (Number.isInteger(previousPid) && previousPid > 0) await supervisor.recoverStale(previousPid)
    const snapshot = await supervisor.start({ reason })
    if (snapshot.pid > 0) state = patchState(dataDir, { frpcPid: snapshot.pid, lastRunAt: new Date().toISOString() })
  }

  /** Applies the trust patch once the profile is settled. */
  const autoApplyTrust = async () => {
    if (!config.autoApplyTrust) return
    if (publicHostOf(config.publicUrl) === '') return
    try {
      const result = await control.applyTrust()
      if (result.skipped !== true) {
        log.note(
          result.effective
            ? 'public host trust applied and already live'
            : 'public host trust applied; DSH may need a restart before the public Host is accepted',
        )
      }
    } catch (error) {
      ctx.logger?.warn?.(`dsh-tunnel: could not write the DSH trust patch: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => {
        void control.handle(req, res)
      },
    })

    const exitCleanup = () => {
      try {
        supervisor.child?.kill()
      } catch {
        // best effort on process exit
      }
    }
    process.once('exit', exitCleanup)

    void startIfConfigured('dsh-start')

    const trustTimer = setTimeout(() => {
      void autoApplyTrust()
    }, AUTO_APPLY_DELAY_MS)
    trustTimer.unref?.()

    return async () => {
      clearTimeout(trustTimer)
      process.off('exit', exitCleanup)
      disposeRoute()
      await supervisor.stop('plugin-dispose')
      // Clear the recorded pid so the next start does not chase a dead process.
      const snapshot = supervisor.snapshot()
      if (snapshot.pid === 0) {
        try {
          state = patchState(dataDir, { frpcPid: 0, lastExitAt: new Date().toISOString() })
        } catch {
          // state is best-effort during shutdown
        }
      }
    }
  })
}
