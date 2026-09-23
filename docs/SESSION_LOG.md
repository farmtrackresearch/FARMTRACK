# FarmTrack Session Log

Chronological record of development sessions, oldest first. Each entry keeps the
same set of sections; "None" means nothing happened in that category, "Not
recorded" means the information was never captured.

## 2026-09-24 03:43 HKT — Two-night hardware bring-up: GPS brownout root-caused (two causes), LoRa CRC enabled, SF7→SF9, end-to-end pipeline verified, field test Phase 1 unresolved

**Context:** Collar firmware, gateway firmware, Supabase backend, app, editor
tooling and docs. One continuous work session spanning two nights — "Night 1"
(2026-09-22 into 2026-09-23) and "Night 2" (2026-09-23 into 2026-09-24) — logged
as a single entry because only the closing clock time was recorded; the per-night
start and end times are Not recorded. Goal was to get the collar → LoRa → gateway
→ WiFi → Supabase → geofence → downlink path working on real hardware and then
field-test it.

**Changes made:**

Night 1 — tooling
- Built the PlatformIO project for the first time (`.pio` did not exist, so no
  toolchain or libdeps were on disk) and generated editor config with
  `pio project init --ide vscode`; copied `c_cpp_properties.json` to the repo
  root because cpptools only reads `.vscode/` from the workspace folder root,
  and the workspace root is the monorepo root while the PlatformIO project is in
  `firmware/`.
- Added the generated editor files (~64 KB of machine-local absolute paths,
  previously uncommitted but not ignored) to the root `.gitignore`.

Night 1 — backend
- Wrote `app/supabase/verify_setup.sql`, a read-only health check that derives
  everything from `information_schema` / `pg_catalog`.
- Wrote `app/supabase/gateway_ingest.sql`; it proved incompatible with the live
  database and now carries a prominent DO-NOT-RUN header (retained as design
  notes only).

Night 1 — firmware
- `collar.cpp`, `test_gps.cpp`: `pinMode(PIN_LED, INPUT)` and removed every
  `digitalWrite(PIN_LED, ...)` (GPIO2 contention workaround, commented as such).
- Added diagnostic sketches `src/test_gps_baud.cpp` (baud/protocol scanner) and
  `src/test_gps_power.cpp` (raw burst dump with inter-burst timing), with
  matching `platformio.ini` environments `gps_baud` and `gps_power`.
- Satellite count encoded into `UplinkPacket.flags` bits 1–5 so the gateway can
  print it; packet size unchanged, so no protocol version bump.

Night 1 — app
- `app/src/app/(tabs)/map.tsx`: camera now frames collar positions plus fence
  corners instead of centring on the phone; removed the leftover demo-scaffolding
  ref that blocked the collar/fence fit from ever running. Added a 6 m movement
  deadband (`STABLE_THRESHOLD_M = 6`) so a stationary animal's marker holds still
  — display only; `detect_geofence_events` still evaluates every raw reading.
- Replaced `latest_livestock_locations` with a version averaging the last 5 fixes.
- Resized Fence 1 from 52 m² (~7.2 m across, smaller than the GPS error) to a
  ~60 m box.
- `app/src/types/database.ts`: `LocationLog` gained `seq` / `rssi` / `snr` /
  `gateway_id`.

Night 2 — firmware and config
- `LoRa.enableCrc()` on both collar and gateway.
- Spreading factor raised 7 → 9 on both boards (`LoRa.setSpreadingFactor(9)`).
- `gateway.cpp`: same GPIO2 fix as Night 1 (`pinMode(PIN_LED, INPUT)`, removed
  the three `digitalWrite(PIN_LED, ...)` calls per packet).
- Hardware: moved the GPS VCC wire from the ESP32 3V3 pin to VIN.
- Fence 1 `warning_buffer_meters` changed 30 → 15.
- `collar.cpp` `SEND_INTERVAL_MS` temporarily raised 3000 → 30000 as a
  diagnostic, commented to be reverted.

