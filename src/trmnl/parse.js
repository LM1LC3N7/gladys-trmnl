// -----------------------------------------------------------------------------
// Readers of the TRMNL answers (pure). The fields are those of the reference
// client (`Device` of python-trmnl): each one is checked for its type and its
// range, anything else is dropped. Nothing of the answer is kept as is: the
// records are new objects with known keys only (no prototype pollution), and
// the parsing is linear (JSON.parse, then one pass).
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';
import { KINDS, TrmnlError } from './errors.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);

/** Control, invisible and bidirectional characters, removed from any text shown. */
/* eslint-disable no-control-regex */
const HIDDEN =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;
/* eslint-enable no-control-regex */

/** A text for Gladys: hidden characters removed, blanks merged, bounded; undefined if empty. */
export function cleanText(value, max = LIMITS.text) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const text = value
    .slice(0, max * 4)
    .replace(HIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return text === '' ? undefined : text;
}

/** The display id: a positive whole number (the external id is its decimal form). */
export const isDeviceId = (v) => Number.isSafeInteger(v) && v > 0;

const number = (v, min, max) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
const integer = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);
const minutes = (v) => integer(v, 0, 1439);

/** One display record of the API, or undefined when it has no valid id. */
export function parseDeviceRecord(raw) {
  if (!isObject(raw)) {
    return undefined;
  }
  const id = own(raw, 'id');
  if (!isDeviceId(id)) {
    return undefined;
  }
  const friendly = own(raw, 'friendly_id');
  const mac = own(raw, 'mac_address');
  const sleep = own(raw, 'sleep_mode_enabled');
  return {
    id,
    name: cleanText(own(raw, 'name'), LIMITS.name),
    friendlyId:
      typeof friendly === 'string' && /^[A-Za-z0-9]{1,16}$/.test(friendly)
        ? friendly.toUpperCase()
        : undefined,
    mac:
      typeof mac === 'string' && /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}$/.test(mac)
        ? mac.toUpperCase()
        : undefined,
    batteryVoltage: number(own(raw, 'battery_voltage'), 0, 10),
    rssi: integer(own(raw, 'rssi'), -150, 0),
    percentCharged: number(own(raw, 'percent_charged'), 0, 100),
    wifiStrength: number(own(raw, 'wifi_strength'), 0, 100),
    sleepModeEnabled: typeof sleep === 'boolean' ? sleep : undefined,
    sleepStart: minutes(own(raw, 'sleep_start_time')),
    sleepEnd: minutes(own(raw, 'sleep_end_time')),
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new TrmnlError(KINDS.BAD_RESPONSE, 'The answer is not JSON');
  }
}

/**
 * `GET /api/devices` -> { devices, total }: the valid records, each id once,
 * LIMITS.devices at most; `total` counts the valid records before the cap.
 */
export function parseDevices(text) {
  const body = parseJson(text);
  const data = isObject(body) ? own(body, 'data') : undefined;
  if (!Array.isArray(data)) {
    throw new TrmnlError(KINDS.BAD_RESPONSE, 'The answer has no list of devices');
  }
  const seen = new Set();
  const devices = [];
  let total = 0;
  for (const raw of data.slice(0, 1000)) {
    const device = parseDeviceRecord(raw);
    if (!device || seen.has(device.id)) {
      continue;
    }
    seen.add(device.id);
    total += 1;
    if (devices.length < LIMITS.devices) {
      devices.push(device);
    }
  }
  return { devices, total };
}

/** `GET /api/devices/{id}` -> the record (BAD_RESPONSE when it has no valid id). */
export function parseDevice(text) {
  const body = parseJson(text);
  const device = parseDeviceRecord(isObject(body) ? own(body, 'data') : undefined);
  if (!device) {
    throw new TrmnlError(KINDS.BAD_RESPONSE, 'The answer has no device');
  }
  return device;
}
