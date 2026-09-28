# FIELD DATA SHEET — Night collar test (GPS / LoRa SF9 / end-to-end)

Print this or copy it onto paper. Fill in by hand. Every blank matters.

Protocol: `docs/field-tests/plans/night-collar-gps-lora-e2e.md`
Radio settings (fixed, quote with every range result):
**433 MHz · SF9 · CRC on · sync 0xF3 · 17 dBm**
Collar `FT-EC82C34C` · collar env `collar` · gateway env `gateway` · commit `3a51f8e`
(firmware is uncommitted — see plan for md5 fingerprints)

> **Any run after the protocol v2 firmware change: the line above is out of
> date.** The collar ID changed, both boards must run v2 together, and
> `SEND_INTERVAL` is 3 s again (±10% jitter, so the TTFF seq cross-check is
> only good to about ±10%). See "Read first" at the top of the plan. Fill this
> in at the bench, before the session:
>
> | Field | Value |
> |---|---|
> | New collar ID from boot banner (`FT-XXXXXXXX`) | ____________________ |
> | `git rev-parse --short HEAD` | ____________________ |
> | Firmware files listed by `git status --short firmware/src` (none / which) | ____________________ |
> | md5 `collar.cpp` | ________________________________ |
> | md5 `gateway.cpp` | ________________________________ |
> | md5 `packet.h` | ________________________________ |
> | md5 `pins.h` | ________________________________ |
> | Gateway reflashed with v2 (env `gateway`) at | ____________ |
> | Collar reflashed with v2 (env `collar`) at | ____________ |
> | Both flashed from the same tree? | YES / NO |
> | Runbook re-key done, collar still paired to its animal? | YES / NO |

## Header

| Field | Value |
|---|---|
| Date (local) | ____________________ |
| Start time / end time | __________ / __________ |
| Operator | ____________________ |
| Weather | ____________________ |
| Cloud cover (clear / part / overcast) | ____________________ |
| Wind, rain | ____________________ |
| Temperature (if known) | ____________________ |
| Traffic level on highway | ____________________ |
| Antenna type (collar / gateway) | ____________________ |
| Antenna height above ground (collar / gateway) | __________ / __________ |
| How collar was carried | ____________________ |
| Gateway location indoors (room, wall, floor) | ____________________ |

## Phase 0 — Setup

| Check | Value |
|---|---|
| `/dev/cu.usbserial-1130` absent? (MUST be absent) | YES / NO |
| Gateway banner seen at (laptop time) | ____________ |
| First `RX from EC82C34C` at (laptop time) | ____________ |
| seq at that first RX | ____________ |
| `TX reply` lines present? | YES / NO |
| **Laptop time** from `date` | ____________ |
| **Phone time** at that same instant | ____________ |
| **OFFSET = phone − laptop (seconds, with sign)** | ____________ |

### Ground-truth reference point

| Field | Value |
|---|---|
| Physical feature used | ______________________________ |
| How identified in imagery | ______________________________ |
| Latitude (6 dp) | ____________________ |
| Longitude (6 dp) | ____________________ |
| Method | Google Maps satellite pin on feature (NOT "my location") |
| Est. reference error | unknown, few metres — imagery georeferencing |

## Phase 1 — GPS

| Event | Laptop time | seq | sats |
|---|---|---|---|
| t0 — collar set down, clear sky | __________ | ______ | ______ |
| first `sats` >= 1 | __________ | ______ | ______ |
| first `sats` >= 4 | __________ | ______ | ______ |
| first `sats` >= 6 | __________ | ______ | ______ |
| **first `fix=1`** | __________ | ______ | ______ |

**TTFF (laptop clock) = ____________ s**
**TTFF cross-check = (seq_fix − seq_t0) × 3 s = ____________ s**
(cross-check valid ONLY if `TX reply` lines were present throughout — were they? YES / NO)

Fix never acquired within 12 min?  YES / NO   If yes, sats reading at 12 min: ______

### Static hold (15 min from first fix)

| Field | Value |
|---|---|
| Hold start (laptop time) | ____________ |
| Hold end (laptop time) | ____________ |
| Gateway EN pressed at 12 min? | YES / NO — time: ____________ |
| Collar moved or touched during hold? | NO / YES (explain below) |

Spot checks:

| Time | sats | fix | RSSI |
|---|---|---|---|
| __________ | ______ | ______ | ______ |
| __________ | ______ | ______ | ______ |
| __________ | ______ | ______ | ______ |
| __________ | ______ | ______ | ______ |
| __________ | ______ | ______ | ______ |

Sky view at reference point (obstructions, buildings, trees, which direction):

______________________________________________________________________

______________________________________________________________________

## Phase 2 — LoRa range walk at SF9

Gateway EN pressed before leaving at (laptop time): ____________
Left indoors at (phone time): ____________

**Record PHONE times. Convert later using the offset above.**

| Pt | Phone start | Phone end | Landmark / where you stood | LOS to gateway? | Buzzer sounding? | Pin dropped? |
|---|---|---|---|---|---|---|
| P1 | __________ | __________ | ______________________ | Y / N | Y / N | Y / N |
| P2 | __________ | __________ | ______________________ | Y / N | Y / N | Y / N |
| P3 | __________ | __________ | ______________________ | Y / N | Y / N | Y / N |
| P4 | __________ | __________ | ______________________ | Y / N | Y / N | Y / N |
| P5 | __________ | __________ | ______________________ | Y / N | Y / N | Y / N |
| P6 | __________ | __________ | ______________________ | Y / N | Y / N | Y / N |

Dwell at each point: 90 s. Any point where dwell was shorter, note here:

______________________________________________________________________

Why you stopped outbound (circle): two silent points + one more / 25 min elapsed / reached P5 / safety — describe:

______________________________________________________________________

Back indoors at (laptop time): ____________

**Distances — fill in AFTER the walk, from Google Maps "Measure distance" (gateway pin to each point):**

| Pt | Distance (m) | Pt | Distance (m) |
|---|---|---|---|
| P1 | __________ | P4 | __________ |
| P2 | __________ | P5 | __________ |
| P3 | __________ | P6 | __________ |

## Phase 3 — End-to-end delivery

| Field | Value |
|---|---|
| Gateway EN pressed at (laptop time) | ____________ |
| Clean window start (laptop time) | ____________ |
| Clean window end (laptop time) | ____________ |
| Collar placed where | ____________________ |
| `fix=1` RX lines in window (from log) | ____________ |
| `location_logs` rows in window (from SQL) | ____________ |
| Upload success % | ____________ |

## Resets, faults and anything odd

Record EVERY gateway reboot banner, brownout, and unexpected behaviour with its
time. A reset mid-window breaks timing results.

| Time | What happened |
|---|---|
| __________ | ______________________________________________ |
| __________ | ______________________________________________ |
| __________ | ______________________________________________ |
| __________ | ______________________________________________ |

## Deviations from the protocol

______________________________________________________________________

______________________________________________________________________

______________________________________________________________________

Signed: ____________________   Date: ____________
