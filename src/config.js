/**
 * The plugin's configuration schema, declared so DSH can validate the row and
 * render a form for it. Values live in `config-values.js` so the rest of the
 * code and its tests never depend on the schema library.
 */
import z from '@deepseek-ai/schemastery'
import { LIMITS } from './config-values.js'

export * from './config-values.js'

const port = () => z.number().min(1).max(65535)

export const Config = z.object({
  // ── the public entry this machine serves ─────────────────────────────────
  enabled: z
    .boolean()
    .default(false)
    .description('Start the tunnel automatically on every DSH start. Off by default: this is a high-privilege remote entry.'),
  serverAddr: z
    .string()
    .default('')
    .description('frps host or IP as reached from this computer, e.g. vps.example.com. Empty keeps the tunnel unconfigured.'),
  serverPort: port().default(7000).description('frps control port.'),
  remotePort: port()
    .default(19098)
    .description('Proxy port frps exposes to its reverse proxy. Internal to the server, not a public port.'),
  publicUrl: z
    .string()
    .default('')
    .description('The fixed public HTTPS address phones type, e.g. https://dsh.example.com. Its host becomes a trustedHosts entry.'),
  localHost: z.string().default('127.0.0.1').description('Address frpc forwards to on this machine.'),
  proxyName: z
    .string()
    .pattern(/^[A-Za-z0-9_.-]{1,64}$/)
    .default('dsh-desktop')
    .description('Proxy name registered on frps; must be unique per machine on one server.'),

  // ── the frp client ───────────────────────────────────────────────────────
  frpcPath: z
    .string()
    .default('')
    .description('Absolute path to frpc(.exe). Empty auto-detects the managed copy under the plugin data directory, then PATH.'),
  frpVersion: z
    .string()
    .default('')
    .description('frp version your server runs. frps and frpc must match; a mismatch is reported, not silently ignored.'),
  frpConfigFormat: z
    .union([z.const('toml'), z.const('ini')])
    .default('toml')
    .description('toml for frp v0.52 and later, ini for older releases.'),
  tls: z.boolean().default(true).description('Encrypt the frpc to frps connection (frp transport TLS).'),
  tlsServerName: z
    .string()
    .default('')
    .description('TLS ServerName override; empty uses the server address. Needed when frps is reached by IP but its certificate names a domain.'),
  restartBaseDelayMs: z
    .number()
    .min(200)
    .max(600000)
    .default(2000)
    .description('First restart delay after frpc exits unexpectedly; doubles on every consecutive failure.'),
  restartMaxDelayMs: z.number().min(1000).max(3600000).default(60000).description('Restart delay ceiling.'),

  // ── the DSH side of the chain ────────────────────────────────────────────
  trustedHosts: z
    .array(z.string())
    .default([])
    .description('Extra authorities to trust besides the publicUrl host, e.g. a LAN address like 192.168.1.20:3080.'),
  cookieMaxAgeDays: z
    .number()
    .min(1)
    .max(LIMITS.cookieMaxAgeDays)
    .default(3650)
    .description('Signed browser cookie lifetime in days. DSH defaults to 30; a long value is what makes the phone log in once.'),
  autoApplyTrust: z
    .boolean()
    .default(true)
    .description('Write the trustedHosts and cookieMaxAgeDays patch automatically once a publicUrl is configured.'),

  // ── local plumbing ───────────────────────────────────────────────────────
  dataDir: z
    .string()
    .default('')
    .description('Where generated frpc configs, state and logs live. Empty uses $DSH_HOME/dsh-tunnel.'),
  keepLogLines: z
    .number()
    .min(20)
    .max(2000)
    .default(400)
    .description('In-memory frpc log lines kept for the status page.'),
})
