// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys, a fake TRMNL API and a clock
// moved by hand, through the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TrmnlApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { buildDevice } from '../src/model.js';
import { MemoryStore } from '../src/store.js';
import { parseDeviceRecord } from '../src/trmnl/parse.js';
import { fakeClock } from './helpers/fakeClock.js';
import {
  API_KEY,
  OTHER_KEY,
  answer,
  createFakeTrmnl,
  display,
  noAnswer,
} from './helpers/fakeTrmnl.js';

const SELECTOR = 'trmnl';
const ids = createFakeGladys({ selector: SELECTOR });
const INTERVAL = 900_000;
const D1 = parseDeviceRecord(display());
const CREATED = buildDevice(ids, D1, { buttons: true });
const fid = (key, id = 42793) => `ext:${SELECTOR}:device:${id}:${key}`;
const feature = (device, key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

let running = [];
afterEach(async () => {
  for (const app of running) {
    await app.stop();
  }
  running = [];
});

async function setup({
  config = {},
  devices = [CREATED],
  api = createFakeTrmnl(),
  store = new MemoryStore(),
  clock = fakeClock(),
  timings = TIMINGS,
  start = true,
} = {}) {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { api_key: API_KEY, ...config },
    devices,
  });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  const app = new TrmnlApp({
    gladys,
    logger,
    store,
    request: api.request,
    now: clock.now,
    timers: clock.timers,
    timings,
  });
  running.push(app);
  registerHandlers(gladys, app, logger);
  if (start) {
    await gladys.connect();
    await clock.advance(0);
  }
  return { gladys, api, store, clock, logs, app };
}

const state = (gladys, key, id) => gladys.fake.lastState(fid(key, id));

test('first reading: Discovery, states, status; Bearer key to trmnl.com only, our own name', async () => {
  const { gladys, api, store, logs } = await setup({ devices: [buildDevice(ids, D1)] });
  assert.equal(api.requests.length, 1);
  const [req] = api.requests;
  assert.equal(req.url, 'https://trmnl.com/api/devices');
  assert.equal(req.method, 'GET');
  assert.equal(req.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(req.headers['User-Agent'], 'gladys-trmnl');
  assert.ok(req.maxBytes <= 256 * 1024);

  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, `ext:${SELECTOR}:device:42793`);
  assert.equal(device.name, "Joost's TRMNL");
  assert.deepEqual(device.params, [{ name: 'FRIENDLY_ID', value: '1RJXS4' }]);
  assert.ok(!device.features.some((f) => f.category === 'switch'), 'never a switch');
  assert.ok(!device.features.some((f) => f.category === 'button'), 'no button by default');
  assert.equal(feature(device, 'battery').unit, 'percent');

  assert.equal(state(gladys, 'battery'), 73);
  assert.equal(state(gladys, 'battery_voltage'), 3.87);
  assert.equal(state(gladys, 'wifi_strength'), 50);
  assert.equal(state(gladys, 'rssi'), -64);
  assert.equal(state(gladys, 'sleep_mode'), 0);
  assert.equal(state(gladys, 'sleep_window'), '22:00-08:00');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /^Connected: 1 display, read at 12:00 UTC/);

  // The key is nowhere but in the Authorization header.
  const everything = JSON.stringify([
    store.data,
    logs,
    gladys.fake.connectionStatuses,
    gladys.fake.discoveredDevices,
  ]);
  assert.ok(!everything.includes(API_KEY));
  assert.equal(store.data.refusal, null);
  assert.equal(store.data.attemptAt, Date.UTC(2026, 9, 18, 12, 0, 0));
  assert.deepEqual(Object.keys(store.data.devices), ['42793']);
});

test('never read faster than the interval: Gladys back, unchanged save, Discovery, test button', async () => {
  const { gladys, api, app, clock } = await setup();
  assert.equal(api.reads().length, 1);
  await clock.advance(60_000);
  // Gladys reconnects: status and Discovery again, no reading.
  const statuses = gladys.fake.connectionStatuses.length;
  await app.start(await gladys.getConfig(), { connected: true });
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  await gladys.fake.configUpdated({ ...gladys.fake.config });
  await gladys.fake.scanRequest();
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /less than one refresh interval ago: no new reading before 12:15 UTC/,
  );
  await clock.advance(INTERVAL - 60_000 - 1);
  assert.equal(api.reads().length, 1);
  await clock.advance(1);
  assert.equal(api.reads().length, 2);
  // The test button once the interval passed reads at once.
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 3);
  await clock.advance(INTERVAL - 1);
  await clock.advance(1);
  assert.equal(api.reads().length, 4);
});

