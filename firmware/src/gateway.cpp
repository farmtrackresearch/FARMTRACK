// ===========================================================================
//  FarmTrack GATEWAY
// ---------------------------------------------------------------------------
//  Listens for a collar's LoRa uplink, forwards it to Supabase over WiFi
//  (the ESP32-WROOM-32 has WiFi built in - no extra module needed), and
//  relays the fence state Supabase computed right back to that collar over
//  LoRa so it can buzz immediately.
//
//  Two tasks, so the radio never waits on the network:
//    - loop() (core 1) is the ONLY code that touches the radio. It receives
//      uplinks, timestamps them and queues them, and transmits replies the
//      upload task hands back. v1 did the HTTPS call inline, so the radio
//      was deaf for the whole request - up to two minutes when TLS stalled.
//    - uploadTask (core 0, where the WiFi stack runs) batches queued
//      readings into one POST over a kept-alive TLS connection, with hard
//      timeouts, and returns each collar's state through a reply queue.
//  Readings stay queued while WiFi is down; when the queue is full the oldest
//  is dropped. A task watchdog (60s) reboots the board if either task hangs.
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
#include <esp_task_wdt.h>
#include "pins.h"
#include "packet.h"
#include "lora_link.h"
#include "reset_reason.h"
#include "secrets.h" // WIFI_SSID, WIFI_PASSWORD, SUPABASE_URL, SUPABASE_ANON_KEY, GATEWAY_SECRET

// Debug only: 1 skips server certificate checks. Set it in secrets.h or with
// -DGATEWAY_TLS_INSECURE=1, never in a deployed gateway.
#ifndef GATEWAY_TLS_INSECURE
#define GATEWAY_TLS_INSECURE 0
#endif
#if !GATEWAY_TLS_INSECURE
#include "supabase_ca.h"
#endif

// ---- tuning ---------------------------------------------------------------
// 60s, not the collar's 30: a DNS lookup alone may block for 15s and a
// connect + TLS handshake + request adds up to ~15s more, twice with the retry.
static const uint32_t WDT_TIMEOUT_S          = 60;
static const size_t   UPLOAD_QUEUE_LEN       = 256;   // ~14 min of one collar at 3s
static const size_t   MAX_BATCH              = 64;    // readings per POST
static const size_t   REPLY_QUEUE_LEN        = 16;
// A reply later than this is not sent: the collar stops listening 4000ms
// after its uplink, and the downlink itself takes ~124ms on air.
static const uint32_t REPLY_MAX_AGE_MS       = 3500;
static const uint32_t UPLOAD_TASK_STACK      = 12288; // bytes; TLS handshake is the deep part
static const uint8_t  RESTART_AFTER_FAILURES = 5;
// A gateway that has not reached the server since it booted only restarts
// after this much uptime - see the restart rule in uploadTask().
static const uint32_t RESTART_MIN_UPTIME_MS  = 15UL * 60 * 1000;
static const uint32_t WIFI_FULL_RECONNECT_MS = 60000;
// Units differ, and getting them wrong means a 3000-SECOND timeout:
// WiFiClientSecure takes SECONDS, HTTPClient takes MILLISECONDS.
static const uint32_t TLS_HANDSHAKE_TIMEOUT_S = 5;
static const int32_t  HTTP_CONNECT_TIMEOUT_MS = 3000;
static const uint16_t HTTP_READ_TIMEOUT_MS    = 3000;   // wait for the response headers
static const uint32_t HTTP_BODY_BUDGET_MS     = 3000;   // the WHOLE body, however it trickles in
// A success reply is ~50 bytes per collar and a PostgREST error a few
// hundred. Cloudflare's HTML error pages are bigger, but only their first 200
// characters are ever printed, so anything past this is cut off.
static const size_t   HTTP_BODY_MAX           = 4096;
// Server errors (5xx/408/429, or no answer within the read timeout on a fresh
// connection) on the same batch before it is split in half. At one reading,
// that reading is dropped instead.
static const uint8_t  SERVER_ERRORS_BEFORE_SPLIT = 3;

