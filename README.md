# FarmTrack

**GPS + LoRa livestock tracking and virtual fencing for areas with no cellular
coverage.** Collared animals report their position over long-range radio; a
mobile app draws geofences on a live map and raises alerts when an animal
breaches a boundary, approaches one, goes stationary, or its collar battery
runs low.

This is a research / educational project. Contact: `farmtrack.research@gmail.com`.

---

## Repository layout

This is a monorepo with two independent components:

| Path | What it is | Stack | README |
|------|-----------|-------|--------|
| [`firmware/`](firmware/) | Tracker + base-station firmware for the ESP32 hardware. Currently the per-component bring-up tests (board, GPS, LoRa link). | C++ / Arduino / PlatformIO | [firmware/README.md](firmware/README.md) |
| [`app/`](app/) | The mobile/web app: map, geofence drawing, livestock list, alerts. | Expo (React Native) + Supabase/PostGIS | [app/README.md](app/README.md) |

The two talk to each other only indirectly today: the firmware proves out the
hardware that will produce GPS fixes, and the app consumes positions from a
Supabase backend. Wiring the firmware's LoRa uplink to that backend (via a base
station + gateway) is the main open piece of work — see the roadmap in
[firmware/README.md](firmware/README.md).

---

## Quick start

**Firmware** (needs an ESP32 DevKit v1, plus a NEO-6M and an SX1278 for the
full set of tests):

```bash
cd firmware
pio run -e esp32 -t upload -t monitor      # board sanity check
```

Open the `firmware/` folder directly in VS Code with the PlatformIO extension.
Full hardware list, wiring tables, and per-test instructions are in
[firmware/README.md](firmware/README.md).

**App** (needs Node.js and the Expo tooling):

```bash
cd app
npm install
cp .env.example .env      # fill in Supabase keys, or leave blank for demo mode
npx expo start
```

With no Supabase keys set, the app runs entirely on the fixtures in
`app/src/data/mockData.ts` so you can explore the UI offline. Backend setup
(`supabase/schema.sql`, realtime, RLS) is documented in
[app/README.md](app/README.md).

---

## Hardware overview

| Component | Part | Role |
|-----------|------|------|
| MCU | ESP32 DevKit v1 (30-pin) | Reads GPS, drives the LoRa radio |
| GPS | NEO-6M + antenna | Position fix (needs sky view) |
| Radio | SX1278 LoRa @ 433 MHz + antenna | Long-range uplink from collar to base |

**Safety:** power the SX1278 from 3.3 V only, always attach its antenna before
powering, and pick a LoRa frequency that is legal in your country. Details in
[firmware/README.md](firmware/README.md).

---

## License

MIT — see [LICENSE](LICENSE).

When operating the LoRa radio you are responsible for complying with the
radio-spectrum regulations in your country (frequency band, duty cycle, and
transmit power).
