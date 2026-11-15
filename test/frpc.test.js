import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FrpcSupervisor, STABLE_WINDOW_MS, describeSpawnFailure, nextBackoff, parseFrpcVersion, parseTasklistCsv } from '../src/frpc.js'
import { ScrubLog } from '../src/logs.js'
import { frpcExecutableName } from '../src/paths.js'
import { normalizeConfig } from '../src/config-values.js'

/** A child process stand-in with streams and an exit event. */
class FakeChild extends EventEmitter {
  constructor(pid, stdoutLines = [], { exitAfterOutput = false } = {}) {
    super()
    this.pid = pid
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
    this.killed = false
    this.lines = stdoutLines
    setImmediate(() => {
      for (const line of this.lines) this.stdout.emit('data', Buffer.from(`${line}\n`))
      if (exitAfterOutput) this.emit('exit', 0, null)
    })
  }

  kill() {
    this.killed = true
    setImmediate(() => this.emit('exit', 0, null))
    return true
  }
}

test('backoff doubles from the base and stops at the ceiling', () => {
  assert.equal(nextBackoff(1, 2000, 60000), 2000)
  assert.equal(nextBackoff(2, 2000, 60000), 4000)
  assert.equal(nextBackoff(3, 2000, 60000), 8000)
  assert.equal(nextBackoff(10, 2000, 60000), 60000)
  assert.equal(nextBackoff(99, 2000, 60000), 60000)
  assert.equal(nextBackoff(0, 2000, 60000), 2000)
})

test('frpc version output is parsed whatever the decoration', () => {
  assert.equal(parseFrpcVersion('0.61.1'), '0.61.1')
  assert.equal(parseFrpcVersion('frpc version: v0.52.3\n'), '0.52.3')
  assert.equal(parseFrpcVersion(''), '')
  assert.equal(parseFrpcVersion('no version here'), '')
})

test('tasklist CSV rows are parsed for the stale-process check', () => {
  const rows = parseTasklistCsv('"frpc.exe","4242","Console","1","12,345 K"\r\n"other.exe","7","Console","1","1 K"')
  assert.deepEqual(rows, [
    { name: 'frpc.exe', pid: 4242 },
    { name: 'other.exe', pid: 7 },
  ])
  assert.deepEqual(parseTasklistCsv('INFO: no tasks'), [])
})

test('an execution block is explained instead of passed through raw', () => {
  // Observed on Windows: a scanner holds a freshly written frpc.exe, so the
  // first CreateProcess fails with EACCES and a retry succeeds.
  for (const raw of ['spawn EACCES', 'spawn EPERM', 'Access is denied.', '拒绝访问。']) {
    const message = describeSpawnFailure(raw)
    assert.match(message, /antivirus|trust list/i, raw)
  }
  assert.match(describeSpawnFailure('spawn ENOENT'), /disappeared/)
  assert.equal(describeSpawnFailure('some other failure'), 'some other failure')
})

