# FarmTrack

Firmware for an **ESP32-based GPS + LoRa field tracker**, intended for
locating farm assets, livestock, or equipment where there is no cellular or
Wi-Fi coverage. A NEO-6M gets a position fix, and an SX1278 LoRa radio relays
short messages from a roaming node to a base node over long range.

This repository currently holds the **hardware bring-up / component tests** —
one small, self-contained program per component. Each test flashes on its own,
prints clearly to the serial monitor, tells you exactly what is wired wrong,
and can be stopped/resumed from the keyboard or the BOOT button. Use these to
prove every part of the hardware works before wiring the full tracker.

---

## 1. What you need

### Hardware

| Part | Notes |
|------|-------|
| ESP32 DevKit board | DOIT ESP32 DEVKIT v1, 30-pin. Most CH340-based clones work. |
| NEO-6M GPS module | With patch antenna. Needs a clear view of the sky. |
| SX1278 LoRa module | 433 MHz (e.g. Ra-01 / Ra-02). **Must match your antenna and local radio regulations.** |
| LoRa antenna | 433 MHz spring or SMA whip. **Attach before powering the radio.** |
| 2× ESP32 boards | Only for the LoRa link test (one sender, one receiver). A single board covers the ESP32 and GPS tests. |
| Jumper wires, USB cable | Data-capable USB cable, not charge-only. |

### Software