Night 2 — docs (field-test-planner agent)
- `docs/field-tests/plans/night-collar-gps-lora-e2e.md`,
  `docs/field-tests/plans/night-collar-DATASHEET.md`,
  `docs/field-tests/runs/2026-09-24-night-collar/` (notes.md, points.csv,
  queries.sql), `docs/field-tests/scripts/analyze_gateway_log.py`,
  `docs/field-tests/SUMMARY.md`.

**Errors encountered:**
- VS Code: "#include errors detected, update includePath" on firmware files.
- NEO-6M emitted ~17 bytes of its boot banner then restarted, roughly 12 times a
  second, indefinitely. TinyGPSPlus showed `rxBytes` climbing with `sentencesOk`
  stuck at 0 and `csumErr` 0.
- Two drafts of `verify_setup.sql` failed against the live schema (assumed
  columns that do not exist, e.g. `gateways.is_active`).
- App displayed no data at all.
- Gateway printed packets from device IDs that do not exist: `EC82CA4C` and
  `E682C2EA` alongside the real `EC82C34C`, one reporting a plausible-looking
  `fix=1 sats=10`.
- Gateway serial: "Brownout detector was triggered", `rst:0xc` — the ESP32's own
  brownout detector reset the board.
- Gateway HTTPS upload failures: `-1` (connection), `-11` (read timeout),
  `-29312` (SSL EOF), starting around 17–20 minutes of uptime and growing more
  frequent.
- After the GPIO2 fix, GPS ran cleanly for ~3.7 minutes (`sentencesOk` at 6/sec)
  then `sentencesOk` froze while `rxBytes` kept climbing; an anomalous sentence
  rate of 21/sec was also seen.
- Field test Phase 1: outdoors the collar reached `sats=3`, then `sats=4` with
  intermittent drops to 0, then `sats=0` held through 23 minutes; `fix=1` never
  achieved.

**Bugs found:**
- GPS brownout, cause 1 of 2 — GPIO2 pin contention. The SX1278's DIO0 is
  physically wired to GPIO2, which is also `PIN_LED`. Firmware drove GPIO2 as an
  output while the radio drove it too: two push-pull outputs shorted together,
  collapsing the 3V3 rail the GPS shares. This is a wiring deviation from
  `pins.h`, which declares `PIN_LORA_DIO0 = 26`. LoRa still worked because the
  library polls `parsePacket()` rather than using the DIO0 interrupt.
- GPS brownout, cause 2 of 2 — GPS VCC connected to the ESP32 3V3 pin instead of
  VIN/5V as `pins.h` line 10 specifies. On 3V3 the module's onboard regulator
  sits in dropout with no headroom, on a rail shared with the ESP32 and SX1278.
  `test_gps_power`'s raw dump identified it: every burst began with
  `$GPTXT,01,01,02,u-blox ag - www.u-blox.com*50` with gaps of 491–1014 ms — the
  module was completing its full power-on banner and restarting one to two times
  per second, which also explains the 21/sec sentence rate (~11 valid sentences
  per boot at ~2 boots/sec).
- LoRa payload CRC was disabled. The sandeepmistry LoRa library leaves it OFF by
  default and `gateway.cpp` validates only packet size and protocol version, so
  bit-flipped packets passed both checks and were logged as genuine telemetry —
  including the flags byte carrying fix and satellite count. `EC82CA4C` is the
  real ID with 2 bit errors, `E682C2EA` with 7.
- GPIO2 contention was also present in `gateway.cpp` — Night 1's fix was applied
  to `collar.cpp` and `test_gps.cpp` but `gateway.cpp` was missed.
- "Collar stops sending after ~20 minutes" was not a collar fault: at RSSI −97
  with SNR −10 the link was below the SF7 demodulation floor. The collar never
  stopped transmitting; the gateway could not hear it. The "20 minutes" was
  coincidence. Firmware was ruled out by test (21 minutes on USB, seq past 420,
  no stop) and so was the USB power bank (20 minutes on battery, seq 127 → 405
  continuous, no reset); `seqCounter` is uint16 at 3 s so it wraps at 54 hours
  and `millis()` overflow is 49 days — both arithmetically excluded. One false
  alarm: a monitor appeared to stop mid-run, but VS Code had restarted the
  terminal ("History restored" in the scrollback) and seq had continued 127 → 405.
