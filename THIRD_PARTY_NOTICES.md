# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, under its own licence.

## python-trmnl

- Project: [joostlek/python-trmnl](https://github.com/joostlek/python-trmnl),
  the asynchronous Python client of the TRMNL API used by the Home Assistant
  TRMNL integration (PyPI `trmnl` 0.1.1, repository read at its `main`
  branch on 2026-10-22).
- What is ported (rewritten in JavaScript in `src/constants.js` and
  `src/trmnl/`): the API host (`trmnl.com`) and paths (`/api/devices`,
  `/api/devices/{id}`), the Bearer authentication with the user API key, the
  `PATCH` body of the sleep mode (`sleep_mode_enabled`), the `{ "data": ... }`
  envelope, the fields of a device (`id`, `name`, `friendly_id`,
  `mac_address`, `battery_voltage`, `rssi`, `sleep_mode_enabled`,
  `sleep_start_time`, `sleep_end_time`, `percent_charged`, `wifi_strength`),
  401 as an authentication error, and the fixtures of its tests (used as test
  data in `test/helpers/fakeTrmnl.js`). No Python runs here; its User-Agent is
  not used (this integration names itself `gladys-trmnl`).
- Licence: MIT, reproduced below as its `LICENSE.md` file reads.

```
MIT License

Copyright (c) 2026 Joost Lekkerkerker

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Runtime dependency

[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
is installed from npm into the image under its own licence (Apache License
2.0, shipped in `node_modules/@gladysassistant/integration-sdk/LICENSE`).
