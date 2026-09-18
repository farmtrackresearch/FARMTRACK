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
  pkt.flags    = hasFix ? 0x01 : 0x00;
  pkt.gpsEpoch = 0; // TODO: convert TinyGPSPlus date/time to unix epoch; server timestamps with its own clock meanwhile
  pkt.latE7    = hasFix ? (int32_t)(gps.location.lat() * 1e7) : 0;
  pkt.lngE7    = hasFix ? (int32_t)(gps.location.lng() * 1e7) : 0;

  LoRa.beginPacket();
  LoRa.write((uint8_t*)&pkt, sizeof(pkt));
  LoRa.endPacket();
  Serial.printf("TX seq=%u fix=%d lat=%.6f lng=%.6f\n",
                pkt.seq, hasFix, pkt.latE7 / 1e7, pkt.lngE7 / 1e7);

  uint32_t start = millis();
  while (millis() - start < timeoutMs) {
    int packetSize = LoRa.parsePacket();
    if (packetSize == sizeof(DownlinkPacket)) {
      DownlinkPacket reply{};
      LoRa.readBytes((uint8_t*)&reply, sizeof(reply));
      if (reply.version == PROTO_VERSION && reply.deviceId == deviceId) {
        lastState = (FenceState)reply.state;
        Serial.printf("RX state=%d\n", reply.state);
        return true;
      }
      // Not for us (another collar's reply, if more than one shares this channel) - keep waiting.
    }
  }
  Serial.println("no reply from gateway (out of range, or gateway offline/no WiFi)");
  return false;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  delay(1000);

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
  LoRa.setSyncWord(LORA_SYNC_WORD);
  Serial.println("LoRa OK");
}

void loop() {
  while (gpsUart.available() > 0) gps.encode(gpsUart.read());

  static uint32_t lastSend = 0;
  if (millis() - lastSend >= 3000) {
    lastSend = millis();
    digitalWrite(PIN_LED, HIGH);
    // HTTPS round trip on the gateway (TLS handshake + Supabase call) commonly
    // takes 1-3s on an ESP32, so a short window here misses most replies even
    // though the gateway did get one back in time.
    sendUplinkAndAwaitReply(4000);
    digitalWrite(PIN_LED, LOW);
    buzzPattern(lastState);
  }
}