test('a restart waits the interval from the last attempt kept in /data; Discovery from /data', async () => {
  const store = new MemoryStore();
  const clock = fakeClock();
  const first = await setup({ store, clock });
  assert.equal(first.api.reads().length, 1);
  await first.app.stop();
  await clock.advance(120_000);
  const second = await setup({ store, clock });
  assert.equal(second.api.reads().length, 0, 'no reading at start');
  assert.equal(second.gladys.fake.discoveredDevices.length, 1, 'Discovery from /data');
  assert.equal(second.gladys.fake.connectionStatus.connected, false);
  assert.match(second.gladys.fake.connectionStatus.message.en, /first reading is at 12:15 UTC/);
  await clock.advance(INTERVAL - 120_000 - 1);
  assert.equal(second.api.reads().length, 0);
  await clock.advance(1);
  assert.equal(second.api.reads().length, 1);
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
});

test('a refused key: kept as an HMAC, never tried alone, test button after the interval, erased by a success', async () => {
  const store = new MemoryStore();
  const clock = fakeClock();
  const api = createFakeTrmnl({ key: OTHER_KEY });
  const first = await setup({ store, clock, api });
  assert.equal(api.reads().length, 1);
  assert.match(store.data.refusal, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(store.data).includes(API_KEY));
  assert.equal(first.gladys.fake.connectionStatus.connected, false);
  assert.match(first.gladys.fake.connectionStatus.message.en, /refused the API key/);
  await clock.advance(5 * INTERVAL);
  assert.equal(api.reads().length, 1, 'never tried again alone');

  // A restart with the same key: not tried.
  await first.app.stop();
  const second = await setup({ store, clock, api });
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 1);
  assert.match(second.gladys.fake.connectionStatus.message.en, /refused the API key/);

  // The test button tries it (the interval passed), refused again: still kept.
  let ack = await second.gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, false);
  assert.match(ack.error, /refused the API key/);
  assert.equal(api.reads().length, 2);
  // Too soon for another try: nothing sent.
  ack = await second.gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, false);
  assert.match(ack.error, /less than one refresh interval ago/);
  assert.equal(api.reads().length, 2);

  // TRMNL accepts the key again: the test button erases the refusal.
  api.key = API_KEY;
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 2, 'still not tried alone');
  ack = await second.gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /TRMNL answers: 1 display/);
  assert.equal(store.data.refusal, null);
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 4, 'the loop runs again');
});

