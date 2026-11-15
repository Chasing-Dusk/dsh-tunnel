import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeRegExp, maskSecret, redactSecrets, scrub, splitAuthenticatedUrl, stripAnsi, stripUrlQueries } from '../src/secrets.js'
import { LineRing, ScrubLog, localStamp } from '../src/logs.js'

test('masking never reveals the body of a secret', () => {
  assert.equal(maskSecret(''), '')
  assert.equal(maskSecret(undefined), '')
  assert.equal(maskSecret('abcd', 4), '••••••••')
  assert.equal(maskSecret('0123456789abcdef', 4), '••••••••cdef')
})

test('redaction removes raw and url-encoded forms', () => {
  const secret = 'a+b/c=d&e'
  const text = `token=${secret} encoded=${encodeURIComponent(secret)}`
  const out = redactSecrets(text, [secret])
  assert.ok(!out.includes(secret))
  assert.ok(!out.includes(encodeURIComponent(secret)))
  assert.equal(redactSecrets('nothing here', ['x'.repeat(8)]), 'nothing here')
})

test('short values are not treated as secrets', () => {
  assert.equal(redactSecrets('abc', ['abc']), 'abc')
})

test('regex metacharacters in a secret are matched literally', () => {
  assert.equal(escapeRegExp('a.b*c'), 'a\\.b\\*c')
  assert.equal(redactSecrets('x a.b*c y', ['a.b*c']), 'x •••••••• y')
})

test('the DSH access token never survives in a logged URL', () => {
  const text = 'open http://127.0.0.1:3080/?token=abcdef now'
  assert.equal(stripUrlQueries(text), 'open http://127.0.0.1:3080/?… now')
  assert.equal(scrub('http://x/?token=1 path', []), 'http://x/?… path')
})

test('the scrubbed log keeps lines bounded and redacted', () => {
  const log = new ScrubLog({ limit: 3, secrets: () => ['supersecret'] })
  log.appendChunk('line one\nline two with supersecret\nline three\nline four', 'out')
  const tail = log.tail()
  assert.equal(tail.length, 3)
  assert.ok(tail.every((line) => !line.includes('supersecret')))
  assert.ok(tail.at(-1).includes('line four'))
  log.setLimit(2)
  assert.equal(log.tail().length, 2)
  log.clear()
  assert.deepEqual(log.tail(), [])
})

test('the ring drops the oldest entries', () => {
  const ring = new LineRing(2)
  ring.push('a')
  ring.push('b')
  ring.push('c')
  assert.deepEqual(ring.toArray(), ['b', 'c'])
})

test('frpc colour escapes are stripped before anything renders them', () => {
  // Observed on Windows: frpc writes SGR sequences to a pipe when colour is
  // on, and a plain <pre> shows them as "[1;34m" noise.
  const coloured = '\u001b[1;34m2026-11-15 20:14:20.049 [I] [sub/root.go:194] start frpc\u001b[0m'
  assert.equal(stripAnsi(coloured), '2026-11-15 20:14:20.049 [I] [sub/root.go:194] start frpc')
  assert.equal(stripAnsi('\u001b[33mwarning\u001b[0m and \u001b[0mplain'), 'warning and plain')
  assert.equal(stripAnsi('no escapes'), 'no escapes')
  assert.equal(stripAnsi(''), '')
  assert.equal(scrub(coloured, []).includes('\u001b'), false)
})

test('an frpc line keeps its own timestamp instead of getting a second one', () => {
  const log = new ScrubLog({ limit: 10 })
  log.append('\u001b[1;34m2026-11-15 20:14:20.049 [I] [client/service.go:335] try to connect to server...\u001b[0m', 'out')
  log.note('starting frpc (dsh-start)')
  const lines = log.tail()
  assert.equal(lines.length, 2)
  assert.equal(lines[0], '2026-11-15 20:14:20.049 [I] [client/service.go:335] try to connect to server...')
  assert.match(lines[1], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} I starting frpc \(dsh-start\)$/)
})

test('the local stamp matches the format frp uses', () => {
  const stamp = localStamp(new Date(2026, 10, 15, 20, 4, 5, 67))
  assert.equal(stamp, '2026-11-15 20:04:05.067')
})

test('an authenticated URL is split without losing its shape', () => {
  const { url, token } = splitAuthenticatedUrl('https://dsh.example.com/?token=abc123')
  assert.equal(url, 'https://dsh.example.com/')
  assert.equal(token, 'abc123')
  assert.deepEqual(splitAuthenticatedUrl('not a url'), { url: 'not a url', token: '' })
})
