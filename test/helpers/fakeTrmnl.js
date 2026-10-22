// -----------------------------------------------------------------------------
// A fake TRMNL account API: the `request` the app is given (no network). It
// answers like the reference fixtures of python-trmnl (`{ data: ... }`),
// records every request, and lets a test take over the next answers
// (`api.next.push((req) => answer)`), for errors, delays and races.
// -----------------------------------------------------------------------------

import { TrmnlError, KINDS } from '../../src/trmnl/errors.js';

export const API_KEY = 'user_aaaaaaaaaa';
export const OTHER_KEY = 'user_bbbbbbbbbb';

/** One display as the API returns it (the reference fixture `device.json`). */
export function display(id = 42793, overrides = {}) {
  return {
    id,
    name: id === 42793 ? "Joost's TRMNL" : `Display ${id}`,
    friendly_id: id === 42793 ? '1RJXS4' : `F${id}`.slice(0, 6),
    mac_address:
      id === 42793
        ? 'B0:A6:04:02:EB:78'
        : `B0:A6:04:${[id >> 16, id >> 8, id].map((b) => (b & 255).toString(16).padStart(2, '0').toUpperCase()).join(':')}`,
    battery_voltage: 3.87,
    rssi: -64,
    sleep_mode_enabled: false,
    sleep_start_time: 1320,
    sleep_end_time: 480,
    percent_charged: 72.5,
    wifi_strength: 50,
    ...overrides,
  };
}

export const answer = (status, body, headers = {}) => ({
  status,
  headers: new Headers(headers),
  body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
});

export const noAnswer = () => {
  throw new TrmnlError(KINDS.NO_ANSWER, 'No answer within 10000 ms');
};
export const unreachable = () => {
  throw new TrmnlError(KINDS.UNREACHABLE, 'TRMNL unreachable (ECONNREFUSED)');
};

export function createFakeTrmnl({ devices = [display()], key = API_KEY } = {}) {
  const api = {
    key,
    devices,
    requests: [],
    /** Handlers of the next requests, in order: `(req) => answer`, or undefined to route. */
    next: [],
  };

  function route(req) {
    if (req.headers.Authorization !== `Bearer ${api.key}`) {
      return answer(401, { error: 'Unauthorized' });
    }
    const path = req.url.replace('https://trmnl.com', '');
    if (req.method === 'GET' && path === '/api/devices') {
      return answer(200, { data: api.devices });
    }
    const match = /^\/api\/devices\/(\d+)$/.exec(path);
    const found = match && api.devices.find((d) => String(d.id) === match[1]);
    if (match && !found) {
      return answer(404, { error: 'Not found' });
    }
    if (req.method === 'GET' && found) {
      return answer(200, { data: found });
    }
    if (req.method === 'PATCH' && found) {
      for (const [k, v] of Object.entries(req.body ?? {})) {
        found[k] = v;
      }
      return answer(204);
    }
    return answer(400, { error: 'Bad request' });
  }

  api.request = async (url, options = {}) => {
    const req = {
      url,
      method: options.method ?? 'GET',
      headers: { ...options.headers },
      body: options.body === undefined ? undefined : JSON.parse(options.body),
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxBytes,
    };
    api.requests.push(req);
    const handler = api.next.shift();
    if (handler) {
      const result = await handler(req, route);
      if (result) {
        return result;
      }
    }
    return route(req);
  };

  api.reads = () => api.requests.filter((r) => r.method === 'GET' && r.url.endsWith('/devices'));
  api.patches = () => api.requests.filter((r) => r.method === 'PATCH');
  return api;
}
