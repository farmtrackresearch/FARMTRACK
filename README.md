# FarmTrack

**GPS + LoRa livestock tracking and virtual fencing for areas with no cellular
coverage.** Each animal wears a collar that reads its GPS position and sends it
over long-range LoRa radio to a gateway. The gateway uploads it to Supabase over
WiFi. A mobile app shows the animals on a live map, lets you draw virtual fences,
and raises an alert when an animal gets close to a fence, crosses it, or stops
moving for an hour — and, once a battery sensor is fitted, when its collar
battery runs low. The collar also beeps when it is near or past a fence, but only
while it has a fresh GPS fix: with no fix, or no answer from the server, it goes
quiet rather than repeat an old verdict.

This is a research / educational project. Contact: `farmtrack.research@gmail.com`.

---

## Contents

1. [How the system fits together](#1-how-the-system-fits-together)
2. [What is in this repository](#2-what-is-in-this-repository)
3. [Setup, step by step](#3-setup-step-by-step)
4. [What changed in this version](#4-what-changed-in-this-version)
5. [Claude Code agents for the team](#5-claude-code-agents-for-the-team)
6. [Hardware overview and safety](#6-hardware-overview-and-safety)
7. [License](#7-license)

---

## 1. How the system fits together

```
 COLLAR (ESP32 + GPS + LoRa + buzzer)
   │  every few seconds: "here is my position"          LoRa 433 MHz
   ▼
 GATEWAY (ESP32 + LoRa, on WiFi)
   │  uploads the reading                                HTTPS
   ▼
 SUPABASE (Postgres + PostGIS)
   │  checks the position against every fence, saves it, makes alerts
   │  and returns the collar's fence state (safe / warning / breach)
   ├──────────► back to the GATEWAY ──► LoRa reply ──► COLLAR beeps
   ▼
 MOBILE APP (Expo / React Native)
     live map, fences, livestock list, alerts
```

The collar never knows where the fences are. It only asks "what is my status?"
each time it sends a position, and Supabase answers.

---

## 2. What is in this repository

| Folder | What it is | Stack | Guide |
|------|-----------|-------|--------|
| [`firmware/`](firmware/) | Collar and gateway firmware, plus one small test program per hardware part. | C++ / Arduino / PlatformIO | [firmware/README.md](firmware/README.md) |
| [`app/`](app/) | The mobile app and the Supabase database files. | Expo SDK 57 + Supabase/PostGIS | [app/README.md](app/README.md) |
| [`docs/`](docs/) | Session log and field-test plans, data, and results. | Markdown, CSV, Python | [docs/SESSION_LOG.md](docs/SESSION_LOG.md), [docs/field-tests/SUMMARY.md](docs/field-tests/SUMMARY.md) |
| [`.claude/agents/`](.claude/agents/) | Shared Claude Code helper agents for this project. | Markdown | [Section 5](#5-claude-code-agents-for-the-team) |

---

## 3. Setup, step by step

Do these in order. Each step links to the detailed guide when there is more to it.

### Step 1 — Install the tools

On your computer, install:

- [Git](https://git-scm.com/downloads)
- [Visual Studio Code](https://code.visualstudio.com/)
- The **PlatformIO IDE** extension inside VS Code (for the firmware)
- [Node.js](https://nodejs.org) — the **LTS** version (for the app)
- The USB driver for your ESP32 board (**CH340** for most clones, or **CP2102**) —
  see [firmware/README.md](firmware/README.md#1-what-you-need)

### Step 2 — Get the code

```bash
git clone https://github.com/farmtrackresearch/FARMTRACK.git
cd FARMTRACK
```

If you were told to work on a specific branch, switch to it now:

```bash
git checkout <branch-name>
```

### Step 3 — Get the shared keys from the project owner

The team shares **one** Supabase project. Ask the project owner for:

| Key | Used by | Where it goes |
|-----|---------|---------------|
| Supabase URL | app + gateway | `app/.env` and `firmware/src/secrets.h` |
| Supabase anon (publishable) key | app + gateway | `app/.env` and `firmware/src/secrets.h` |
| Gateway secret | gateway only | `firmware/src/secrets.h` |
| An app login (email + password) | you, in the app | typed into the login screen |

> **Never commit these.** `app/.env` and `firmware/src/secrets.h` are already
> git-ignored. This repository is **public**, so anything committed can be seen
> by anyone.

### Step 4 — Set up and check the database

Open the Supabase dashboard → **SQL Editor** and run these files, one at a time,
in this order:

1. [app/supabase/00_enum_values.sql](app/supabase/00_enum_values.sql)
2. [app/supabase/schema.sql](app/supabase/schema.sql) — the whole database in one
   transaction; if anything fails, nothing is changed.
3. [app/supabase/verify_setup.sql](app/supabase/verify_setup.sql) — reads only.
   Every row should say `OK` (rows marked `INFO` are just for reading). On a
   brand-new project the gateway, fence and paired-collar rows say `NONE` until
   you have registered a gateway, drawn a fence and paired a collar.
4. [app/supabase/tests/geofence_tests.sql](app/supabase/tests/geofence_tests.sql)
   — should end with `ALL TESTS PASSED`. It undoes its own test data.

Then, in **Authentication → Sign In / Providers**, turn off **Allow new users to
sign up** — team members are added from the dashboard.

Full details — registering a gateway, re-keying a collar, push notifications and
data retention — are in [app/supabase/README.md](app/supabase/README.md).

### Step 5 — Run the app

```bash
cd app
npm install
cp .env.example .env       # then open .env and paste the URL and anon key
npx expo start
```

Log in with your **email and password**. If the app has no Supabase keys it runs
in **demo mode**: the login screen shows "Continue as Admin / Staff (demo)"
buttons, a "Demo mode – not connected" notice sits at the top of every screen,
and the farm is empty. Demo mode never talks to Supabase.

For the full phone setup (development build, EAS), follow
[app/README.md](app/README.md#3-getting-started).

### Step 6 — Test each hardware part

Open the **`firmware/`** folder (not the repo root) in VS Code, then flash the
test programs one at a time: board → GPS → LoRa. Wiring tables and what "good"
output looks like are in [firmware/README.md](firmware/README.md#4-wiring).

### Step 7 — Flash the collar and the gateway

1. Copy `firmware/src/secrets.h.example` to `firmware/src/secrets.h` and fill it in.
2. Flash `gateway` on one board and `collar` on the other. **Both boards must run
   the same firmware version** (radio protocol v2) or they ignore each other.
3. The collar prints its ID at boot. A new collar registers itself the first time
   the gateway hears it and appears in the app's **Hardware** tab under
   unassigned collars — tap **Pair**. If this collar already had an older ID in
   Supabase, run [app/supabase/rekey_collar.sql](app/supabase/rekey_collar.sql)
   instead so its history is kept.

Exact steps: [firmware/README.md → Collar and gateway](firmware/README.md#7-collar-and-gateway-the-real-system).

### Step 8 — Check it works end to end

1. Take the collar outside with a clear view of the sky and wait for `fix=1` in
   its serial monitor (1–3 minutes).
2. The gateway's monitor shows each packet it receives and uploads.
3. Run `verify_setup.sql` again. The "telemetry arriving" row should show more
   than 0 fixes in the last hour.
4. In the app, the animal appears on the map.

---

## 4. What changed in this version

### Version 2.5 — full review fixes

A four-agent review found about 70 problems across the collar, gateway, database
and app. All of them are fixed in code, or listed below as something only a
person can do. The full report — every finding, what changed, and the
step-by-step runbook — is in the **FarmTrack Fix Report** artifact shared with
the team, and in [docs/SESSION_LOG.md](docs/SESSION_LOG.md).

The five critical fixes:

1. **The app no longer shows an escaped animal as safe.** Any position outside
   every fence is a breach, however far out. The app now takes each animal's
   status from the server instead of re-deciding it on the phone.
2. **The collar no longer beeps a verdict it cannot know.** It only acts on a
   reply to its own message that was backed by a GPS fix, and goes quiet after
   three cycles without one.
3. **No account can make itself admin.** New accounts are always staff, and
   users cannot change their own role.
4. **Live updates keep working after the hourly login refresh.**
5. **The public app key can no longer read animals' live positions.**

Other notable changes:

- **Radio protocol v2** ([firmware/src/packet.h](firmware/src/packet.h)) — replies
  echo the message number, carry real GPS time, and are sent IQ-inverted. **Both
  boards must be reflashed together.** The collar ID formula changed (the old one
  could repeat between collars); re-key the existing collar with
  [app/supabase/rekey_collar.sql](app/supabase/rekey_collar.sql).
- **Gateway rebuilt** — listens and uploads at the same time, batches readings
  over one kept-open secure connection with timeouts, checks Supabase's
  certificate, and recovers on its own instead of failing after ~20 minutes.
- **Watchdogs** on both boards; the collar send interval is back to **3 s**.
- **Database** — [app/supabase/schema.sql](app/supabase/schema.sql) now matches
  the live database and can be re-run safely. Alerts are raised only when an
  animal's state changes and resolve themselves; stationary and low-battery
  alerts exist; old GPS rows are thinned after 30 days. Tests in
  [app/supabase/tests/](app/supabase/tests/).
- **App** — push notifications for breaches (Android needs Firebase set up — see
  [app/README.md](app/README.md)), a working **Emergency Disable** that silences
  all collars for an hour, editing animals and pairing collars, fence buffer and
  on/off settings, honest "last data" and offline status, and no unused
  background-location permissions.
- **Field-test tools** — the log analyser handles midnight, collar reboots and the
  new log lines.

#### Needs a person (not fixable in code)

- **Hardware:** move the LoRa DIO0 wire from GPIO2 to GPIO26; replace the AMS1117
  regulator with a low-dropout one before running on a LiPo; add a battery
  voltage divider on GPIO35 (then set `BATTERY_SENSE_ENABLED 1`).
- **Accounts:** Firebase (Android push), EAS environment variables, turning off
  public sign-ups in Supabase.
- **Before any app-store upload:** real icon artwork and your own bundle ID.

#### Known issues

- Nothing in v2.5 has run on the real boards or a phone yet. The runbook's
  bench tests come first.
- Collar battery reads "unknown" until the voltage divider is fitted, so the
  low-battery alert cannot fire yet.
- The outdoor field test has not got a GPS fix yet — see
  [docs/field-tests/SUMMARY.md](docs/field-tests/SUMMARY.md).
- Supabase's PostGIS table `spatial_ref_sys` keeps its public write permission
  (only Supabase can change it). v2.5 blocks it at the API instead, with a
  request check — confirm it with the test in
  [app/supabase/README.md](app/supabase/README.md).

### Version 2.4

#### Added

- **Collar firmware** ([firmware/src/collar.cpp](firmware/src/collar.cpp)) — GPS
  fix → LoRa uplink → waits for the fence state → beeps (1 beep = warning,
  3 beeps = breach) on a buzzer on GPIO27.
- **Gateway firmware** ([firmware/src/gateway.cpp](firmware/src/gateway.cpp)) —
  receives LoRa packets, uploads them to Supabase over WiFi, and relays the fence
  state back to the collar.
- **Shared radio packet format** ([firmware/src/packet.h](firmware/src/packet.h)).
- **Credentials template** ([firmware/src/secrets.h.example](firmware/src/secrets.h.example)).
- **GPS diagnostic programs** — `gps_baud` (finds the GPS baud rate) and
  `gps_power` (shows whether the GPS keeps restarting from low power).
- **Database health check** ([app/supabase/verify_setup.sql](app/supabase/verify_setup.sql)),
  including how to register a gateway and run a test upload without hardware.
- **EAS build config** ([app/eas.json](app/eas.json)) and `expo-dev-client` for
  the Android development build.
- **Docs** — [session log](docs/SESSION_LOG.md) and the
  [field-test plans, data and results](docs/field-tests/).
- **Claude Code agents** in [.claude/agents/](.claude/agents/).

#### Changed

- **App upgraded to Expo SDK 57** (React Native 0.86, React 19.2). Run
  `npm install` again after pulling.
- **Map switched from Google Maps (`react-native-maps`) to MapLibre.** No Google
  API key needed. Old installed builds must be replaced by a new development build.
- **Sound switched from `expo-av` to `expo-audio`** for the alarm.
- **Map camera** now frames the animals and fences instead of your phone, and a
  6 m deadband stops markers jittering when an animal stands still.
- **LoRa link hardened** — payload CRC turned on, spreading factor 7 → 9 for more
  range, and a private sync word (`0xF3`) so other LoRa devices are ignored.
  Collar and gateway **must both** run the new firmware.
- **GPS must be powered from VIN (5 V), not 3V3.** On 3V3 it kept restarting.
- **GPIO2 (the blue LED) is left alone** in the collar, gateway and GPS test,
  because on the current hardware the LoRa DIO0 wire is on GPIO2.
- **Collar send interval was temporarily 30 s** for diagnosis (back to 3 s in v2.5).

#### Removed

- `firmware/TEST CODES /gps.cpp` — an old draft that was never built.
- `react-native-maps` and `expo-av` from the app.

#### Ignored (never committed)

- `app/.env`, `firmware/src/secrets.h` — real keys.
- `firmware/logs/` — raw serial-monitor captures.
- `.vscode/c_cpp_properties.json` and friends — machine-specific paths.
- `docs/*.pdf` — manuscript drafts (repo is public; share them on the group drive).
- Everything under `.claude/` **except** `.claude/agents/`.

---

## 5. Claude Code agents for the team

If you use [Claude Code](https://claude.com/claude-code), the agents in
[.claude/agents/](.claude/agents/) load automatically when you open this repo.
Each one already knows its part of FarmTrack.

| Agent | Use it for |
|-------|------------|
| `gps-collar-firmware` | Collar, gateway, `packet.h`, `pins.h`, PlatformIO environments |
| `mobile-app-reviewer` | The Expo app, maps, notifications, dev builds |
| `supabase-data` | Database, gateway ingest, geofence trigger, RLS |
| `debugger` | Anything broken — paste the exact error or serial output |
| `code-reviewer` | Reviewing changes before you commit |
| `reliability-engineer` | Crashes, memory, power, flaky GPS/LoRa/WiFi |
| `field-test-planner` | Planning field tests and analyzing their data |
| `manuscript-writer` | Drafting capstone manuscript sections |
| `session-logger` | Adding an entry to `docs/SESSION_LOG.md` at the end of a session |

Ask for one by name, for example: *"use the debugger agent — the gateway prints
`HTTP -11`"*.

---

## 6. Hardware overview and safety

| Part | Model | Job |
|------|------|------|
| Microcontroller | ESP32 DevKit v1 (30-pin) | Runs the collar or gateway program |
| GPS | NEO-6M + antenna | Position fix (needs open sky) |
| Radio | SX1278 LoRa, 433 MHz + antenna | Collar ↔ gateway link |
| Buzzer | Piezo buzzer (collar only) | Warning / breach beeps |

**Safety:**

- Power the SX1278 from **3.3 V only** — 5 V destroys it.
- **Always attach the LoRa antenna before powering the board.**
- Power the GPS from **VIN (5 V)**.
- Use a LoRa frequency that is legal in your country.

Full wiring: [firmware/README.md](firmware/README.md#4-wiring).

---

## 7. License

MIT — see [LICENSE](LICENSE).

When operating the LoRa radio you are responsible for complying with the
radio-spectrum regulations in your country (frequency band, duty cycle, and
transmit power).
