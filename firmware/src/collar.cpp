// ===========================================================================
//  FarmTrack COLLAR
// ---------------------------------------------------------------------------
//  GPS fix -> LoRa uplink to the gateway every ~3s, then briefly listens for
//  a downlink reply carrying this collar's current fence state (computed
//  server-side, the same logic that drives the app's map/alerts) and buzzes
//  the piezo accordingly:
//    - warning (near a fence edge)  -> one short beep
//    - breach  (outside every fence) -> three sharp beeps
//  The collar does NOT know where the fences are - it only asks "what's my
//  status?" each cycle. Vibration motor is not wired up yet; add a second
//  case in buzzPattern() once it is.
//
//  Fail-silent by design. A reply only counts if it answers THIS uplink (same
//  seq) and that uplink carried a usable fix. With no GPS, no gateway or no
//  server, the buzzer goes quiet after STALE_AFTER_CYCLES instead of repeating
//  the last alarm forever. Protocol v1 did exactly that: indoors with no fix
//  it beeped BREACH for about two hours.
//
//  Wiring: NEO-6M GPS + SX1278 LoRa as in pins.h, plus a piezo buzzer on
//  PIN_BUZZER (GPIO27).
//
//  Build/flash:  pio run -e collar -t upload -t monitor
// ===========================================================================

#include <Arduino.h>
#include <WiFi.h>
#include <SPI.h>
#include <LoRa.h>
#include <TinyGPSPlus.h>
#include <esp_task_wdt.h>
#include <esp_system.h>
#include "pins.h"
#include "packet.h"
#include "lora_link.h"
#include "reset_reason.h"

// ---- timing ---------------------------------------------------------------
// Each uplink holds ~87mA (17dBm) for 185ms, about 6% of a 3s cycle.
static const uint32_t SEND_INTERVAL_MS = 3000;
// Every interval is jittered by up to +/-10%. Two collars that power up
// together would otherwise transmit at the same instant every cycle and
// collide forever; with jitter a collision is a one-off.
static const uint32_t SEND_JITTER_MS   = SEND_INTERVAL_MS / 10;
// How long to listen after each uplink. The gateway never sends a reply more
// than 3500ms after it heard the uplink, plus ~124ms of downlink airtime.
static const uint32_t REPLY_WINDOW_MS  = 4000;

// ---- alarm policy ---------------------------------------------------------
static const uint8_t STALE_AFTER_CYCLES = 3; // cycles without a fix-backed reply before going silent
static const uint8_t DEESCALATE_AFTER   = 2; // lower replies in a row before the beep level drops
// Cycles in a row with no reply at all before re-initialising the radio. An
// SX1278 that browns out comes back in its power-on state (wrong spreading
// factor and sync word) and hears nothing until it is set up again.
static const uint8_t RADIO_REINIT_AFTER = 5;

// ---- fix quality gate -----------------------------------------------------
// With 3 satellites or HDOP above ~5 a NEO-6M still reports positions, just
// tens of metres off - enough to fake a breach from the middle of a paddock
// with a 30m warning buffer. 4 satellites is the minimum for a 3D fix.
static const uint32_t FIX_MAX_AGE_MS    = 5000;
static const uint32_t FIX_MIN_SATS      = 4;
static const int32_t  FIX_MAX_HDOP_X100 = 500;   // HDOP 5.0 (TinyGPSPlus stores hdop * 100)
static const uint32_t TIME_MAX_AGE_MS   = 2000;  // GPS date/time older than this is not sent

static const uint32_t WDT_TIMEOUT_S = 30;

// GPS power-save (u-blox cyclic tracking): lower current once locked, but
// slower re-acquisition. Off until it has been field-tested.
#ifndef GPS_POWER_SAVE
#define GPS_POWER_SAVE 0
#endif

TinyGPSPlus    gps;
HardwareSerial gpsUart(2);
// Field 4 of $GPTXT carries the NEO-6M's boot banner ("u-blox ag -
// www.u-blox.com"). TinyGPSPlus truncates fields to 14 characters, so it is
// matched by prefix. Seeing it means the module restarted - usually a
// brownout - and threw away its fix.
TinyGPSCustom  gpsTxt(gps, "GPTXT", 4);

