// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form.
// -----------------------------------------------------------------------------

import { REFRESH_INTERVALS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = Object.freeze({
  refresh_interval: '900',
  allow_sleep_mode: false,
  language: 'fr',
});

/** What the API key may hold: printable ASCII, no space. */
const KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;

const bool = (value, fallback) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
};

export function normalizeConfig(raw = {}) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const apiKey = typeof c.api_key === 'string' ? c.api_key.trim() : '';
  const interval = REFRESH_INTERVALS.includes(String(c.refresh_interval))
    ? String(c.refresh_interval)
    : DEFAULT_CONFIG.refresh_interval;
  const invalid = apiKey !== '' && !KEY_PATTERN.test(apiKey);
  return {
    apiKey,
    /** An invisible character pasted with the key: said to the user, never sent. */
    apiKeyInvalid: invalid,
    ready: apiKey !== '' && !invalid,
    intervalMs: Number(interval) * 1000,
    allowSleepMode: bool(c.allow_sleep_mode, DEFAULT_CONFIG.allow_sleep_mode),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}
