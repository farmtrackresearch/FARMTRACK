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

### Software

1. [Visual Studio Code](https://code.visualstudio.com/).
2. The **PlatformIO IDE** extension in VS Code (Extensions panel → search
   "PlatformIO IDE" → Install). Do **not** install the "pioarduino" extension —
   it clashes with PlatformIO.
3. The USB driver for your board's USB chip:
   - **CH340 / CH341** (most clones) → the WCH CH340 driver.
   - **CP2102** → the Silicon Labs CP210x driver.

PlatformIO downloads the ESP32 toolchain and all libraries by itself on the first
build (this takes a few minutes the first time). Libraries used, from
[platformio.ini](platformio.ini):

- `mikalhart/TinyGPSPlus` — reads GPS data
- `sandeepmistry/LoRa` — drives the SX1278
- `bblanchon/ArduinoJson` — builds the gateway's upload message

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
| `lora_tx`   | LoRa test sender | [src/test_lora_tx.cpp](src/test_lora_tx.cpp) |
| `lora_rx`   | LoRa test receiver | [src/test_lora_rx.cpp](src/test_lora_rx.cpp) |
| `gps_baud`  | Diagnostic: finds which baud rate the GPS talks at | [src/test_gps_baud.cpp](src/test_gps_baud.cpp) |
| `gps_power` | Diagnostic: shows if the GPS keeps restarting from low power | [src/test_gps_power.cpp](src/test_gps_power.cpp) |
| **`collar`**  | **The real collar program** | [src/collar.cpp](src/collar.cpp) |
| **`gateway`** | **The real gateway program** | [src/gateway.cpp](src/gateway.cpp) |

Shared files: [src/pins.h](src/pins.h) (every pin number) and
[src/packet.h](src/packet.h) (the radio message format).

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

> **Note about the current prototype:** on the team's existing boards DIO0 is
> wired to **GPIO2** instead of GPIO26. The firmware works either way, because
> it never uses DIO0 and leaves GPIO2 (the blue LED pin) untouched. Side effect:
> the blue LED does not blink in the collar, gateway, or GPS test. New boards
> should use GPIO26.

### Piezo buzzer → ESP32 (collar)

| Buzzer | ESP32 pin |
|--------|-----------|
| + | GPIO27 |
| − | GND |

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
line every second.

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

✅ **Pass:** board B prints `FarmTrack #1`, `#2`, … with an **RSSI** (closer to 0
is stronger) and **SNR**.

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

### Step 2 — Flash the gateway

Plug in the gateway board and flash `gateway`.

✅ **Pass:** `LoRa OK, listening...` and then a WiFi connected message.

### Step 3 — Flash the collar

Plug in the collar board and flash `collar`. At the top of the output it prints:

```
=== FarmTrack COLLAR  id=FT-XXXXXXXX ===
```

Write that ID down.

### Step 4 — Register the collar in Supabase

The collar's ID must be in the database and paired with an animal, or no alerts
will ever fire. Follow [app/README.md → Register a collar](../app/README.md#register-a-collar-and-pair-it-with-an-animal).

### Step 5 — Watch it work

Take the collar outside. Every send, the collar prints
`TX seq=… fix=… sats=… lat=… lng=…` and the gateway prints
`RX from … seq=… rssi=… snr=…` followed by `TX reply state=…`.

| `state` | Meaning | Collar sound |
|---------|---------|--------------|
| 0 | Safe | silent |
| 1 | Warning — near a fence edge | 1 short beep |
| 2 | Breach — outside every fence | 3 sharp beeps |

> The collar currently sends every **30 seconds** (a temporary setting for GPS
> diagnosis). Normal is 3 seconds — see `SEND_INTERVAL_MS` in
> [src/collar.cpp](src/collar.cpp).

### Radio settings (both boards must match)

| Setting | Value | Where |
|---------|-------|-------|
| Frequency | 433 MHz | `LORA_FREQ_HZ` in `pins.h` |
| Sync word | `0xF3` (private — ignores other LoRa devices) | `LORA_SYNC_WORD` in `pins.h` |
| Spreading factor | 9 | `collar.cpp` and `gateway.cpp` |
| CRC | on (drops corrupted packets) | `collar.cpp` and `gateway.cpp` |

If you change any of these, re-flash **both** boards. The `lora_tx` / `lora_rx`
tests use library defaults, so they do not talk to the collar or gateway.

---

## 8. What changed in this version

**Added**

- `collar` and `gateway` environments — the real system ([collar.cpp](src/collar.cpp),
  [gateway.cpp](src/gateway.cpp)).
- [packet.h](src/packet.h) — shared 20-byte uplink / 6-byte reply format. The
  uplink also carries the satellite count.
- [secrets.h.example](src/secrets.h.example) — template for gateway credentials.
- `gps_baud` and `gps_power` diagnostic environments.
- `pins.h`: `PIN_BUZZER` (GPIO27) and `LORA_SYNC_WORD` (`0xF3`).

**Changed**

- LoRa payload CRC on, spreading factor 7 → 9, private sync word — on collar and
  gateway.
- GPS power moved to **VIN (5 V)**.
- GPIO2 / blue LED no longer driven in `collar`, `gateway`, and `gps` (see the
  wiring note in [section 4](#4-wiring)).
- `gps` test now turns off WiFi/Bluetooth, slows the CPU, and puts the LoRa radio
  to sleep so the GPS has enough power.
- Collar send interval temporarily 30 s (normal: 3 s).
- `.vscode/extensions.json` now warns against the `pioarduino` extension.

**Removed**

- `TEST CODES /gps.cpp` — an old draft that was never built.

**Now git-ignored**

- `src/secrets.h` (real keys) and `logs/` (serial-monitor captures).

---

## 9. Folder layout

```
firmware/                  <- open THIS folder in VS Code
├── platformio.ini         environments, board, libraries, speeds
├── src/
│   ├── pins.h             every pin number + wiring notes
│   ├── packet.h           collar <-> gateway radio message format
│   ├── secrets.h.example  template - copy to secrets.h (git-ignored)
│   ├── collar.cpp         collar   env
│   ├── gateway.cpp        gateway  env
│   ├── test_esp32.cpp     esp32    env
│   ├── test_gps.cpp       gps      env
│   ├── test_gps_baud.cpp  gps_baud env
│   ├── test_gps_power.cpp gps_power env
│   ├── test_lora_tx.cpp   lora_tx  env
│   └── test_lora_rx.cpp   lora_rx  env
├── logs/                  saved serial logs (git-ignored)
├── include/ lib/ test/    PlatformIO placeholders
└── .pio/                  build output (git-ignored)
```

---

## 10. Troubleshooting

| Problem | Try this |
|---------|----------|
| Board not found / no upload port | Install the CH340 or CP2102 driver; use a data USB cable; try another port. Pass `--upload-port`. |
| Upload stuck at "Connecting…" | Hold **BOOT** while the upload starts; close other serial monitors. |
| Garbled text in the monitor | Monitor is not at 115200. |
| Red squiggles on `#include` | Run `pio project init --ide vscode -e collar` inside `firmware/`. |
| `fatal error: secrets.h: No such file` | Do [section 7, Step 1](#step-1--add-your-secrets-gateway). |
| GPS: `rxBytes` stays 0 | GPS TX not on GPIO16, no shared GND, or GPS not powered. |
| GPS: bytes arrive but `sentencesOk` stays 0 | Power: GPS VCC must be on VIN. Run `gps_power` to confirm. |
| GPS: no fix | Go outside with open sky, wait 1–3 min. It will not fix indoors. |
| `LoRa FAILED` | Not on 3V3; SPI wires (18/19/23) wrong; NSS/RST wrong. |
| Gateway hears nothing | Both boards on the new firmware? Antennas on? Too far apart (RSSI near −95)? |
| Gateway: `upload failed, HTTP 401/403` | Wrong anon key or gateway secret in `secrets.h`. |
| Gateway: `HTTP -1`, `-11`, or `-29312` after ~20 min | Known issue (see the [main README](../README.md#known-issues)). Press the gateway's EN/reset button. |
| Gateway: "Brownout detector was triggered" | Weak USB power. Use a powered hub or a better cable/charger. |
| Collar prints `no reply from gateway` | Gateway offline, not on WiFi, or out of range. |

---

## 11. License

MIT — see [../LICENSE](../LICENSE). When operating the LoRa radio you are
responsible for complying with the radio-spectrum regulations in your country
(frequency band, duty cycle, and transmit power).