- Gateway HTTPS degradation with uptime: `uploadReading()` constructs a fresh
  `WiFiClientSecure` and a full TLS handshake per reading, every 3 seconds, with
  no timeout configured on either `WiFiClientSecure` or `HTTPClient`. Consistent
  with heap fragmentation, since each handshake needs tens of KB contiguous.
- Gateway ESP32 brownout: its 3.3 V rail sagged below ~2.6 V. Suspected cause is
  SF9 tripling LoRa transmit duration and overlapping more often with WiFi
  current bursts on a marginal USB supply — suspected, not confirmed.
- Fence 1's `warning_buffer_meters` was 30 on a ~60 m fence, so every interior
  point was inside the buffer and "grazing"/safe was physically unreachable.
- Fence 1 was originally 52 m² (~7.2 m across) — smaller than the measured GPS
  error.
- App showed nothing because it was in demo mode: the login screen's Admin/Staff
  buttons call `signInDemo()`, which sets `demoMode` true, and `useFarmData` then
  never queries Supabase — it loads `DEMO_LOCATIONS` and `DEMO_GEOFENCES`, both
  empty arrays.
- `app/supabase/schema.sql` does not describe the live database. The deployed DB
  already had `public.gateways`, `ingest_telemetry()`, `seq`/`rssi`/`snr`/
  `gateway_id` columns on `location_logs`, and `'LoRa'` added to the
  `connection_type` enum — none of which are in the repo file. The deployed
  `ingest_telemetry` authenticates against an unsalted hex SHA-256 column named
  `api_key_hash`; `gateway_ingest.sql` assumed `key_hash`/bcrypt and
  `RETURNS TABLE` where the live function `RETURNS jsonb`.

**Fixes applied:**
- Editor config: built the project, generated and copied `c_cpp_properties.json`
  to the repo root, added the generated files to the root `.gitignore`. Verified
  by the include errors clearing.
- GPIO2 contention: `pinMode(PIN_LED, INPUT)` and all `digitalWrite(PIN_LED, ...)`
  removed in `collar.cpp`, `test_gps.cpp` (Night 1) and `gateway.cpp` (Night 2).
  Verified: `sentencesOk` went from stuck-at-0 to climbing 6/sec with `csumErr` 0.
  This is a software workaround; the proper fix is moving the DIO0 jumper to
  GPIO26, which was not done.
- GPS VCC moved from 3V3 to VIN (one wire). Verified over 5 continuous minutes:
  bursts at a steady 993–1002 ms, 162 bytes each, every one beginning with
  `$GPRMC`, and the `$GPTXT` banner appearing only once at startup.
- `LoRa.enableCrc()` on both boards. Any marginal-RSSI reading taken before this
  is untrustworthy.
- Spreading factor 7 → 9 on both boards. Rationale from the link data: RSSI −96
  with SNR −10 implies a site noise floor of −86 dBm, ~35 dB above thermal for a
  125 kHz channel (433 MHz ISM is shared with car remotes and gate openers). SF9
  lowers the demodulator SNR limit from −7.5 dB to −12.6 dB (~5 dB, roughly 1.8×
  range) at 185 ms airtime vs 57 ms — 6% duty cycle on a 3-second interval. SF12
  was rejected: 1483 ms airtime is a 49% duty cycle at that interval. Verified on
  the bench (SNR rose from ~9.5 to ~13.5 at the same RSSI) and in the field (link
  held at RSSI −80 to −88 with positive SNR where SF7 had been failing at −90).
  Both boards must match or neither hears the other.
- Fence 1 resized to a ~60 m box and `warning_buffer_meters` set to 15. Note: 15 m
  is only just above the measured ~12 m GPS error, so the warning transition will
  be noisy; the honest fix is a larger paddock.
- App demo-mode blank screen resolved by signing in with a real Supabase account
  (no code change).
