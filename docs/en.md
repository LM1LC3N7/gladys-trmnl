# TRMNL

Brings the [TRMNL](https://trmnl.com) e-ink displays of your account into
Gladys, through the official TRMNL account API: battery, Wi-Fi and sleep mode
of each display.

> **Never tested with a real device.** This integration was written from the
> `trmnl` Python client (the one of the Home Assistant integration) and
> tested against a simulated TRMNL API only. Unofficial, not affiliated with
> TRMNL.

## What you get

One device per display (Discovery tab), keyed by its TRMNL id:

- **Battery** (%), and **battery voltage** (V);
- **Wi-Fi strength** (0 to 100, as TRMNL rates it) and **Wi-Fi signal**
  (dBm);
- **Sleep mode** (on or off) and **sleep hours** (for example
  `22:00-08:00`, in the time zone of your TRMNL account);
- as an option, two **buttons**: "Turn the sleep mode on" and "Turn the
  sleep mode off" (see below).

What the screen shows (playlists, plugins) stays managed in TRMNL. The API
gives no "last contact" time of a display: it is not shown.

## Getting started

1. On [trmnl.com](https://trmnl.com), open **Account** and copy the **API
   key** of your account (it starts with `user_`).
2. In Gladys, open this integration, paste the key and save. The key is kept
   by Gladys in its database, never shown again, and sent only to trmnl.com,
   in the `Authorization` header of the requests.
3. Your displays appear in the Discovery tab: create the ones you want.

## How often it reads

- One request for all the displays, every refresh interval (15 minutes by
  default, from 5 minutes to 1 hour). A display reports its battery and
  signal when it wakes up: reading more often rarely shows more.
- **Never faster than the interval**: neither Gladys reconnecting, nor a
  configuration saved unchanged, nor the Discovery button, nor "Test the
  connection", nor a restart of the container (the time of the last attempt
  is kept) adds a reading. A new key is tried one minute at most after the
  last attempt.
- After an error, a new try after the interval, then twice that, up to
  1 hour.
- 429 (TRMNL asks to slow down) or 5xx: a pause of what TRMNL asks, else 15
  or 5 minutes, between 1 minute and 6 hours, kept across restarts. No
  reading and no command during the pause.
- **Key refused** (401 or 403): no automatic try any more, restarts included.
  Paste the right key, or press "Test the connection" once the interval has
  passed: the refusal is erased only by a successful reading.

## Sleep mode buttons (off by default)

Tick "Allow changing the sleep mode of the displays" in the configuration.
Each display then gets two buttons (never a switch: no voice assistant nor
"turn everything off" can reach them). Each press:

1. reads the display from TRMNL again (and checks it is the same display:
   MAC address and friendly id); when it already is in the mode asked,
   nothing is sent;
2. checks again that the option is still ticked, then changes the sleep
   mode;
3. reads the display back: the command is said done only when TRMNL shows
   the new value. Otherwise: "Command sent, without confirmation" (the next
   reading shows the real mode).

Nothing is sent later than 3.5 seconds after the press (Gladys waits 5
seconds), nor during a 429/5xx pause; 6 commands per minute at most.

## Questions to testers

If you own a TRMNL display, tell us (forum, or a GitHub issue): do the
battery, voltage and signal match what trmnl.com shows? Do the sleep mode
buttons act on the display?

## Data and privacy

The integration only talks to trmnl.com. It keeps in its `/data` volume: a
random key, the fingerprint (HMAC) of a refused key (erased at the first
success; never a fingerprint of a key that works), the end of a pause, the
time of the last attempt, and the list of displays (id, name, friendly id,
MAC address). It does not read your profile (name, e-mail).
