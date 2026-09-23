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
#include "pins.h"
#include "packet.h"

TinyGPSPlus    gps;
HardwareSerial gpsUart(2);

static uint32_t   deviceId;
static uint16_t   seqCounter = 0;
static FenceState lastState  = FENCE_STATE_SAFE;

// --- buzzer patterns -------------------------------------------------------
static void buzzPattern(FenceState state) {
  switch (state) {
    case FENCE_STATE_WARNING:
      tone(PIN_BUZZER, 1400, 150);
      break;
    case FENCE_STATE_BREACH:
      for (int i = 0; i < 3; i++) {
        tone(PIN_BUZZER, 2000, 120);
        delay(160);
      }
      break;
    default:
      noTone(PIN_BUZZER);
      break;
  }
}

// --- uplink + wait for the matching downlink reply -------------------------
static bool sendUplinkAndAwaitReply(uint32_t timeoutMs) {
  UplinkPacket pkt{};
  pkt.version  = PROTO_VERSION;
  pkt.deviceId = deviceId;
  pkt.seq      = seqCounter++;
  pkt.battery  = 85; // TODO: real reading once a fuel gauge is wired up (no battery on the bench prototype yet)

  bool hasFix = gps.location.isValid() && gps.location.age() < 5000;
  // Satellites ride along in the spare flag bits so the gateway can print
  // them. Without this a stalled acquisition is indistinguishable from a
  // dead antenna - both just show fix=0.
  uint8_t sats = gps.satellites.isValid() ? (uint8_t)gps.satellites.value() : 0;
  if (sats > 31) sats = 31;
  pkt.flags    = (hasFix ? 0x01 : 0x00) | (uint8_t)(sats << 1);
  pkt.gpsEpoch = 0; // TODO: convert TinyGPSPlus date/time to unix epoch; server timestamps with its own clock meanwhile
  pkt.latE7    = hasFix ? (int32_t)(gps.location.lat() * 1e7) : 0;
  pkt.lngE7    = hasFix ? (int32_t)(gps.location.lng() * 1e7) : 0;

  LoRa.idle(); // wake the radio from the sleep it was left in last cycle
  LoRa.beginPacket();
  LoRa.write((uint8_t*)&pkt, sizeof(pkt));
  LoRa.endPacket();
  Serial.printf("TX seq=%u fix=%d sats=%u lat=%.6f lng=%.6f\n",
                pkt.seq, hasFix, sats, pkt.latE7 / 1e7, pkt.lngE7 / 1e7);

  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    int packetSize = LoRa.parsePacket();
    if (packetSize == sizeof(DownlinkPacket)) {
      DownlinkPacket reply{};
      LoRa.readBytes((uint8_t*)&reply, sizeof(reply));
      if (reply.version == PROTO_VERSION && reply.deviceId == deviceId) {
        lastState = (FenceState)reply.state;
        Serial.printf("RX state=%d\n", reply.state);
        LoRa.sleep(); // done for this cycle - free the ~10mA the radio draws idling in RX
        return true;
      }
      // Not for us (another collar's reply, if more than one shares this channel) - keep waiting.
    }
  }
  Serial.println("no reply from gateway (out of range, or gateway offline/no WiFi)");
  LoRa.sleep();
  return false;
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

  deviceId = (uint32_t)(ESP.getEfuseMac() & 0xFFFFFFFF);
  Serial.printf("\n=== FarmTrack COLLAR  id=FT-%08X ===\n", deviceId);
  Serial.println("Register this exact ID in Supabase: collars.device_hardware_id = 'FT-<id above>'");

  gpsUart.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ_HZ)) {
    Serial.println("LoRa FAILED - check 3V3 power, SPI wiring (18/19/23), NSS/RST/DIO0");
    while (true) delay(1000);
  }
  // Enable the LoRa payload CRC. The library leaves it off by default, which
  // means a packet corrupted in transit is handed to the application as if it
  // were valid - and the only checks here are size and version, so flipped bits
  // in deviceId or flags sail straight through. At the edge of range that
  // produced phantom collars and bogus "fix=1 sats=10" readings. With CRC on,
  // the radio drops damaged packets itself and parsePacket() never returns them.
  LoRa.enableCrc();
  // Spreading factor 9 rather than the library's default of 7. Measured noise
  // floor at this site is about -86dBm (35dB above thermal - 433MHz ISM is
  // shared with car remotes and gate openers), which at SF7 left the link
  // failing below RSSI -90. SF9 lowers the demodulator's SNR limit from
  // -7.5dB to -12.6dB, roughly doubling usable range, at 185ms airtime per
  // packet - 6% duty cycle on a 3-second interval. BOTH BOARDS MUST MATCH:
  // a mismatched spreading factor means neither can hear the other at all.
  LoRa.setSpreadingFactor(9);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  Serial.println("LoRa OK");
}

void loop() {
  while (gpsUart.available() > 0) gps.encode(gpsUart.read());

  // DIAGNOSTIC (revert to 3000 once the GPS question is settled): each LoRa
  // transmit holds ~120mA for 185ms at SF9, and that spike is the prime suspect
  // for knocking the NEO-6M out of lock - the GPS was proven stable for 5
  // minutes only with the radio asleep. At 30s the receiver gets ten times the
  // quiet tracking time between disturbances. If sats climbs and HOLDS at this
  // interval but collapses at 3000, the transmit is the cause.
  static const uint32_t SEND_INTERVAL_MS = 30000;

  static uint32_t lastSend = 0;
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    // HTTPS round trip on the gateway (TLS handshake + Supabase call) commonly
    // takes 1-3s on an ESP32, so a short window here misses most replies even
    // though the gateway did get one back in time.
    sendUplinkAndAwaitReply(4000);
    buzzPattern(lastState);
  }
}