// One received uplink, stamped with when it arrived (for age_ms and for
// deciding whether a reply is still worth sending).
struct RxItem {
  UplinkPacket pkt;
  int16_t      rssi;
  float        snr;
  uint32_t     rxMillis;
};

// The server's verdict for one collar's newest reading in a batch.
struct ReplyItem {
  uint32_t deviceId;
  uint16_t seq;
  uint32_t rxMillis;
  uint8_t  state;
};

static QueueHandle_t uploadQueue;
static QueueHandle_t replyQueue;
static TaskHandle_t  uploadTaskHandle;
static String        ingestUrl;

// Owned by uploadTask only. Static so the connection survives between
// requests - v1 built a new client per reading, i.e. a full TLS handshake
// every 3 seconds, and fragmented the heap until requests failed (~20 min).
static WiFiClientSecure tlsClient;
static HTTPClient       http;
static RxItem           pending[MAX_BATCH];  // the batch being uploaded (kept until it goes through)
static size_t           pendingCount = 0;
// The response body. A fixed buffer rather than a String, so reading replies
// never grows or fragments the heap.
static char             respBody[HTTP_BODY_MAX + 1];
static size_t           respLen = 0;

static void deviceIdToHex(uint32_t id, char* out, size_t len) {
  snprintf(out, len, "FT-%08X", (unsigned)id);
}

// "FT-" followed by exactly 8 hex digits.
static bool parseDeviceId(const char* s, uint32_t& out) {
  if (strncmp(s, "FT-", 3) != 0) return false;
  char* end = nullptr;
  unsigned long v = strtoul(s + 3, &end, 16);
  if (end != s + 11 || *end != '\0') return false;
  out = (uint32_t)v;
  return true;
}

// ===========================================================================
//  Upload task (core 0)
// ===========================================================================

// Built fresh for every attempt so age_ms is right at the moment of sending.
static void buildPayload(const RxItem* items, size_t n, String& out) {
  JsonDocument body;
  body["p_gateway_key"] = GATEWAY_SECRET;
  JsonArray readings = body["p_readings"].to<JsonArray>();
  uint32_t now = millis();
  for (size_t i = 0; i < n; i++) {   // oldest first - the server processes them in order
    const UplinkPacket& p = items[i].pkt;
    bool fix = (p.flags & UPLINK_FLAG_FIX) != 0;
    char id[12];
    deviceIdToHex(p.deviceId, id, sizeof(id));
    JsonObject r = readings.add<JsonObject>();
    r["device_id"] = id;
    r["seq"]       = p.seq;
    r["ts"]        = p.gpsEpoch;   // 0 = unknown, the server falls back to now() - age_ms
    r["fix"]       = fix;
    // null, not 0,0: without a fix there is no position, and 0,0 is a real
    // point in the Atlantic that a fence check would call a breach.
    if (fix) { r["lat"] = p.latE7 / 1e7; r["lng"] = p.lngE7 / 1e7; }
    else     { r["lat"] = nullptr;       r["lng"] = nullptr; }
    if (p.battery <= 100) r["battery"] = p.battery;
    else                  r["battery"] = nullptr;   // BATTERY_UNKNOWN
    r["rssi"]          = items[i].rssi;
    r["snr"]           = items[i].snr;
    r["sats"]          = (p.flags >> UPLINK_SATS_SHIFT) & UPLINK_SATS_MASK;
    r["gps_ok"]        = (p.flags & UPLINK_FLAG_GPS_OK) != 0;
    r["gps_restarted"] = (p.flags & UPLINK_FLAG_GPS_RESTART) != 0;
    r["age_ms"]        = now - items[i].rxMillis;
  }
  out = String();                     // release the previous buffer first
  out.reserve(measureJson(body) + 1); // one exact allocation, no growth
  serializeJson(body, out);
}

// --- reading the response body against one deadline ------------------------
// HTTPClient::getString() keeps reading for as long as the connection stays
// open, with no time limit (writeToStreamDataBlock loops on connected()). A
// server that sent its headers and then stalled mid-body held this task until
// the 60s watchdog rebooted the board and threw the queue away. These helpers
// read the same body - Content-Length, chunked, or until-close - but give up
// once HTTP_BODY_BUDGET_MS has passed since the headers arrived. The TLS socket
// is non-blocking, so no single call below can overrun the deadline.

