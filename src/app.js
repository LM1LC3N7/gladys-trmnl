// -----------------------------------------------------------------------------
// TrmnlApp: the integration. One TRMNL account (its user API key), its
// displays, read through the official account API.
//
//   readings   `GET /api/devices` every refresh interval (15 min by default):
//              never faster, whatever asks (a reconnection to Gladys, a
//              configuration saved unchanged, the Discovery button, the test
//              button, a restart of the container: the time of the last
//              attempt is written to /data BEFORE each request);
//   devices    one per display, keyed by its TRMNL id: battery, battery
//              voltage, Wi-Fi strength and signal, sleep mode, sleep hours;
//   commands   two push buttons per display (sleep mode on / off), only when
//              allowed in the configuration: the state read again first, the
//              option checked again right before the write, confirmed only by
//              a value read back equal to the one asked, never sent after
//              3.5 s (Gladys waits 5 s for the ack).
//
// The loop is ONE timer (plan() replaces it); `generation` changes with the
// client (a new key) and `epoch` with every halt: a late answer of an older
// one publishes nothing and sets no status. A key TRMNL refused is final:
// kept in /data (HMAC), nothing tried again alone. 429 and 5xx pause every
// path (kept in /data, bounded).
// -----------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { Budget } from './budget.js';
import { normalizeConfig } from './config.js';
import { FEATURES, TIMINGS } from './constants.js';
import { E, T } from './i18n.js';
import { BUTTONS, buildDevice, deviceIds, parseExternalId, statesOf } from './model.js';
import { FileStore, emptyData, newSalt } from './store.js';
import { TrmnlClient } from './trmnl/client.js';
import { KINDS, isBusy, isKeyRefused, isServerError, notSent } from './trmnl/errors.js';
import { httpRequest } from './trmnl/http.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const short = (value) => String(value).slice(0, 60);
const NO_ANSWER_KINDS = new Set([KINDS.UNREACHABLE, KINDS.NO_ANSWER]);

