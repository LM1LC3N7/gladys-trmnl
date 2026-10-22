// -----------------------------------------------------------------------------
// The TRMNL account API, as the reference client (python-trmnl) calls it:
// `GET /api/devices`, `GET /api/devices/{id}`, `PATCH /api/devices/{id}`,
// with the user API key as a Bearer token. Statuses are sorted into error
// kinds (src/trmnl/errors.js). The key only ever goes to API.ORIGIN, in the
// Authorization header; it is never part of an error or a log.
// -----------------------------------------------------------------------------

import { API, LIMITS, TIMINGS } from '../constants.js';
import { KINDS, TrmnlError } from './errors.js';
import { httpRequest, retryAfterMs } from './http.js';
import { parseDevice, parseDevices } from './parse.js';

export class TrmnlClient {
  constructor({ apiKey, request = httpRequest, now = Date.now }) {
    // Not enumerable: never printed with the client by a careless log.
    Object.defineProperty(this, 'apiKey', { value: apiKey, enumerable: false });
    this.request = request;
    this.now = now;
  }

  /** One request; resolves the body of a 2xx, rejects a TrmnlError otherwise. */
  async call(path, { method = 'GET', body, timeoutMs = TIMINGS.httpTimeout, onSent } = {}) {
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': API.USER_AGENT,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    onSent?.();
    const answer = await this.request(`${API.ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
      maxBytes: LIMITS.responseBytes,
    });
    const { status } = answer;
    if (status >= 200 && status < 300) {
      return answer.body;
    }
    const retry = retryAfterMs(answer.headers?.get?.('retry-after'), this.now());
    if (status === 401 || status === 403) {
      throw new TrmnlError(KINDS.AUTH, `TRMNL refused the API key (${status})`, { status });
    }
    if (status === 404) {
      throw new TrmnlError(KINDS.NOT_FOUND, 'TRMNL does not know this device (404)', { status });
    }
    if (status === 429) {
      throw new TrmnlError(KINDS.RATE_LIMITED, 'TRMNL asks to slow down (429)', {
        status,
        retryAfterMs: retry,
      });
    }
    if (status >= 500) {
      throw new TrmnlError(KINDS.UNAVAILABLE, `TRMNL is in trouble (${status})`, {
        status,
        retryAfterMs: retry,
      });
    }
    throw new TrmnlError(KINDS.HTTP, `TRMNL answered ${status}`, { status });
  }

  async devices(options) {
    return parseDevices(await this.call(API.DEVICES, options));
  }

  async device(id, options) {
    return parseDevice(await this.call(API.device(id), options));
  }

  /** Turns the sleep mode of one display on or off; `onSent` runs right before the request. */
  async setSleepMode(id, enabled, options) {
    await this.call(API.device(id), {
      ...options,
      method: 'PATCH',
      body: { sleep_mode_enabled: enabled === true },
    });
  }
}
