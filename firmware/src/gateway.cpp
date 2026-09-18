// ===========================================================================
//  FarmTrack GATEWAY
// ---------------------------------------------------------------------------
//  Listens for a collar's LoRa uplink, forwards it to Supabase over WiFi
//  (the ESP32-WROOM-32 has WiFi built in - no extra module needed), and
//  relays the fence state Supabase computed right back to that collar over
//  LoRa so it can buzz immediately.
//
//  Real WiFi/Supabase/gateway credentials live in secrets.h (gitignored - never
//  committed). Copy secrets.h.example to secrets.h and fill in your real
//  values before flashing.
//
//  Build/flash:  pio run -e gateway -t upload -t monitor
// ===========================================================================

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "pins.h"
#include "packet.h"
#include "secrets.h" // WIFI_SSID, WIFI_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY, GATEWAY_SECRET

static void deviceIdToHex(uint32_t id, char* out) {
  sprintf(out, "FT-%08X", id);
}

// POSTs one reading to ingest_telemetry() and reads back the fence state it
// returns for this device_id. Returns false on any network/parse failure -
// caller should not send a downlink reply in that case.
static bool uploadReading(const UplinkPacket& pkt, int rssi, float snr, FenceState& outState) {
  if (WiFi.status() != WL_CONNECTED) return false;

  char deviceIdHex[16];
  deviceIdToHex(pkt.deviceId, deviceIdHex);

  JsonDocument body;
  body["p_gateway_key"] = GATEWAY_SECRET;
  JsonArray readings = body["p_readings"].to<JsonArray>();
  JsonObject r = readings.add<JsonObject>();
  r["device_id"] = deviceIdHex;
  r["seq"]       = pkt.seq;
  r["ts"]        = pkt.gpsEpoch;
  r["fix"]       = (pkt.flags & 0x01) != 0;
  r["lat"]       = pkt.latE7 / 1e7;
  r["lng"]       = pkt.lngE7 / 1e7;
  r["battery"]   = pkt.battery;
  r["rssi"]      = rssi;
  r["snr"]       = snr;

  String payload;
  serializeJson(body, payload);

  WiFiClientSecure client;
  client.setInsecure(); // TODO: pin the real root CA before real deployment

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/ingest_telemetry";
  http.begin(client, url);
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(payload);

  bool ok = false;
  if (code == 200) {
    String resp = http.getString();
    JsonDocument respDoc;
    if (deserializeJson(respDoc, resp) == DeserializationError::Ok && respDoc.is<JsonArray>()) {
      for (JsonObject item : respDoc.as<JsonArray>()) {
        if (strcmp(item["device_id"], deviceIdHex) == 0) {
          outState = (FenceState)(int)item["state"];
          ok = true;
          break;
        }
      }
    } else {
      Serial.printf("bad response JSON: %s\n", resp.c_str());
    }
  } else {
    Serial.printf("upload failed, HTTP %d: %s\n", code, http.getString().c_str());
  }
  http.end();
  return ok;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  delay(1000);
  Serial.println("\n=== FarmTrack GATEWAY ===");

  LoRa.setPins(PIN_LORA_SS, PIN_LORA_RST, PIN_LORA_DIO0);
  if (!LoRa.begin(LORA_FREQ_HZ)) {
    Serial.println("LoRa FAILED - check 3V3 power, SPI wiring (18/19/23), NSS/RST/DIO0");
    while (true) delay(1000);
  }
  LoRa.setSyncWord(LORA_SYNC_WORD);
  Serial.println("LoRa OK, listening...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED
    ? (" connected, IP=" + WiFi.localIP().toString())
    : " FAILED (will keep retrying in the background - LoRa readings are dropped, not queued, until it connects)");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    static uint32_t lastRetry = 0;
    if (millis() - lastRetry > 10000) {
      lastRetry = millis();
      WiFi.reconnect();
    }
  }

  int packetSize = LoRa.parsePacket();
  if (packetSize != sizeof(UplinkPacket)) return;

  UplinkPacket pkt{};
  LoRa.readBytes((uint8_t*)&pkt, sizeof(pkt));
  int   rssi = LoRa.packetRssi();
  float snr  = LoRa.packetSnr();
  if (pkt.version != PROTO_VERSION) return;

  digitalWrite(PIN_LED, HIGH);
  Serial.printf("RX from %08X seq=%u fix=%d rssi=%d snr=%.1f\n",
                pkt.deviceId, pkt.seq, pkt.flags & 0x01, rssi, snr);

  FenceState state = FENCE_STATE_SAFE;
  if (!uploadReading(pkt, rssi, snr, state)) {
    Serial.println("no state to relay back - skipping downlink reply this cycle");
    digitalWrite(PIN_LED, LOW);
    return;
  }

  DownlinkPacket reply{};
  reply.version  = PROTO_VERSION;
  reply.deviceId = pkt.deviceId;
  reply.state    = state;

  LoRa.beginPacket();
  LoRa.write((uint8_t*)&reply, sizeof(reply));
  LoRa.endPacket();
  Serial.printf("TX reply state=%d\n", state);
  digitalWrite(PIN_LED, LOW);
}
