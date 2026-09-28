# FarmTrack v2.6 — Team Guide

Everything the team needs to know about FarmTrack v2.6: what changed and why,
how the system works now, how to set it up and run it, how to test it, what
went wrong on the bench and how we fixed it, and what is still open.

- **Who it's for:** the capstone team — anyone who needs to set up, run, test
  or troubleshoot FarmTrack.
- **Covers:** the whole v2.6 work session, 25–28 September 2026.
- **Git:** branch `FARMTRACK-v2.6/firmware-gateway-collar-application-efficient-operation-ui-redesign-fixes`,
  commit `e7d4b08` (pushed to GitHub).
- **Web version:** [FarmTrack Team Guide](https://claude.ai/artifact/GKdMp66KLMCbEYyWzoDjcn) (same content, with copy
  buttons and a searchable troubleshooting table).
- **Related:** the [FarmTrack Fix Report](https://claude.ai/artifact/XUd3F1qsDYRnk9gJUxKNdi)
  (every finding and fix), [docs/SESSION_LOG.md](SESSION_LOG.md) (detailed
  session record), and the READMEs in [firmware/](../firmware/README.md),
  [app/](../app/README.md) and [app/supabase/](../app/supabase/README.md).

---

## Contents

1. [The short version](#1-the-short-version)
2. [How FarmTrack works now](#2-how-farmtrack-works-now)
3. [What happened in this session](#3-what-happened-in-this-session)
4. [Set up FarmTrack from scratch](#4-set-up-farmtrack-from-scratch)
5. [Everyday commands](#5-everyday-commands)
6. [How to test it](#6-how-to-test-it)
7. [Troubleshooting](#7-troubleshooting)
8. [Accounts and roles](#8-accounts-and-roles)
9. [Measured results so far](#9-measured-results-so-far)
10. [What's still open](#10-whats-still-open)
11. [Where to find things](#11-where-to-find-things)
12. [Glossary](#12-glossary)

---

## 1. The short version

A review of the whole project — collar, gateway, database and app — found 90
problems, including five critical ones: the app showed an escaped animal as
safe, the collar beeped BREACH with no GPS fix, any user could make themselves
admin, live updates died after an hour, and the public app key could read
every animal's position. All of them are fixed, deployed and tested on the
bench and on a real phone. The app was then redesigned, and the first outdoor
GPS test was run.

| Part | Status |
|---|---|
| Database (Supabase) | ✅ Updated, all tests passed on the live database |
| Gateway | ✅ Flashed with v2.6, ran over an hour with no errors or memory growth |
| Collar | ✅ Flashed with v2.6 and re-keyed (new ID `FT-F0FDEC82`, history kept) |
| Phone app | ✅ New development build installed; push notifications work on a locked phone |
| App design | ✅ "Refined pasture" redesign, new icon and splash |
| Outdoor GPS fix | ❌ Not yet — the GPS reached 3 satellites; the collar needs 4 |
| Hardware changes | ⏳ Pending (see [section 10](#10-whats-still-open)) |
| Git | ✅ Committed and pushed (`e7d4b08`); this guide and the firmware README cheat sheet still to commit |

---

## 2. How FarmTrack works now

### The loop

```
COLLAR ──LoRa──► GATEWAY ──WiFi/HTTPS──► SUPABASE ──realtime + push──► PHONE APP
   ▲                 │                       │
   └────LoRa reply───┘◄──── fence state ─────┘
```

1. Every ~3 seconds the **collar** sends one radio message: its ID, a message
   number (`seq`), its GPS position if it has a trustworthy fix, and health
   flags.
2. The **gateway** hears it, uploads it to **Supabase**, and gets back the
   animal's fence state.
3. The gateway radios that state back to the collar. The collar beeps only if
   the reply answers the message it just sent **and** that message had a GPS
   fix.
4. Supabase decides the fence state, writes alerts, and the **app** updates
   live. Breaches, low battery and "not moving" also send a **push
   notification** to phones.

### The rules that matter

| Rule | What it means in practice |
|---|---|
| **Breach** = outside every active fence | At any distance. 5 km outside is still a breach. |
| **Warning** = inside, but near the edge | Within that fence's warning distance, measured against the fence the animal is deepest inside. |
| **3 m margin** | To leave "breach" an animal must be 3 m inside; to leave "warning" it must be 3 m past the warning distance. Stops flapping at the fence line. |
| **No fix, no beep** | The collar ignores any verdict while it has no GPS fix, and goes silent after 3 cycles without a fix-backed reply. |
| **Server answers SAFE** when… | collars are muted (Emergency Disable), the newest reading has no fix, or the newest fix is over 60 s old. |
| **A fix needs** | at least 4 satellites and good accuracy (HDOP 5 or better). A 3-satellite fix is ignored on purpose — its position can be tens of metres off. |
| **Alerts** | Created only when a state changes, and resolved automatically when it changes back. |
| **Emergency Disable** | Silences every collar for 60 minutes. Any signed-in user can use it. |

### Radio message format (protocol v2)

Collar and gateway **must both run v2** — a v1 board and a v2 board ignore
each other.

**Uplink (collar → gateway), 21 bytes**

| Bytes | Field | Meaning |
|---|---|---|
| 0 | version | 2 |
| 1–4 | deviceId | shown as `FT-XXXXXXXX` (chip-unique) |
| 5–6 | seq | message number; restarts at 0 on reboot |
| 7–10 | gpsEpoch | time of the fix, or 0 |
| 11–18 | lat, lng | ×10⁷; 0 without a fix |
| 19 | battery | 0–100 %, or 255 = unknown (no sensor yet) |
| 20 | flags | fix · satellites used · GPS data flowing · GPS restarted |

**Reply (gateway → collar), 8 bytes:** version, deviceId, seq (echo), state
(0 safe · 1 warning · 2 breach).

**Radio settings:** 433 MHz · SF9 · 125 kHz · CRC on · sync word 0xF3 ·
17 dBm (`LORA_TX_DBM`) · normal IQ both ways.

---

## 3. What happened in this session

### 3.1 The review (25 Sep)

Four specialist agents reviewed the project — whole system, firmware,
database and app — and found about 70 problems. Later checks brought the total
to 90. The five critical ones:

1. The app showed an animal more than the warning distance outside the fence
   as "grazing" and turned off its alarm.
2. The collar beeped BREACH for about two hours with no GPS fix (all 968
   replies in the 24 Sep log were BREACH while every uplink had `fix=0`).
3. Any signed-in user could make themselves admin (in the repo's schema; the
   live database had been fixed by hand).
4. The app's live updates silently stopped after the hourly login refresh.
5. The public app key could read every animal's live position.

### 3.2 The fixes (25–27 Sep)

A plan was agreed with one shared "contract" (protocol v2, fence rules,
database interface) so every part matched. Agents worked in parallel, one per
folder, then code-reviewer (three passes) and reliability-engineer checked the
work. Highlights:

- **Collar:** acts only on fix-backed replies to its own message; watchdog;
  chip-unique ID; GPS read during every wait; fix needs 4 satellites; 3 s send
  interval with jitter; battery "unknown" until a sensor is fitted.
- **Gateway:** rebuilt as two tasks — the radio never stops listening while
  uploads run; one kept-open, certificate-checked connection with timeouts;
  batching and a 256-reading queue; recovers on its own instead of failing
  after ~20 minutes.
- **Database:** `schema.sql` rebuilt from an export of the live database and
  re-runnable; new upload function; rewritten fence trigger; security fixes;
  push notifications; Emergency Disable; old GPS rows thinned after 30 days; a
  self-cleaning test suite.
- **App:** animal status comes from the server; live updates survive login
  refreshes; push notifications; errors shown instead of hidden; many small
  fixes.

### 3.3 Deploying the database (27 Sep)

1. Exported the live database's structure with a read-only query
   (`app/supabase/export_live_schema.sql`). It showed things the repo didn't
   know: the live upload function dropped readings from unknown collars and
   stored a missing battery as 0 %, and users couldn't resolve alerts.
2. Ran `00_enum_values.sql` → `schema.sql` → `verify_setup.sql` →
   `tests/geofence_tests.sql`: **ALL TESTS PASSED** on the live database.
3. Turned off public sign-ups.
4. Checked the API guard with `curl`: both the normal and the percent-encoded
   attempt were refused (HTTP 401), and the gateway's path still works.
5. Cleared Bessie's stuck breach from before the fixes.

### 3.4 Flashing and bench bring-up (27 Sep)

Gateway first, then collar. The collar printed its new ID `FT-F0FDEC82`, and
`rekey_collar.sql` moved Bessie's 1009 positions and 18 alerts onto it.

Then a chain of problems, all traced to **loose jumper wires on the collar's
radio**:

| What we saw | What it really was | How we found it |
|---|---|---|
| Collar printed "TX" every cycle, gateway heard nothing | The send routine reported "sent" even when nothing went out, hiding the fault | Switched to the library's standard "send and wait" |
| Collar restarted by its watchdog every ~30 s | The radio could never finish a send | `lora_tx` got stuck too |
| Radio reset at 17 dBm, fine at 2 dBm, then stopped answering | A poor contact on the radio's power wires | New `lora_diag` program; re-seating the wires fixed it |
| Gateway sent replies, collar heard nothing | The collar's receiver had a loose wire | Pushing a jumper in deeper fixed it |

After that, the full loop worked: the gateway heard every message (signal −38,
SNR ~12 on the bench), uploads took ~0.2 s, and the collar received each reply
and ignored it because it had no GPS fix indoors — the buzzer stayed silent,
exactly as designed.

**Lesson:** push-on jumper wires work loose. Solder the collar's radio
connections (or use locking connectors) before it goes on an animal.

### 3.5 The phone app (27 Sep)

1. `npm install`.
2. Stored the three app keys in Expo for cloud builds (`eas env:set`).
3. Created the Firebase project `farmtrack-3516f`, added
   `app/google-services.json` (git-ignored) and gave it to cloud builds.
4. Uploaded Firebase's FCM V1 key to Expo (`eas credentials`).
5. Built and installed a new development build.
6. **Tests:** a simulated breach sent a push notification to a **locked
   phone** within seconds; moving Bessie back inside cleared the alarm by
   itself; Emergency Disable showed its banner; the gateway ran over an hour
   with every upload succeeding and no memory growth.

### 3.6 The redesign (27–28 Sep)

The app got a "Refined pasture" look: cream background, meadow green, a
hay-gold accent, one type scale (Poppins), one spacing scale, and shared
building blocks (headers, cards, buttons, notices, bottom sheets) on every
screen. Overlaps were fixed everywhere — on the map, notices, controls, legend
and fence panels each have their own space. New app icon and splash: a
location pin with a small pasture scene. Code-reviewer then found seven items
(for example "Acknowledge all" for several breaches, and a form sheet that
could hide the alarm), all fixed. A development-only red error about a
notification sound named `'default'` was also fixed.

### 3.7 The first outdoor GPS test (28 Sep)

The collar went outside on a power bank; the gateway logged everything on the
iMac.

| Time | GPS |
|---|---|
| 20:15–20:25 | Searching — 0 satellites in use |
| 20:26 onward | **3 satellites** — the GPS LED started blinking |
| 20:46 (last check) | Still 3 — no fourth |

Because the collar needs 4 satellites for a trustworthy position, it sent no
position, and the app correctly kept showing Bessie as a hollow "no fix"
ring. The radio link held the whole time (signal −82 to −96, good). A 20-second
internet hiccup at 20:30 recovered on its own.

**Why it's slow:** a "cold" GPS has to find each satellite and download its
orbit data at 50 bits per second (~30 s per satellite, and any glitch restarts
it). A small antenna, a partly blocked sky and electrical noise make that
slower. See [section 10](#10-whats-still-open) for what to try next.

---

## 4. Set up FarmTrack from scratch

Do these in order. Details are in each folder's README.

**Database** (Supabase → SQL Editor, one file per tab)
1. `app/supabase/00_enum_values.sql`
2. `app/supabase/schema.sql` — if asked about a destructive operation or RLS,
   click **Run** / **Run without RLS**
3. `app/supabase/verify_setup.sql` — every row OK or INFO
4. `app/supabase/tests/geofence_tests.sql` — **ALL TESTS PASSED**
5. Authentication → Sign In / Providers → turn off **Allow new users to sign up**
6. Register the gateway (see `app/supabase/README.md`)

**Boards** (see [section 5](#5-everyday-commands) for the exact commands)
1. Copy `firmware/src/secrets.h.example` to `secrets.h` and fill it in
2. Flash `gateway`, then `collar`
3. A new collar registers itself — pair it in the app's **Hardware** tab.
   A collar that had a v1 ID: run `app/supabase/rekey_collar.sql` instead

**App**
1. `cd app && npm install`
2. Copy `.env.example` to `.env` and fill in the keys
3. For cloud builds: `eas env:set` for the three `EXPO_PUBLIC_*` keys and
   `GOOGLE_SERVICES_JSON` (see `app/README.md`)
4. Firebase: `app/google-services.json` + FCM V1 key via `eas credentials`
5. `npx eas-cli build --profile development --platform android`, install on
   the phone, then `npx expo start` and sign in

---

## 5. Everyday commands

Run from the `firmware` folder. The gateway has been on `…-1120` and the
collar on `…-1130` on the team iMac — check with `ls /dev/cu.usbserial*`.
Press **Ctrl+C** to stop watching; the board keeps running.

**Flashing** means copying a program into the board's memory. You only flash
when the code changes. Once flashed, a board runs its program whenever it has
power — a USB charger or power bank is enough.

```bash
# Go to the firmware folder (run this first)
cd "/Users/kingdarius1874/FARMTRACK v2.4/firmware"

# Which boards are plugged in? (one port per board)
ls /dev/cu.usbserial*

# GATEWAY: install and watch
~/.platformio/penv/bin/pio run -e gateway -t upload -t monitor --upload-port /dev/cu.usbserial-1120 --monitor-port /dev/cu.usbserial-1120

# COLLAR: install and watch
~/.platformio/penv/bin/pio run -e collar -t upload -t monitor --upload-port /dev/cu.usbserial-1130 --monitor-port /dev/cu.usbserial-1130

# GATEWAY: just watch
~/.platformio/penv/bin/pio device monitor --port /dev/cu.usbserial-1120 --baud 115200

# COLLAR: just watch
~/.platformio/penv/bin/pio device monitor --port /dev/cu.usbserial-1130 --baud 115200

# FIELD TEST: watch the gateway and save a log (lands in firmware/logs/logs/)
cd "/Users/kingdarius1874/FARMTRACK v2.4/firmware/logs" && ~/.platformio/penv/bin/pio device monitor --port /dev/cu.usbserial-1120 --baud 115200 -f time -f log2file

# Summarise a saved gateway log
python3 "/Users/kingdarius1874/FARMTRACK v2.4/docs/field-tests/scripts/analyze_gateway_log.py" <path-to-log-file>

# Check the code builds (no board needed)
~/.platformio/penv/bin/pio run -e collar -e gateway

# Start the app's dev server (phone and Mac on the same WiFi)
cd "/Users/kingdarius1874/FARMTRACK v2.4/app" && npx expo start
```

Hardware test programs (`esp32`, `gps`, `gps_baud`, `gps_power`, `lora_tx`,
`lora_rx`, `lora_diag`, `lora_listen`) use the same `pio run -e <name> …`
form; the full labelled list is in
[firmware/README.md → Command cheat sheet](../firmware/README.md#command-cheat-sheet).
Each one replaces the board's program, so flash `gateway`/`collar` again
afterwards.

---

## 6. How to test it

### Bench test (both boards on the desk)

| Watch | Expect |
|---|---|
| Gateway | `RX from F0FDEC82 seq=…` every ~3 s, then `upload ok … ms=…` (under ~1000 after the first) and `TX reply state=… seq=…` |
| Collar (indoors, no fix) | `TX seq=N fix=0 …`, `RX state=0 seq=N`, `reply ignored: this uplink had no usable fix` — buzzer silent |
| Gateway, 30+ min | `heap=` and `maxblk=` stay flat; no `reply late`; `reset reason:` never `TASK_WDT` or `BROWNOUT` |

The first upload after the gateway boots takes ~4 s (secure-connection setup)
and its reply is skipped as "late" — that's normal, once.

### Test the alarm without hardware

In the Supabase SQL Editor (click **Run without RLS** if asked — it creates no
tables). Full SQL in `app/supabase/README.md` → "Test the alarm without
hardware".

1. **Block A** puts Bessie inside the fence → she shows grazing.
2. **Block B** (phone locked) moves her 40 m outside → push notification,
   red marker, siren.
3. **Block A** again → the alarm stops and the alert resolves itself.

### Outdoor GPS / field test

1. Start the **field-test log** command on the Mac (section 5).
2. Collar on a power bank, in the **most open spot** you can — away from
   walls, the roof edge and trees — antenna facing up. Don't move it.
3. The GPS LED **blinking once a second** = it has a fix (maybe only 3
   satellites).
4. In the app, the hollow "no fix" ring turns into a **solid dot** once the
   collar has 4 satellites. Colour: green inside, amber near the edge, red
   outside.
5. If the spot is outside the fence, expect the real breach behaviour: 3 beeps
   every few seconds, phone alarm and push.
6. Afterwards, run the log summary command on the saved log.

---

## 7. Troubleshooting

| You see | It means | Do this |
|---|---|---|
| Gateway: nothing heard, collar prints `TX seq=…` | The collar's radio isn't really sending — usually a loose wire | Flash `lora_diag` on the collar; re-seat the radio's VCC/GND wires |
| Collar: `reset reason: TASK_WDT`, no `TX seq=` lines | The radio can't finish a send | Same as above |
| Collar: `no reply from gateway` while the gateway prints `TX reply` | The collar's receiver isn't hearing | Re-seat the radio wires and check its antenna; `lora_listen` shows what it hears |
| Collar makes a low buzzing/rattle | It's restarting over and over (a click per boot) — power or wiring | Check the gateway log: `seq` dropping back to 0 confirms it |
| One beep every ~3 s | Warning: near the fence edge (with a GPS fix) | Expected |
| Three beeps every ~3 s | Breach: outside the fence (with a GPS fix) | Expected; Emergency Disable silences collars for 1 h |
| GPS LED blinks, map still shows "no fix" | Only 3 satellites; the collar needs 4 | Wait, or move to a more open spot |
| Hollow ring "· no fix" on the map | No GPS fix from that collar in the last 3 minutes | Normal indoors or while searching |
| Monitor shows gibberish | Wrong speed (9600 instead of 115200) | Add `--baud 115200` |
| `could not open port …-1130` | That board isn't plugged in (or is in another socket) | `ls /dev/cu.usbserial*` |
| `Got unexpected extra argument (-)` / `command not found: -port` | The command was split across two lines | Paste it as one line |
| VS Code terminal shows only a few letters | VS Code display glitch; the programs are fine | Cmd+Shift+P → **Reload Window** |
| Gateway: `reply late, skipped` once after boot | First secure connection takes ~4 s | Normal |
| Gateway: a few `upload failed, HTTP -1` then `upload ok` | Internet hiccup; it recovered | Nothing |
| Supabase: "creates tables without enabling RLS" | False alarm for our test/insert SQL | **Run without RLS** |
| Supabase: "destructive operation" | `schema.sql` replaces views/policies; keeps data | **Run** |
| Red box "Custom sound 'default' not found" | Development-only warning (fixed in v2.6) | Reload the app |
| Grey gear button over the map | The development build's tools button | Ignore; not in the real app |

---

## 8. Accounts and roles

- **Add someone:** Supabase → Authentication → Users → **Add user** (sign-ups
  are off). Everyone starts as **staff**.
- **Make someone admin** (SQL Editor):

  ```sql
  UPDATE public.profiles SET role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'person@example.com');
  ```

  Use `'staff'` to change them back. They see the change after signing out
  and in again.
- **List everyone:**

  ```sql
  SELECT u.email, p.full_name, p.role
  FROM public.profiles p JOIN auth.users u ON u.id = p.id
  ORDER BY p.role, u.email;
  ```

| | Staff | Admin |
|---|---|---|
| See map, animals, alerts, collars | ✓ | ✓ |
| Resolve alerts, Emergency Disable | ✓ | ✓ |
| Draw, edit or delete fences | ✗ | ✓ |
| Add, edit or delete animals, pair collars | ✗ | ✓ |

---

## 9. Measured results so far

These are bench and first-test observations, not field-test results for the
manuscript — those go in [docs/field-tests/SUMMARY.md](field-tests/SUMMARY.md)
only when measured under a written protocol.

| What | Result |
|---|---|
| Database tests on the live project | ALL TESTS PASSED |
| API guard (`curl`) | HTTP 401 for both attempts |
| Bench radio link (~30 cm) | RSSI −38 to −42, SNR 10.5–13.8 |
| Outdoor radio link (yard) | RSSI −82 to −96, uploads kept working |
| Upload time after the first | ~0.2 s typical, slowest ~1.2 s |
| Gateway soak | 1 h+, 1,500+ messages, no failures, largest free memory block unchanged |
| Push to a locked phone | Within seconds of a simulated breach |
| First outdoor GPS test | 11 min searching, then 3 satellites for 20+ min; no 4-satellite fix |

---

## 10. What's still open

In the order we'd tackle them:

1. **Commit this guide** and the firmware README cheat sheet:

   ```bash
   cd "/Users/kingdarius1874/FARMTRACK v2.4"
   git add docs/FARMTRACK_V2.6_TEAM_GUIDE.md firmware/README.md README.md
   git commit -m "Add v2.6 team guide and firmware command cheat sheet"
   git push
   ```

2. **Get a GPS fix outdoors.** Try the most open spot available first. Then,
   if needed: check the NEO-6M's backup battery (a working one turns most
   start-ups into 1–5 s hot starts), keep the GPS antenna a hand's width from
   the LoRa antenna and away from the ESP32, and consider a larger or active
   GPS antenna.
3. **Make the collar's radio wiring permanent** (solder or locking
   connectors). It worked loose twice.
4. **Hardware:** move the LoRa DIO0 wire from GPIO2 to GPIO26 (both boards);
   replace the AMS1117 with a low-dropout regulator before running on a LiPo;
   add a battery divider on GPIO35 and set `BATTERY_SENSE_ENABLED 1`.
5. **Check live updates past one hour** with the app left open.
6. **Before any app-store upload:** choose your own bundle ID (changing it also
   needs a new Firebase Android app entry and a new build).
7. Smaller known items: the buzzer clicks once at every boot; 17 npm audit
   findings in dependencies; farm coordinates in public git history.

---

## 11. Where to find things

| What | Where |
|---|---|
| This guide as a web page | [FarmTrack Team Guide](https://claude.ai/artifact/GKdMp66KLMCbEYyWzoDjcn) |
| Every finding and fix, runbook | [FarmTrack Fix Report](https://claude.ai/artifact/XUd3F1qsDYRnk9gJUxKNdi) |
| Detailed session record | [docs/SESSION_LOG.md](SESSION_LOG.md) |
| Firmware: wiring, flashing, commands, log lines | [firmware/README.md](../firmware/README.md) |
| App: setup, push, EAS, demo mode | [app/README.md](../app/README.md) |
| Database: install, roles, re-key, alarm test | [app/supabase/README.md](../app/supabase/README.md) |
| Field-test plans and results | [docs/field-tests/](field-tests/) |
| Saved gateway logs | `firmware/logs/` (git-ignored) |

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Flash** | Copy a program into the board's memory over USB |
| **Uplink / reply** | A radio message from collar to gateway / from gateway back to the collar |
| **seq** | The collar's message number; replies echo it |
| **Fix** | A GPS position the collar trusts: 4+ satellites, HDOP ≤ 5 |
| **HDOP** | GPS accuracy estimate; lower is better |
| **RSSI / SNR** | Radio signal strength / how far above the noise it is |
| **SF9** | LoRa spreading factor 9 — slower but longer range than the default SF7 |
| **Watchdog** | Restarts a board that stops responding |
| **RLS** | Row Level Security — database rules for who may read or change which rows |
| **Realtime** | Supabase's live feed that keeps the app up to date |
| **Push notification** | An alert delivered to a phone even when the app is closed |
| **EAS** | Expo's cloud service that builds the app |
| **FCM** | Firebase Cloud Messaging — Google's service that delivers Android push |
| **Development build** | The test version of the app that loads code from your Mac |