// >0: bytes ready. 0: the server closed the connection. Negative: deadline passed.
static int bodyWait(uint32_t start) {
  for (;;) {
    int avail = tlsClient.available();
    if (avail > 0) return avail;
    if (avail < 0 || !tlsClient.connected()) return 0;
    if (millis() - start >= HTTP_BODY_BUDGET_MS) return HTTPC_ERROR_READ_TIMEOUT;
    delay(1);
  }
}

// Appends n body bytes to respBody (or reads until the server closes, when
// untilClose). Past HTTP_BODY_MAX it stops and sets truncated.
static int bodyRead(uint32_t start, size_t n, bool untilClose, bool& truncated) {
  while (n > 0) {
    int avail = bodyWait(start);
    if (avail == 0) return untilClose ? 0 : HTTPC_ERROR_CONNECTION_LOST;
    if (avail < 0) return avail;
    size_t room = HTTP_BODY_MAX - respLen;
    if (room == 0) {
      truncated = true;
      return 0;
    }
    size_t want = (size_t)avail < n ? (size_t)avail : n;
    if (want > room) want = room;
    int got = tlsClient.read((uint8_t*)respBody + respLen, want);
    if (got <= 0) return HTTPC_ERROR_CONNECTION_LOST;
    respLen += got;
    if (!untilClose) n -= got;
  }
  return 0;
}

// One CRLF-terminated line (chunk sizes, trailers); keeps the first cap-1 chars.
static int bodyLine(uint32_t start, char* line, size_t cap) {
  size_t len = 0;
  for (;;) {
    int avail = bodyWait(start);
    if (avail == 0) return HTTPC_ERROR_CONNECTION_LOST;
    if (avail < 0) return avail;
    int c = tlsClient.read();
    if (c < 0) return HTTPC_ERROR_CONNECTION_LOST;
    if (c == '\n') break;
    if (c != '\r' && len + 1 < cap) line[len++] = (char)c;
  }
  line[len] = '\0';
  return 0;
}

// Returns 0 or a negative HTTPC_ERROR_* code. reusable comes back false when
// unread bytes may be left on the connection, so the caller closes it rather
// than letting them corrupt the next response.
static int readBody(bool& reusable) {
  respLen     = 0;
  reusable    = true;
  bool truncated = false;
  int rc = 0;
  uint32_t start = millis();
  if (http.header("Transfer-Encoding").equalsIgnoreCase("chunked")) {
    char line[24];
    for (;;) {
      if ((rc = bodyLine(start, line, sizeof(line))) < 0) break;
      char* end = nullptr;
      unsigned long chunk = strtoul(line, &end, 16);   // stops at any ";extension"
      if (end == line) { rc = HTTPC_ERROR_ENCODING; break; }
      if (chunk == 0) {
        // Last chunk. The body is complete; the optional trailers and blank
        // line after it only matter for reusing the connection.
        int t;
        do { t = bodyLine(start, line, sizeof(line)); } while (t == 0 && line[0] != '\0');
        if (t < 0) reusable = false;
        break;
      }
      if ((rc = bodyRead(start, chunk, false, truncated)) < 0 || truncated) break;
      if ((rc = bodyLine(start, line, sizeof(line))) < 0) break;   // CRLF after the chunk data
    }
  } else {
    int size = http.getSize();   // -1: no Content-Length, the body ends when the server closes
    rc = bodyRead(start, size < 0 ? SIZE_MAX : (size_t)size, size < 0, truncated);
  }
  respBody[respLen] = '\0';
  if (truncated) Serial.printf("response truncated at %u bytes\n", (unsigned)respLen);
  if (rc < 0 || truncated) reusable = false;
  return rc;
}

