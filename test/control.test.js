import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { pageConfig, readJsonBody, sanitizePatch, sendJson } from '../src/control.js'
import { normalizeConfig } from '../src/config-values.js'

test('the config boundary keeps only known, correctly typed keys', () => {
  const patch = sanitizePatch({
    serverAddr: '  vps.example.com  ',
    serverPort: 7000,
    remotePort: '7000',
    publicUrl: ' https://dsh.example.com ',
    trustedHosts: [' a.com ', 3, 'b.com', ''],
    enabled: true,
    tls: 'yes',
    somethingElse: 'nope',
    cookieMaxAgeDays: 3650.7,
  })
  assert.deepEqual(patch, {
    serverAddr: 'vps.example.com',
    serverPort: 7000,
    publicUrl: 'https://dsh.example.com',
    trustedHosts: ['a.com', 'b.com'],
    enabled: true,
    cookieMaxAgeDays: 3650,
  })
})

test('the config boundary refuses non-objects instead of throwing', () => {
  assert.deepEqual(sanitizePatch(null), {})
  assert.deepEqual(sanitizePatch([]), {})
  assert.deepEqual(sanitizePatch('x'), {})
  assert.deepEqual(sanitizePatch({}), {})
})

test('the page receives no machine-local or secret field', () => {
  const config = normalizeConfig({
    serverAddr: 'vps.example.com',
    publicUrl: 'https://dsh.example.com',
    frpcPath: 'C:\\secret\\frpc.exe',
    dataDir: 'D:\\private',
    keepLogLines: 99,
  })
  const page = pageConfig(config)
  assert.equal(page.serverAddr, 'vps.example.com')
  assert.deepEqual(Object.keys(page).sort(), [
    'autoApplyTrust',
    'cookieMaxAgeDays',
    'enabled',
    'frpConfigFormat',
    'frpVersion',
    'frpcPath',
    'localHost',
    'proxyName',
    'publicUrl',
    'remotePort',
    'serverAddr',
    'serverPort',
    'tls',
    'tlsServerName',
    'trustedHosts',
  ])
  assert.ok(!Object.hasOwn(page, 'dataDir'))
  assert.ok(!Object.hasOwn(page, 'keepLogLines'))
})

test('a JSON body is read with a hard size cap', async () => {
  const ok = Readable.from([Buffer.from(JSON.stringify({ token: 'x' }))])
  assert.deepEqual(await readJsonBody(ok), { token: 'x' })
  const empty = Readable.from([])
  assert.deepEqual(await readJsonBody(empty), {})
  const huge = Readable.from([Buffer.alloc(64 * 1024 + 1, 0x61)])
  await assert.rejects(() => readJsonBody(huge), /too large/)
  const broken = Readable.from([Buffer.from('{not json')])
  await assert.rejects(() => readJsonBody(broken), /not valid JSON/)
})

test('responses are marked no-store and non-sniffable', () => {
  const written = {}
  const res = {
    writeHead(status, headers) {
      written.status = status
      written.headers = headers
    },
    end(body) {
      written.body = body
    },
  }
  sendJson(res, 418, { error: 'teapot' })
  assert.equal(written.status, 418)
  assert.equal(written.headers['cache-control'], 'no-store')
  assert.equal(written.headers['x-content-type-options'], 'nosniff')
  assert.match(written.headers['content-type'], /application\/json/)
  assert.equal(written.body, '{"error":"teapot"}')
  assert.equal(written.headers['content-length'], Buffer.byteLength(written.body))
})
