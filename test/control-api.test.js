import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TunnelControl } from '../src/control.js'
import { normalizeConfig } from '../src/config-values.js'
import { ScrubLog } from '../src/logs.js'

const CONNECTION_ROW = {
  entry: { options: { id: 'include:connection', name: '@deepseek-ai/dsh-client-connection' }, fiber: { state: 'active' } },
  inherited: { trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' } },
  override: {},
}

/** A request stand-in that is also an async iterable of its body. */
function makeRequest({ method = 'GET', url = '/dsh-tunnel/api/status', headers = {}, body } = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  request.method = method
  request.url = url
  request.headers = headers
  return request
}

/** A response stand-in that records what was written. */
function makeResponse() {
  const record = { status: 0, headers: {}, body: '' }
  return {
    record,
    writeHead(status, headers) {
      record.status = status
      record.headers = headers ?? {}
    },
    end(body) {
      record.body = body === undefined ? '' : String(body)
    },
  }
}

/** Builds a control instance over fake DSH services. */
function makeControl({ config = {}, admit = true, editor, credentials, fiberEntry } = {}) {
  const calls = { edits: [], credentialWrites: [], statePatches: [] }
  const inherited = structuredClone(CONNECTION_ROW.inherited)
  let override = structuredClone(CONNECTION_ROW.override)
  const row = { ...CONNECTION_ROW, inherited, get override() { return override } }
  const fakeEditor = editor ?? {
    configuration: () => (override === undefined ? [] : [row]),
    edit: async (entry, change) => {
      calls.edits.push(entry.options.id)
      override = change(structuredClone(override), structuredClone(inherited))
    },
  }
  const store = new Map()
  const fakeCredentials = credentials ?? {
    readRecord: async (key) => (store.has(key) ? { kind: 'api-key', key: store.get(key) } : undefined),
    describeRecord: async (key) => ({ configured: store.has(key), writable: true }),
    modifyRecord: async (key, mutate) => {
      const next = await mutate(store.has(key) ? { kind: 'api-key', key: store.get(key) } : undefined)
      calls.credentialWrites.push([key, next])
      if (next !== undefined) store.set(key, next.key)
      return next
    },
    deleteRecord: async (key) => {
      calls.credentialWrites.push([key, undefined])
      store.delete(key)
    },
  }
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-tunnel-profile-'))
  const services = {
    connection: {
      requestRejection: () => (admit ? undefined : 403),
      allowsRemoteAuthorities: () => true,
      authenticatedUrl: (base) => `${base.replace(/\/$/, '')}/?token=ACCESS-KEY-VALUE`,
    },
    configEditor: fakeEditor,
    credentials: fakeCredentials,
    profileContext: { dir: profileDir, name: 'desktop', patchPath: join(profileDir, 'cordis.patch.yml') },
    webApp: { getAdvertisedUrl: () => 'http://127.0.0.1:13162' },
    webStartup: { trustedHosts: ['cli.example.internal'] },
  }
  const ctx = {
    webServer: { getOrigin: () => 'http://127.0.0.1:13162' },
    fiber: { entry: fiberEntry ?? { options: { id: 'include:dsh-tunnel', name: 'dsh-tunnel' }, fiber: { state: 'active' } } },
    get: (name) => services[name],
  }
  const supervisor = {
    snapshot: () => ({ state: 'stopped', connected: false, proxyStarted: false, localPort: 13162, binaryPath: '', configPath: '', lastError: '', frpcVersion: '' }),
    start: async () => supervisor.snapshot(),
    stop: async () => supervisor.snapshot(),
    restart: async () => supervisor.snapshot(),
  }
  const control = new TunnelControl({
    ctx,
    config: normalizeConfig(config),
    version: '0.1.0',
    dataDir: profileDir,
    log: new ScrubLog({ limit: 20 }),
    supervisor,
    state: {},
    patchState: (patch) => calls.statePatches.push(patch),
    readConfig: () => normalizeConfig(config),
  })
  return { control, row, calls, store, profileDir, getOverride: () => override }
}

/** Sends one request through the control and returns status plus parsed body. */
async function send(control, options) {
  const response = makeResponse()
  await control.handle(makeRequest({ headers: { 'x-dsh-tunnel': '1', ...(options.headers ?? {}) }, ...options }), response)
  let parsed
  try {
    parsed = JSON.parse(response.record.body)
  } catch {
    parsed = response.record.body
  }
  return { status: response.record.status, headers: response.record.headers, body: parsed }
}

test('untrusted requests never reach the API', async () => {
  const { control } = makeControl({ admit: false })
  const status = await send(control, { url: '/dsh-tunnel/api/status' })
  assert.equal(status.status, 403)
  assert.match(status.body.error, /untrusted/)
})

test('a mutation without the same-origin marker is refused', async () => {
  const { control, calls } = makeControl()
  const result = await send(control, { method: 'POST', url: '/dsh-tunnel/api/trust/apply', headers: { 'x-dsh-tunnel': '' }, body: '{}' })
  assert.equal(result.status, 403)
  assert.match(result.body.error, /same-origin/)
  assert.equal(calls.edits.length, 0)
})

test('the status endpoint reports the whole chain without secrets', async () => {
  const { control } = makeControl({ config: { enabled: true, serverAddr: 'vps.example.com', publicUrl: 'https://dsh.example.com' } })
  const result = await send(control, { url: '/dsh-tunnel/api/status' })
  assert.equal(result.status, 200)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.equal(result.body.tunnel.publicHost, 'dsh.example.com')
  assert.equal(result.body.dsh.origin, 'http://127.0.0.1:13162')
  assert.equal(result.body.config.serverAddr, 'vps.example.com')
  assert.equal(result.body.token.configured, false)
  assert.equal(result.body.trust.editable, true)
  assert.ok(!JSON.stringify(result.body).includes('token='), 'never leaks the access token')
})

test('applying the trust patch writes a complete row, then no-ops', async () => {
  const { control, calls, getOverride } = makeControl({ config: { publicUrl: 'https://dsh.example.com', trustedHosts: ['192.168.1.20:3080'] } })
  const first = await send(control, { method: 'POST', url: '/dsh-tunnel/api/trust/apply', body: '{}' })
  assert.equal(first.status, 200)
  assert.equal(first.body.skipped, false)
  assert.deepEqual(first.body.trustedHosts, ['dsh.example.com', '192.168.1.20:3080', 'cli.example.internal'])
  const row = getOverride()
  assert.equal(row.cookieMaxAgeDays, 3650)
  assert.deepEqual(row.trustedHosts, ['dsh.example.com', '192.168.1.20:3080', 'cli.example.internal'])

  const second = await send(control, { method: 'POST', url: '/dsh-tunnel/api/trust/apply', body: '{}' })
  assert.equal(second.body.skipped, true, 'a second apply must not reload the connection plugin again')
  assert.equal(calls.edits.length, 1)
})

test('applying with no public address is refused with an explanation', async () => {
  const { control } = makeControl()
  const result = await send(control, { method: 'POST', url: '/dsh-tunnel/api/trust/apply', body: '{}' })
  assert.equal(result.status, 400)
  assert.match(result.body.error, /public address/)
})

test('reverting writes the inherited layer back so the override disappears', async () => {
  const { control, calls, getOverride } = makeControl({ config: { publicUrl: 'https://dsh.example.com' } })
  await send(control, { method: 'POST', url: '/dsh-tunnel/api/trust/apply', body: '{}' })
  assert.equal(calls.edits.length, 1)
  const reverted = await send(control, { method: 'POST', url: '/dsh-tunnel/api/trust/revert', body: '{}' })
  assert.equal(reverted.status, 200)
  assert.deepEqual(getOverride(), { trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' } })
})

test('the frp token is write-only from the API surface', async () => {
  const { control, store } = makeControl()
  const rejected = await send(control, { method: 'POST', url: '/dsh-tunnel/api/token', body: JSON.stringify({ token: 'short' }) })
  assert.equal(rejected.status, 400)
  assert.match(rejected.body.error, /too short/)
  assert.equal(store.size, 0)

  const accepted = await send(control, { method: 'POST', url: '/dsh-tunnel/api/token', body: JSON.stringify({ token: 'a-proper-token-value' }) })
  assert.equal(accepted.status, 200)
  assert.equal(store.get('dsh-tunnel:frp-token'), 'a-proper-token-value')

  const status = await send(control, { url: '/dsh-tunnel/api/status' })
  assert.equal(status.body.token.configured, true)
  assert.ok(!JSON.stringify(status.body).includes('a-proper-token-value'), 'the token is never echoed')

  const cleared = await send(control, { method: 'POST', url: '/dsh-tunnel/api/token', body: JSON.stringify({ token: '' }) })
  assert.equal(cleared.status, 200)
  assert.equal(store.size, 0)
})

test('the login endpoint returns the phone facts and nothing else', async () => {
  const { control } = makeControl({ config: { publicUrl: 'https://dsh.example.com' } })
  const result = await send(control, { method: 'POST', url: '/dsh-tunnel/api/login-info', body: '{}' })
  assert.equal(result.status, 200)
  assert.equal(result.body.url, 'https://dsh.example.com/')
  assert.equal(result.body.accessKey, 'ACCESS-KEY-VALUE')
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.match(result.body.note, /this DSH process only/)
})

test('an unconfigured public address falls back to the local GUI URL', async () => {
  const { control } = makeControl()
  const result = await send(control, { method: 'POST', url: '/dsh-tunnel/api/login-info', body: '{}' })
  assert.equal(result.body.url, 'http://127.0.0.1:13162/')
})

test('export and import move settings without machine-local keys or secrets', async () => {
  const { control, calls } = makeControl({ config: { serverAddr: 'vps.example.com', publicUrl: 'https://dsh.example.com', frpcPath: 'C:\\tools\\frpc.exe' } })
  const exported = await send(control, { url: '/dsh-tunnel/api/export' })
  assert.equal(exported.status, 200)
  assert.equal(exported.body.schema, 'dsh-tunnel/config@1')
  assert.ok(!JSON.stringify(exported.body).includes('C:\\\\tools'))

  const imported = await send(control, {
    method: 'POST',
    url: '/dsh-tunnel/api/import',
    body: JSON.stringify({ document: { schema: 'dsh-tunnel/config@1', tunnel: { serverAddr: 'other.example.com', frpcPath: 'C:\\elsewhere\\frpc.exe' } } }),
  })
  assert.equal(imported.status, 200)
  assert.match(imported.body.warnings.join(' '), /ignored machine-local keys/)
  assert.equal(calls.edits.at(-1), 'include:dsh-tunnel')

  const wrong = await send(control, { method: 'POST', url: '/dsh-tunnel/api/import', body: JSON.stringify({ document: { schema: 'nope' } }) })
  assert.equal(wrong.status, 400)
})

test('unknown endpoints and methods are reported, not guessed', async () => {
  const { control } = makeControl()
  assert.equal((await send(control, { url: '/dsh-tunnel/api/nope' })).status, 404)
  assert.equal((await send(control, { method: 'POST', url: '/dsh-tunnel/api/nope', body: '{}' })).status, 404)
  assert.equal((await send(control, { method: 'PUT', url: '/dsh-tunnel/api/status' })).status, 405)
})

test('the page is served with a restrictive content policy', async () => {
  const { control } = makeControl()
  const result = await send(control, { url: '/dsh-tunnel/' })
  assert.equal(result.status, 200)
  assert.match(result.headers['content-type'], /text\/html/)
  assert.match(result.headers['content-security-policy'], /default-src 'none'/)
  assert.match(result.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.equal(result.headers['x-frame-options'], 'DENY')
  assert.match(String(result.body), /DSH 公网隧道/)
})
