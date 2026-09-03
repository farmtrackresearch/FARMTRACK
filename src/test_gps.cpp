// ===========================================================================
//  TEST 2 - NEO-6M GPS
// ---------------------------------------------------------------------------
//  Wiring:  VCC->5V(VIN)  GND->GND  TX->GPIO16  RX->GPIO17
//
//  Build/flash:  pio run -e gps -t upload -t monitor
//
//  Output @ 115200:
//    searching -> counters (tells wiring fault from "no sky view")
//    fix       -> "MAPS: <lat>, <lng>"  -> paste into Google Maps
//
//  Controls:  's' or BOOT = stop (LED off) ,  'r' or BOOT = resume
//  Read-only: never writes to the module, so its config can't be corrupted.
//  Cold start outdoors takes 1-3 minutes.
// ===========================================================================

#include <Arduino.h>
#include <TinyGPSPlus.h>
#include "pins.h"

TinyGPSPlus    gps;
HardwareSerial gpsUart(2);            // ESP32 hardware UART2

static bool running = true;

// --------------------------- stop / resume ---------------------------------
static void stopProgram() {
  running = false;
  digitalWrite(PIN_LED, LOW);
  Serial.println(">> STOPPED (send 'r' or press BOOT to resume)");
}
static void resumeProgram() {
  running = true;
  Serial.println(">> RESUMED");
}
static bool bootPressed() {
  static int last = HIGH;
  static uint32_t t = 0;
  int level = digitalRead(PIN_BOOT_BTN);
  if (level != last && millis() - t > 40) { t = millis(); last = level; return level == LOW; }
  return false;
}
static void handleControls() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == 's' || c == 'S') stopProgram();
    if (c == 'r' || c == 'R') resumeProgram();
  }
  if (bootPressed()) running ? stopProgram() : resumeProgram();
}

// ------------------------------- GPS --------------------------------------
static bool gpsHasFix() {
  return gps.location.isValid() && gps.location.age() < 5000;
}

static void gpsPrintStatus() {
  uint32_t sats = gps.satellites.isValid() ? gps.satellites.value() : 0;

  if (gpsHasFix()) {
    double lat = gps.location.lat(), lng = gps.location.lng();
    Serial.printf("FIX   sats=%lu  hdop=%.1f   MAPS: %.6f, %.6f\n",
                  (unsigned long)sats,
                  gps.hdop.isValid() ? gps.hdop.hdop() : 0.0, lat, lng);
    Serial.printf("      https://www.google.com/maps?q=%.6f,%.6f\n", lat, lng);
  } else {
    const char* link = (gps.charsProcessed() == 0)
                         ? "NO DATA - check TX->GPIO16 / GND / power"
                         : "receiving";
    Serial.printf("SEARCH  sats=%lu  rxBytes=%lu  sentencesOk=%lu  csumErr=%lu  link=%s\n",
                  (unsigned long)sats,
                  (unsigned long)gps.charsProcessed(),
                  (unsigned long)gps.passedChecksum(),
                  (unsigned long)gps.failedChecksum(), link);
  }
}

static void updateLed() {
  static uint32_t last = 0;
  static bool on = false;
  if (gpsHasFix()) { digitalWrite(PIN_LED, HIGH); return; }
  if (millis() - last >= 250) { last = millis(); on = !on; digitalWrite(PIN_LED, on); }
}

// ------------------------------ setup/loop --------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BOOT_BTN, INPUT_PULLUP);
  delay(1000);

  Serial.println("\n=== FarmTrack TEST 2 - NEO-6M GPS ===");
  gpsUart.begin(GPS_BAUD, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  Serial.printf("GPS: UART2  RX=GPIO%d  TX=GPIO%d  @ %d baud\n",
                PIN_GPS_RX, PIN_GPS_TX, GPS_BAUD);
  Serial.println("Controls: 's'/BOOT = stop, 'r'/BOOT = resume");
  Serial.println("Waiting for satellites (needs a clear sky view)...");
}

void loop() {
  handleControls();
  if (!running) { delay(50); return; }

  while (gpsUart.available() > 0) gps.encode(gpsUart.read());

  static uint32_t lastPrint = 0;
  if (millis() - lastPrint >= 2000) {
    lastPrint = millis();
    gpsPrintStatus();
  }
  updateLed();
}
