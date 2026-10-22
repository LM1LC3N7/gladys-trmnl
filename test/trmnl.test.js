// -----------------------------------------------------------------------------
// The TRMNL layer alone: answers parsed strictly and bounded, statuses sorted,
// the HTTP transport (size cap, timeout, no redirect), and the /data store.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, TIMINGS } from '../src/constants.js';
import { sleepWindowText, statesOf } from '../src/model.js';
import { FileStore, sanitize } from '../src/store.js';
import { TrmnlClient } from '../src/trmnl/client.js';
import { KINDS, TrmnlError } from '../src/trmnl/errors.js';
import { httpRequest, retryAfterMs } from '../src/trmnl/http.js';
import { cleanText, parseDevice, parseDevices } from '../src/trmnl/parse.js';
import { answer, display } from './helpers/fakeTrmnl.js';

test('parseDevices: the reference fixture', () => {
  const { devices, total } = parseDevices(JSON.stringify({ data: [display()] }));
  assert.equal(total, 1);
  assert.deepEqual(devices[0], {
    id: 42793,
    name: "Joost's TRMNL",
    friendlyId: '1RJXS4',
    mac: 'B0:A6:04:02:EB:78',
    batteryVoltage: 3.87,
    rssi: -64,
    percentCharged: 72.5,
    wifiStrength: 50,
    sleepModeEnabled: false,
    sleepStart: 1320,
    sleepEnd: 480,
  });
});

test('parseDevices: wrong types and ranges dropped, never 0 nor NaN', () => {
  const { devices } = parseDevices(
    JSON.stringify({
      data: [
        display(5, {
          battery_voltage: null,
          rssi: '-60',
          percent_charged: 140,
          wifi_strength: -1,
          sleep_mode_enabled: 'false',
          sleep_start_time: 1440,
          name: 'A\u0000B\u202eC  \n D',
          mac_address: 'nope',
          friendly_id: '<script>',
        }),
      ],
    }),
  );
  const [d] = devices;
  assert.equal(d.name, 'A B C D');
  for (const key of [
    'batteryVoltage',
    'rssi',
    'percentCharged',
    'wifiStrength',
    'sleepModeEnabled',
    'sleepStart',
    'mac',
    'friendlyId',
  ]) {
    assert.equal(d[key], undefined, key);
  }
  // Only the values present are published.
  assert.deepEqual(statesOf(d), []);
});

test('parseDevices: invalid ids skipped, each id once, capped, no prototype pollution', () => {
  const raw = `{"data":[{"id":0},{"id":-1},{"id":"7"},{"id":1.5},{"id":3,"__proto__":{"polluted":true}},{"id":3}${Array.from(
    { length: 40 },
    (_, i) => `,{"id":${100 + i}}`,
  ).join('')}]}`;
  const { devices, total } = parseDevices(raw);
  assert.equal(total, 41);
  assert.equal(devices.length, LIMITS.devices);
  assert.equal(devices[0].id, 3);
  assert.equal({}.polluted, undefined);
  assert.equal(devices[0].polluted, undefined);
  assert.throws(
    () => parseDevices('{"data":{}}'),
    (e) => e.kind === KINDS.BAD_RESPONSE,
  );
  assert.throws(
    () => parseDevices('<html>'),
    (e) => e.kind === KINDS.BAD_RESPONSE,
  );
  assert.throws(
    () => parseDevice('{"data":{"id":"x"}}'),
    (e) => e.kind === KINDS.BAD_RESPONSE,
  );
});

test('cleanText bounds and the sleep window', () => {
  assert.equal(cleanText('x'.repeat(10_000), 64).length, 64);
  assert.equal(cleanText('   '), undefined);
  assert.equal(cleanText(42), undefined);
  assert.equal(sleepWindowText(1320, 480), '22:00-08:00');
  assert.equal(sleepWindowText(0, 1439), '00:00-23:59');
  assert.equal(sleepWindowText(undefined, 480), undefined);
});

