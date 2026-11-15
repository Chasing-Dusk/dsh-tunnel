import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  SHORTCUT_NAME,
  buildShortcutScript,
  psLiteral,
  removeShortcut,
  shortcutExists,
  startupFolder,
  startupShortcutPath,
  supportsStartupShortcut,
} from '../src/startup.js'

test('the Startup folder is derived from APPDATA, never hardcoded', () => {
  const env = { APPDATA: 'C:\\Users\\someone\\AppData\\Roaming' }
  assert.equal(
    startupFolder(env),
    join('C:\\Users\\someone\\AppData\\Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
  )
  assert.equal(startupFolder({}), '')
  assert.equal(startupShortcutPath(env), join(startupFolder(env), SHORTCUT_NAME))
  assert.equal(startupShortcutPath({}), '')
})

test('support requires Windows and a resolvable Startup folder', () => {
  assert.equal(supportsStartupShortcut({ APPDATA: 'C:\\x' }, 'win32'), true)
  assert.equal(supportsStartupShortcut({ APPDATA: 'C:\\x' }, 'linux'), false)
  assert.equal(supportsStartupShortcut({}, 'win32'), false)
})

test('PowerShell literals escape quotes rather than breaking the script', () => {
  assert.equal(psLiteral('plain'), "'plain'")
  assert.equal(psLiteral("it's"), "'it''s'")
  assert.equal(psLiteral(undefined), "''")
})

test('the generated script sets the target and saves the shortcut', () => {
  const script = buildShortcutScript({
    lnkPath: "C:\\Startup\\DSH it's.lnk",
    target: 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe',
    workingDirectory: 'C:\\Program Files\\DeepSeek Harness',
    description: 'Start DSH',
  })
  assert.match(script, /New-Object -ComObject WScript\.Shell/)
  assert.match(script, /CreateShortcut\(\$shortcutPath\)/)
  assert.match(script, /TargetPath = 'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness\.exe'/)
  assert.match(script, /DSH it''s\.lnk/)
  assert.match(script, /WorkingDirectory = 'C:\\Program Files\\DeepSeek Harness'/)
  assert.match(script, /\$shortcut\.Save\(\)/)
  assert.ok(script.endsWith('\n'))
})

test('optional shortcut fields are omitted when empty', () => {
  const script = buildShortcutScript({ lnkPath: 'x.lnk', target: 'y.exe' })
  assert.doesNotMatch(script, /\.Arguments/)
  assert.doesNotMatch(script, /\.Description/)
  assert.doesNotMatch(script, /\.IconLocation/)
})

test('only a shortcut this plugin recorded is ever removed', () => {
  const path = join(startupFolder({ APPDATA: 'C:\\nonexistent-prefix' }), SHORTCUT_NAME)
  assert.equal(shortcutExists(path), false)
  assert.equal(removeShortcut(path, 'some other path'), false, 'never deletes a foreign shortcut')
  assert.equal(removeShortcut('', ''), false)
})
