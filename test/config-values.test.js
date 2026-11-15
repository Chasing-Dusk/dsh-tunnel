import test from 'node:test'
import assert from 'node:assert/strict'
import { LIMITS, defaultConfig, normalizeConfig, normalizePublicUrl, publicHostOf } from '../src/config-values.js'

test('the default configuration is inert', () => {
  const config = defaultConfig()
  assert.equal(config.enabled, false)
  assert.equal(config.serverAddr, '')
  assert.equal(config.publicUrl, '')
  assert.deepEqual(config.trustedHosts, [])
  assert.equal(config.frpcPath, '')
  assert.equal(config.tls, true, 'transport TLS stays on by default')
  assert.equal(config.autoApplyTrust, true)
})

test('normalization is total and never throws on junk', () => {
  const config = normalizeConfig({ serverPort: 'abc', remotePort: 0, cookieMaxAgeDays: -5, proxyName: 'bad name!', trustedHosts: 'nope' })
  assert.equal(config.serverPort, 7000)
  assert.equal(config.remotePort, 1, 'out-of-range values clamp into the valid window')
  assert.equal(config.cookieMaxAgeDays, 1)
  assert.equal(config.proxyName, 'dsh-desktop')
  assert.deepEqual(config.trustedHosts, [])
  assert.deepEqual(normalizeConfig(null), defaultConfig())
  assert.deepEqual(normalizeConfig([]), defaultConfig())
})

test('clamping respects the documented cookie ceiling', () => {
  assert.equal(normalizeConfig({ cookieMaxAgeDays: 1e9 }).cookieMaxAgeDays, LIMITS.cookieMaxAgeDays)
})

test('trusted host lists are trimmed and de-duplicated', () => {
  const config = normalizeConfig({ trustedHosts: [' a.com ', 'a.com', '', 'b.com'] })
  assert.deepEqual(config.trustedHosts, ['a.com', 'b.com'])
})

test('a public address is stored as a bare HTTP(S) root', () => {
  assert.equal(normalizePublicUrl('https://dsh.example.com'), 'https://dsh.example.com')
  assert.equal(normalizePublicUrl(' https://dsh.example.com/ '), 'https://dsh.example.com')
  assert.equal(normalizePublicUrl('https://dsh.example.com:8443'), 'https://dsh.example.com:8443')
  assert.equal(normalizePublicUrl('http://1.2.3.4'), 'http://1.2.3.4')
})

test('a public address that is not a root is refused', () => {
  for (const bad of ['', '   ', 'dsh.example.com', 'ftp://dsh.example.com', 'https://user:pw@dsh.example.com', 'https://dsh.example.com/path', 'https://dsh.example.com/?x=1', 'https://dsh.example.com/#h']) {
    assert.equal(normalizePublicUrl(bad), '', bad)
  }
})

test('the trusted authority is what the phone sends as Host', () => {
  assert.equal(publicHostOf('https://dsh.example.com'), 'dsh.example.com')
  assert.equal(publicHostOf('https://dsh.example.com:8443'), 'dsh.example.com:8443')
  assert.equal(publicHostOf('http://[::1]:3080'), '[::1]:3080')
  assert.equal(publicHostOf(''), '')
  assert.equal(publicHostOf('junk'), '')
})
