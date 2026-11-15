import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import {
  dshHome,
  findOnPath,
  frpcCandidates,
  frpcExecutableName,
  isExecutableFile,
  profileInfo,
  resolveDataDir,
  resolveFrpcBinary,
  resolveUserPath,
} from '../src/paths.js'

test('DSH_HOME wins, home fallback otherwise', () => {
  assert.equal(dshHome({ DSH_HOME: 'D:\\dsh' }), 'D:\\dsh')
  assert.equal(dshHome({}), join(homedir(), '.dsh'))
})

test('user paths never depend on the working directory', () => {
  assert.equal(resolveUserPath(''), '')
  assert.equal(resolveUserPath('   '), '')
  assert.equal(resolveUserPath('~'), homedir())
  assert.equal(resolveUserPath('~/bin/frpc'), join(homedir(), 'bin', 'frpc'))
  assert.equal(resolveUserPath('bin/frpc'), join(homedir(), 'bin', 'frpc'))
  assert.equal(resolveUserPath('C:\\tools\\frpc.exe'), 'C:\\tools\\frpc.exe')
})

test('the data directory follows DSH_HOME unless configured', () => {
  assert.equal(resolveDataDir({}, { DSH_HOME: 'D:\\dsh' }), join('D:\\dsh', 'dsh-tunnel'))
  assert.equal(resolveDataDir({ dataDir: '~/tunnel' }, {}), join(homedir(), 'tunnel'))
})

test('candidates are ordered: configured, managed, plugin root, PATH name', () => {
  const list = frpcCandidates({ dataDir: join(homedir(), 'data'), frpcPath: '~/custom/frpc', platform: 'win32' })
  assert.equal(list[0], join(homedir(), 'custom', 'frpc'))
  assert.equal(list[1], join(homedir(), 'data', 'bin', 'frpc.exe'))
  assert.equal(list[2], join(homedir(), 'data', 'frpc.exe'))
  assert.equal(list[3], 'frpc.exe')
  assert.equal(frpcExecutableName('win32'), 'frpc.exe')
  assert.equal(frpcExecutableName('linux'), 'frpc')
})

test('an executable is resolved from PATH with the platform separator', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tunnel-path-'))
  try {
    const archive = join(root, 'archive')
    const tools = join(root, 'tools')
    mkdirSync(archive)
    mkdirSync(tools)
    writeFileSync(join(tools, 'frpc.exe'), 'stub')
    const env = { Path: [archive, tools].join(';') }
    assert.equal(findOnPath('frpc.exe', { env, platform: 'win32' }), join(tools, 'frpc.exe'))
    assert.equal(findOnPath('frpc.exe', { env: { Path: archive }, platform: 'win32' }), '')
    assert.equal(findOnPath('frpc', { env: { PATH: root }, platform: 'linux' }), '')
    assert.equal(isExecutableFile(join(tools, 'frpc.exe')), true)
    assert.equal(isExecutableFile(tools), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the managed copy under the data directory is found without configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tunnel-bin-'))
  try {
    const dataDir = join(root, 'data')
    mkdirSync(join(dataDir, 'bin'), { recursive: true })
    writeFileSync(join(dataDir, 'bin', frpcExecutableName()), 'stub')
    const found = resolveFrpcBinary({ dataDir, platform: process.platform })
    assert.equal(found.source, 'managed')
    assert.equal(found.path, join(dataDir, 'bin', frpcExecutableName()))
    const missing = resolveFrpcBinary({ dataDir: join(root, 'empty'), platform: process.platform, env: { PATH: '' } })
    assert.deepEqual(missing, { path: '', source: 'missing' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a configured path that does not exist is reported, not silently replaced', () => {
  const result = resolveFrpcBinary({ dataDir: tmpdir(), frpcPath: '~/definitely-not-here/frpc', platform: process.platform })
  assert.equal(result.source, 'missing')
  assert.equal(result.path, join(homedir(), 'definitely-not-here', 'frpc'))
})

test('profile information is read from the service, then the environment', () => {
  const ctx = { get: (name) => (name === 'profileContext' ? { dir: 'P', name: 'desktop', patchPath: 'P/cordis.patch.yml' } : undefined) }
  assert.deepEqual(profileInfo(ctx, {}), { dir: 'P', name: 'desktop', patchPath: 'P/cordis.patch.yml' })
  const bare = { get: () => undefined }
  assert.deepEqual(profileInfo(bare, { DSH_PROFILE_DIR: 'Q', DSH_PROFILE: 'web' }), { dir: 'Q', name: 'web', patchPath: '' })
  assert.deepEqual(profileInfo(undefined, {}), { dir: '', name: '', patchPath: '' })
})