test('client: statuses sorted into kinds, the key never in a message', async () => {
  const cases = [
    [401, KINDS.AUTH],
    [403, KINDS.HTTP],
    [404, KINDS.NOT_FOUND],
    [429, KINDS.RATE_LIMITED],
    [500, KINDS.UNAVAILABLE],
    [503, KINDS.UNAVAILABLE],
    [302, KINDS.HTTP],
    [400, KINDS.HTTP],
  ];
  for (const [status, kind] of cases) {
    const client = new TrmnlClient({
      apiKey: 'user_secret',
      request: async () => answer(status, { error: 'user_secret' }, { 'Retry-After': '120' }),
      now: () => 0,
    });
    await assert.rejects(client.devices(), (err) => {
      assert.equal(err.kind, kind, String(status));
      assert.ok(!err.message.includes('user_secret'));
      if (status === 429 || status >= 500) {
        assert.equal(err.retryAfterMs, 120_000);
      }
      return true;
    });
  }
  const client = new TrmnlClient({ apiKey: 'user_secret', request: async () => answer(204) });
  assert.ok(!JSON.stringify(client).includes('user_secret'));
  assert.ok(!Object.keys(client).includes('apiKey'));
});

test('retryAfterMs: seconds, HTTP date, junk', () => {
  assert.equal(retryAfterMs('30'), 30_000);
  assert.equal(retryAfterMs('Thu, 01 Jan 1970 00:01:00 GMT', 0), 60_000);
  assert.equal(retryAfterMs('soon'), undefined);
  assert.equal(retryAfterMs(null), undefined);
});

/** A fetch answering a stream of `chunks`. */
const streamFetch =
  (chunks, status = 200) =>
  async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
          controller.close();
        },
      }),
      { status },
    );
  };

test('httpRequest: answers bounded, read into one buffer', async () => {
  const ok = await httpRequest('https://trmnl.com/x', { maxBytes: 10 }, streamFetch(['ab', 'cd']));
  assert.deepEqual([ok.status, ok.body], [200, 'abcd']);
  await assert.rejects(
    httpRequest('https://trmnl.com/x', { maxBytes: 10 }, streamFetch(['abcdef', 'ghijkl'])),
    (err) => err.kind === KINDS.BAD_RESPONSE,
  );
});

test('httpRequest: timeout is "no answer", refused connection is "unreachable"', async () => {
  const hang = (_url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort'))));
  await assert.rejects(
    httpRequest('https://trmnl.com/x', { timeoutMs: 20 }, hang),
    (err) => err instanceof TrmnlError && err.kind === KINDS.NO_ANSWER,
  );
  const refused = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  };
  await assert.rejects(
    httpRequest('https://trmnl.com/x', {}, refused),
    (err) => err.kind === KINDS.UNREACHABLE,
  );
  const reset = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
  };
  await assert.rejects(
    httpRequest('https://trmnl.com/x', {}, reset),
    (err) => err.kind === KINDS.NO_ANSWER,
  );
});

test('store: saved values checked and bounded when read back', () => {
  const now = 1_000_000;
  const data = sanitize(
    {
      salt: 'a'.repeat(64),
      refusal: 'not-a-hash',
      pause: { until: now + 10 * TIMINGS.pauseMax, reason: 'server:503' },
      attemptAt: now + 99_999,
      devices: {
        __proto__: { 1: { id: 1 } },
        12: { id: 12, name: 'x'.repeat(500), friendlyId: 'ABC', mac: 'zz' },
        13: { id: 14 },
        abc: { id: 'abc' },
      },
    },
    now,
  );
  assert.equal(data.salt, 'a'.repeat(64));
  assert.equal(data.refusal, null);
  assert.deepEqual(data.pause, { until: now + TIMINGS.pauseMax, reason: 'server:503' });
  assert.equal(data.attemptAt, now);
  assert.deepEqual(Object.keys(data.devices), ['12']);
  assert.equal(data.devices['12'].name.length, LIMITS.name);
  assert.equal(data.devices['12'].mac, null);
  assert.equal(Object.getPrototypeOf(data.devices), null);
  assert.equal(sanitize({ pause: { until: now - 1 } }, now).pause, null);
});

test('FileStore: atomic writes, an unreadable file moved aside', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trmnl-store-'));
  const store = new FileStore({ dir });
  await store.save({ salt: 'b'.repeat(64), attemptAt: 5, devices: {} });
  const back = await store.load(10);
  assert.equal(back.salt, 'b'.repeat(64));
  assert.equal(back.attemptAt, 5);
  writeFileSync(join(dir, 'trmnl.json'), '{oops');
  const reset = await store.load(10);
  assert.equal(reset.salt, null);
  assert.equal(store.corrupted, true);
  assert.ok(existsSync(join(dir, 'trmnl.json.bad')));
  assert.equal(readFileSync(join(dir, 'trmnl.json.bad'), 'utf8'), '{oops');
});