static uint32_t   deviceId;
static uint16_t   seqCounter         = 0;
static FenceState buzzState          = FENCE_STATE_SAFE; // what the buzzer is signalling
static uint8_t    cyclesWithoutState = 0;   // cycles since the last fix-backed reply
static uint8_t    lowerRun           = 0;   // replies in a row below buzzState
static FenceState lowerMax           = FENCE_STATE_SAFE;  // highest of those lower replies
static uint8_t    missedReplies      = 0;   // cycles in a row with no reply at all
static uint32_t   lastPassedChecksum = 0;
static bool       gpsRestartSeen     = false;

#if GPS_POWER_SAVE
// UBX-CFG-RXM lpMode=1 (Power Save Mode). Held only in the module's RAM, so it
// is re-sent whenever the boot banner shows the module has restarted.
static const uint8_t UBX_CFG_RXM_POWER_SAVE[] = {0xB5, 0x62, 0x06, 0x11, 0x02, 0x00, 0x08, 0x01, 0x22, 0x92};
static bool gpsPowerSavePending = true;
#endif

// --- GPS -------------------------------------------------------------------
// Drain the UART into the parser. Called from every wait (reply window,
// transmit, beeps): at 9600 baud a 4s wait with nobody reading used to
// overflow the UART buffer and cost whole sentences every cycle.
static void feedGps() {
  while (gpsUart.available() > 0) {
    if (gps.encode(gpsUart.read()) && gpsTxt.isUpdated() &&
        strncmp(gpsTxt.value(), "u-blox ag", 9) == 0) {
      gpsRestartSeen = true;
#if GPS_POWER_SAVE
      gpsPowerSavePending = true;
#endif
    }
  }
}

static void delayFeedingGps(uint32_t ms) {
  uint32_t start = millis();
  while (millis() - start < ms) {
    feedGps();
    delay(1);
  }
}

static bool gpsFixUsable(uint32_t satsUsed) {
  return gps.location.isValid() && gps.location.age() < FIX_MAX_AGE_MS &&
         satsUsed >= FIX_MIN_SATS &&
         gps.hdop.isValid() && gps.hdop.value() <= FIX_MAX_HDOP_X100;
}

// Days since 1970-01-01 for a proleptic Gregorian date (H. Hinnant's algorithm).
static int32_t daysFromCivil(int32_t y, uint32_t m, uint32_t d) {
  y -= m <= 2;
  const int32_t  era = (y >= 0 ? y : y - 399) / 400;
  const uint32_t yoe = (uint32_t)(y - era * 400);
  const uint32_t doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
  const uint32_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int32_t)doe - 719468;
}

