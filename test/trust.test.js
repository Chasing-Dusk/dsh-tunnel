import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CONNECTION_ROW_ID,
  CONNECTION_ROW_NAME,
  dedupeHosts,
  findConnectionRow,
  isExpression,
  isTrustedHostEntry,
  literalHosts,
  planTrustPatch,
  planTrustRevert,
} from '../src/trust.js'

/** The shipped `connection` row config from the dsh-web-app bundle patch. */
const BUNDLE_EXPRESSION = { trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' } }

test('the cookieMaxAgeDays write keeps the public host trusted', () => {
  // Regression guard for the documented trap: a profile patch replaces the
  // whole row config, so writing only cookieMaxAgeDays would drop trustedHosts.
  const plan = planTrustPatch({
    publicHost: 'dsh.example.com',
    extraHosts: [],
    invocationHosts: [],
    inherited: BUNDLE_EXPRESSION,
    override: {},
    cookieMaxAgeDays: 3650,
  })
  assert.deepEqual(plan.next.trustedHosts, ['dsh.example.com'])
  assert.equal(plan.next.cookieMaxAgeDays, 3650)
  assert.equal(plan.needsWrite, true)
  assert.equal(plan.frozenExpression, true)
})

test('invocation authorities survive the freeze of the bundle expression', () => {
  const plan = planTrustPatch({
    publicHost: 'dsh.example.com',
    extraHosts: ['192.168.1.20:3080'],
    invocationHosts: ['lan.example.internal'],
    inherited: BUNDLE_EXPRESSION,
    override: {},
    cookieMaxAgeDays: 365,
  })
  assert.deepEqual(plan.next.trustedHosts, ['dsh.example.com', '192.168.1.20:3080', 'lan.example.internal'])
})

test('a literal inherited list is preserved, not replaced', () => {
  const plan = planTrustPatch({
    publicHost: 'dsh.example.com',
    extraHosts: [],
    invocationHosts: [],
    inherited: { trustedHosts: ['127.0.0.1:3080'], cookieMaxAgeDays: 30, maxRequestBodyBytes: 1234 },
    override: {},
    cookieMaxAgeDays: 3650,
  })
  assert.deepEqual(plan.next.trustedHosts, ['dsh.example.com', '127.0.0.1:3080'])
  assert.equal(plan.next.maxRequestBodyBytes, 1234, 'unrelated inherited keys are restated')
})

test('a previous override is not lost when the config is rewritten', () => {
  const plan = planTrustPatch({
    publicHost: 'new.example.com',
    extraHosts: [],
    invocationHosts: [],
    inherited: BUNDLE_EXPRESSION,
    override: { trustedHosts: ['old.example.com'], cookieMaxAgeDays: 30 },
    cookieMaxAgeDays: 3650,
  })
  assert.deepEqual(plan.next.trustedHosts, ['new.example.com', 'old.example.com'])
  assert.equal(plan.next.cookieMaxAgeDays, 3650)
})

test('duplicates collapse case-insensitively and keep the first spelling', () => {
  const plan = planTrustPatch({
    publicHost: 'DSH.example.com',
    extraHosts: ['dsh.example.com', 'dsh.example.com:443'],
    invocationHosts: [],
    inherited: {},
    override: {},
    cookieMaxAgeDays: 30,
  })
  assert.deepEqual(plan.next.trustedHosts, ['DSH.example.com', 'dsh.example.com:443'])
})

test('invalid entries are rejected instead of written', () => {
  const plan = planTrustPatch({
    publicHost: 'dsh.example.com',
    extraHosts: ['*', 'https://dsh.example.com', 'has space', 'host:99999', ''],
    invocationHosts: [],
    inherited: {},
    override: {},
    cookieMaxAgeDays: 30,
  })
  assert.deepEqual(plan.next.trustedHosts, ['dsh.example.com'])
  assert.deepEqual(plan.rejected, ['*', 'https://dsh.example.com', 'has space', 'host:99999'])
})

test('nothing to write when the row already equals the plan', () => {
  const inherited = { trustedHosts: ['dsh.example.com'], cookieMaxAgeDays: 3650 }
  const plan = planTrustPatch({
    publicHost: 'dsh.example.com',
    extraHosts: [],
    invocationHosts: [],
    inherited,
    override: inherited,
    cookieMaxAgeDays: 3650,
  })
  assert.equal(plan.needsWrite, false)
})

test('revert answers exactly the inherited layer so the override is deleted', () => {
  assert.deepEqual(planTrustRevert(BUNDLE_EXPRESSION), BUNDLE_EXPRESSION)
  assert.deepEqual(planTrustRevert(undefined), {})
  assert.notEqual(planTrustRevert(BUNDLE_EXPRESSION).trustedHosts, BUNDLE_EXPRESSION.trustedHosts)
})

test('authority validation matches the Host values DSH compares', () => {
  for (const good of ['dsh.example.com', 'dsh.example.com:443', 'localhost', '[::1]', '[::1]:3080', '192.168.1.20:3080', 'a-b.example.com']) {
    assert.equal(isTrustedHostEntry(good), true, good)
  }
  for (const bad of ['', ' ', '*', '**', 'https://x.y', 'x y', 'host:0', 'host:70000', '-bad.com', 'bad-.com', 'a/b']) {
    assert.equal(isTrustedHostEntry(bad), false, bad)
  }
})

test('layer helpers read only what they can trust', () => {
  assert.equal(isExpression(BUNDLE_EXPRESSION.trustedHosts), true)
  assert.equal(isExpression(['a']), false)
  assert.deepEqual(literalHosts([' a ', 3, null, 'b']), ['a', 'b'])
  assert.deepEqual(literalHosts(BUNDLE_EXPRESSION.trustedHosts), [])
  assert.deepEqual(dedupeHosts(['a.com', 'A.com', 'b.com']), { hosts: ['a.com', 'b.com'], rejected: [] })
})

test('the connection row is found by package name, then by row id', () => {
  const byName = { entry: { options: { id: 'include:connection', name: CONNECTION_ROW_NAME } } }
  const byId = { entry: { options: { id: CONNECTION_ROW_ID, name: 'something-else' } } }
  assert.equal(findConnectionRow([byId, byName]), byName)
  assert.equal(findConnectionRow([byId]), byId)
  assert.equal(findConnectionRow([]), undefined)
  assert.equal(findConnectionRow(undefined), undefined)
})