static int postOnce(const String& payload) {
  respLen     = 0;
  respBody[0] = '\0';
  if (!http.begin(tlsClient, ingestUrl)) return HTTPC_ERROR_CONNECTION_REFUSED;
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Content-Type", "application/json");
  int  code     = http.POST((uint8_t*)payload.c_str(), payload.length());
  bool reusable = true;
  if (code > 0) {
    esp_task_wdt_reset();   // the body gets its own, separate budget
    int rc = readBody(reusable);
    // A 200 whose body never arrived carries no states - treat it as a
    // network failure (the caller drops the connection and retries). For any
    // other status the code already IS the answer; the body is only printed.
    if (rc < 0 && code == 200) code = rc;
  }
  if (!reusable) tlsClient.stop();
  http.end();   // keeps the TLS connection open when the server allows keep-alive
  return code;
}

// Hands each collar's state to loop() for the downlink. Parsing is null-safe:
// v1 did strcmp(item["device_id"], ...) and crashed on a response without it.
static void relayStates(const RxItem* items, size_t n) {
  JsonDocument doc;
  if (deserializeJson(doc, (const char*)respBody, respLen) != DeserializationError::Ok ||
      !doc.is<JsonArrayConst>()) {
    Serial.printf("bad response JSON: %.200s\n", respBody);
    // One printf per line from this task: println() is two UART writes (text,
    // then CRLF), and loop()'s "RX from" line can land between them.
    Serial.printf("no state to relay back - skipping downlink reply this cycle\n");
    return;
  }
  bool answered[MAX_BATCH] = {};
  for (JsonObjectConst item : doc.as<JsonArrayConst>()) {
    uint32_t dev;
    if (!parseDeviceId(item["device_id"] | "", dev)) continue;
    JsonVariantConst st = item["state"];
    if (!st.is<int>() || st.as<int>() < FENCE_STATE_SAFE || st.as<int>() > FENCE_STATE_BREACH) continue;
    // The state belongs to the reading the server names (seq). A server that
    // doesn't say is answering for the device's newest reading in the batch.
    JsonVariantConst seqV = item["seq"];
    bool haveSeq = seqV.is<uint16_t>();
    int idx = -1;
    for (int i = (int)n - 1; i >= 0; i--) {
      if (items[i].pkt.deviceId == dev && (!haveSeq || items[i].pkt.seq == seqV.as<uint16_t>())) {
        idx = i;
        break;
      }
    }
    if (idx < 0) continue;
    for (size_t i = 0; i < n; i++) if (items[i].pkt.deviceId == dev) answered[i] = true;
    ReplyItem r{dev, items[idx].pkt.seq, items[idx].rxMillis, (uint8_t)st.as<int>()};
    if (xQueueSend(replyQueue, &r, 0) != pdTRUE) Serial.printf("reply queue full - reply dropped\n");
  }
  for (size_t i = 0; i < n; i++) {
    if (answered[i]) continue;
    bool firstOfDevice = true;
    for (size_t j = 0; j < i; j++) if (items[j].pkt.deviceId == items[i].pkt.deviceId) firstOfDevice = false;
    if (firstOfDevice) {
      Serial.printf("no state to relay back - skipping downlink reply this cycle dev=%08X\n",
                    (unsigned)items[i].pkt.deviceId);
    }
  }
}

enum UploadResult {
  UPLOAD_OK,         // server took the batch
  UPLOAD_REJECTED,   // server answered 4xx - resending the same data won't help
  UPLOAD_RETRY,      // server answered 5xx / 408 / 429, or took too long to answer
  UPLOAD_TRANSPORT,  // no HTTP answer at all (DNS, TCP, TLS, dropped connection)
};