// Unix time of the current fix, or 0 when it can't be trusted. TinyGPSPlus
// marks the date valid even when the RMC date field was empty (date 0, read
// as year 2000), and a module that hasn't synced time yet reports 1980, which
// the two-digit year turns into 2080 - hence both year bounds. This is the
// time the position was measured, which is what the server should store.
static uint32_t gpsUnixTime() {
  if (!gps.date.isValid() || !gps.time.isValid()) return 0;
  if (gps.date.age() >= TIME_MAX_AGE_MS || gps.time.age() >= TIME_MAX_AGE_MS) return 0;
  uint16_t y = gps.date.year();
  uint8_t  mo = gps.date.month(), d = gps.date.day();
  if (y < 2024 || y > 2079 || mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  return (uint32_t)daysFromCivil(y, mo, d) * 86400UL +
         gps.time.hour() * 3600UL + gps.time.minute() * 60UL + gps.time.second();
}

// --- battery -----------------------------------------------------------------
#if BATTERY_SENSE_ENABLED
// Resting 1S LiPo voltage -> charge, interpolated. Approximate: a cell under
// load reads low, so it is sampled before the transmit, with the radio asleep.
static const uint16_t LIPO_MV[]  = {4200, 4110, 4020, 3950, 3870, 3840, 3800, 3770, 3730, 3690, 3610, 3270};
static const uint8_t  LIPO_PCT[] = { 100,   90,   80,   70,   60,   50,   40,   30,   20,   10,    5,    0};
#endif

static uint8_t readBatteryPercent() {
#if BATTERY_SENSE_ENABLED
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += analogReadMilliVolts(PIN_BATTERY_ADC);
  uint32_t mv = (uint32_t)((sum / 16) * BATTERY_DIVIDER_RATIO);
  if (mv >= LIPO_MV[0]) return 100;
  const int n = sizeof(LIPO_MV) / sizeof(LIPO_MV[0]);
  for (int i = 1; i < n; i++) {
    if (mv >= LIPO_MV[i]) {
      return LIPO_PCT[i] + (uint8_t)((mv - LIPO_MV[i]) * (uint32_t)(LIPO_PCT[i - 1] - LIPO_PCT[i]) /
                                     (uint32_t)(LIPO_MV[i - 1] - LIPO_MV[i]));
    }
  }
  return 0;
#else
  return BATTERY_UNKNOWN;
#endif
}

// --- buzzer patterns -------------------------------------------------------
static void buzzPattern(FenceState state) {
  switch (state) {
    case FENCE_STATE_WARNING:
      tone(PIN_BUZZER, 1400, 150);
      break;
    case FENCE_STATE_BREACH:
      for (int i = 0; i < 3; i++) {
        tone(PIN_BUZZER, 2000, 120);
        delayFeedingGps(160);
      }
      break;
    default:
      noTone(PIN_BUZZER);
      break;
  }
}

// Escalate at once - a breach must be heard on the first reply that says so.
// Step down only after DEESCALATE_AFTER lower replies in a row, so a position
// jittering across a boundary doesn't make the buzzer flap every cycle. (The
// server adds its own 3m hysteresis; this is just for the sound.)
static void applyServerState(FenceState s) {
  FenceState before = buzzState;
  if (s > buzzState) {
    buzzState = s;
    lowerRun  = 0;
  } else if (s == buzzState) {
    lowerRun = 0;
  } else {
    lowerMax = (lowerRun == 0 || s > lowerMax) ? s : lowerMax;
    if (++lowerRun >= DEESCALATE_AFTER) {
      buzzState = lowerMax;
      lowerRun  = 0;
    }
  }
  if (buzzState != before) Serial.printf("alarm level %d -> %d\n", before, buzzState);
}

// --- radio -----------------------------------------------------------------
static void radioStartOrRestart() {
  if (loraBeginLink()) return;
  // Hanging here (as v1 did) leaves a collar that looks alive but never
  // transmits. A restart retries from a clean state, and the reset reason
  // (SW) plus this line explain it in the log.
  Serial.println("LoRa FAILED - check 3V3 power, SPI wiring (18/19/23), NSS/RST/DIO0 - restarting in 5s");
  delay(5000);
  ESP.restart();
}

static void radioReinit(const char* why) {
  Serial.printf("radio re-init: %s\n", why);
  LoRa.end();
  radioStartOrRestart();
  LoRa.sleep();
}

// Listens until a reply to THIS uplink arrives or the window closes. Anything
// else - another collar's reply, a late reply to an earlier seq - is skipped.
static bool awaitReply(uint16_t seq, uint32_t windowMs, uint8_t& stateOut) {
  // Clear a stale RX_DONE first. A packet that finished in the last moment of
  // the previous window leaves the flag set, and nothing on the transmit path
  // clears it - but the FIFO now holds THIS uplink. The first parsePacket()
  // would then hand back our own first 8 bytes as a reply: right version, id
  // and seq, with the low byte of gpsEpoch as the "state" - a BREACH beep the
  // server never sent. The radio has not listened since that window closed,
  // so no genuine reply can be waiting here.
  LoRa.parsePacket();
  uint32_t start = millis();
  while (millis() - start < windowMs) {
    feedGps();
    int len = LoRa.parsePacket();
    if (len == sizeof(DownlinkPacket)) {
      DownlinkPacket reply{};
      LoRa.readBytes((uint8_t*)&reply, sizeof(reply));
      if (reply.version == PROTO_VERSION && reply.deviceId == deviceId &&
          reply.seq == seq && reply.state <= FENCE_STATE_BREACH) {
        stateOut = reply.state;
        Serial.printf("RX state=%d seq=%u\n", reply.state, reply.seq);
        return true;
      }
      Serial.printf("RX ignored: reply ver=%u id=%08X seq=%u state=%u (waiting for seq=%u)\n",
                    reply.version, (unsigned)reply.deviceId, reply.seq, reply.state, seq);
    } else if (len > 0) {
      Serial.printf("RX ignored: %d-byte packet, not a reply (rssi=%d)\n", len, LoRa.packetRssi());
    }
    delay(1);
  }
  return false;
}

// --- one uplink / reply cycle ----------------------------------------------
static void sendCycle() {
  feedGps();
  uint32_t satsUsed = gps.satellites.isValid() ? gps.satellites.value() : 0;
  bool     hasFix   = gpsFixUsable(satsUsed);
  uint8_t  satsBits = satsUsed > UPLINK_SATS_MASK ? UPLINK_SATS_MASK : (uint8_t)satsUsed;
  // Two health bits so the server can tell a silent GPS from one that is
  // talking but has no fix, and see brownout restarts.
  uint32_t passed = gps.passedChecksum();
  bool gpsOk      = passed != lastPassedChecksum;
  lastPassedChecksum = passed;
  bool gpsRestarted  = gpsRestartSeen;
  gpsRestartSeen     = false;

  UplinkPacket pkt{};
  pkt.version  = PROTO_VERSION;
  pkt.deviceId = deviceId;
  pkt.seq      = seqCounter++;
  pkt.gpsEpoch = hasFix ? gpsUnixTime() : 0;
  pkt.latE7    = hasFix ? (int32_t)(gps.location.lat() * 1e7) : 0;
  pkt.lngE7    = hasFix ? (int32_t)(gps.location.lng() * 1e7) : 0;
  pkt.battery  = readBatteryPercent();   // before TX: the cell sags while transmitting
  pkt.flags    = (hasFix ? UPLINK_FLAG_FIX : 0) | (uint8_t)(satsBits << UPLINK_SATS_SHIFT) |
                 (gpsOk ? UPLINK_FLAG_GPS_OK : 0) | (gpsRestarted ? UPLINK_FLAG_GPS_RESTART : 0);

  // Uplinks and replies both use normal IQ, as v1 did. Inverted-IQ replies
  // were tried in v2 and this collar never decoded one on the bench (27 Sep
  // 2026), while normal-IQ replies are proven on this hardware. Other
  // collars' uplinks can't pass for a reply anyway: awaitReply() accepts only
  // an 8-byte packet with this collar's id and this uplink's seq.
  bool sent = loraSend((const uint8_t*)&pkt, sizeof(pkt));
  Serial.printf("TX seq=%u fix=%d sats=%u lat=%.6f lng=%.6f hdop=%.1f bat=%u gps_ok=%d gps_rst=%d\n",
                pkt.seq, hasFix, satsBits, pkt.latE7 / 1e7, pkt.lngE7 / 1e7,
                gps.hdop.isValid() ? gps.hdop.hdop() : 99.99, pkt.battery, gpsOk, gpsRestarted);

  bool    gotReply = false;
  uint8_t state    = FENCE_STATE_SAFE;
  if (sent) {
    gotReply = awaitReply(pkt.seq, REPLY_WINDOW_MS, state);
  } else {
    radioReinit("transmit did not finish");
  }
  LoRa.sleep(); // done for this cycle - free the ~10mA the radio draws idling in RX

  if (gotReply) {
    missedReplies = 0;
  } else {
    Serial.println("no reply from gateway (out of range, or gateway offline/no WiFi)");
    if (++missedReplies >= RADIO_REINIT_AFTER) {
      radioReinit("no reply for 5 cycles in a row");
      missedReplies = 0;
    }
  }

  // A state is only as good as the position behind it. The server answers a
  // no-fix uplink with SAFE anyway; ignoring it here as well means an
  // old fix can never keep the alarm going.
  if (gotReply && hasFix) {
    cyclesWithoutState = 0;
    applyServerState((FenceState)state);
  } else {
    if (gotReply) Serial.println("reply ignored: this uplink had no usable fix");
    if (cyclesWithoutState < 255) cyclesWithoutState++;
    if (cyclesWithoutState >= STALE_AFTER_CYCLES && buzzState != FENCE_STATE_SAFE) {
      Serial.printf("no fix-backed reply for %u cycles - buzzer silenced\n", cyclesWithoutState);
      buzzState = FENCE_STATE_SAFE;
      lowerRun  = 0;
    }
  }
  buzzPattern(buzzState);
}

void setup() {
  Serial.begin(115200);
  // NOT an output: on this build the SX1278's DIO0 lands on GPIO2, which is
  // also the onboard LED pin. Driving it while the radio drives it too shorts
  // two push-pull outputs together and collapses the 3V3 rail - which the GPS
  // shares, so it browns out and never holds a fix. Leaving it as an input
  // removes the contention. Proper fix: move the DIO0 jumper to GPIO26, as
  // pins.h specifies, then this can go back to being the activity LED.
  pinMode(PIN_LED, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  delay(1000);

  // Watchdog: if loop() stops coming round for 30s (a wedged SPI bus, a
  // library spinning forever), reboot rather than sit there silent. A normal
  // cycle is under 6s.
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);

  // --- power budget --------------------------------------------------------
  // The NEO-6M browns out and reboot-loops when the 5V rail sags, which it
  // does whenever the board draws more than the USB supply comfortably gives.
  // A rebooting GPS can never hold reception long enough to get a fix, so the
  // collar sheds everything it does not need: the collar talks LoRa only, so
  // both onboard radios stay off, and 80MHz is ample for a 3-second duty
  // cycle. Peripheral clocks run off the 80MHz APB either way, so SPI and the
  // GPS UART are unaffected. Worth keeping on battery regardless of the rail.
  WiFi.mode(WIFI_OFF);
  btStop();
  setCpuFrequencyMhz(80);

  // Warm up the LEDC channel tone()/noTone() use, so the very first noTone()
  // call (before any tone() has run) doesn't log a harmless-but-noisy
  // "LEDC is not initialized" error.
  tone(PIN_BUZZER, 1000, 10);
  delay(15);
  noTone(PIN_BUZZER);

  // Bits 16-47 of the factory MAC. The low 32 bits used by v1 are three bytes
  // of Espressif's vendor prefix (identical on every board) plus ONE
  // chip-specific byte, so any two collars had a 1-in-256 chance of the same
  // ID. These 32 bits hold all three chip-specific bytes.
  uint64_t mac = ESP.getEfuseMac();
  deviceId = (uint32_t)(mac >> 16);
  Serial.printf("\n=== FarmTrack COLLAR  id=FT-%08X ===\n", deviceId);
  Serial.printf("reset reason: %s\n", resetReasonName(esp_reset_reason()));
  Serial.println("Register this exact ID in Supabase: collars.device_hardware_id = 'FT-<id above>'");
  Serial.printf("(v1 firmware called this collar FT-%08X - see app/supabase/rekey_collar.sql)\n",
                (uint32_t)(mac & 0xFFFFFFFF));

  // Enlarged before begin(): the default 256 bytes is ~0.27s of NMEA at 9600
  // baud, and a send cycle keeps the CPU busy for longer than that.
  gpsUart.setRxBufferSize(1024);
  gpsUart.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

#if BATTERY_SENSE_ENABLED
  analogSetPinAttenuation(PIN_BATTERY_ADC, ADC_11db);
#endif

  radioStartOrRestart();
  LoRa.sleep();
  Serial.println("LoRa OK");
}

void loop() {
  esp_task_wdt_reset();
  feedGps();

#if GPS_POWER_SAVE
  if (gpsPowerSavePending) {
    gpsUart.write(UBX_CFG_RXM_POWER_SAVE, sizeof(UBX_CFG_RXM_POWER_SAVE));
    gpsPowerSavePending = false;
  }
#endif

  static uint32_t lastSend = 0;
  static uint32_t interval = SEND_INTERVAL_MS;
  if (millis() - lastSend >= interval) {
    lastSend = millis();
    interval = SEND_INTERVAL_MS - SEND_JITTER_MS + esp_random() % (2 * SEND_JITTER_MS + 1);
    sendCycle();
  }
  delay(1);
}
