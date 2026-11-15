import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CREDENTIAL_SEGMENT_PATTERN,
  FRP_TOKEN_ID,
  FRP_TOKEN_KEY,
  FRP_TOKEN_SCOPE,
  credentialKey,
  describeFrpToken,
  isValidCredentialKey,
  readFrpToken,
  validateFrpToken,
  writeFrpToken,
} from '../src/credentials.js'

/**
 * A credential store that validates keys exactly like the real one does when
 * it parses its document, i.e. it THROWS on a bad key rather than ignoring it.
 * The previous version of these tests used a permissive fake, which is why an
 * invalid key shipped: the fake agreed with the assumption instead of testing
 * it.
 */
function strictStore(initial = new Map()) {
  const records = new Map(initial)
  const calls = []
  const check = (key) => {
    if (!isValidCredentialKey(key)) {
      // Mirrors `parseCredentialKey` in @deepseek-ai/dsh-credentials.
      throw new TypeError(`credential key "${key}" must be "<scope>/<id>"`)
    }
  }
  return {
    records,
    calls,
    async readRecord(key) {
      check(key)
      calls.push(['read', key])
      return records.get(key)
    },
    async describeRecord(key) {
      check(key)
      calls.push(['describe', key])
      return { configured: records.has(key), writable: true }
    },
    async modifyRecord(key, mutate) {
      check(key)
      calls.push(['modify', key])
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return next
    },
    async deleteRecord(key) {
      check(key)
      calls.push(['delete', key])
      records.delete(key)
    },
  }
}

test('the record key satisfies the grammar DSH parses at startup', () => {
  // The failure this guards against: `dsh-tunnel:frp-token` made the whole
  // credentials service throw while loading, so DSH would not start at all.
  assert.equal(FRP_TOKEN_SCOPE, 'dsh-tunnel')
  assert.equal(FRP_TOKEN_ID, 'frp-token')
  assert.equal(FRP_TOKEN_KEY, 'dsh-tunnel/frp-token')
  assert.equal(FRP_TOKEN_KEY.split('/').length, 2)
  for (const segment of FRP_TOKEN_KEY.split('/')) {
    assert.match(segment, CREDENTIAL_SEGMENT_PATTERN, segment)
    assert.match(segment, /^[a-z][a-z0-9-]*$/, segment)
  }
})

test('the segment grammar rejects what DSH rejects', () => {
  for (const good of ['dsh-tunnel', 'frp-token', 'a', 'a1', 'llm-pi-ai']) {
    assert.equal(CREDENTIAL_SEGMENT_PATTERN.test(good), true, good)
  }
  for (const bad of ['Dsh-Tunnel', '1abc', '-abc', 'dsh_tunnel', 'dsh tunnel', '', 'dsh:tunnel', 'dsh.tunnel']) {
    assert.equal(CREDENTIAL_SEGMENT_PATTERN.test(bad), false, bad)
  }
})

test('a joined key must be exactly two valid segments', () => {
  assert.equal(isValidCredentialKey('dsh-tunnel/frp-token'), true)
  for (const bad of [
    'dsh-tunnel:frp-token',
    'dsh-tunnel',
    'dsh-tunnel/frp-token/extra',
    '/frp-token',
    'dsh-tunnel/',
    'Dsh-Tunnel/frp-token',
    'dsh-tunnel/Frp-Token',
    '',
    undefined,
    null,
    42,
  ]) {
    assert.equal(isValidCredentialKey(bad), false, String(bad))
  }
})

test('building a key refuses invalid segments instead of emitting one', () => {
  assert.equal(credentialKey('dsh-tunnel', 'frp-token'), 'dsh-tunnel/frp-token')
  assert.throws(() => credentialKey('dsh-tunnel', 'frp:token'), /must match/)
  assert.throws(() => credentialKey('DSH', 'token'), /must match/)
  assert.throws(() => credentialKey('dsh-tunnel', ''), /must match/)
})

test('every entry point survives a store that rejects bad keys', async () => {
  const store = strictStore()
  // None of these may throw, and none may reach the store with a bad key.
  const read = await readFrpToken(store)
  const write = await writeFrpToken(store, 'a-proper-token-value')
  const described = await describeFrpToken(store)
  assert.equal(read, '')
  assert.equal(write, true)
  assert.equal(described.configured, true)
  assert.equal(described.keyValid, true)
  assert.equal(described.length, 'a-proper-token-value'.length)
  for (const [, key] of store.calls) assert.equal(isValidCredentialKey(key), true, key)
})

test('a missing service degrades to "no token" rather than throwing', async () => {
  assert.equal(await readFrpToken(undefined), '')
  assert.equal(await writeFrpToken(undefined, 'x'), false)
  assert.deepEqual(await describeFrpToken(undefined), { configured: false, writable: false, length: 0, keyValid: true })
  assert.equal(await readFrpToken({}), '')
})

test('storing then clearing leaves no record behind', async () => {
  const store = strictStore()
  await writeFrpToken(store, 'a-proper-token-value')
  assert.ok(store.records.has(FRP_TOKEN_KEY))
  await writeFrpToken(store, '')
  assert.equal(store.records.has(FRP_TOKEN_KEY), false)
  const described = await describeFrpToken(store)
  assert.equal(described.configured, false)
})

test('token shape validation still rejects empty and whitespace', () => {
  assert.equal(validateFrpToken(''), 'frp token is empty')
  assert.equal(validateFrpToken('   '), 'frp token is empty')
  assert.equal(validateFrpToken('has space in it'), 'frp token must not contain whitespace')
  assert.equal(validateFrpToken('short'), 'frp token looks too short to be a real secret')
  assert.equal(validateFrpToken('0'.repeat(64)), '')
})
