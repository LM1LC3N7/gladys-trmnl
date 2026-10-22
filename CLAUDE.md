# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
It brings the TRMNL e-ink displays of an account into Gladys through the
official TRMNL account API, a JavaScript port of python-trmnl (MIT, see
`THIRD_PARTY_NOTICES.md`).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "429"     # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/handlers.js                   the SDK handlers -> TrmnlApp (shared with the tests)
src/app.js                        TrmnlApp: reading loop, pauses, refusal, states budget, commands, status
src/model.js                      displays -> Gladys devices and states (pure)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/store.js                      /data/trmnl.json: salt, refusal HMAC, pause, last attempt, displays
src/budget.js                     sliding one-minute budgets (states, commands)
src/constants.js                  frozen keys, API paths, timings, limits
src/i18n.js                       texts shown in Gladys (en/fr)
src/trmnl/client.js               the account API calls, statuses -> error kinds
src/trmnl/http.js                 fetch with timeout and size cap, no redirect, failures sorted
src/trmnl/parse.js                strict readers of the answers (pure)
src/trmnl/errors.js               TrmnlError and its kinds
gladys-assistant-integration.json manifest: name, config_schema, actions...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: fake Gladys (SDK), fake TRMNL API, fake clock
scripts/cover.mjs                 cover.png generator (plain Node)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** `device:<id>`, `<id>` the numeric id TRMNL
  gives the display (decimal), built with `gladys.externalIds(type, id)`. The
  same goes for every key users store: manifest `config_schema`, `actions`,
  feature keys (`src/constants.js`).
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log, store or show the API key; `/data` holds only an
  HMAC of a refused key, never of a key that works.
- **Never read faster than the interval**: the time of the last attempt is
  written to `/data` before each request; Gladys reconnecting, an unchanged
  configuration, the buttons and restarts never add a reading. 429/5xx pause
  every path; a refused key is final.
- **Commands**: push buttons only (never a switch), off by default, state read
  again, option checked again right before the write (`beforeSend`),
  confirmed by a value read back, nothing sent after `TIMINGS.commandBudget`.
- **Bounded input**: answers capped (`LIMITS.responseBytes`), parsing linear,
  records rebuilt with known keys only.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code (defaults, actions):
  change both sides together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