export class TrmnlApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'trmnl' }),
    store = new FileStore(),
    request = httpRequest,
    now = Date.now,
    timers = globalThis,
    timings = TIMINGS,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.request = request;
    this.now = now;
    this.timers = timers;
    this.timings = timings;
    this.config = normalizeConfig();
    this.data = undefined;
    this.started = false;
    /** A restart of the client happened in this process (the first one waits the interval). */
    this.ranBefore = false;
    this.generation = 0;
    this.epoch = 0;
    this.activeKey = undefined;
    this.client = undefined;
    this.phase = 'idle';
    this.lastError = undefined;
    this.nextAt = undefined;
    this.retryDelay = 0;
    /** "ready" restored from /data after a restart, before the first reading. */
    this.restored = false;
    this.loopHandle = undefined;
    this.flushHandle = undefined;
    /** The reading in flight: { generation, startedAt } or undefined. */
    this.inFlight = undefined;
    /** id -> the display of the last reading (or of a confirmed command). */
    this.displays = new Map();
    this.total = 0;
    this.lastReadAt = undefined;
    /** id -> when a command last changed the sleep mode (a reading older than it keeps it). */
    this.commandAt = new Map();
    /** One chain of commands per display. */
    this.chains = new Map();
    this.queue = Promise.resolve();
    this.lastStatus = undefined;
    this.lastDevices = undefined;
    this.pending = false;
    /** feature external id -> { value, at } last accepted by Gladys (emptied on `connected`). */
    this.published = new Map();
    this.states = new Budget({ perMinute: this.timings.statesPerMinute, now });
    this.commands = new Budget({ perMinute: this.timings.commandsPerMinute, now });
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Runs `task` after every start already queued. */
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * A new configuration arrives: until its start runs, the buttons are
   * allowed only if BOTH the old and the new configuration allow them.
   */
  tighten(raw) {
    const next = normalizeConfig(raw);
    if (this.config.allowSleepMode && !next.allowSleepMode) {
      this.config = { ...this.config, allowSleepMode: false };
    }
  }

  /**
   * (Re)start with a configuration: on every connection to Gladys and on
   * every configuration save. The same key keeps the client, its loop, its
   * pause and its refusal: only the status, the Discovery and the states
   * (that Gladys keeps in memory) are published again; no reading is added.
   */
  start(raw = {}, { connected = false } = {}) {
    this.tighten(raw);
    return this.enqueue(() => this.run(raw, { connected }));
  }

  async run(raw, { connected }) {
    await this.loadData();
    const previous = this.config;
    this.config = normalizeConfig(raw);
    this.started = true;
    if (connected) {
      this.lastStatus = undefined;
      this.lastDevices = undefined;
      this.published.clear();
    }
    const same = this.config.ready && this.config.apiKey === this.activeKey;
    if (!same) {
      await this.restart();
    } else if (
      previous.intervalMs !== this.config.intervalMs &&
      !this.inFlight &&
      this.loopHandle
    ) {
      // A new interval: the next reading follows it from the last attempt.
      this.plan(this.earliest(this.config.intervalMs));
    }
    await this.step('publish the devices', () => this.publishDevices({ force: true }));
    await this.step('publish the states', () => this.publishAllStates());
    await this.step('publish the status', () => this.updateStatus());
  }

  async step(name, task) {
    try {
      await task();
    } catch (err) {
      this.logger.warn(`Start: could not ${name}: ${err.message}`);
    }
  }

  async loadData() {
    if (this.data) {
      return;
    }
    try {
      this.data = await this.store.load(this.now());
    } catch {
      this.data = emptyData();
    }
    if (this.store.corrupted) {
      this.logger.warn('Unreadable /data/trmnl.json moved to trmnl.json.bad');
    }
    if (!this.data.salt) {
      this.data.salt = newSalt();
      await this.saveNow();
    }
  }

  async stop() {
    this.started = false;
    this.generation += 1;
    this.halt();
    this.client = undefined;
    await this.store.flush?.().catch(() => {});
  }

  /** Clears the timers; a run still in flight will not plan again. */
  halt() {
    this.epoch += 1;
    if (this.loopHandle !== undefined) {
      this.timers.clearTimeout(this.loopHandle);
      this.loopHandle = undefined;
    }
    if (this.flushHandle !== undefined) {
      this.timers.clearTimeout(this.flushHandle);
      this.flushHandle = undefined;
      this.pending = false;
    }
  }

  saveNow() {
    return this.store
      .save(this.data)
      .catch((err) => this.logger.warn(`Could not save /data: ${err.message}`));
  }

  /** HMAC of the key with the salt of /data: what a refusal is about, never the key. */
  refusalOf(apiKey) {
    return createHmac('sha256', this.data.salt).update(apiKey).digest('hex');
  }

  /** A new client from the configured key. */
  async restart() {
    this.generation += 1;
    this.halt();
    this.client = undefined;
    this.inFlight = undefined;
    this.displays.clear();
    this.commandAt.clear();
    this.total = 0;
    this.lastReadAt = undefined;
    this.lastError = undefined;
    this.retryDelay = 0;
    this.nextAt = undefined;
    this.restored = false;
    const first = !this.ranBefore;
    this.ranBefore = true;
    if (!first) {
      // Another key may be another account: its displays come with its first reading.
      this.data.devices = Object.create(null);
      this.lastDevices = undefined;
    }
    this.activeKey = this.config.ready ? this.config.apiKey : undefined;
    if (!this.config.apiKey) {
      this.phase = 'missing';
      return;
    }
    if (this.config.apiKeyInvalid) {
      this.phase = 'invalid';
      return;
    }
    this.client = new TrmnlClient({
      apiKey: this.config.apiKey,
      request: this.request,
      now: this.now,
    });
    if (this.data.refusal && this.data.refusal === this.refusalOf(this.config.apiKey)) {
      this.phase = 'refused';
      this.logger.warn('API key refused earlier by TRMNL: not tried again on its own');
      return;
    }
    this.phase = 'waiting';
    // A restart right after a successful reading (the last attempt succeeded,
    // no refusal, no pause): connected at once, from what /data kept.
    const okAt = this.data.okAt;
    if (
      first &&
      Number.isFinite(okAt) &&
      okAt >= (this.data.attemptAt ?? -Infinity) &&
      !this.data.refusal &&
      !this.pausedUntil()
    ) {
      this.phase = 'ready';
      this.restored = true;
      this.lastReadAt = okAt;
    }
    // The first start of the process (a container restart) waits the whole
    // interval since the last attempt; a key changed later waits the spacing.
    this.plan(this.earliest(first ? this.config.intervalMs : this.timings.attemptSpacing));
  }

  /** The earliest next reading: `spacing` after the last attempt, after a pause. */
  earliest(spacing) {
    return Math.max(this.now(), (this.data.attemptAt ?? -Infinity) + spacing, this.pausedUntil());
  }

  /** The ONE timer of the reading chain: any earlier one is replaced. */
  plan(at) {
    if (this.loopHandle !== undefined) {
      this.timers.clearTimeout(this.loopHandle);
    }
    const generation = this.generation;
    this.nextAt = at;
    const handle = this.timers.setTimeout(
      () => {
        if (this.loopHandle === handle) {
          this.loopHandle = undefined;
        }
        this.tick(generation).catch((err) => this.logger.warn(`Reading failed: ${err.message}`));
      },
      Math.max(0, at - this.now()),
    );
    this.loopHandle = handle;
  }

  // --- Pauses ------------------------------------------------------------------

  pausedUntil() {
    const until = this.data?.pause?.until ?? 0;
    return until > this.now() ? until : 0;
  }

  /**
   * A 429 or 5xx: no reading and no command until its end (Retry-After, else
   * 15 min / 5 min, bounded 1 min to 6 h), set at once and kept in /data.
   */
  pause(err) {
    const fallback = isBusy(err) ? this.timings.pause429 : this.timings.pause5xx;
    const wanted = Number.isFinite(err?.retryAfterMs) ? err.retryAfterMs : fallback;
    const until = this.now() + clamp(wanted, this.timings.pauseMin, this.timings.pauseMax);
    if (until > this.pausedUntil()) {
      this.data.pause = { until, reason: isBusy(err) ? 'busy' : `server:${err.status}` };
      this.logger.warn(
        `TRMNL answered ${err?.status}: paused until ${new Date(until).toISOString()}`,
      );
      // A pause set by a command shows in the status too; the next reading
      // comes after it and sets "ready" again on success.
      if ((this.phase === 'ready' || this.phase === 'waiting') && this.client && !this.inFlight) {
        this.phase = 'paused';
        this.plan(this.earliest(this.config.intervalMs));
      }
      return this.saveNow();
    }
    return Promise.resolve();
  }

  // --- Readings --------------------------------------------------------------------

  /** The client and the loop are still those of this run. */
  current(generation, epoch) {
    return generation === this.generation && epoch === this.epoch;
  }

  /**
   * One reading, then the next one planned. `manual`: the test button, the
   * only path that tries a refused key (and only once the interval passed).
   */
  async tick(generation, { manual = false } = {}) {
    if (generation !== this.generation || !this.client || this.inFlight) {
      return;
    }
    if (this.phase === 'refused' && !manual) {
      return;
    }
    const paused = this.pausedUntil();
    if (paused) {
      this.phase = this.phase === 'refused' ? 'refused' : 'paused';
      this.plan(Math.max(paused, this.earliest(this.config.intervalMs)));
      await this.updateStatus(generation);
      return;
    }
    const epoch = this.epoch;
    const client = this.client;
    const startedAt = this.now();
    this.inFlight = { generation, startedAt };
    // Written BEFORE the request: a crash during it still counts as an attempt.
    this.data.attemptAt = startedAt;
    await this.saveNow();
    // The key may have changed during the write: never a request with the old one.
    if (!this.current(generation, epoch) || client !== this.client) {
      if (this.inFlight?.generation === generation) {
        this.inFlight = undefined;
      }
      return;
    }
    let result;
    try {
      result = await client.devices();
    } catch (err) {
      if (this.inFlight?.generation === generation) {
        this.inFlight = undefined;
      }
      // A pause holds whatever the generation: a new key does not make TRMNL less busy.
      if (isBusy(err) || isServerError(err)) {
        await this.pause(err);
      }
      if (this.current(generation, epoch) && client === this.client) {
        await this.failed(err, generation);
      }
      return;
    }
    if (this.inFlight?.generation === generation) {
      this.inFlight = undefined;
    }
    if (!this.current(generation, epoch) || client !== this.client) {
      return;
    }
    await this.apply(result, startedAt);
    if (!this.current(generation, epoch)) {
      return;
    }
    this.plan(this.earliest(this.config.intervalMs));
    await this.step('publish the devices', () => this.publishDevices());
    if (!this.current(generation, epoch)) {
      return;
    }
    await this.step('publish the states', () => this.publishAllStates());
    await this.updateStatus(generation);
  }

  /** A successful reading: displays kept, the refusal erased, /data updated. */
  async apply({ devices, total }, startedAt) {
    const next = new Map();
    for (const display of devices) {
      const before = this.displays.get(display.id);
      // A command answered while this reading was in flight: its sleep mode
      // stays until the next reading, never overwritten by an older answer.
      if (before && (this.commandAt.get(display.id) ?? -Infinity) >= startedAt) {
        next.set(display.id, { ...display, sleepModeEnabled: before.sleepModeEnabled });
      } else {
        next.set(display.id, display);
      }
    }
    this.displays = next;
    this.total = total;
    this.lastReadAt = this.now();
    this.retryDelay = 0;
    this.lastError = undefined;
    if (this.phase !== 'ready' || this.restored) {
      this.logger.info(`TRMNL answers: ${devices.length} display(s)`);
    }
    this.phase = 'ready';
    this.restored = false;
    // The attempt that succeeded: a restart soon after starts "connected".
    this.data.okAt = startedAt;
    let changed = true;
    if (this.data.refusal) {
      this.data.refusal = null;
      changed = true;
    }
    const saved = Object.create(null);
    for (const d of devices) {
      saved[String(d.id)] = {
        id: d.id,
        name: d.name ?? null,
        friendlyId: d.friendlyId ?? null,
        mac: d.mac ?? null,
      };
    }
    if (JSON.stringify(saved) !== JSON.stringify(this.data.devices)) {
      this.data.devices = saved;
      changed = true;
    }
    if (changed) {
      await this.saveNow();
    }
  }

  /**
   * A reading failed: a refused key is final (no new try alone); anything
   * else is tried again after the interval at least, doubling up to 1 h.
   */
  async failed(err, generation) {
    this.restored = false;
    if (isKeyRefused(err)) {
      this.phase = 'refused';
      this.halt();
      this.data.refusal = this.refusalOf(this.config.apiKey);
      await this.saveNow();
      this.logger.warn('TRMNL refused the API key: not tried again until changed or tested');
      await this.updateStatus(generation);
      return;
    }
    const interval = this.config.intervalMs;
    this.retryDelay = this.retryDelay
      ? Math.min(this.retryDelay * 2, Math.max(interval, this.timings.retryMax))
      : interval;
    const message = short(err?.message ?? String(err));
    if (this.pausedUntil()) {
      this.phase = 'paused';
    } else if (NO_ANSWER_KINDS.has(err?.kind)) {
      if (this.phase !== 'offline') {
        this.logger.info(`TRMNL cannot be reached: ${message}`);
      }
      this.phase = 'offline';
    } else {
      if (this.phase !== 'failing' || this.lastError !== message) {
        this.logger.warn(`Unexpected answer of TRMNL: ${message}`);
      }
      this.phase = 'failing';
    }
    this.lastError = message;
    this.plan(Math.max(this.now() + this.retryDelay, this.earliest(interval)));
    await this.updateStatus(generation);
  }

  // --- Gladys devices -----------------------------------------------------------------

  /** The device Gladys has (kept up to date by the SDK). */
  createdDevice(externalId) {
    return (Array.isArray(this.gladys.devices) ? this.gladys.devices : []).find(
      (d) => d?.external_id === externalId,
    );
  }

  /** The displays known: those of the last reading, else those kept in /data. */
  knownDisplays() {
    if (this.displays.size > 0) {
      return [...this.displays.values()];
    }
    return Object.values(this.data?.devices ?? {}).map((d) => ({
      id: d.id,
      name: d.name ?? undefined,
      friendlyId: d.friendlyId ?? undefined,
      mac: d.mac ?? undefined,
    }));
  }

  /** The Discovery tab; only when it changed, unless `force` (start, scan, connected). */
  async publishDevices({ force = false } = {}) {
    if (!this.data || !this.config.ready) {
      return;
    }
    const devices = this.knownDisplays()
      .sort((a, b) => a.id - b.id)
      .map((display) =>
        buildDevice(this.gladys, display, {
          language: this.config.language,
          buttons: this.config.allowSleepMode,
          created: this.createdDevice(deviceIds(this.gladys, display.id).device),
        }),
      );
    const key = JSON.stringify(devices);
    if (!force && key === this.lastDevices) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(devices);
    this.lastDevices = key;
  }

  /** Discovery button: what the last reading knows (no extra request). */
  scan() {
    return this.publishDevices({ force: true });
  }

  async deviceCreated(device) {
    if (parseExternalId(this.gladys, device?.external_id)) {
      // Gladys dropped the states of features that did not exist yet: sent again.
      for (const key of [...this.published.keys()]) {
        if (key.startsWith(`${device.external_id}:`)) {
          this.published.delete(key);
        }
      }
      await this.publishAllStates();
    }
  }

  // --- States (within a budget) ----------------------------------------------------------

  /** The states of the created displays, from the last reading. */
  allStates() {
    const list = [];
    for (const display of this.displays.values()) {
      const ids = deviceIds(this.gladys, display.id);
      if (!this.createdDevice(ids.device)) {
        continue;
      }
      for (const { key, value } of statesOf(display)) {
        list.push(
          typeof value === 'object'
            ? { device_feature_external_id: ids.feature(key), text: value.text }
            : { device_feature_external_id: ids.feature(key), state: value },
        );
      }
    }
    return list;
  }

  /**
   * Publishes the states that changed (and every value again after the
   * heartbeat), within the budget of the minute; what does not fit is sent
   * the next minute, recomputed from the displays then.
   */
  async publishAllStates() {
    if (this.pending) {
      return;
    }
    const now = this.now();
    const valueOf = (s) => (s.text === undefined ? `n:${s.state}` : `t:${s.text}`);
    const list = this.allStates().filter((s) => {
      const last = this.published.get(s.device_feature_external_id);
      return !last || last.value !== valueOf(s) || now - last.at >= this.timings.heartbeat;
    });
    if (list.length === 0) {
      return;
    }
    const batch = list.slice(0, Math.min(this.states.remaining(), 100));
    if (batch.length > 0) {
      // Counted and remembered before the request: two publications at once
      // never exceed the budget nor send the same value twice.
      this.states.record(batch.length);
      for (const s of batch) {
        this.published.set(s.device_feature_external_id, { value: valueOf(s), at: now });
      }
      try {
        await this.gladys.publishStates(batch);
      } catch (err) {
        for (const s of batch) {
          this.published.delete(s.device_feature_external_id);
        }
        this.logger.warn(`Could not publish ${batch.length} state(s): ${err.message}`);
      }
    }
    if (batch.length < list.length) {
      this.pending = true;
      const generation = this.generation;
      this.flushHandle = this.timers.setTimeout(
        () => {
          this.flushHandle = undefined;
          this.pending = false;
          if (generation === this.generation) {
            this.publishAllStates().catch(() => {});
          }
        },
        Math.max(1_000, this.states.waitMs()),
      );
    }
  }

  // --- Commands: the sleep mode buttons ----------------------------------------------

  async setValue(_device, feature, value) {
    const received = this.now();
    const parsed = parseExternalId(this.gladys, feature?.external_id);
    if (!parsed?.feature) {
      throw new Error(E.unknownDevice);
    }
    if (!(parsed.feature in BUTTONS)) {
      throw new Error(
        Object.values(FEATURES).includes(parsed.feature) ? E.readOnly : E.unknownDevice,
      );
    }
    // A push button sends 1: anything else (null, '', 0, '1') is refused.
    if (value !== 1) {
      throw new Error(E.invalidValue);
    }
    if (!this.config.allowSleepMode) {
      throw new Error(E.disabled);
    }
    if (this.pausedUntil()) {
      throw new Error(E.paused);
    }
    if (!this.client) {
      throw new Error(E.notConnected);
    }
    if (this.phase === 'refused') {
      throw new Error(E.keyRefused);
    }
    const known = this.knownDisplays().find((d) => d.id === parsed.id);
    if (!known) {
      throw new Error(E.unknownDevice);
    }
    if (this.commands.remaining() <= 0) {
      throw new Error(E.tooMany);
    }
    this.commands.record(1);
    const job = {
      id: parsed.id,
      wanted: BUTTONS[parsed.feature],
      known,
      client: this.client,
      generation: this.generation,
      deadline: received + this.timings.commandBudget,
    };
    const previous = this.chains.get(job.id) ?? Promise.resolve();
    const run = previous.then(() => this.command(job));
    const chain = run.catch(() => {});
    this.chains.set(job.id, chain);
    chain.then(() => {
      if (this.chains.get(job.id) === chain) {
        this.chains.delete(job.id);
      }
    });
    return run;
  }

  /** Right before any request of a command: same client, still allowed, not paused, in time. */
  beforeSend(job, needed = 1) {
    if (job.client !== this.client || job.generation !== this.generation) {
      throw new Error(E.configChanged);
    }
    if (!this.config.allowSleepMode) {
      throw new Error(E.disabled);
    }
    if (this.phase === 'refused') {
      throw new Error(E.keyRefused);
    }
    if (this.pausedUntil()) {
      throw new Error(E.paused);
    }
    if (job.deadline - this.now() < needed) {
      throw new Error(E.tooSlow);
    }
  }

  /** A failed read of a command (nothing written yet): the error to answer. */
  readError(err) {
    if (isBusy(err) || isServerError(err)) {
      this.pause(err).catch(() => {});
      this.background(() => this.updateStatus());
      return new Error(E.paused);
    }
    if (isKeyRefused(err)) {
      // Not a refusal of the readings: they go on (the next one decides).
      return new Error(E.refusedKey);
    }
    if (err?.kind === KINDS.NOT_FOUND) {
      return new Error(E.notFound);
    }
    if (err?.kind === KINDS.HTTP) {
      return new Error(E.refused(short(err.message)));
    }
    return new Error(E.notSent(short(err?.message ?? err)));
  }

  async command(job) {
    const left = () => job.deadline - this.now();
    this.beforeSend(job, this.timings.commandWriteMin);
    // 1. The state as TRMNL has it now, and the identity of the display.
    let fresh;
    try {
      fresh = await job.client.device(job.id, { timeoutMs: Math.max(1, left()) });
    } catch (err) {
      throw this.readError(err);
    }
    if (!this.sameDisplay(job.known, fresh, job.id)) {
      throw new Error(E.otherDevice);
    }
    if (fresh.sleepModeEnabled === undefined) {
      throw new Error(E.unreadable);
    }
    if (fresh.sleepModeEnabled === job.wanted) {
      this.observed(job, fresh);
      return;
    }
    // 2. The write: the option, the client, the pause and the deadline checked again.
    this.beforeSend(job, this.timings.commandWriteMin);
    let sent = false;
    try {
      await job.client.setSleepMode(job.id, job.wanted, {
        timeoutMs: Math.max(1, left()),
        onSent: () => {
          sent = true;
        },
      });
    } catch (err) {
      if (!sent || notSent(err)) {
        throw new Error(E.notSent(short(err?.message ?? err)), { cause: err });
      }
      if (isBusy(err)) {
        this.pause(err).catch(() => {});
        this.background(() => this.updateStatus());
        throw new Error(E.busy, { cause: err });
      }
      if (isKeyRefused(err)) {
        throw new Error(E.refusedKey, { cause: err });
      }
      if (err?.kind === KINDS.NOT_FOUND || err?.kind === KINDS.HTTP) {
        throw new Error(E.refused(short(err.message)), { cause: err });
      }
      if (isServerError(err)) {
        this.pause(err).catch(() => {});
        this.background(() => this.updateStatus());
      }
      throw new Error(E.unconfirmed(short(err?.message ?? err)), { cause: err });
    }
    // 3. Confirmed only by a value read back equal to the one asked.
    if (left() < 200) {
      throw new Error(E.unconfirmed('no time left to read it back'));
    }
    let after;
    try {
      after = await job.client.device(job.id, { timeoutMs: Math.max(1, left()) });
    } catch (err) {
      if (isBusy(err) || isServerError(err)) {
        this.pause(err).catch(() => {});
        this.background(() => this.updateStatus());
      }
      throw new Error(E.unconfirmed(short(err?.message ?? err)), { cause: err });
    }
    if (!this.sameDisplay(job.known, after, job.id)) {
      throw new Error(E.unconfirmed('TRMNL answered for another display'));
    }
    if (after.sleepModeEnabled !== job.wanted) {
      throw new Error(E.unconfirmed('TRMNL still shows the previous sleep mode'));
    }
    this.logger.info(`Sleep mode of display ${job.id} turned ${job.wanted ? 'on' : 'off'}`);
    this.observed(job, after);
  }

  /**
   * The same display: same id, and no MAC address nor friendly id that
   * differs from the known one (an unreadable value is not "another display").
   */
  sameDisplay(known, fresh, id) {
    const differs = (a, b) => a !== undefined && a !== null && b !== undefined && b !== a;
    return (
      fresh.id === id &&
      !differs(known.mac, fresh.mac) &&
      !differs(known.friendlyId, fresh.friendlyId)
    );
  }

  /** What a command saw: kept and published without holding the ack. */
  observed(job, fresh) {
    if (job.generation !== this.generation) {
      return;
    }
    // Before the first reading after a restart the table is empty: filled
    // first from /data, so the other displays stay known.
    if (this.displays.size === 0) {
      for (const d of this.knownDisplays()) {
        this.displays.set(d.id, d);
      }
    }
    const before = this.displays.get(job.id) ?? job.known;
    // Only the values TRMNL gave: a field missing from this answer never
    // erases a known one (the identity above all).
    const defined = Object.fromEntries(Object.entries(fresh).filter(([, v]) => v !== undefined));
    this.displays.set(job.id, { ...before, ...defined });
    this.commandAt.set(job.id, this.now());
    this.background(() => this.publishAllStates());
  }

  /** A task that never holds the caller (its failure is logged). */
  background(task) {
    Promise.resolve()
      .then(task)
      .catch((err) => this.logger.warn(`Background task failed: ${err.message}`));
  }

  // --- Configuration button ------------------------------------------------------------

  /** Resolves `promise`, or rejects with `message` after `ms`. */
  within(promise, ms, message) {
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  /**
   * "Test the connection": a reading now, a refused key included, but never
   * sooner than one interval after the last attempt nor during a pause (then
   * the current status, nothing sent). A refusal is erased only by a success.
   */
  async testConnection() {
    await this.queue;
    await this.loadData();
    if (!this.config.apiKey) {
      throw new Error(T.missing.en);
    }
    if (this.config.apiKeyInvalid) {
      throw new Error(T.invalidKey.en);
    }
    const paused = this.pausedUntil();
    if (paused) {
      throw new Error(T.paused(paused, this.data.pause.reason).en);
    }
    const at = this.earliest(this.config.intervalMs);
    if (at > this.now() || this.inFlight) {
      if (this.phase === 'ready') {
        return T.tooSoon(at);
      }
      throw new Error(`${T.tooSoon(at).en} ${this.statusMessage().message.en}`);
    }
    if (!this.client) {
      await this.restart();
    }
    await this.within(
      this.tick(this.generation, { manual: true }),
      this.timings.testBudget,
      E.testTooLong,
    );
    if (this.phase !== 'ready') {
      throw new Error(this.statusMessage().message.en);
    }
    return T.testOk(this.displays.size);
  }

  // --- Status ---------------------------------------------------------------------

  statusMessage() {
    const notes = [];
    if (this.store.corrupted) {
      notes.push(T.dataReset);
    }
    const join = (main) => {
      const all = [main, ...notes].filter(Boolean);
      return { en: all.map((n) => n.en).join(' '), fr: all.map((n) => n.fr).join(' ') };
    };
    const next = this.nextAt ?? this.now();
    switch (this.phase) {
      case 'missing':
        return { connected: false, message: join(T.missing) };
      case 'invalid':
        return { connected: false, message: join(T.invalidKey) };
      case 'refused':
        return { connected: false, message: join(T.refused) };
      case 'paused':
        return {
          connected: false,
          message: join(
            T.paused(this.pausedUntil() || this.now(), this.data?.pause?.reason ?? 'busy'),
          ),
        };
      case 'offline':
        return { connected: false, message: join(T.offline(this.lastError, next)) };
      case 'failing':
        return { connected: false, message: join(T.failing(this.lastError, next)) };
      case 'ready':
        if (this.restored) {
          return {
            connected: true,
            message: join(T.restored(this.knownDisplays().length, this.lastReadAt, next)),
          };
        }
        return {
          connected: true,
          message: join(T.connected(this.displays.size, this.total, this.lastReadAt)),
        };
      default:
        return { connected: false, message: join(T.waiting(next)) };
    }
  }

  /** Publishes the status when it changed; `generation`: only for this client. */
  async updateStatus(generation = this.generation) {
    if (!this.started || generation !== this.generation) {
      return;
    }
    const status = this.statusMessage();
    const key = JSON.stringify(status);
    if (key === this.lastStatus) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.lastStatus = key;
    } catch (err) {
      this.logger.warn(`Could not publish the status: ${err.message}`);
    }
  }
}
