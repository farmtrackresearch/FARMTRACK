# Night collar field test — GPS fix, LoRa range at SF9, end-to-end delivery

**Site:** Sibulan, Negros Oriental — beside Western Nautical Hwy (national road).
Buildings on one side, highway on the other.
**Window:** ~00:30 local, one operator, about one hour.
**Run folder:** `docs/field-tests/runs/2026-09-24-night-collar/`

## Objective

Three measurements, in this order, in one session without ever power-cycling
the collar:

1. **GPS** — time to first fix from the current state, satellite count
   progression, and position precision/accuracy at a fixed reference point.
2. **LoRa range at SF9** — RSSI, SNR and packet delivery ratio at a ladder of
   measured distances, to find where the link now fails and compare it with
   the SF7 baseline (worked to about RSSI -91).
3. **End-to-end delivery** — confirm positions actually reach
   `public.location_logs`, not merely that the gateway printed an RX line.

## Build under test

| Item | Value |
|---|---|
| Collar env | `collar` (already flashed — do not reflash tonight) |
| Gateway env | `gateway` (already flashed — do not reflash tonight) |
| Git commit | `3a51f8e` |
| Source fingerprint | `collar.cpp` md5 `1e9b57c16a17db619aedf95d5ef09526`, `gateway.cpp` md5 `b34907b0793ff103d7f8e505ce04d6e7`, `pins.h` md5 `50e9d04f31305294b93b60628b05da20`, `packet.h` md5 `2e1a451d624a55c2f938a9d3465b0b4a` |
| Radio | 433 MHz, **SF9**, payload **CRC on**, sync word **0xF3**, TX power 17 dBm (library default, never set in code) |
| GPS | NEO-6M (GY-GPS6MV2), 9600 baud, UART2 |
| Collar device ID | `FT-EC82C34C`, paired to livestock "Bessie" |
| Ports | gateway `/dev/cu.usbserial-1120`; collar `/dev/cu.usbserial-1130` (**must not appear tonight**) |

> **The commit hash does not identify this firmware.** `collar.cpp`,
> `gateway.cpp` and `packet.h` are untracked and `pins.h` is modified, so
> `3a51f8e` describes a tree that does not contain the code being tested. The
> md5 fingerprints above are the only real identifier for tonight's build.
> Commit the firmware after the test so future runs can cite a hash.

**No reflashing is required for any phase.** Both boards already run the
environments they need, and both are already at SF9 with CRC enabled.

## Hard rules — break one of these and the measurement is void

1. **Never power-cycle, unplug, reset or tether the collar.** It is on a USB
   power bank, uninterrupted for 20+ minutes, and the GPS is accumulating
   almanac data. A reboot restarts a cold start that can take up to 12.5
   minutes and would end the session. In particular: do **not** plug the collar
   into the Mac. Confirm `/dev/cu.usbserial-1130` never appears.
2. **The gateway is the opposite — reset it deliberately and often.** HTTPS
   uploads degrade from TLS heap fragmentation at roughly 17–20 minutes of
   gateway uptime. Press **EN** on the gateway board at the start of each
   phase. The reset costs about 10 seconds of uploads and nothing else.
3. **RSSI, SNR and PDR stay valid even while uploads are failing.**
   `gateway.cpp` prints its `RX from ...` line at line 154, *before* it attempts
   the upload at line 159. Only the Supabase delivery numbers in Phase 3 are
   affected by upload failure.
4. **Do not use `location_logs.timestamp` as a fix time.** `collar.cpp` always
   sends `gpsEpoch = 0`, so the server stamps rows with its own clock at upload
   time, 1–3 s after the reading. It is an upload timestamp.
5. **Any RSSI reading taken before tonight, at marginal signal, is
   untrustworthy.** Payload CRC was off, so corrupted packets were accepted as
   valid and produced phantom device IDs and bogus fix/sats values. Tonight's
   numbers supersede them; the SF7 "-91" figure is an approximate reference,
   not a clean measurement.
6. **Record the phone-to-laptop clock offset** (Phase 0, step 5). Every range
   number depends on matching your phone-noted times to the laptop-stamped log.
   Get this wrong and every per-point result is attributed to the wrong
   distance.
7. **Only `fix=1` readings create a `location_logs` row.** Until the GPS locks,
   Supabase stores nothing at all, however healthy the radio looks.

## Expected nuisance: the collar will beep

Once the GPS locks, the collar sits outside Fence 1 (a ~60 m box near
9.36438, 123.27160), so Supabase will return BREACH and the collar will sound
three sharp beeps every cycle. **This is correct behaviour, not a fault.** It
will also write `alerts` rows for the whole session.

