// -----------------------------------------------------------------------------
// TRMNL displays -> Gladys devices and states (pure).
//
// Units: only those the core lists for the category
// (`DEVICE_FEATURE_UNITS_BY_CATEGORY`): `percent` for the battery, `volt` for
// the battery voltage (`energy-sensor/voltage`, never an index). The Wi-Fi
// strength and the RSSI have no unit the core admits for a fitting category
// (`signal` is a 0-5 quality): they are `unknown` sensors, the unit in their
// name. The sleep mode is a read only state; it is changed only by two
// push buttons, present when allowed in the configuration (never a switch:
// no "everything off" nor voice assistant reaches them).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURES, LIMITS } from './constants.js';

const NAMES = {
  [FEATURES.BATTERY]: { en: 'Battery', fr: 'Batterie' },
  [FEATURES.BATTERY_VOLTAGE]: { en: 'Battery voltage', fr: 'Tension de la batterie' },
  [FEATURES.WIFI_STRENGTH]: { en: 'Wi-Fi strength (%)', fr: 'Force du Wi-Fi (%)' },
  [FEATURES.RSSI]: { en: 'Wi-Fi signal (dBm)', fr: 'Signal Wi-Fi (dBm)' },
  [FEATURES.SLEEP_MODE]: { en: 'Sleep mode', fr: 'Mode veille' },
  [FEATURES.SLEEP_WINDOW]: { en: 'Sleep hours', fr: 'Heures de veille' },
  [FEATURES.SLEEP_ON]: { en: 'Turn the sleep mode on', fr: 'Activer le mode veille' },
  [FEATURES.SLEEP_OFF]: { en: 'Turn the sleep mode off', fr: 'Désactiver le mode veille' },
};

const readOnly = { read_only: true, has_feedback: false };

export const SPECS = Object.freeze({
  [FEATURES.BATTERY]: {
    category: C.BATTERY,
    type: T.BATTERY.INTEGER,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    keep_history: true,
    ...readOnly,
  },
  [FEATURES.BATTERY_VOLTAGE]: {
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.VOLTAGE,
    unit: U.VOLT,
    min: 0,
    max: 10,
    keep_history: true,
    ...readOnly,
  },
  [FEATURES.WIFI_STRENGTH]: {
    category: C.UNKNOWN,
    type: T.SENSOR.INTEGER,
    min: 0,
    max: 100,
    keep_history: true,
    ...readOnly,
  },
  [FEATURES.RSSI]: {
    category: C.UNKNOWN,
    type: T.SENSOR.INTEGER,
    min: -150,
    max: 0,
    keep_history: true,
    ...readOnly,
  },
  [FEATURES.SLEEP_MODE]: {
    category: C.UNKNOWN,
    type: T.SENSOR.BINARY,
    min: 0,
    max: 1,
    ...readOnly,
  },
  [FEATURES.SLEEP_WINDOW]: { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, ...readOnly },
});

const BUTTON = {
  category: C.BUTTON,
  type: T.BUTTON.PUSH,
  min: 0,
  max: 1,
  read_only: false,
  has_feedback: false,
  keep_history: false,
};

export const BUTTONS = Object.freeze({ [FEATURES.SLEEP_ON]: true, [FEATURES.SLEEP_OFF]: false });

export const deviceIds = (gladys, id) => gladys.externalIds(DEVICE_TYPE, String(id));

/** The name of a display: its name in TRMNL, else its friendly id, else its id. */
export const deviceName = (d) =>
  (d?.name || (d?.friendlyId ? `TRMNL ${d.friendlyId}` : `TRMNL ${d?.id ?? ''}`.trim())).slice(
    0,
    LIMITS.name,
  );

/**
 * One display. `created` (the device as Gladys has it, from `gladys.devices`)
 * adds back any feature this list would not have (the buttons after the
 * option was turned off, included): a device published again never loses a
 * feature.
 */
export function buildDevice(gladys, display, { language = 'fr', buttons = false, created } = {}) {
  const ids = deviceIds(gladys, display.id);
  const specs = { ...SPECS };
  if (buttons) {
    specs[FEATURES.SLEEP_ON] = BUTTON;
    specs[FEATURES.SLEEP_OFF] = BUTTON;
  }
  const features = Object.entries(specs).map(([key, spec]) => ({
    name: (NAMES[key][language] ?? NAMES[key].en).slice(0, LIMITS.text),
    external_id: ids.feature(key),
    ...spec,
  }));
  const known = new Set(features.map((f) => f.external_id));
  for (const f of Array.isArray(created?.features) ? created.features : []) {
    if (f && typeof f.external_id === 'string' && !known.has(f.external_id)) {
      known.add(f.external_id);
      features.push({ ...f });
    }
  }
  const params = [];
  if (display.friendlyId) {
    params.push({ name: 'FRIENDLY_ID', value: display.friendlyId });
  }
  return {
    name: deviceName(display),
    external_id: ids.device,
    model: 'TRMNL',
    should_poll: false,
    params,
    features,
  };
}

const hhmm = (m) =>
  `${String(Math.trunc(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "22:00-08:00" from minutes after midnight; undefined when one is missing. */
export const sleepWindowText = (start, end) =>
  Number.isInteger(start) && Number.isInteger(end) ? `${hhmm(start)}-${hhmm(end)}` : undefined;

/**
 * The states of one display as { key, value } (`value` a number, or
 * { text }). A value missing from the answer publishes nothing (never 0,
 * never NaN).
 */
export function statesOf(display) {
  const out = [];
  if (display.percentCharged !== undefined) {
    out.push({ key: FEATURES.BATTERY, value: Math.round(display.percentCharged) });
  }
  if (display.batteryVoltage !== undefined) {
    out.push({
      key: FEATURES.BATTERY_VOLTAGE,
      value: Math.round(display.batteryVoltage * 100) / 100,
    });
  }
  if (display.wifiStrength !== undefined) {
    out.push({ key: FEATURES.WIFI_STRENGTH, value: Math.round(display.wifiStrength) });
  }
  if (display.rssi !== undefined) {
    out.push({ key: FEATURES.RSSI, value: display.rssi });
  }
  if (display.sleepModeEnabled !== undefined) {
    out.push({ key: FEATURES.SLEEP_MODE, value: display.sleepModeEnabled ? 1 : 0 });
  }
  const window = sleepWindowText(display.sleepStart, display.sleepEnd);
  if (window) {
    out.push({ key: FEATURES.SLEEP_WINDOW, value: { text: window } });
  }
  return out;
}

/** The display id of a device external id of this integration, or undefined. */
export function parseExternalId(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '0').device.slice(0, -1);
  const text = String(externalId ?? '');
  if (!text.startsWith(prefix)) {
    return undefined;
  }
  const match = /^([1-9]\d{0,15})(?::([a-z_]{1,40}))?$/.exec(text.slice(prefix.length));
  if (!match || !Number.isSafeInteger(Number(match[1]))) {
    return undefined;
  }
  return { id: Number(match[1]), feature: match[2] };
}
