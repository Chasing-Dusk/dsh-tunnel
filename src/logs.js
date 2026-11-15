/**
 * A bounded, always-redacted log for one supervised child process.
 *
 * frpc prints its effective configuration on some failures, so every line is
 * scrubbed before it is stored, written to disk, or returned by the API.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { scrub } from './secrets.js'

/** A fixed-size ring of text lines. */
export class LineRing {
  /**
   * @param {number} limit - how many lines to keep.
   */
  constructor(limit = 400) {
    this.limit = Math.max(1, limit)
    this.lines = []
  }

  /** Appends one line, dropping the oldest past the limit. */
  push(line) {
    this.lines.push(line)
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit)
  }

  /** All retained lines, oldest first. */
  toArray() {
    return [...this.lines]
  }

  /** Drops everything. */
  clear() {
    this.lines = []
  }
}

/**
 * A log sink that scrubs, buffers and optionally appends to a file with size
 * rotation.
 */
export class ScrubLog {
  /**
   * @param {object} options - sink options.
   * @param {number} [options.limit] - retained lines in memory.
   * @param {string} [options.file] - append target; omit to stay in memory.
   * @param {number} [options.maxBytes] - rotation threshold.
   * @param {() => string[]} [options.secrets] - current secret values.
   */
  constructor({ limit = 400, file = '', maxBytes = 256 * 1024, secrets = () => [] } = {}) {
    this.ring = new LineRing(limit)
    this.file = file
    this.maxBytes = maxBytes
    this.secrets = secrets
  }

  /** Replaces the retained-line limit, keeping the newest lines. */
  setLimit(limit) {
    this.ring.limit = Math.max(1, limit)
    if (this.ring.lines.length > this.ring.limit) {
      this.ring.lines.splice(0, this.ring.lines.length - this.ring.limit)
    }
  }

  /**
   * Records one already-split line.
   * @param {string} line - raw line.
   * @param {string} [stream] - `out` or `err`.
   */
  append(line, stream = 'out') {
    const text = scrub(line, this.secrets())
    if (text.trim() === '') return
    const stamped = `${new Date().toISOString()} ${stream === 'err' ? 'E' : 'I'} ${text}`.trimEnd()
    this.ring.push(stamped)
    this.flushFile(stamped)
  }

  /**
   * Records a chunk of possibly multi-line output.
   * @param {string} chunk - raw output.
   * @param {string} [stream] - `out` or `err`.
   */
  appendChunk(chunk, stream = 'out') {
    for (const line of String(chunk ?? '').split(/\r?\n/)) this.append(line, stream)
  }

  /** Records a plugin-authored message. */
  note(message) {
    this.append(message, 'out')
  }

  /** The retained lines. */
  tail() {
    return this.ring.toArray()
  }

  /** Clears the in-memory buffer only. */
  clear() {
    this.ring.clear()
  }

  /** Appends to the log file, rotating it when it grows past the threshold. */
  flushFile(line) {
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      if (existsSync(this.file) && statSync(this.file).size > this.maxBytes) {
        renameSync(this.file, `${this.file}.1`)
      }
      appendFileSync(this.file, `${line}\n`, { mode: 0o600 })
    } catch {
      // A log that cannot be written must never take the tunnel down.
    }
  }
}