static UploadResult uploadBatch(const RxItem* items, size_t n) {
  uint32_t t0 = millis();
  String payload;
  buildPayload(items, n, payload);
  int code = postOnce(payload);
  if (code < 0) {
    // A negative code is a transport failure, not an HTTP answer - most often
    // a kept-alive connection that the server or a NAT has since dropped.
    // Throw that socket away and try once more on a fresh one.
    tlsClient.stop();
    esp_task_wdt_reset();
    buildPayload(items, n, payload);
    code = postOnce(payload);
    if (code < 0) tlsClient.stop();
  }
  payload = String();   // free it before parsing the response

  if (code != 200) {
    Serial.printf("upload failed, HTTP %d: %.200s\n", code,
                  code < 0 ? HTTPClient::errorToString(code).c_str() : respBody);
    Serial.printf("no state to relay back - skipping downlink reply this cycle n=%u\n", (unsigned)n);
    // A read timeout on the retry means a FRESH connection got through DNS,
    // TCP and TLS and sent the request, and then the server didn't answer in
    // time. That points at the server or this batch, not at the network - and
    // it is how an oversized batch actually fails: Supabase cancels anon
    // queries at 3s, the same moment this gateway's 3s read timeout fires, so
    // the 500 usually loses the race. So it counts as a server error (towards
    // splitting the batch), not towards the restart.
    if (code == HTTPC_ERROR_READ_TIMEOUT) return UPLOAD_RETRY;
    if (code < 0) return UPLOAD_TRANSPORT;
    if (code >= 500 || code == 408 || code == 429) return UPLOAD_RETRY;
    return UPLOAD_REJECTED;
  }
  Serial.printf("upload ok n=%u ms=%lu heap=%u maxblk=%u\n", (unsigned)n,
                (unsigned long)(millis() - t0), (unsigned)ESP.getFreeHeap(),
                (unsigned)ESP.getMaxAllocHeap());
  relayStates(items, n);
  return UPLOAD_OK;
}

// Removes the k oldest readings from the pending batch.
static void dropPending(size_t k) {
  if (k > pendingCount) k = pendingCount;
  memmove(pending, pending + k, (pendingCount - k) * sizeof(RxItem));
  pendingCount -= k;
}

