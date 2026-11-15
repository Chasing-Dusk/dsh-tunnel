/**
 * "Recover after a Windows reboot" without administrator rights.
 *
 * A service or a scheduled task needs elevation, so the only supported path is
 * a shortcut in the current user's Startup folder, created on explicit request
 * and removed again on uninstall. Nothing here runs unless a human asks for it.
 */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Default shortcut file name. */
export const SHORTCUT_NAME = 'DSH tunnel (dsh-tunnel).lnk'

/**
 * The current user's Startup folder.
 * @param {NodeJS.ProcessEnv} [env] - environment.
 * @returns {string} an absolute folder path, or `''` when unavailable.
 */
export function startupFolder(env = process.env) {
  const appData = typeof env.APPDATA === 'string' ? env.APPDATA.trim() : ''
  if (appData === '') return ''
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

/**
 * The shortcut path this plugin manages.
 * @param {NodeJS.ProcessEnv} [env] - environment.
 * @param {string} [name] - file name override.
 * @returns {string} the absolute `.lnk` path, or `''`.
 */
export function startupShortcutPath(env = process.env, name = SHORTCUT_NAME) {
  const folder = startupFolder(env)
  return folder === '' ? '' : join(folder, name)
}

/**
 * Escapes one value for a single-quoted PowerShell string literal.
 * @param {unknown} value - raw value.
 * @returns {string} the literal, including quotes.
 */
export function psLiteral(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`
}

/**
 * Builds the PowerShell that creates the startup shortcut.
 *
 * `WScript.Shell` is available to every interactive Windows user; this is the
 * same mechanism a user would use by hand, which is why it needs no elevation.
 * @param {object} input - shortcut facts.
 * @param {string} input.lnkPath - where to write the shortcut.
 * @param {string} input.target - executable to launch.
 * @param {string} [input.arguments] - command line arguments.
 * @param {string} [input.workingDirectory] - working directory.
 * @param {string} [input.description] - shortcut comment.
 * @param {string} [input.iconLocation] - icon source.
 * @returns {string} a PowerShell script.
 */
export function buildShortcutScript({ lnkPath, target, arguments: args = '', workingDirectory = '', description = '', iconLocation = '' }) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$shortcutPath = ${psLiteral(lnkPath)}`,
    '$shell = New-Object -ComObject WScript.Shell',
    '$shortcut = $shell.CreateShortcut($shortcutPath)',
    `$shortcut.TargetPath = ${psLiteral(target)}`,
  ]
  if (args !== '') lines.push(`$shortcut.Arguments = ${psLiteral(args)}`)
  if (workingDirectory !== '') lines.push(`$shortcut.WorkingDirectory = ${psLiteral(workingDirectory)}`)
  if (description !== '') lines.push(`$shortcut.Description = ${psLiteral(description)}`)
  if (iconLocation !== '') lines.push(`$shortcut.IconLocation = ${psLiteral(iconLocation)}`)
  lines.push('$shortcut.Save()', 'if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "shortcut was not created" }')
  return `${lines.join('\n')}\n`
}

/**
 * Whether this platform can host a Startup shortcut at all.
 * @param {NodeJS.ProcessEnv} [env] - environment.
 * @param {string} [platform] - platform override.
 * @returns {boolean} support.
 */
export function supportsStartupShortcut(env = process.env, platform = process.platform) {
  return platform === 'win32' && startupFolder(env) !== ''
}

/**
 * Whether the managed shortcut currently exists.
 * @param {string} lnkPath - shortcut path.
 * @returns {boolean} existence.
 */
export function shortcutExists(lnkPath) {
  return typeof lnkPath === 'string' && lnkPath !== '' && existsSync(lnkPath)
}

/**
 * Removes the shortcut, but only one this plugin recorded as its own.
 * @param {string} lnkPath - shortcut path.
 * @param {string} recorded - the path the plugin previously created.
 * @returns {boolean} whether a file was removed.
 */
export function removeShortcut(lnkPath, recorded) {
  if (lnkPath === '' || lnkPath !== recorded) return false
  try {
    rmSync(lnkPath, { force: true })
    return true
  } catch {
    return false
  }
}