Put a strip of tape over the buzzer or carry the collar in a pocket before
walking out — it is 00:30 in a residential area. Muffling the buzzer affects
nothing measured tonight. Write the start and end time of the session in
`notes.md` so these test alerts can be identified and ignored later.

## Safety

**Highway at night is the main hazard of this test.**

- Wear light or reflective clothing. Carry the phone torch on, facing traffic.
- Walk on the shoulder, **facing oncoming traffic**, never on the carriageway.
- Do not read the phone while walking. Stop, step well clear of the road, then
  look at the screen.
- Pick every measurement point on the **building side** of the road where
  possible. Never cross the highway to reach a point.
- Tell a teammate you are going out and share live location with them.
- If a vehicle slows near you, or dogs approach, abandon the point and return.
  A missing data point is cheap; the walk can be repeated tomorrow.
- Hard turn-back time: 25 minutes into Phase 2, wherever you have reached.

LiPo note: the collar is on a USB power bank tonight, not a bare LiPo cell, so
the usual TP4056/DW01 discharge precautions do not apply to this run. Do not
leave any cell charging unattended afterwards.

---

# Procedure

## Phase 0 — Setup (indoors, ~8 minutes)

**1. Confirm the collar is still untethered.**

```
ls /dev/cu.usbserial-*
```

Expect **only** `/dev/cu.usbserial-1120`. If `-1130` is listed, someone has
plugged the collar into the Mac and it has reset — record the time in
`notes.md`, because TTFF is then measured from that reset.

**2. Restart the gateway monitor with timestamping and file logging.**

Press `Ctrl-C` in the existing monitor window, then run:

```
cd "/Users/kingdarius1874/FARMTRACK v2.4/firmware" && \
/Users/kingdarius1874/.platformio/penv/bin/pio device monitor \
  -p /dev/cu.usbserial-1120 -b 115200 -f time -f log2file
```

This writes `platformio-device-monitor-<date>.log` into `firmware/`. Leave this
window open and untouched for the rest of the night — it is the only record of
the radio link.

**3. Reset the gateway.** Press the **EN** button on the gateway board.

Confirm `=== FarmTrack GATEWAY ===` then `LoRa OK, listening...` then
`connected, IP=...` appear in the monitor. A fresh banner is what makes gateway
uptime computable for every later line.

**4. Confirm the collar is alive and the link is up.** Within ~10 seconds of the
gateway finishing boot you should see lines like:

```
RX from EC82C34C seq=412 fix=0 sats=0 rssi=-58 snr=9.2
TX reply state=0
```

Write down the **seq** and the **laptop time** of the first RX line you see.

**Stop criterion for Phase 0:** you see `RX from EC82C34C` and `TX reply`.
If you see RX lines but no `TX reply`, uploads are failing — press EN again.
If you see no RX lines at all within 60 seconds, the collar has died; record
that and stop the session.

**5. Sync the clocks.** Run this and, at the moment it prints, read your phone's
clock and write both down on the data sheet:

```
date "+%H:%M:%S"
```

Record `phone_time − laptop_time` in seconds, with sign. **Everything in
Phase 2 depends on this number.**

**6. Establish the ground-truth reference point.**

Pick a hard physical feature you can put the collar on and find again: a
building corner, a concrete post, a gate hinge. It must be somewhere the collar
can sit safely in view for 15 minutes and well clear of the road.

On the phone, open Google Maps, switch to satellite view, zoom all the way in,
and **drop the pin on that feature in the imagery** — do not use "my location",
which would just be your phone's own GPS with a similar error to the thing being
measured. Copy the coordinates to 6 decimal places onto the data sheet, and
write down which feature it is and how you identified it.

