/**
 * Durable, non-secret plugin state: what the plugin created on this machine so
 * it can clean it up again. Secrets never go here.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const STATE_FILE = 'state.json'
const STATE_VERSION = 1

/** The state file path inside the plugin data directory. */
export function stateFilePath(dataDir) {
  return join(dataDir, STATE_FILE)
}

/** An empty state document. */
export function emptyState() {
  return {
    version: STATE_VERSION,
    startupShortcut: '',
    frpcBinary: '',
    frpcVersion: '',
    lastRunAt: '',
    lastExitAt: '',
    lastExitCode: null,
    lastError: '',
  }
}

/**
 * Reads the state document, tolerating a missing or corrupt file.
 * @param {string} dataDir - plugin data directory.
 * @returns {object} the state.
 */
export function readState(dataDir) {
  try {
    const parsed = JSON.parse(readFileSync(stateFilePath(dataDir), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState()
    return { ...emptyState(), ...parsed, version: STATE_VERSION }
  } catch {
    return emptyState()
  }
}

/**
 * Writes the state document atomically, so a crash never leaves half a file.
 * @param {string} dataDir - plugin data directory.
 * @param {object} state - the document.
 */
export function writeState(dataDir, state) {
  const path = stateFilePath(dataDir)
  const temp = `${path}.${process.pid}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temp, `${JSON.stringify({ ...emptyState(), ...state, version: STATE_VERSION }, null, 2)}\n`, {
    mode: 0o600,
  })
  renameSync(temp, path)
}

/** Removes the state file, ignoring absence. */
export function clearState(dataDir) {
  rmSync(stateFilePath(dataDir), { force: true })
}

/** Merges a patch into the current state and persists it. */
export function patchState(dataDir, patch) {
  const next = { ...readState(dataDir), ...patch }
  writeState(dataDir, next)
  return next
}
