# FarmTrack — Firmware

> Part of the [FarmTrack](../README.md) project. The mobile app and database live
> in [`../app`](../app).

Firmware for the two ESP32 boards in FarmTrack:

- **Collar** — worn by the animal. Reads GPS, sends the position over LoRa, and
  beeps when the animal is near or past a fence.
- **Gateway** — stays near WiFi. Receives the collar's LoRa packets, uploads them
  to Supabase, and sends the fence state back to the collar.

There are also **small test programs**, one per hardware part. Run them first to
prove each part works before you flash the collar and gateway.

> **Protocol v2.** This version changes the radio message format. The collar and
> the gateway **must both be flashed with this version** — a board on the old
> firmware ignores the other's packets. See [section 7](#7-collar-and-gateway-the-real-system).

## Contents

1. [What you need](#1-what-you-need)
2. [Open the project](#2-open-the-project)
3. [The programs (environments)](#3-the-programs-environments)
4. [Wiring](#4-wiring)
5. [How to flash and watch output](#5-how-to-flash-and-watch-output)
6. [Test each part, step by step](#6-test-each-part-step-by-step)
7. [Collar and gateway (the real system)](#7-collar-and-gateway-the-real-system)
8. [What changed in this version](#8-what-changed-in-this-version)
9. [Folder layout](#9-folder-layout)
10. [Troubleshooting](#10-troubleshooting)
11. [License](#11-license)

---

## 1. What you need

### Hardware

| Part | Notes |
|------|-------|
| 2× ESP32 DevKit v1 (30-pin) | One for the collar, one for the gateway. Most CH340 clones work. |
| NEO-6M GPS module + antenna | Collar only. Needs open sky to get a fix. |
| 2× SX1278 LoRa module, 433 MHz (Ra-01 / Ra-02) | One per board. |
| 2× 433 MHz LoRa antenna | **Attach before powering.** |
| Piezo buzzer | Collar only. |
| Jumper wires, 2× USB **data** cables | Charge-only cables will not work. |
| *Later:* 2× 100 kΩ resistor + 100 nF capacitor | Battery voltage sensing on the collar ([section 4](#battery-sense-collar-optional)). |
| *Later:* low-dropout 3.3 V regulator (RT9080 or ME6211 class, ≥ 500 mA) | Needed to run the collar from a LiPo ([section 4](#power-running-from-a-lipo)). |

### Software

1. [Visual Studio Code](https://code.visualstudio.com/).
2. The **PlatformIO IDE** extension in VS Code (Extensions panel → search
   "PlatformIO IDE" → Install). Do **not** install the "pioarduino" extension —
   it clashes with PlatformIO.
3. The USB driver for your board's USB chip:
   - **CH340 / CH341** (most clones) → the WCH CH340 driver.
   - **CP2102** → the Silicon Labs CP210x driver.

PlatformIO downloads the ESP32 toolchain and all libraries by itself on the first
build (this takes a few minutes the first time). Every version is pinned in
[platformio.ini](platformio.ini), so everyone builds the same thing:

| Component | Version | Used for |
|-----------|---------|----------|
| `espressif32` platform | 7.1.0 (Arduino core 2.0.17) | ESP32 toolchain and framework |
| `mikalhart/TinyGPSPlus` | 1.1.0 | reading GPS data |
| `sandeepmistry/LoRa` | 0.8.0 | driving the SX1278 |
| `bblanchon/ArduinoJson` | 7.4.3 | the gateway's upload message |

---

## 2. Open the project

1. Get the code (see the [main README](../README.md#step-2--get-the-code)).
2. In VS Code: **File → Open Folder… → pick the `firmware/` folder.**
   Open `firmware/`, not the repo root, or PlatformIO will not find the project.
3. Wait for PlatformIO to finish loading (bottom status bar).

**Red squiggles on `#include` lines?** That is only the editor. Fix it with (from
inside `firmware/`):

```bash
pio project init --ide vscode -e collar
```

The files it creates are machine-specific and git-ignored — every person makes
their own.

---

## 3. The programs (environments)

Each program is a PlatformIO **environment**. Only one `.cpp` file is built per
environment.

| Environment | What it does | Source |
|-------------|--------------|--------|
| `esp32`     | Board check: serial output + board info | [src/test_esp32.cpp](src/test_esp32.cpp) |
| `gps`       | GPS check: satellites and fix | [src/test_gps.cpp](src/test_gps.cpp) |
| `lora_tx`   | LoRa test sender (real link settings) | [src/test_lora_tx.cpp](src/test_lora_tx.cpp) |
| `lora_rx`   | LoRa test receiver (real link settings) | [src/test_lora_rx.cpp](src/test_lora_rx.cpp) |
| `gps_baud`  | Diagnostic: finds which baud rate the GPS talks at | [src/test_gps_baud.cpp](src/test_gps_baud.cpp) |
| `gps_power` | Diagnostic: shows if the GPS keeps restarting from low power | [src/test_gps_power.cpp](src/test_gps_power.cpp) |
| `lora_diag` | Diagnostic: the radio starts but a send never finishes — tries every power level and shows whether the radio chip resets mid-send | [src/test_lora_diag.cpp](src/test_lora_diag.cpp) |
| `lora_listen` | Diagnostic: the radio sends but never hears — reports good packets, corrupted packets and the strongest signal sensed | [src/test_lora_listen.cpp](src/test_lora_listen.cpp) |
| **`collar`**  | **The real collar program** | [src/collar.cpp](src/collar.cpp) |
| **`gateway`** | **The real gateway program** | [src/gateway.cpp](src/gateway.cpp) |

Shared files:

| File | What is in it |
|------|---------------|
| [src/pins.h](src/pins.h) | Every pin number, the radio settings, the battery-sense switch |
| [src/packet.h](src/packet.h) | The radio message format (protocol v2) |
| [src/lora_link.h](src/lora_link.h) | Starts the radio with the shared settings; sends one packet and waits until it is out |
| [src/reset_reason.h](src/reset_reason.h) | Prints why the board last restarted |
| [src/supabase_ca.h](src/supabase_ca.h) | The certificates the gateway uses to check it is really talking to Supabase |

---

## 4. Wiring

All pin numbers live in [src/pins.h](src/pins.h). Wire to match it.

### NEO-6M GPS → ESP32 (collar)

| GPS pin | ESP32 pin |
|---------|-----------|
| VCC | **VIN (5 V)** — not 3V3 |
| GND | GND |
| TX  | GPIO16 |
| RX  | GPIO17 |

> On 3V3 the GPS does not get enough power and restarts over and over, so it
> never gets a fix. Always use VIN.

### SX1278 LoRa → ESP32 (collar **and** gateway)

| LoRa pin | ESP32 pin |
|----------|-----------|
| VCC  | **3V3 only — never 5 V** |
| GND  | GND |
| SCK  | GPIO18 |
| MISO | GPIO19 |
| MOSI | GPIO23 |
| NSS  | GPIO5 |
| RST  | GPIO14 |
| DIO0 | GPIO26 |

> **Current prototype: DIO0 is on GPIO2.** On the team's existing boards the
> DIO0 wire goes to **GPIO2** (the blue LED pin) instead of GPIO26.
>
> - **It still works.** The firmware talks to the radio over SPI only and never
>   reads DIO0.
> - **But GPIO2 must never be an output.** If the ESP32 drives GPIO2 while the
>   radio drives DIO0, two outputs fight each other and pull down the 3.3 V
>   supply. Every program in this folder now keeps GPIO2 as an input, so the
>   blue LED never blinks.
> - **The fix:** with the board unplugged, move the DIO0 jumper from GPIO2 to
>   GPIO26 on both boards. No firmware change is needed. GPIO2 is also a
>   boot-mode pin, so moving DIO0 off it removes a possible cause of
>   "Connecting…" upload failures.

> **Loose jumper wires stopped the collar's radio on 27 Sep 2026.** A poor
> contact on the radio's wires made it reset every time it sent at full power,
> then stop answering, and later hear nothing at all; firmly re-seating the
> wires fixed each one. `lora_diag` and `lora_listen` (section 3) show these
> faults in seconds. Before the collar goes on an animal, solder these
> connections or use proper locking connectors — a collar moves, and push-on
> jumpers work loose.

### Piezo buzzer → ESP32 (collar)

| Buzzer | ESP32 pin |
|--------|-----------|
| + | GPIO27 |
| − | GND |

### Battery sense (collar, optional)

Without this, the collar reports battery as **unknown** (255 on the radio,
empty in the app). To measure the LiPo:

```
LiPo +  ──[100 kΩ]──┬── GPIO35
                    ├──[100 kΩ]── GND
                    └──[100 nF]── GND
```

Then set `BATTERY_SENSE_ENABLED` to `1` in [src/pins.h](src/pins.h) and re-flash
the collar. If you use different resistors, set `BATTERY_DIVIDER_RATIO` to
(top + bottom) ÷ bottom. Do **not** enable it without the resistors — a
floating pin reads random numbers.

### Power: running from a LiPo

The planned battery setup (3.7 V LiPo → TP4056 charger → **AMS1117** regulator)
**cannot give a steady 3.3 V**. The AMS1117 needs its input about 1.1 V above
its output, which means at least 4.4 V. A LiPo is 4.2 V when full and about
3.7 V for most of its life, so the 3.3 V rail sags, and sags further every time
the radio transmits (about 87 mA). That is the same kind of brown-out that
already made the GPS restart.

- **Until the regulator is replaced, run the collar from USB power.**
- **Replace it with a low-dropout regulator** (RT9080 or ME6211 class, rated
  500 mA or more). These need only about 0.1–0.25 V of headroom, so they give
  3.3 V down to roughly 3.5 V of battery.

### On the board (no wiring)

- GPIO0 — BOOT button, used to stop / resume the test programs.

### ⚠ Safety

- The SX1278 takes **3.3 V only**. 5 V destroys it.
- **Attach the antenna before powering the board.** Transmitting without one can
  burn out the radio.
- The code uses **433 MHz** (`LORA_FREQ_HZ` in `pins.h`). Make sure that is legal
  where you are and matches your module and antenna.

---

## 5. How to flash and watch output

### In VS Code (easiest)

1. Plug the board in by USB.
2. Click the environment name in the bottom status bar (e.g. `env:esp32`) and
   pick the one you want.
3. Click **→ Upload** (arrow icon) in the bottom bar.
4. Click **🔌 Serial Monitor** (plug icon) to see the output.

### From the terminal (inside `firmware/`)

```bash
pio run -e <environment> -t upload -t monitor
```

For example `pio run -e gps -t upload -t monitor`.

If PlatformIO picks the wrong board, name the port:

```bash
pio device list                                   # shows the ports
pio run -e gps -t upload --upload-port /dev/cu.usbserial-XXXX   # macOS
pio run -e gps -t upload --upload-port COM5                     # Windows
```

### Collar and gateway on one computer

- **`pio` not found?** In a plain terminal (not the PlatformIO one in VS Code),
  use the full path: `~/.platformio/penv/bin/pio`.
- **Each board has its own USB port.** List them with
  `ls /dev/cu.usbserial*` (or `pio device list`). A port name belongs to the
  USB socket, so it can change if you plug into a different one.
- **Flash and watch each board in its own terminal** (replace the ports with
  yours):

  ```bash
  cd firmware
  # terminal 1 - gateway
  pio run -e gateway -t upload -t monitor --upload-port /dev/cu.usbserial-1120 --monitor-port /dev/cu.usbserial-1120
  # terminal 2 - collar
  pio run -e collar  -t upload -t monitor --upload-port /dev/cu.usbserial-1130 --monitor-port /dev/cu.usbserial-1130
  ```

- **Just watch, without flashing again:**
  `pio device monitor --port /dev/cu.usbserial-1120`
- **Once flashed, a board runs its program whenever it has power** (a USB
  charger or power bank is enough; no computer needed). Flash again only after
  the code changes. Close a board's monitor (`Ctrl+C`) before flashing it, or
  the port is busy.

### Serial monitor

- Speed is **115200** (already set in `platformio.ini`).
- Exit with `Ctrl+C`.
- To **save** the output to a file (for field tests), use:

  ```bash
  pio device monitor -e <environment> -f time -f log2file
  ```

  The log file is written to the folder you ran the command from. Keep scratch
  logs in `firmware/logs/` (git-ignored), and copy any log a field test needs
  into `docs/field-tests/runs/<run>/`.

### Stop / resume (test programs)

| Input | Action |
|-------|--------|
| Type `s` in the monitor, or press **BOOT** | Stop |
| Type `r` in the monitor, or press **BOOT** again | Resume |

---

## 6. Test each part, step by step

Do these in order. Move on only when the step passes.

### Step 1 — Board check (`esp32`)

No wiring needed. Flash `esp32`.

✅ **Pass:** you see the chip model, flash size and free memory, then a `tick`
line every second. (The blue LED stays off on purpose — see the DIO0 note in
[section 4](#4-wiring).)

### Step 2 — GPS check (`gps`)

Wire the GPS ([table above](#neo-6m-gps--esp32-collar)). Flash `gps`. Take it
**outside** with open sky and wait **1–3 minutes**.

✅ **Pass:** a `MAPS: <lat>, <lng>` line with a Google Maps link.

While it searches it prints satellites and counters:

- `rxBytes` stays at 0 → wiring or power problem (check TX → GPIO16, GND, VIN).
- `rxBytes` climbs but `sentencesOk` stays 0 → run Step 2a.

**Step 2a — only if the GPS check fails.** Flash `gps_baud`: the right baud rate
shows lots of `$` and readable text. Then flash `gps_power`: if every burst starts
with `u-blox ag` and repeats, the GPS is restarting from low power — move its VCC
to VIN and use a better USB cable or power source.

### Step 3 — LoRa link (`lora_tx` + `lora_rx`)

Wire the SX1278 to **both** boards and attach both antennas. Flash `lora_tx` to
board A and `lora_rx` to board B.

✅ **Pass:** board B prints `FarmTrack #1`, `#2`, … every 2 seconds, with an
**RSSI** (closer to 0 is stronger) and **SNR**.

Both tests use the **same radio settings as the collar and gateway** (from
[src/lora_link.h](src/lora_link.h)), so a pass here means the real boards can
hear each other too. `lora_rx` also picks up a running collar's messages
(printed as hex). A running gateway logs the test messages as `ignored packet`,
which is expected.

If it says `LoRa FAILED`, check 3V3 power, SCK/MISO/MOSI (18/19/23), and
NSS/RST.

---

## 7. Collar and gateway (the real system)

### Step 1 — Add your secrets (gateway)

Inside the `firmware/` folder, copy the template:

```bash
cp src/secrets.h.example src/secrets.h
```

Open `src/secrets.h` and fill in:

| Setting | What to put |
|---------|-------------|
| `WIFI_SSID` / `WIFI_PASSWORD` | The WiFi the gateway will use (2.4 GHz — the ESP32 has no 5 GHz) |
| `SUPABASE_URL` | Supabase project URL (ask the project owner) |
| `SUPABASE_ANON_KEY` | Supabase anon / publishable key (ask the project owner) |
| `GATEWAY_SECRET` | The gateway secret (ask the project owner) |

`secrets.h` is git-ignored. **Never commit it** — this repository is public.

The gateway checks Supabase's certificate against the root certificates in
[src/supabase_ca.h](src/supabase_ca.h). If Supabase ever changes certificate
authority, that file explains how to update it.

### Step 2 — Update the database first

This firmware sends extra fields and expects the protocol v2 reply. Run the
database update in [app/README.md](../app/README.md) before flashing.

### Step 3 — Flash the gateway, then the collar

**Both boards must run this version.** The v2 messages are a different size
from v1, so a v1 board and a v2 board simply ignore each other: the collar
prints `no reply from gateway` and the gateway prints
`ignored packet len=21 ver=1`.

1. Plug in the gateway board and flash `gateway`.
   ✅ **Pass:** `LoRa OK, listening...`, then `WiFi connected, IP=…` a few
   seconds later.
2. Plug in the collar board and flash `collar`.

### Step 4 — Note the collar's ID

At the top of the collar's output:

```
=== FarmTrack COLLAR  id=FT-XXXXXXXX ===
reset reason: POWERON
Register this exact ID in Supabase: collars.device_hardware_id = 'FT-<id above>'
(v1 firmware called this collar FT-YYYYYYYY - see app/supabase/rekey_collar.sql)
```

**The ID has changed in this version.** The old ID used only one byte that is
unique to each chip, so two collars could easily end up with the same ID. The
new ID uses three.

- **New collar:** register the `FT-XXXXXXXX` ID
  ([app/README.md → Register a collar](../app/README.md#register-a-collar-and-pair-it-with-an-animal)).
- **Collar that was already registered:** run
  [app/supabase/rekey_collar.sql](../app/supabase/rekey_collar.sql) in the
  Supabase SQL Editor, with the old ID (`FT-YYYYYYYY`) and the new ID
  (`FT-XXXXXXXX`) filled in where the file says. It renames the collar and
  keeps its location history, pairing and alerts.

### Step 5 — Watch it work

Take the collar outside. Every ~3 seconds:

| Board | Prints |
|-------|--------|
| Collar | `TX seq=… fix=… sats=… lat=… lng=… hdop=… bat=… gps_ok=… gps_rst=…` then `RX state=… seq=…` |
| Gateway | `RX from … seq=… fix=… sats=… rssi=… snr=… gps_ok=… gps_rst=…`, then `upload ok n=… ms=… heap=… maxblk=…`, then `TX reply state=… seq=…` |

| `state` | Meaning | Collar sound |
|---------|---------|--------------|
| 0 | Safe (also: alarms muted in the app, no GPS fix, or last fix over 60 s old) | silent |
| 1 | Warning — near a fence edge | 1 short beep |
| 2 | Breach — outside every fence | 3 sharp beeps |

**When does the collar beep?** The collar only acts on a reply if:

- it answers **that exact message** (the `seq` matches), and
- that message had a **good GPS fix**: at least 4 satellites, HDOP 5 or better,
  and less than 5 s old.

Other rules:

- **No good reply for 3 sends in a row** (no GPS, gateway out of range, WiFi
  down, Supabase slow): the collar goes **silent**. It never keeps repeating an
  old alarm.
- **Getting worse** (safe → warning → breach): the collar reacts **at once**.
- **Getting better:** the collar waits for **2 replies in a row** before it
  steps down, so an animal standing on the line doesn't make the buzzer flap.

### Radio settings (both boards must match)

All of these are in [src/pins.h](src/pins.h) and are applied by
[src/lora_link.h](src/lora_link.h):

| Setting | Value | Name in `pins.h` |
|---------|-------|------------------|
| Frequency | 433 MHz | `LORA_FREQ_HZ` |
| Bandwidth | 125 kHz | `LORA_BW_HZ` |
| Spreading factor | 9 | `LORA_SF` |
| Sync word | `0xF3` (private — ignores other LoRa devices) | `LORA_SYNC_WORD` |
| CRC | on (drops corrupted packets) | — |
| Transmit power | 17 dBm (does not need to match) | `LORA_TX_DBM` |
| Collar send interval | 3 s ± 10% | `SEND_INTERVAL_MS` in `collar.cpp` |

If you change any of these, re-flash **both** boards. The random ± 10% on the
send interval means two collars that switch on together don't keep
transmitting at the same moment.

Uplinks and replies both use **normal IQ**, as in v1. (v2 first sent replies
with inverted IQ; while a loose wire was stopping the collar from hearing
anything, that was switched back to the setting already proven on this
hardware.) A collar still can't take another collar's message for its reply:
it accepts only an 8-byte packet carrying its own ID and the `seq` it just
sent. Anything else it hears in its listening window is logged as
`RX ignored: …`.

### Message format (protocol v2)

Defined in [src/packet.h](src/packet.h). All numbers are little-endian.

**Collar → gateway: 21 bytes**

| Byte | Size | Field | Meaning |
|------|------|-------|---------|
| 0 | 1 | `version` | `2` |
| 1 | 4 | `deviceId` | The collar's ID (printed as `FT-%08X`) |
| 5 | 2 | `seq` | Counts up every send. Starts at 0 on power-up and wraps after 65535 |
| 7 | 4 | `gpsEpoch` | Time of the fix, in Unix seconds; 0 when unknown |
| 11 | 4 | `latE7` | Latitude × 10,000,000 (0 without a fix) |
| 15 | 4 | `lngE7` | Longitude × 10,000,000 (0 without a fix) |
| 19 | 1 | `battery` | 0–100 %, or 255 = unknown |
| 20 | 1 | `flags` | see below |

| `flags` bit | Meaning |
|-------------|---------|
| 0 | Good fix (≥ 4 satellites, HDOP ≤ 5, < 5 s old) |
| 1–5 | Satellites used in the fix (0–31) |
| 6 | The GPS sent data since the last message (0 = the GPS has gone quiet) |
| 7 | The GPS restarted since the last message (usually low power) |

**Gateway → collar: 8 bytes**

| Byte | Size | Field | Meaning |
|------|------|-------|---------|
| 0 | 1 | `version` | `2` |
| 1 | 4 | `deviceId` | Which collar the reply is for |
| 5 | 2 | `seq` | The `seq` of the collar message this answers |
| 7 | 1 | `state` | 0 safe, 1 warning, 2 breach |

### How the gateway handles uploads

- **Separate jobs.** The radio and the upload run on separate cores, so the
  gateway keeps listening while an upload is in progress.
- **Batches.** Messages wait in a queue of up to 256 and are sent to Supabase
  in batches of up to 64, oldest first, over one connection that stays open.
- **Time limits.** Connecting 3 s, security handshake 5 s, waiting for an
  answer 3 s, and reading the whole answer 3 s.
- **A batch Supabase keeps refusing.** After 3 server errors in a row on the
  same batch (5xx, 408, 429, or no answer in time), the gateway retries half
  as many readings at once: 64, 32, … 1. A single reading that still fails 3
  times is dropped. After the next success it goes back to 64. The cost: if
  Supabase keeps failing for more than about 3–5 minutes, the oldest readings
  start being dropped, about one every 30–50 s.
- **WiFi down.** Messages wait in the queue. If the queue fills, the oldest is
  dropped and the gateway prints `queue full, dropped oldest seq=…`. If WiFi
  stays down for 60 s, the gateway reconnects from scratch.
- **Late replies.** A reply is sent only if it is less than 3.5 s after the
  collar's message, because by then the collar has stopped listening.
  Otherwise the gateway prints `reply late, skipped seq=… age=…ms`.
- **Self-healing.**
  - If 5 uploads in a row get no answer while WiFi is up, the gateway
    restarts itself. This was the old "stops after ~20 min" fault. The restart
    loses whatever is queued. A gateway that hasn't reached Supabase once
    since it started waits 15 minutes before restarting, so a dead internet
    link doesn't cause a restart loop.
  - Both boards restart automatically if the program hangs (after 30 s on the
    collar, 60 s on the gateway).
  - The radio is set up again after a failed send. The gateway also does this
    after 5 minutes without hearing a collar, and the collar after 5 missed
    replies in a row.

### All log lines

**Both boards**

| Line | Meaning |
|------|---------|
| `reset reason: …` | Why the board last started. `POWERON`/`EXT` = normal, `BROWNOUT` = power dipped, `TASK_WDT` = a hang was caught, `SW` = the firmware restarted itself (the line before says why) |
| `radio re-init: …` | The radio was set up again, and why |

**Collar**

| Line | Meaning |
|------|---------|
| `TX seq=… fix=… sats=… lat=… lng=… hdop=… bat=… gps_ok=… gps_rst=…` | Message sent |
| `RX state=… seq=…` | Reply received for that message |
| `reply ignored: this uplink had no usable fix` | Reply received, but not acted on |
| `no reply from gateway (…)` | Nothing came back within 4 s |
| `alarm level A -> B` | The buzzer pattern changed |
| `no fix-backed reply for N cycles - buzzer silenced` | The fail-safe kicked in |

**Gateway**

| Line | Meaning |
|------|---------|
| `RX from … seq=… fix=… sats=… rssi=… snr=… gps_ok=… gps_rst=…` | Collar message received |
| `upload ok n=… ms=… heap=… maxblk=…` | A batch reached Supabase. `heap`/`maxblk` should stay flat over hours |
| `TX reply state=… seq=… dev=…` | Reply sent to the collar |
| `uplink lost: it arrived while reply seq=… was being sent` | A collar message arrived during a reply and had to be thrown away (only with 2+ collars) |
| `reply late, skipped seq=… age=…ms` | Supabase answered too late for the collar |
| `upload failed, HTTP …: …` | Supabase said no, or could not be reached (negative number = network problem) |
| `no state to relay back - skipping downlink reply this cycle …` | No reply this time (upload failed, or no state for that collar) |
| `bad response JSON: …` | Supabase's answer could not be read |
| `response truncated at … bytes` | Supabase's answer was over 4 KB, usually an HTML error page; only the start is kept |
| `batch of … failed … times - retrying … at a time` | A batch kept getting server errors, so it is being split |
| `dropped reading dev=… seq=… after … server errors` | One reading kept failing on its own and was given up |
| `… uploads in a row got no answer, but the server hasn't answered since boot - not restarting yet (queue kept)` | Uploads fail, but a restart wouldn't help yet |
| `… uploads in a row got no answer with WiFi up - restarting (… queued readings lost)` | The gateway restarts itself |
| `upload task create failed - restarting in 1s` | Out of memory at start-up; the gateway restarts |
| `queue full, dropped oldest seq=…` | WiFi has been down long enough to fill the queue |
| `ignored packet len=… ver=…` | A message in the wrong format, usually a collar still on the old firmware |
| `WiFi connected …` / `WiFi lost …` / `WiFi down for 60s - full reconnect` | WiFi changes |
| `stack free: loop=… upload=… queue=…/256` | Health report, every 5 minutes |

---

## 8. What changed in this version

**Protocol v2 (flash both boards together)**

- The uplink is **21 bytes**. The old docs said 20, which was wrong. The layout
  is the same, but the fields now mean what [section 7](#message-format-protocol-v2)
  says: a stricter fix flag, the fix time, battery 255 = unknown, and two GPS
  health bits.
- The reply is **8 bytes** and carries the `seq` it answers.
- **New collar ID** (bits 16–47 of the chip's MAC address instead of the low
  32). Existing collars need
  [app/supabase/rekey_collar.sql](../app/supabase/rekey_collar.sql).

**Found and fixed on the bench (27 Sep 2026)**

- **Loose jumper wires on the collar's radio** made it reset at full power,
  then stop answering, then hear nothing. Re-seating the wires fixed each fault
  (see the note under [Wiring](#sx1278-lora--esp32-collar-and-gateway)).
- **Sending now waits for the radio's "finished" flag** (the library's standard
  blocking send, as in v1). The first v2 build checked for "finished" in a way
  that reported success even when nothing went out, which hid the wiring fault.
  If the radio ever freezes mid-send, the watchdog restarts the board.
- **Replies use normal IQ**, as in v1 (see
  [Radio settings](#radio-settings-both-boards-must-match)).
- **`LORA_TX_DBM`** in `pins.h` sets the transmit power (default 17 dBm).
- **New diagnostics:** `lora_diag` and `lora_listen`.
- **Verified on hardware:** the gateway hears every collar message (RSSI −38 on
  the bench), uploads in about 0.2 s after the first, and the collar receives
  each reply and ignores it when it had no GPS fix — the buzzer stays silent.

**Collar**

- **Fixed: the collar beeped BREACH for about 2 hours with no GPS fix.**
  - It now acts only on a reply to the exact message it sent, and only if that
    message had a good fix.
  - It goes silent after 3 sends without one.
- The alarm gets louder at once but only quieter after 2 replies in a row.
- **A fix now needs** at least 4 satellites, HDOP 5 or better, and to be less
  than 5 s old.
- **GPS reading:**
  - The GPS is read during the 4 s reply wait and between beeps; before, data
    was lost during each wait.
  - The GPS receive buffer is now 1024 bytes.
- **Automatic recovery:**
  - A 30 s watchdog restarts the collar if it hangs.
  - A failed radio start now restarts the board instead of stopping forever.
  - A send that never finishes (a radio that froze or lost power) is caught by
    the watchdog, which restarts the board instead of leaving it hung.
  - The radio is set up again after 5 missed replies in a row.
- **Settings:**
  - Send interval is back to **3 s** (it was 30 s for GPS testing), with
    ± 10% random jitter.
  - Battery sensing can be switched on with `BATTERY_SENSE_ENABLED` once the
    resistors are fitted.
  - GPS power-save mode is available (`GPS_POWER_SAVE`, off by default,
    untested).

**Gateway**

- **Fixed: the gateway stopped uploading after about 20 minutes,** and was deaf
  to the radio during every upload (up to 2 minutes).
  - The radio and the upload now run separately.
  - It keeps one connection open with 3–5 s time limits and retries once.
  - It restarts itself if uploads keep failing while WiFi is up.
- **Security:** checks Supabase's certificate ([src/supabase_ca.h](src/supabase_ca.h))
  instead of trusting any server.
- **Messages are queued** while WiFi is down instead of being dropped.
- **Uploads:**
  - Sends `null` instead of `0,0` when there is no fix, and `null` for an
    unknown battery.
  - Adds `sats`, `gps_ok`, `gps_restarted` and `age_ms`.
- Reading Supabase's answer can no longer crash the gateway.
- **Other:**
  - A 60 s watchdog restarts the gateway if it hangs.
  - WiFi power saving is off.
  - A full WiFi reconnect happens after 60 s down.

**Tests and shared files**

- No program drives GPIO2 any more (see the DIO0 note in [section 4](#4-wiring)).
- `lora_tx` / `lora_rx` use the real radio settings, so they now prove the
  real link. `lora_tx` sends every 2 s instead of 1 s.
- Radio settings live in `pins.h` and are applied by one shared file,
  `lora_link.h`.
- All platform and library versions are pinned.
- Corrected comments:
  - The satellite count is satellites *used*.
  - The chip's default sync word is `0x12`, not `0x34`.
  - A transmit draws about 87 mA, not 120 mA.

**Removed earlier**

- `TEST CODES /gps.cpp` — an old draft that was never built.

**Git-ignored**

- `src/secrets.h` (real keys) and `logs/` (serial-monitor captures).

---

## 9. Folder layout

```
firmware/                  <- open THIS folder in VS Code
├── platformio.ini         environments, board, pinned library versions
├── src/
│   ├── pins.h             every pin number, radio settings, battery switch
│   ├── packet.h           collar <-> gateway radio message format (v2)
│   ├── lora_link.h        shared radio setup + send
│   ├── reset_reason.h     "reset reason: ..." at boot
│   ├── supabase_ca.h      root certificates the gateway trusts
│   ├── secrets.h.example  template - copy to secrets.h (git-ignored)
│   ├── collar.cpp         collar    env
│   ├── gateway.cpp        gateway   env
│   ├── test_esp32.cpp     esp32     env
│   ├── test_gps.cpp       gps       env
│   ├── test_gps_baud.cpp  gps_baud  env
│   ├── test_gps_power.cpp gps_power env
│   ├── test_lora_tx.cpp   lora_tx   env
│   ├── test_lora_rx.cpp   lora_rx   env
│   ├── test_lora_diag.cpp lora_diag env
│   └── test_lora_listen.cpp lora_listen env
├── logs/                  saved serial logs (git-ignored)
├── include/ lib/ test/    PlatformIO placeholders
└── .pio/                  build output (git-ignored)
```

---

## 10. Troubleshooting

| Problem | Try this |
|---------|----------|
| Board not found / no upload port | Install the CH340 or CP2102 driver; use a data USB cable; try another port. Pass `--upload-port`. |
| Upload stuck at "Connecting…" | Hold **BOOT** while the upload starts; close other serial monitors. On the current boards DIO0 sits on GPIO2 (a boot-mode pin) — moving it to GPIO26 removes one cause. |
| Garbled text in the monitor | Monitor is not at 115200. |
| Red squiggles on `#include` | Run `pio project init --ide vscode -e collar` inside `firmware/`. |
| `fatal error: secrets.h: No such file` | Do [section 7, Step 1](#step-1--add-your-secrets-gateway). |
| GPS: `rxBytes` stays 0 | GPS TX not on GPIO16, no shared GND, or GPS not powered. |
| GPS: bytes arrive but `sentencesOk` stays 0 | Power: GPS VCC must be on VIN. Run `gps_power` to confirm. |
| GPS: no fix | Go outside with open sky, wait 1–3 min. It will not fix indoors. |
| Collar: `fix=0` with `sats=3` or a high `hdop` | Not enough satellites for a trustworthy position yet. Wait, or move to a clearer spot. |
| Collar: `gps_rst=1` often | The GPS is restarting from low power. See [Power](#power-running-from-a-lipo). |
| `LoRa FAILED` | Not on 3V3; SPI wires (18/19/23) wrong; NSS/RST wrong. The board restarts itself every 5 s until it is fixed. |
| Gateway hears nothing | Both boards on this firmware? Antennas on? Too far apart (RSSI near −95)? |
| Gateway: `ignored packet len=21 ver=1` | The collar still runs the old firmware. Flash `collar`. |
| Gateway: `ignored packet len=8 ver=70` | Traffic from `lora_diag` or `lora_tx` on another board — expected while those run. |
| Collar: `reset reason: TASK_WDT` and never a `TX seq=` line, or `lora_tx` stops after `LoRa OK` | The radio can't finish a send. Run `lora_diag`: "RESET during the send" or "no power level works" means the radio's VCC/GND wires (or its supply) — re-seat them firmly. |
| Collar: `no reply from gateway` while the gateway logs `TX reply` | The collar's receiver isn't hearing. Re-seat the radio's wires and check its antenna; `lora_listen` shows whether it senses anything. |
| Collar: `no reply from gateway` | Gateway offline, not on WiFi, out of range, or still on the old firmware. |
| Gateway: `reply late, skipped` | Supabase answered after 3.5 s. Occasional ones are normal (for example the first upload after WiFi returns). Constant ones mean slow WiFi or a slow database. |
| Gateway: `upload failed, HTTP 401/403` | Wrong anon key or gateway secret in `secrets.h`. |
| Gateway: `upload failed, HTTP -1` right after flashing | Often the certificate check. Follow the refresh steps in [src/supabase_ca.h](src/supabase_ca.h). |
| Gateway: `upload failed, HTTP -1`/`-11` now and then | Network hiccup; it retries on its own. After 5 in a row with WiFi up it restarts itself. |
| `reset reason: BROWNOUT` | Weak USB power. Use a powered hub or a better cable/charger. |
| `reset reason: TASK_WDT` | The watchdog caught a hang and restarted the board. Save the log and report it. |

---

## 11. License

MIT — see [../LICENSE](../LICENSE). When operating the LoRa radio you are
responsible for complying with the radio-spectrum regulations in your country
(frequency band, duty cycle, and transmit power).