static void uploadTask(void*) {
  esp_task_wdt_add(NULL);

#if GATEWAY_TLS_INSECURE
  tlsClient.setInsecure();
#else
  tlsClient.setCACert(SUPABASE_ROOT_CA_PEM);
#endif
  tlsClient.setHandshakeTimeout(TLS_HANDSHAKE_TIMEOUT_S);   // seconds
  http.setReuse(true);
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);          // milliseconds
  http.setTimeout(HTTP_READ_TIMEOUT_MS);                    // milliseconds
  // Recorded per response so readBody() knows how the body is framed.
  static const char* COLLECT_HEADERS[] = {"Transfer-Encoding"};
  http.collectHeaders(COLLECT_HEADERS, 1);

  size_t   batchLimit        = MAX_BATCH; // shrinks while a batch keeps failing server-side
  uint8_t  serverErrors      = 0;   // server errors in a row on the current batch
  bool     wifiWasUp         = false;
  uint32_t wifiDownSince     = millis();
  uint8_t  failuresInRow     = 0;   // any failed attempt - drives the back-off
  uint8_t  transportFailures = 0;   // no HTTP answer at all - drives the restart
  uint32_t retryAt           = 0;
  bool     serverReached     = false; // any HTTP answer since boot

  for (;;) {
    // Never block longer than ~1s between resets while nothing is happening;
    // the long waits (DNS, TLS) are covered by the 60s timeout.
    esp_task_wdt_reset();

    bool wifiUp = WiFi.status() == WL_CONNECTED;
    if (wifiUp != wifiWasUp) {
      wifiWasUp = wifiUp;
      if (wifiUp) {
        Serial.printf("WiFi connected, IP=%s rssi=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
        tlsClient.stop();   // any connection from before the drop is dead
      } else {
        wifiDownSince = millis();
        Serial.printf("WiFi lost - readings stay queued (%u waiting)\n",
                      (unsigned)uxQueueMessagesWaiting(uploadQueue));
      }
    }
    if (!wifiUp) {
      // Auto-reconnect handles short drops. If that hasn't worked in 60s
      // (router rebooted, DHCP lost), start the association from scratch.
      if (millis() - wifiDownSince > WIFI_FULL_RECONNECT_MS) {
        Serial.printf("WiFi down for 60s - full reconnect\n");
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        wifiDownSince = millis();
      }
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }

    if (pendingCount == 0) {
      if (xQueueReceive(uploadQueue, &pending[0], pdMS_TO_TICKS(1000)) != pdTRUE) continue;
      pendingCount = 1;
    } else if ((int32_t)(millis() - retryAt) < 0) {
      vTaskDelay(pdMS_TO_TICKS(200));   // backing off after a failure
      continue;
    }
    while (pendingCount < MAX_BATCH &&
           xQueueReceive(uploadQueue, &pending[pendingCount], 0) == pdTRUE) {
      pendingCount++;
    }

    // The oldest readings go first; batchLimit is below MAX_BATCH only while
    // a batch is being split after server errors.
    size_t sendCount = pendingCount < batchLimit ? pendingCount : batchLimit;
    UploadResult result = uploadBatch(pending, sendCount);
    esp_task_wdt_reset();
    if (result != UPLOAD_TRANSPORT) serverReached = true;
    if (result == UPLOAD_OK || result == UPLOAD_REJECTED) {
      dropPending(sendCount);
      if (result == UPLOAD_OK) batchLimit = MAX_BATCH;
      serverErrors      = 0;
      failuresInRow     = 0;
      transportFailures = 0;
      continue;
    }

    // Keep the batch and retry after 1, 2, 3 ... 8s.
    if (failuresInRow < 8) failuresInRow++;
    retryAt = millis() + 1000UL * failuresInRow;
    if (result == UPLOAD_RETRY) {
      // Retrying the same batch forever let one bad batch block every newer
      // reading - e.g. 64 readings queued during an outage that the database
      // can't process inside its 3s limit. So after a few server errors the
      // batch is halved (64, 32, ... 1), and a single reading that still
      // fails is dropped. The size goes back to MAX_BATCH after a success.
      if (++serverErrors >= SERVER_ERRORS_BEFORE_SPLIT) {
        serverErrors = 0;
        if (sendCount > 1) {
          batchLimit = sendCount / 2;
          Serial.printf("batch of %u failed %u times - retrying %u at a time\n",
                        (unsigned)sendCount, (unsigned)SERVER_ERRORS_BEFORE_SPLIT, (unsigned)batchLimit);
        } else {
          Serial.printf("dropped reading dev=%08X seq=%u after %u server errors\n",
                        (unsigned)pending[0].pkt.deviceId, pending[0].pkt.seq,
                        (unsigned)SERVER_ERRORS_BEFORE_SPLIT);
          dropPending(1);
        }
      }
    }
    if (result == UPLOAD_TRANSPORT) {
      // Several transport failures in a row with WiFi up is the state v1 got
      // stuck in (HTTP -1/-11/-29312 until someone pressed reset). A restart
      // clears the TLS stack and heap; it does lose the queue. (A -11 that a
      // fresh connection also gets counts as a server error instead - see
      // uploadBatch - since that connection proved the TLS stack works.)
      //
      // But if the server hasn't answered once since boot, the cause is almost
      // always outside the board - internet down behind a working router, DNS,
      // a CA change - and a fresh boot fails the same way. Restarting then
      // would loop (every ~30s when TLS fails fast, a few minutes when DNS
      // times out), throwing the queue away each time. So a
      // gateway that has never got through waits RESTART_MIN_UPTIME_MS
      // between restarts, keeping its queue meanwhile.
      if (transportFailures < 255) transportFailures++;
      bool restartCanHelp = serverReached || millis() >= RESTART_MIN_UPTIME_MS;
      if (transportFailures == RESTART_AFTER_FAILURES && !restartCanHelp) {
        Serial.printf("%u uploads in a row got no answer, but the server hasn't answered since boot - "
                      "not restarting yet (queue kept)\n", (unsigned)transportFailures);
      }
      if (transportFailures >= RESTART_AFTER_FAILURES && WiFi.status() == WL_CONNECTED && restartCanHelp) {
        Serial.printf("%u uploads in a row got no answer with WiFi up - restarting (%u queued readings lost)\n",
                      (unsigned)transportFailures,
                      (unsigned)(pendingCount + uxQueueMessagesWaiting(uploadQueue)));
        delay(100);
        ESP.restart();
      }
    } else {
      transportFailures = 0;   // the server answered; restarting us won't fix a 5xx
    }
  }
}