> Honest limitation, to be repeated in the manuscript: a pin dropped on
> satellite imagery has an unknown absolute georeferencing error of a few
> metres, which is the same order as the NEO-6M error being measured. This
> makes tonight's **accuracy** figure provisional. Tonight's **precision**
> figure (scatter about the collar's own mean) does not depend on the reference
> at all and is the stronger result. Keep the two clearly separate.

## Phase 1 — GPS: TTFF, satellites, precision and accuracy (~20 minutes)

**7. Place the collar at the reference point.** Antenna facing up, clear sky,
nothing over it. Note the **laptop time** and the **seq** on the gateway monitor
at the moment you set it down — this is **t0**, the start of the TTFF clock.

Keep the collar in view from where you are standing. Do not leave it
unattended near the road.

**8. Watch the monitor for the satellite count to climb.** Record, on the data
sheet, the time and seq at which `sats` first reads 1, 4, and 6, and the time
and seq at which `fix` first reads **1**.

> Two independent TTFF clocks, and they disagree for a real reason. Laptop
> timestamps are the primary measurement. The seq counter is a good cross-check
> **only while the gateway is replying**, because the collar's cycle is 3 s when
> it receives a downlink and stretches to ~4 s when it does not (it waits the
> full 4000 ms reply timeout). If `TX reply` lines are present throughout, then
> `TTFF ≈ (seq_fix − seq_t0) × 3 s`. If they are not, use the timestamps only
> and note why.

**Stop criterion:** `fix=1` appears, or 12 minutes elapse from t0.

**Phase 1a succeeds** if `fix=1` is reached and `sats` is 6 or more.
**Phase 1a fails** if 12 minutes pass with `sats=0` — that indicates the GPS
sees nothing (antenna or power, not sky). If it fails, record it and skip to
Phase 2; the radio test does not need a fix.

**9. Static hold — leave the collar untouched at the reference point for 15
minutes from the moment of first fix.** Write the hold start and end times
(laptop clock) on the data sheet.

At **12 minutes** into the hold, press **EN** on the gateway. Position data
reaches Supabase only through the upload path, so a heap-degraded gateway
silently stops the accuracy measurement even though the monitor keeps printing
RX lines. The collar keeps its fix through a gateway reset.

During the hold, record `sats` and `fix` every ~3 minutes on the data sheet as a
spot check.

> 15 minutes at a 3 s cadence gives roughly 300 samples, which is plenty of
> points but **not** 300 independent ones — GPS multipath error drifts on a
> timescale of minutes, so consecutive fixes are strongly correlated. The
> protocol for a full accuracy figure calls for 30+ minutes. Report tonight's
> result as a preliminary CEP50 and say it came from a 15-minute hold.

**10. Collect the collar** and move to Phase 2.

## Phase 2 — LoRa range walk at SF9 (~25 minutes, hard turn-back at 25 min)

**11. Press EN on the gateway** before you leave. Note the laptop time.

**12. Understand your only live link indicator before you go.**

You cannot see the gateway monitor from outdoors. If Phase 1 reached a fix, the
buzzer is a live, ambiguous cue: the collar beeps three times per cycle only
when a downlink reached it, which requires the radio link **and** a successful
upload. So:

- **Beeping** = link definitely alive.
- **Silence** = link lost **or** the gateway's uploads have degraded. You cannot
  tell which in the field. The log tells you afterwards: RX lines present means
  it was the upload path, no RX lines means it was genuinely out of range.

If Phase 1 did not reach a fix, there is no buzzer cue at all — walk the full
ladder and analyse afterwards.

**13. Walk the ladder.** Measurement points, all on the building side of the
road, outbound from the gateway:

| Point | Target distance |
|---|---|
| P1 | ~50 m |
| P2 | ~100 m |
| P3 | ~150 m |
| P4 | ~250 m |
| P5 | ~400 m |

Roughly 65 normal paces is 50 m — use paces only to space the stops, never as
the recorded distance.

**At each point:**

a. Stand still, clear of the road, collar held at chest height, antenna
   vertical, body not between collar and gateway.
b. Note the **start time** from your phone. Wait **90 seconds**. Note the
   **end time**. (90 s is 22–30 packets, enough for a PDR figure to about
   ±4%.)
c. In Google Maps, **drop a pin exactly where you are standing** and label it
   `P1`, `P2`, and so on. Do not try to measure or estimate the distance in the
   field — you will measure it from the pins afterwards with Maps' "Measure
   distance" tool, from the gateway's pin.
d. On the data sheet write: point, phone start time, phone end time, landmark
   description, line of sight yes/no (can you see the building the gateway is
   in?), and whether the buzzer was sounding.

**Stop criterion:** stop walking outbound when **either** the buzzer has stayed
silent through two consecutive complete points — in which case do **one** more
point further out and then stop — **or** 25 minutes have elapsed since you left,
**or** you reach P5.

**Phase 2 succeeds** if you have at least four points with logged packets and at
least one point where PDR has clearly degraded. A run where every point is 100%
PDR at strong RSSI has not found the range limit; that is not a failure of the
system, it is an incomplete measurement, and it should be reported as
"limit not reached beyond <distance>", with a daylight extension scheduled.

**Phase 2 is void** if you cannot produce the phone times per point, or if the
clock offset from step 5 was not recorded.

**14. Walk back and note the laptop time you get indoors.**

## Phase 3 — End-to-end delivery into Supabase (~10 minutes, indoors)

**15. Press EN on the gateway.** This clears the fragmented heap so the delivery
check measures the pipeline rather than a known degradation. Note the laptop
time of the banner.

**16. Put the collar back at the reference point** (or anywhere with sky view
and a strong link) and leave it for **5 minutes**. Note start and end times.
This is the clean window for the delivery measurement.

**17. In the Supabase SQL editor, run the queries in
`docs/field-tests/runs/2026-09-24-night-collar/queries.sql`** and download each
result as CSV into the run folder.

**Phase 3 succeeds** if the number of rows in `location_logs` for the 5-minute
clean window matches the number of `fix=1` RX lines in the gateway log for the
same window, within the duplicate-suppression allowance.
**Phase 3 fails** if rows stop arriving while RX lines continue — that is the
upload path, and the gateway uptime at the first missing row is the number to
report.

**18. Stop the monitor** (`Ctrl-C`) and move the log into the run folder:

```
cd "/Users/kingdarius1874/FARMTRACK v2.4/firmware" && \
mv platformio-device-monitor-*.log \
   "/Users/kingdarius1874/FARMTRACK v2.4/docs/field-tests/runs/2026-09-24-night-collar/"
```

**19. Fill in `notes.md`** in the run folder with conditions: date, local time,
weather, cloud cover, sky view at the reference point, terrain and vegetation,
antenna type and height, how the collar was held, traffic level, who ran it,
and every deviation from this document.

---

# Analysis

**1. Measure the distances.** In Google Maps, use "Measure distance" from the
gateway pin to each of P1–P5. Write the metres into
`runs/2026-09-24-night-collar/points.csv`.

**2. Convert phone times to laptop times** using the offset from step 5:
`laptop_time = phone_time − offset`. Put the converted times in `points.csv`.

**3. Run the link analysis:**

```
cd "/Users/kingdarius1874/FARMTRACK v2.4/docs/field-tests/runs/2026-09-24-night-collar" && \
python3 ../../scripts/analyze_gateway_log.py \
  platformio-device-monitor-*.log --points points.csv --device EC82C34C \
  > results.md && cat results.md
```

**4. Run the GPS queries** in `queries.sql` and paste their output into
`results.md` under a "GPS" heading, keeping precision and accuracy separate.

**5. Update `docs/field-tests/SUMMARY.md`** — one row per metric, with n,
conditions, date and a link to this run.

## Metric definitions

- **TTFF (s)** — laptop-clock seconds from the collar being set down at the
  reference point with clear sky (t0) to the first RX line with `fix=1`. The
  collar was already powered and had been running with `sats=0` indoors, and the
  GPS had been off overnight, so classify this as a **cold start with the
  receiver already powered**, not a warm start.
- **PDR (%)** — `distinct seq received in window ÷ (max_seq − min_seq + 1)`.
  Seq-based deliberately: `seq` increments on every transmit, so this is immune
  to the collar's 3 s→4 s cycle stretch when no downlink arrives. An
  interval-based estimate would understate PDR at exactly the marginal points
  that matter.
- **RSSI / SNR** — per packet as reported by `LoRa.packetRssi()` /
  `packetSnr()`; report median, mean, sd, min, max and n per point.
- **Precision (m)** — distance of each fix from the **mean of the fixes
  themselves**. Independent of the reference point. Report CEP50, p95, max, n.
- **Accuracy (m)** — distance of each fix from the **surveyed reference
  point**. Report CEP50 and p95 together with how the reference was
  established and its own unknown error.
- **Upload success (%)** — `location_logs` rows ÷ RX lines with `fix=1` over the
  same window. Measures the WiFi/TLS path, not the radio.

## Pass criteria

**Not defined.** No numeric pass thresholds for GPS accuracy, TTFF, PDR or
range have been given by the team or the adviser, so none are stated here. Do
not invent them. Ask the adviser what the system is required to achieve and
record the answer before the manuscript quotes any result as a pass or fail.

The one legitimate comparison tonight is the **SF7 baseline measured at this
site**: the link worked to about RSSI -91 and failed at -96/-98 with SNR -10.
SF9 lowers the demodulator SNR limit from -7.5 dB to -12.6 dB, so roughly 5 dB
more link budget is expected. Confirming or refuting that ~5 dB is a result in
itself, independent of any pass threshold. Note that the SF7 figures were taken
before payload CRC was enabled and so are approximate.