test('a new key is tried after the spacing, not the interval; its old displays are dropped', async () => {
  const { gladys, api, clock } = await setup();
  await clock.advance(10_000);
  api.key = OTHER_KEY;
  await gladys.fake.configUpdated({ ...gladys.fake.config, api_key: OTHER_KEY });
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  await clock.advance(TIMINGS.attemptSpacing - 10_000 - 1);
  assert.equal(api.reads().length, 1);
  await clock.advance(1);
  assert.equal(api.reads().length, 2);
  assert.equal(api.reads()[1].headers.Authorization, `Bearer ${OTHER_KEY}`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('429: every path paused (Retry-After, bounded), kept in /data across a restart', async () => {
  const store = new MemoryStore();
  const clock = fakeClock();
  const api = createFakeTrmnl();
  api.next.push(() => answer(429, { error: 'slow down' }, { 'Retry-After': '999999' }));
  const first = await setup({ store, clock, api, config: { allow_sleep_mode: true } });
  const until = Date.UTC(2026, 9, 18, 12, 0, 0) + TIMINGS.pauseMax;
  assert.deepEqual(store.data.pause, { until, reason: 'busy' });
  assert.match(
    first.gladys.fake.connectionStatus.message.en,
    /slow down \(429\): paused until 18:00 UTC/,
  );
  // A command during the pause: refused, nothing sent.
  const ack = await first.gladys.fake.setValue(CREATED, feature(CREATED, 'sleep_mode_on'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /slow down/);
  await clock.advance(3_600_000);
  assert.equal(api.requests.length, 1);
  await first.app.stop();
  const second = await setup({ store, clock, api });
  await clock.advance(TIMINGS.pauseMax - 3_600_000 - 1);
  assert.equal(api.requests.length, 1);
  await clock.advance(1);
  assert.equal(api.requests.length, 2);
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
});

test('5xx: a pause, then a reading not sooner than the interval; errors never read faster', async () => {
  const api = createFakeTrmnl();
  api.next.push(() => answer(503, 'down'));
  const { clock, gladys } = await setup({ api });
  assert.match(gladys.fake.connectionStatus.message.en, /in trouble \(503\)/);
  await clock.advance(INTERVAL - 1);
  assert.equal(api.reads().length, 1);
  await clock.advance(1);
  assert.equal(api.reads().length, 2);
  // A network failure: tried again after the interval, then doubling.
  api.next.push(noAnswer);
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 3);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot be reached/);
  api.next.push(noAnswer);
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 4);
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 4, 'the second failure waits twice the interval');
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 5);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a late answer of an old key publishes nothing and sets no status', async () => {
  const api = createFakeTrmnl();
  let release;
  api.next.push(
    (req, route) =>
      new Promise((resolve) => {
        release = () => resolve(route(req));
      }),
  );
  const { gladys, clock } = await setup({ api });
  assert.equal(api.reads().length, 1);
  api.key = OTHER_KEY;
  api.devices = [display(7)];
  await gladys.fake.configUpdated({ ...gladys.fake.config, api_key: OTHER_KEY });
  const statuses = gladys.fake.connectionStatuses.length;
  const states = gladys.fake.states.length;
  release();
  await clock.settle();
  assert.equal(gladys.fake.connectionStatuses.length, statuses);
  assert.equal(gladys.fake.states.length, states);
  assert.ok(!gladys.fake.discoveredDevices.some((d) => d.external_id.endsWith(':42793')));
});