- [Visual Studio Code](https://code.visualstudio.com/) + the
  [PlatformIO IDE](https://platformio.org/install/ide?install=vscode) extension
  (recommended), **or** [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) (`pio`) on the command line.
- USB-serial driver for your board's chip:
  - **CH340/CH341** (most clones): install the WCH driver for your OS.
  - **CP2102** (some boards): install the Silicon Labs VCP driver.
- PlatformIO downloads the ESP32 toolchain, the Arduino framework, and all
  libraries automatically on the first build — no manual library installs.

Libraries pulled in automatically (declared in [platformio.ini](platformio.ini)):

- `mikalhart/TinyGPSPlus` — NMEA parsing for the GPS test.
- `sandeepmistry/LoRa` — SX127x driver for the LoRa tests.

---

## 2. Get the code

```bash
git clone https://github.com/farmtrackresearch/FARMTRACK.git
cd FARMTRACK
```

Then open the folder in VS Code (PlatformIO will detect the project), or use the
`pio` CLI as shown below.

---

## 3. Wiring

All pin assignments live in one place: [src/pins.h](src/pins.h). Wire the board
to match, or edit that file to match your wiring.

### NEO-6M GPS → ESP32 (UART2)

| GPS pin | ESP32 pin |
|---------|-----------|
| VCC | 5V / VIN |
| GND | GND |
| TX  | GPIO16 (RX) |
| RX  | GPIO17 (TX) |

Default baud is 9600 (NEO-6M factory setting). The firmware only ever *reads*
from the module, so its stored configuration cannot be corrupted.

### SX1278 LoRa → ESP32 (VSPI)

| LoRa pin | ESP32 pin |
|----------|-----------|
| VCC  | **3V3 only — never 5V** |
| GND  | GND |
| SCK  | GPIO18 |
| MISO | GPIO19 |
| MOSI | GPIO23 |
| NSS  | GPIO5 |
| RST  | GPIO14 |
| DIO0 | GPIO26 |

**⚠ Safety**

- Power the SX1278 from **3.3 V only**. 5 V will destroy it.
- **Attach the antenna before powering or transmitting.** Transmitting with no
  antenna can burn out the power amplifier.
- 433 MHz is used in the code (`LORA_FREQ_HZ` in `pins.h`). Change it to a band
  that is legal where you live and that matches your module and antenna.

### On-board (no wiring)

- GPIO2 — blue LED (status).
- GPIO0 — BOOT button, used as a stop/resume control.

---

## 4. Build, flash, and monitor

The project defines four PlatformIO environments — one per test. Only one test
`.cpp` is compiled per environment (via `build_src_filter`), so each can have its
own `setup()` / `loop()`.

| Environment | Test | Source |
|-------------|------|--------|
| `esp32`   | Board sanity check (LED + serial) | [src/test_esp32.cpp](src/test_esp32.cpp) |
| `gps`     | NEO-6M GPS fix | [src/test_gps.cpp](src/test_gps.cpp) |
| `lora_tx` | SX1278 LoRa sender | [src/test_lora_tx.cpp](src/test_lora_tx.cpp) |
| `lora_rx` | SX1278 LoRa receiver | [src/test_lora_rx.cpp](src/test_lora_rx.cpp) |

### Command line

```bash
pio run -e esp32   -t upload -t monitor      # board sanity
pio run -e gps     -t upload -t monitor      # GPS
pio run -e lora_tx -t upload -t monitor      # LoRa sender  (board A)
pio run -e lora_rx -t upload -t monitor      # LoRa receiver (board B)
```

Add `--upload-port /dev/tty.XXXX` (macOS/Linux) or `--upload-port COMx`
(Windows) if PlatformIO does not auto-detect the board.

### VS Code / PlatformIO IDE

1. Pick the environment in the PlatformIO status bar (bottom).
2. Use the **Build**, **Upload**, and **Serial Monitor** buttons.

### Serial monitor

- Speed: **115200 baud** (set by `monitor_speed`).
- Upload speed is pinned to 115200 — CH340 on macOS is unreliable faster.
- Exit the PlatformIO monitor with `Ctrl+C`.

### Controls (all tests)

| Input | Action |
|-------|--------|
| `s` / `S` in the monitor, or press **BOOT** | Stop (LED off) |
| `r` / `R` in the monitor, or press **BOOT** again | Resume |

---

## 5. What each test does

### `esp32` — board sanity
No external parts. Prints chip model, revision, core count, flash size, and free
heap once, then a `tick` line every second while the on-board LED blinks at
1 Hz. Confirms USB serial, the LED, and a clean boot.

### `gps` — NEO-6M
Prints a status line every 2 seconds:

- **Searching:** satellite count and byte/sentence/checksum counters. If
  `rxBytes` stays at 0 it is a wiring/power fault (`TX → GPIO16`, GND, power);
  if bytes arrive but no sentences pass, suspect a baud mismatch.
- **Fix:** `MAPS: <lat>, <lng>` plus a ready-to-click Google Maps link. The LED
  goes solid on a fix, blinks while searching.

A cold start outdoors typically takes **1–3 minutes**. The module needs a real
sky view — it will not fix indoors or under cover.

### `lora_tx` / `lora_rx` — SX1278 link
Flash `lora_tx` to one board and `lora_rx` to another.

- **Sender** transmits `FarmTrack #<n>` once per second and blinks the LED on
  each send.
- **Receiver** prints every packet with its length, **RSSI** (dBm — closer to 0
  is stronger) and **SNR**, and pulses the LED.

Both sides must use the same frequency. If `LoRa.begin()` fails, the test keeps
retrying and prints wiring hints instead of hanging — check 3V3 power, the SPI
lines (18/19/23), and NSS/RST/DIO0.

---

## 6. Repository layout

```
FARMTRACK/
├── platformio.ini      # environments, board, libraries, monitor/upload speed
├── src/
│   ├── pins.h          # single source of truth for every pin + wiring notes
│   ├── test_esp32.cpp  # esp32   env
│   ├── test_gps.cpp    # gps     env
│   ├── test_lora_tx.cpp# lora_tx env
│   └── test_lora_rx.cpp# lora_rx env
├── include/            # (PlatformIO placeholder) shared headers
├── lib/                # (PlatformIO placeholder) private libraries
├── test/               # (PlatformIO placeholder) unit tests
└── "TEST CODES /"      # scratch / earlier drafts, not built
```

`.pio/` (build output) and the auto-generated `.vscode/` files are
git-ignored.

---

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| Board not found / no upload port | Wrong or missing USB-serial driver; charge-only USB cable; try another port or cable. Pass `--upload-port` explicitly. |
| Upload fails at "Connecting…" | Hold **BOOT** while upload starts (some boards); lower `upload_speed`; unplug other serial monitors. |
| Garbled serial output | Monitor not at 115200. |
| GPS: `rxBytes` stays 0 | GPS `TX` not on `GPIO16`, no common GND, or module unpowered. |
| GPS: bytes arrive, no fix | Needs open sky; wait 1–3 min for cold start. |
| GPS: bytes but no valid NMEA | Baud mismatch — try 38400 in `pins.h`. |
| LoRa: `LoRa FAILED` | Not on 3V3; SPI miswired (18/19/23); NSS/RST/DIO0 wrong. |
| LoRa: sends OK but nothing received | Frequency mismatch between the two boards; antenna missing; out of range. |

---

## 8. Roadmap

The component tests are step one. Planned next: a combined tracker node
(GPS fix → LoRa uplink with a compact packet format), a base node that logs
positions, low-power sleep between fixes, and a simple map view.

---

## 9. Research use and license

FarmTrack is a research / educational project (contact:
`farmtrack.research@gmail.com`). No license file is included yet — until one is
added, all rights are reserved by the authors. If you intend to reuse this code,
please open an issue to ask.

When operating the LoRa radio you are responsible for complying with the
radio-spectrum regulations in your country (frequency band, duty cycle, and
transmit power).
