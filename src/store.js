// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the one writable
// volume, file mode 0600):
//
//   salt       a random key made once, for the HMAC below;
//   refusal    HMAC-SHA256 (keyed with `salt`) of an API key TRMNL refused,
//              so a restart with the same key does not try it again. Erased
//              at the first successful reading. The key itself, or a
//              fingerprint of a key that works, is never written;
//   pause      the end (and the reason: 'busy' or 'server:<status>') of a
//              pause after a 429 or a 5xx;
//   attemptAt  the time of the last reading attempt, written BEFORE the
//              request, so a container restarting in a loop never reads
//              faster than the interval;
//   devices    the displays seen (id, name, friendly id, MAC), so the
//              Discovery tab is filled again before the first reading.
//
// Tables keyed by network values have no prototype; every field is checked
// when read back, and saved times are bounded.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS, STORE_FILE, TIMINGS } from './constants.js';
import { cleanText } from './trmnl/parse.js';

export const emptyData = () => ({
  salt: null,
  refusal: null,
  pause: null,
  attemptAt: null,
  devices: Object.create(null),
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX64 = /^[0-9a-f]{64}$/;

/** The saved data, checked field by field; `now` bounds the saved times. */
export function sanitize(data, now = Date.now()) {
  const base = emptyData();
  if (!isObject(data)) {
    return base;
  }
  if (typeof data.salt === 'string' && HEX64.test(data.salt)) {
    base.salt = data.salt;
  }
  if (typeof data.refusal === 'string' && HEX64.test(data.refusal)) {
    base.refusal = data.refusal;
  }
  const p = data.pause;
  if (isObject(p) && Number.isFinite(p.until) && p.until > now) {
    // A saved end is never trusted beyond the longest pause.
    base.pause = {
      until: Math.min(p.until, now + TIMINGS.pauseMax),
      reason:
        typeof p.reason === 'string' && /^(busy|server:\d{3})$/.test(p.reason) ? p.reason : 'busy',
    };
  }
  if (Number.isFinite(data.attemptAt)) {
    // A time in the future (a clock set back) counts as now.
    base.attemptAt = Math.min(data.attemptAt, now);
  }
  if (isObject(data.devices)) {
    for (const [key, d] of Object.entries(data.devices).slice(0, LIMITS.devices)) {
      if (/^[1-9]\d{0,15}$/.test(key) && isObject(d) && String(d.id) === key) {
        base.devices[key] = {
          id: Number(key),
          name: cleanText(d.name, LIMITS.name) ?? null,
          friendlyId:
            typeof d.friendlyId === 'string' && /^[A-Z0-9]{1,16}$/.test(d.friendlyId)
              ? d.friendlyId
              : null,
          mac:
            typeof d.mac === 'string' && /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/.test(d.mac)
              ? d.mac
              : null,
        };
      }
    }
  }
  return base;
}

/** A new random salt (hex). */
export const newSalt = () => randomBytes(32).toString('hex');

export class FileStore {
  constructor({ dir = process.env.DATA_DIR || '/data', name = STORE_FILE } = {}) {
    this.dir = dir;
    this.path = join(dir, name);
    this.corrupted = false;
    /** The writes, one after the other: the last save always lands last. */
    this.queue = Promise.resolve();
    this.writes = 0;
  }

  /**
   * The saved data. An unreadable file is moved aside to `<name>.bad` and
   * `corrupted` is set, so the app says so instead of silently starting over.
   */
  async load(now = Date.now()) {
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return emptyData();
    }
    try {
      return sanitize(JSON.parse(text), now);
    } catch {
      this.corrupted = true;
      const bad = `${this.path}.bad`;
      await rename(this.path, bad).catch(() => {});
      await chmod(bad, 0o600).catch(() => {});
      return emptyData();
    }
  }

  /** Saves a snapshot of `data` (taken now), after the writes already queued. */
  save(data) {
    const text = JSON.stringify(data);
    const run = this.queue.then(() => this.write(text));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Resolves once every queued write ended. */
  flush() {
    return this.queue;
  }

  async write(text) {
    await mkdir(this.dir, { recursive: true });
    this.writes += 1;
    const temporary = `${this.path}.${process.pid}.${this.writes}.${randomBytes(4).toString('hex')}.tmp`;
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.path);
    } catch (err) {
      await rm(temporary, { force: true }).catch(() => {});
      throw err;
    }
  }
}

/** For the tests: what a restart would read back, through JSON as the file store. */
export class MemoryStore {
  constructor(data = emptyData()) {
    this.data = JSON.parse(JSON.stringify(data));
    this.saves = 0;
    this.corrupted = false;
  }

  async load(now = Date.now()) {
    return sanitize(JSON.parse(JSON.stringify(this.data)), now);
  }

  async save(data) {
    this.data = JSON.parse(JSON.stringify(data));
    this.saves += 1;
  }

  flush() {
    return Promise.resolve();
  }
}