test('Gladys back during a reading: no second reading', async () => {
  const api = createFakeTrmnl();
  let release;
  api.next.push(
    (req, route) =>
      new Promise((resolve) => {
        release = () => resolve(route(req));
      }),
  );
  const { gladys, app, clock } = await setup({ api });
  await app.start(await gladys.getConfig(), { connected: true });
  await gladys.fake.action(ACTIONS.TEST).catch(() => {});
  release();
  await clock.settle();
  assert.equal(api.reads().length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the states budget holds what does not fit for the next minute', async () => {
  const api = createFakeTrmnl({ devices: [display(1), display(2), display(3)] });
  const devices = [1, 2, 3].map((id) => buildDevice(ids, parseDeviceRecord(display(id))));
  const { gladys, clock } = await setup({
    api,
    devices,
    timings: { ...TIMINGS, statesPerMinute: 10 },
  });
  assert.equal(gladys.fake.states.length, 10);
  await clock.advance(60_000);
  assert.equal(gladys.fake.states.length, 18);
});

test('a device published again never loses a feature, the buttons included', async () => {
  const extra = {
    ...CREATED,
    features: [...CREATED.features, { ...CREATED.features[0], external_id: fid('old') }],
  };
  const { gladys } = await setup({ devices: [extra] });
  const [device] = gladys.fake.discoveredDevices;
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.ok(keys.includes('old'));
  assert.ok(keys.includes('sleep_mode_on') && keys.includes('sleep_mode_off'));
});

// --- Commands -------------------------------------------------------------------------

const press = (gladys, key, value = 1) =>
  gladys.fake.setValue(CREATED, feature(CREATED, key), value);

test('commands: refused unless allowed; push value 1 only; read only features refused', async () => {
  const { gladys, api } = await setup();
  let ack = await press(gladys, 'sleep_mode_on');
  assert.equal(ack.success, false);
  assert.match(ack.error, /not allowed in the configuration/);
  const allowed = await setup({ config: { allow_sleep_mode: true }, api });
  ack = await press(allowed.gladys, 'sleep_mode_on', 0);
  assert.match(ack.error, /sends 1/);
  ack = await press(allowed.gladys, 'sleep_mode_on', '1');
  assert.match(ack.error, /sends 1/);
  ack = await press(allowed.gladys, 'battery');
  assert.match(ack.error, /read only/);
  assert.equal(api.patches().length, 0);
  const [device] = allowed.gladys.fake.discoveredDevices;
  assert.equal(feature(device, 'sleep_mode_on').category, 'button');
  assert.equal(feature(device, 'sleep_mode_on').type, 'push');
});

test('sleep mode on: state read, written, read back equal, then published', async () => {
  const { gladys, api, clock } = await setup({ config: { allow_sleep_mode: true } });
  const before = api.requests.length;
  const ack = await press(gladys, 'sleep_mode_on');
  assert.equal(ack.success, true, ack.error);
  const sent = api.requests.slice(before);
  assert.deepEqual(
    sent.map((r) => [r.method, r.url.replace('https://trmnl.com', '')]),
    [
      ['GET', '/api/devices/42793'],
      ['PATCH', '/api/devices/42793'],
      ['GET', '/api/devices/42793'],
    ],
  );
  assert.deepEqual(sent[1].body, { sleep_mode_enabled: true });
  assert.ok(sent.every((r) => r.timeoutMs <= TIMINGS.commandBudget));
  await clock.settle();
  assert.equal(state(gladys, 'sleep_mode'), 1);
  // Already on: nothing written.
  const again = await press(gladys, 'sleep_mode_on');
  assert.equal(again.success, true);
  assert.equal(api.patches().length, 1);
});

test('the option turned off while the command reads: nothing written', async () => {
  const api = createFakeTrmnl();
  const { gladys } = await setup({ config: { allow_sleep_mode: true }, api });
  api.next.push(async (req, route) => {
    await gladys.fake.configUpdated({ ...gladys.fake.config, allow_sleep_mode: false });
    return route(req);
  });
  const ack = await press(gladys, 'sleep_mode_on');
  assert.equal(ack.success, false);
  assert.match(ack.error, /not allowed/);
  assert.equal(api.patches().length, 0);
});

test('a slow read leaves no time: nothing written after the deadline', async () => {
  const api = createFakeTrmnl();
  const { gladys, clock } = await setup({ config: { allow_sleep_mode: true }, api });
  api.next.push(async (req, route) => {
    await clock.advance(3_000);
    return route(req);
  });
  const ack = await press(gladys, 'sleep_mode_on');
  assert.equal(ack.success, false);
  assert.match(ack.error, /No time left/);
  assert.equal(api.patches().length, 0);
});

test('a write without answer, or not read back: "sent, without confirmation"', async () => {
  const api = createFakeTrmnl();
  const { gladys } = await setup({ config: { allow_sleep_mode: true }, api });
  api.next.push(undefined, noAnswer);
  let ack = await press(gladys, 'sleep_mode_on');
  assert.equal(ack.success, false);
  assert.match(ack.error, /^Command sent, without confirmation/);
  // Accepted, but TRMNL still shows the old value.
  api.devices[0].sleep_mode_enabled = false;
  api.next.push(undefined, () => answer(204), undefined);
  ack = await press(gladys, 'sleep_mode_on');
  assert.match(ack.error, /^Command sent, without confirmation \(TRMNL still shows/);
});

test('a refused key on a command does not stop the readings', async () => {
  const api = createFakeTrmnl();
  const { gladys, clock } = await setup({ config: { allow_sleep_mode: true }, api });
  api.next.push(undefined, () => answer(403, { error: 'forbidden' }));
  const ack = await press(gladys, 'sleep_mode_on');
  assert.match(ack.error, /refused the API key for this change/);
  await clock.advance(INTERVAL);
  assert.equal(api.reads().length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('another display under the same id (MAC differs): nothing written', async () => {
  const api = createFakeTrmnl();
  const { gladys } = await setup({ config: { allow_sleep_mode: true }, api });
  api.next.push(() => answer(200, { data: display(42793, { mac_address: '00:11:22:33:44:55' }) }));
  const ack = await press(gladys, 'sleep_mode_on');
  assert.match(ack.error, /another display/);
  assert.equal(api.patches().length, 0);
  // An unreadable MAC is not "another display".
  api.next.push(() => answer(200, { data: display(42793, { mac_address: null }) }));
  const ok = await press(gladys, 'sleep_mode_on');
  assert.equal(ok.success, true, ok.error);
});

test('commands are capped per minute', async () => {
  const { gladys } = await setup({ config: { allow_sleep_mode: true } });
  for (let i = 0; i < TIMINGS.commandsPerMinute; i += 1) {
    const ack = await press(gladys, i % 2 ? 'sleep_mode_off' : 'sleep_mode_on');
    assert.equal(ack.success, true, ack.error);
  }
  const ack = await press(gladys, 'sleep_mode_on');
  assert.match(ack.error, /Too many commands/);
});