// ===========================================================================
//  Radio side (loop, core 1)
// ===========================================================================

static uint32_t lastUplinkMs = 0;   // when the last valid v2 uplink arrived

static void startRadioOrRestart() {
  if (loraBeginLink()) return;
  Serial.printf("LoRa FAILED - check 3V3 power, SPI wiring (18/19/23), NSS/RST/DIO0 - restarting in 5s\n");
  delay(5000);
  ESP.restart();
}

// An SX1278 that browns out comes back in its power-on state (wrong
// spreading factor and sync word) and silently hears nothing. The library
// gives no way to read its settings back, so re-apply them whenever the
// radio fails a transmit or has heard no uplink for a while. With no collar
// switched on this just repeats every 5 minutes, costing ~30ms of listening.
static void radioReinit(const char* why) {
  Serial.printf("radio re-init: %s\n", why);
  LoRa.end();
  startRadioOrRestart();
  lastUplinkMs = millis();
}

static void enqueueReading(const RxItem& item) {
  if (xQueueSend(uploadQueue, &item, 0) == pdTRUE) return;
  // Full (WiFi has been down a while): the newest reading is the one the
  // server and the collar care about, so make room by dropping the oldest.
  RxItem dropped;
  if (xQueueReceive(uploadQueue, &dropped, 0) == pdTRUE) {
    Serial.printf("queue full, dropped oldest seq=%u\n", dropped.pkt.seq);
  }
  xQueueSend(uploadQueue, &item, 0);
}

static void receiveUplink() {
  int packetSize = LoRa.parsePacket();
  if (packetSize == 0) return;

  uint32_t rxMillis = millis();
  if (packetSize != sizeof(UplinkPacket) || LoRa.peek() != PROTO_VERSION) {
    // Most likely a collar still on the old firmware (v1 uplinks are also 21
    // bytes, so it shows as "len=21 ver=1"), or the lora_tx bench test. Say
    // so, but at most every 30s.
    static uint32_t lastWarn = 0;
    if (lastWarn == 0 || millis() - lastWarn > 30000) {
      lastWarn = millis();
      Serial.printf("ignored packet len=%d ver=%d - collar and gateway must both run protocol v%d\n",
                    packetSize, LoRa.peek(), PROTO_VERSION);
    }
    return;
  }
  RxItem item{};
  LoRa.readBytes((uint8_t*)&item.pkt, sizeof(item.pkt));
  lastUplinkMs  = rxMillis;
  item.rxMillis = rxMillis;
  item.rssi     = (int16_t)LoRa.packetRssi();
  item.snr      = LoRa.packetSnr();

  const UplinkPacket& pkt = item.pkt;
  Serial.printf("RX from %08X seq=%u fix=%d sats=%u rssi=%d snr=%.1f gps_ok=%d gps_rst=%d\n",
                (unsigned)pkt.deviceId, pkt.seq, pkt.flags & UPLINK_FLAG_FIX,
                (pkt.flags >> UPLINK_SATS_SHIFT) & UPLINK_SATS_MASK, item.rssi, item.snr,
                (pkt.flags & UPLINK_FLAG_GPS_OK) ? 1 : 0, (pkt.flags & UPLINK_FLAG_GPS_RESTART) ? 1 : 0);
  enqueueReading(item);
}

