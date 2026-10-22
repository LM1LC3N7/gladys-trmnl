# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- TRMNL displays through the official TRMNL account API (`/api/devices`) and
  the API key of the account: one device per display, keyed by its TRMNL id,
  with battery (%), battery voltage, Wi-Fi strength, Wi-Fi signal (dBm),
  sleep mode and sleep hours. A JavaScript port of python-trmnl (MIT).
- Optional "Turn the sleep mode on / off" push buttons, off by default:
  state read again first (same display checked), option checked again right
  before the change, confirmed only by a value read back, nothing sent after
  3.5 s, 6 commands per minute at most. Never a switch.
- Readings every refresh interval (5 min to 1 h, 15 min by default), never
  faster: Gladys reconnecting, an unchanged configuration, the Discovery and
  test buttons and a container restart add no reading.
- A key refused by TRMNL is final (kept as an HMAC in `/data`, erased at the
  first success); 429 and 5xx pause every path, 1 min to 6 h, kept across
  restarts.
- Status and Discovery published again at every connection to Gladys; a
  device published again keeps every feature of the created one; states
  within a budget of 240 per minute.
- `LICENSE` (Apache-2.0) and `THIRD_PARTY_NOTICES.md`, copied into the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-trmnl/commits/main
