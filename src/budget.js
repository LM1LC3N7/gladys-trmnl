// -----------------------------------------------------------------------------
// A sliding one-minute window of what was sent. Two of them: the states
// (POST /state admits 300 per minute per integration; what does not fit
// waits) and the commands toward TRMNL.
// -----------------------------------------------------------------------------

const WINDOW_MS = 60_000;

export class Budget {
  constructor({ perMinute, now = Date.now }) {
    this.perMinute = perMinute;
    this.now = now;
    this.entries = []; // [at, count]
  }

  prune() {
    const since = this.now() - WINDOW_MS;
    while (this.entries.length > 0 && this.entries[0][0] <= since) this.entries.shift();
  }

  used() {
    this.prune();
    return this.entries.reduce((sum, [, count]) => sum + count, 0);
  }

  remaining() {
    return Math.max(0, this.perMinute - this.used());
  }

  /** When room comes back (ms from now), 0 when there is room now. */
  waitMs() {
    this.prune();
    if (this.remaining() > 0 || this.entries.length === 0) return 0;
    return Math.max(0, this.entries[0][0] + WINDOW_MS - this.now());
  }

  record(count) {
    if (count > 0) this.entries.push([this.now(), count]);
  }
}
