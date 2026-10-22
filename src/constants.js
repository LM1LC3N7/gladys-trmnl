// -----------------------------------------------------------------------------
// Frozen keys (external ids, features, manifest actions), the TRMNL API, limits
// and timings. Every key here is stored by Gladys or by its users: never
// rename one.
// -----------------------------------------------------------------------------

/**
 * `gladys.externalIds(DEVICE_TYPE, <id>)`: `<id>` is the numeric `id` TRMNL
 * gives the display in its account API (`/api/devices`), written in decimal.
 * It never changes for a display of the account; the name, the friendly id
 * and the MAC address are only shown or compared, never part of the id.
 */
export const DEVICE_TYPE = 'device';

export const FEATURES = Object.freeze({
  /** Read only: battery charge, % (`percent_charged`). */
  BATTERY: 'battery',
  /** Read only: battery voltage, V (`battery_voltage`). */
  BATTERY_VOLTAGE: 'battery_voltage',
  /** Read only: Wi-Fi strength as TRMNL rates it, 0 to 100 (`wifi_strength`). */
  WIFI_STRENGTH: 'wifi_strength',
  /** Read only: Wi-Fi signal, dBm (`rssi`). */
  RSSI: 'rssi',
  /** Read only: 1 the sleep mode is on, 0 off (`sleep_mode_enabled`). */
  SLEEP_MODE: 'sleep_mode',
  /** Read only text: the sleep hours, "22:00-08:00" (`sleep_start_time`, `sleep_end_time`). */
  SLEEP_WINDOW: 'sleep_window',
  /** Push button (only when allowed in the configuration): turn the sleep mode on. */
  SLEEP_ON: 'sleep_mode_on',
  /** Push button (only when allowed in the configuration): turn the sleep mode off. */
  SLEEP_OFF: 'sleep_mode_off',
});

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

/** Refresh intervals offered by the manifest, in seconds (values stored by Gladys). */
export const REFRESH_INTERVALS = Object.freeze(['300', '600', '900', '1800', '3600']);

/** The official account API of TRMNL (as the reference client calls it). */
export const API = Object.freeze({
  ORIGIN: 'https://trmnl.com',
  DEVICES: '/api/devices',
  device: (id) => `/api/devices/${id}`,
  /** Our own name, never the one of another client or application. */
  USER_AGENT: 'gladys-trmnl',
});

export const STORE_FILE = 'trmnl.json';

export const TIMINGS = Object.freeze({
  /** One HTTP exchange of a reading. */
  httpTimeout: 10_000,
  /** Never two readings closer than this, whatever asks (a new key, the button). */
  attemptSpacing: 60_000,
  /** A failed reading waits at least the interval, then doubles up to this. */
  retryMax: 3_600_000,
  /** 429 or 5xx: a pause of this when the answer has no Retry-After, bounded by min and max. */
  pause429: 15 * 60_000,
  pause5xx: 5 * 60_000,
  pauseMin: 60_000,
  pauseMax: 6 * 3_600_000,
  /** Gladys waits 5 s for the ack of a command: nothing is sent after this. */
  commandBudget: 3_500,
  /** The write of a command needs at least this left before its deadline. */
  commandWriteMin: 800,
  /** Commands toward TRMNL per minute, all displays together. */
  commandsPerMinute: 6,
  /** Budget of states per minute (the core admits 300). */
  statesPerMinute: 240,
  /** Values published again after this even when unchanged (history). */
  heartbeat: 30 * 60_000,
  /** The "Test the connection" button waits 30 s: answer before. */
  testBudget: 25_000,
});

export const LIMITS = Object.freeze({
  /** Displays followed at most (an account rarely has more than a few). */
  devices: 30,
  /** Largest answer read (one display is about 400 bytes). */
  responseBytes: 256 * 1024,
  /** Length of a published text, and of a name. */
  text: 200,
  name: 64,
});