static void sendReplies() {
  ReplyItem r;
  while (xQueueReceive(replyQueue, &r, 0) == pdTRUE) {
    uint32_t age = millis() - r.rxMillis;
    if (age > REPLY_MAX_AGE_MS) {
      Serial.printf("reply late, skipped seq=%u age=%lums\n", r.seq, (unsigned long)age);
      continue;
    }
    DownlinkPacket reply{};
    reply.version  = PROTO_VERSION;
    reply.deviceId = r.deviceId;
    reply.seq      = r.seq;
    reply.state    = r.state;
    // Normal IQ, the same as uplinks and as v1. Inverted-IQ replies were
    // tried in v2 and the collar never decoded one on the bench (27 Sep
    // 2026). A collar still can't take another collar's traffic for its
    // reply: it accepts only 8 bytes carrying its own id and uplink seq.
    LoRa.idle();
    bool sent = loraSend((const uint8_t*)&reply, sizeof(reply));
    if (sent) {
      Serial.printf("TX reply state=%d seq=%u dev=%08X\n", r.state, r.seq, (unsigned)r.deviceId);
      // An uplink that finished just before idle() above left RX_DONE set,
      // and nothing on the transmit path clears it. The reply has since
      // overwritten FIFO bytes 0-7 (RX and TX both start at 0), so the next
      // parsePacket() would return a 21-byte "uplink" whose first 8 bytes are
      // this reply: this collar's id and seq with another collar's position.
      // Clear the flag here and drop that packet.
      if (LoRa.parsePacket() > 0) Serial.printf("uplink lost: it arrived while reply seq=%u was being sent\n", r.seq);
    } else {
      radioReinit("reply transmit did not finish");
    }
  }
}

static void periodicChecks() {
  if (millis() - lastUplinkMs >= 300000) radioReinit("no uplink heard for 5 minutes");

  static uint32_t lastStackLog = 0;
  if (millis() - lastStackLog >= 300000) {
    lastStackLog = millis();
    Serial.printf("stack free: loop=%u upload=%u  queue=%u/%u\n",
                  (unsigned)uxTaskGetStackHighWaterMark(NULL),
                  (unsigned)uxTaskGetStackHighWaterMark(uploadTaskHandle),
                  (unsigned)uxQueueMessagesWaiting(uploadQueue), (unsigned)UPLOAD_QUEUE_LEN);
  }
}

void setup() {
  Serial.begin(115200);
  // NOT an output: on this build the SX1278's DIO0 is wired to GPIO2, which is
  // also the onboard LED pin. Driving it while the radio drives it too shorts
  // two push-pull outputs together and disturbs the 3V3 rail the radio runs
  // from. Same fault as the collar. Proper fix is to move the DIO0 jumper to
  // GPIO26 as pins.h specifies; until then this pin must stay an input.
  pinMode(PIN_LED, INPUT);
  delay(1000);
  Serial.println("\n=== FarmTrack GATEWAY ===");
  Serial.printf("reset reason: %s\n", resetReasonName(esp_reset_reason()));

  esp_task_wdt_init(WDT_TIMEOUT_S, true);
  esp_task_wdt_add(NULL);   // loop task; uploadTask adds itself

  startRadioOrRestart();
  Serial.println("LoRa OK, listening...");

  uploadQueue = xQueueCreate(UPLOAD_QUEUE_LEN, sizeof(RxItem));
  replyQueue  = xQueueCreate(REPLY_QUEUE_LEN, sizeof(ReplyItem));
  if (!uploadQueue || !replyQueue) {
    Serial.println("out of memory creating queues - restarting");
    delay(1000);
    ESP.restart();
  }
  ingestUrl = String(SUPABASE_URL) + "/rest/v1/rpc/ingest_telemetry";

  WiFi.mode(WIFI_STA);
  // Modem sleep makes the station doze between beacons, which delays every
  // HTTP response by up to a beacon interval - time the reply doesn't have.
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Connecting to WiFi in the background - readings are queued until it is up");
#if GATEWAY_TLS_INSECURE
  Serial.println("WARNING: GATEWAY_TLS_INSECURE=1 - Supabase's certificate is NOT checked (debug builds only)");
#endif

  // Without this task the gateway would keep receiving and queueing but never
  // upload or reply - alive-looking and useless - so failing to create it
  // (out of memory) is worth a restart.
  if (xTaskCreatePinnedToCore(uploadTask, "upload", UPLOAD_TASK_STACK, nullptr, 1,
                              &uploadTaskHandle, 0) != pdPASS) {
    Serial.printf("upload task create failed - restarting in 1s\n");
    delay(1000);
    ESP.restart();
  }
}

void loop() {
  esp_task_wdt_reset();
  receiveUplink();
  sendReplies();
  periodicChecks();
  delay(1);
}
