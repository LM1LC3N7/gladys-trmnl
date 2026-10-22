# TODO — TRMNL v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — displays and sleep mode** (2026-10-22): the account API
      of python-trmnl 0.1.1 ported to JavaScript, one device per display,
      optional sleep mode buttons, reading loop never faster than the
      interval, refusal and pauses kept in `/data`, states budget; docs
      en/fr. Tested against a fake TRMNL API and a fake clock only, never
      with a real device nor account. The store validator was not run by the
      dev agent (it cannot): to run in the real terminal before publishing.
- [ ] **Milestone 2 — real accounts** (testers): record real answers as
      fixtures, fix what differs. To check first:
  - that `https://trmnl.com/api/devices` answers the user API key (the
    reference uses `trmnl.com`; older docs show `usetrmnl.com`), and what a
    wrong key answers (401 expected, maybe 403);
  - whether the API sends `Retry-After` on 429, and its real limits;
  - the `PATCH` answer (200 or 204) and how fast a `GET` shows the new
    `sleep_mode_enabled`;
  - `percent_charged` against the battery shown on trmnl.com; `wifi_strength`
    range; `rssi` null on BYOD devices;
  - the time zone of `sleep_start_time` / `sleep_end_time` (minutes after
    midnight, account time zone expected).
- [ ] **Milestone 3 — more**: the last contact of a display if the API ever
      exposes it, playlist items visibility (`/api/playlists/items`) as
      buttons, transports (`publishTransports`) "cloud"/"unreachable".
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: joostlek/python-trmnl (PyPI `trmnl` 0.1.1, used by the Home
  Assistant core integration), MIT, checked in its `LICENSE.md` file
  (Copyright (c) 2026 Joost Lekkerkerker). Its host, paths, Bearer
  authentication, fields, PATCH body and test fixtures are ported to
  JavaScript; the full MIT notice is in `THIRD_PARTY_NOTICES.md` (copied into
  the image). Its User-Agent (`python-trmnl/1`) is not used: we send
  `gladys-trmnl`. Neighbour module: LM1LC3N7/gladys-openepaperlink (structure
  of app, store, config, i18n, handlers, tests); the loop, refusal and
  commands follow LM1LC3N7/gladys-uptimerobot (cloud API key).
- Cloud only (`transports: ["cloud"]`), `categories: ["multimedia"]`, Gladys
  5.1.0 or later like the sibling modules. No Bluetooth, no local API (TRMNL
  devices have none documented).
- Version 0.1.0 in `package.json`, `package-lock.json`, the manifest and the
  `docker_image` tag, set by hand at milestone 1: the one exception to
  "versions belong to the Release workflow", because the template's 1.0.0 and
  its image were someone else's. The first patch release gives 0.1.1.
- **Identity rule (frozen, it fixes the external ids)**: `device:<id>`, the
  numeric `id` of `/api/devices`, in decimal. A record without a valid id
  (positive safe integer) is skipped. Name: the TRMNL name, else
  `TRMNL <friendly_id>`, else `TRMNL <id>`. Before each command the display
  is read again: a MAC address or a friendly id that differs from the known
  one refuses the command ("another display"); an unreadable one does not.
- **Devices**: battery (`battery/integer`, `percent`, from
  `percent_charged`, rounded), battery voltage (`energy-sensor/voltage`,
  `volt`, as gladys-blebox and gladys-blue-current; a voltage, never an
  index: set before the first release, category and unit are frozen at
  creation), Wi-Fi strength
  (`unknown/integer` 0-100), RSSI (`unknown/integer` -150-0, dBm in the name;
  the core `signal` category is a 0-5 link quality), sleep mode
  (`unknown/binary`, read only), sleep hours (`text`, "22:00-08:00"). Units
  only from `DEVICE_FEATURE_UNITS_BY_CATEGORY`. No energy index, no scene
  trigger. "Last contact" and "state" of the proposition are not in the API:
  not published.
- **Commands**: the sleep mode is not a sensitive command (it only changes
  when the display refreshes), but it changes the account: two push buttons
  (`button/push`), never a switch an "everything off" could reach, off by
  default behind `allow_sleep_mode`. A press: value 1 only; refused during a
  pause, with a refused key, past 6 per minute; chained per display; GET of
  the display (identity, current value; already there: nothing written; value
  unreadable: refused), `beforeSend` (same client, option still on, no pause,
  at least 0.8 s left of the 3.5 s budget), PATCH, GET again: done only when
  the value read back equals the one asked, else "Command sent, without
  confirmation". A request that never reached TRMNL says "nothing sent". The
  ack never waits for the publication of the new state. A 401/403 on a
  command does not stop the readings (403: "refused, nothing changed"); a
  429/5xx pauses everything and the status says so. A reading in flight
  during a command keeps the command's value. The value read back after the
  PATCH must come from the same display (identity checked as before),
  otherwise "sent, without confirmation"; a field missing from an answer never
  erases a known one; before the first reading after a restart, a command
  fills the table from `/data` first (the other displays stay known).
- **Readings**: one `GET /api/devices` (30 displays at most, 256 KB per
  answer) every interval (default 15 min, 5 min to 1 h). The time of the
  attempt is written to `/data` before the request (attempts are at least
  1 min apart, so at most one write a minute). The first start of the process
  waits the interval from the saved attempt; a new key at runtime waits 1
  min; Gladys reconnecting, an unchanged save, the Discovery button and the
  test button within the interval add nothing. One reading at a time; the
  generation (client) and the epoch (loop) are checked after every await and
  before every status: a late answer of an old key publishes nothing.
- Errors: tried again after the interval, then doubling, up to 1 h. 429 and
  5xx: a pause of Retry-After, else 15 / 5 min, bounded 1 min to 6 h, kept in
  `/data` with its reason and bounded when read back; nothing read or sent
  during it, even after a restart. 401 of a reading: final, kept as
  HMAC-SHA256 of the key with a random salt of `/data`; never tried alone,
  not after a restart; a new key, or the test button once the interval
  passed, tries again; erased only by a successful reading. A 403 is not
  final (trmnl.com is behind Cloudflare, whose challenge pages answer 403;
  the reference treats only 401 as an authentication error): "failing",
  tried again after the interval, then doubling.
- `okAt` (time of the last successful attempt, no key fingerprint) is kept in
  `/data`: a restart whose last attempt succeeded, without refusal nor pause,
  starts "ready" (connected, "last successful reading at X, next at Y").
- The generation is checked again between the write of `attemptAt` and the
  request: a key changed during the write never sends the old one.
- `/data/trmnl.json`: salt, refusal HMAC, pause, last attempt, displays (id,
  name, friendly id, MAC) so the Discovery tab is filled before the first
  reading after a restart (dropped when the key changes). Atomic writes, 0600,
  checked and bounded when read back, no prototype on the display table. The
  profile endpoint (`/api/me`, name and e-mail) is never called.
- **States**: unchanged values dropped, every value again after 30 min
  (history), at most 240 per minute and 100 per request; the rest the next
  minute. Caches emptied on every `connected`; a created device gets its
  states again. Every publication of a device starts from the device created
  in Gladys (`gladys.devices`): no feature is ever lost (the buttons stay
  after the option is turned off; they then answer "not allowed").
- No control byte, no BOM, no mojibake, no hidden bidirectional character
  (tests); the key field says "kept by Gladys in its database, never shown
  again", never that anything is protected otherwise (test).