test('a supervised frpc reports its connection and recovers from a crash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tunnel-sup-'))
  let child = null
  const spawn = (command, args) => {
    if (args[0] === '-v') return new FakeChild(1, ['0.61.1'], { exitAfterOutput: true })
    child = new FakeChild(4242, ['login to server success', 'start proxy success'])
    return child
  }
  try {
    const dataDir = join(root, 'data')
    mkdirSync(join(dataDir, 'bin'), { recursive: true })
    writeFileSync(join(dataDir, 'bin', frpcExecutableName()), 'stub')
    const config = normalizeConfig({
      enabled: true,
      serverAddr: 'vps.example.com',
      publicUrl: 'https://dsh.example.com',
      restartBaseDelayMs: 600000,
      restartMaxDelayMs: 600000,
    })
    const log = new ScrubLog({ limit: 50 })
    const supervisor = new FrpcSupervisor({
      config,
      dataDir,
      spawn,
      log,
      origin: () => 'http://127.0.0.1:13162',
      token: async () => 'the-frp-token',
    })
    const started = await supervisor.start({ reason: 'test' })
    assert.equal(started.state, 'running')
    assert.equal(started.frpcVersion, '0.61.1')
    assert.equal(started.localPort, 13162)
    const generated = readFileSync(join(dataDir, 'frpc.toml'), 'utf8')
    assert.match(generated, /localPort = 13162/)
    assert.match(generated, /auth\.token = "the-frp-token"/)

    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(supervisor.snapshot().connected, true)
    assert.equal(supervisor.snapshot().proxyStarted, true)
    assert.ok(supervisor.log.tail().some((line) => line.includes('start proxy success')))

    child.emit('exit', 1, null)
    const crashed = supervisor.snapshot()
    assert.equal(crashed.state, 'backoff')
    assert.equal(crashed.attempt, 1)
    assert.equal(crashed.lastExitCode, 1)

    await supervisor.stop('test-teardown')
    assert.equal(supervisor.snapshot().state, 'stopped')
    assert.equal(supervisor.snapshot().pid, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// A running child is actually terminated, which is what keeps the tunnel from
// becoming an orphan when DSH quits.
test('stopping a live tunnel kills the child', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tunnel-sup-kill-'))
  let live = null
  const spawn = (command, args) => {
    if (args[0] === '-v') return new FakeChild(1, ['0.61.1'], { exitAfterOutput: true })
    live = new FakeChild(777, [])
    return live
  }
  try {
    const dataDir = join(root, 'data')
    mkdirSync(join(dataDir, 'bin'), { recursive: true })
    writeFileSync(join(dataDir, 'bin', frpcExecutableName()), 'stub')
    const supervisor = new FrpcSupervisor({
      config: normalizeConfig({ serverAddr: 'vps.example.com', publicUrl: 'https://x.example.com' }),
      dataDir,
      spawn,
      log: new ScrubLog({ limit: 20 }),
      origin: () => 'http://127.0.0.1:13162',
      token: async () => 'the-frp-token',
    })
    await supervisor.start({ reason: 'test' })
    assert.equal(live.killed, false)
    await supervisor.stop('test')
    assert.equal(live.killed, true)
    assert.equal(supervisor.snapshot().pid, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('missing binary and missing token are reported, not retried forever', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tunnel-sup-bad-'))
  try {
    const dataDir = join(root, 'data')
    mkdirSync(dataDir, { recursive: true })
    const config = normalizeConfig({ serverAddr: 'vps.example.com', publicUrl: 'https://x.example.com' })
    const supervisor = new FrpcSupervisor({
      config,
      dataDir,
      spawn: () => new FakeChild(1),
      log: new ScrubLog({ limit: 10 }),
      origin: () => 'http://127.0.0.1:13162',
      token: async () => '',
    })
    const withoutBinary = await supervisor.start({ reason: 'test' })
    assert.equal(withoutBinary.state, 'missing-binary')

    writeFileSync(join(dataDir, 'bin-marker'), '')
    mkdirSync(join(dataDir, 'bin'), { recursive: true })
    writeFileSync(join(dataDir, 'bin', frpcExecutableName()), 'stub')
    const withoutToken = await supervisor.start({ reason: 'test' })
    assert.equal(withoutToken.state, 'invalid-config')
    assert.match(withoutToken.lastError, /token/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an authentication failure is surfaced as an actionable error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tunnel-sup-auth-'))
  let child = null
  const spawn = (command, args) => {
    if (args[0] === '-v') return new FakeChild(1, ['0.61.1'], { exitAfterOutput: true })
    child = new FakeChild(9, ['login to server failed: authorization failed'])
    return child
  }
  try {
    const dataDir = join(root, 'data')
    mkdirSync(join(dataDir, 'bin'), { recursive: true })
    writeFileSync(join(dataDir, 'bin', frpcExecutableName()), 'stub')
    const supervisor = new FrpcSupervisor({
      config: normalizeConfig({ serverAddr: 'vps.example.com', publicUrl: 'https://x.example.com', restartBaseDelayMs: 600000, restartMaxDelayMs: 600000 }),
      dataDir,
      spawn,
      log: new ScrubLog({ limit: 20, secrets: () => ['the-frp-token'] }),
      origin: () => 'http://127.0.0.1:13162',
      token: async () => 'the-frp-token',
    })
    await supervisor.start({ reason: 'test' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.match(supervisor.snapshot().lastError, /rejected the login/)
    await supervisor.stop('done')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a TLS handshake failure is explained, not left raw', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tunnel-sup-tls-'))
  let child = null
  const spawn = (command, args) => {
    if (args[0] === '-v') return new FakeChild(1, ['0.61.1'], { exitAfterOutput: true })
    child = new FakeChild(12, ['connect to server error: tls: first record does not look like a TLS handshake'])
    return child
  }
  try {
    const dataDir = join(root, 'data')
    mkdirSync(join(dataDir, 'bin'), { recursive: true })
    writeFileSync(join(dataDir, 'bin', frpcExecutableName()), 'stub')
    const supervisor = new FrpcSupervisor({
      config: normalizeConfig({ serverAddr: 'vps.example.com', publicUrl: 'https://x.example.com', restartBaseDelayMs: 600000, restartMaxDelayMs: 600000 }),
      dataDir,
      spawn,
      log: new ScrubLog({ limit: 20 }),
      origin: () => 'http://127.0.0.1:13162',
      token: async () => 'the-frp-token',
    })
    await supervisor.start({ reason: 'test' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.match(supervisor.snapshot().lastError, /TLS handshake failed/)
    await supervisor.stop('done')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test('a crash after a stable run starts the backoff ladder over', async () => {  const root = mkdtempSync(join(tmpdir(), 'dsh-tunnel-sup-stable-'))
  let child = null
  const spawn = (command, args) => {
    if (args[0] === '-v') return new FakeChild(1, ['0.61.1'], { exitAfterOutput: true })
    child = new FakeChild(11, [])
    return child
  }
  try {
    const dataDir = join(root, 'data')
    mkdirSync(join(dataDir, 'bin'), { recursive: true })
    writeFileSync(join(dataDir, 'bin', frpcExecutableName()), 'stub')
    const supervisor = new FrpcSupervisor({
      config: normalizeConfig({ serverAddr: 'vps.example.com', publicUrl: 'https://x.example.com', restartBaseDelayMs: 600000, restartMaxDelayMs: 600000 }),
      dataDir,
      spawn,
      log: new ScrubLog({ limit: 20 }),
      origin: () => 'http://127.0.0.1:13162',
      token: async () => 'the-frp-token',
    })
    supervisor.attempt = 4
    await supervisor.start({ reason: 'test' })
    supervisor.startedAt = new Date(Date.now() - STABLE_WINDOW_MS - 1000).toISOString()
    child.emit('exit', 1, null)
    assert.equal(supervisor.snapshot().attempt, 1, 'a long successful run resets the ladder')
    await supervisor.stop('done')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
