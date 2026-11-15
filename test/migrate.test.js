import test from 'node:test'
import assert from 'node:assert/strict'
import { EXPORTABLE_KEYS, EXPORT_SCHEMA, exportConfig, importWarning, parseImport } from '../src/migrate.js'
import { defaultConfig, normalizeConfig } from '../src/config-values.js'

const configured = normalizeConfig({
  enabled: true,
  serverAddr: 'vps.example.com',
  serverPort: 7000,
  remotePort: 19098,
  publicUrl: 'https://dsh.example.com',
  frpcPath: 'C:\\tools\\frpc.exe',
  dataDir: 'D:\\tmp',
  frpVersion: '0.61.1',
  trustedHosts: ['192.168.1.20:3080'],
  cookieMaxAgeDays: 3650,
})

test('the exported document carries no secret and no machine-local path', () => {
  const document = exportConfig({ config: configured, pluginVersion: '0.1.0', now: '2026-01-01T00:00:00.000Z' })
  const text = JSON.stringify(document)
  assert.equal(document.schema, EXPORT_SCHEMA)
  assert.equal(document.generatedAt, '2026-01-01T00:00:00.000Z')
  assert.ok(!Object.hasOwn(document.tunnel, 'frpcPath'))
  assert.ok(!Object.hasOwn(document.tunnel, 'dataDir'))
  assert.ok(!text.includes('C:\\\\tools'), 'the local frpc path must not travel')
  assert.ok(!text.toLowerCase().includes('token="'))
  for (const key of EXPORTABLE_KEYS) assert.ok(Object.hasOwn(document.tunnel, key), key)
})

test('a round trip preserves every portable setting', () => {
  const document = exportConfig({ config: configured, pluginVersion: '0.1.0' })
  const parsed = parseImport(document)
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.config, normalizeConfig({ ...configured, frpcPath: '', dataDir: '' }))
  assert.deepEqual(parsed.warnings, [])
})

test('foreign or malformed documents are refused with a reason', () => {
  assert.equal(parseImport(null).ok, false)
  assert.equal(parseImport([]).ok, false)
  assert.equal(parseImport({ schema: 'other@1', tunnel: {} }).ok, false)
  assert.match(parseImport({ schema: 'other@1', tunnel: {} }).error, /unsupported document schema/)
  assert.match(parseImport({ schema: EXPORT_SCHEMA }).error, /no tunnel section/)
  assert.match(parseImport({ schema: EXPORT_SCHEMA, tunnel: { publicUrl: 'not-a-url' } }).error, /not an HTTP\(S\) root/)
})

test('unknown keys are ignored with a warning instead of being applied', () => {
  const parsed = parseImport({
    schema: EXPORT_SCHEMA,
    tunnel: { serverAddr: 'vps.example.com', frpcPath: 'C:\\elsewhere\\frpc.exe' },
  })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.config.frpcPath, '', 'machine-local keys never import')
  assert.equal(parsed.config.serverAddr, 'vps.example.com')
  assert.match(parsed.warnings.join(' '), /ignored machine-local keys: frpcPath/)
})

test('a document without a server still imports but says so', () => {
  const parsed = parseImport(exportConfig({ config: defaultConfig(), pluginVersion: '0.1.0' }))
  assert.equal(parsed.ok, true)
  assert.match(parsed.warnings.join(' '), /does not name an frp server/)
})

test('the import warning mentions the token and the apply step', () => {
  const text = importWarning()
  assert.match(text, /token/i)
  assert.match(text, /Apply/i)
})