- Gateway secret verified against the live RPC by calling `ingest_telemetry` with
  `p_readings:[]`, which authenticates without logging anything.
- App changes: `tsc --noEmit` clean after every one.
- Gateway TLS heap degradation: NOT FIXED. Pressing EN clears it; the real fix is
  batching (`ingest_telemetry` already accepts an array) or connection reuse.

Verified results (end-to-end, not tied to a single fix):
- Night 1: full pipeline verified end to end — collar → LoRa → gateway → WiFi →
  Supabase → PostGIS geofence evaluation → downlink → buzzer, about 3 seconds
  from a database UPDATE to the collar changing state. GPS reached 7–8 satellites
  and logged a real track.
- GPS accuracy against a Google Maps imagery reference: 11.84 m total error,
  +1.05 m north-south and −11.80 m east-west. The near-pure east-west bias
  indicates multipath off the adjacent buildings, not random noise.
- Field test Phase 0 completed: gateway monitor restarted with `-f time
  -f log2file`; gateway reset at 00:53:02; WiFi 192.168.0.106; first RX seq=790
  at 00:53:13; measured end-to-end RX→TX reply latency 2.06 s; phone-to-laptop
  clock offset +1 s (negligible); reference point established at
  9.364401593684349, 123.27160536641064 (north-west corner of the concrete fence
  post by the gate), computed to be 28.6 m from the nearest Fence 1 edge and
  inside the safe core.
- Field test Phase 1: UNRESOLVED (see Errors).

**Open items:**
- Nothing is committed. The firmware that runs this system has never been in
  version control: `firmware/src/collar.cpp`, `firmware/src/gateway.cpp` and
  `firmware/src/packet.h` are still untracked, and every change above is
  uncommitted working-tree state. Last commit is 3a51f8e (2026-09-03).
- GPS does not hold a fix outdoors. Current hypothesis under test: the collar's
  own LoRa transmissions disturb the GPS — the 5-minute stability proof was
  obtained with the radio asleep (`test_gps_power` never transmits), whereas
  `collar.cpp` transmits every 3 s holding ~120 mA for 185 ms at SF9, the same
  class of current spike that tripped the gateway's brownout detector. Diagnostic
  in flight: `SEND_INTERVAL_MS` raised to 30000. If `sats` climbs and holds at
  30 s but collapses at 3 s, the transmit is the cause.
- `collar.cpp` `SEND_INTERVAL_MS` must be reverted to 3000.
- Gateway TLS heap degradation unfixed (batching or connection reuse).
- Gateway brownout cause is suspected only, not confirmed.
- Multi-fence breach logic is wrong: `detect_geofence_events` flags a breach when
  outside ANY active fence, while `packet.h` defines breach as outside EVERY
  fence. The two agree only with exactly one active fence.
- `app/supabase/schema.sql` still does not describe the live database.
- `UplinkPacket.battery` is hardcoded to 85; there is no fuel gauge, so
  `collars.battery_level` is not a measurement and the low_battery alert is
  untestable.
- `gpsEpoch` is always 0, so `location_logs.timestamp` is the server's upload
  time, 1–3 s late.
- DIO0 is physically on GPIO2 rather than GPIO26; worked around in software in
  all three sketches, never rewired.
- `app/supabase/gateway_ingest.sql` is incompatible with the live DB and is
  retained only as design notes.
- Cross-check note: the working tree also carries uncommitted changes not
  mentioned in this session's summary — `app/eas.json` (staged as added),
  `app/app.json`, `app/package.json`, `app/package-lock.json`, `app/README.md`,
  `app/src/components/map/RanchMap.native.tsx`,
  `app/src/components/map/RanchMap.types.ts`,
  `app/src/components/map/FenceDrawingPanel.tsx`, `app/src/hooks/useAlarm.tsx`,
  `firmware/.vscode/extensions.json`, deletion of `firmware/TEST CODES /gps.cpp`,
  and additions of `firmware/src/secrets.h.example` and `firmware/logs/`. Several
  have file timestamps predating this session. Which session produced them is
  Not recorded.
