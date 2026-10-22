# gladys-trmnl

[Gladys Assistant](https://gladysassistant.com) external integration for
**TRMNL** e-ink displays, through the official TRMNL account API: battery
(charge and voltage), Wi-Fi strength and signal, sleep mode and sleep hours of
each display, and optional buttons that turn the sleep mode on or off.
Unofficial, not affiliated with TRMNL.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Never tested with a real device: tested
> against a simulated TRMNL API only.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (TrmnlApp)
                                   ├─ src/trmnl/client.js  GET /api/devices, GET|PATCH /api/devices/{id}
                                   ├─ src/trmnl/http.js    fetch, timeout, size cap, no redirect
                                   ├─ src/trmnl/parse.js   strict readers of the answers (pure)
                                   ├─ src/model.js         -> Gladys devices and states (pure)
                                   └─ src/store.js         /data/trmnl.json
```

- **Readings**: `GET https://trmnl.com/api/devices` with the user API key as a
  Bearer token, every refresh interval (15 min by default), never faster:
  the time of the last attempt is written to `/data` before each request.
  Errors wait the interval, then double up to 1 h; 429/5xx pause every path
  (1 min to 6 h, kept in `/data`); a refused key (401/403) is final, kept as
  an HMAC, retried only by a new key or the test button.
- **Devices**: `device:<TRMNL id>` per display: battery (`battery`,
  `percent`), battery voltage, Wi-Fi strength, RSSI (`unknown` sensors, the
  unit in the name), sleep mode (read-only binary), sleep hours (text).
- **Commands**: two push buttons per display, only when
  `allow_sleep_mode` is on: state read again (identity checked), option
  checked again right before the `PATCH`, confirmed by a value read back,
  nothing sent after 3.5 s, 6 per minute.
- **States**: unchanged values dropped (all again every 30 min), at most 240
  per minute.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
node scripts/cover.mjs cover.png                # regenerate the cover
```

`test/helpers/` holds a fake TRMNL API (the fixtures of python-trmnl) and a
clock moved by hand.

## Credits

- [joostlek/python-trmnl](https://github.com/joostlek/python-trmnl) (MIT),
  0.1.1: read as the reference and ported to JavaScript (no Python runs
  here).

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store
(added at the first real release).

## License

Apache-2.0 (see [LICENSE](LICENSE)); the logic ported from python-trmnl (MIT)
is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). This project is
not affiliated with TRMNL.
